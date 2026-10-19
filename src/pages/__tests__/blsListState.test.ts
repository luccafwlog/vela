import { describe, expect, it } from 'vitest'
import { LOCAL_CHARGES_FILTER_OPTIONS, blsSearchFromFilters, filtersFromBlsSearch } from '../blsListState'

describe('estado da lista /bls na URL', () => {
  it('reabre o mesmo recorte a partir da query string', () => {
    const filters = filtersFromBlsSearch(new URLSearchParams('q=COSU&voyage=7&cargoMode=misto&review=pending_review&charge=ready_for_billing&page=3&pageSize=50'))
    expect(filters).toMatchObject({
      search: 'COSU', voyageId: '7', cargoMode: 'misto', reviewStatus: 'pending_review',
      chargeStatus: 'ready_for_billing', page: 3, pageSize: 50,
    })
    expect(filtersFromBlsSearch(new URLSearchParams(blsSearchFromFilters(filters)))).toEqual(filters)
  })

  it('mantém os links antigos (voyage, pol, pod, cargoMode) e omite o padrão', () => {
    const filters = filtersFromBlsSearch(new URLSearchParams('voyage=7&pol=CNTAC&pod=BRVIX'))
    expect(filters).toMatchObject({ voyageId: '7', pol: 'CNTAC', pod: 'BRVIX', cargoMode: '', page: 1, pageSize: 20 })
    expect(blsSearchFromFilters(filters)).toBe('voyage=7&pol=CNTAC&pod=BRVIX')
  })

  it('converte a grafia legada do porto para a opção canônica do select', () => {
    expect(filtersFromBlsSearch(new URLSearchParams('pol=CNZJG&pod=BRVIT'))).toMatchObject({ pol: 'CNZJG', pod: 'BRVIX' })
    expect(filtersFromBlsSearch(new URLSearchParams('pod=XXXXX')).pod).toBe('XXXXX')
  })

  it('ignora modalidade, página e tamanho inválidos em vez de consultar com eles', () => {
    const filters = filtersFromBlsSearch(new URLSearchParams('cargoMode=navio&page=-2&pageSize=33'))
    expect(filters).toMatchObject({ cargoMode: '', page: 1, pageSize: 20 })
  })

  it('oferece no filtro de taxas os três estados da coluna, sem os estados técnicos', () => {
    expect(LOCAL_CHARGES_FILTER_OPTIONS.map((option) => option.label)).toEqual(['Pendente', 'Emitida', 'Isenta'])
  })
})
