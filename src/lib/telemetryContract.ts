const FORMATTED_CNPJ_RE = /\b[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-[0-9]{2}\b/gi
const FORMATTED_CPF_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const BARE_CNPJ_RE = /\b(?=[0-9A-Z]{14}\b)(?=[0-9A-Z]*\d)[0-9A-Z]{14}\b/gi
const BARE_CPF_RE = /\b\d{11}\b/g
const MAX_SCRUB_DEPTH = 4

/** Pure privacy contract shared by browser and Supabase Edge telemetry. */
export function scrubTelemetryText(text: string): string {
  return text
    .replace(FORMATTED_CNPJ_RE, '[cnpj]')
    .replace(FORMATTED_CPF_RE, '[cpf]')
    .replace(EMAIL_RE, '[email]')
    .replace(BARE_CNPJ_RE, '[digits14]')
    .replace(BARE_CPF_RE, '[digits11]')
}

export function redactTelemetryUrl(url: string): string {
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.slice(0, queryIndex)
}

export function scrubTelemetryValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubTelemetryText(value)
  if (value == null || typeof value !== 'object') return value
  if (depth >= MAX_SCRUB_DEPTH) return '[nested-value-omitted]'
  if (Array.isArray(value)) return value.map((item) => scrubTelemetryValue(item, depth + 1))
  if (Object.getPrototypeOf(value) !== Object.prototype) return '[non-plain-value-omitted]'

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubTelemetryValue(item, depth + 1)]),
  )
}

export type EdgeTelemetryContext = {
  functionName: string
  jobName?: EdgeCronJobName
  surface?: 'internal' | 'portal' | 'edge'
  category?: string
  status?: string
  durationMs?: number
  processedCount?: number
  result?: EdgeJobResult
}

export type EdgeCronJobName =
  | 'alerts-detector'
  | 'demurrage-dunning'
  | 'customer-communication-auto-runner'
  | 'portal-daily-digest'

export type EdgeJobResult = 'success' | 'partial' | 'failure'
export type EdgeJobStage = 'started' | 'finished'
export type EdgeJobCountKind =
  | 'detectors_completed'
  | 'invoices_claimed'
  | 'communication_candidates'
  | 'digest_recipients_attempted'

export type EdgeJobSummary = {
  result: EdgeJobResult
  processedCount: number
}

export async function summarizeEdgeJobResponse(
  response: Response,
  processedCount: (body: Record<string, unknown>) => number,
  hasPartialFailure: (body: Record<string, unknown>) => boolean = () => false,
): Promise<EdgeJobSummary> {
  let body: Record<string, unknown> = {}
  try {
    const value: unknown = await response.clone().json()
    if (value && typeof value === 'object' && !Array.isArray(value)) body = value as Record<string, unknown>
  } catch {
    // Empty/non-JSON bodies carry no aggregate details.
  }

  const count = processedCount(body)
  return {
    result: response.status >= 500 ? 'failure' : hasPartialFailure(body) ? 'partial' : 'success',
    processedCount: Number.isSafeInteger(count) && count >= 0 ? count : 0,
  }
}

export type EdgeJobLifecycleEvent = {
  jobName: EdgeCronJobName
  countKind: EdgeJobCountKind
  stage: EdgeJobStage
  result?: EdgeJobResult
  durationMs?: number
  processedCount?: number
}

type EdgeJobReporter = (event: EdgeJobLifecycleEvent) => Promise<void>
type EdgeJobOptions = { enabled?: boolean; now?: () => number }

type EdgeHandler = (request: Request) => Response | Promise<Response>
type EdgeFailureReporter = (error: unknown, context: EdgeTelemetryContext) => Promise<void>

/** Adds best-effort error reporting without changing an Edge Function response or exception. */
export function instrumentHttpHandler(
  functionName: string,
  handler: EdgeHandler,
  reportFailure: EdgeFailureReporter,
  shouldReportServerError: (response: Response) => boolean | Promise<boolean> = () => true,
): EdgeHandler {
  const reportSafely = async (error: unknown, context: EdgeTelemetryContext) => {
    try {
      await reportFailure(error, context)
    } catch {
      // Observability cannot change the endpoint's result.
    }
  }

  return async (request) => {
    const startedAt = Date.now()
    try {
      const response = await handler(request)
      let shouldReport = response.status >= 500
      if (shouldReport) {
        try {
          shouldReport = await shouldReportServerError(response)
        } catch {
          // A telemetry filter cannot replace a valid endpoint response.
        }
      }
      if (shouldReport) {
        await reportSafely(new Error('Edge Function returned a server error'), {
          functionName,
          status: `http_${response.status}`,
          category: 'server_error',
          durationMs: Date.now() - startedAt,
        })
      }
      return response
    } catch (error) {
      await reportSafely(error, {
        functionName,
        status: 'uncaught',
        category: 'uncaught_exception',
        durationMs: Date.now() - startedAt,
      })
      throw error
    }
  }
}

/** Reports aggregate job lifecycle data without changing the response or thrown error. */
export async function instrumentEdgeJob<T>(
  jobName: EdgeCronJobName,
  countKind: EdgeJobCountKind,
  operation: () => T | Promise<T>,
  summarize: (value: T) => EdgeJobSummary | Promise<EdgeJobSummary>,
  report: EdgeJobReporter,
  options: EdgeJobOptions = {},
): Promise<T> {
  if (options.enabled === false) return operation()

  const now = options.now ?? Date.now
  const startedAt = now()
  const reportSafely = async (event: EdgeJobLifecycleEvent) => {
    try {
      await report(event)
    } catch {
      // Lifecycle telemetry is optional and cannot change job behavior.
    }
  }
  const processedCount = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : 0
  const elapsed = () => Math.max(0, now() - startedAt)

  await reportSafely({ jobName, countKind, stage: 'started' })
  try {
    const value = await operation()
    let summary: EdgeJobSummary = { result: 'failure', processedCount: 0 }
    try {
      const candidate = await summarize(value)
      if (candidate && ['success', 'partial', 'failure'].includes(candidate.result)) {
        summary = {
          result: candidate.result,
          processedCount: processedCount(candidate.processedCount),
        }
      }
    } catch {
      // A broken summary function is not allowed to change a successful job.
    }
    await reportSafely({
      jobName,
      countKind,
      stage: 'finished',
      result: summary.result,
      durationMs: elapsed(),
      processedCount: summary.processedCount,
    })
    return value
  } catch (error) {
    await reportSafely({
      jobName,
      countKind,
      stage: 'finished',
      result: 'failure',
      durationMs: elapsed(),
      processedCount: 0,
    })
    throw error
  }
}
