// @vitest-environment jsdom
// Revisão de 2026-10-22 (G1): o "selecionar todos" marca o resultado filtrado
// inteiro, em todas as páginas.
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { loadAllPageKeys, useFilteredSelection } from '../useFilteredSelection'

it('seleciona todo o filtro, conta parcial como meio marcado e desmarca tudo no segundo clique', async () => {
  const loadAll = vi.fn(async () => ['a', 'b', 'c'])
  const { result } = renderHook(() => useFilteredSelection<string>({ scope: { pod: 'BRVIX' }, totalCount: 3, loadAll }))

  act(() => result.current.toggle('a'))
  expect(result.current).toMatchObject({ count: 1, someSelected: true, allSelected: false })

  await act(async () => { await result.current.toggleAll() })
  expect(loadAll).toHaveBeenCalledTimes(1)
  expect([...result.current.selected]).toEqual(['a', 'b', 'c'])
  expect(result.current).toMatchObject({ allSelected: true, someSelected: false })

  await act(async () => { await result.current.toggleAll() })
  expect(result.current.count).toBe(0)
})

it('trocar o filtro zera a seleção e descarta a leitura que ainda estava em curso', async () => {
  let release: (keys: number[]) => void = () => {}
  const loadAll = vi.fn(() => new Promise<number[]>((resolve) => { release = resolve }))
  const { result, rerender } = renderHook(({ scope }) => useFilteredSelection<number>({ scope, totalCount: 2, loadAll }), {
    initialProps: { scope: { search: 'A' } as unknown },
  })
  let pending: Promise<void> = Promise.resolve()
  act(() => { pending = result.current.toggleAll() })
  expect(result.current.loadingAll).toBe(true)
  rerender({ scope: { search: 'B' } })
  await act(async () => {
    release([1, 2])
    await pending
  })
  expect(result.current.count).toBe(0)
  expect(result.current.loadingAll).toBe(false)
})

it('guarda a linha inteira, renova a cópia e tira as já tratadas', () => {
  type Item = { id: string; ready: boolean }
  const { result } = renderHook(() => useFilteredSelection<string, Item>({ scope: null, totalCount: 2, loadAll: async () => [], keyOf: (item) => item.id }))
  act(() => result.current.toggleMany([{ id: 'x', ready: false }, { id: 'y', ready: false }]))
  act(() => result.current.refresh([{ id: 'x', ready: true }, { id: 'z', ready: true }]))
  expect(result.current.values).toEqual([{ id: 'x', ready: true }, { id: 'y', ready: false }])
  act(() => result.current.removeMany(['x']))
  expect(result.current.values).toEqual([{ id: 'y', ready: false }])
})

it('falha ao ler o filtro não seleciona nada e diz o motivo', async () => {
  const { result } = renderHook(() => useFilteredSelection<string>({ scope: null, totalCount: 5, loadAll: async () => { throw new Error('rede') } }))
  await act(async () => { await result.current.toggleAll() })
  await waitFor(() => expect(result.current.loadError).toBe('rede'))
  expect(result.current.count).toBe(0)
})

it('lê todas as páginas do servidor e recusa acima do teto', async () => {
  const readPage = vi.fn(async (page: number) => ({ rows: Array.from({ length: page < 3 ? 100 : 50 }, (_, index) => ({ id: `${page}-${index}` })), count: 250 }))
  await expect(loadAllPageKeys(readPage, (row) => row.id, { pageSize: 100 })).resolves.toHaveLength(250)
  expect(readPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3])
  await expect(loadAllPageKeys(readPage, (row) => row.id, { pageSize: 100, cap: 200 })).rejects.toThrow(/O filtro tem 250 linhas; a seleção vai até 200/)
})

it('acima do teto, o selecionar todos não lê nada e pede para refinar, qualquer que seja a tela', async () => {
  const loadAll = vi.fn(async () => ['a'])
  const { result } = renderHook(() => useFilteredSelection<string>({ scope: null, totalCount: 10_001, loadAll }))
  await act(async () => { await result.current.toggleAll() })
  expect(loadAll).not.toHaveBeenCalled()
  expect(result.current.count).toBe(0)
  expect(result.current.loadError).toMatch(/Refine o filtro/)
})
