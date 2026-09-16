import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger settlement guard migration', () => {
  it('enforces one live ledger settlement per receivable and one normalized PIX TXID', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/071_ledger_settlement_uniqueness_guards.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_one_live_receivable\b/)
    expect(sql).toContain('ON public.ledger_settlements(receivable_id)')
    expect(sql).toContain("WHERE source IN ('manual', 'pix_extract')")

    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_unique_normalized_pix_txid\b/)
    expect(sql).toContain("UPPER(REGEXP_REPLACE(pix_txid, '[^A-Za-z0-9]', '', 'g'))")
    expect(sql).toContain("WHERE pix_txid IS NOT NULL AND source = 'pix_extract'")
  })

  it('protege o caso sem pagamento e o teto agregado no contrato ativo 052', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/052_financial_battery_guards.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_one_unpaid_receivable\b/)
    expect(sql).toMatch(/ON public\.ledger_settlements\(receivable_id\)[\s\S]*WHERE payment_id IS NULL/i)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.guard_ledger_settlement_allocation()')
    expect(sql).toContain('SUM(s.amount_brl)')
    expect(sql).toContain("+ 0.01, 2)")
    expect(sql).toContain('CREATE TRIGGER trg_guard_ledger_settlement_allocation')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.assert_ledger_invoice_payment_allocation(')
    expect(sql).toContain('register_ledger_invoice_payment_legacy_052')
    expect(sql).toContain('assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl)')
  })

  it('mantém o rename e o revoke da implementação legada no mesmo guard idempotente', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/052_financial_battery_guards.sql'),
      'utf8',
    )
    const renameStart = sql.indexOf('-- A implementação de 019')
    const wrapperStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(')
    const renameBlock = sql.slice(renameStart, wrapperStart)

    expect(renameBlock).toContain('REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment_legacy_052(')
    expect(renameBlock).toMatch(/RAISE EXCEPTION[\s\S]*register_ledger_invoice_payment/i)
  })
})
