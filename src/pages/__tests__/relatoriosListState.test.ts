import { describe, expect, it } from 'vitest'
import {
  calendarDateParam,
  customerNameFromSearch,
  demurrageFiltersFromSearch,
  financialFiltersFromSearch,
  operationalFiltersFromSearch,
  positiveIdParam,
} from '../relatoriosListState'

const search = (query: string) => new URLSearchParams(query)

// Achado 5: o endereço é digitável; valor fora do formato não chega ao banco
// nem aparece como filtro aplicado.
describe('valores do endereço em /relatorios', () => {
  it('data só vale se existe no calendário', () => {
    expect(calendarDateParam('2026-02-28')).toBe('2026-02-28')
    expect(calendarDateParam('2028-02-29')).toBe('2028-02-29')
    expect(calendarDateParam('2026-02-30')).toBe('')
    expect(calendarDateParam('2026-13-01')).toBe('')
    expect(calendarDateParam('2026-2-1')).toBe('')
    expect(calendarDateParam('2026-05-01T00:00')).toBe('')
    expect(calendarDateParam(null)).toBe('')
  })

  it('id só vale como inteiro positivo', () => {
    expect(positiveIdParam('7')).toBe('7')
    expect(positiveIdParam('0')).toBe('')
    expect(positiveIdParam('-3')).toBe('')
    expect(positiveIdParam('1.5')).toBe('')
    expect(positiveIdParam('1e3')).toBe('')
    expect(positiveIdParam('007')).toBe('')
    expect(positiveIdParam('abc')).toBe('')
  })

  it('?de=2026-02-30 e ids inválidos saem do recorte', () => {
    const filters = financialFiltersFromSearch(search('de=2026-02-30&ate=2026-03-31&viagem=abc&cliente=0'))
    expect(filters).toMatchObject({ dateFrom: '', dateTo: '2026-03-31', voyageId: '', customerId: '' })
  })

  it('o nome do Cliente só aparece com um Cliente válido', () => {
    expect(customerNameFromSearch(search('cliente=7&clienteNome=ACME'))).toBe('ACME')
    expect(customerNameFromSearch(search('cliente=x&clienteNome=ACME'))).toBe('')
  })

  it('POL e POD só com forma de código de porto', () => {
    expect(operationalFiltersFromSearch(search('pol=BRVIX&pod=SSZ'))).toMatchObject({ pol: 'BRVIX', pod: 'SSZ' })
    expect(operationalFiltersFromSearch(search('pol=BR,VIX&pod=a)b'))).toMatchObject({ pol: '', pod: '' })
  })

  it('Demurrage: data inválida conta como não escolhida e volta ao padrão do ano', () => {
    const now = new Date('2026-10-19T15:00:00Z')
    expect(demurrageFiltersFromSearch(search('de=2026-02-30'), now)).toMatchObject({ dateFrom: '2026-01-01', dateTo: '2026-10-19' })
    // Datas apagadas continuam valendo "sem limite".
    expect(demurrageFiltersFromSearch(search('de=&ate='), now)).toMatchObject({ dateFrom: '', dateTo: '' })
    expect(demurrageFiltersFromSearch(search('de=2026-03-01'), now)).toMatchObject({ dateFrom: '2026-03-01', dateTo: '' })
  })
})
