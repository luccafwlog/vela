// Estado da lista /containers na URL e regras de apresentação da linha.
// Voltar do B/L, recarregar ou compartilhar o endereço reabre o mesmo recorte.
import type { ContainerFilters } from '../hooks/useBls'
import { PAGE_SIZES } from '../hooks/usePageFilters'

type TextFilterKey = Exclude<keyof ContainerFilters, 'page' | 'pageSize' | 'cargoMode' | 'vehicleContainer'>

// `voyage`, `pod` e `vehicle_container` já são usados por links do Line-Up e
// da Viagem; `search` continua aceito na leitura para links antigos.
const TEXT_PARAMS: Record<TextFilterKey, string> = {
  search: 'q',
  voyageId: 'voyage',
  pol: 'pol',
  pod: 'pod',
  reviewStatus: 'review',
  financialStatus: 'financial',
  chargeStatus: 'charge',
  cargoProfile: 'profile',
  containerType: 'type',
}

const VEHICLE_VALUES = new Set(['true', 'false'])
const DEFAULT_PAGE_SIZE = PAGE_SIZES[0]

export const CONTAINER_TEXT_FILTER_KEYS = [...Object.keys(TEXT_PARAMS), 'vehicleContainer'] as (keyof ContainerFilters)[]

function positiveInt(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function filtersFromContainersSearch(params: URLSearchParams): ContainerFilters {
  const text = Object.fromEntries(
    (Object.entries(TEXT_PARAMS) as [TextFilterKey, string][]).map(([key, param]) => [key, params.get(param) ?? '']),
  ) as Record<TextFilterKey, string>
  if (!text.search) text.search = params.get('search') ?? ''
  const vehicleContainer = params.get('vehicle_container') ?? ''
  const pageSize = positiveInt(params.get('pageSize'))
  return {
    ...text,
    cargoMode: '',
    vehicleContainer: VEHICLE_VALUES.has(vehicleContainer) ? (vehicleContainer as ContainerFilters['vehicleContainer']) : '',
    page: positiveInt(params.get('page')) ?? 1,
    pageSize: pageSize && (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  }
}

/** Query string canônica: só o que difere do padrão, em ordem fixa. */
export function containersSearchFromFilters(filters: ContainerFilters) {
  const params = new URLSearchParams()
  for (const [key, param] of Object.entries(TEXT_PARAMS) as [TextFilterKey, string][]) {
    const value = String(filters[key] ?? '').trim() ? String(filters[key]) : ''
    if (value) params.set(param, value)
  }
  if (filters.vehicleContainer) params.set('vehicle_container', filters.vehicleContainer)
  if (filters.page > 1) params.set('page', String(filters.page))
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(filters.pageSize))
  return params.toString()
}

export function countActiveContainerFilters(filters: ContainerFilters) {
  return CONTAINER_TEXT_FILTER_KEYS.filter((key) => String(filters[key] ?? '').trim() !== '').length
}

/** De onde veio o SOC/COC que vale (B/L soberano; Baplie só preenche; correção auditada). */
export function ownershipSourceLabel(source: string | null | undefined, ownership: string | null | undefined) {
  if (!ownership) return null
  if (source === 'manual') return 'Correção manual'
  if (source === 'baplie') return 'Pelo Baplie'
  if (source === 'bl') return 'Pelo B/L'
  return null
}

/**
 * Devolução do container como texto: SOC não volta ao estoque (CONTEXT.md,
 * SOC/COC), então "—" ali seria lido como pendência que não existe.
 */
export function describeReturn(returnDate: string | null | undefined, ownership: string | null | undefined, format: (value: string) => string) {
  if (returnDate) return { text: format(returnDate), muted: false }
  if (ownership === 'SOC') return { text: 'Não se aplica (SOC)', muted: true }
  return { text: '—', muted: true, srText: 'Sem devolução registrada' }
}
