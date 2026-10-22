import type { PortalDb } from './portalDb.ts'
import {
  createUpstashRateLimiter,
  readUpstashRateLimitConfig,
  type DistributedRateLimiter,
  type DistributedRateLimitResult,
  type RateLimitAction,
} from './rateLimit.ts'

// Contadores persistidos e distribuídos do Portal. O balde do Supabase,
// chaveado só pelo CNPJ (ADR 0049), é a trava que decide: falha da RPC conta
// como bloqueio. O Redis (IP+CNPJ) só pode ACRESCENTAR bloqueio; um "allowed"
// dele nunca libera um CNPJ que o Supabase já travou, senão trocar de IP
// contornaria as 5 tentativas em 15 minutos.
export type PortalRateLimitContext = { ip: string }

let cachedRedisConfig = ''
let cachedRedis: DistributedRateLimiter | null = null

function getRedis(): DistributedRateLimiter | null {
  const config = readUpstashRateLimitConfig()
  if (!config) {
    cachedRedis = null
    cachedRedisConfig = ''
    return null
  }

  const fingerprint = `${config.url}|${config.token}|${config.hmacSecret}|${config.threshold}|${config.windowSeconds}|${config.timeoutMs}`
  if (!cachedRedis || cachedRedisConfig !== fingerprint) {
    cachedRedis = createUpstashRateLimiter(config)
    cachedRedisConfig = fingerprint
  }
  return cachedRedis
}

export function requestIp(req: Request): string {
  const cloudflareIp = req.headers.get('CF-Connecting-IP')?.trim()
  if (cloudflareIp) return cloudflareIp
  const forwarded = req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return req.headers.get('X-Real-IP')?.trim() || 'unknown'
}

async function distributedRateLimitState(action: RateLimitAction, loginCnpj: string, context?: PortalRateLimitContext): Promise<DistributedRateLimitResult | null> {
  if (!context) return null
  const redis = getRedis()
  if (!redis) return null
  return redis.check({ action, ip: context.ip, cnpj: loginCnpj })
}

async function registerDistributedFailure(action: RateLimitAction, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  if (!context) return
  const redis = getRedis()
  if (redis) await redis.registerFailure({ action, ip: context.ip, cnpj: loginCnpj })
}

async function registerDistributedSuccess(action: RateLimitAction, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  if (!context) return
  const redis = getRedis()
  if (redis) await redis.registerSuccess({ action, ip: context.ip, cnpj: loginCnpj })
}

/** Supabase bloqueado sempre vence; o Redis só soma bloqueios. */
export function isRateLimitBlocked(persistedBlocked: boolean, distributed: DistributedRateLimitResult | null): boolean {
  return persistedBlocked || distributed?.state === 'blocked'
}

/**
 * Reserva atômica no balde do login (migration 413): a tentativa já entra como
 * falha antes de a senha ser conferida, sob trava do CNPJ, para pedidos em
 * paralelo não passarem do limite. Devolve o id da reserva, ou null quando o
 * CNPJ está bloqueado (no Supabase, por erro da RPC ou no Redis).
 */
export async function reserveLoginAttempt(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<number | null> {
  const { data, error } = await db.rpc('portal_login_reserve_attempt', { p_login: loginCnpj })
  const attemptId = typeof data === 'number' ? data : typeof data === 'string' ? Number(data) : null
  if (error || attemptId === null || !Number.isFinite(attemptId)) return null
  if (isRateLimitBlocked(false, await distributedRateLimitState('login', loginCnpj, context))) {
    await db.rpc('portal_login_settle_attempt', { p_attempt_id: attemptId, p_outcome: 'void' })
    return null
  }
  return attemptId
}

/** Senha errada: a reserva já é a falha; só o Redis (IP+CNPJ) soma. */
export async function confirmLoginFailure(loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  await registerDistributedFailure('login', loginCnpj, context)
}

// A reserva nasce como falha: se o acerto não for gravado, a senha certa conta
// como erro no balde. O supabase-js devolve { error } em vez de lançar, então o
// erro é conferido e a gravação é tentada de novo uma vez. Persistindo, o login
// segue (a senha conferiu) e a falha fica no log.
async function settleAttempt(db: PortalDb, attemptId: number, outcome: 'success' | 'void'): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await db.rpc('portal_login_settle_attempt', { p_attempt_id: attemptId, p_outcome: outcome })
    if (!error) return true
  }
  console.error('portal login: não foi possível encerrar a reserva', { attemptId, outcome })
  return false
}

export async function confirmLoginSuccess(db: PortalDb, attemptId: number, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  await settleAttempt(db, attemptId, 'success')
  await registerDistributedSuccess('login', loginCnpj, context)
}

/** A senha não foi conferida (falha do Auth ou nossa): a reserva sai do balde. */
export async function voidLoginAttempt(db: PortalDb, attemptId: number): Promise<void> {
  await settleAttempt(db, attemptId, 'void')
}

export async function isRecoveryRateLimited(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<boolean> {
  const { data, error } = await db.rpc('portal_recovery_check_rate_limit', { p_login: loginCnpj })
  const persistedBlocked = Boolean(error) || data === true
  if (persistedBlocked) return true
  return isRateLimitBlocked(persistedBlocked, await distributedRateLimitState('recovery', loginCnpj, context))
}

export async function registerRecoveryFailure(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  await db.rpc('portal_recovery_register_failure', { p_login: loginCnpj })
  await registerDistributedFailure('recovery', loginCnpj, context)
}

export async function isActivationRateLimited(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<boolean> {
  const { data, error } = await db.rpc('portal_activation_check_rate_limit', { p_login: loginCnpj })
  const persistedBlocked = Boolean(error) || data === true
  if (persistedBlocked) return true
  return isRateLimitBlocked(persistedBlocked, await distributedRateLimitState('activation', loginCnpj, context))
}

export async function registerActivationFailure(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  await db.rpc('portal_activation_register_failure', { p_login: loginCnpj })
  await registerDistributedFailure('activation', loginCnpj, context)
}
