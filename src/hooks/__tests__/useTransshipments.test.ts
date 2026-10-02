// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useOmitEscala, useRevertVoyageOmission, useSetBlDisposition, useUpdateVoyageOmission } from '../useTransshipments'

const { omitVoyageEscala, revertVoyageOmission, setBlCod, setBlTransshipment, updateVoyageOmission } = vi.hoisted(() => ({
  omitVoyageEscala: vi.fn(),
  revertVoyageOmission: vi.fn(),
  setBlCod: vi.fn(),
  setBlTransshipment: vi.fn(),
  updateVoyageOmission: vi.fn(),
}))

vi.mock('../../services/transshipments', () => ({
  omitVoyageEscala,
  revertVoyageOmission,
  setBlCod,
  setBlTransshipment,
  updateVoyageOmission,
}))

const expectedSharedKeys = [
  ['invoice-refunds'], ['invoice-links'], ['invoice-corrections'], ['billing-ledger'], ['portal-invoices-page'],
  ['bl-cockpit'],
  ['bl-detail'],
  ['bl-timeline'],
  ['bl-portal-status'],
  ['portal-operation-bls'],
]

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, invalidateQueries }
}

describe('useSetBlDisposition', () => {
  it('invalida o status do Portal do B/L mutado apos COD', async () => {
    setBlCod.mockResolvedValue(undefined)
    const { Wrapper, invalidateQueries } = createWrapper()
    const { result } = renderHook(() => useSetBlDisposition(7), { wrapper: Wrapper })

    result.current.setCod.mutate({ blId: 'BL1', omissionId: 1, justification: 'Cliente confirmou COD', changedBy: 'user-1' })

    await waitFor(() => expect(result.current.setCod.isSuccess).toBe(true))
    for (const queryKey of expectedSharedKeys) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bl-portal-status', 'BL1'] })
  })

  it('invalida o status do Portal do B/L mutado apos restaurar transbordo', async () => {
    setBlTransshipment.mockResolvedValue(undefined)
    const { Wrapper, invalidateQueries } = createWrapper()
    const { result } = renderHook(() => useSetBlDisposition(7), { wrapper: Wrapper })

    result.current.setTransshipment.mutate({ blId: 'BL2', omissionId: 2, justification: 'COD revertido', changedBy: 'user-1' })

    await waitFor(() => expect(result.current.setTransshipment.isSuccess).toBe(true))
    for (const queryKey of expectedSharedKeys) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bl-portal-status', 'BL2'] })
  })
})

describe('invalidação compartilhada de omissão de escala', () => {
  it('invalida superfícies de B/L e Portal após registrar uma omissão', async () => {
    omitVoyageEscala.mockResolvedValue(9)
    const { Wrapper, invalidateQueries } = createWrapper()
    const { result } = renderHook(() => useOmitEscala(7), { wrapper: Wrapper })

    result.current.mutate({ voyageId: 7, omittedPod: 'BRVIX', dischargePod: 'BRSSA', reason: 'teste', changedBy: 'user-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const queryKey of expectedSharedKeys) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
  })

  it('invalida as mesmas superfícies após reverter uma omissão', async () => {
    revertVoyageOmission.mockResolvedValue(undefined)
    const { Wrapper, invalidateQueries } = createWrapper()
    const { result } = renderHook(() => useRevertVoyageOmission(7), { wrapper: Wrapper })

    result.current.mutate({ omissionId: 9, justification: 'correção', changedBy: 'admin-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const queryKey of expectedSharedKeys) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
  })

  it('invalida as mesmas superfícies após complementar uma omissão', async () => {
    updateVoyageOmission.mockResolvedValue(undefined)
    const { Wrapper, invalidateQueries } = createWrapper()
    const { result } = renderHook(() => useUpdateVoyageOmission(7), { wrapper: Wrapper })

    result.current.mutate({
      omissionId: 9,
      onwardVesselName: 'Navio atualizado',
      onwardCarrier: 'Carrier atualizado',
      onwardVoyageNumber: 'VY-UPDATED',
      onwardEtd: '2026-08-20T10:00:00Z',
      onwardEta: '2026-08-21T10:00:00Z',
      reason: 'complemento',
      changedBy: 'admin-1',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const queryKey of expectedSharedKeys) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
  })
})
