// Fonte única da identidade da build.
//
// O SHA vinha sendo lido direto de `import.meta.env` em pontos independentes,
// cada um recortando um tamanho diferente (7 no cabeçalho, 12 no vite.config,
// completo em Métricas). Como o número serve para casar o que o usuário está
// vendo com o que foi publicado, divergência de formato atrapalha o suporte.

export const APP_VERSION = '2.0.0'

const RAW_COMMIT_SHA = String(import.meta.env.VITE_APP_COMMIT_SHA ?? '').trim()

/** SHA completo como injetado no build; string vazia quando indisponível. */
export const APP_COMMIT_SHA = RAW_COMMIT_SHA

/** Recorte exibido na interface. Mesmo tamanho em toda a aplicação. */
export const APP_COMMIT_SHA_SHORT = RAW_COMMIT_SHA ? RAW_COMMIT_SHA.slice(0, 7) : 'unknown'

export const HAS_APP_COMMIT_SHA = RAW_COMMIT_SHA !== ''

/** Rótulo canônico: `2.0.0 (ff4cf37)`. */
export function formatAppVersion(): string {
  return HAS_APP_COMMIT_SHA ? `${APP_VERSION} (${APP_COMMIT_SHA_SHORT})` : APP_VERSION
}

const ENVIRONMENT_LABELS: Record<string, string> = {
  production: 'Produção',
  preview: 'Prévia',
  development: 'Desenvolvimento',
}

/**
 * Ambiente desta build, lido da mesma configuração que o Sentry usa
 * (`VITE_SENTRY_ENVIRONMENT`: `production` no Pages de produção, `preview` no
 * de Preview; sem a variável, produção, como em `resolveSentryEnvironment`).
 * O servidor de desenvolvimento do Vite é sempre "Desenvolvimento".
 */
export function appEnvironmentLabel(env: { DEV?: boolean; VITE_SENTRY_ENVIRONMENT?: unknown } = import.meta.env): string {
  if (env.DEV) return 'Desenvolvimento'
  const configured = typeof env.VITE_SENTRY_ENVIRONMENT === 'string' ? env.VITE_SENTRY_ENVIRONMENT.trim() : ''
  if (!configured) return ENVIRONMENT_LABELS.production
  return ENVIRONMENT_LABELS[configured] ?? 'Outro ambiente'
}
