import {
  instrumentHttpHandler,
  redactTelemetryUrl,
  scrubTelemetryText,
  scrubTelemetryValue,
  type EdgeTelemetryContext,
} from '../../../src/lib/telemetryContract.ts'
import { applyEdgeTelemetryScope } from './telemetryScope.ts'

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
    // O SDK 11 trocou sendDefaultPii por dataCollection, que coleta tudo por
    // padrão; o mesmo desligamento do navegador (src/lib/telemetry.ts).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
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
      applyEdgeTelemetryScope(scope, context)
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

/** Captures thrown failures and 5xx responses without exposing request/response payloads. */
export function instrumentEdgeHandler(
  functionName: string,
  handler: (request: Request) => Response | Promise<Response>,
) {
  return instrumentHttpHandler(functionName, handler, captureEdgeException)
}
