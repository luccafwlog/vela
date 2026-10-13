import type { ReconciliationFilters } from '../services/reconciliacao'

// Estado de /reconciliacao na URL: aba e filtros do histórico de baixas. O
// Alerta `pix_unreconciled` abre `/reconciliacao` sem parâmetros e cai em
// Pendências, onde o Pix sem baixa está.

export type ReconciliacaoTab = 'pendencias' | 'extrato' | 'historico'

const TABS: readonly ReconciliacaoTab[] = ['pendencias', 'extrato', 'historico']

export function reconciliacaoTabFromSearch(params: URLSearchParams): ReconciliacaoTab {
  const tab = params.get('tab')
  return TABS.includes(tab as ReconciliacaoTab) ? (tab as ReconciliacaoTab) : 'pendencias'
}

export type HistorySortField = 'paidAt' | 'docNumber' | 'customerName' | 'blAmount' | 'totalAmount' | 'blId'

export type HistoryUrlState = Pick<
  ReconciliationFilters,
  'paidFrom' | 'paidTo' | 'source' | 'invoiceTypeFilter' | 'customerId' | 'blSearch' | 'vesselSearch' | 'voyageSearch' | 'pod' | 'page' | 'pageSize'
> & {
  /** Nome exibido no campo de Cliente; o filtro é pelo id. */
  customerName: string
  sort: HistorySortField
  sortDir: 'asc' | 'desc'
}

export const HISTORY_PAGE_SIZES = [20, 50, 100] as const
const DEFAULT_PAGE_SIZE = 50

/** Parâmetro da URL de cada filtro do histórico. */
const PARAM = {
  paidFrom: 'de',
  paidTo: 'ate',
  source: 'origem',
  invoiceTypeFilter: 'tipo',
  customerId: 'cliente',
  customerName: 'clienteNome',
  blSearch: 'bl',
  vesselSearch: 'navio',
  voyageSearch: 'viagem',
  pod: 'pod',
  page: 'pagina',
  pageSize: 'porPagina',
  sort: 'ordem',
  sortDir: 'direcao',
} as const satisfies Record<keyof HistoryUrlState, string>

export type HistoryFilterKey = Exclude<keyof HistoryUrlState, 'page' | 'pageSize' | 'sort' | 'sortDir' | 'customerName'>

/** Filtros que contam como "ativos" na barra (o nome do Cliente vem junto do id). */
export const HISTORY_FILTER_KEYS: readonly HistoryFilterKey[] = [
  'paidFrom', 'paidTo', 'source', 'invoiceTypeFilter', 'customerId', 'blSearch', 'vesselSearch', 'voyageSearch', 'pod',
]

const SORTS: readonly HistorySortField[] = ['paidAt', 'docNumber', 'customerName', 'blAmount', 'totalAmount', 'blId']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function positiveInt(value: string | null): number | null {
  const n = Number(value ?? '')
  return Number.isInteger(n) && n > 0 ? n : null
}

export function historyStateFromSearch(params: URLSearchParams): HistoryUrlState {
  const source = params.get(PARAM.source)
  const type = params.get(PARAM.invoiceTypeFilter)
  const size = positiveInt(params.get(PARAM.pageSize))
  const sort = params.get(PARAM.sort)
  const date = (key: 'paidFrom' | 'paidTo') => {
    const value = params.get(PARAM[key]) ?? ''
    return ISO_DATE.test(value) ? value : ''
  }
  const customerId = positiveInt(params.get(PARAM.customerId))
  return {
    paidFrom: date('paidFrom'),
    paidTo: date('paidTo'),
    source: source === 'local' || source === 'demurrage' ? source : '',
    invoiceTypeFilter: type === 'consolidated' || type === 'single' || type === 'manual' ? type : '',
    customerId: customerId ? String(customerId) : '',
    customerName: customerId ? params.get(PARAM.customerName) ?? '' : '',
    blSearch: params.get(PARAM.blSearch) ?? '',
    vesselSearch: params.get(PARAM.vesselSearch) ?? '',
    voyageSearch: params.get(PARAM.voyageSearch) ?? '',
    pod: params.get(PARAM.pod) ?? '',
    page: positiveInt(params.get(PARAM.page)) ?? 1,
    pageSize: size && (HISTORY_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    sort: SORTS.includes(sort as HistorySortField) ? (sort as HistorySortField) : 'paidAt',
    sortDir: params.get(PARAM.sortDir) === 'asc' ? 'asc' : 'desc',
  }
}

function setOrDelete(params: URLSearchParams, key: string, value: string, isDefault: boolean) {
  if (isDefault || !value.trim()) params.delete(key)
  else params.set(key, value)
}

/**
 * Troca um filtro preservando a aba e os demais; volta à primeira página,
 * porque a página anterior pode não existir no novo recorte. O texto digitado
 * vai como está (o espaço entre palavras não pode sumir a cada tecla).
 */
export function withHistoryFilter(params: URLSearchParams, key: HistoryFilterKey, value: string): URLSearchParams {
  const next = new URLSearchParams(params)
  setOrDelete(next, PARAM[key], value, false)
  if (key === 'customerId' && !value.trim()) next.delete(PARAM.customerName)
  next.delete(PARAM.page)
  return next
}

export function withHistoryCustomer(params: URLSearchParams, customer: { id: string; name: string } | null): URLSearchParams {
  const next = withHistoryFilter(params, 'customerId', customer?.id ?? '')
  if (customer?.id) setOrDelete(next, PARAM.customerName, customer.name, false)
  return next
}

export function withHistoryPage(params: URLSearchParams, page: number): URLSearchParams {
  const next = new URLSearchParams(params)
  setOrDelete(next, PARAM.page, String(page), page <= 1)
  return next
}

export function withHistoryPageSize(params: URLSearchParams, pageSize: number): URLSearchParams {
  const next = new URLSearchParams(params)
  setOrDelete(next, PARAM.pageSize, String(pageSize), pageSize === DEFAULT_PAGE_SIZE)
  next.delete(PARAM.page)
  return next
}

/** Clique no cabeçalho: a mesma coluna alterna; outra coluna começa decrescente. */
export function withHistorySort(params: URLSearchParams, field: HistorySortField): URLSearchParams {
  const current = historyStateFromSearch(params)
  const dir = current.sort === field && current.sortDir === 'desc' ? 'asc' : 'desc'
  const next = new URLSearchParams(params)
  setOrDelete(next, PARAM.sort, field, field === 'paidAt')
  setOrDelete(next, PARAM.sortDir, dir, dir === 'desc')
  next.delete(PARAM.page)
  return next
}

/** "Limpar": tira os filtros e a página, mantém aba, ordenação e tamanho da página. */
export function withoutHistoryFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of HISTORY_FILTER_KEYS) next.delete(PARAM[key])
  next.delete(PARAM.customerName)
  next.delete(PARAM.page)
  return next
}

export function countActiveHistoryFilters(state: HistoryUrlState): number {
  return HISTORY_FILTER_KEYS.filter((key) => String(state[key] ?? '').trim() !== '').length
}

export function withReconciliacaoTab(params: URLSearchParams, tab: ReconciliacaoTab): URLSearchParams {
  const next = new URLSearchParams(params)
  if (tab === 'pendencias') next.delete('tab')
  else next.set('tab', tab)
  return next
}
