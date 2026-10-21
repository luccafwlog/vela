import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// ADR 0094, B10 (migration 382): a Invoice de Demurrage com ROE manual fica
// fora do recálculo pela PTAX até alguém tirar o ROE manual, com motivo e
// rastro.

const w = financeWorld(9318)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'release_demurrage_invoice_manual_roe'`) === '1'
  } catch {
    return false
  }
}, 'migration 382 aplicada')

describeLocal('382 — ROE manual da Demurrage prevalece', () => {
  let savedRoe = ''
  beforeAll(() => {
    w.setup()
    savedRoe = w.psql(`SELECT coalesce(ptax::text, '') || '|' || roe || '|' || effective_date || '|' || source FROM public.exchange_rate_reference WHERE id = 1`)
    const id = w.createBl('DEM')
    w.psql(`SET session_replication_role = replica;
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, roe_manual, roe, status, first_billed_at)
        VALUES (99931881, 'FF9318-MAN', '${id}', ${w.customerId}, 100, 4.8, 480, 'manual', true, 4.8, 'issued', now()),
               (99931882, 'FF9318-PTAX', '${id}', ${w.customerId}, 100, 5.0, 500, 'bcb_live', false, NULL, 'issued', now());
      SET session_replication_role = origin;`)
  })
  afterAll(() => {
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.audit_logs WHERE entity_type = 'demurrage_invoice' AND entity_id IN ('99931881', '99931882');
      DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (99931881, 99931882);
      DELETE FROM public.demurrage_invoices WHERE id IN (99931881, 99931882);
      DELETE FROM public.exchange_rate_reference WHERE id = 1;
      DELETE FROM public.exchange_rate_reference_history WHERE recorded_by IN ('${w.actors.financeiro}', '${w.actors.administrativo}');
      SET session_replication_role = origin;`)
    if (savedRoe) {
      const [ptax, roe, date, source] = savedRoe.split('|')
      w.psql(`INSERT INTO public.exchange_rate_reference (id, ptax, roe, effective_date, source) VALUES (1, ${ptax || 'NULL'}, ${roe}, '${date}', '${source}')`)
    }
    w.cleanup()
  })

  const state = (id: number) => w.psql(`SELECT current_roe || '|' || current_total_brl || '|' || roe_manual FROM public.demurrage_invoices WHERE id = ${id}`)

  it('o recálculo pela PTAX não mexe na Invoice com ROE manual', () => {
    w.asOk('financeiro', `SELECT public.recalculate_demurrage_invoices_manual(5.2)`)
    expect(state(99931881)).toBe('4.8000|480.00|true')
    expect(state(99931882)).not.toBe('5.0000|500.00|false')
  })

  it('tirar o ROE manual exige motivo e o perfil; volta ao câmbio do dia, com histórico e rastro', () => {
    expect(w.as('operacoes', `SELECT public.release_demurrage_invoice_manual_roe(99931881, 'Cliente pediu PTAX do dia')`).stderr).toMatch(/Financeiro ou do Administrativo/)
    expect(w.as('financeiro', `SELECT public.release_demurrage_invoice_manual_roe(99931881, 'curto')`).stderr).toMatch(/motivo/)
    const roe = w.psql(`SELECT roe FROM public.exchange_rate_reference WHERE id = 1`)
    w.asOk('financeiro', `SELECT public.release_demurrage_invoice_manual_roe(99931881, 'Cliente pediu PTAX do dia')`)
    expect(state(99931881)).toBe(`${roe}|${(Math.round(100 * Number(roe) * 100) / 100).toFixed(2)}|false`)
    expect(w.psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'demurrage_invoice' AND entity_id = '99931881' AND field_name = 'roe_manual_removed'`)).toBe('1')
    // Daqui em diante, segue a PTAX.
    w.asOk('financeiro', `SELECT public.recalculate_demurrage_invoices_manual(5.6)`)
    expect(w.psql(`SELECT current_roe = (SELECT roe FROM public.exchange_rate_reference WHERE id = 1) FROM public.demurrage_invoices WHERE id = 99931881`)).toBe('t')
  })

  it('Invoice vencida também volta à PTAX; o histórico leva a data da cotação usada', () => {
    w.psql(`SET session_replication_role = replica;
      UPDATE public.demurrage_invoices SET roe_manual = true, roe = current_roe, roe_source = 'manual', status = 'overdue' WHERE id = 99931882;
      UPDATE public.exchange_rate_reference SET effective_date = CURRENT_DATE - 3, quote_date = CURRENT_DATE - 3 WHERE id = 1;
      SET session_replication_role = origin;`)
    w.asOk('financeiro', `SELECT public.release_demurrage_invoice_manual_roe(99931882, 'Cliente pediu PTAX vigente')`)
    expect(w.psql(`SELECT roe_manual FROM public.demurrage_invoices WHERE id = 99931882`)).toBe('f')
    expect(w.psql(`SELECT event_date = CURRENT_DATE - 3 FROM public.demurrage_invoice_history WHERE invoice_id = 99931882 ORDER BY id DESC LIMIT 1`)).toBe('t')
  })
})
