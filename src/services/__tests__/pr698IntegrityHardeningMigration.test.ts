import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('059 endurecimento da unificação de B/L misto', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/059_pr698_integrity_hardening.sql'),
    'utf8',
  )

  it('centraliza as lentes de modalidade e deriva cargo_mode nos três eventos físicos', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.bl_cargo_mode_matches_filter(')
    expect(sql).toMatch(/v_filter = 'container'[\s\S]*v_mode IN \('container', 'misto'\)/)
    expect(sql).toMatch(/v_filter = 'carga_solta'[\s\S]*v_mode IN \('carga_solta', 'misto'\)/)
    expect(sql).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON public\.bl_containers/)
    expect(sql).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON public\.bl_breakbulk_items/)
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF cargo_mode, bb_weight_ton, bb_packages_qty ON public\.bls/)
    expect(sql).toContain('OLD.bl_id IS DISTINCT FROM NEW.bl_id')
  })

  it('protege faturamento, recebível e gates de revisão para misto', () => {
    expect(sql).toContain("IN ('invoiced', 'partially_paid', 'paid')")
    expect(sql).toContain('PERFORM public.sync_local_charge_receivable(p_bl_id)')
    expect(sql).toMatch(/p_cargo_mode IN \('carga_solta', 'misto'\)/)
    expect(sql).toMatch(/cargo_mode IN \('carga_solta', 'misto'\)/)
    expect(sql).toContain('resolve_bl_local_charge_table_ids(v_bl.id, v_bl.reference_date)')
  })

  it('mantém a herança de terminal e torna a exceção auditável', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.resolve_bl_terminal_id(')
    expect(sql).toContain('public.normalize_port_code(f.port)')
    expect(sql).toContain("f.sentido = 'importacao'")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.set_bl_terminal_override(')
    expect(sql).toContain("field_name, old_value, new_value,\n    changed_by, changed_at, justification")
    expect(sql).toContain("'terminal_override'")
    expect(sql).toContain("current_setting('vela.bl_terminal_override', true)")
  })

  it('não reduz B/L misto a uma única frente no NOB', () => {
    expect(sql).toContain('public.resolve_bl_terminal_id(b.id)')
    expect(sql).toContain("b.cargo_mode = 'misto' AND f.modalidade IN ('carga_cheia', 'carga_solta')")
    expect(sql).toContain("b.cargo_mode <> 'misto' AND f.modalidade = public.bl_operation_front_modalidade(b.cargo_mode)")
  })
})
