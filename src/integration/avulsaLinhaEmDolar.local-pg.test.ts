import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// ADR 0094, B13 (migration 383): a avulsa com item da tabela em dólar cobra o
// total em US$ convertido de uma vez (como a taxa local) e a linha mostra o
// unitário só em US$, sem unitário em R$.

const w = financeWorld(9319)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT position('383 (ADR 0094, B13)' IN prosrc) > 0 FROM pg_proc WHERE proname = '_create_manual_invoice_core_272'`) === 't'
  } catch {
    return false
  }
}, 'migration 383 aplicada')

describeLocal('383 — linha em dólar da avulsa', () => {
  let savedRoe = ''
  let usdItem = 0
  beforeAll(() => {
    w.setup()
    savedRoe = w.psql(`SELECT coalesce(roe::text, '') || '|' || coalesce(effective_date::text, '') FROM public.exchange_rate_reference WHERE id = 1`)
    w.psql(`INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, 5.4321, CURRENT_DATE)
      ON CONFLICT (id) DO UPDATE SET roe = EXCLUDED.roe, effective_date = EXCLUDED.effective_date`)
    ;[, usdItem] = w.table(0)
    w.psql(`UPDATE public.charge_table_items SET currency = 'USD', unit_value_usd = 33.33, unit_value_brl = NULL, value_brl = 0,
      application_basis = 'teu', manual_only = true WHERE id = ${usdItem}`)
  })
  afterAll(() => {
    if (savedRoe) {
      const [roe, date] = savedRoe.split('|')
      w.psql(`UPDATE public.exchange_rate_reference SET roe = ${roe}, effective_date = '${date}' WHERE id = 1`)
    } else {
      w.psql(`SET session_replication_role = replica; DELETE FROM public.exchange_rate_reference WHERE id = 1; SET session_replication_role = origin;`)
    }
    w.cleanup()
  })

  it('cobra o total em US$ convertido de uma vez e grava o unitário só em US$', () => {
    const id = w.createBl('USD')
    w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${w.container()}', '22G1'),
      ('${id}', '${w.container()}', '22G1')`)
    w.calculate(id)
    const quote = w.json<{ total_brl: number; quantity: number }>('administrativo', `SELECT public.quote_manual_invoice_charge('${id}', ${usdItem})`)
    const manual = w.json<{ invoice_id: number; total_brl: number }>('administrativo', `SELECT public.create_manual_invoice(${w.customerId}, 'x', 1, 1, NULL,
      '${id}', NULL, NULL, ${usdItem}, p_reason => 'Avulsa em dólar')`)
    expect(Number(manual.total_brl)).toBe(Number(quote.total_brl))
    expect(w.psql(`SELECT coalesce(unit_value_brl::text, 'null') || '|' || unit_value_usd || '|' || total_value_usd || '|' || total_value_brl
      FROM public.invoice_items WHERE invoice_id = ${manual.invoice_id}`))
      .toBe(`null|33.33|${(33.33 * quote.quantity).toFixed(2)}|${Number(quote.total_brl).toFixed(2)}`)
    expect(Number(quote.total_brl)).toBe(Math.round(Math.round(33.33 * quote.quantity * 100) / 100 * 5.4321 * 100) / 100)
  })
})
