import { describe, expect, it } from 'vitest'
import { DEMURRAGE_PAGE, readAllPages } from '../demurragePages'

describe('leitura de todas as páginas (PostgREST corta em 1000)', () => {
  it('lê 2.345 Invoices em três páginas e para na página curta', async () => {
    const all = Array.from({ length: 2345 }, (_, index) => ({ id: index + 1 }))
    const ranges: Array<[number, number]> = []
    const rows = await readAllPages<{ id: number }>(async (from, to) => {
      ranges.push([from, to])
      return { data: all.slice(from, to + 1), error: null }
    })
    expect(rows).toHaveLength(2345)
    expect(ranges).toEqual([[0, DEMURRAGE_PAGE - 1], [1000, 1999], [2000, 2999]])
  })

  it('com exatamente 1000 linhas, confirma o fim numa página vazia', async () => {
    const all = Array.from({ length: 1000 }, (_, index) => ({ id: index + 1 }))
    const rows = await readAllPages<{ id: number }>(async (from, to) => ({ data: all.slice(from, to + 1), error: null }))
    expect(rows).toHaveLength(1000)
  })

  it('erro de qualquer página recusa a leitura inteira', async () => {
    await expect(readAllPages(async (from) => (from === 0
      ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
      : { data: null, error: new Error('falhou') }))).rejects.toThrow('falhou')
  })
})
