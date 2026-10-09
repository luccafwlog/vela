import { describe, expect, it } from 'vitest'
import { faturasFiltersFromSearch, tabFromSearch, withFaturasFilter, withoutFaturasFilters, withTab } from '../faturasListState'

const params = (query: string) => new URLSearchParams(query)

describe('faturasListState', () => {
  it('lê os links antigos de Clientes, B/L e Conciliação', () => {
    const filters = faturasFiltersFromSearch(params('tab=invoices&customer=42&customerName=ACME&bl=BL-1&invoice=9'))
    expect(filters).toMatchObject({ customerId: '42', blSearch: 'BL-1', page: 1, pageSize: 20 })
    expect(tabFromSearch(params('tab=invoices'))).toBe('faturas')
    expect(tabFromSearch(params('tab=pendencias'))).toBe('validacao')
    expect(tabFromSearch(params('invoice=9'))).toBe('faturas')
    expect(tabFromSearch(params('tab=validacao&invoice=9'))).toBe('validacao')
  })

  it('ignora situação, tipo, página e tamanho inválidos', () => {
    expect(faturasFiltersFromSearch(params('situacao=overdue&tipo=x&page=-2&pageSize=33'))).toMatchObject({ status: '', invoiceType: '', page: 1, pageSize: 20 })
    expect(faturasFiltersFromSearch(params('situacao=paid&tipo=manual&page=3&pageSize=50'))).toMatchObject({ status: 'paid', invoiceType: 'manual', page: 3, pageSize: 50 })
  })

  it('mudar um filtro volta à página 1 e preserva aba e fatura aberta', () => {
    const next = withFaturasFilter(params('tab=validacao&invoice=9&page=4&situacao=paid'), 'invoiceType', 'manual')
    expect(next.toString()).toBe('tab=validacao&invoice=9&situacao=paid&tipo=manual')
    expect(withFaturasFilter(params('page=4'), 'page', 1).toString()).toBe('')
    expect(withFaturasFilter(params('customer=42&customerName=ACME'), 'customerId', '').toString()).toBe('')
  })

  it('Limpar filtros remove só o recorte; a aba Faturas não ocupa a URL', () => {
    expect(withoutFaturasFilters(params('invoice=9&customer=1&customerName=A&fatura=F&page=2&pageSize=50')).toString()).toBe('invoice=9')
    expect(withTab(params('tab=pendencias&bl=X'), 'faturas').toString()).toBe('bl=X')
    expect(withTab(params('bl=X'), 'validacao').toString()).toBe('bl=X&tab=validacao')
  })
})
