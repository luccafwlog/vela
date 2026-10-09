import { describe, expect, it } from 'vitest'
import { EMPTY_CUSTOMER_FILTERS, clientesSearchFromFilters, filtersFromClientesSearch } from '../clientesListState'

describe('clientesListState', () => {
  it('lista padrão não suja a URL', () => {
    expect(clientesSearchFromFilters(EMPTY_CUSTOMER_FILTERS)).toBe('')
    expect(filtersFromClientesSearch(new URLSearchParams(''))).toEqual(EMPTY_CUSTOMER_FILTERS)
  })

  it('ida e volta: busca, filtros, ordem e página (1 na URL = 0 no hook)', () => {
    const filters = {
      ...EMPTY_CUSTOMER_FILTERS,
      search: 'Atlântico',
      contactEmail: 'fin@acme.com',
      emailStatus: 'without' as const,
      blStatus: 'with' as const,
      pendingStatus: 'with' as const,
      sortKey: 'pendingBalance' as const,
      sortDirection: 'desc' as const,
      page: 2,
    }
    const search = clientesSearchFromFilters(filters)
    expect(search).toBe('q=Atl%C3%A2ntico&email=fin%40acme.com&emails=sem&bls=com&saldo=com&ordem=saldo&dir=desc&pagina=3')
    expect(filtersFromClientesSearch(new URLSearchParams(search))).toEqual(filters)
  })

  it('valores inválidos na URL caem no padrão em vez de quebrar a lista', () => {
    const filters = filtersFromClientesSearch(new URLSearchParams('emails=talvez&ordem=cor&dir=lado&pagina=-4'))
    expect(filters).toEqual(EMPTY_CUSTOMER_FILTERS)
  })
})
