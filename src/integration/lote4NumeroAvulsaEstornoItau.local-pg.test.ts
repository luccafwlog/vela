import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Lote 4 do plano da frente financeira (migration 376): número da fatura em
// Brasília e sem truncar, Portal pela foto da emissão, avulsa, estorno de
// baixa com restituição e Pix Itaú, origem própria, obsoleta com pagamento,
// Alertas manuais e THD IMO+OOG sem item standard.

const w = financeWorld(9313)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'record_manual_invoice_lifecycle'`) === '1'
  } catch {
    return false
  }
}, 'migration 376 aplicada')

describeLocal('376 — Lote 4 da frente financeira', () => {
  beforeAll(() => {
    w.setup()
    w.table(1000)
  })
  afterAll(() => {
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'E9313%';
      DELETE FROM public.invoice_counters WHERE year = 2091;
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  let ce = 0
  function issued(name: string) {
    const id = w.createBl(name)
    w.calculate(id)
    ce += 1
    return { id, invoice: w.issueByCe(id, `9313${String(ce).padStart(11, '0')}`) }
  }

  it('F-43: o ano segue Brasília e o número não trunca a partir de 10.000', () => {
    const number = (issuedAt: string) => w.psql(`BEGIN;
      INSERT INTO public.invoice_counters (year, last_number) VALUES (2091, 9999) ON CONFLICT (year) DO UPDATE SET last_number = 9999;
      INSERT INTO public.invoices (customer_id, total_brl, balance_brl, invoice_type, status, issued_at)
        VALUES (${w.customerId}, 1, 1, 'manual', 'draft', '${issuedAt}') RETURNING invoice_number;
      ROLLBACK;`).split('\n').find((line) => line.startsWith('INV-'))
    // 31/12/2091 22:00 em Brasília é 01/01/2092 01:00 UTC.
    expect(number('2092-01-01T01:00:00Z')).toBe('INV-2091-10000')
  })

  it('F-45: a lista do Portal mostra a Viagem da emissão, não a de hoje', () => {
    const b = issued('F45')
    w.psql(`INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${w.voyageId + 50}, ${w.voyageId - 1}, 'FF9313-NOVA', 'active') ON CONFLICT (id) DO NOTHING;
      UPDATE public.bls SET voyage_id = ${w.voyageId + 50} WHERE id = '${b.id}'`)
    expect(w.psql(`SELECT array_to_string(voyages, ',') FROM public._portal_list_invoices_core(${w.customerId}) WHERE id = ${b.invoice}`)).toBe('FF9313')
  })

  it('F-46: avulsa para Cliente desativado é recusada; paga gera evento', () => {
    const create = (customer: number) => w.as('administrativo', `SELECT public.create_manual_invoice(${customer}, 'Serviço F46', 1, 300, NULL, NULL, NULL,
      '${w.actors.administrativo}'::uuid, p_reason => 'Avulsa do teste')`)
    w.psql(`SET session_replication_role = replica; UPDATE public.customers SET deactivated_at = now() WHERE id = ${w.otherCustomerId}`)
    try {
      expect(create(w.otherCustomerId).stderr).toMatch(/Cliente desativado/)
    } finally {
      w.psql(`SET session_replication_role = replica; UPDATE public.customers SET deactivated_at = NULL WHERE id = ${w.otherCustomerId}`)
    }
    const manual = (JSON.parse(w.asOk('administrativo', `SELECT public.create_manual_invoice(${w.customerId}, 'Serviço F46', 1, 300, NULL, NULL, NULL,
      '${w.actors.administrativo}'::uuid, p_reason => 'Avulsa do teste')`)) as { invoice_id: number }).invoice_id
    w.asOk('financeiro', `SELECT public.register_invoice_payment(${manual}, 300, 'ted', now(), 'Quitação', NULL)`)
    expect(w.psql(`SELECT string_agg(event_type, ',' ORDER BY id) FROM public.invoice_lifecycle_events WHERE invoice_id = ${manual}`)).toBe('issued,paid')
  })

  it('F-47: estorno cancela a restituição pendente (sem apagar) e devolve o Pix Itaú à análise', () => {
    const b = issued('F47')
    const e2e = 'E9313000000000000000000000000047'
    const payment = w.pay(b.invoice, 1200)
    w.psql(`UPDATE public.payments SET bank_reference = '${e2e}' WHERE id = ${payment.payment_id};
      INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status) VALUES ('${e2e}', 'VELA9313', 1200, now(), 'settled')`)
    const refund = w.psql(`SELECT id FROM public.invoice_refunds WHERE payment_id = ${payment.payment_id} AND status = 'pending'`)
    expect(refund).not.toBe('')
    w.reversePayment(payment.payment_id)
    expect(w.psql(`SELECT status FROM public.invoice_refunds WHERE id = ${refund}`)).toBe('cancelled')
    expect(w.psql(`SELECT status FROM public.itau_pix_receipts WHERE end_to_end_id = '${e2e}'`)).toBe('review')
  })

  it('F-47: excedente já devolvido impede o estorno da baixa', () => {
    const b = issued('F47B')
    const payment = w.pay(b.invoice, 1100)
    const refund = w.psql(`SELECT id FROM public.invoice_refunds WHERE payment_id = ${payment.payment_id}`)
    w.asOk('financeiro', `SELECT public.confirm_invoice_refund(${refund}, 'DEV9313-47', 'Cliente FF9313', now() - interval '1 minute')`)
    expect(w.as('administrativo', `SELECT public.reverse_invoice_payment(${payment.payment_id}, 'Estorno indevido')`).stderr).toMatch(/já foi devolvido/)
  })

  it('F-51: consolidada com pagamento não vira obsoleta', () => {
    const a = issued('F51A')
    const b = issued('F51B')
    const c = w.consolidate([a.id, b.id])
    w.pay(c, 500)
    expect(w.as('administrativo', `SELECT public.obsolete_consolidated_invoice(${c}, 'Obsoleta no teste', '${w.actors.administrativo}'::uuid)`).stderr)
      .toMatch(/com pagamento ou Pix recebido/)
  })

  it('F-53: Alerta manual de faturamento ignora B/L faturado; justificativa curta é recusada', () => {
    const b = issued('F53')
    expect(w.psql(`SELECT public.upsert_billing_alert('billing_calculation_blocked', '${b.id}', 'Forjado')->>'reason'`, w.actors.operacoes)).toBe('bl_not_pending')
    expect(w.as('administrativo', `SELECT public.resolve_stale_invoice(${b.invoice}, 'ok resolvido')`).stderr).toMatch(/15 caracteres/)
  })

  it('F-55: container IMO e OOG sem THD standard vai para revisão', () => {
    const id = w.createBl('F55')
    w.psql(`UPDATE public.bl_containers SET is_imo = true, is_oog = true WHERE bl_id = '${id}'`)
    const keys = w.psql(`SELECT string_agg(calculation_key, ',') FROM public.resolve_bl_local_charge_items('${id}', NULL)`)
    expect(keys).toContain('review:thd_imo_oog_without_standard')
  })
})

const describe377 = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'reopen_effects_blocked_by_missing_roe'`) === '1'
  } catch {
    return false
  }
}, 'migration 377 aplicada')

