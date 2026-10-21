import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

import { BAPLIE_STAGING_COLUMNS, hasBlsForVoyage, listBaplieStaging } from '../baplieReadModel'

function createBuilder(result: { data: unknown[] | null; error: Error | null }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    limit: vi.fn(),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.order.mockReturnValue(builder)
  builder.range.mockImplementation(() => Promise.resolve(result))
  builder.limit.mockImplementation(() => Promise.resolve(result))
  return builder
}

describe('baplieReadModel', () => {
  beforeEach(() => fromMock.mockReset())

  it('lista staging com projeção explícita e paginação por viagem', async () => {
    const firstPage = createBuilder({
      data: [{ id: 1, voyage_id: 7, container_number: 'MSCU0000001' }],
      error: null,
    })
    fromMock.mockReturnValue(firstPage)

    await expect(listBaplieStaging(7, 1000)).resolves.toEqual([
      { id: 1, voyage_id: 7, container_number: 'MSCU0000001' },
    ])
    expect(fromMock).toHaveBeenCalledWith('baplie_containers')
    expect(firstPage.select).toHaveBeenCalledWith(BAPLIE_STAGING_COLUMNS)
    expect(firstPage.eq).toHaveBeenCalledWith('voyage_id', 7)
    expect(firstPage.order).toHaveBeenCalledWith('container_number')
    expect(firstPage.order).toHaveBeenCalledWith('id')
    expect(firstPage.range).toHaveBeenCalledWith(0, 999)
  })

  // Obs. 1 (sessão de testes de 2026-10-20): Baplie gravado com "BM" (o
  // qualificador do RFF) no lugar do B/L citado não mostra "BM" como B/L.
  it('lê "BM" gravado como B/L citado como ausência de B/L', async () => {
    fromMock.mockReturnValue(createBuilder({
      data: [{ id: 1, bl_ref: 'BM' }, { id: 2, bl_ref: 'CSC4516000' }, { id: 3, bl_ref: null }],
      error: null,
    }))
    await expect(listBaplieStaging(7, 1000)).resolves.toEqual([
      { id: 1, bl_ref: null }, { id: 2, bl_ref: 'CSC4516000' }, { id: 3, bl_ref: null },
    ])
  })

  it('continua a paginação quando a primeira página está cheia', async () => {
    const firstPage = createBuilder({
      data: [{ id: 1 }, { id: 2 }],
      error: null,
    })
    const secondPage = createBuilder({ data: [{ id: 3 }], error: null })
    fromMock.mockReturnValueOnce(firstPage).mockReturnValueOnce(secondPage)

    await expect(listBaplieStaging(7, 2)).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(firstPage.range).toHaveBeenCalledWith(0, 1)
    expect(secondPage.range).toHaveBeenCalledWith(2, 3)
  })

  it('consulta apenas a existência de B/Ls da viagem', async () => {
    const builder = createBuilder({ data: [{ id: 42 }], error: null })
    fromMock.mockReturnValue(builder)

    await expect(hasBlsForVoyage(9)).resolves.toBe(true)
    expect(fromMock).toHaveBeenCalledWith('bls')
    expect(builder.select).toHaveBeenCalledWith('id')
    expect(builder.eq).toHaveBeenCalledWith('voyage_id', 9)
    expect(builder.limit).toHaveBeenCalledWith(1)
  })
})
