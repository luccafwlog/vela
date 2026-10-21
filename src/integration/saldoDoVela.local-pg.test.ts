import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-23 e F-24 do plano da frente financeira (ADR 0093, decisões 10 a 12;
// migration 371): o saldo do Vela separa "Faturado em aberto" (cada B/L uma
// vez, com a avulsa) de "A faturar"; fatura cancelada volta a "A faturar".

const w = financeWorld(9309)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT count(*) FROM information_schema.routines r JOIN information_schema.parameters p USING (specific_name)
      WHERE r.routine_name = 'get_customer_pending_balances' AND p.parameter_name = 'to_invoice_brl'`) === '1'
  } catch {
    return false
  }
}, 'migration 371 aplicada')

describeLocal('371 — saldo do Vela: faturado em aberto e a faturar', () => {
  beforeAll(() => {
    w.setup()
    w.table(100)
  })
  afterAll(() => w.cleanup())

  const balance = () => JSON.parse(w.asOk('financeiro', `SELECT row_to_json(b) FROM public.get_customer_pending_balances(ARRAY[${w.customerId}]::bigint[]) b`)) as Record<string, number>

  it('conta cada B/L uma vez, a avulsa aberta e o que falta faturar; a cancelada volta a "A faturar"', () => {
    const a = w.createBl('SA'); w.calculate(a); const ia = w.issueByCe(a, '937100000000001')
    const b = w.createBl('SB'); w.calculate(b); w.issueByCe(b, '937100000000002')
    w.consolidate([a, b])
    const c = w.createBl('SC'); w.calculate(c)
    w.asOk('administrativo', `SELECT public.create_manual_invoice(${w.customerId}, 'Serviço avulso', 1, 50, NULL, NULL, NULL, '${w.actors.administrativo}'::uuid, p_reason => 'Motivo interno de teste')`)

    expect(balance()).toMatchObject({ invoiced_open_brl: 250, to_invoice_brl: 100, manual_balance_brl: 50, total_balance_brl: 350 })

    // Pago em parte pela consolidada: o saldo restante.
    w.pay(Number(w.psql(`SELECT max(id) FROM public.invoices WHERE customer_id = ${w.customerId} AND invoice_type = 'consolidated'`)), 60)
    expect(balance()).toMatchObject({ invoiced_open_brl: 190, total_balance_brl: 290 })

    // A individual cancelada (sem consolidada aberta) volta a "A faturar".
    const d = w.createBl('SD'); w.calculate(d); const id = w.issueByCe(d, '937100000000003')
    w.asOk('administrativo', `SELECT public.cancel_invoice(${id}, 'Cancelada no teste', NULL)`)
    expect(balance()).toMatchObject({ invoiced_open_brl: 190, to_invoice_brl: 200 })
    expect(ia).toBeGreaterThan(0)
  })
})
