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
    expect(sql).toContain("NULLIF(BTRIM(OLD.ce_mercante), '') IS NULL")
    expect(sql).toContain("NULLIF(BTRIM(NEW.ce_mercante), '') IS NOT NULL")
  })

  it('keeps the Portal account gate scoped to Portal-originated billing', () => {
    expect(sql).toContain("current_setting('vela.billing_origin', true) = 'internal_auto'")
    expect(sql).toContain("IF current_setting('vela.billing_origin', true) = 'internal_auto' THEN")
    expect(sql).toContain("set_config('vela.billing_origin', 'internal_auto', true)")

    const singleBlReviewStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(p_bl_id text)')
    const singleBlReview = sql.slice(singleBlReviewStart)
    expect(singleBlReview).toMatch(/RETURNS text\[\]\s+LANGUAGE plpgsql\s+VOLATILE/)
  })

  it('treats an already invoiced B/L as an idempotent queued-effect result', () => {
    const workerStart = sql.indexOf('CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges')
    const worker = sql.slice(workerStart)

    expect(worker).toContain("financial_status")
    expect(worker).toContain("'already_invoiced'")
    expect(worker).toContain('idempotent')
  })
})
