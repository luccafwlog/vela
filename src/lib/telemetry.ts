// Falhas best-effort devem ser observáveis sem interromper o fluxo principal
// (alertas, trilha de auditoria, payload PIX e escritas auxiliares).

import * as Sentry from '@sentry/react'
import {
  redactTelemetryUrl,
  scrubTelemetryText,
  scrubTelemetryValue,
} from './telemetryContract'

// DSNs do Sentry são públicos por design (vão no bundle do cliente); não são
// segredos. Os valores por superfície permitem separar Vela e Portal sem
// quebrar builds existentes que ainda não receberam as novas variáveis.
const LEGACY_SENTRY_DSN = 'https://8fbf8837315ab9f627c2f6e1283bf8d5@o4511542052454400.ingest.us.sentry.io/4511542063464448'

export type TelemetrySurface = 'internal' | 'portal'

export function resolveSentryDsn(surface?: TelemetrySurface): string {
  const configured = surface === 'portal'
    ? import.meta.env.VITE_SENTRY_DSN_PORTAL
    : import.meta.env.VITE_SENTRY_DSN_INTERNAL
  return typeof configured === 'string' && configured.trim() ? configured.trim() : LEGACY_SENTRY_DSN
}

export function resolveSentryEnvironment(): string {
  const configured = import.meta.env.VITE_SENTRY_ENVIRONMENT
  return typeof configured === 'string' && configured.trim() ? configured.trim() : 'production'
}

const STARTUP_MARK = 'td-startup'

/** Records a low-cardinality startup checkpoint without sending route, user,
 * token, or query-string data. The breadcrumb is attached to the next Sentry
 * event, while the PerformanceEntry remains available to browser diagnostics.
 * Fires at most once per stage per page life: callers may run on every
 * refetch or navigation (Painel's query, RoutePreloader's route effect), and
 * this is what stops that from flooding the breadcrumb buffer forever.
 */
export function markStartupStage(stage: 'entry' | 'session' | 'profile' | 'route-chunk' | 'route-data'): void {
  if (typeof performance === 'undefined') return
  const stageMark = `td-startup-${stage}`
  if (performance.getEntriesByName(stageMark, 'mark').length) return
  const now = performance.now()
  if (!performance.getEntriesByName(STARTUP_MARK, 'mark').length) performance.mark(STARTUP_MARK)
  performance.mark(stageMark)
  const elapsed = Number(now.toFixed(1))
  if (import.meta.env.PROD) {
    Sentry.addBreadcrumb({
      category: 'performance.startup',
      message: stage,
      level: 'info',
      data: { elapsed_ms: elapsed },
    })
  }
}

// Redige padroes de PII (CNPJ, CPF, email) em qualquer string do evento.
export function scrubPii(text: string): string {
  return scrubTelemetryText(text)
}

// httpContextIntegration (default do @sentry/browser) grava event.request.url
// = location.href no preprocessEvent, que roda ANTES do beforeSend. Telas do
// Portal recebem token de reset/ativacao na query string; nenhuma query do
// Portal e necessaria para diagnostico, entao a query inteira e removida em
// vez de manter uma lista de nomes sensiveis, que envelhece mal.
export function redactUrlQueryString(url: string): string {
  return redactTelemetryUrl(url)
}

const VERCEL_TELEMETRY_BASE_URL = 'https://telemetry.invalid'
const VERCEL_DYNAMIC_ROUTE_REDACTIONS: Array<[RegExp, string]> = [
  [/^\/clientes\/portal\/inspecao\/[^/]+(?=\/|$)/, '/clientes/portal/inspecao/:customerId'],
  [/^\/clientes\/[^/]+(?=\/|$)/, '/clientes/:cnpj'],
  [/^\/bls\/[^/]+(?=\/|$)/, '/bls/:blId'],
  [/^\/viagens\/[^/]+(?=\/|$)/, '/viagens/:voyageId'],
]

function redactVercelTelemetryPath(path: string): string {
  const match = VERCEL_DYNAMIC_ROUTE_REDACTIONS.find(([pattern]) => pattern.test(path))
  return match ? path.replace(match[0], match[1]) : path
}

/** Vercel Analytics and Speed Insights load /_vercel/* scripts that only the
 * Vercel host serves; on Cloudflare Pages they return the SPA HTML. The flag is
 * fixed at build time from the VERCEL variable in vite.config.ts.
 * ponytail: remove with both packages when Vercel is disconnected (Etapa 10). */
export const vercelTelemetryEnabled = import.meta.env.VITE_HOSTED_ON_VERCEL === 'true'

/** Removes query strings and record identifiers before Vercel telemetry sees
 * application URLs. Analytics and Speed Insights receive the current href by
 * default, while this SPA has CNPJ, B/L, voyage, and customer identifiers in
 * its route segments. */
