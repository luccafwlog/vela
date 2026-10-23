import { describe, expect, it, vi } from 'vitest'
import { afterClienteAtivacaoAlterada, afterPendenciaPixAlterada, afterPixConciliado, afterFaturaDemurrageAlterada, afterReferenciaDemurrageAlterada, afterBlEstadoAlterado, afterBaplieImportado, afterEscalaAlterada, afterLiberacaoFaturamentoPortal, afterManifestoImportado, afterNaturezaVaziosAlterada, afterRotaAlterada, afterViagemAlterada } from '../cacheEffects'

function fakeQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined)
  return { client: { invalidateQueries }, keys: () => invalidateQueries.mock.calls.map(([input]) => JSON.stringify(input.queryKey)) }
}

function keySet(keys: (readonly unknown[])[]): string[] {
  return keys.map((key) => JSON.stringify(key))
}

describe('cache effects', () => {
  it('invalidates the voyage superset and refreshes the timeline family', async () => {
    const { client, keys } = fakeQueryClient()
    await afterViagemAlterada(client, { voyageId: 24 })
    expect(keys()).toEqual(expect.arrayContaining(keySet([
      ['voyages'], ['voyage-options'], ['voyage-pod-schedules'], ['voyage-escala-schedules'], ['portal-schedule-voyages'], ['bls'], ['containers'], ['dashboard'],
      ['voyage-timeline'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
    ])))
    expect(keys()).not.toContain(JSON.stringify(['voyage-timeline', 24]))
    // Renomear navio ou viagem muda a coluna Navio / Viagem do Granito.
    expect(keys()).toContain(JSON.stringify(['granite-bls']))
  })

  it('invalidates the scale effect set', async () => {
    const { client, keys } = fakeQueryClient()
    await afterEscalaAlterada(client, { voyageId: 24 })
    expect(keys()).toEqual(expect.arrayContaining(keySet([
      ['voyage-pod-schedules'], ['voyage-pol-schedules'], ['voyage-export-schedules'], ['voyage-escala-schedules'], ['portal-schedule-voyages'],
      ['voyage-timeline', '24'], ['voyages'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
      // As escalas mudam a conferência do Baplie (TDT e portos da Viagem).
      ['baplie-voyage-context', 24],
    ])))
  })

  it('invalidates the route effect set', async () => {
    const { client, keys } = fakeQueryClient()
    await afterRotaAlterada(client, { voyageId: 24 })
    expect(keys()).toEqual(expect.arrayContaining(keySet([
      ['voyage-route-ce-masters'], ['voyage-pol-schedules'], ['voyage-pod-schedules'], ['voyage-escala-schedules'],
      ['voyage-timeline', '24'], ['voyages'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
    ])))
  })

  it('invalidates the manifest import set, including B/L summary dependents', async () => {
    const { client, keys } = fakeQueryClient()
    await afterManifestoImportado(client, { voyageId: 24 })
    expect(keys()).toEqual(expect.arrayContaining(keySet([
      ['bls'], ['bl-summary'], ['bl-detail'], ['containers'], ['vehicles'], ['vehicle-stats'], ['voyage-vehicle-stats'],
      ['voyage-breakbulk-tons'],
      ['alerts'], ['financial-alerts'], ['invoice-corrections'], ['invoices'], ['invoice-detail'], ['invoice-links'], ['billing-ledger'], ['customers'], ['voyages'], ['port-options'],
      ['vazios-importacao-containers'], ['vazios-importacao-manifests'], ['vazios-importacao-stats'],
      ['manifestos-mercante'],
      ['baplie-reconciliation'], ['baplie-staging'],
      ['local-charge-operations'], ['customer-reconciliation-queue'], ['bl-local-charge-lines'],
      ['agency-report'],
      ['voyage-pol-schedules'], ['voyage-escala-schedules'], ['voyage-timeline'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
    ])))
  })

  // P0-4: Importar B/L, CE Mercante e Manifesto BB alimentam "Carga
  // descarregada" e "Veículos" no ADR — a família 'agency-report' precisa
  // sair invalidada junto, ou a aba fica mostrando o número velho até F5.
  // A importação de Vazios pela Viagem passa a usar este efeito: ele precisa
  // cobrir, por prefixo, tudo o que a lista manual de VoyageImportActions
  // invalidava, inclusive as chaves de manifesto Mercante por rota e de vazio.
  it('covers every key the manual empty-import invalidation used to refresh', async () => {
    const { client, keys } = fakeQueryClient()
    await afterManifestoImportado(client, { voyageId: 24 })
    const invalidated = keys().map((key) => JSON.parse(key) as unknown[])
    const covered = (target: readonly unknown[]) => invalidated.some((prefix) =>
      prefix.length <= target.length && prefix.every((part, index) => JSON.stringify(part) === JSON.stringify(target[index])))
    const formerManualList: (readonly unknown[])[] = [
      ['voyages'], ['voyage-detail', 24], ['vazios-importacao-stats'], ['vazios-importacao-manifests'],
      ['manifestos-mercante', 24], ['manifestos-mercante', 24, 'BRSSZ', 'CNSHA'], ['manifestos-mercante', 'vazio', 24],
      ['vazios-importacao-containers'], ['lineup-tv-v3'], ['lineup-tv-display-v2'], ['agency-report'],
    ]
    expect(formerManualList.filter((key) => !covered(key))).toEqual([])
  })

  it('invalidates the agency report family so the ADR tab reflects the import', async () => {
    const { client, keys } = fakeQueryClient()
    await afterManifestoImportado(client, { voyageId: 24 })
    expect(keys()).toContain('["agency-report"]')
  })

  it('Natureza dos vazios de importação atualiza a lista, os totais e o ADR', async () => {
    const { client, keys } = fakeQueryClient()
    await afterNaturezaVaziosAlterada(client)
    expect(keys()).toEqual(expect.arrayContaining(keySet([['vazios-importacao-containers'], ['vazios-importacao-stats'], ['agency-report']])))
  })

  it('delegates Baplie invalidation through the event seam', async () => {
    const { client, keys } = fakeQueryClient()
    await afterBaplieImportado(client, { voyageId: '24' })
    expect(keys()).toEqual(expect.arrayContaining(keySet([
      ['alerts'], ['financial-alerts'], ['invoice-corrections'], ['invoices'], ['invoice-detail'], ['billing-ledger'], ['baplie-reconciliation'], ['bls'], ['bl-detail'], ['voyages'], ['voyage-timeline'], ['agency-report'],
    ])))
  })

  it('deduplicates overlapping keys within a single event', async () => {
    const { client, keys } = fakeQueryClient()
    await afterEscalaAlterada(client, { voyageId: 24 })
    expect(new Set(keys()).size).toBe(keys().length)
  })

  it('refreshes the gate, the issued invoices, the review queue and the Portal alert after a billing release', async () => {
    const { client, keys } = fakeQueryClient()
    await afterLiberacaoFaturamentoPortal(client, { customerId: 7 })
    expect(keys()).toEqual(expect.arrayContaining(keySet([
      ['customer-ficha', 'billing-portal-release', 7], ['invoices'], ['bls'], ['local-charge-operations'], ['alerts'], ['portal-provisioning'],
      ['review-queue'], ['customers'], ['customers-summary'], ['customer-ficha', 'timeline', 7],
    ])))
  })
})


it('propaga efeitos financeiros de importação, Baplie e cancelamento ao Portal', async () => {
  for (const effect of [
    (client: ReturnType<typeof fakeQueryClient>['client']) => afterManifestoImportado(client, {voyageId:24}),
    (client: ReturnType<typeof fakeQueryClient>['client']) => afterBaplieImportado(client, {voyageId:'24'}),
    (client: ReturnType<typeof fakeQueryClient>['client']) => afterBlEstadoAlterado(client, {blId:'BL1',voyageId:24}),
  ]) {
    const {client,keys} = fakeQueryClient()
    await effect(client)
    for (const family of ['invoice-links','invoice-refunds','invoice-corrections','billing-ledger','portal-invoice-detail','portal-invoices-page']) {
      expect(keys()).toContain(JSON.stringify([family]))
    }
  }
})

it('remover CE, cancelar e reativar B/L atualizam os Manifestos Mercante da Viagem (migration 396)', async () => {
  const { client, keys } = fakeQueryClient()
  await afterBlEstadoAlterado(client, { blId: 'BL1', voyageId: 24 })
  expect(keys()).toEqual(expect.arrayContaining(keySet([['manifestos-mercante'], ['alerts']])))
})

it('gravação em Invoice de Demurrage atualiza lista, detalhe, caixas cobradas, fichas, Portal e alertas', async () => {
  const { client, keys } = fakeQueryClient()
  await afterFaturaDemurrageAlterada(client)
  expect(keys()).toEqual(expect.arrayContaining(keySet([
    ['demurrage-invoices'], ['demurrage-invoice-detail'], ['demurrage-kpis'], ['demurrage-containers'], ['portal-disputes'],
    ['demurrage-customer-summary'], ['demurrage-disputes'], ['bl-detail'], ['customer-ficha'],
    ['portal-demurrage-invoices'], ['alerts'], ['header-alert'], ['itau-pix-receipts'], ['itau-pix-monitor'],
  ])))
})

it('tarifa ou acordo alterado refaz a previsão da aba Containers', async () => {
  const { client, keys } = fakeQueryClient()
  await afterReferenciaDemurrageAlterada(client)
  expect(keys()).toEqual(expect.arrayContaining(keySet([['demurrage-containers']])))
})

it('baixa por Pix na Conciliação atualiza fatura local, Demurrage, histórico, exceções, monitor Itaú e Pix recebidos uma vez cada', async () => {
  const { client, keys } = fakeQueryClient()
  await afterPixConciliado(client)
  expect(keys()).toEqual(expect.arrayContaining(keySet([
    ['invoices'], ['invoice-detail'], ['billing-ledger'], ['bls'], ['bl-detail'], ['customer-ficha'], ['portal-invoices'],
    ['demurrage-invoices'], ['demurrage-invoice-detail'], ['portal-demurrage-invoices'], ['financial-refunds'],
    ['reconciliation-history'], ['pix-reconciliation-exceptions'], ['itau-pix-monitor'], ['alerts'], ['header-alert'],
    ['itau-pix-receipts'], ['itau-pix-receipt-candidates'],
  ])))
  expect(new Set(keys()).size).toBe(keys().length)
})

it('pendência PIX gravada ou tratada atualiza Pendências e o Alerta sem reler as faturas', async () => {
  const { client, keys } = fakeQueryClient()
  await afterPendenciaPixAlterada(client)
  expect(keys()).toEqual(keySet([
    ['pix-reconciliation-exceptions'], ['itau-pix-monitor'], ['itau-pix-receipts'], ['alerts'], ['financial-alerts'], ['header-alert'],
  ]))
})

it('Cliente desativado ou reativado na ficha atualiza a lista, a ficha com o Histórico e o Provisionamento do Portal', async () => {
  const { client, keys } = fakeQueryClient()
  await afterClienteAtivacaoAlterada(client)
  expect(keys()).toEqual(keySet([
    ['customers'], ['customers-summary'], ['customer-lookup'], ['customer-detail'], ['customer-ficha'], ['portal-provisioning'],
  ]))
})
