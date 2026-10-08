// Estado da lista /bls na URL. Voltar da ficha do B/L, recarregar ou
// compartilhar o endereço reabre o mesmo recorte (filtros, lente e página).
import type { BlFilters } from '../hooks/useBls'
import { PAGE_SIZES } from '../hooks/usePageFilters'
import { resolveChargeStatusLabel } from './blDetalheHelpers'

type TextFilterKey = Exclude<keyof BlFilters, 'page' | 'pageSize' | 'cargoMode'>

// Chaves curtas e estáveis: `voyage`, `pol`, `pod` e `cargoMode` já eram lidas
// por links de outras telas (Viagem, Painel) e continuam valendo.
const TEXT_PARAMS: Record<TextFilterKey, string> = {
  search: 'q',
  voyageId: 'voyage',
  pol: 'pol',
  pod: 'pod',
  reviewStatus: 'review',
  financialStatus: 'financial',
  chargeStatus: 'charge',
  cargoProfile: 'profile',
}

const CARGO_MODES = new Set(['container', 'carga_solta', 'misto'])
const DEFAULT_PAGE_SIZE = PAGE_SIZES[0]

export const CHARGE_STATUS_FILTER_OPTIONS = (
  ['not_calculated', 'calculated', 'review_required', 'reviewed', 'ready_for_billing', 'exempt'] as const
).map((value) => ({ value, label: resolveChargeStatusLabel(value) }))

function positiveInt(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function filtersFromBlsSearch(params: URLSearchParams): BlFilters {
  const text = Object.fromEntries(
    (Object.entries(TEXT_PARAMS) as [TextFilterKey, string][]).map(([key, param]) => [key, params.get(param) ?? '']),
  ) as Record<TextFilterKey, string>
  const cargoMode = params.get('cargoMode') ?? ''
  const pageSize = positiveInt(params.get('pageSize'))
  return {
    ...text,
    cargoMode: CARGO_MODES.has(cargoMode) ? (cargoMode as BlFilters['cargoMode']) : '',
    page: positiveInt(params.get('page')) ?? 1,
    pageSize: pageSize && (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  }
}

/** Query string canônica: só o que difere do padrão, em ordem fixa. */
export function blsSearchFromFilters(filters: BlFilters) {
  const params = new URLSearchParams()
  for (const [key, param] of Object.entries(TEXT_PARAMS) as [TextFilterKey, string][]) {
    const value = String(filters[key] ?? '').trim() ? String(filters[key]) : ''
    if (value) params.set(param, value)
  }
  if (filters.cargoMode) params.set('cargoMode', filters.cargoMode)
  if (filters.page > 1) params.set('page', String(filters.page))
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(filters.pageSize))
  return params.toString()
}

const LAST_SEARCH_KEY = 'vela.bls.lastSearch'

/** Guarda o recorte atual para o "BLs" da ficha voltar a ele. */
export function rememberBlsListSearch(search: string) {
  try {
    window.sessionStorage.setItem(LAST_SEARCH_KEY, search)
  } catch {
    // Sem armazenamento (janela privada): a ficha volta para /bls sem filtros.
  }
}

export function blsListHref() {
  try {
    const search = window.sessionStorage.getItem(LAST_SEARCH_KEY)
    return search ? `/bls?${search}` : '/bls'
  } catch {
    return '/bls'
  }
}
