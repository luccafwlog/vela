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

// Remove query e fragmento: o fragmento carrega `#access_token=` nos links do
// Auth (auditoria run-2, reforço).
export function redactTelemetryUrl(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
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
  /** SQLSTATE ou código PostgREST da falha; nunca o texto da mensagem. */
  errorCode?: string
  /** RPC que falhou, só se estiver em TELEMETRY_RPC_ALLOWLIST. */
  failedRpc?: string
}

// Marcação interna de uma resposta 5xx: a Edge informa código e RPC que
// falharam sem passar a mensagem do banco, que pode ecoar dados de Cliente.
// instrumentHttpHandler lê, valida e retira os cabeçalhos antes de devolver.
const ERROR_CODE_HEADER = 'x-telemetry-error-code'
const FAILED_RPC_HEADER = 'x-telemetry-failed-rpc'
const SAFE_ERROR_CODE_RE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/
/** RPCs cujo nome pode ir para o Sentry como tag. */
export const TELEMETRY_RPC_ALLOWLIST: ReadonlySet<string> = new Set([
  'run_alert_detectors',
  'evaluate_and_dispatch_automatic_communications',
])

/** Cabeçalhos para marcar uma resposta 5xx com o código e a RPC da falha. */
export function telemetryFailureHeaders(rpc: string, error: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (typeof code === 'string' && SAFE_ERROR_CODE_RE.test(code)) headers[ERROR_CODE_HEADER] = code
  if (TELEMETRY_RPC_ALLOWLIST.has(rpc)) headers[FAILED_RPC_HEADER] = rpc
  return headers
}

/** Lê a marcação de telemetryFailureHeaders e devolve a resposta sem ela. */
function takeFailureMarkers(response: Response): { response: Response; errorCode?: string; failedRpc?: string } {
  const code = response.headers.get(ERROR_CODE_HEADER)
  const rpc = response.headers.get(FAILED_RPC_HEADER)
  if (code === null && rpc === null) return { response }
  const headers = new Headers(response.headers)
  headers.delete(ERROR_CODE_HEADER)
  headers.delete(FAILED_RPC_HEADER)
  return {
    response: new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
    errorCode: code !== null && SAFE_ERROR_CODE_RE.test(code) ? code : undefined,
    failedRpc: rpc !== null && TELEMETRY_RPC_ALLOWLIST.has(rpc) ? rpc : undefined,
  }
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
      const original = await handler(request)
      if (original.status < 500) return original
      const { response, errorCode, failedRpc } = takeFailureMarkers(original)
      await reportSafely(new Error('Edge Function returned a server error'), {
        functionName,
        status: `http_${response.status}`,
        category: 'server_error',
        durationMs: Date.now() - startedAt,
        ...(errorCode ? { errorCode } : {}),
        ...(failedRpc ? { failedRpc } : {}),
      })
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
