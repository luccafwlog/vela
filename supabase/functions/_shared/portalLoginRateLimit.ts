import type { PortalDb } from './portalDb.ts'
import {
  createUpstashRateLimiter,
  readUpstashRateLimitConfig,
  type DistributedRateLimiter,
  type DistributedRateLimitResult,
  type RateLimitAction,
} from './rateLimit.ts'

// Contadores persistidos e distribuídos do Portal. O RPC continua sendo a
// fonte de auditoria e o fallback fail-closed; quando o Redis está saudável,
// ele decide o par IP+CNPJ sem transformar o CNPJ puro em chave.
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
  // Only accept the Cloudflare client-IP header expected from the Supabase
  // gateway. Do not fall back to X-Forwarded-For or X-Real-IP: callers can
  // supply those headers themselves when invoking the public function URL.
  // Preview runtime must prove the gateway overwrites a forged value before
  // this can be considered a trusted network identity.
  if (!cloudflareIp || cloudflareIp.length > 64 || cloudflareIp.includes(',') || /\s/.test(cloudflareIp)) return 'unknown'
  const containsControlCharacter = [...cloudflareIp].some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
  if (containsControlCharacter) return 'unknown'
  return cloudflareIp
}

export function shouldBlockRateLimit(
  persistedBlocked: boolean,
  distributed: DistributedRateLimitResult | null,
): boolean {
  // The Redis counter is an additional defense, never an override for the
  // persisted Supabase decision. A healthy but empty Redis bucket must not
  // release a login that the durable counter has already blocked.
  return persistedBlocked || distributed?.state === 'blocked'
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

export async function isLoginRateLimited(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<boolean> {
  const { data, error } = await db.rpc('portal_login_check_rate_limit', { p_login: loginCnpj })
  const persistedBlocked = Boolean(error) || data === true
  const distributed = await distributedRateLimitState('login', loginCnpj, context)
  return shouldBlockRateLimit(persistedBlocked, distributed)
}

export async function registerLoginFailure(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  await db.rpc('portal_login_register_failure', { p_login: loginCnpj })
  await registerDistributedFailure('login', loginCnpj, context)
}

export async function registerLoginSuccess(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  await db.rpc('portal_login_register_success', { p_login: loginCnpj })
  await registerDistributedSuccess('login', loginCnpj, context)
}

export async function isRecoveryRateLimited(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<boolean> {
  const { data, error } = await db.rpc('portal_recovery_check_rate_limit', { p_login: loginCnpj })
  const persistedBlocked = Boolean(error) || data === true
  const distributed = await distributedRateLimitState('recovery', loginCnpj, context)
  return shouldBlockRateLimit(persistedBlocked, distributed)
}

export async function registerRecoveryFailure(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  await db.rpc('portal_recovery_register_failure', { p_login: loginCnpj })
  await registerDistributedFailure('recovery', loginCnpj, context)
}

export async function isActivationRateLimited(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<boolean> {
  const { data, error } = await db.rpc('portal_activation_check_rate_limit', { p_login: loginCnpj })
  const persistedBlocked = Boolean(error) || data === true
  const distributed = await distributedRateLimitState('activation', loginCnpj, context)
  return shouldBlockRateLimit(persistedBlocked, distributed)
}

export async function registerActivationFailure(db: PortalDb, loginCnpj: string, context?: PortalRateLimitContext): Promise<void> {
  await db.rpc('portal_activation_register_failure', { p_login: loginCnpj })
  await registerDistributedFailure('activation', loginCnpj, context)
}
