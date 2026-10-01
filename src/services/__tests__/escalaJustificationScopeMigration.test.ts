import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Contrato de texto da migration 120: verifica o SQL, não a execução nem RLS.
const sql = readFileSync('supabase/migrations/120_justificativa_da_escala_so_para_dado_realizado.sql', 'utf8')
const documentalDiff = "(v_export_old - 'ce_status' - 'linked') IS DISTINCT FROM (v_export_new - 'ce_status' - 'linked')"

describe('migration 120 — justificativa da escala só fora do status documental', () => {
  it('redefine a função legada mantendo a assinatura', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text) RETURNS jsonb')
  })

  it('exige justificativa da exportação ignorando BLs e CEs e Vinculada', () => {
    expect(sql.split(documentalDiff).length - 1).toBe(2)
    expect(sql).not.toMatch(/IF v_export_old IS DISTINCT FROM v_export_new THEN\s+v_requires_justification/)
  })

  it('mantém o bloqueio por ADR fechado comparando a expectativa inteira', () => {
    expect(sql).toMatch(/IF v_export_old IS DISTINCT FROM v_export_new AND v_current_revision > 0 THEN[\s\S]{0,400}FOR v_report IN/)
  })

  it('continua exigindo justificativa para ATB, ATD e Restow, não para ETB/ETD', () => {
    expect(sql).toContain('v_state_changed := v_old_terminal.terminal_atb IS DISTINCT FROM v_terminal.terminal_atb')
    expect(sql).toContain('OR v_old_terminal.terminal_atd IS DISTINCT FROM v_terminal.terminal_atd')
    expect(sql).not.toMatch(/v_state_changed := [^;]*terminal_etb/)
  })
})
