import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-17 a F-21 do plano da frente financeira (migrations 367 a 370):
// correção pelo preço da fatura, COD em consolidada paga e sem diferença,
// Desbloqueio de CE com diferença a faturar e Demurrage com Pix em análise.

const w = financeWorld(9308)
const omissionId = 99930890

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT position('Pix em análise' IN prosrc) > 0 FROM pg_proc WHERE proname = '_demurrage_dunning_block_reason'`) === 't'
  } catch {
    return false
  }
}, 'migrations 367 a 370 aplicadas')

describeLocal('367 a 370 — correção, COD, Desbloqueio de CE e Demurrage', () => {
  let item = 0
  const dst = 'FF9308DST'

  beforeAll(() => {
    w.setup()
    ;[, item] = w.table(1000, { validFrom: 'CURRENT_DATE - 60' })
    // Tabela do destino do COD, com o mesmo preço, e omissão da escala.
    w.psql(`INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (99930880, 'Tabela FF9308 destino', '${dst}', CURRENT_DATE - 60, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
        VALUES (99930881, 99930880, 'Taxa destino', 'container', 1000, 1000, 'container_distinct_voyage', 'base', 'any', 'BRL');
      INSERT INTO public.voyage_omissions (id, voyage_id, omitted_pod, discharge_pod, omitted_by)
        VALUES (${omissionId}, ${w.voyageId}, '${w.pod}', '${dst}', '${w.actors.administrativo}')`)
  })
  afterAll(() => {
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.cod_adjustments WHERE bl_id LIKE '${w.prefix}%';
      DELETE FROM public.bl_transshipments WHERE omission_id = ${omissionId};
      DELETE FROM public.voyage_omissions WHERE id = ${omissionId};
      DELETE FROM public.pricing_rule_versions WHERE charge_table_id = 99930880;
      DELETE FROM public.charge_table_items WHERE charge_table_id = 99930880;
      DELETE FROM public.charge_tables WHERE id = 99930880;
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  let ce = 0
  function issued(name: string) {
    const id = w.createBl(name)
    w.calculate(id)
    ce += 1
    return { id, invoice: w.issueByCe(id, `9308${String(ce).padStart(11, '0')}`) }
  }

  function cod(blId: string) {
    w.psql(`INSERT INTO public.bl_transshipments (bl_id, omission_id, disposition) VALUES ('${blId}', ${omissionId}, 'transshipment') ON CONFLICT (bl_id, omission_id) DO NOTHING`)
    return w.as('administrativo', `SELECT public.set_bl_cod('${blId}', ${omissionId}, 'Destino corrigido por COD', '${w.actors.administrativo}'::uuid)`)
  }

  it('F-17: tabela reajustada não reprecifica a correção; a base nova usa o preço da fatura', () => {
    const b = issued('F17')
    w.table(1300, { validFrom: 'CURRENT_DATE - 1' })
    // Edição que muda a base mas não o valor: nada é reemitido.
    w.psql(`UPDATE public.bls SET movement_to = 'FCL' WHERE id = '${b.id}'`)
    expect(w.invoice(b.invoice).status).toBe('issued')
    // Segundo container: reemite pelo preço da fatura (2 × 1.000), não pela tabela nova.
    w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${b.id}', '${w.container()}', '22G1')`)
    expect(w.invoice(b.invoice).status).toBe('cancelled')
    expect(w.invoice(w.successorOf(b.invoice)!).total).toBe(2000)
    w.psql(`UPDATE public.charge_tables SET active = false WHERE pod = '${w.pod}' AND valid_from = CURRENT_DATE - 1`)
  })

  it('F-41: COD sem diferença não cria ajuste', () => {
    const b = issued('F41')
    const result = cod(b.id)
    expect(result.status, result.stderr).toBe(0)
    expect(w.psql(`SELECT count(*) FROM public.cod_adjustments WHERE bl_id = '${b.id}'`)).toBe('0')
  })

  it('F-18: COD em B/L coberto por consolidada paga não falha e vê o pago', () => {
    const a = issued('F18A')
    const b = issued('F18B')
    const c = w.consolidate([a.id, b.id])
    w.pay(c, 2000)
    expect(w.invoice(a.invoice).status).toBe('covered')
    w.asOk('administrativo', `UPDATE public.charge_table_items SET unit_value_brl = 800, value_brl = 800 WHERE id = 99930881`)
    const result = cod(a.id)
    expect(result.status, result.stderr).toBe(0)
    expect(w.psql(`SELECT action || '|' || paid_amount_brl || '|' || difference_brl FROM public.cod_adjustments WHERE bl_id = '${a.id}'`))
      .toBe('refund_overpayment|1000.00|-200.00')
    w.asOk('administrativo', `UPDATE public.charge_table_items SET unit_value_brl = 1000, value_brl = 1000 WHERE id = 99930881`)
  })

  it('F-19: COD a maior pago pela sucessora deixa o CE apto de novo', () => {
    const b = issued('F19')
    w.asOk('administrativo', `UPDATE public.charge_table_items SET unit_value_brl = 1200, value_brl = 1200 WHERE id = 99930881`)
    const result = cod(b.id)
    expect(result.status, result.stderr).toBe(0)
    expect(w.psql(`SELECT action || '|' || manual_review_required FROM public.cod_adjustments WHERE bl_id = '${b.id}'`)).toBe('cancel_and_reissue|true')
    const successor = w.liveInvoice(b.id)
    expect(successor).not.toBe(b.invoice)
    w.pay(successor, 1200)
    expect(w.psql(`SELECT status FROM public.cod_adjustments WHERE bl_id = '${b.id}'`)).toBe('settled')
    expect(w.psql(`SELECT ce_unlock_private.item('${b.id}')->>'paid'`)).toBe('true')
    w.asOk('administrativo', `UPDATE public.charge_table_items SET unit_value_brl = 1000, value_brl = 1000 WHERE id = 99930881`)
  })

  it('F-20: correção a maior em B/L pago tira o CE de apto com "Diferença de valor a faturar"', () => {
    const b = issued('F20')
    w.pay(b.invoice, 1000)
    expect(w.psql(`SELECT ce_unlock_private.item('${b.id}')->>'paid'`)).toBe('true')
    w.asOk('administrativo', `UPDATE public.charge_table_items SET unit_value_brl = 1200, value_brl = 1200 WHERE id = ${item}`)
    expect(w.activeInvoiceAlerts('fatura_desatualizada', b.invoice)).toBe(1)
    const unlock = JSON.parse(w.psql(`SELECT ce_unlock_private.item('${b.id}')`)) as { paid: boolean; reasons: string[] }
    expect(unlock.paid).toBe(false)
    expect(unlock.reasons).toContain('Diferença de valor a faturar')
  })

  it('F-21: Demurrage com Pix em análise pausa a Régua e não ganha QR novo', () => {
    const b = w.createBl('F21')
    w.psql(`SET session_replication_role = replica;
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status, first_billed_at)
        VALUES (99930870, 'FF9308-DEM', '${b}', ${w.customerId}, 100, 5.5, 550, 'manual', 'issued', now());
      INSERT INTO public.itau_pix_charges (demurrage_invoice_id, txid, amount_brl, expiration_seconds, status)
        VALUES (99930870, 'VELA9308000000000000000000000001', 550, 3600, 'concluded');
      INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, charge_id, amount_brl, paid_at, status, reason)
        SELECT 'E9308ANALISE', txid, id, 500, now(), 'review', 'Valor divergente' FROM public.itau_pix_charges WHERE demurrage_invoice_id = 99930870;
      SET session_replication_role = origin;`)
    try {
      expect(w.psql(`SELECT public._demurrage_dunning_block_reason(99930870)`)).toBe('Pix em análise')
      expect(w.psql(`SELECT coalesce(public._itau_pix_sync(NULL, 99930870, 550, true), 'NULL')`)).toBe('NULL')
      expect(w.psql(`SELECT count(*) FROM public.itau_pix_charges WHERE demurrage_invoice_id = 99930870`)).toBe('1')
    } finally {
      w.psql(`SET session_replication_role = replica;
        DELETE FROM public.itau_pix_receipts WHERE end_to_end_id = 'E9308ANALISE';
        DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id = 99930870;
        DELETE FROM public.demurrage_invoices WHERE id = 99930870;
        SET session_replication_role = origin;`)
    }
  })
})
