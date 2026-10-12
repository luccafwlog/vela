// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { queryKeys } from '../../services/queryKeys'

const mocks = vi.hoisted(() => ({ move: vi.fn(), unlink: vi.fn() }))

vi.mock('../../services/manifestosMercanteService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/manifestosMercanteService')>()),
  moveBlsToManifestoMercante: mocks.move,
  unlinkBlsFromManifestoMercante: mocks.unlink,
}))

import { useMoveBlsToManifestoMercante, useUnlinkBlsFromManifestoMercante } from '../useManifestosMercante'

// Ficha, Histórico do B/L e da Viagem e a lista de Ver B/Ls da rota.
const affected = [
  queryKeys.bls.detail('BL-1'),
  queryKeys.bls.timeline('BL-1'),
  queryKeys.auditLogs.detail('bl', 'BL-1'),
  queryKeys.voyages.timeline(7),
  [...queryKeys.manifestosMercante.byVoyage(7), 'bls'],
]

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } })
  for (const key of [...affected, ['unrelated']]) client.setQueryData(key, 'old')
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

function invalidated(client: QueryClient) {
  return affected.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => JSON.stringify(key))
}

afterEach(() => vi.clearAllMocks())

it('Mover atualiza a ficha e o Histórico do B/L e da Viagem', async () => {
  mocks.move.mockResolvedValue({ numero: '1226B01849909', created: false, moved: 1, unchanged: 0 })
  const { client, wrapper } = harness()
  const { result } = renderHook(() => useMoveBlsToManifestoMercante(7), { wrapper })

  await result.current.mutateAsync({ blIds: ['BL-1'], numero: '1226B01849909', reason: 'Reemissão', expected: { 'BL-1': null } })

  expect(invalidated(client)).toEqual(affected.map((key) => JSON.stringify(key)))
  expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false)
})

it('recusa "mudou depois da tela" recarrega os dados para a nova tentativa; outra recusa não', async () => {
  const stale = { code: '22023', message: 'O Manifesto Mercante mudou depois da tela: BL-1 está em 1226B01849909. Recarregue e confira antes de gravar.' }
  mocks.unlink.mockRejectedValueOnce(stale)
  const { client, wrapper } = harness()
  const { result } = renderHook(() => useUnlinkBlsFromManifestoMercante(7), { wrapper })

  await expect(result.current.mutateAsync({ blIds: ['BL-1'], reason: 'Teste', expected: { 'BL-1': '1226501860578' } })).rejects.toBe(stale)
  expect(invalidated(client)).toEqual(affected.map((key) => JSON.stringify(key)))

  const other = harness()
  mocks.unlink.mockRejectedValueOnce({ code: '22023', message: 'Informe o motivo do desvínculo do Manifesto Mercante.' })
  const { result: second } = renderHook(() => useUnlinkBlsFromManifestoMercante(7), { wrapper: other.wrapper })
  await expect(second.current.mutateAsync({ blIds: ['BL-1'], reason: '', expected: {} })).rejects.toBeTruthy()
  expect(invalidated(other.client)).toEqual([])
})
