import { describe, expect, it } from 'vitest'
import { demurrageInvoiceHref, demurrageStateFromSearch, withDemurrageParam, withDemurrageTab } from '../demurrageListState'

describe('estado de /demurrage na URL', () => {
  it('padrão limpo e valores inválidos', () => {
    expect(demurrageStateFromSearch(new URLSearchParams(''))).toEqual({ tab: 'containers', search: '', division: 'correndo', invoiceId: null, disputeId: null })
    expect(demurrageStateFromSearch(new URLSearchParams('tab=xyz&divisao=abc&fatura=-1'))).toMatchObject({ tab: 'containers', division: 'correndo', invoiceId: null })
  })

  it('divisão da aba Containers na URL; o link antigo ?lente=atraso abre Correndo (ADR 0112, D1)', () => {
    expect(demurrageStateFromSearch(new URLSearchParams('divisao=travado'))).toMatchObject({ division: 'travado' })
    expect(demurrageStateFromSearch(new URLSearchParams('lente=atraso'))).toMatchObject({ division: 'correndo' })
    expect(withDemurrageParam(new URLSearchParams('lente=atraso'), 'divisao', 'a_emitir').toString()).toBe('divisao=a_emitir')
    expect(withDemurrageParam(new URLSearchParams('divisao=a_emitir'), 'divisao', 'correndo').toString()).toBe('')
  })

  it('aba Faturas, Invoice aberta e Disputa do alerta', () => {
    expect(demurrageStateFromSearch(new URLSearchParams('tab=faturas&fatura=21&busca=ACME'))).toMatchObject({ tab: 'emitidas', invoiceId: 21, search: 'ACME' })
    expect(demurrageStateFromSearch(new URLSearchParams('dispute=5'))).toMatchObject({ tab: 'disputas', disputeId: 5 })
  })

  it('trocar de aba limpa o que só vale para a outra e preserva a busca', () => {
    const params = new URLSearchParams('divisao=travado&busca=BL1&dispute=5')
    expect(withDemurrageTab(params, 'pagas').toString()).toBe('busca=BL1&tab=pagas')
    expect(withDemurrageTab(new URLSearchParams('tab=pagas'), 'containers').toString()).toBe('')
  })

  it('a busca guarda o espaço digitado entre as palavras', () => {
    let params = new URLSearchParams('')
    for (const key of 'ACME LTDA') {
      params = withDemurrageParam(params, 'busca', (params.get('busca') ?? '') + key)
    }
    expect(demurrageStateFromSearch(params).search).toBe('ACME LTDA')
    expect(withDemurrageParam(params, 'busca', '   ').has('busca')).toBe(false)
  })

  it('link direto da Invoice', () => {
    expect(demurrageInvoiceHref(77)).toBe('/demurrage?fatura=77')
  })
})
