import type { PortalDb, PortalDbResult } from './portalDb.ts'
import { logEdgeFailure } from './logger.ts'
import {
  createUpstashRateLimiter,
  readUpstashRateLimitConfig,
  type DistributedRateLimiter,
  type RateLimitAction,
  type RateLimitIdentity,
} from './rateLimit.ts'

export type PortalRateLimitContext = { ip: string }
export type PortalRateLimitAttempt = {
  blocked: boolean
  reservationId?: string
  identity?: RateLimitIdentity
  limiter?: DistributedRateLimiter
}
export type AttemptOutcome = 'failure' | 'success'

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
  // Preview runtime must prove the gateway overwrites a forged value before
  // this can be considered a trusted network identity.
  if (!cloudflareIp || cloudflareIp.length > 64 || cloudflareIp.includes(',') || /\s/.test(cloudflareIp)) return 'unknown'
  const containsControlCharacter = [...cloudflareIp].some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
  return containsControlCharacter ? 'unknown' : cloudflareIp
}

const rpcNames: Record<RateLimitAction, { check: string; failure: string; success?: string }> = {
  login: { check: 'portal_login_check_rate_limit', failure: 'portal_login_register_failure', success: 'portal_login_register_success' },
  recovery: { check: 'portal_recovery_check_rate_limit', failure: 'portal_recovery_register_failure' },
  activation: { check: 'portal_activation_check_rate_limit', failure: 'portal_activation_register_failure' },
}

async function rpcSafely(db: PortalDb, name: string, loginCnpj: string): Promise<PortalDbResult<unknown>> {
  try {
    return await db.rpc(name, { p_login: loginCnpj })
  } catch (error) {
    return { data: null, error }
  }
}

export async function beginPortalRateLimitAttempt(
  db: PortalDb,
  action: RateLimitAction,
  loginCnpj: string,
  context?: PortalRateLimitContext,
  redisOverride?: DistributedRateLimiter,
): Promise<PortalRateLimitAttempt> {
  const limiter = redisOverride ?? (context ? getRedis() : null)
  const identity = context ? { action, ip: context.ip, cnpj: loginCnpj } : undefined
  if (limiter && identity) {
    const reservation = await limiter.reserve(identity)
    if (reservation.state === 'reserved') return { blocked: false, reservationId: reservation.reservationId, identity, limiter }
    if (reservation.state === 'blocked') return { blocked: true }
    // Only Redis unavailability falls back to the durable legacy CNPJ counter.
  }

  const { data, error } = await rpcSafely(db, rpcNames[action].check, loginCnpj)
  if (error) logEdgeFailure({ functionName: 'portal-rate-limit', job: 'persisted_check', errorCode: 'rate_limit_persisted_failed', status: 'warning' })
  // A healthy Redis reservation is authoritative and avoids false lockouts from
  // the CNPJ-wide legacy counter. Once we are in fallback, however, a failed
  // durable check cannot safely establish that the request is within budget.
  return { blocked: Boolean(error) || data === true }
}

export async function completePortalRateLimitAttempt(
  db: PortalDb,
  action: RateLimitAction,
  loginCnpj: string,
  attempt: PortalRateLimitAttempt,
  outcome: AttemptOutcome,
): Promise<void> {
  if (attempt.limiter && attempt.identity && attempt.reservationId) {
    if (outcome === 'failure') await attempt.limiter.commitFailure(attempt.identity, attempt.reservationId)
    else await attempt.limiter.rollback(attempt.identity, attempt.reservationId)
  }

  if (outcome === 'failure') {
    const { error } = await rpcSafely(db, rpcNames[action].failure, loginCnpj)
    if (error) logEdgeFailure({ functionName: 'portal-rate-limit', job: 'persisted_failure', errorCode: 'rate_limit_persisted_failed', status: 'warning' })
  } else if (action === 'login' && rpcNames.login.success) {
    const { error } = await rpcSafely(db, rpcNames.login.success, loginCnpj)
    if (error) logEdgeFailure({ functionName: 'portal-rate-limit', job: 'persisted_success', errorCode: 'rate_limit_persisted_failed', status: 'warning' })
  }
}
