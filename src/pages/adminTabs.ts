// Abas da Administração. Vivem fora do componente porque a rota (`/admin/:tab`)
// e os testes precisam do catálogo sem arrastar a página inteira — e porque o
// eslint de fast-refresh exige que um arquivo de componente só exporte componentes.

export const ADMIN_TABS = [
  { slug: 'usuarios', label: 'Usuários' },
  { slug: 'falhas-de-alertas', label: 'Falhas de entrega de alertas' },
  { slug: 'historico', label: 'Histórico de ações' },
  { slug: 'sistema', label: 'Sistema' },
  { slug: 'prazo-do-adr', label: 'Prazo do ADR' },
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
