import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql061 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/061_bl_weight_semantics_and_triggers.sql'),
  'utf8',
)

const sql062 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/062_pr698_audit_remediations.sql'),
  'utf8',
)

describe('061 guarda destrutiva em tempo de execução', () => {
  it('impede a execução se houver B/L faturado no banco', () => {
    expect(sql061).toContain("SELECT 1 FROM public.bls WHERE financial_status IN ('invoiced','paid','partially_paid')")
    expect(sql061).toContain('A 061 apaga total_weight_kg. Ha B/L faturado neste banco')
  })
})

describe('062 remediações da auditoria da PR 698', () => {
  it('P0: resolve_bl_local_charge_items restringe weight_ton a bb_weight_ton em carga solta e misto', () => {
    expect(sql062).toContain("WHEN v_bl.cargo_mode IN ('carga_solta', 'misto') THEN v_bl.bb_weight_ton")
    expect(sql062).toContain('Peso de carga solta ausente; o peso conteinerizado nao substitui o peso solto')
    expect(sql062).toContain("calculation_key := CONCAT('review:weight_missing:', item.id);")
  })

  it('P1: supressão anti-bitributação do item bl é condicionada à existência na tabela container', () => {
    expect(sql062).toContain('v_has_bl_basis_item')
    expect(sql062).toContain("IF v_bl.cargo_mode = 'misto' AND v_tbl.cargo_mode = 'carga_solta' AND item.application_basis = 'bl'")
    expect(sql062).toContain('IF v_has_bl_basis_item THEN')
  })

  it('P1: guardas de recálculo detectam mutações de conteúdo em B/Ls faturados', () => {
    expect(sql062).toContain("p_transition = 'delete'")
    expect(sql062).toContain('Carga removida após faturamento; estorno/refaturamento necessário.')
    expect(sql062).toContain("p_transition = 'insert'")
    expect(sql062).toContain('Carga adicionada após faturamento; revisar e refaturar.')
  })

  it('P2: manifestos_mercante possui auditoria, updated_at e RLS admin para DELETE', () => {
    expect(sql062).toContain('CREATE TRIGGER audit_manifestos_mercante')
    expect(sql062).toContain("audit_row_changes('id')")
    expect(sql062).toContain('CREATE TRIGGER trg_manifestos_mercante_updated_at')
    expect(sql062).toContain('CREATE POLICY manifestos_mercante_delete_policy')
    expect(sql062).toContain('FOR DELETE TO authenticated USING (public.is_admin())')
  })

  it('P3: NOB alerta nob_sem_destinatario quando cliente não tem contato com email válido', () => {
    expect(sql062).toContain('nob_sem_destinatario')
    expect(sql062).toContain('COALESCE(cardinality(v_customer_bl.emails), 0) = 0')
  })
})
