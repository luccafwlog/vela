export type RateLimitAction = 'login' | 'recovery' | 'activation'

export type RateLimitIdentity = {
  action: RateLimitAction
  ip: string
  cnpj?: string
}

export type DistributedRateLimitResult =
  | { state: 'allowed' }
  | { state: 'blocked'; retryAfterSeconds: number }
  | { state: 'unavailable' }

export type UpstashRateLimitConfig = {
  url: string
  token: string
  hmacSecret: string
  threshold?: number
  windowSeconds?: number
  timeoutMs?: number
  circuitOpenSeconds?: number
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

type RateLimitRuntime = {
  fetcher?: Fetcher
  now?: () => number
  log?: (message: string, details?: Record<string, unknown>) => void
}

export type DistributedRateLimiter = {
  check(identity: RateLimitIdentity): Promise<DistributedRateLimitResult>
  registerFailure(identity: RateLimitIdentity): Promise<void>
  registerSuccess(identity: RateLimitIdentity): Promise<void>
}

const CHECK_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then return {0, 0} end
return {tonumber(value), redis.call('TTL', KEYS[1])}
`

const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`

const CLEAR_SCRIPT = `return redis.call('DEL', KEYS[1])`

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
}

/**
 * Builds a key without putting either the IP or the CNPJ in Redis. The
 * HMAC secret is independent from the Upstash token so a leaked key cannot
 * be used to test guesses offline.
 */
export async function buildRateLimitKey(secret: string, identity: RateLimitIdentity): Promise<string> {
  const ipDigest = await hmacHex(secret, identity.ip.trim() || 'unknown')
  const cnpjDigest = await hmacHex(secret, identity.cnpj?.trim() || 'unknown')
  return `vela:portal-rate:${identity.action}:${ipDigest}:${cnpjDigest}`
}

function pipelineResult(payload: unknown): unknown {
  if (Array.isArray(payload)) return (payload[0] as { result?: unknown; error?: string } | undefined)?.result
  return (payload as { result?: unknown } | null)?.result
}

function resultPair(value: unknown): [number, number] {
  if (!Array.isArray(value)) throw new Error('Resposta inválida do Redis')
  const count = Number(value[0])
  const ttl = Number(value[1])
  if (!Number.isFinite(count) || !Number.isFinite(ttl)) throw new Error('Contador inválido do Redis')
  return [count, ttl]
}

function defaultLog(message: string, details?: Record<string, unknown>): void {
  console.info(message, details ?? {})
}

function readEnvironment(name: string): string | undefined {
  const deno = (globalThis as unknown as { Deno?: { env: { get(key: string): string | undefined } } }).Deno
  return deno?.env.get(name)
}

export function readUpstashRateLimitConfig(
  get: (name: string) => string | undefined = readEnvironment,
): UpstashRateLimitConfig | null {
  const url = get('UPSTASH_REDIS_REST_URL')?.trim()
  const token = get('UPSTASH_REDIS_REST_TOKEN')?.trim()
  const hmacSecret = get('PORTAL_RATE_LIMIT_HMAC_SECRET')?.trim()
  if (!url || !token || !hmacSecret || get('PORTAL_RATE_LIMIT_ENABLED') === 'false') return null

  return {
    url,
    token,
    hmacSecret,
    threshold: Number(get('PORTAL_RATE_LIMIT_THRESHOLD') ?? 10),
    windowSeconds: Number(get('PORTAL_RATE_LIMIT_WINDOW_SECONDS') ?? 300),
    timeoutMs: Number(get('PORTAL_RATE_LIMIT_TIMEOUT_MS') ?? 750),
    circuitOpenSeconds: Number(get('PORTAL_RATE_LIMIT_CIRCUIT_SECONDS') ?? 30),
  }
}

export function createUpstashRateLimiter(
  input: UpstashRateLimitConfig,
  runtime: RateLimitRuntime = {},
): DistributedRateLimiter {
  const config = {
    threshold: 10,
    windowSeconds: 300,
    timeoutMs: 750,
    circuitOpenSeconds: 30,
    ...input,
    url: input.url.replace(/\/+$/, ''),
  }
  const fetcher = runtime.fetcher ?? fetch
  const now = runtime.now ?? Date.now
  const log = runtime.log ?? defaultLog
  let consecutiveFailures = 0
  let circuitOpenUntil = 0

  const unavailable = (command: string, error: unknown): DistributedRateLimitResult => {
    consecutiveFailures += 1
    if (consecutiveFailures >= 3) circuitOpenUntil = now() + config.circuitOpenSeconds * 1000
    log('[portal-rate-limit] Upstash indisponível; mantendo defesa do Supabase', {
      command,
      circuitOpen: circuitOpenUntil > now(),
      error: error instanceof Error ? error.message : 'erro desconhecido',
    })
    return { state: 'unavailable' }
  }

  async function execute(command: string, key: string, args: string[] = []): Promise<unknown> {
    if (circuitOpenUntil > now()) throw new Error('circuito do rate limit aberto')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await fetcher(`${config.url}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([['EVAL', command, '1', key, ...args]]),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as unknown
      const item = Array.isArray(payload) ? payload[0] as { error?: string } | undefined : payload as { error?: string }
      if (item?.error) throw new Error(item.error)
      consecutiveFailures = 0
      circuitOpenUntil = 0
      return pipelineResult(payload)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async check(identity) {
      try {
        const key = await buildRateLimitKey(config.hmacSecret, identity)
        const [count, ttl] = resultPair(await execute(CHECK_SCRIPT, key))
        return count >= config.threshold
          ? { state: 'blocked', retryAfterSeconds: Math.max(ttl, 1) }
          : { state: 'allowed' }
      } catch (error) {
        return unavailable('check', error)
      }
    },

    async registerFailure(identity) {
      try {
        const key = await buildRateLimitKey(config.hmacSecret, identity)
        resultPair(await execute(INCREMENT_SCRIPT, key, [String(config.windowSeconds)]))
      } catch (error) {
        unavailable('register_failure', error)
      }
    },

    async registerSuccess(identity) {
      try {
        const key = await buildRateLimitKey(config.hmacSecret, identity)
        await execute(CLEAR_SCRIPT, key)
      } catch (error) {
        unavailable('register_success', error)
      }
    },
  }
}
