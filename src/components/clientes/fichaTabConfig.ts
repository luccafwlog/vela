export const FICHA_TABS = [
  { id: 'visao-geral', label: 'Visão geral' },
  { id: 'cadastro', label: 'Cadastro e contatos' },
  { id: 'bls', label: 'BLs' },
  { id: 'conteineres', label: 'Contêineres' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'historico', label: 'Histórico' },
  { id: 'desbloqueio-ce', label: 'Desbloqueio de CE e VIP' },
] as const
export type FichaTabId = (typeof FICHA_TABS)[number]['id']

/** Abas que o perfil pode abrir: CE/VIP exige leitura do Desbloqueio de CE. */
export function availableFichaTabs(canReadCeUnlock: boolean) {
  return FICHA_TABS.filter((tab) => tab.id !== 'desbloqueio-ce' || canReadCeUnlock)
}

// A aba "Operacional" virou "BLs" (lote 1 da identidade, 2026-10-14); links antigos continuam abrindo.
const LEGACY_TABS: Record<string, FichaTabId> = { operacional: 'bls' }

export function resolveFichaTab(raw: string | null, canReadCeUnlock = true): FichaTabId {
  const id = raw ? LEGACY_TABS[raw] ?? raw : raw
  return availableFichaTabs(canReadCeUnlock).some((tab) => tab.id === id) ? id as FichaTabId : 'visao-geral'
}
