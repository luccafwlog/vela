import { describe, expect, it, vi } from 'vitest'
import { afterBaplieImportado, afterEscalaAlterada, afterManifestoImportado, afterRotaAlterada, afterViagemAlterada } from '../cacheEffects'

function fakeQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined)
  return { client: { invalidateQueries }, keys: () => invalidateQueries.mock.calls.map(([input]) => JSON.stringify(input.queryKey)) }
}

function keySet(keys: (readonly unknown[])[]): string[] {
  return keys.map((key) => JSON.stringify(key))
}

describe('cache effects', () => {
  it('invalidates exactly the voyage superset and normalizes timeline id', async () => {
    const { client, keys } = fakeQueryClient()
    await afterViagemAlterada(client, { voyageId: 24 })
    expect(keys()).toEqual(keySet([
      ['voyages'], ['voyage-options'], ['voyage-pod-schedules'], ['voyage-escala-schedules'], ['portal-schedule-voyages'], ['bls'], ['containers'], ['dashboard'],
      ['voyage-timeline', '24'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
    ]))
    expect(keys()).not.toContain(JSON.stringify(['voyage-timeline', 24]))
  })

  it('invalidates exactly the scale effect set', async () => {
    const { client, keys } = fakeQueryClient()
    await afterEscalaAlterada(client, { voyageId: 24 })
    expect(keys()).toEqual(keySet([
      ['voyage-pod-schedules'], ['voyage-pol-schedules'], ['voyage-export-schedules'], ['voyage-escala-schedules'], ['portal-schedule-voyages'],
      ['voyage-timeline', '24'], ['voyages'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
    ]))
  })

  it('invalidates exactly the route effect set', async () => {
    const { client, keys } = fakeQueryClient()
    await afterRotaAlterada(client, { voyageId: 24 })
    expect(keys()).toEqual(keySet([
      ['voyage-route-ce-masters'], ['voyage-pol-schedules'], ['voyage-pod-schedules'], ['voyage-escala-schedules'],
      ['voyage-timeline', '24'], ['voyages'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
    ]))
  })

  it('invalidates exactly the manifest import set, including B/L summary dependents', async () => {
    const { client, keys } = fakeQueryClient()
    await afterManifestoImportado(client, { voyageId: 24 })
    expect(keys()).toEqual(keySet([
      ['bls'], ['bl-summary'], ['bl-detail'], ['containers'], ['vehicles'], ['vehicle-stats'], ['voyage-vehicle-stats'],
      ['invoices'], ['invoice-links'], ['customers'], ['voyages'], ['port-options'],
      ['vazios-importacao-containers'], ['vazios-importacao-manifests'], ['vazios-importacao-stats'],
      ['baplie-reconciliation', '24'], ['baplie-staging', '24'], ['agency-report'],
      ['voyage-pol-schedules'], ['voyage-escala-schedules'], ['voyage-timeline', '24'], ['lineup-tv-v3'], ['lineup-tv-display-v2'],
    ]))
  })

  // P0-4: Importar B/L, CE Mercante e Manifesto BB alimentam "Carga
  // descarregada" e "Veículos" no ADR — a família 'agency-report' precisa
  // sair invalidada junto, ou a aba fica mostrando o número velho até F5.
  it('invalidates the agency report family so the ADR tab reflects the import', async () => {
    const { client, keys } = fakeQueryClient()
    await afterManifestoImportado(client, { voyageId: 24 })
    expect(keys()).toContain('["agency-report"]')
  })

  it('delegates Baplie invalidation through the event seam', async () => {
    const { client, keys } = fakeQueryClient()
    await afterBaplieImportado(client, { voyageId: '24' })
    expect(keys()).toEqual(keySet([
      ['baplie-reconciliation', '24'], ['bls'], ['bl-detail'], ['voyages'], ['voyage-timeline', '24'], ['agency-report'],
    ]))
  })

  it('deduplicates overlapping keys within a single event', async () => {
    const { client, keys } = fakeQueryClient()
    await afterEscalaAlterada(client, { voyageId: 24 })
    expect(new Set(keys()).size).toBe(keys().length)
  })
})
