// Abas da Administração. Vivem fora do componente porque a rota (`/admin/:tab`)
// e os testes precisam do catálogo sem arrastar a página inteira — e porque o
// eslint de fast-refresh exige que um arquivo de componente só exporte componentes.

/**
 * Decisões do dono de 2026-11-06 (docs/archive/plans/2026-11-06-administracao-revisada.md):
 * a Administração tem Usuários, Histórico de ações e Sistema. `devOnly`: só a
 * conta Dev (Administrativo com a marca Dev, ADR 0104) vê e abre a aba; as
 * leituras de Sistema são recusadas no banco aos demais (`is_dev_user()`,
 * migration 605). As Falhas de entrega de alertas moram dentro de Sistema, e o
 * Prazo do ADR mora em Relatórios.
 */
export const ADMIN_TABS = [
  { slug: 'usuarios', label: 'Usuários', devOnly: false },
  { slug: 'historico', label: 'Histórico de ações', devOnly: false },
  { slug: 'sistema', label: 'Sistema', devOnly: true },
] as const

export type AdminTab = (typeof ADMIN_TABS)[number]['slug']

export const DEFAULT_ADMIN_TAB: AdminTab = 'usuarios'

/**
 * Endereços antigos das abas: os de antes do lote 5b da identidade visual
 * (2026-10-19) e as abas que mudaram de casa em 2026-11-06 (Falhas de entrega
 * de alertas, dentro de Sistema; Prazo do ADR, em Relatórios). Continuam
 * abrindo o lugar certo, redirecionados para o endereço novo.
 */
export const LEGACY_ADMIN_PATHS: Readonly<Record<string, string>> = {
  falhas: '/admin/sistema',
  'falhas-de-alertas': '/admin/sistema',
  logs: '/admin/historico',
  metricas: '/admin/sistema',
  'prazo-adr': '/relatorios?visao=prazo-do-adr',
  'prazo-do-adr': '/relatorios?visao=prazo-do-adr',
}

export function isAdminTab(value: string | undefined): value is AdminTab {
  return ADMIN_TABS.some((entry) => entry.slug === value)
}

/** Endereço novo de um endereço antigo de aba, ou `null` quando não é endereço antigo. */
export function legacyAdminPath(value: string | undefined): string | null {
  return value !== undefined && Object.hasOwn(LEGACY_ADMIN_PATHS, value) ? LEGACY_ADMIN_PATHS[value] : null
}

/** A aba é só da conta Dev. */
export function isDevOnlyAdminTab(tab: AdminTab): boolean {
  return ADMIN_TABS.some((entry) => entry.slug === tab && entry.devOnly)
}

/** As abas que a pessoa vê: todas para a conta Dev; sem as da conta Dev para os demais. */
export function visibleAdminTabs(isDev: boolean) {
  return ADMIN_TABS.filter((entry) => isDev || !entry.devOnly)
}
