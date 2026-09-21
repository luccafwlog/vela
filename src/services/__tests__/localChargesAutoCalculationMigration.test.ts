import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/072_local_charges_auto_calculation_on_import.sql'),
  'utf8',
)

describe('migration 072 — cálculo automático de taxas locais', () => {
  it('permite calcular sem cliente, mas mantém o recebível protegido por vínculo', () => {
    expect(migration).toContain('WHERE id = btrim(p_bl_id)')
    expect(migration).toContain('OR UPPER(id) = UPPER(btrim(p_bl_id))')
    expect(migration).toContain('IF v_bl.customer_id IS NULL THEN\n    RETURN NULL;')
    expect(migration).toContain('ON CONFLICT (source, bl_id)')
  })

  it('limita a RPC batch e preserva o identificador exato do B/L', () => {
    expect(migration).toContain('IF cardinality(p_bl_ids) > 100 THEN')
    expect(migration).toContain('v_bl_id := btrim(v_bl_id);')
    expect(migration).toContain("'total', v_total")
    expect(migration).toContain("'local_charges_auto_calc_error'")
  })

  it('calcula no import e só enfileira recuperação quando o cálculo falha', () => {
    const importSection = migration.slice(
      migration.indexOf('-- 3. import_bl_freight_with_metadata'),
      migration.indexOf('-- 4. approve_customer_reconciliation'),
    )

    expect(importSection).toContain('PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);')
    expect(importSection).toContain('calculation_errors')
    expect(importSection).toContain('INSERT INTO public.audit_logs')
    expect(importSection).toContain("IF p_batch IS NOT NULL THEN\n        PERFORM public.enqueue_import_effect(")
    expect(importSection).toContain("'provisional_charges'")
  })

  it('recalcula e sinaliza erro quando o cliente é aprovado ou relinkado', () => {
    expect(migration).toContain('PERFORM public.calculate_bl_local_charges(v_queue.bl_id, v_actor, true);')
    expect(migration).toContain('PERFORM public.calculate_bl_local_charges(p_bl_id, p_changed_by, true);')
    expect(migration).toContain("'calculation_error', v_calculation_error")
    expect(migration).toContain("'local_charges_reconciliation_calc_error'")
    expect(migration).toContain("'local_charges_relink_calc_error'")
  })

  it('faz backfill idempotente com aviso e auditoria dos B/Ls que não puder calcular', () => {
    expect(migration).toContain('Falha no backfill de taxas locais do B/L %')
    expect(migration).toContain("'local_charges_backfill_error'")
    expect(migration).not.toContain('EXCEPTION WHEN OTHERS THEN\n      NULL;')
  })
})
