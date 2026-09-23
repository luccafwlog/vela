import {
  instrumentEdgeJob as instrumentJob,
  instrumentHttpHandler,
  redactTelemetryUrl,
  scrubTelemetryText,
  scrubTelemetryValue,
  type EdgeCronJobName,
  type EdgeJobLifecycleEvent,
  type EdgeJobSummary,
  type EdgeTelemetryContext,
} from '../../../src/lib/telemetryContract.ts'

export { summarizeEdgeJobResponse } from '../../../src/lib/telemetryContract.ts'

type SentrySdk = typeof import('@sentry/deno')
let sentryPromise: Promise<SentrySdk> | null = null
let initialized = false
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
  'AggregateError',
])
const SAFE_FUNCTION_NAMES = new Set([
  'alerts-detector',
  'customer-communication-auto-runner',
  'demurrage-dunning',
  'import-effects-runner',
  'portal-daily-digest',
  'portal-email-events-runner',
  'portal-email-webhook',
  'portal-invite-send',
  'recalc-demurrage-ptax',
  'send-customer-communication',
])
const SAFE_ERROR_CATEGORIES = new Set(['server_error', 'uncaught_exception'])

function safeHttpStatus(status?: string): string | undefined {
  return status === 'uncaught' || /^http_5\d\d$/.test(status ?? '') ? status : undefined
}

async function initializeSentry(): Promise<SentrySdk | null> {
  const dsn = Deno.env.get('SENTRY_DSN')?.trim()
  if (!dsn) return null
  sentryPromise ??= import('@sentry/deno')
  const Sentry = await sentryPromise
  if (initialized) return Sentry

  Sentry.init({
    dsn,
    environment: Deno.env.get('SENTRY_ENVIRONMENT')?.trim() || 'production',
    release: Deno.env.get('SENTRY_RELEASE')?.trim() || undefined,
    defaultIntegrations: false,
    sendDefaultPii: false,
    beforeSend(event) {
      event.user = undefined
      if (event.message) event.message = scrubTelemetryText(event.message)
      event.exception?.values?.forEach((value) => {
        if (value.value) value.value = scrubTelemetryText(value.value)
      })
      if (event.extra) event.extra = scrubTelemetryValue(event.extra) as typeof event.extra
      if (event.request) {
        if (event.request.url) event.request.url = redactTelemetryUrl(event.request.url)
        event.request.data = undefined
        event.request.cookies = undefined
        event.request.headers = undefined
      }
      event.breadcrumbs?.forEach((breadcrumb) => {
        if (breadcrumb.message) breadcrumb.message = scrubTelemetryText(breadcrumb.message)
        if (breadcrumb.data) breadcrumb.data = scrubTelemetryValue(breadcrumb.data) as typeof breadcrumb.data
      })
      if (event.tags) {
        for (const [key, value] of Object.entries(event.tags)) {
          if (typeof value === 'string') event.tags[key] = scrubTelemetryText(value)
        }
      }
      if (event.contexts) event.contexts = scrubTelemetryValue(event.contexts) as typeof event.contexts
      return event
    },
  })
  initialized = true
  return Sentry
}

/** Reports an exception only when configured; telemetry must never change job/API behavior. */
export async function captureEdgeException(
  error: unknown,
  context: EdgeTelemetryContext,
): Promise<void> {
  try {
    const Sentry = await initializeSentry()
    if (!Sentry) return
    Sentry.withScope((scope) => {
      scope.setTag('surface', context.surface ?? 'edge')
      if (SAFE_FUNCTION_NAMES.has(context.functionName)) scope.setTag('function_name', context.functionName)
      if (context.jobName) scope.setTag('job_name', context.jobName)
      if (context.category && SAFE_ERROR_CATEGORIES.has(context.category)) scope.setTag('categoria_falha', context.category)
      const status = safeHttpStatus(context.status)
      if (status) scope.setTag('status', status)
      const operationContext: Record<string, string | number> = {}
      if (context.result) operationContext.result = context.result
      if (Number.isSafeInteger(context.durationMs) && context.durationMs! >= 0) operationContext.duration_ms = context.durationMs!
      if (Number.isSafeInteger(context.processedCount) && context.processedCount! >= 0) {
        operationContext.processed_count = context.processedCount!
      }
      if (Object.keys(operationContext).length) scope.setContext('operation', operationContext)
      // Exception messages from HTTP/database SDKs can echo request values or
      // opaque secrets. Keep the class and function context, not raw text.
      const safeError = new Error('Edge Function execution failed')
      const errorName = error instanceof Error ? error.name : ''
      safeError.name = SAFE_ERROR_NAMES.has(errorName) ? errorName : 'Error'
      Sentry.captureException(safeError)
    })
    await Sentry.flush(1000)
  } catch {
    // Sentry is optional observability: its failure must not affect the caller.
  }
}

/** Emits low-cardinality Sentry application metrics for an already-authorized cron run. */
export function instrumentEdgeJob<T>(
  jobName: EdgeCronJobName,
  countKind: EdgeJobLifecycleEvent['countKind'],
  operation: () => T | Promise<T>,
  summarize: (value: T) => EdgeJobSummary | Promise<EdgeJobSummary>,
  enabled: boolean,
): Promise<T> {
  return instrumentJob(jobName, countKind, operation, summarize, reportJobLifecycle, { enabled })
}

async function reportJobLifecycle(event: EdgeJobLifecycleEvent): Promise<void> {
  try {
    const Sentry = await initializeSentry()
    const metrics = Sentry?.metrics
    if (!metrics) return

    const attributes = { job_name: event.jobName, count_kind: event.countKind }
    if (event.stage === 'started') {
      metrics.count('edge.job.started', 1, { attributes })
      return
    }

    const result = event.result ?? 'failure'
    const outcomeAttributes = {
      ...attributes,
      result,
    }
    metrics.count('edge.job.finished', 1, { attributes: outcomeAttributes })
    if (Number.isSafeInteger(event.durationMs) && event.durationMs! >= 0) {
      metrics.distribution('edge.job.duration_ms', event.durationMs!, {
        unit: 'millisecond',
        attributes: outcomeAttributes,
      })
    }
    if (Number.isSafeInteger(event.processedCount) && event.processedCount! >= 0) {
      metrics.distribution('edge.job.processed_count', event.processedCount!, {
        unit: 'none',
        attributes: outcomeAttributes,
      })
    }
    await Sentry.flush(1000)
  } catch {
    // Metrics are optional observability and never change job behavior.
  }
}

/** Captures thrown failures and 5xx responses without exposing request/response payloads. */
export function instrumentEdgeHandler(
  functionName: string,
  handler: (request: Request) => Response | Promise<Response>,
  shouldReportServerError?: (response: Response) => boolean | Promise<boolean>,
) {
  return instrumentHttpHandler(functionName, handler, captureEdgeException, shouldReportServerError)
}
