export const FICHA_TABS = [
  { id: 'visao-geral', label: 'Visão geral' },
  { id: 'cadastro', label: 'Cadastro e contatos' },
  { id: 'operacional', label: 'Operacional' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'historico', label: 'Histórico' },
  { id: 'desbloqueio-ce', label: 'Desbloqueio de CE e VIP' },
] as const
export type FichaTabId = (typeof FICHA_TABS)[number]['id']

/** Abas que o perfil pode abrir: CE/VIP exige leitura do Desbloqueio de CE. */
export function availableFichaTabs(canReadCeUnlock: boolean) {
  return FICHA_TABS.filter((tab) => tab.id !== 'desbloqueio-ce' || canReadCeUnlock)
}

export function resolveFichaTab(raw: string | null, canReadCeUnlock = true): FichaTabId {
  return availableFichaTabs(canReadCeUnlock).some((tab) => tab.id === raw) ? raw as FichaTabId : 'visao-geral'
}
