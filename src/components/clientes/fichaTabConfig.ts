export const FICHA_TABS = [
  { id: 'visao-geral', label: 'Visão Geral' },
  { id: 'cadastro', label: 'Cadastro & Contatos' },
  { id: 'operacional', label: 'Operacional' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'historico', label: 'Histórico' },
  { id: 'desbloqueio-ce', label: 'Desbloqueio de CE / VIP' },
] as const
export type FichaTabId = (typeof FICHA_TABS)[number]['id']
export function resolveFichaTab(raw: string | null): FichaTabId { return FICHA_TABS.some((tab) => tab.id === raw) ? raw as FichaTabId : 'visao-geral' }
