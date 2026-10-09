// Estado da lista /clientes na URL. Voltar da ficha do Cliente, recarregar ou
// compartilhar o endereço reabre o mesmo recorte (busca, filtros, ordem e página).
import type { CustomerFilters } from '../hooks/useCustomers'
import type { CustomerSortKey, SortDirection } from '../lib/customerTableViewModel'

export const CUSTOMER_PAGE_SIZE = 50

type PresenceFilter = '' | 'with' | 'without'
type PresenceKey = 'emailStatus' | 'blStatus' | 'pendingStatus'

const PRESENCE_PARAMS: Record<PresenceKey, string> = {
  emailStatus: 'emails',
  blStatus: 'bls',
  pendingStatus: 'saldo',
}
const PRESENCE_VALUES: Record<string, PresenceFilter> = { com: 'with', sem: 'without' }
const PRESENCE_PARAM_VALUES: Record<Exclude<PresenceFilter, ''>, string> = { with: 'com', without: 'sem' }
const SORT_KEYS: Record<string, CustomerSortKey> = { nome: 'name', bls: 'bls', saldo: 'pendingBalance' }
const SORT_PARAMS: Record<CustomerSortKey, string> = { name: 'nome', bls: 'bls', pendingBalance: 'saldo' }

export const EMPTY_CUSTOMER_FILTERS: CustomerFilters = {
  search: '',
  contactEmail: '',
  emailStatus: '',
  blStatus: '',
  pendingStatus: '',
  sortKey: 'name',
  sortDirection: 'asc',
  page: 0,
  pageSize: CUSTOMER_PAGE_SIZE,
}

function positiveInt(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function filtersFromClientesSearch(params: URLSearchParams): CustomerFilters {
  const presence = Object.fromEntries(
    (Object.entries(PRESENCE_PARAMS) as [PresenceKey, string][]).map(([key, param]) => [key, PRESENCE_VALUES[params.get(param) ?? ''] ?? '']),
  ) as Record<PresenceKey, PresenceFilter>
  const sortKey = SORT_KEYS[params.get('ordem') ?? ''] ?? 'name'
  const sortDirection: SortDirection = params.get('dir') === 'desc' ? 'desc' : 'asc'
  return {
    ...EMPTY_CUSTOMER_FILTERS,
    ...presence,
    search: params.get('q') ?? '',
    contactEmail: params.get('email') ?? '',
    sortKey,
    sortDirection,
    // A URL conta páginas a partir de 1; o hook, a partir de 0.
    page: (positiveInt(params.get('pagina')) ?? 1) - 1,
  }
}

/** Query string canônica: só o que difere do padrão, em ordem fixa. */
export function clientesSearchFromFilters(filters: CustomerFilters) {
  const params = new URLSearchParams()
  if (filters.search.trim()) params.set('q', filters.search)
  if (filters.contactEmail.trim()) params.set('email', filters.contactEmail)
  for (const [key, param] of Object.entries(PRESENCE_PARAMS) as [PresenceKey, string][]) {
    const value = filters[key]
    if (value) params.set(param, PRESENCE_PARAM_VALUES[value])
  }
  if (filters.sortKey !== 'name') params.set('ordem', SORT_PARAMS[filters.sortKey])
  if (filters.sortDirection === 'desc') params.set('dir', 'desc')
  if (filters.page > 0) params.set('pagina', String(filters.page + 1))
  return params.toString()
}

const LAST_SEARCH_KEY = 'vela.clientes.lastSearch'

/** Guarda o recorte atual para o "Clientes" da ficha voltar a ele. */
export function rememberClientesListSearch(search: string) {
  try {
    window.sessionStorage.setItem(LAST_SEARCH_KEY, search)
  } catch {
    // Sem armazenamento (janela privada): a ficha volta para /clientes sem filtros.
  }
}

export function clientesListHref() {
  try {
    const search = window.sessionStorage.getItem(LAST_SEARCH_KEY)
    return search ? `/clientes?${search}` : '/clientes'
  } catch {
    return '/clientes'
  }
}
