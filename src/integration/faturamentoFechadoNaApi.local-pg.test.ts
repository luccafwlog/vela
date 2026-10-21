import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-16 do plano da frente financeira e itens 1a/1b da revisão das importações
// (migration 366): as checagens de faturamento não se contornam pela API.

const w = financeWorld(9307)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT NOT has_column_privilege('authenticated', 'public.bls', 'charge_status', 'UPDATE')`) === 't'
  } catch {
    return false
  }
}, 'migration 366 aplicada')

describeLocal('366 — faturamento fechado na API', () => {
  beforeAll(() => {
    w.setup()
    w.table(500)
  })
  afterAll(() => w.cleanup())

  it('UPDATE direto de charge_status, billing_hold_reason e das tabelas do lote 0 é recusado; outras colunas seguem', () => {
    const id = w.createBl('API')
    w.calculate(id)
    for (const sql of [
      `UPDATE public.bls SET charge_status = 'ready_for_billing' WHERE id = '${id}'`,
      `UPDATE public.bls SET billing_hold_reason = NULL WHERE id = '${id}'`,
      `UPDATE public.bl_charge_table_links SET charge_table_id = charge_table_id WHERE bl_id = '${id}'`,
      `INSERT INTO public.bl_price_freezes (bl_id, reference_date) VALUES ('${id}', CURRENT_DATE)`,
    ]) {
      const result = w.as('operacoes', sql)
      expect(result.status, sql).not.toBe(0)
      expect(result.stderr, sql).toMatch(/permission denied|permissão negada/)
    }
    w.asOk('operacoes', `UPDATE public.bls SET consignee = 'FF9307 CONSIGNATARIO' WHERE id = '${id}'`)
  })

  it('RPCs antigas de importação, de vínculo e a emissão fora do ledger não são executáveis por usuário', () => {
    const names = ['create_invoice_from_bls', 'import_manifest_transactional', 'import_bl_freight_with_metadata',
      'import_bl_freight_transactional', 'apply_container_dates_atomic', 'apply_customer_base_row_atomic',
      'approve_customer_reconciliation', 'reject_customer_reconciliation']
    expect(w.psql(`SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN (${names.map((n) => `'${n}'`).join(',')}) AND has_function_privilege('authenticated', oid, 'EXECUTE')`)).toBe('0')
  })

  it('a emissão pela RPC passa pelas checagens do Emitir: sem CE é recusada', () => {
    const id = w.createBl('NOCE')
    w.calculate(id)
    const result = w.as('administrativo', `SELECT public.create_invoice_from_bls_with_ledger(ARRAY['${id}'], ${w.customerId}, NULL, true, NULL)`)
    expect(result.status).not.toBe(0)
    expect(w.psql(`SELECT count(*) FROM public.invoice_bls WHERE bl_id = '${id}'`)).toBe('0')
  })
})
