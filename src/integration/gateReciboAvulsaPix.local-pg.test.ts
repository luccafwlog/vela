import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-34 a F-38 e F-52 do plano da frente financeira (ADR 0093, decisões 16, 18
// e 19; migration 375): gate só na emissão, recibo da coberta com o pago
// direto, avulsa em cancelamento sem cobrança, Pix sem TXID e em duplicidade,
// e o reprocesso automático pela conta de sistema.

const w = financeWorld(9312)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'itau_pix_record_untracked'`) === '1'
  } catch {
    return false
  }
}, 'migration 375 aplicada')

describeLocal('375 — gate, recibo, avulsa e Pix sem baixa', () => {
  const e2e = (n: number) => `E9312${String(n).padStart(27, '0')}`
  beforeAll(() => {
    w.setup()
    w.table(1000)
  })
  afterAll(() => {
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'E9312%';
      DELETE FROM public.invoice_refunds WHERE itau_end_to_end_id LIKE 'E9312%';
      UPDATE public.app_settings SET system_billing_actor = NULL WHERE id = 1;
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  let ce = 0
  function issued(name: string) {
    const id = w.createBl(name)
    w.calculate(id)
    ce += 1
    return { id, invoice: w.issueByCe(id, `9312${String(ce).padStart(11, '0')}`) }
  }

  it('F-34: estorno de baixa com o gate fechado depois da emissão volta a fatura a emitida', () => {
    const b = issued('F34')
    const payment = w.pay(b.invoice, 1000)
    expect(w.invoice(b.invoice).status).toBe('paid')
    w.closeGate()
    try {
      w.reversePayment(payment.payment_id)
      expect(w.invoice(b.invoice)).toMatchObject({ status: 'issued', balance: 1000 })
    } finally {
      w.openGate()
    }
  })

  it('F-36: recibo da individual Coberta soma o pago direto nela', () => {
    const a = issued('F36A')
    const b = issued('F36B')
    w.pay(a.invoice, 300)
    const c = w.consolidate([a.id, b.id])
    w.pay(c, w.invoice(c).balance)
    expect(w.invoice(a.invoice).status).toBe('covered')
    expect(w.psql(`SELECT public._invoice_financial_summary(${a.invoice})->>'gross_received_brl'`)).toBe('1000.00')
  })

  it('F-37: avulsa em cancelamento com devolução integral não tem Pix nem aceita baixa', () => {
    const manual = w.json<{ invoice_id: number }>('administrativo', `SELECT public.create_manual_invoice(${w.customerId}, 'Serviço F37', 1, 500, NULL, NULL, NULL,
      '${w.actors.administrativo}'::uuid, p_reason => 'Avulsa do teste')`).invoice_id
    w.asOk('financeiro', `SELECT public.register_invoice_payment(${manual}, 200, 'ted', now(), 'Parcial da avulsa', NULL)`)
    expect(w.psql(`SELECT pix_payload IS NOT NULL FROM public.invoices WHERE id = ${manual}`)).toBe('t')
    const refund = w.json<{ refund_id: number }>('financeiro', `SELECT public.request_financial_refund('manual', ${manual}, 200, 'Cancelar a avulsa', 'cancel', gen_random_uuid())`).refund_id
    expect(w.psql(`SELECT pix_payload IS NULL FROM public.invoices WHERE id = ${manual}`)).toBe('t')
    const blocked = w.as('financeiro', `SELECT public.register_invoice_payment(${manual}, 300, 'ted', now(), 'Baixa recusada', NULL)`)
    expect(blocked.stderr).toMatch(/cancelamento com devolução integral/)
    w.asOk('financeiro', `SELECT public.cancel_financial_refund_authorization('manual', ${refund}, 'Cliente desistiu do cancelamento')`)
    expect(w.psql(`SELECT pix_payload IS NOT NULL FROM public.invoices WHERE id = ${manual}`)).toBe('t')
  })

  it('F-38 (decisão 18): Pix em duplicidade em fatura paga vira restituição pendente e sai da análise na devolução', () => {
    w.psql(`UPDATE public.app_settings SET pix_provider = 'itau' WHERE id = 1`)
    let b!: { id: string; invoice: number }
    try {
      b = issued('F38')
    } finally {
      w.psql(`UPDATE public.app_settings SET pix_provider = 'static' WHERE id = 1`)
    }
    const txid = w.psql(`SELECT txid FROM public.itau_pix_charges WHERE invoice_id = ${b.invoice} ORDER BY id DESC LIMIT 1`)
    expect(txid).not.toBe('')
    w.pay(b.invoice, 1000)
    expect(w.psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_settle('${e2e(1)}', '${txid}', 1000, now())`)).toBe('review')
    expect(w.psql(`SELECT origin || '|' || amount_brl || '|' || status FROM public.invoice_refunds WHERE itau_end_to_end_id = '${e2e(1)}'`))
      .toBe('pix_duplicate|1000.00|pending')
    // O recebimento duplicado não entra no recibo da fatura.
    expect(w.psql(`SELECT public._invoice_financial_summary(${b.invoice})->>'net_received_brl'`)).toBe('1000.00')
    const refund = w.psql(`SELECT id FROM public.invoice_refunds WHERE itau_end_to_end_id = '${e2e(1)}'`)
    w.asOk('financeiro', `SELECT public.confirm_invoice_refund(${refund}, 'DEV9312-1', 'Cliente FF9312', now() - interval '1 minute')`)
    expect(w.psql(`SELECT status FROM public.itau_pix_receipts WHERE end_to_end_id = '${e2e(1)}'`)).not.toBe('review')
  })

  it('F-38: Pix sem TXID fica gravado uma vez só; desde a 442 (ADR 0100) como recebido, sem Alerta', () => {
    const run = () => w.psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_record_untracked('${e2e(2)}', 123.45, now())`)
    expect(run()).toBe('received')
    expect(run()).toBe('received')
    expect(w.psql(`SELECT count(*) FROM public.itau_pix_receipts WHERE end_to_end_id = '${e2e(2)}' AND status = 'received'`)).toBe('1')
    expect(w.psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id WHERE ai.item_type = 'pix_unreconciled' AND a.entity_id = '${e2e(2)}' AND ai.status = 'active'`)).toBe('0')
    expect(w.as('financeiro', `SELECT public.itau_pix_record_untracked('${e2e(3)}', 1, now())`).status).not.toBe(0)
  })

  it('F-39: falha de reprocessamento do Portal fecha quando o B/L é faturado', () => {
    const id = w.createBl('F39')
    w.calculate(id)
    w.psql(`SET request.jwt.claim.role = 'service_role';
      SELECT public.block521_upsert_alert('portal_reprocessamento_falhou', 'bl', '${id}', 'Falha simulada', 'portal_activation', 'documentacao')`)
    const open = () => w.psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id WHERE ai.item_type = 'portal_reprocessamento_falhou' AND a.entity_id = '${id}' AND ai.status = 'active'`)
    expect(open()).toBe('1')
    w.issueByCe(id, '931200000000039')
    expect(open()).toBe('0')
  })

  it('F-40: restituição de Demurrage pendente abre Alerta e fecha na confirmação', () => {
    const id = w.createBl('F40')
    w.psql(`SET session_replication_role = replica;
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status, first_billed_at)
        VALUES (99931270, 'FF9312-DEM', '${id}', ${w.customerId}, 100, 5, 500, 'manual', 'paid', now());
      SET session_replication_role = origin;
      INSERT INTO public.demurrage_refunds (invoice_id, amount_brl, notes, registered_by, purpose, request_id)
        VALUES (99931270, 120, 'Devolver diferença', '${w.actors.financeiro}', 'correction', gen_random_uuid())`)
    const open = () => w.psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id WHERE ai.item_type = 'restituicao_pendente' AND a.entity_id = '99931270' AND ai.status = 'active'`)
    try {
      expect(open()).toBe('1')
      w.asOk('financeiro', `SELECT public.confirm_demurrage_refund((SELECT id FROM public.demurrage_refunds WHERE invoice_id = 99931270), 'DEV9312-40', 'Cliente FF9312', now() - interval '1 minute')`)
      expect(open()).toBe('0')
    } finally {
      w.psql(`SET session_replication_role = replica;
        DELETE FROM public.demurrage_refunds WHERE invoice_id = 99931270;
        DELETE FROM public.demurrage_invoices WHERE id = 99931270;
        SET session_replication_role = origin;`)
    }
  })

  it('F-35/F-52: o reprocesso automático emite as retidas pela conta de sistema configurada', () => {
    w.closeGate()
    const id = w.createBl('F35')
    w.calculate(id)
    w.psql(`SET request.jwt.claim.role = 'service_role'; DO $$ BEGIN PERFORM public.apply_ce_mercante_update('${id}', '931200000000099', '${w.actors.administrativo}'::uuid); END $$`)
    expect(w.psql(`SELECT count(*) FROM public.invoice_bls WHERE bl_id = '${id}'`)).toBe('0')
    w.psql(`INSERT INTO public.customer_billing_portal_releases (customer_id, justification, review_at, granted_by)
      VALUES (${w.customerId}, 'Liberação direta do teste', now() + interval '1 day', '${w.actors.administrativo}');
      UPDATE public.app_settings SET system_billing_actor = '${w.actors.financeiro}' WHERE id = 1`)
    w.psql(`SET request.jwt.claim.role = 'service_role'; SELECT public._reprocess_customer_held_billing_as_system(${w.customerId}, 'recovery_email')`)
    expect(w.psql(`SELECT i.issued_by FROM public.invoices i JOIN public.invoice_bls ib ON ib.invoice_id = i.id WHERE ib.bl_id = '${id}'`))
      .toBe(w.actors.financeiro)
    expect(w.psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'customer' AND entity_id = '${w.customerId}' AND field_name = 'held_billing_reprocessed'`)).toBe('1')
  })
})
