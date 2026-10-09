// Falhas best-effort devem ser observáveis sem interromper o fluxo principal
// (alertas, trilha de auditoria, payload PIX e escritas auxiliares).

import * as Sentry from '@sentry/react'
import { DatabaseError, classifyDbError, toError } from './errors'
import type { DbErrorKind } from './errors'
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

export function isIgnoredAuthError(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): boolean {
  const orig = hint?.originalException
  const origMessage =
    orig instanceof Error
      ? orig.message
      : orig && typeof orig === 'object'
        ? String((orig as { message?: unknown; error_description?: unknown }).message ?? (orig as { error_description?: unknown }).error_description ?? '')
        : typeof orig === 'string'
          ? orig
          : ''

  if (/invalid refresh token/i.test(origMessage) || /invalid_grant/i.test(origMessage)) {
    return true
  }

  const hasMatchingException = event.exception?.values?.some((val) => {
    const text = `${val.type ?? ''} ${val.value ?? ''}`
    return /invalid refresh token/i.test(text) || /invalid_grant/i.test(text)
  })
  if (hasMatchingException) return true

  if (event.message && (/invalid refresh token/i.test(event.message) || /invalid_grant/i.test(event.message))) {
    return true
  }

  return false
}

/** Rótulos curtos e legíveis por humanos para cada categoria de erro de banco.
 * Viram o título da issue no Sentry: `[Sessão expirada] PGRST301`. */
const DB_KIND_LABELS: Record<DbErrorKind, string> = {
  permissao: 'Sem permissão',
  sessao_expirada: 'Sessão expirada',
  conflito: 'Conflito de dados',
  limite: 'Limite excedido',
  validacao: 'Dados inválidos',
  nao_encontrado: 'Não encontrado',
  desconhecido: 'Erro de banco',
}

export type HumanizedDatabaseError = {
  /** Título da issue, ex.: `[Sessão expirada] PGRST301`. */
  title: string
  /** Agrupamento estável por categoria+código, independente do texto. */
  fingerprint: string[]
  /** Seção "database" exibida na página da issue, já sem PII. */
  context: Record<string, string>
}

/**
 * Extrai de um erro de banco (instância `DatabaseError` ou objeto cru do
 * Supabase/PostgREST) um título legível, um fingerprint estável e um
 * contexto estruturado para a issue do Sentry. Retorna null para qualquer
 * outra coisa — nesses casos a normalização padrão do beforeSend se aplica.
 */
export function humanizeDatabaseError(error: unknown): HumanizedDatabaseError | null {
  const instance = error instanceof DatabaseError ? error : null
  const rawCode = !instance && error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  if (!instance && typeof rawCode !== 'string') return null
  const code = instance?.code ?? (typeof rawCode === 'string' ? rawCode : undefined)

  const classified = classifyDbError(error)
  const label = DB_KIND_LABELS[classified.kind]
  const title = code ? `[${label}] ${code}` : `[${label}]`
  // O mesmo código (22023, P0002, 42501) carrega mensagens de negócio
  // diferentes; sem a mensagem, falhas sem relação dividem uma issue (VELA-15).
  // Dígitos viram # para "viagem 38" e "viagem 39" seguirem juntas.
  const fingerprint = ['erro-banco', classified.kind, code ?? 'sem-codigo', fingerprintMessage(classified.message)]

  const rawDetails = instance?.details ?? (error as { details?: unknown } | null)?.details
  const rawHint = instance?.hint ?? (error as { hint?: unknown } | null)?.hint
  const context: Record<string, string> = {
    tipo: label,
    mensagem: scrubPii(classified.message),
  }
  if (code) context.codigo = code
  if (typeof rawDetails === 'string' && rawDetails) context.detalhes = scrubPii(rawDetails)
  if (typeof rawHint === 'string' && rawHint) context.dica = scrubPii(rawHint)
  return { title, fingerprint, context }
}

function fingerprintMessage(message: string): string {
  return scrubPii(message).replace(/\d+/g, '#').slice(0, 120)
}

export function telemetryBeforeSend(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): Sentry.ErrorEvent | null {
  // Ignora erros conhecidos e inócuos de sessão expirada (VELA-5)
  if (isIgnoredAuthError(event, hint)) {
    return null
  }

  // Erros de banco ganham título legível, agrupamento estável e contexto
  // estruturado ("[Sessão expirada] PGRST301") em vez do objeto cru ou do
  // nome minificado ("qi", "Gi"). Demais exceções passam pela normalização
  // padrão abaixo.
  if (event.exception?.values) {
    const rawOrig = hint?.originalException
    const humanized = humanizeDatabaseError(rawOrig)

    event.exception.values.forEach((value, index, values) => {
      if (humanized && index === values.length - 1) {
        value.type = 'DatabaseError'
        value.value = humanized.title
        event.fingerprint = humanized.fingerprint
        event.contexts = { ...event.contexts, database: humanized.context }
      } else {
        const isObscuredType = !value.type || value.type === 'Object' || /^[a-zA-Z]{1,2}$/.test(value.type)
        if (isObscuredType) {
          value.type = rawOrig instanceof Error ? rawOrig.name : 'Error'
        }
        if (value.value) {
          value.value = scrubPii(value.value)
        }
      }
    })
  }

  if (event.message) event.message = scrubPii(event.message)
  if (event.extra) event.extra = scrubEventValue(event.extra) as typeof event.extra
  event.breadcrumbs?.forEach((breadcrumb) => {
    if (breadcrumb.message) breadcrumb.message = scrubPii(breadcrumb.message)
    if (breadcrumb.data) breadcrumb.data = scrubBreadcrumbData(breadcrumb.data)
  })
  if (event.request) {
    // scrubPii também cobre CNPJ no caminho (/clientes/<cnpj>).
    if (event.request.url) event.request.url = scrubPii(redactUrlQueryString(event.request.url))
    if (event.request.headers?.Referer) event.request.headers.Referer = scrubPii(redactUrlQueryString(event.request.headers.Referer))
  }
  if (event.tags) {
    Object.entries(event.tags).forEach(([key, val]) => {
      if (typeof val === 'string') event.tags![key] = scrubPii(val)
    })
    // Módulo e tarefa refinam o agrupamento sem substituí-lo: mutation sem
    // mutationKey cai em "Operações / Operação de dados" e, sozinho, esse par
    // juntava falhas sem relação numa issue só (VELA-15).
    if (event.tags.modulo && event.tags.tarefa) {
      event.fingerprint = [String(event.tags.modulo), String(event.tags.tarefa), ...(event.fingerprint ?? ['{{ default }}'])]
    }
  }
  return event
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
    ignoreErrors: [/invalid refresh token/i, /invalid_grant/i],
    // Sem replay/tracing: só captura de erros, mantendo payloads mínimos.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    // Erros do banco podem ecoar valores de linhas; dataCollection nao cobre
    // conteudo enviado manualmente em message/extra/breadcrumbs.
    beforeSend: telemetryBeforeSend,
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
  const err = toError(error)
  const mergedTags: Record<string, string> = {
    ...(context ? { context } : {}),
    ...(tags ?? {}),
  }
  Sentry.captureException(err, {
    tags: Object.keys(mergedTags).length > 0 ? mergedTags : undefined,
    extra,
  })
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    return { name: error.name, message: error.message, ...(code != null ? { code } : {}) }
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
  Sentry.captureException(toError(error), {
    tags: { context, kind: 'best-effort' },
    extra: meta,
  })
}
