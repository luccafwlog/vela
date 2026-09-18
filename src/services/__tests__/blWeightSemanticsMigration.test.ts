import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { blTotalWeightKg, blTotalWeightTon } from '../../lib/cargoMode'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/061_bl_weight_semantics_and_triggers.sql'),
  'utf8',
)

describe('061 semântica única do peso do B/L', () => {
  it('limpa só o peso espelhado, preservando peso de contêiner legítimo', () => {
    expect(sql).toContain("WHERE cargo_mode IN ('carga_solta', 'misto')")
    expect(sql).toContain('abs(total_weight_kg - bb_weight_ton * 1000) <= 1')
    expect(sql).toContain('COMMENT ON COLUMN public.bls.total_weight_kg')
    expect(sql).toContain('COMMENT ON COLUMN public.bls.bb_weight_ton')
  })

  it('troca o trigger de taxa manual por statement-level com transition table', () => {
    expect(sql).toContain('trg_sync_manual_local_charge_receivable_statement')
    expect(sql).toContain('REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows')
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_sync_manual_local_charge_receivable ON public.charge_calculations;')
    expect(sql).not.toMatch(/CREATE TRIGGER[\s\S]*?charge_calculations\s*\nFOR EACH ROW/)
  })

  it('marca as funções inertes no catálogo', () => {
    expect(sql).toContain('COMMENT ON FUNCTION public.evaluate_and_dispatch_automatic_communications_045(timestamptz)')
    expect(sql).toContain('COMMENT ON FUNCTION public.trg_sync_manual_local_charge_receivable()')
  })
})

describe('peso total do B/L no TypeScript', () => {
  // O espelho antigo (total_weight_kg = bb_weight_ton * 1000) fazia a soma
  // contar a mesma carga duas vezes; com as colunas disjuntas, somar é correto.
  it('soma os dois componentes disjuntos', () => {
    expect(blTotalWeightKg({ total_weight_kg: 20000, bb_weight_ton: 3 })).toBe(23000)
    expect(blTotalWeightTon({ total_weight_kg: 20000, bb_weight_ton: 3 })).toBe(23)
  })

  it('trata carga solta pura e contêiner puro sem inventar peso', () => {
    expect(blTotalWeightKg({ total_weight_kg: null, bb_weight_ton: 20 })).toBe(20000)
    expect(blTotalWeightKg({ total_weight_kg: 28000, bb_weight_ton: null })).toBe(28000)
    expect(blTotalWeightKg({})).toBe(0)
  })
})