describe377('377 — câmbio gravado reabre o cálculo provisório (item 2c)', () => {
  // O gatilho de auditoria do câmbio grava o ator: precisa dos usuários do mundo.
  beforeAll(() => w.setup())
  afterAll(() => w.cleanup())

  it('efeito bloqueado por falta de ROE volta para a fila; outro bloqueio fica', () => {
    const ids = w.psql(`SET session_replication_role = replica;
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, status, attempts, last_error_code, last_error_message, created_by)
      VALUES (gen_random_uuid(), 'provisional_charges', 'FF9313-ROE', 'blocked', 1, 'invalid_effect_payload', 'Cambio (ROE) nao configurado; nao e possivel calcular o saldo de linhas em USD.', '${w.actors.administrativo}'),
             (gen_random_uuid(), 'provisional_charges', 'FF9313-OUT', 'blocked', 1, 'effect_domain_refused', 'Outro motivo', '${w.actors.administrativo}')
      RETURNING id;
      SET session_replication_role = origin;`).split('\n').filter(Boolean)
    try {
      // Na mesma transação, desfeita: o câmbio do banco de teste não muda.
      expect(w.psql(`BEGIN;
        INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, 5.5, CURRENT_DATE)
          ON CONFLICT (id) DO UPDATE SET roe = EXCLUDED.roe;
        SELECT string_agg(status, ',' ORDER BY id) FROM public.import_pending_effects WHERE id IN (${ids.join(',')});
        ROLLBACK;`)).toBe('retry_wait,blocked')
    } finally {
      w.psql(`DELETE FROM public.import_pending_effects WHERE id IN (${ids.join(',')})`)
    }
  })
})
