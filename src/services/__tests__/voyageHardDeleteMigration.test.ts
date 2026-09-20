import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/067_voyage_hard_delete_guard.sql'), 'utf8')

describe('migration 067 — hard-delete de Viagem', () => {
  it('fecha o DELETE no banco quando a Viagem tem qualquer dado vinculado', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.guard_voyage_hard_delete()')
    expect(sql).toContain("c.column_name IN ('voyage_id', 'anchor_voyage_id')")
    expect(sql).toContain('information_schema.columns')
    expect(sql).toContain('RAISE EXCEPTION')
    expect(sql).toContain("USING ERRCODE = 'P0003'")
    expect(sql).toContain('BEFORE DELETE ON public.voyages')
    expect(sql).toContain('trg_guard_voyage_hard_delete')
  })

  it('preserva Viagem cancelada e fecha o helper de trigger para clientes', () => {
    expect(sql).toContain("IF OLD.status = 'cancelled'")
    expect(sql).toContain("USING ERRCODE = '42501'")
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.guard_voyage_hard_delete() FROM PUBLIC, anon, authenticated')
  })
})
