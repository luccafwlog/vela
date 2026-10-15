// B22 (ADR 0078): a planilha-modelo de CE Mercante tem de passar pelo parser
// que a importa. Trazia CE de 9 dígitos, que a importação recusa (15 dígitos).
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

const { parseCeMercanteBuffer } = await import('../ceMercanteImport')

function readTemplate(relativePath: string): ArrayBuffer {
  const raw = readFileSync(relativePath)
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
}

describe('modelo de CE Mercante', () => {
  for (const extension of ['csv', 'xlsx'] as const) {
    it(`${extension}: importa limpo, com CE de 15 dígitos`, async () => {
      const parsed = await parseCeMercanteBuffer(readTemplate(`public/templates/ce-mercante-modelo.${extension}`))
      expect(parsed.rowErrors).toEqual([])
      expect(parsed.rows.map((row) => row.ce_mercante)).toEqual(['122605051526081', '122605051526082'])
    })
  }
})
