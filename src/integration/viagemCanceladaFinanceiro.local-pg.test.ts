import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-13 do plano da frente financeira (ADR 0093, decisão 14; migration 363):
// cancelar a Viagem é recusado com fatura viva ou baixa; ao cancelar, os
// recebíveis sem fatura são anulados.

const w = financeWorld(9306)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT position('voided_receivables' IN prosrc) > 0 FROM pg_proc WHERE proname = 'cancel_voyage'`) === 't'
  } catch {
    return false
  }
}, 'migration 363 aplicada')

describeLocal('363 — cancelar Viagem respeita o financeiro', () => {
  beforeAll(() => {
    w.setup()
    w.table(400)
  })
  afterAll(() => w.cleanup())

  it('recusa com fatura viva; depois de cancelar a fatura, cancela e anula os recebíveis sem fatura', () => {
    const billed = w.createBl('VB')
    const unbilled = w.createBl('VU')
    w.calculate(billed)
    w.calculate(unbilled)
    const invoice = w.issueByCe(billed, '936300000000001')
    const cancel = () => w.as('administrativo', `SELECT public.cancel_voyage(${w.voyageId}, 'Viagem cancelada no teste', '${w.actors.administrativo}'::uuid)`)

    const refused = cancel()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toMatch(/fatura viva ou baixa/)

    w.asOk('administrativo', `SELECT public.cancel_invoice(${invoice}, 'Cancelada no teste', NULL)`)
    const done = cancel()
    expect(done.status, done.stderr).toBe(0)
    expect(w.psql(`SELECT status FROM public.voyages WHERE id = ${w.voyageId}`)).toBe('cancelled')
    expect(w.psql(`SELECT string_agg(status, ',' ORDER BY bl_id) FROM public.bl_receivables WHERE bl_id IN ('${billed}', '${unbilled}')`)).toBe('void,void')
  })
})
