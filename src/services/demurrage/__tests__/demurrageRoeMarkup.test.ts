import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

const { DEMURRAGE_ROE_MARKUP } = await import('../demurrageRoe')

// B24 (ADR 0014): o markup canônico mora no banco; a prévia da tela e a Edge do BCB não o redefinem.
describe('markup do ROE num ponto só', () => {
  it('a cópia da prévia na tela é igual à do banco', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/264_markup_do_roe_num_ponto_so.sql'), 'utf8')
    const value = sql.match(/_demurrage_roe_markup\(\)\s*RETURNS numeric[\s\S]*?SELECT ([0-9.]+)::numeric/)?.[1]
    expect(Number(value)).toBe(DEMURRAGE_ROE_MARKUP)
  })

  it('a Edge do BCB manda só a PTAX e lê o ROE gravado', () => {
    const edge = readFileSync(resolve(process.cwd(), 'supabase/functions/recalc-demurrage-ptax/index.ts'), 'utf8')
    expect(edge).toContain('p_roe: null,')
    expect(edge).not.toMatch(/\* 1\.065/)
  })
})
