import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Migration 442 (ADR 0100): todo Pix da consulta do Itaú fica gravado. O de
// cobrança do Vela segue para a baixa automática; o resto vira "recebido", sem
// baixa nem Alerta, com o retorno do banco. A aba Pix recebidos lê tudo, o
// pagador só para Financeiro e Administrativo, e a baixa numa fatura é opção
// do operador.

const w = financeWorld(9442)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'itau_pix_receive'`) === '1'
  } catch {
    return false
  }
}, 'migration 442 aplicada')

type Row = {
  end_to_end_id: string; txid: string; origin: string; amount_brl: number; situation: string; settled_by: string | null
  settled_source: string | null; settled_doc_number: string | null; payer_name: string | null; payer_document: string | null
  payer_message: string | null; pix_key: string | null; raw: Record<string, unknown> | null
}
type Listing = { total: number; total_amount_brl: number; payer_visible: boolean; rows: Row[] }
type Candidate = { source: string; invoice_id: number; doc_number: string; same_amount: boolean; same_customer: boolean }

describeLocal('442 — Pix recebidos', () => {
  const e2e = (n: number) => `E9442${String(n).padStart(27, '0')}`
  const demurrageId = 99_944_201
  const raw = (n: number, extra: Record<string, unknown> = {}) => JSON.stringify({ endToEndId: e2e(n), chave: 'chave-transhipping', ...extra })
  const receive = (n: number, txid: string, amount: number, extra: Record<string, unknown> = {}) =>
    w.psql(`SELECT public.itau_pix_receive('${e2e(n)}', '${txid}', ${amount}, now() - interval '${n} minutes', '${raw(n, extra)}'::jsonb)`)
  const receipt = (n: number) => w.psql(`SELECT status FROM public.itau_pix_receipts WHERE end_to_end_id = '${e2e(n)}'`)
  const openAlerts = (n: number) => Number(w.psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
    WHERE ai.item_type = 'pix_unreconciled' AND a.entity_id = '${e2e(n)}' AND ai.status = 'active'`))
  const list = (role: 'financeiro' | 'operacoes', args = '') =>
    w.json<Listing>(role, `SELECT public.list_itau_pix_receipts(${args || 'p_search => \'E9442\''})`)
  const row = (n: number, role: 'financeiro' | 'operacoes' = 'financeiro') =>
    list(role, `p_search => '${e2e(n)}'`).rows.find((r) => r.end_to_end_id === e2e(n))

  beforeAll(() => {
    w.setup()
    w.table(1000)
  })
  afterAll(() => {
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT ai.id FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id WHERE a.entity_id LIKE 'E9442%');
      DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id LIKE 'E9442%');
      DELETE FROM public.alerts WHERE entity_id LIKE 'E9442%';
      DELETE FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'E9442%';
      DELETE FROM public.demurrage_mutation_requests WHERE invoice_id = ${demurrageId};
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  let ce = 0
  function issued(name: string) {
    const id = w.createBl(name)
    w.calculate(id)
    ce += 1
    return { id, invoice: w.issueByCe(id, `9442${String(ce).padStart(11, '0')}`) }
  }
  const customerDocument = () => w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.customerId}`)

  it('Pix sem TXID, de outro sistema e de teste ficam gravados como recebidos, sem Alerta e uma vez só', () => {
    expect(receive(1, '', 120, { infoPagador: 'Pagamento B/L 123', pagador: { nome: 'Pagador Sem TXID', cpf: '123.456.789-09' } })).toBe('received')
    expect(receive(1, '', 120)).toBe('received')
    expect(receive(2, '88ba8ec675e044178d434908d9b2a30a', 50)).toBe('received')
    expect(receive(3, 'VELATABCDEFGHIJKLMNOPQRSTUVWXYZ0', 0.01)).toBe('received')
    expect(w.psql(`SELECT count(*) FROM public.itau_pix_receipts WHERE end_to_end_id IN ('${e2e(1)}', '${e2e(2)}', '${e2e(3)}') AND status = 'received'`)).toBe('3')
    expect(openAlerts(1) + openAlerts(2) + openAlerts(3)).toBe(0)
    // O primeiro retorno fica: a repetição pela sobreposição não o troca.
    expect(w.psql(`SELECT raw->'pagador'->>'nome' FROM public.itau_pix_receipts WHERE end_to_end_id = '${e2e(1)}'`)).toBe('Pagador Sem TXID')
  })

  it('Pix de cobrança do Vela segue para a baixa automática: TXID sem cobrança vai para análise com Alerta', () => {
    expect(receive(4, `VELA${'A'.repeat(28)}`, 10)).toBe('review')
    expect(openAlerts(4)).toBe(1)
    expect(w.psql(`SELECT raw->>'chave' FROM public.itau_pix_receipts WHERE end_to_end_id = '${e2e(4)}'`)).toBe('chave-transhipping')
  })

  it('a Edge antiga, pelo registro de Pix sem TXID, também grava recebido sem Alerta', () => {
    expect(w.psql(`SELECT public.itau_pix_record_untracked('${e2e(5)}', 75, now())`)).toBe('received')
    expect(openAlerts(5)).toBe(0)
  })

  it('só o sistema grava Pix recebido', () => {
    expect(w.as('financeiro', `SELECT public.itau_pix_receive('${e2e(6)}', '', 1, now(), NULL)`).status).not.toBe(0)
    expect(receipt(6)).toBe('')
  })

  it('a lista traz todos os Pix; o pagador só para o Financeiro e o Administrativo', () => {
    const finance = list('financeiro')
    expect(finance.payer_visible).toBe(true)
    expect(finance.rows.map((r) => r.end_to_end_id)).toEqual(expect.arrayContaining([e2e(1), e2e(2), e2e(3), e2e(4), e2e(5)]))
    expect(row(1)).toMatchObject({ origin: 'none', situation: 'received', payer_name: 'Pagador Sem TXID', payer_document: '12345678909',
      payer_message: 'Pagamento B/L 123', pix_key: 'chave-transhipping' })
    expect(row(2)).toMatchObject({ origin: 'other', situation: 'received' })
    expect(row(3)).toMatchObject({ origin: 'test', situation: 'received' })
    expect(row(4)).toMatchObject({ origin: 'vela', situation: 'review' })

    const operations = list('operacoes')
    expect(operations.payer_visible).toBe(false)
    expect(row(1, 'operacoes')).toMatchObject({ payer_name: null, payer_document: null, payer_message: null, raw: null, pix_key: 'chave-transhipping' })
    // Quem não vê o pagador também não acha o Pix pelo nome dele.
    expect(list('operacoes', `p_search => 'Pagador Sem'`).total).toBe(0)
    expect(list('financeiro', `p_search => 'Pagador Sem'`).total).toBe(1)
    expect(list('financeiro', `p_search => '123.456.789-09'`).rows.map((r) => r.end_to_end_id)).toEqual([e2e(1)])
  })

  it('filtra por origem, situação, valor e período de Brasília', () => {
    expect(list('financeiro', `p_search => 'E9442', p_origin => 'other'`).rows.map((r) => r.end_to_end_id)).toEqual([e2e(2)])
    expect(list('financeiro', `p_search => 'E9442', p_situation => 'review'`).rows.map((r) => r.end_to_end_id)).toEqual([e2e(4)])
    expect(list('financeiro', `p_search => 'E9442', p_amount_brl => 50`).rows.map((r) => r.end_to_end_id)).toEqual([e2e(2)])
    expect(list('financeiro', `p_search => 'E9442', p_to => (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1`).total).toBe(0)
    expect(w.as('financeiro', `SELECT public.list_itau_pix_receipts(p_situation => 'qualquer')`).stderr).toMatch(/Situação desconhecida/)
  })

  it('baixa opcional numa fatura de Taxas Locais: sugere pelo valor e pelo documento do pagador e grava o endToEndId', () => {
    const b = issued('TAXA')
    const total = w.invoice(b.invoice).total
    expect(receive(7, '', total, { pagador: { nome: 'Cliente FF9442-0', cnpj: customerDocument() } })).toBe('received')
    const candidates = w.json<Candidate[]>('financeiro', `SELECT public.list_itau_pix_receipt_candidates('${e2e(7)}')`)
    expect(candidates[0]).toMatchObject({ source: 'local', invoice_id: b.invoice, same_amount: true, same_customer: true })
    const docNumber = candidates[0].doc_number
    expect(w.json<Candidate[]>('financeiro', `SELECT public.list_itau_pix_receipt_candidates('${e2e(7)}', '${docNumber.toLowerCase()}')`)
      .map((c) => c.invoice_id)).toEqual([b.invoice])
    expect(w.as('operacoes', `SELECT public.list_itau_pix_receipt_candidates('${e2e(7)}')`).stderr).toMatch(/Sem permissão/)
    expect(w.as('operacoes', `SELECT public.itau_pix_settle_received('${e2e(7)}', 'local', ${b.invoice})`).stderr).toMatch(/Sem permissão/)

    w.asOk('financeiro', `SELECT public.itau_pix_settle_received('${e2e(7)}', 'local', ${b.invoice})`)
    expect(w.invoice(b.invoice).status).toBe('paid')
    expect(w.psql(`SELECT bank_reference FROM public.payments WHERE invoice_id = ${b.invoice}`)).toBe(e2e(7))
    expect(row(7)).toMatchObject({ situation: 'settled', settled_by: 'manual', settled_source: 'local', settled_doc_number: docNumber })
    expect(w.as('financeiro', `SELECT public.itau_pix_settle_received('${e2e(7)}', 'local', ${b.invoice})`).stderr).toMatch(/já tem baixa/)

    // Cancelar a baixa devolve o Pix a "Sem baixa", sem Alerta.
    const payment = Number(w.psql(`SELECT id FROM public.payments WHERE invoice_id = ${b.invoice}`))
    w.reversePayment(payment)
    expect(receipt(7)).toBe('received')
    expect(row(7)).toMatchObject({ situation: 'received', settled_doc_number: null })
    expect(openAlerts(7)).toBe(0)
    // Cancelada, a baixa do mesmo Pix pode ser dada de novo (migration 443).
    w.asOk('financeiro', `SELECT public.itau_pix_settle_received('${e2e(7)}', 'local', ${b.invoice})`)
    expect(row(7)).toMatchObject({ situation: 'settled', settled_doc_number: docNumber })
  })

  it('baixa opcional numa Invoice de Demurrage aberta pelo valor dela', () => {
    // B/L sem container: a Invoice de Demurrage só nasce com todos devolvidos.
    const blId = w.bl('DEM')
    w.psql(`INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('${blId}', ${w.voyageId}, ${w.customerId}, 'CE9442DEM')`)
    w.psql(`INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status)
      VALUES (${demurrageId}, 'DEM-9442', '${blId}', ${w.customerId}, 100, 5.5, 550, 'manual', 'issued')`)
    expect(receive(8, '', 549)).toBe('received')
    expect(w.as('financeiro', `SELECT public.itau_pix_settle_received('${e2e(8)}', 'demurrage', ${demurrageId})`).stderr).toMatch(/Valor divergente/)
    expect(receive(9, '', 550)).toBe('received')
    expect(w.json<Candidate[]>('financeiro', `SELECT public.list_itau_pix_receipt_candidates('${e2e(9)}')`))
      .toEqual(expect.arrayContaining([expect.objectContaining({ source: 'demurrage', invoice_id: demurrageId, same_amount: true })]))
    w.asOk('financeiro', `SELECT public.itau_pix_settle_received('${e2e(9)}', 'demurrage', ${demurrageId})`)
    expect(w.psql(`SELECT status || ' ' || pix_txid FROM public.demurrage_invoices WHERE id = ${demurrageId}`)).toBe(`paid ${e2e(9)}`)
    expect(row(9)).toMatchObject({ situation: 'settled', settled_by: 'manual', settled_source: 'demurrage', settled_doc_number: 'DEM-9442' })
    expect(w.as('financeiro', `SELECT public.itau_pix_settle_received('${e2e(8)}', 'demurrage', ${demurrageId})`).stderr).toMatch(/não está aberta/)
  })

  it('o Pix de cobrança do Vela não recebe baixa por aqui', () => {
    const b = issued('VELA')
    expect(w.as('financeiro', `SELECT public.itau_pix_settle_received('${e2e(4)}', 'local', ${b.invoice})`).stderr).toMatch(/cobrança do Vela/)
  })
})
