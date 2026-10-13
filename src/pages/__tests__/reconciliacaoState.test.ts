import { describe, expect, it } from 'vitest'
import {
  countActiveHistoryFilters,
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
  it('abre em Pendências (destino do Alerta pix_unreconciled) e ignora aba desconhecida', () => {
    expect(reconciliacaoTabFromSearch(params(''))).toBe('pendencias')
    expect(reconciliacaoTabFromSearch(params('tab=xyz'))).toBe('pendencias')
    expect(reconciliacaoTabFromSearch(params('tab=historico'))).toBe('historico')
    expect(withReconciliacaoTab(params('tab=historico&bl=X'), 'pendencias').toString()).toBe('bl=X')
  })

  it('descarta valores inválidos em vez de filtrar por eles', () => {
    const state = historyStateFromSearch(params('de=10/10/2026&origem=pix&tipo=granite&cliente=abc&clienteNome=X&pagina=-2&porPagina=7&ordem=drop&direcao=up'))
    expect(state).toEqual(expect.objectContaining({
      paidFrom: '', source: '', invoiceTypeFilter: '', customerId: '', customerName: '', page: 1, pageSize: 50, sort: 'paidAt', sortDir: 'desc',
    }))
    expect(countActiveHistoryFilters(state)).toBe(0)
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
})
