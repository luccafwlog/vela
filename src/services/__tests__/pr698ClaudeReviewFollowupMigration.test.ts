import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/060_pr698_claude_review_followup.sql'),
  'utf8',
)

describe('060 follow-up da revisão Claude Code da PR 698', () => {
  it('torna o filtro SQL e espelha misto como duas frentes', () => {
    expect(sql).toMatch(/bl_cargo_mode_matches_filter\([\s\S]*?LANGUAGE sql[\s\S]*?WHEN 'container'[^\n]*'misto'/)
    expect(sql).toContain("WHEN 'misto' THEN lower(btrim(COALESCE(p_cargo_mode, ''))) = 'misto'")
    expect(sql).toContain("WHEN 'misto' THEN NULL")
  })

  it('faz derivação por statement e respeita INSERT sem sinal físico', () => {
    expect(sql).toContain('REFERENCING NEW TABLE AS new_rows')
    expect(sql).toContain('REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows')
    expect(sql).toContain('uma recalculação por B/L distinto dentro de cada statement')
    expect(sql).toContain("IF TG_OP = 'INSERT' AND NOT v_has_cntr AND NOT v_has_bb THEN")
    expect(sql).toContain("NEW.cargo_mode := COALESCE(NULLIF(btrim(NEW.cargo_mode), ''), 'container');")
    expect(sql).not.toContain("IN ('invoiced', 'partially_paid', 'paid')")
  })

  it('permite adição pós-faturamento, bloqueia perda material e protege o import', () => {
    expect(sql).toContain("v_old_rank > v_new_rank AND NOT v_replacement")
    expect(sql).toContain("'Carga adicionada após faturamento; revisar e refaturar.'")
    expect(sql).toContain('import_breakbulk_manifest_transactional_031')
    expect(sql).toContain('a importacao removeria carga solta')
    expect(sql).toContain("source.row || jsonb_build_object('financial_status', b.financial_status)")
  })

  it('remove a FK terminal sobreposta, limpa COD e restaura os GUCs', () => {
    expect(sql).toContain('ALTER TABLE public.bls DROP CONSTRAINT IF EXISTS bls_terminal_id_fkey;')
    expect(sql).toContain('ON DELETE RESTRICT;')
    expect(sql).toContain('terminal_id = NULL')
    expect(sql).toContain('pod_port_id = NULL')
    expect(sql).toContain("'terminal_override'")
    expect(sql).toContain("set_config('vela.bl_terminal_override', COALESCE(v_previous_override, 'off'), true)")
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.recalculate_bl_cargo_mode(text) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.trg_sync_bl_cargo_mode_statement() FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.trg_sync_manual_local_charge_receivable() FROM PUBLIC, anon, authenticated;')
  })

  it('sincroniza recebível manual, exclui contato desativado e soma peso aditivo', () => {
    expect(sql).toContain('trg_sync_manual_local_charge_receivable')
    expect(sql).toContain("v_source = 'manual'")
    expect(sql).toContain('c.deactivated_at IS NULL')
    expect(sql).toContain("coalesce(total_weight_kg, 0) / 1000 + coalesce(bb_weight_ton, 0)")
  })

  it('mantém uma única produtora de NOB e normaliza o POD', () => {
    const producerStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(')
    const producerEnd = sql.indexOf('$function$;', producerStart)
    const producer = sql.slice(producerStart, producerEnd)
    expect(producer).not.toContain('evaluate_and_dispatch_automatic_communications_045(')
    expect(producer).toContain('public.normalize_port_code(b.pod)')
    expect(producer).toContain('A claim só é criada depois da composição')
    expect(producer).toContain('b.terminal_id IS NOT NULL')
    expect(producer).toContain("f.modalidade = 'carga_cheia'")
    expect(producer).toContain("f.modalidade = 'carga_solta'")
  })
})
