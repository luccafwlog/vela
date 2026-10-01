import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Contrato de texto da migration 120: verifica o SQL, não a execução nem RLS.
const sql = readFileSync('supabase/migrations/120_justificativa_da_escala_so_para_dado_realizado.sql', 'utf8')
const documentalDiff = "(v_export_old - 'ce_status' - 'linked') IS DISTINCT FROM (v_export_new - 'ce_status' - 'linked')"

describe('migration 120 — justificativa da escala só fora do status documental', () => {
  it('troca trechos do corpo atual em vez de recriar a função a partir da 002', () => {
    // Recriar o corpo da baseline desfaria a 111 (justificativa só na alteração).
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION/)
    expect(sql).toContain("pg_get_functiondef(\n    'public.save_voyage_escala_terminal_state(bigint,text,integer,jsonb,jsonb,jsonb,text)'::regprocedure")
    expect(sql).toMatch(/IF position\(v_old IN v_def\) = 0 THEN\s+RAISE EXCEPTION/)
  })

  it('parte do texto deixado pela 111 e mantém a exigência só para exportação já declarada', () => {
    expect(sql).toContain('OR (v_current_revision > 0 AND v_old_export_declared);$o$')
    expect(sql).toContain('v_requires_justification := v_requires_justification OR v_old_export_declared;\n    FOR v_report IN$o$')
    expect(sql.split(documentalDiff).length - 1).toBe(2)
  })
})
