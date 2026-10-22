import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// ADR 0094, B5 (migration 381; plano da frente financeira, F-32 e 2f): a
// reimportação de carga solta só muda o que afeta a cobrança do B/L faturado
// com a confirmação de faturamento, conferida no servidor; a prévia mostra a
// fatura e o valor antes → depois; `bb_cbm` sozinho entra na correção; e a
// reemissão que não pode sair (B/L misto) não cancela a fatura.

const w = financeWorld(9317)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'preview_breakbulk_billing_changes'`) === '1'
  } catch {
    return false
  }
}, 'migration 381 aplicada')

describeLocal('381 — carga solta faturada com confirmação', () => {
  beforeAll(() => {
    w.setup()
    w.table(1000)
    w.table(100, { cargoMode: 'carga_solta', basis: 'weight_ton' })
  })
  afterAll(() => {
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.bl_breakbulk_items WHERE bl_id LIKE '${w.prefix}%';
      DELETE FROM public.import_batches WHERE voyage_id = ${w.voyageId};
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  let ce = 0
  const row = (id: string, weight: number, extra: Record<string, unknown> = {}) => ({
    id, voyage_id: w.voyageId, bb_machine_qty: 1, bb_packages_qty: 2, bb_packages_total: 2, bb_weight_ton: weight, bb_cbm: 3,
    shipper: 'S', consignee: 'C', notify_party: 'N', customer_id: w.customerId, suggested_customer_id: null,
    manifest_customer_cnpj_cpf: null, manifest_customer_name: 'C', manifest_customer_email: null,
    customer_reconciliation_status: 'matched_document', customer_reconciliation_notes: null, billing_hold_reason: null,
    pol: 'CNSHA', pod: w.pod, cargo_description: 'MAQUINA', ncm_codes: [], review_status: 'ok', financial_status: 'pending', notes: null,
    ...extra,
  })
  function importBb(rows: Array<ReturnType<typeof row>>) {
    w.psql(`SET session_replication_role = replica;
      UPDATE public.import_batches SET uploaded_at = uploaded_at - interval '10 minutes' WHERE uploaded_by = '${w.actors.operacoes}';
      SET session_replication_role = origin;`)
    const items = rows.map((r) => ({ bl_id: r.id, item_description: 'MAQUINA', package_qty: 2, package_unit: 'PACKAGES', gross_weight_kg: 5000, cbm: 3, marks: null }))
    return w.json<{ billing_locked: Array<{ bl_id: string; fields: string[] }> }>('operacoes',
      `SELECT public.import_breakbulk_manifest_transactional('ff9317.pdf', ${w.voyageId}, '${w.actors.operacoes}'::uuid, ${rows.length},
        '${JSON.stringify(rows)}'::jsonb, '${JSON.stringify(items)}'::jsonb, '[]'::jsonb)`)
  }
  function billedBb(name: string) {
    const id = w.bl(name)
    importBb([row(id, 5)])
    ce += 1
    return { id, invoice: w.issueByCe(id, `9317${String(ce).padStart(11, '0')}`) }
  }

  it('sem a confirmação, peso, CBM, volumes e máquinas do B/L faturado ficam e voltam em billing_locked', () => {
    const b = billedBb('LOCK')
    expect(w.invoice(b.invoice).total).toBe(500)
    const result = importBb([row(b.id, 7, { bb_cbm: 4, bb_packages_qty: 3, bb_machine_qty: 2 })])
    expect(result.billing_locked).toEqual([{ bl_id: b.id, fields: ['peso', 'cbm', 'volumes', 'maquinas'] }])
    expect(w.psql(`SELECT bb_weight_ton || '|' || bb_cbm || '|' || bb_packages_qty || '|' || bb_machine_qty FROM public.bls WHERE id = '${b.id}'`))
      .toBe('5.000|3.000|2.000|1.000')
    expect(w.invoice(b.invoice).status).toBe('issued')
  })

  it('a prévia mostra a fatura e o valor antes → depois; com a confirmação, a fatura é reemitida', () => {
    const b = billedBb('OK')
    const preview = w.json<Array<{ bl_id: string; invoices: string[]; before_brl: number; after_brl: number; status: string }>>('operacoes',
      `SELECT public.preview_breakbulk_billing_changes(${w.voyageId}, '${JSON.stringify([row(b.id, 7)])}'::jsonb)`)
    const number = w.psql(`SELECT invoice_number FROM public.invoices WHERE id = ${b.invoice}`)
    expect(preview).toEqual([{ bl_id: b.id, invoices: [number], before_brl: 500, after_brl: 700, status: 'ok', reason: null }])
    // A prévia não grava nada.
    expect(w.psql(`SELECT bb_weight_ton FROM public.bls WHERE id = '${b.id}'`)).toBe('5.000')
    importBb([row(b.id, 7, { override_billing: true })])
    expect(w.invoice(b.invoice).status).toBe('cancelled')
    expect(w.invoice(w.successorOf(b.invoice)!).total).toBe(700)
  })

  it('F-32 e 2f: bb_cbm sozinho no B/L de container faturado entra na correção; a reemissão bloqueada (misto) não cancela a fatura', () => {
    const id = w.createBl('MISTO')
    w.calculate(id)
    ce += 1
    const invoice = w.issueByCe(id, `9317${String(ce).padStart(11, '0')}`)
    w.psql(`UPDATE public.bls SET bb_cbm = 4 WHERE id = '${id}'`)
    expect(w.psql(`SELECT cargo_mode FROM public.bls WHERE id = '${id}'`)).toBe('misto')
    expect(w.invoice(invoice).status).toBe('issued')
    expect(w.successorOf(invoice)).toBeNull()
    expect(w.activeInvoiceAlerts('fatura_desatualizada', invoice)).toBe(1)
    expect(w.psql(`SELECT error_message FROM public.invoice_basis_pending_changes WHERE bl_id = '${id}'`)).toMatch(/Reemissão bloqueada: review:mixed_bl_terminal_conflict/)
  })
})
