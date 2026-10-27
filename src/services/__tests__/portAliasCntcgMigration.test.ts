import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/465_cntcg_apelido_de_taicang.sql'),
  'utf-8',
)

describe('migration 465 — CNTCG e TCG são apelidos de Taicang (CNTAC)', () => {
  it('leva CNTCG e TCG a CNTAC junto dos outros apelidos de Taicang', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.normalize_port_code(p_value text)')
    expect(sql).toContain("IN ('TAICANG', 'TAIKANG', 'CNTAC', 'CNTAI', 'CNTAG', 'CNTCA', 'CNTCG', 'TCA', 'TCG') THEN 'CNTAC'")
  })

  it('continua expansível inline (IMMUTABLE, sem SET)', () => {
    expect(sql).toContain('IMMUTABLE')
    expect(sql).not.toMatch(/^\s*SET\s/m)
  })
})
