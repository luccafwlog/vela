// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchROE: vi.fn() }))

vi.mock('../../services/demurrage/demurrageRoe', () => ({ fetchROE: mocks.fetchROE }))

import { useRoeHeaderRate } from '../useRoeHeaderRate'

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

beforeEach(() => {
  mocks.fetchROE.mockReset()
})

describe('useRoeHeaderRate', () => {
  it('expoe PTAX, ROE, data efetiva e estado de cache da fonte autoritativa', async () => {
    mocks.fetchROE.mockResolvedValue({
      ptax: 5.0975,
      roe: 5.4288,
      effectiveDate: '2026-07-16',
      offline: true,
      cachedAt: '2026-07-16T18:00:00.000Z',
      source: 'cached',
    })

    const { result } = renderHook(() => useRoeHeaderRate(), { wrapper: createWrapper() })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.roe).toBe(5.4288))
    expect(result.current).toMatchObject({
      ptax: 5.0975,
      effectiveDate: '2026-07-16',
      offline: true,
      cachedAt: '2026-07-16T18:00:00.000Z',
      loading: false,
      unavailable: false,
    })
  })

  it('refresh invalida e reconsulta a referencia', async () => {
    mocks.fetchROE
      .mockResolvedValueOnce({ ptax: 5, roe: 5.325, effectiveDate: '2026-07-15', offline: false, cachedAt: null, source: 'bcb_live' })
      .mockResolvedValueOnce({ ptax: 5.1, roe: 5.4315, effectiveDate: '2026-07-16', offline: false, cachedAt: null, source: 'bcb_live' })

    const { result } = renderHook(() => useRoeHeaderRate(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.ptax).toBe(5))

    await act(async () => { await result.current.refresh() })

    await waitFor(() => expect(result.current.ptax).toBe(5.1))
    expect(mocks.fetchROE).toHaveBeenCalledTimes(2)
  })

  it('expoe indisponibilidade quando nao ha cache', async () => {
    mocks.fetchROE.mockRejectedValue(new Error('BCB offline'))

    const { result } = renderHook(() => useRoeHeaderRate(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.unavailable).toBe(true))
    expect(result.current.ptax).toBeNull()
    expect(result.current.roe).toBeNull()
  })
})
