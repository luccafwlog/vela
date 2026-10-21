import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-06 e F-08 do plano da frente financeira (migration 357): excluir o B/L
// irmão de container compartilhado corrige a fatura do vizinho; a individual
// coberta (ou com B/L baixado em outro documento) não se cancela.

const w = financeWorld(9304)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regproc('public.guard_cancel_settled_elsewhere') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 357 aplicada')

describeLocal('357 — exclusão de irmão e cancelamento de fatura coberta', () => {
  beforeAll(() => {
    w.setup()
    w.table(500)
  })
  afterAll(() => w.cleanup())

  it('F-06: excluir o irmão do container reemite a fatura do vizinho com o container inteiro', () => {
    const shared = w.container()
    const t1 = w.createBl('T1', { container: shared })
    const t2 = w.createBl('T2', { container: shared })
    w.calculate(t1)
    w.calculate(t2)
    const invoice = w.issueByCe(t1, '935700000000001')
    expect(w.invoice(invoice).total).toBe(250)

    w.asOk('administrativo', `SELECT public.delete_records('bl', ARRAY['${t2}']::text[], false, 'Excluído no teste')`)
    expect(w.invoice(invoice).status).toBe('cancelled')
    const successor = w.successorOf(invoice)
    expect(successor).not.toBeNull()
    expect(w.invoice(successor!).total).toBe(500)
  })

  it('F-08: individual coberta por consolidada paga não se cancela, e o B/L não é faturado de novo', () => {
    const a = w.createBl('CA')
    const b = w.createBl('CB')
    w.calculate(a)
    w.calculate(b)
    const ia = w.issueByCe(a, '935700000000002')
    w.issueByCe(b, '935700000000003')
    const c = w.consolidate([a, b])
    w.pay(c, 1000)
    expect(w.invoice(ia).status).toBe('covered')

    const refused = w.as('administrativo', `SELECT public.cancel_invoice(${ia}, 'Tentativa do teste', NULL)`)
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toMatch(/coberta por outro documento pago/)
    expect(w.invoice(ia).status).toBe('covered')
    expect(w.psql(`SELECT financial_status FROM public.bls WHERE id = '${a}'`)).toBe('paid')
  })

  it('F-08: individual com B/L parcialmente pago pela consolidada não se cancela', () => {
    const d = w.createBl('CD')
    const e = w.createBl('CE')
    w.calculate(d)
    w.calculate(e)
    w.issueByCe(d, '935700000000004')
    const ie = w.issueByCe(e, '935700000000005')
    const c = w.consolidate([d, e])
    w.pay(c, 700)
    expect(w.invoice(ie)).toMatchObject({ status: 'issued', balance: 300 })
    const refused = w.as('administrativo', `SELECT public.cancel_invoice(${ie}, 'Tentativa do teste', NULL)`)
    expect(refused.stderr).toMatch(/esta na consolidada|baixa em outro documento/)
  })
})
