import { describe, expect, it } from 'vitest'
import { demurrageInvoiceHref, demurrageStateFromSearch, withDemurrageParam, withDemurrageTab } from '../demurrageListState'

describe('estado de /demurrage na URL', () => {
  it('padrão limpo e valores inválidos', () => {
    expect(demurrageStateFromSearch(new URLSearchParams(''))).toEqual({ tab: 'containers', search: '', lens: 'todos', invoiceId: null, disputeId: null })
    expect(demurrageStateFromSearch(new URLSearchParams('tab=xyz&lente=abc&fatura=-1'))).toMatchObject({ tab: 'containers', lens: 'todos', invoiceId: null })
  })

  it('aba Faturas, Invoice aberta e Disputa do alerta', () => {
    expect(demurrageStateFromSearch(new URLSearchParams('tab=faturas&fatura=21&busca=ACME'))).toMatchObject({ tab: 'emitidas', invoiceId: 21, search: 'ACME' })
    expect(demurrageStateFromSearch(new URLSearchParams('dispute=5'))).toMatchObject({ tab: 'disputas', disputeId: 5 })
  })

  it('trocar de aba limpa o que só vale para a outra e preserva a busca', () => {
    const params = new URLSearchParams('lente=atraso&busca=BL1&dispute=5')
    expect(withDemurrageTab(params, 'pagas').toString()).toBe('busca=BL1&tab=pagas')
    expect(withDemurrageTab(new URLSearchParams('tab=pagas'), 'containers').toString()).toBe('')
    expect(withDemurrageParam(new URLSearchParams('lente=atraso'), 'lente', 'todos').toString()).toBe('')
  })

  it('a busca guarda o espaço digitado entre as palavras', () => {
    let params = new URLSearchParams('')
    let typed = ''
    for (const key of 'ACME LTDA') {
      typed = (params.get('busca') ?? '') + key
      params = withDemurrageParam(params, 'busca', typed)
    }
    expect(demurrageStateFromSearch(params).search).toBe('ACME LTDA')
    expect(withDemurrageParam(params, 'busca', '   ').has('busca')).toBe(false)
  })

  it('link direto da Invoice', () => {
    expect(demurrageInvoiceHref(77)).toBe('/demurrage?fatura=77')
  })
})
