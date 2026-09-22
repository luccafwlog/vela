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
  jobName?: string
  surface?: 'internal' | 'portal' | 'edge'
  category?: string
  status?: string
  durationMs?: number
  processedCount?: number
  result?: string
}

type EdgeHandler = (request: Request) => Response | Promise<Response>
type EdgeFailureReporter = (error: unknown, context: EdgeTelemetryContext) => Promise<void>

/** Adds best-effort error reporting without changing an Edge Function response or exception. */
export function instrumentHttpHandler(
  functionName: string,
  handler: EdgeHandler,
  reportFailure: EdgeFailureReporter,
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
      if (response.status >= 500) {
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
