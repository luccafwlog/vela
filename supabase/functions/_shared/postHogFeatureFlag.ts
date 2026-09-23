const FLAGS_ENDPOINT = 'https://eu.i.posthog.com/flags/?v=2'
const GLOBAL_DISTINCT_ID = '$vela_global_flag'

type PostHogFlagsResponse = {
  featureFlags?: Record<string, unknown>
  errorsWhileComputingFlags?: boolean
  quota_limited?: boolean
}

type EvaluatePostHogFeatureFlagOptions = {
  projectKey: string | undefined
  flagKey: string
  request?: typeof fetch
  timeoutMs?: number
}

/**
 * Evaluates one global, non-person flag. Missing config, quota, errors, malformed
 * responses and timeouts all fail closed so telemetry availability can never
 * authorize an email send.
 */
export async function evaluatePostHogFeatureFlag({
  projectKey,
  flagKey,
  request = fetch,
  timeoutMs = 750,
}: EvaluatePostHogFeatureFlagOptions): Promise<boolean> {
  const key = projectKey?.trim()
  if (!key || !/^[A-Z][A-Z0-9_]{0,63}$/.test(flagKey) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await request(FLAGS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        token: key,
        distinct_id: GLOBAL_DISTINCT_ID,
        flag_keys_to_evaluate: [flagKey],
        send_event: false,
      }),
    })
    if (!response.ok) return false

    const result = await response.json() as PostHogFlagsResponse
    return result.quota_limited !== true
      && result.errorsWhileComputingFlags !== true
      && result.featureFlags?.[flagKey] === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

type ResolveCommunicationsSendEnabledOptions = Omit<EvaluatePostHogFeatureFlagOptions, 'flagKey'> & {
  masterSwitchEnabled: boolean
}

/** The PostHog flag can disable sending; only the administrative switch plus flag can enable it. */
export async function resolveCommunicationsSendEnabled({
  masterSwitchEnabled,
  projectKey,
  request,
  timeoutMs,
}: ResolveCommunicationsSendEnabledOptions): Promise<boolean> {
  if (!masterSwitchEnabled) return false
  return evaluatePostHogFeatureFlag({ projectKey, flagKey: 'COMMUNICATIONS_ENABLED', request, timeoutMs })
}
