export type BetterStackHeartbeatJob =
  | 'alertsDetector'
  | 'demurrageDunning'
  | 'customerCommunicationAutoRunner'
  | 'portalDailyDigest'

export type BetterStackHeartbeatStatus = 'success' | 'failure'

const HEARTBEAT_ENV: Record<BetterStackHeartbeatJob, string> = {
  alertsDetector: 'BETTERSTACK_HEARTBEAT_ALERTS_DETECTOR_URL',
  demurrageDunning: 'BETTERSTACK_HEARTBEAT_DEMURRAGE_DUNNING_URL',
  customerCommunicationAutoRunner: 'BETTERSTACK_HEARTBEAT_CUSTOMER_COMMUNICATION_AUTO_RUNNER_URL',
  portalDailyDigest: 'BETTERSTACK_HEARTBEAT_PORTAL_DAILY_DIGEST_URL',
}

const DEFAULT_TIMEOUT_MS = 1_500

/** Derives Better Stack lifecycle endpoints from its secret heartbeat URL. */
export function betterStackHeartbeatUrl(
  heartbeatUrl: string,
  status: BetterStackHeartbeatStatus,
): string | null {
  try {
    const url = new URL(heartbeatUrl.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null

    url.pathname = url.pathname.replace(/\/+$/, '')
    if (status === 'failure') url.pathname += '/fail'
    return url.toString()
  } catch {
    return null
  }
}

type HeartbeatOptions = {
  enabled?: boolean
  getEnv?: (name: string) => string | undefined
  fetcher?: typeof fetch
  timeoutMs?: number
}

async function hasOperationalFailures(response: Response): Promise<boolean> {
  if (!response.ok) return true
  try {
    const payload: unknown = await response.clone().json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    const result = payload as Record<string, unknown>
    return ['failed', 'partial', 'releaseFailures'].some((field) => {
      const count = result[field]
      return typeof count === 'number' && count > 0
    })
  } catch {
    // Some successful health handlers return empty/non-JSON bodies.
    return false
  }
}

async function sendHeartbeat(
  heartbeatUrl: string,
  status: BetterStackHeartbeatStatus,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<void> {
  const url = betterStackHeartbeatUrl(heartbeatUrl, status)
  if (!url) return

  try {
    const response = await fetcher(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    await response.body?.cancel()
  } catch {
    // Monitoring is optional; never expose its errors or change job behavior.
  }
}

/** Runs an authorized cron invocation and reports its outcome without affecting its result. */
export async function runWithBetterStackHeartbeat(
  job: BetterStackHeartbeatJob,
  operation: () => Response | Promise<Response>,
  options: HeartbeatOptions = {},
): Promise<Response> {
  if (options.enabled === false) return operation()

  let heartbeatUrl: string | undefined
  try {
    const getEnv = options.getEnv ?? ((name: string) => {
      const deno = (globalThis as typeof globalThis & { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno
      return deno?.env?.get(name)
    })
    heartbeatUrl = getEnv(HEARTBEAT_ENV[job])?.trim()
  } catch {
    // Missing environment permission/configuration must not block the job.
  }
  if (!heartbeatUrl || !betterStackHeartbeatUrl(heartbeatUrl, 'success')) return operation()

  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const response = await operation()
    const hasFailures = await hasOperationalFailures(response)
    await sendHeartbeat(heartbeatUrl, hasFailures ? 'failure' : 'success', fetcher, timeoutMs)
    return response
  } catch (error) {
    await sendHeartbeat(heartbeatUrl, 'failure', fetcher, timeoutMs)
    throw error
  }
}
