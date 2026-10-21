import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-27, F-29 e I-07 (migration 373; ADR 0093, decisão 13).

const w = financeWorld(9311)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regproc('public.guard_bl_customer_unlink') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 373 aplicada')

describeLocal('373 — desvincular o Cliente e container FCL entre Clientes', () => {
  beforeAll(() => {
    w.setup()
    w.table(100)
  })
  afterAll(() => w.cleanup())

  const receivable = (id: string) => w.psql(`SELECT status || '|' || customer_id FROM public.bl_receivables WHERE bl_id = '${id}' AND source = 'local_charges'`)

  it('B/L não faturado: desvincular anula o recebível, e o próximo vínculo o refaz com o novo Cliente', () => {
    const id = w.createBl('UNL')
    w.calculate(id)
    expect(receivable(id)).toBe(`open|${w.customerId}`)
    w.psql(`UPDATE public.bls SET customer_id = NULL, customer_reconciliation_status = 'missing_customer' WHERE id = '${id}'`)
    expect(receivable(id)).toMatch(/^void\|/)
    w.psql(`UPDATE public.bls SET customer_id = ${w.otherCustomerId}, customer_reconciliation_status = 'reconciled' WHERE id = '${id}'`)
    expect(receivable(id)).toBe(`open|${w.otherCustomerId}`)
  })

  it('B/L faturado: desvincular é recusado', () => {
    const id = w.createBl('BIL')
    w.calculate(id)
    w.issueByCe(id, '937300000000001')
    expect(() => w.psql(`UPDATE public.bls SET customer_id = NULL WHERE id = '${id}'`)).toThrow(/Trocar Cliente/)
  })

  it('container FCL não fica dividido entre Clientes quando o segundo B/L é vinculado depois (P0008)', () => {
    const shared = w.container()
    w.createBl('FA', { container: shared })
    const second = w.createBl('FB', { container: shared, customerId: null })
    expect(() => w.psql(`UPDATE public.bls SET customer_id = ${w.otherCustomerId}, customer_reconciliation_status = 'reconciled' WHERE id = '${second}'`))
      .toThrow(/nao e dividido entre Clientes diferentes/)
  })

  // ADR 0094, B3 (migration 379): a falha recusa o vínculo; não abre Alerta.
  it('F-29: falha do cálculo no vínculo do Cliente recusa a gravação, sem Alerta', () => {
    const id = w.createBl('F29', { customerId: null })
    expect(() => w.psql(`SET session_replication_role = replica;
      UPDATE public.bls SET charge_status = 'calculated' WHERE id = '${id}';
      INSERT INTO public.charge_calculations (bl_id, source, status, calculation_key, quantity, total_value_brl)
        VALUES ('${id}', 'auto', 'calculated', 'auto:fixture', 1, 100);
      SET session_replication_role = origin;
      CREATE FUNCTION pg_temp.ff9311_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Cambio (ROE) nao configurado'; END $$;
      CREATE TRIGGER ff9311_fail BEFORE DELETE ON public.charge_calculations FOR EACH ROW
        WHEN (OLD.bl_id = '${id}') EXECUTE FUNCTION pg_temp.ff9311_fail();
      UPDATE public.bls SET customer_id = ${w.customerId}, customer_reconciliation_status = 'reconciled' WHERE id = '${id}';`))
      .toThrow(/Taxas Locais do B\/L .* não calculadas: Cambio \(ROE\) nao configurado/)
    expect(w.psql(`SELECT coalesce(customer_id::text, 'null') FROM public.bls WHERE id = '${id}'`)).toBe('null')
    expect(w.psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'billing_calculation_blocked' AND metadata->>'bl_id' = '${id}'`)).toBe('0')
  })

  it('decisão 15 (migration 374): trocar o CNPJ reemite a avulsa e a Demurrage em aberto para o novo Cliente, com o mesmo valor', () => {
    const id = w.createBl('CNPJ')
    w.calculate(id)
    w.asOk('administrativo', `SELECT public.create_manual_invoice(${w.customerId}, 'Serviço do B/L', 1, 80, NULL, '${id}', NULL, '${w.actors.administrativo}'::uuid, p_reason => 'Motivo interno de teste')`)
    w.psql(`SET session_replication_role = replica;
      UPDATE public.bl_containers SET discharge_date = '2026-09-01', return_date = '2026-09-20' WHERE bl_id = '${id}';
      INSERT INTO public.demurrage_invoices (doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status)
        VALUES ('FF9311-DEM', '${id}', ${w.customerId}, 100, 5.5, 550, 'manual', 'issued');
      INSERT INTO public.demurrage_invoice_items (invoice_id, container_id, container_number, container_type, discharge_date, return_date,
          total_days, free_days, days_p1, rate_p1_usd, subtotal_usd)
        SELECT d.id, c.id, c.container_number, '22G1', '2026-09-01', '2026-09-20', 19, 14, 5, 20, 100
        FROM public.demurrage_invoices d JOIN public.bl_containers c ON c.bl_id = d.bl_id WHERE d.doc_number = 'FF9311-DEM';
      SET session_replication_role = origin;`)
    w.psql(`UPDATE public.bls SET customer_id = ${w.otherCustomerId} WHERE id = '${id}'`)
    expect(w.psql(`SELECT string_agg(customer_id || ':' || status || ':' || total_brl, ',' ORDER BY id) FROM public.invoices
      WHERE bl_id = '${id}' AND invoice_type = 'manual'`)).toBe(`${w.customerId}:cancelled:80.00,${w.otherCustomerId}:issued:80.00`)
    // 385: a avulsa reemitida não herda data, autor e motivo do cancelamento da original.
    expect(w.psql(`SELECT count(*) FROM public.invoices WHERE bl_id = '${id}' AND invoice_type = 'manual' AND status = 'issued'
      AND (cancelled_at IS NOT NULL OR cancelled_by IS NOT NULL OR cancel_reason IS NOT NULL)`)).toBe('0')
    expect(w.psql(`SELECT string_agg(customer_id || ':' || status || ':' || current_total_brl, ',' ORDER BY id) FROM public.demurrage_invoices
      WHERE bl_id = '${id}'`)).toBe(`${w.customerId}:cancelled:550.00,${w.otherCustomerId}:issued:550.00`)
    w.psql(`SET session_replication_role = replica; DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE bl_id = '${id}');
      DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE bl_id = '${id}');
      DELETE FROM public.demurrage_invoices WHERE bl_id = '${id}'; SET session_replication_role = origin;`)
  })
})
