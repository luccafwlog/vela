// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePagedQuery } from '../usePagedQuery'

const PAGE_SIZE = 20
const TOTAL = 50 // 3 páginas

function setup() {
  const fetchPage = vi.fn(async (page: number) => ({ page, count: TOTAL }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const view = renderHook(({ page }: { page: number }) => usePagedQuery({
    queryKey: ['list', page],
    queryFn: () => fetchPage(page),
    nextQueryKey: ['list', page + 1],
    nextQueryFn: () => fetchPage(page + 1),
    hasNext: (data) => page * PAGE_SIZE < data.count,
  }), { wrapper, initialProps: { page: 1 } })
  return { fetchPage, view }
}

describe('usePagedQuery', () => {
  it('pede a página seguinte em segundo plano e "Próxima" abre do cache', async () => {
    const { fetchPage, view } = setup()
    await waitFor(() => expect(view.result.current.data?.page).toBe(1))
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith(2))

    act(() => view.rerender({ page: 2 }))
    // Já está no cache: a página 2 aparece sem nova leitura dela.
    expect(view.result.current.data?.page).toBe(2)
    expect(fetchPage.mock.calls.filter(([page]) => page === 2)).toHaveLength(1)
  })

  it('mantém a página atual na tela enquanto a nova chega e não pede além da última', async () => {
    const { fetchPage, view } = setup()
    await waitFor(() => expect(view.result.current.data?.page).toBe(1))

    act(() => view.rerender({ page: 3 }))
    expect(view.result.current.data?.page).toBe(1)
    expect(view.result.current.isPlaceholderData).toBe(true)
    await waitFor(() => expect(view.result.current.data?.page).toBe(3))

    expect(fetchPage).not.toHaveBeenCalledWith(4)
  })
})
