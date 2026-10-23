import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Migration 385: achados da revisão final da PR luccafwlog/vela#1019 (ADRs
// 0093 e 0094), cada um com o caso que falhava antes.

const w = financeWorld(9319)
const omissionId = 99931980
const dst = 'FF9319DST'
const e2e = (n: number) => `E9319${String(n).padStart(27, '0')}`
const REFUSED = /Taxas Locais do B\/L .* não calculadas: falha simulada/

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'release_bls_of_closed_consolidated'`) === '1'
  } catch {
    return false
  }
}, 'migration 385 aplicada')

describeLocal('385 — revisão final da frente financeira', () => {
  let savedRoe = ''
  let baseTable = 0
  let baseItem = 0

  beforeAll(() => {
    w.setup()
    savedRoe = w.psql(`SELECT coalesce(roe::text, '') || '|' || coalesce(effective_date::text, '') FROM public.exchange_rate_reference WHERE id = 1`)
    setRoe(5)
    ;[baseTable, baseItem] = w.table(1000)
  })
  afterAll(() => {
    if (savedRoe) {
      const [roe, date] = savedRoe.split('|')
      w.psql(`UPDATE public.exchange_rate_reference SET roe = ${roe}, effective_date = '${date}' WHERE id = 1`)
    }
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.itau_pix_receipt_failures WHERE failure_key LIKE 'E9319%';
      DELETE FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'E9319%';
      DELETE FROM public.invoice_refunds WHERE itau_end_to_end_id LIKE 'E9319%';
      DELETE FROM public.cod_adjustments WHERE bl_id LIKE '${w.prefix}%';
      DELETE FROM public.bl_transshipments WHERE omission_id = ${omissionId};
      DELETE FROM public.voyage_omissions WHERE id = ${omissionId};
      DELETE FROM public.pricing_rule_versions WHERE charge_table_id IN (SELECT id FROM public.charge_tables WHERE pod = '${dst}');
      DELETE FROM public.charge_table_items WHERE charge_table_id IN (SELECT id FROM public.charge_tables WHERE pod = '${dst}');
      DELETE FROM public.charge_tables WHERE pod = '${dst}';
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  function setRoe(roe: number) {
    w.psql(`INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, ${roe}, CURRENT_DATE)
      ON CONFLICT (id) DO UPDATE SET roe = EXCLUDED.roe, effective_date = EXCLUDED.effective_date`)
  }
  let ce = 0
  function issued(name: string) {
    const id = w.createBl(name)
    w.calculate(id)
    ce += 1
    return { id, invoice: w.issueByCe(id, `9319${String(ce).padStart(11, '0')}`) }
  }
  const onlyBaseTable = () => w.psql(`UPDATE public.charge_tables SET active = (id = ${baseTable}) WHERE pod = '${w.pod}'`)

  it('COD de B/L faturado com linha em dólar usa o câmbio fixado: sem diferença, sem ajuste', () => {
    w.psql(`UPDATE public.charge_tables SET active = false WHERE pod = '${w.pod}'`)
    const [, usdItem] = w.table(0)
    w.psql(`UPDATE public.charge_table_items SET currency = 'USD', unit_value_usd = 100, unit_value_brl = NULL, value_brl = 0 WHERE id = ${usdItem};
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (99931990, 'Tabela FF9319 destino', '${dst}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_usd, application_basis, category, cargo_profile, currency)
        VALUES (99931991, 99931990, 'Taxa destino', 'container', 0, 100, 'container_distinct_voyage', 'base', 'any', 'USD');
      INSERT INTO public.voyage_omissions (id, voyage_id, omitted_pod, discharge_pod, omitted_by)
        VALUES (${omissionId}, ${w.voyageId}, '${w.pod}', '${dst}', '${w.actors.administrativo}')`)
    try {
      const b = issued('COD')
      expect(w.invoice(b.invoice).total).toBe(500)
      setRoe(6)
      w.psql(`INSERT INTO public.bl_transshipments (bl_id, omission_id, disposition) VALUES ('${b.id}', ${omissionId}, 'transshipment')
        ON CONFLICT (bl_id, omission_id) DO NOTHING`)
      const result = w.as('administrativo', `SELECT public.set_bl_cod('${b.id}', ${omissionId}, 'Destino corrigido por COD', '${w.actors.administrativo}'::uuid)`)
      expect(result.status, result.stderr).toBe(0)
      expect(w.psql(`SELECT count(*) FROM public.cod_adjustments WHERE bl_id = '${b.id}'`)).toBe('0')
    } finally {
      setRoe(5)
      onlyBaseTable()
    }
  })

  it('consolidada cancelada solta o B/L que ela faturava sem individual; a nova só sai pelo Emitir', () => {
    const id = w.createBl('CONS')
    w.calculate(id)
    w.psql(`SET session_replication_role = replica; UPDATE public.bls SET ce_mercante = '931900000000090' WHERE id = '${id}'; SET session_replication_role = origin;`)
    const consolidated = w.consolidate([id])
    expect(w.psql(`SELECT financial_status FROM public.bls WHERE id = '${id}'`)).toBe('invoiced')
    w.asOk('administrativo', `SELECT public.cancel_invoice(${consolidated}, 'Consolidada emitida por engano', '${w.actors.administrativo}'::uuid)`)
    expect(w.psql(`SELECT financial_status FROM public.bls WHERE id = '${id}'`)).toBe('pending')
    expect(w.psql(`SELECT public.auto_bill_bl_after_ce_mercante('${id}', '${w.actors.administrativo}'::uuid)->>'reason'`))
      .toBe('invoice_cancelled_awaiting_emitir')
  })

  it('cancelar a baixa de consolidada já substituída a mantém obsoleta; a sucessora mostra o saldo que voltou', () => {
    const a = issued('OBSA')
    const b = issued('OBSB')
    const consolidated = w.consolidate([a.id, b.id])
    const partial = w.pay(consolidated, 300)
    w.pay(a.invoice, w.invoice(a.invoice).balance)
    expect(w.invoice(consolidated).status).toBe('obsolete')
    const successor = w.successorOf(consolidated)!
    w.reversePayment(partial.payment_id)
    expect(w.invoice(consolidated)).toMatchObject({ status: 'obsolete', balance: 0 })
    expect(w.psql(`SELECT count(*) FROM public.invoice_receivable_links WHERE invoice_id = ${consolidated} AND status = 'active'`)).toBe('0')
    const receivableB = Number(w.psql(`SELECT balance_brl FROM public.bl_receivables WHERE bl_id = '${b.id}' AND source = 'local_charges'`))
    expect(w.invoice(successor)).toMatchObject({ status: 'issued', balance: receivableB })
  })

  it('Pix já baixado pelo extrato e relido pelo Itaú não vira duplicidade; a falha de consulta do mesmo Pix fecha', () => {
    w.psql(`UPDATE public.app_settings SET pix_provider = 'itau' WHERE id = 1`)
    let b!: { id: string; invoice: number }
    try {
      b = issued('EXT')
    } finally {
      w.psql(`UPDATE public.app_settings SET pix_provider = 'static' WHERE id = 1`)
    }
    const txid = w.psql(`SELECT txid FROM public.itau_pix_charges WHERE invoice_id = ${b.invoice} ORDER BY id DESC LIMIT 1`)
    // Baixa do extrato (plano B): o pagamento grava o TXID da cobrança Itaú.
    w.json('financeiro', `SELECT public.register_ledger_invoice_payment(${b.invoice}, 1000, 'pix', now(), '${txid}', 'pix_extract', 'Extrato', NULL)`)
    expect(w.invoice(b.invoice).status).toBe('paid')
    w.psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_receipt_failed('${e2e(1)}', '${txid}', '{}'::jsonb, 'Falha simulada', true)`)
    expect(w.psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_settle('${e2e(1)}', '${txid}', 1000, now())`)).toBe('settled')
    expect(w.psql(`SELECT count(*) FROM public.invoice_refunds WHERE itau_end_to_end_id = '${e2e(1)}'`)).toBe('0')
    expect(w.psql(`SELECT status FROM public.itau_pix_receipt_failures WHERE failure_key = '${e2e(1)}'`)).toBe('handled')
  })

  it('Pix sem TXID aparece baixado quando a baixa manual leva o endToEndId na referência', () => {
    const b = issued('SEMTX')
    w.psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_record_untracked('${e2e(2)}', 1000, now())`)
    w.asOk('financeiro', `SELECT public.register_verified_invoice_payment(${b.invoice}, 1000, 'pix', now(), 'Pix sem TXID', gen_random_uuid(), '${e2e(2)}')`)
    // Desde a 442 (ADR 0100) o Pix sem TXID fica "recebido"; a situação vem da baixa com a referência dele.
    const listing = w.json<{ rows: { situation: string; settled_doc_number: string }[] }>('financeiro',
      `SELECT public.list_itau_pix_receipts(p_search => '${e2e(2)}')`)
    expect(listing.rows).toEqual([expect.objectContaining({ situation: 'settled' })])
    expect(w.psql(`SELECT status FROM public.itau_pix_receipts WHERE end_to_end_id = '${e2e(2)}'`)).toBe('received')
  })

  it('Pix estático da avulsa: o QR remontado cobra o saldo, não o total', () => {
    const manual = w.json<{ invoice_id: number }>('administrativo', `SELECT public.create_manual_invoice(${w.customerId}, 'Serviço 385', 1, 1000, NULL, NULL, NULL,
      '${w.actors.administrativo}'::uuid, p_reason => 'Avulsa do teste')`).invoice_id
    w.asOk('financeiro', `SELECT public.register_invoice_payment(${manual}, 400, 'ted', now(), 'Parcial da avulsa', NULL)`)
    w.psql(`UPDATE public.invoices SET pix_payload = NULL WHERE id = ${manual}`)
    const payload = w.psql(`SELECT pix_payload FROM public.invoices WHERE id = ${manual}`)
    expect(payload).toContain('600.00')
    expect(payload).not.toContain('1000.00')
  })

  it('refixar o preço não está aberto a nenhum Departamento pela API', () => {
    const id = w.createBl('REFIX')
    w.calculate(id)
    expect(w.as('administrativo', `SELECT public.refix_bl_local_charge_prices(ARRAY['${id}'], 'Pela API')`).stderr).toMatch(/permission denied/)
  })

  it('falha de cálculo recusa o CE da ficha em B/L com Cliente e a reativação do B/L', () => {
    const failing = (id: string, event: string) => `CREATE FUNCTION pg_temp.ff9319_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$;
      CREATE TRIGGER ff9319_fail BEFORE ${event} ON public.charge_calculations FOR EACH ROW
        WHEN (${event === 'DELETE' ? 'OLD' : 'NEW'}.bl_id = '${id}') EXECUTE FUNCTION pg_temp.ff9319_fail();`
    const ceBl = w.createBl('CEFC')
    w.calculate(ceBl)
    expect(() => w.psql(`${failing(ceBl, 'DELETE')} UPDATE public.bls SET ce_mercante = '931900000000091' WHERE id = '${ceBl}';`)).toThrow(REFUSED)
    expect(w.psql(`SELECT coalesce(ce_mercante, 'null') FROM public.bls WHERE id = '${ceBl}'`)).toBe('null')

    const cancelled = w.createBl('REAT')
    w.calculate(cancelled)
    w.cancelBl(cancelled)
    expect(() => w.psql(`${failing(cancelled, 'INSERT')} SELECT public.reactivate_bl('${cancelled}', 'Reativação do teste');`)).toThrow(REFUSED)
    expect(w.psql(`SELECT cancelled_at IS NOT NULL FROM public.bls WHERE id = '${cancelled}'`)).toBe('t')
  })

  it('lançamento manual usa a tabela vinculada desativada e o preço fixado, sem a Condição criada depois', () => {
    w.psql(`INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, manual_only)
      VALUES (99931995, ${baseTable}, 'Taxa manual FF9319', 'bl', 70, 70, 'bl', 'base', 'any', 'BRL', true)`)
    try {
      const id = w.createBl('MANUAL')
      w.calculate(id)
      w.psql(`UPDATE public.charge_tables SET active = false WHERE id = ${baseTable};
        INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, active)
          VALUES (${w.customerId}, 99931995, 50, CURRENT_DATE - 10, true)`)
      const result = w.json<{ unit_value_brl: number }>('operacoes', `SELECT public.add_manual_bl_charge('${id}', 99931995, 1, 'Lançamento do teste', '${w.actors.operacoes}'::uuid)`)
      expect(Number(result.unit_value_brl)).toBe(70)
    } finally {
      w.psql(`SET session_replication_role = replica;
        DELETE FROM public.customer_rate_overrides WHERE charge_item_id = 99931995;
        DELETE FROM public.charge_calculations WHERE charge_item_id = 99931995;
        DELETE FROM public.bl_price_freeze_items WHERE charge_item_id = 99931995;
        DELETE FROM public.pricing_rule_versions WHERE charge_item_id = 99931995;
        DELETE FROM public.charge_table_items WHERE id = 99931995;
        SET session_replication_role = origin;`)
      onlyBaseTable()
    }
  })

  it('renomear o item não reprecifica o B/L faturado', () => {
    const b = issued('NOME')
    // O preço da tabela mudou por fora (como no faturado antes da 355); a fatura é o preço fixado.
    w.psql(`SET session_replication_role = replica; UPDATE public.charge_table_items SET unit_value_brl = 1200, value_brl = 1200 WHERE id = ${baseItem}; SET session_replication_role = origin;`)
    try {
      w.psql(`UPDATE public.charge_table_items SET name = 'Taxa renomeada FF9319' WHERE id = ${baseItem}`)
      expect(w.invoice(b.invoice).status).toBe('issued')
      expect(w.psql(`SELECT unit_value_brl FROM public.bl_price_freeze_items WHERE bl_id = '${b.id}' AND charge_item_id = ${baseItem}`)).toBe('1000.00')
    } finally {
      w.psql(`SET session_replication_role = replica; UPDATE public.charge_table_items SET unit_value_brl = 1000, value_brl = 1000 WHERE id = ${baseItem}; SET session_replication_role = origin;`)
    }
  })

  it('corrigir a Condição alcança o B/L que a usou, não o importado antes dela', () => {
    const before = w.createBl('CONDA')
    w.calculate(before)
    w.psql(`INSERT INTO public.customer_rate_overrides (id, customer_id, charge_item_id, override_value, valid_from, active)
      VALUES (99931996, ${w.customerId}, ${baseItem}, 800, CURRENT_DATE - 10, true)`)
    try {
      const after = w.createBl('CONDB')
      w.calculate(after)
      expect([w.calcTotal(before), w.calcTotal(after)]).toEqual([1000, 800])
      w.psql(`UPDATE public.customer_rate_overrides SET override_value = 850 WHERE id = 99931996`)
      expect([w.calcTotal(before), w.calcTotal(after)]).toEqual([1000, 850])
    } finally {
      w.psql(`SET session_replication_role = replica;
        UPDATE public.bl_price_freeze_items SET override_id = NULL WHERE override_id = 99931996;
        DELETE FROM public.customer_rate_overrides WHERE id = 99931996;
        SET session_replication_role = origin;`)
    }
  })

  it('mover veículo de B/L cancelado é recusado', () => {
    const origin = w.createBl('VEIC')
    const target = w.createBl('VEID')
    w.psql(`INSERT INTO public.vehicles (bl_id, chassis, voyage_id, container_id, brand, model, weight_kg, cbm)
      SELECT '${origin}', 'FF9319CHASSI0001', ${w.voyageId}, c.id, 'MARCA', 'MODELO', 1500, 10 FROM public.bl_containers c WHERE c.bl_id = '${origin}'`)
    w.cancelBl(origin)
    const vehicle = w.psql(`SELECT id FROM public.vehicles WHERE bl_id = '${origin}'`)
    const result = w.as('operacoes', `SELECT public.move_vehicles_to_bl(ARRAY[${vehicle}]::bigint[], '${target}', 'Mover do cancelado', NULL)`)
    expect(result.stderr).toMatch(/cancelado é somente leitura/)
    expect(w.psql(`SELECT bl_id FROM public.vehicles WHERE id = ${vehicle}`)).toBe(origin)
  })

  it('D1 (386): correção que não reemitiria (trava do Portal fechou, valor a revisar) não cancela; a fatura continua e o alerta avisa', () => {
    const gate = issued('D1GATE')
    w.closeGate()
    try {
      w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${gate.id}', '${w.container()}', '22G1')`)
      expect(w.invoice(gate.invoice).status).toBe('issued')
      expect(w.successorOf(gate.invoice)).toBeNull()
      expect(w.activeInvoiceAlerts('fatura_desatualizada', gate.invoice)).toBe(1)
    } finally {
      w.openGate()
    }
  })

  it('D2 (386): Manifesto BB não acrescenta carga solta a B/L faturado sem a confirmação; com ela, o B/L vira misto', () => {
    const b = issued('D2BB')
    const row = (override: boolean) => ({
      id: b.id, voyage_id: w.voyageId, bb_machine_qty: 1, bb_packages_qty: 2, bb_packages_total: 2, bb_weight_ton: 5, bb_cbm: 3,
      shipper: 'S', consignee: 'C', notify_party: 'N', customer_id: w.customerId, suggested_customer_id: null,
      manifest_customer_cnpj_cpf: null, manifest_customer_name: 'C', manifest_customer_email: null,
      customer_reconciliation_status: 'matched_document', customer_reconciliation_notes: null, billing_hold_reason: null,
      pol: 'CNSHA', pod: w.pod, cargo_description: 'MAQUINA', ncm_codes: [], review_status: 'ok', financial_status: 'invoiced', notes: null,
      override_billing: override,
    })
    const item = { bl_id: b.id, item_description: 'MAQUINA', package_qty: 2, package_unit: 'PACKAGES', gross_weight_kg: 5000, cbm: 3, marks: null }
    const importBb = (override: boolean) => {
      w.psql(`SET session_replication_role = replica;
        UPDATE public.import_batches SET uploaded_at = uploaded_at - interval '10 minutes' WHERE uploaded_by = '${w.actors.operacoes}';
        SET session_replication_role = origin;`)
      return w.json<{ billing_locked: Array<{ bl_id: string; fields: string[] }> }>('operacoes',
        `SELECT public.import_breakbulk_manifest_transactional('ff9319.pdf', ${w.voyageId}, '${w.actors.operacoes}'::uuid, 1,
          '${JSON.stringify([row(override)])}'::jsonb, '${JSON.stringify([item])}'::jsonb, '[]'::jsonb)`)
    }
    try {
      expect(importBb(false).billing_locked.flatMap((entry) => entry.fields)).toContain('itens')
      expect(w.psql(`SELECT cargo_mode FROM public.bls WHERE id = '${b.id}'`)).toBe('container')
      expect(w.invoice(b.invoice).status).toBe('issued')
      importBb(true)
      expect(w.psql(`SELECT cargo_mode FROM public.bls WHERE id = '${b.id}'`)).toBe('misto')
    } finally {
      w.psql(`SET session_replication_role = replica; DELETE FROM public.import_batches WHERE voyage_id = ${w.voyageId}; SET session_replication_role = origin;`)
    }
  })

  it('D5 (386): Pix da consolidada substituída sem sucessora aberta e da avulsa em cancelamento vira restituição pendente', () => {
    const a = issued('D5A')
    const b = issued('D5B')
    w.psql(`UPDATE public.app_settings SET pix_provider = 'itau' WHERE id = 1`)
    let consolidated: number
    let manual: number
    try {
      consolidated = w.consolidate([a.id, b.id])
      manual = w.json<{ invoice_id: number }>('administrativo', `SELECT public.create_manual_invoice(${w.customerId}, 'Serviço D5', 1, 500, NULL, NULL, NULL,
        '${w.actors.administrativo}'::uuid, p_reason => 'Avulsa do teste')`).invoice_id
    } finally {
      w.psql(`UPDATE public.app_settings SET pix_provider = 'static' WHERE id = 1`)
    }
    const txidOf = (invoice: number) => w.psql(`SELECT txid FROM public.itau_pix_charges WHERE invoice_id = ${invoice} ORDER BY id LIMIT 1`)
    const consolidatedTxid = txidOf(consolidated)
    const manualTxid = txidOf(manual)
    w.pay(a.invoice, w.invoice(a.invoice).balance)
    w.pay(b.invoice, w.invoice(b.invoice).balance)
    expect(w.invoice(consolidated).status).toBe('obsolete')
    const settle = (n: number, txid: string, amount: number) =>
      w.psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_settle('${e2e(n)}', '${txid}', ${amount}, now())`)
    expect(settle(5, consolidatedTxid, 2000)).toBe('review')
    expect(w.psql(`SELECT invoice_id || '|' || origin || '|' || amount_brl FROM public.invoice_refunds WHERE itau_end_to_end_id = '${e2e(5)}'`))
      .toBe(`${consolidated}|pix_duplicate|2000.00`)

    w.asOk('financeiro', `SELECT public.register_invoice_payment(${manual}, 200, 'ted', now(), 'Parcial da avulsa', NULL)`)
    w.json('financeiro', `SELECT public.request_financial_refund('manual', ${manual}, 200, 'Cancelar a avulsa', 'cancel', gen_random_uuid())`)
    expect(settle(6, manualTxid, 300)).toBe('review')
    expect(w.psql(`SELECT invoice_id || '|' || origin || '|' || amount_brl FROM public.invoice_refunds WHERE itau_end_to_end_id = '${e2e(6)}'`))
      .toBe(`${manual}|pix_duplicate|300.00`)
  })
})
