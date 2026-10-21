import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-25, F-26, F-28 e F-30 do plano da frente financeira (migration 372).

const w = financeWorld(9310)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regproc('public.recalculate_provisional_bls_on_eta') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 372 aplicada')

describeLocal('372 — cálculo de B/L cancelado, isento, reativado e ETA', () => {
  let item = 0
  beforeAll(() => {
    w.setup()
    ;[, item] = w.table(100)
  })
  afterAll(() => w.cleanup())

  const receivable = (id: string) => w.psql(`SELECT status || '|' || balance_brl FROM public.bl_receivables WHERE bl_id = '${id}' AND source = 'local_charges'`)

  it('F-26: o B/L que fica isento anula o recebível aberto', () => {
    const id = w.createBl('ISE')
    w.psql(`INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
      SELECT ${w.voyageId}, c.id, '${id}', 'FF9310CHASSI0001', 'Marca', 'Modelo', 1500, 10 FROM public.bl_containers c WHERE c.bl_id = '${id}'`)
    w.calculate(id)
    expect(receivable(id)).toBe('open|100.00')
    w.psql(`UPDATE public.bls SET movement_to = 'CFS' WHERE id = '${id}'`)
    w.calculate(id)
    expect(w.psql(`SELECT charge_status FROM public.bls WHERE id = '${id}'`)).toBe('exempt')
    expect(receivable(id)).toMatch(/^void\|/)
  })

  it('F-28 e F-30: B/L cancelado não calcula nem recebe lançamento; reativado volta calculado', () => {
    const id = w.createBl('CAN')
    w.calculate(id)
    w.cancelBl(id)
    expect(w.psql(`SELECT charge_status FROM public.bls WHERE id = '${id}'`)).toBe('not_calculated')
    const calc = w.as('administrativo', `SELECT public.calculate_bl_local_charges('${id}', '${w.actors.administrativo}'::uuid, true)`)
    expect(calc.stderr).toMatch(/cancelado e somente leitura/)
    const manual = w.as('administrativo', `SELECT public.add_manual_bl_charge('${id}', ${item}, 1, NULL, '${w.actors.administrativo}'::uuid)`)
    expect(manual.status).not.toBe(0)
    w.asOk('administrativo', `SELECT public.reactivate_bl('${id}', 'Cancelado por engano')`)
    expect(w.psql(`SELECT charge_status FROM public.bls WHERE id = '${id}'`)).toBe('calculated')
    expect(w.calcTotal(id)).toBe(100)
  })

  it('F-25: a ETA da Viagem recalcula o provisório, que troca de Condição pela data', () => {
    w.psql(`UPDATE public.voyages SET eta = '2026-03-10T15:00:00Z' WHERE id = ${w.voyageId}`)
    w.asOk('operacoes', `INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, valid_to)
      VALUES (${w.customerId}, ${item}, 70, '2026-03-01', '2026-03-31')`)
    const id = w.createBl('ETA')
    w.calculate(id)
    expect(w.calcTotal(id)).toBe(70)
    w.psql(`UPDATE public.voyages SET eta = '2026-05-10T15:00:00Z' WHERE id = ${w.voyageId}`)
    expect(w.calcTotal(id)).toBe(100)
  })
})