export function redactVercelTelemetryEvent<T extends { url: string }>(event: T): T {
  try {
    const isRelative = event.url.startsWith('/')
    const url = new URL(event.url, VERCEL_TELEMETRY_BASE_URL)
    url.pathname = redactVercelTelemetryPath(url.pathname)
    url.search = ''
    url.hash = ''
    const route = (event as T & { route?: unknown }).route

    return {
      ...event,
      url: isRelative ? `${url.pathname}` : url.toString(),
      ...(typeof route === 'string' ? { route: redactVercelTelemetryPath(route) } : {}),
    }
  } catch {
    return { ...event, url: redactUrlQueryString(event.url) }
  }
}

// browserApiErrorsIntegration/breadcrumbsIntegration (defaults do
// @sentry/browser) gravam breadcrumb.data.from/to com o href completo
// (path+query) em toda navegacao, incluindo a propria chamada de
// history.replaceState que os componentes de reset/ativacao do Portal usam
// para remover o token da URL -- entao o breadcrumb carrega o token mesmo
// depois da URL limpa. scrubPii nao pega token aleatorio (nao e CNPJ/CPF/
// email), entao a query string inteira de qualquer valor string em
// breadcrumb.data e removida, alem do scrub de PII de costume.
export function scrubBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' ? scrubPii(redactUrlQueryString(value)) : value,
    ]),
  )
}

export function scrubEventValue(value: unknown, depth = 0): unknown {
  return scrubTelemetryValue(value, depth)
}

// Inicializa o relatório de erros em produção. Os default integrations do
// @sentry/react já capturam window.onerror e onunhandledrejection; o release
// usa o commit injetado no build (VITE_APP_COMMIT_SHA) para rastrear regressões.
export function initTelemetry(surface?: TelemetrySurface): void {
  if (!import.meta.env.PROD) return
  Sentry.init({
    dsn: resolveSentryDsn(surface),
    environment: resolveSentryEnvironment(),
    release: (import.meta.env.VITE_APP_COMMIT_SHA as string | undefined) || undefined,
    // Sem replay/tracing: só captura de erros, mantendo payloads mínimos.
    sendDefaultPii: false,
    // Erros do banco podem ecoar valores de linhas; sendDefaultPii nao cobre
    // conteudo enviado manualmente em message/extra/breadcrumbs.
    beforeSend(event) {
      event.exception?.values?.forEach((value) => {
        if (value.value) value.value = scrubPii(value.value)
      })
      if (event.message) event.message = scrubPii(event.message)
      if (event.extra) event.extra = scrubEventValue(event.extra) as typeof event.extra
      event.breadcrumbs?.forEach((breadcrumb) => {
        if (breadcrumb.message) breadcrumb.message = scrubPii(breadcrumb.message)
        if (breadcrumb.data) breadcrumb.data = scrubBreadcrumbData(breadcrumb.data)
      })
      if (event.request) {
        if (event.request.url) event.request.url = redactUrlQueryString(event.request.url)
        if (event.request.headers?.Referer) event.request.headers.Referer = redactUrlQueryString(event.request.headers.Referer)
      }
      if (event.tags) {
        Object.entries(event.tags).forEach(([key, val]) => {
          if (typeof val === 'string') event.tags![key] = scrubPii(val)
        })
        if (event.tags.modulo && event.tags.tarefa) {
          event.fingerprint = [String(event.tags.modulo), String(event.tags.tarefa)]
        }
      }
      return event
    },
  })
  if (surface) Sentry.setTag('surface', surface)
}

export function setTelemetryUser(user: { id: string; role?: string } | null): void {
  if (!user) {
    Sentry.setUser(null)
    return
  }
  Sentry.setUser({ id: user.id })
  if (user.role) {
    Sentry.setTag('user_role', user.role)
  }
}

export function reportCaughtException(
  error: unknown,
  context?: string,
  extra?: Record<string, unknown>,
  tags?: Record<string, string>,
): void {
  const mergedTags: Record<string, string> = {
    ...(context ? { context } : {}),
    ...(tags ?? {}),
  }
  Sentry.captureException(error, {
    tags: Object.keys(mergedTags).length > 0 ? mergedTags : undefined,
    extra,
  })
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; code?: unknown }
    if (maybe.message != null || maybe.code != null) {
      return { message: maybe.message, code: maybe.code }
    }
  }
  return error
}

export function reportBestEffortFailure(
  context: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  console.warn(`[best-effort] ${context}`, { ...meta, error: normalizeError(error) })
  Sentry.captureException(error, {
    tags: { context, kind: 'best-effort' },
    extra: meta,
  })
}
