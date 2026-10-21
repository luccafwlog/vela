import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// ADR 0094, B3 (migration 379): falha de cálculo das Taxas Locais (câmbio
// ausente com linha em dólar e afins) recusa a gravação inteira, com o B/L e o
// que falta: arquivo de B/L, Manifesto BB, Base de Clientes, vínculo e troca
// de Cliente, ficha. B/L sem tabela não é falha.

const w = financeWorld(9315)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = '_raise_local_charge_failure'`) === '1'
  } catch {
    return false
  }
}, 'migration 379 aplicada')

const REFUSED = /Taxas Locais do B\/L .* não calculadas: Cambio \(ROE\) nao configurado/

describeLocal('379 — falha de cálculo recusa a gravação', () => {
  let savedRoe = ''

  beforeAll(() => {
    w.setup()
    savedRoe = w.psql(`SELECT coalesce(roe::text, '') || '|' || coalesce(effective_date::text, '') FROM public.exchange_rate_reference WHERE id = 1`)
    // Sem câmbio configurado e com a tabela em dólar.
    w.psql(`SET session_replication_role = replica; DELETE FROM public.exchange_rate_reference WHERE id = 1; SET session_replication_role = origin;`)
    for (const mode of ['container', 'carga_solta'] as const) {
      const [, item] = w.table(0, { cargoMode: mode })
      w.psql(`UPDATE public.charge_table_items SET currency = 'USD', unit_value_usd = 100, unit_value_brl = NULL, value_brl = 0 WHERE id = ${item}`)
    }
  })
  afterAll(() => {
    if (savedRoe) {
      const [roe, date] = savedRoe.split('|')
      w.psql(`INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, ${roe}, '${date}') ON CONFLICT (id) DO NOTHING`)
    }
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.bl_breakbulk_items WHERE bl_id LIKE '${w.prefix}%';
      DELETE FROM public.import_batches WHERE voyage_id = ${w.voyageId};
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  const customerOf = (id: string) => w.psql(`SELECT coalesce(customer_id::text, 'null') FROM public.bls WHERE id = '${id}'`)

  it('vincular Cliente a B/L com linha em dólar e sem câmbio é recusado, sem Alerta', () => {
    const id = w.createBl('VINC', { customerId: null })
    w.calculate(id)
    const result = w.as('operacoes', `UPDATE public.bls SET customer_id = ${w.customerId}, customer_reconciliation_status = 'reconciled' WHERE id = '${id}'`)
    expect(result.stderr).toMatch(REFUSED)
    expect(result.stderr).toContain(id)
    expect(customerOf(id)).toBe('null')
    expect(w.psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'billing_calculation_blocked' AND metadata->>'bl_id' = '${id}'`)).toBe('0')
  })

  it('troca de Cliente em B/L não faturado é recusada', () => {
    const id = w.createBl('TROCA', { customerId: null })
    w.calculate(id)
    const result = w.as('administrativo', `RESET ROLE; SELECT public.relink_bl_customer('${id}', ${w.otherCustomerId}, '${w.actors.administrativo}'::uuid, 'Troca no teste')`)
    expect(result.stderr).toMatch(REFUSED)
    expect(customerOf(id)).toBe('null')
  })

  it('Base de Clientes: a linha que vincula B/L sem cálculo possível é recusada', () => {
    const id = w.createBl('BASE', { customerId: null })
    w.calculate(id)
    const cnpj = w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.customerId}`)
    const name = w.psql(`SELECT name FROM public.customers WHERE id = ${w.customerId}`)
    w.psql(`UPDATE public.bls SET manifest_customer_cnpj_cpf = '${cnpj}' WHERE id = '${id}'`)
    const result = w.as('administrativo', `RESET ROLE; SELECT public.apply_customer_base_row_atomic('${cnpj}', '${name}', NULL, NULL, NULL, NULL, NULL,
      '["base9315@example.test"]'::jsonb, '${w.actors.administrativo}', false)`)
    expect(result.stderr).toMatch(REFUSED)
    expect(customerOf(id)).toBe('null')
  })

  it('arquivo de B/L: recusa o arquivo e não enfileira provisional_charges', () => {
    const id = w.bl('ARQ')
    const payload = JSON.stringify([{
      id, voyage_id: w.voyageId, pod: w.pod, customer_id: w.customerId,
      customer_reconciliation_status: 'matched_document',
      containers: [{ container_number: w.container(), type: '22G1', is_imo: false, is_oog: false }],
    }])
    const result = w.as('administrativo', `RESET ROLE; SELECT public.import_bl_freight_with_metadata('${payload}'::jsonb, '${w.actors.administrativo}',
      '{"filename":"ff9315.xlsx","voyage_id":${w.voyageId},"cargo_mode":"container"}'::jsonb)`)
    expect(result.stderr).toMatch(REFUSED)
    expect(w.psql(`SELECT count(*) FROM public.bls WHERE id = '${id}'`)).toBe('0')
    expect(w.psql(`SELECT count(*) FROM public.import_pending_effects WHERE entity_id = '${id}'`)).toBe('0')
  })

  it('Manifesto BB (e B/L avulso): calcula na gravação e recusa', () => {
    const id = w.bl('BB')
    const row = {
      id, voyage_id: w.voyageId, bb_machine_qty: 1, bb_packages_qty: 2, bb_packages_total: 2, bb_weight_ton: 5, bb_cbm: 3,
      shipper: 'S', consignee: 'C', notify_party: 'N', customer_id: w.customerId, suggested_customer_id: null,
      manifest_customer_cnpj_cpf: null, manifest_customer_name: 'C', manifest_customer_email: null,
      customer_reconciliation_status: 'matched_document', customer_reconciliation_notes: null, billing_hold_reason: null,
      pol: 'CNSHA', pod: w.pod, cargo_description: 'MAQUINA', ncm_codes: [], review_status: 'ok', financial_status: 'pending', notes: null,
    }
    const item = { bl_id: id, item_description: 'MAQUINA', package_qty: 2, package_unit: 'PACKAGES', gross_weight_kg: 5000, cbm: 3, marks: null }
    const result = w.as('operacoes', `SELECT public.import_breakbulk_manifest_transactional('ff9315-bb.pdf', ${w.voyageId}, '${w.actors.operacoes}'::uuid, 1,
      '${JSON.stringify([row])}'::jsonb, '${JSON.stringify([item])}'::jsonb, '[]'::jsonb)`)
    expect(result.stderr).toMatch(REFUSED)
    expect(w.psql(`SELECT count(*) FROM public.bls WHERE id = '${id}'`)).toBe('0')
  })

  it('ficha: a alteração que pede recálculo impossível é recusada no fim da transação', () => {
    const id = w.createBl('FICHA', { customerId: null })
    w.calculate(id)
    w.psql(`SET session_replication_role = replica; UPDATE public.bls SET customer_id = ${w.customerId} WHERE id = '${id}'; SET session_replication_role = origin;`)
    const result = w.as('operacoes', `UPDATE public.bls SET movement_to = 'CY/CY' WHERE id = '${id}'`)
    expect(result.stderr).toMatch(REFUSED)
    expect(w.psql(`SELECT coalesce(movement_to, 'null') FROM public.bls WHERE id = '${id}'`)).toBe('null')
  })

  it('CE gravado pela ficha em B/L sem Cliente: a falha do cálculo recusa o CE', () => {
    const id = w.createBl('CEFICHA', { customerId: null })
    w.calculate(id)
    expect(() => w.psql(`CREATE FUNCTION pg_temp.ff9315_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Cambio (ROE) nao configurado'; END $$;
      CREATE TRIGGER ff9315_fail BEFORE DELETE ON public.charge_calculations FOR EACH ROW
        WHEN (OLD.bl_id = '${id}') EXECUTE FUNCTION pg_temp.ff9315_fail();
      UPDATE public.bls SET ce_mercante = '931500000000001' WHERE id = '${id}';`)).toThrow(REFUSED)
    expect(w.psql(`SELECT coalesce(ce_mercante, 'null') FROM public.bls WHERE id = '${id}'`)).toBe('null')
  })

  it('B/L sem tabela não é falha: o vínculo grava e o cálculo fica em espera', () => {
    const id = w.bl('SEMTAB')
    w.psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status)
      VALUES ('${id}', ${w.voyageId}, NULL, 'FF9315XXX', 'container', 'pending', 'not_calculated', 'missing_customer');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${w.container()}', '22G1')`)
    w.calculate(id)
    w.asOk('operacoes', `UPDATE public.bls SET customer_id = ${w.customerId}, customer_reconciliation_status = 'reconciled' WHERE id = '${id}'`)
    expect(customerOf(id)).toBe(String(w.customerId))
    expect(w.psql(`SELECT charge_status FROM public.bls WHERE id = '${id}'`)).toBe('review_required')
  })
})
