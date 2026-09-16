import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('CE Mercante automatic billing migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/051_ce_mercante_auto_billing.sql'),
    'utf8',
  )

  it('runs the calculation and invoice emission in the database on the CE transition', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.auto_bill_bl_after_ce_mercante(')
    expect(sql).toContain('public.calculate_bl_local_charges(')
    expect(sql).toContain('public.create_invoice_from_bls_core(')
    expect(sql).toContain('public.link_invoice_to_ledger(')
    expect(sql).toContain('CREATE TRIGGER trg_auto_bill_bl_after_ce_mercante')
    expect(sql).toContain('CREATE TRIGGER trg_suppress_duplicate_ce_auto_billing_effect')
    expect(sql).toContain("COALESCE(v_bl_financial_status, 'pending') <> 'pending'")
    expect(sql).toContain("c.deactivated_at IS NULL")
    expect(sql).toContain("NULLIF(BTRIM(OLD.ce_mercante), '') IS NULL")
    expect(sql).toContain("NULLIF(BTRIM(NEW.ce_mercante), '') IS NOT NULL")
  })

  it('keeps the Portal account gate scoped to Portal-originated billing', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.is_internal_auto_billing_context()')
    expect(sql).toContain("current_setting('vela.billing_context_table', true)")
    expect(sql).toContain('c.relowner = (')
    expect(sql).toContain('CREATE TEMP TABLE pg_temp.')
    expect(sql).not.toContain("current_setting('vela.billing_origin', true)")

    const singleBlReviewStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(p_bl_id text)')
    const singleBlReviewEnd = sql.indexOf('-- ---------------------------------------------------------------------------\n-- 3.', singleBlReviewStart)
    const singleBlReview = sql.slice(singleBlReviewStart, singleBlReviewEnd)
    expect(singleBlReview).toMatch(/RETURNS text\[\]\s+LANGUAGE plpgsql\s+STABLE/)
    expect(singleBlReview).not.toContain('financial_status')
  })

  it('treats an already invoiced B/L as an idempotent queued-effect result', () => {
    const workerStart = sql.indexOf('CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges')
    const worker = sql.slice(workerStart)

    expect(worker).toContain("financial_status")
    expect(worker).toContain("'already_invoiced'")
    expect(worker).toContain('idempotent')
    expect(worker).toContain('v_origin_bl_id')
    expect(worker).toContain('v_current_bl_id = v_origin_bl_id')
    expect(worker).toContain("COALESCE(v_one->>'message', v_one->>'reason')")
    expect(worker).toContain("'auto_billing_failed'")
  })

  it('restaura a identidade da sessão e usa marcador aleatório de curta duração', () => {
    expect(sql).toContain("current_setting('request.jwt.claim.sub', true)")
    expect(sql).toContain("replace(gen_random_uuid()::text, '-', '')")
    expect(sql).toContain("COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)")
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'")
    expect(sql).toContain('v_previous_request_sub')
    expect(sql).toContain('v_context_created := false')
    expect(sql).toContain("current_setting('request.jwt.claim.role', true)")
    expect(sql).toContain("set_config('request.jwt.claim.role', 'service_role', true)")
    expect(sql).toContain('v_previous_request_role')
    expect(sql).not.toContain("AND (auth.uid() IS NOT NULL OR auth.role() IS NOT DISTINCT FROM 'service_role')")
    expect(sql).toMatch(/create_invoice_from_bls_core\([\s\S]*?\);[\s\S]*?DROP TABLE IF EXISTS pg_temp\./i)
  })
})
