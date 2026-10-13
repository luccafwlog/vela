// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('../../services/demurrage/demurrageInvoices', () => ({ listDemurrageInvoices: vi.fn() }))

import { useDemurrageComplementOf } from '../useDemurrageComplementOf'
import { listDemurrageInvoices } from '../../services/demurrage/demurrageInvoices'

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const complement = { id: 2, bl_id: 'BL-1', status: 'issued', created_at: '2026-10-11T10:00:00Z', doc_number: 'DEM-2' }
const original = { id: 1, bl_id: 'BL-1', status: 'paid', created_at: '2026-10-10T10:00:00Z', doc_number: 'DEM-1' }

it('segura a impressão enquanto não sabe se a Invoice é complementar e depois diz de qual ela completa', async () => {
  let resolve: (rows: unknown[]) => void = () => {}
  vi.mocked(listDemurrageInvoices).mockReturnValue(new Promise((done) => { resolve = done as never }) as never)
  const { result } = renderHook(() => useDemurrageComplementOf(complement as never), { wrapper: wrapper() })
  expect(result.current).toEqual({ complementOf: undefined, pending: true, failed: false })

  resolve([original, complement])
  await waitFor(() => expect(result.current.pending).toBe(false))
  expect(result.current).toEqual({ complementOf: ['DEM-1'], pending: false, failed: false })
})

it('falha da consulta bloqueia a impressão em vez de imprimir a complementar sem o aviso', async () => {
  vi.mocked(listDemurrageInvoices).mockRejectedValue(new Error('rede'))
  const { result } = renderHook(() => useDemurrageComplementOf(complement as never), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.failed).toBe(true))
  expect(result.current.pending).toBe(false)
  expect(result.current.complementOf).toBeUndefined()
})

it('Invoice única do B/L não é complementar', async () => {
  vi.mocked(listDemurrageInvoices).mockResolvedValue([original] as never)
  const { result } = renderHook(() => useDemurrageComplementOf(original as never), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.pending).toBe(false))
  expect(result.current.complementOf).toEqual([])
})
