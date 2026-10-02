import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { afterCargaAlterada, afterDatasContainerAlteradas, afterBlRevisado, afterBaplieImportado, afterBlEstadoAlterado, afterEscalaAlterada, afterManifestoImportado, afterViagemAlterada } from '../cacheEffects'

// Consultas montadas representam listas, cards e fichas já abertas. A fonte
// muda depois da ação; staleTime infinito impede um refetch incidental.
async function expectRefresh(effect: (client: QueryClient) => Promise<void>, keys: readonly (readonly unknown[])[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  let persisted = 'antes'
  const observers = keys.map((queryKey) => {
    client.setQueryData(queryKey, persisted)
    const observer = new QueryObserver(client, { queryKey, queryFn: async () => persisted, staleTime: Infinity })
    return observer.subscribe(() => {})
  })
  try {
    persisted = 'depois'
    await effect(client)
    for (const key of keys) expect(client.getQueryData(key), JSON.stringify(key)).toBe('depois')
  } finally {
    observers.forEach((unsubscribe) => unsubscribe())
    client.clear()
  }
}

describe('atualização operacional sem reload', () => {
  it.each([
    ['edição de carga', afterCargaAlterada],
    ['importação de manifesto', (client: QueryClient) => afterManifestoImportado(client, { voyageId: 24 })],
    ['importação de Baplie', (client: QueryClient) => afterBaplieImportado(client, { voyageId: '24' })],
    ['cancelamento de B/L', (client: QueryClient) => afterBlEstadoAlterado(client, { blId: 'BL1', voyageId: 24 })],
    ['alteração de viagem', (client: QueryClient) => afterViagemAlterada(client, { voyageId: 24 })],
  ] as const)('%s preserva a atualização financeira da PR 839', async (_name, effect) => {
    await expectRefresh(effect, [
      ['invoice-refunds', 7], ['cod-adjustments', 'pending'],
      ['portal-invoice-detail', 7], ['portal-invoices', 3],
      ['portal-invoices-page', 'customer', 3, {}, 1, 20], ['reconciliation-history'],
    ])
  })

  it('importar B/L atualiza totalizadores, ficha da viagem, filtros e habilitação da conciliação', async () => {
    await expectRefresh((client) => afterManifestoImportado(client, { voyageId: 24 }), [
      ['bl-summary', { pod: 'BRSSZ' }], ['voyage-detail', 24], ['baplie-bls-exist', '24'],
      ['container-type-options'], ['bl-cockpit', 'BL1'], ['report-operational', {}], ['op-count', 'pending-review'],
    ])
  })
  it('Baplie atualiza cards mesmo sem mudar flags físicas e encontra chaves string da página', async () => {
    await expectRefresh((client) => afterBaplieImportado(client, { voyageId: '24' }), [
      ['voyages'], ['voyage-detail', 24], ['baplie-staging', '24'], ['containers', {}],
      ['bl-summary', {}], ['local-charge-operations', {}], ['vazios-importacao-containers', {}],
    ])
  })
  it('alterar ou excluir viagem atualiza fichas e seletores de Veículos', async () => {
    await expectRefresh((client) => afterViagemAlterada(client, { voyageId: 24 }), [
      ['voyage-detail', 24], ['vehicle-voyage-options'], ['vehicles', 24, {}], ['bl-detail', 'BL1'],
    ])
  })
  it('editar escala atualiza os cards de Baplie e Veículos que copiam a programação', async () => {
    await expectRefresh((client) => afterEscalaAlterada(client, { voyageId: 24 }), [
      ['baplie-voyage-card-schedules', [24]], ['vehicles-voyage-card-schedules', [24]],
    ])
  })
  it('alterar estado do B/L atualiza todos os filtros de faturamento pronto', async () => {
    await expectRefresh((client) => afterBlEstadoAlterado(client, { blId: 'BL1', voyageId: 24 }), [
      ['billing-ready-bls', { voyageId: 24 }], ['voyages'], ['containers', {}],
    ])
  })
  it('excluir containers e veículos atualiza listas, cards e os vínculos nas fichas', async () => {
    await expectRefresh(afterCargaAlterada, [
      ['containers', { vehicleContainer: 'true' }], ['vehicles', 24, {}], ['vehicle-stats', 24],
      ['voyage-vehicle-stats', [24]], ['bl-summary', {}], ['voyage-detail', 24], ['baplie-reconciliation', '24'],
      ['demurrage-containers'], ['demurrage-kpis'],
    ])
  })
  it('salvar descarga/devolução atualiza cards de Demurrage e todas as fichas consumidoras', async () => {
    await expectRefresh(afterDatasContainerAlteradas, [
      ['containers', {}], ['bl-detail', 'BL1'], ['demurrage-kpis'], ['demurrage-invoices', 'issued'],
      ['demurrage-customer-detail', 3], ['customer-ficha', 'demurrage-invoices', 3],
    ])
  })
  it('revisar B/L atualiza o totalizador filtrado, além da lista e do drawer', async () => {
    await expectRefresh((client) => afterBlRevisado(client, { blId: 'BL1' }), [
      ['bl-summary', { reviewStatus: 'pending' }], ['voyage-detail', 24], ['containers', {}],
    ])
  })

  it('uma ação não repete a leitura da ficha quando o efeito inclui família e ID', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    let reads = 0
    client.setQueryData(['bl-detail', 'BL1'], 'antes')
    const observer = new QueryObserver(client, { queryKey: ['bl-detail', 'BL1'], staleTime: Infinity, queryFn: async () => { reads += 1; return 'depois' } })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await afterBlEstadoAlterado(client, { blId: 'BL1', voyageId: 24 })
      expect(client.getQueryData(['bl-detail', 'BL1'])).toBe('depois')
      expect(reads).toBe(1)
    } finally { unsubscribe(); client.clear() }
  })

  it('telas desmontadas ficam obsoletas e consultam novamente ao reabrir', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    try {
      client.setQueryData(['voyage-detail', 24], 'antes')
      await afterManifestoImportado(client, { voyageId: 24 })
      expect(client.getQueryState(['voyage-detail', 24])?.isInvalidated).toBe(true)
      expect(await client.fetchQuery({ queryKey: ['voyage-detail', 24], queryFn: async () => 'depois' })).toBe('depois')
    } finally { client.clear() }
  })
})
