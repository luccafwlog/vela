// Estado de /taxas-locais na URL: aba, recorte da lista de faturas e fatura
// aberta. Voltar da ficha do B/L, recarregar ou compartilhar o endereço reabre
// o mesmo recorte. Os links antigos (`tab=invoices`, `tab=pendencias`,
// `customer`, `customerName`, `bl`, `invoice`) continuam valendo.
import type { Filters } from '../components/billing/invoiceFilters'

export type TaxasLocaisTab = 'faturas' | 'validacao'

const PAGE_SIZES = [20, 50, 100] as const
const STATUSES = new Set(['issued', 'paid', 'cancelled'])
const TYPES = new Set(['single', 'consolidated', 'manual'])

type TextKey = Exclude<keyof Filters, 'page' | 'pageSize' | 'status' | 'invoiceType'>

/** Parâmetro de cada filtro de texto; `customer` e `bl` já eram usados por outras telas. */
export const FATURAS_TEXT_PARAMS: Record<TextKey, string> = {
  blSearch: 'bl',
  search: 'fatura',
  customerId: 'customer',
  voyageSearch: 'viagem',
  pod: 'pod',
  dateFrom: 'emissaoDe',
  dateTo: 'emissaoAte',
  paidFrom: 'pagamentoDe',
  paidTo: 'pagamentoAte',
}

/** Parâmetros que pertencem ao recorte da lista (Limpar filtros remove todos). */
export const FATURAS_FILTER_PARAMS = [...Object.values(FATURAS_TEXT_PARAMS), 'customerName', 'situacao', 'tipo', 'page', 'pageSize']

function positiveInt(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function tabFromSearch(params: URLSearchParams): TaxasLocaisTab {
  const tab = params.get('tab')
  if (params.get('invoice')) return 'faturas'
  return tab === 'validacao' || tab === 'pendencias' ? 'validacao' : 'faturas'
}

export function faturasFiltersFromSearch(params: URLSearchParams): Filters {
  const text = Object.fromEntries(
    (Object.entries(FATURAS_TEXT_PARAMS) as [TextKey, string][]).map(([key, param]) => [key, params.get(param) ?? '']),
  ) as Record<TextKey, string>
  const status = params.get('situacao') ?? ''
  const invoiceType = params.get('tipo') ?? ''
  const pageSize = positiveInt(params.get('pageSize'))
  return {
    ...text,
    status: STATUSES.has(status) ? (status as Filters['status']) : '',
    invoiceType: TYPES.has(invoiceType) ? (invoiceType as Filters['invoiceType']) : '',
    page: positiveInt(params.get('page')) ?? 1,
    pageSize: pageSize && (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : PAGE_SIZES[0],
  }
}

/**
 * Aplica uma mudança de filtro sobre a URL atual, preservando aba, fatura
 * aberta e outros parâmetros. Qualquer filtro novo volta para a página 1.
 */
export function withFaturasFilter<K extends keyof Filters>(params: URLSearchParams, key: K, value: Filters[K]): URLSearchParams {
  const next = new URLSearchParams(params)
  const param = key === 'status' ? 'situacao' : key === 'invoiceType' ? 'tipo' : key === 'page' || key === 'pageSize' ? key : FATURAS_TEXT_PARAMS[key as TextKey]
  const text = String(value ?? '').trim()
  const isDefault = !text || (key === 'page' && Number(value) === 1) || (key === 'pageSize' && Number(value) === PAGE_SIZES[0])
  if (isDefault) next.delete(param)
  else next.set(param, text)
  if (key === 'customerId' && !text) next.delete('customerName')
  if (key !== 'page') next.delete('page')
  return next
}

export function withoutFaturasFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const param of FATURAS_FILTER_PARAMS) next.delete(param)
  return next
}

export function withTab(params: URLSearchParams, tab: TaxasLocaisTab): URLSearchParams {
  const next = new URLSearchParams(params)
  if (tab === 'validacao') next.set('tab', 'validacao')
  else next.delete('tab')
  return next
}
