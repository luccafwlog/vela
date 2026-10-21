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

  it('F-29: falha do cálculo no vínculo do Cliente abre billing_calculation_blocked', () => {
    const id = w.createBl('F29', { customerId: null })
    w.psql(`SET session_replication_role = replica;
      UPDATE public.bls SET charge_status = 'calculated' WHERE id = '${id}';
      INSERT INTO public.charge_calculations (bl_id, source, status, calculation_key, quantity, total_value_brl)
        VALUES ('${id}', 'auto', 'calculated', 'auto:fixture', 1, 100);
      SET session_replication_role = origin;
      CREATE FUNCTION pg_temp.ff9311_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Cambio (ROE) nao configurado'; END $$;
      CREATE TRIGGER ff9311_fail BEFORE DELETE ON public.charge_calculations FOR EACH ROW
        WHEN (OLD.bl_id = '${id}') EXECUTE FUNCTION pg_temp.ff9311_fail();
      UPDATE public.bls SET customer_id = ${w.customerId}, customer_reconciliation_status = 'reconciled' WHERE id = '${id}';
      DROP TRIGGER ff9311_fail ON public.charge_calculations;`)
    expect(w.psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'billing_calculation_blocked' AND status = 'active'
      AND metadata->>'bl_id' = '${id}'`)).toBe('1')
  })
})
