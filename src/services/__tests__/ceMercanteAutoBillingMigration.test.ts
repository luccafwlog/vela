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
    const singleBlReview = sql.slice(singleBlReviewStart)
    expect(singleBlReview).toMatch(/RETURNS text\[\]\s+LANGUAGE plpgsql\s+STABLE/)
  })

  it('treats an already invoiced B/L as an idempotent queued-effect result', () => {
    const workerStart = sql.indexOf('CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges')
    const worker = sql.slice(workerStart)

    expect(worker).toContain("financial_status")
    expect(worker).toContain("'already_invoiced'")
    expect(worker).toContain('idempotent')
  })
})
