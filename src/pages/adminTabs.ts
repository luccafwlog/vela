// Abas da Administração. Vivem fora do componente porque a rota (`/admin/:tab`)
// e os testes precisam do catálogo sem arrastar a página inteira — e porque o
// eslint de fast-refresh exige que um arquivo de componente só exporte componentes.

/**
 * `devOnly`: só a conta Dev (Administrativo com a marca Dev, ADR 0104) vê e
 * abre a aba. Decisão do dono de 2026-11-06: Sistema é da conta Dev, e as
 * Falhas de entrega de alertas vão morar dentro dela
 * (docs/plans/2026-11-06-administracao-revisada.md). Os demais do
 * Administrativo veem Usuários, Histórico de ações e, até ir para Relatórios,
 * Prazo do ADR. É controle de navegação: o que a aba Sistema ganhar de
 * leitura ou escrita sensível tem de ser barrado no banco (`is_dev_user()`).
 */
export const ADMIN_TABS = [
  { slug: 'usuarios', label: 'Usuários', devOnly: false },
  { slug: 'falhas-de-alertas', label: 'Falhas de entrega de alertas', devOnly: true },
  { slug: 'historico', label: 'Histórico de ações', devOnly: false },
  { slug: 'sistema', label: 'Sistema', devOnly: true },
  { slug: 'prazo-do-adr', label: 'Prazo do ADR', devOnly: false },
] as const

export type AdminTab = (typeof ADMIN_TABS)[number]['slug']

export const DEFAULT_ADMIN_TAB: AdminTab = 'usuarios'

/**
 * Endereços das abas antes do lote 5b da identidade visual (2026-10-19):
 * continuam abrindo a aba certa, redirecionados para o endereço novo.
 */
export const LEGACY_ADMIN_TABS: Readonly<Record<string, AdminTab>> = {
  falhas: 'falhas-de-alertas',
  logs: 'historico',
  metricas: 'sistema',
  'prazo-adr': 'prazo-do-adr',
}

export function isAdminTab(value: string | undefined): value is AdminTab {
  return ADMIN_TABS.some((entry) => entry.slug === value)
}

/** Aba nova de um endereço antigo, ou `null` quando não é endereço antigo. */
export function legacyAdminTab(value: string | undefined): AdminTab | null {
  return value !== undefined && Object.hasOwn(LEGACY_ADMIN_TABS, value) ? LEGACY_ADMIN_TABS[value] : null
}

/** A aba é só da conta Dev. */
export function isDevOnlyAdminTab(tab: AdminTab): boolean {
  return ADMIN_TABS.some((entry) => entry.slug === tab && entry.devOnly)
}

/** As abas que a pessoa vê: todas para a conta Dev; sem as da conta Dev para os demais. */
export function visibleAdminTabs(isDev: boolean) {
  return ADMIN_TABS.filter((entry) => isDev || !entry.devOnly)
}
