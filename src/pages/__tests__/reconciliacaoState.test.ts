import { describe, expect, it } from 'vitest'
import {
  countActiveHistoryFilters,
  countActiveReceivedFilters,
  receivedStateFromSearch,
  withReceivedFilter,
  withReceivedPage,
  withoutReceivedFilters,
  historyStateFromSearch,
  reconciliacaoTabFromSearch,
  withHistoryCustomer,
  withHistoryFilter,
  withHistoryPage,
  withHistoryPageSize,
  withHistorySort,
  withReconciliacaoTab,
  withoutHistoryFilters,
} from '../reconciliacaoState'

const params = (search: string) => new URLSearchParams(search)

describe('estado de /reconciliacao na URL', () => {
  it('abre no Histórico de baixas; Pendências só com tab=pendencias (destino dos Alertas de Pix)', () => {
    expect(reconciliacaoTabFromSearch(params(''))).toBe('historico')
    expect(reconciliacaoTabFromSearch(params('tab=xyz'))).toBe('historico')
    expect(reconciliacaoTabFromSearch(params('tab=pendencias'))).toBe('pendencias')
    expect(withReconciliacaoTab(params('tab=pendencias&bl=X'), 'historico').toString()).toBe('bl=X')
    expect(withReconciliacaoTab(params('bl=X'), 'pendencias').toString()).toBe('bl=X&tab=pendencias')
  })

  it('descarta valores inválidos em vez de filtrar por eles', () => {
    const state = historyStateFromSearch(params('de=10/10/2026&origem=pix&tipo=granite&cliente=abc&clienteNome=X&pagina=-2&porPagina=7&ordem=drop&direcao=up'))
    expect(state).toEqual(expect.objectContaining({
      paidFrom: '', source: '', invoiceTypeFilter: '', customerId: '', customerName: '', page: 1, pageSize: 50, sort: 'paidAt', sortDir: 'desc',
    }))
    expect(countActiveHistoryFilters(state)).toBe(0)
  })

  it('Tipo de fatura não vale com a Origem Demurrage, nem vindo de link', () => {
    expect(historyStateFromSearch(params('origem=demurrage&tipo=manual')).invoiceTypeFilter).toBe('')
    expect(historyStateFromSearch(params('origem=local&tipo=manual')).invoiceTypeFilter).toBe('manual')
    expect(withHistoryFilter(params('tipo=manual'), 'source', 'demurrage').toString()).toBe('origem=demurrage')
    expect(withHistoryFilter(params('tipo=manual'), 'source', 'local').toString()).toBe('tipo=manual&origem=local')
  })

  it('filtro novo volta à primeira página e preserva aba e texto com espaço', () => {
    const next = withHistoryFilter(params('tab=historico&pagina=3'), 'vesselSearch', 'XIN PU ')
    expect(next.get('pagina')).toBeNull()
    expect(next.get('tab')).toBe('historico')
    expect(historyStateFromSearch(next).vesselSearch).toBe('XIN PU ')
  })

  it('Cliente leva id e nome; limpar tira os dois', () => {
    const chosen = withHistoryCustomer(params('tab=historico'), { id: '7', name: 'ACME LTDA' })
    expect(historyStateFromSearch(chosen)).toEqual(expect.objectContaining({ customerId: '7', customerName: 'ACME LTDA' }))
    const cleared = withHistoryCustomer(chosen, null)
    expect(cleared.has('cliente') || cleared.has('clienteNome')).toBe(false)
  })

  it('ordenação alterna na mesma coluna e a padrão sai da URL', () => {
    let p = withHistorySort(params(''), 'blAmount')
    expect(p.toString()).toBe('ordem=blAmount')
    p = withHistorySort(p, 'blAmount')
    expect(historyStateFromSearch(p)).toEqual(expect.objectContaining({ sort: 'blAmount', sortDir: 'asc' }))
    expect(withHistorySort(params(''), 'paidAt').toString()).toBe('direcao=asc')
    expect(withHistorySort(params('direcao=asc'), 'paidAt').toString()).toBe('')
  })

  it('Limpar tira filtros e página, mantém aba, ordem e tamanho', () => {
    const next = withoutHistoryFilters(params('tab=historico&bl=X&cliente=7&clienteNome=A&pagina=2&ordem=blId&porPagina=100'))
    expect(next.toString()).toBe('tab=historico&ordem=blId&porPagina=100')
    expect(withHistoryPageSize(params('pagina=4'), 50).toString()).toBe('')
    expect(withHistoryPage(params(''), 2).toString()).toBe('pagina=2')
    expect(withHistoryPage(params('pagina=2'), 1).toString()).toBe('')
  })

  it('aba Pix recebidos: filtros com prefixo próprio, sem colidir com os do histórico (ADR 0100)', () => {
    expect(reconciliacaoTabFromSearch(params('tab=recebidos'))).toBe('recebidos')
    const both = params('tab=recebidos&de=2026-10-01&origem=local&pixDe=2026-10-05&pixOrigem=other&pixSituacao=received&pixValor=1.234,56&pixBusca=E2&pixPagina=3')
    expect(receivedStateFromSearch(both)).toEqual({
      from: '2026-10-05', to: '', situation: 'received', origin: 'other', amount: '1.234,56', search: 'E2', page: 3, pageSize: 50,
    })
    expect(historyStateFromSearch(both)).toEqual(expect.objectContaining({ paidFrom: '2026-10-01', source: 'local' }))
    expect(countActiveReceivedFilters(receivedStateFromSearch(both))).toBe(5)
    // Trocar um filtro volta à primeira página da aba e não mexe no histórico.
    const changed = withReceivedFilter(both, 'origin', 'none')
    expect(changed.get('pixOrigem')).toBe('none')
    expect(changed.get('pixPagina')).toBeNull()
    expect(changed.get('origem')).toBe('local')
    const cleared = withoutReceivedFilters(both)
    expect(cleared.toString()).toBe('tab=recebidos&de=2026-10-01&origem=local')
    expect(withReceivedPage(params(''), 2).toString()).toBe('pixPagina=2')
    // Valor inválido de link antigo vira "sem filtro".
    expect(receivedStateFromSearch(params('pixSituacao=paga&pixOrigem=pix&pixDe=05/10/2026'))).toEqual(expect.objectContaining({
      situation: '', origin: '', from: '',
    }))
  })
})
