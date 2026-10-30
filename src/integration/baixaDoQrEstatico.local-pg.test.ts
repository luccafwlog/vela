import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Migrations 545 e 546 (ADR 0115), a partir do caso do staging de 2026-10-30:
// duas baixas manuais parciais, uma em cada B/L, a consolidada do que sobrou
// paga pelo QR estático no Portal. O Pix ficou como "ZPT" e sem baixa, e o
// Histórico de baixas escondeu as duas baixas manuais e repetiu o valor da
// consolidada em cada B/L.

const w = financeWorld(9545)
const actor = '00000000-0000-0000-9545-000000000099'
const demurrageId = 99_954_501

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('_itau_pix_settle_static', 'list_payment_history')`) === '2'
  } catch {
    return false
  }
}, 'migrations 545 e 546 aplicadas')

type ReceiptRow = { end_to_end_id: string; origin: string; situation: string; settled_by: string | null
  settled_source: string | null; settled_doc_number: string | null; reason: string | null }
type HistoryRow = { source: string; invoice_id: number; doc_number: string; invoice_status: string; payment_id: number | null
  paid_at: string; method: string; bank_reference: string | null; bl_id: string | null; bl_count: number
  bl_amount_brl: number; amount_brl: number; payment_amount_brl: number }

describeLocal('545 e 546 — Pix do QR estático e Histórico de baixas', () => {
  const e2e = (n: number) => `E9545${String(n).padStart(27, '0')}`
  let previousSettings = ''
  let ce = 0

  const origin = (txid: string) => w.psql(`SELECT public._itau_pix_origin('${txid}')`)
  const receive = (n: number, txid: string, amount: number) =>
    w.psql(`SELECT public.itau_pix_receive('${e2e(n)}', '${txid}', ${amount}, now() - interval '${n} minutes', '{"chave": "06352972000121"}'::jsonb)`)
  const receipt = (n: number) => w.json<{ rows: ReceiptRow[] }>('financeiro',
    `SELECT public.list_itau_pix_receipts(p_search => '${e2e(n)}')`).rows.find((r) => r.end_to_end_id === e2e(n))
  const openAlerts = (n: number) => Number(w.psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
    WHERE ai.item_type = 'pix_unreconciled' AND a.entity_id = '${e2e(n)}' AND ai.status = 'active'`))
  const history = () => w.json<HistoryRow[]>('operacoes', `SELECT public.list_payment_history(${w.customerId})`)
  /** Identificador do QR estático em vigor: a versão de cobrança mais nova. */
  const staticTxid = (invoiceId: number) =>
    w.psql(`SELECT txid FROM public.local_pix_charge_versions WHERE invoice_id = ${invoiceId} ORDER BY id DESC LIMIT 1`)
  const docNumber = (invoiceId: number) => w.psql(`SELECT invoice_number FROM public.invoices WHERE id = ${invoiceId}`)
  function issued(name: string) {
    const id = w.createBl(name)
    w.calculate(id)
    ce += 1
    return { bl: id, invoice: w.issueByCe(id, `9545${String(ce).padStart(11, '0')}`) }
  }

  beforeAll(() => {
    w.setup()
    w.table(1000)
    previousSettings = w.psql(`SELECT pix_provider || '|' || coalesce(itau_pix_settlement_actor::text, '') FROM public.app_settings WHERE id = 1`)
    // Conta da baixa automática como em produção (migration 440): integração com o papel Financeiro.
    w.psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actor}', 'api-itau-9545@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active, account_kind) VALUES ('${actor}', 'API ITAU 9545', 'financeiro', true, 'integracao');
      UPDATE public.app_settings SET pix_provider = 'static', itau_pix_settlement_actor = '${actor}' WHERE id = 1;`)
  })
  afterAll(() => {
    const [provider, settlementActor] = previousSettings.split('|')
    w.psql(`UPDATE public.app_settings SET pix_provider = '${provider || 'static'}',
      itau_pix_settlement_actor = ${settlementActor ? `'${settlementActor}'` : 'NULL'} WHERE id = 1`)
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'E9545%';
      DELETE FROM public.demurrage_mutation_requests WHERE invoice_id = ${demurrageId};
      SET session_replication_role = origin;`)
    w.cleanup()
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.financial_payment_attempts WHERE created_by = '${actor}';
      DELETE FROM public.audit_logs WHERE changed_by = '${actor}';
      DELETE FROM public.user_profiles WHERE id = '${actor}';
      DELETE FROM auth.users WHERE id = '${actor}';
      SET session_replication_role = origin;`)
  })

  it('a origem vem do identificador: o QR estático é do Vela, não da ZPT', () => {
    expect(origin('INV20260005')).toBe('static')
    expect(origin('DEM20260001')).toBe('static')
    expect(origin('VPB655B72EE4E48872F6BDC7A')).toBe('static')
    // Formatos vistos na produção em 2026-10-30 (ZPT) e o de outro sistema da suíte 442.
    expect(origin('PIX6adb995aaca17199566139364dc')).toBe('other')
    expect(origin('88ba8ec675e044178d434908d9b2a30a')).toBe('other')
    expect(origin(`VELA${'A'.repeat(28)}`)).toBe('vela')
    expect(origin('')).toBe('none')
  })

  it('caso do staging: baixas manuais parciais nos dois B/Ls e a consolidada paga pelo QR estático dá baixa automática', () => {
    const a = issued('A')
    const b = issued('B')
    const partialA = w.pay(a.invoice, 999).payment_id
    const partialB = w.pay(b.invoice, 999.5).payment_id
    const consolidated = w.consolidate([a.bl, b.bl])
    expect(w.invoice(consolidated)).toMatchObject({ status: 'issued', total: 1.5, balance: 1.5 })
    const txid = staticTxid(consolidated)
    expect(txid).toBe(docNumber(consolidated).replace(/[^A-Z0-9]/g, ''))
    expect(w.psql(`SELECT pix_payload LIKE '%${txid}%' FROM public.invoices WHERE id = ${consolidated}`)).toBe('t')

    expect(receive(1, txid, 1.5)).toBe('settled')
    expect(w.invoice(consolidated)).toMatchObject({ status: 'paid', balance: 0 })
    expect(w.invoice(a.invoice).status).toBe('covered')
    expect(w.invoice(b.invoice).status).toBe('covered')
    expect(w.psql(`SELECT registered_by || '|' || bank_reference FROM public.payments WHERE invoice_id = ${consolidated}`))
      .toBe(`${actor}|${e2e(1)}`)
    expect(w.psql(`SELECT string_agg(DISTINCT source, ',') FROM public.ledger_settlements WHERE invoice_id = ${consolidated}`)).toBe('itau_pix')
    expect(receipt(1)).toMatchObject({ origin: 'static', situation: 'settled', settled_by: 'itau', settled_source: 'local',
      settled_doc_number: docNumber(consolidated), reason: null })
    expect(openAlerts(1)).toBe(0)

    // Histórico: as quatro baixas por B/L, com a forma e o valor de cada uma.
    const rows = history().filter((r) => [a.invoice, b.invoice, consolidated].includes(r.invoice_id))
    const paymentC = Number(w.psql(`SELECT id FROM public.payments WHERE invoice_id = ${consolidated}`))
    const view = rows.map((r) => [r.doc_number, r.bl_id, r.payment_id, r.method, r.amount_brl, r.bl_amount_brl, r.invoice_status])
    expect(view).toEqual(expect.arrayContaining([
      [docNumber(a.invoice), a.bl, partialA, 'manual', 999, 1000, 'covered'],
      [docNumber(b.invoice), b.bl, partialB, 'manual', 999.5, 1000, 'covered'],
      [docNumber(consolidated), a.bl, paymentC, 'itau', 1, 1, 'paid'],
      [docNumber(consolidated), b.bl, paymentC, 'itau', 0.5, 0.5, 'paid'],
    ]))
    expect(rows).toHaveLength(4)
    expect(rows.reduce((sum, r) => sum + r.amount_brl, 0)).toBe(2000)
  })

  it('segundo Pix no mesmo QR estático fica recebido com o motivo, sem baixa nem Alerta', () => {
    const consolidated = Number(w.psql(`SELECT id FROM public.invoices WHERE customer_id = ${w.customerId} AND invoice_type = 'consolidated' AND status = 'paid'`))
    expect(receive(2, staticTxid(consolidated), 1.5)).toBe('received')
    expect(receipt(2)).toMatchObject({ origin: 'static', situation: 'received', settled_by: null })
    expect(receipt(2)?.reason).toMatch(/^Sem baixa automática: Nenhuma fatura aberta com este identificador/)
    expect(openAlerts(2)).toBe(0)
    expect(w.psql(`SELECT count(*) FROM public.payments WHERE invoice_id = ${consolidated}`)).toBe('1')
  })

  it('valor diferente do QR fica recebido com o motivo e a fatura continua aberta', () => {
    const c = issued('C')
    expect(receive(3, staticTxid(c.invoice), 999.99)).toBe('received')
    expect(receipt(3)?.reason).toMatch(/Valor recebido difere do valor do QR/)
    expect(w.invoice(c.invoice).status).toBe('issued')
    expect(openAlerts(3)).toBe(0)
  })

  it('com a cobrança Itaú ligada, o Pix do QR estático não dá baixa sozinho: pode ser do staging na mesma conta', () => {
    const d = issued('D')
    const txid = staticTxid(d.invoice)
    w.psql(`UPDATE public.app_settings SET pix_provider = 'itau' WHERE id = 1`)
    try {
      expect(receive(4, txid, w.invoice(d.invoice).total)).toBe('received')
    } finally {
      w.psql(`UPDATE public.app_settings SET pix_provider = 'static' WHERE id = 1`)
    }
    expect(w.invoice(d.invoice).status).toBe('issued')
    expect(receipt(4)).toMatchObject({ origin: 'static', situation: 'received' })
    expect(receipt(4)?.reason).toMatch(/aqui a cobrança é pela API do Itaú/)
    // O operador ainda pode baixar à mão pela aba, como qualquer Pix recebido.
    w.asOk('financeiro', `SELECT public.itau_pix_settle_received('${e2e(4)}', 'local', ${d.invoice})`)
    expect(receipt(4)).toMatchObject({ situation: 'settled', settled_by: 'manual' })
  })

  it('Pix já baixado à mão com o identificador antes da consulta não ganha segunda baixa', () => {
    const e = issued('E')
    const total = w.invoice(e.invoice).total
    w.asOk('financeiro', `SELECT public.register_verified_invoice_payment(${e.invoice}, ${total}, 'pix', now(), 'Baixa manual', gen_random_uuid(), '${e2e(5)}')`)
    expect(receive(5, staticTxid(e.invoice), total)).toBe('received')
    expect(receipt(5)).toMatchObject({ situation: 'settled', settled_by: 'manual', reason: null })
    expect(w.psql(`SELECT count(*) FROM public.payments WHERE invoice_id = ${e.invoice}`)).toBe('1')
  })

  it('avulsa e Invoice de Demurrage pelo QR estático também dão baixa automática', () => {
    const manual = Number(w.psql(`INSERT INTO public.invoices (invoice_number, customer_id, total_brl, balance_brl, invoice_type, status)
      VALUES ('INV-9545-0001', ${w.customerId}, 80.25, 80.25, 'manual', 'issued') RETURNING id`))
    expect(receive(6, 'INV95450001', 80.25)).toBe('settled')
    expect(w.invoice(manual).status).toBe('paid')
    expect(w.psql(`SELECT registered_by || '|' || bank_reference FROM public.payments WHERE invoice_id = ${manual}`)).toBe(`${actor}|${e2e(6)}`)

    const blId = w.bl('DEM')
    w.psql(`INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('${blId}', ${w.voyageId}, ${w.customerId}, 'CE9545DEM')`)
    w.psql(`INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status)
      VALUES (${demurrageId}, 'DEM-9545-0001', '${blId}', ${w.customerId}, 100, 5.5, 550, 'manual', 'issued')`)
    expect(receive(7, 'DEM95450001', 550)).toBe('settled')
    expect(w.psql(`SELECT status || ' ' || pix_txid || ' ' || payment_method FROM public.demurrage_invoices WHERE id = ${demurrageId}`))
      .toBe(`paid ${e2e(7)} pix_itau`)
    expect(receipt(7)).toMatchObject({ origin: 'static', situation: 'settled', settled_by: 'itau', settled_source: 'demurrage' })

    const rows = history()
    expect(rows.find((r) => r.invoice_id === manual)).toMatchObject({ source: 'local', method: 'itau', bl_id: null, bl_count: 0, amount_brl: 80.25 })
    expect(rows.find((r) => r.source === 'demurrage' && r.invoice_id === demurrageId))
      .toMatchObject({ method: 'itau', amount_brl: 550, bank_reference: e2e(7), bl_id: blId })
  })

  it('o histórico separa a baixa pelo extrato e a baixa à mão de um Pix recebido', () => {
    const f = issued('F')
    const total = w.invoice(f.invoice).total
    w.json('financeiro', `SELECT public.register_ledger_invoice_payment(${f.invoice}, ${total}, 'pix', now(), 'VELA${'F'.repeat(28)}', 'pix_extract', 'Extrato', NULL)`)
    const g = issued('G')
    expect(receive(8, '', w.invoice(g.invoice).total)).toBe('received')
    w.asOk('financeiro', `SELECT public.itau_pix_settle_received('${e2e(8)}', 'local', ${g.invoice})`)

    const rows = history()
    expect(rows.find((r) => r.invoice_id === f.invoice)).toMatchObject({ method: 'extract', bl_id: f.bl, amount_brl: total })
    expect(rows.find((r) => r.invoice_id === g.invoice)).toMatchObject({ method: 'manual', bank_reference: e2e(8) })
  })

  it('o histórico é leitura de usuário interno ativo', () => {
    expect(() => w.psql(`SET request.jwt.claim.sub = ''; SELECT public.list_payment_history()`)).toThrow(/Sem permissão/)
    expect(w.as('financeiro', `SELECT public.list_payment_history(${w.customerId})`).status).toBe(0)
  })
})
