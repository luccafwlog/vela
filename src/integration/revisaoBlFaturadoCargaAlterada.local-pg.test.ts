import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Migration 574 (a), decisão do dono de 2026-11-03: o B/L faturado ou pago que
// voltou à Revisão com a retenção "Carga … após faturamento" só sai dela com a
// fatura corrigida. Salvar revisão sem mudar dado é recusado (P0003); a
// correção de dado grava e o B/L continua Pendente; Resolver com justificativa
// a Fatura desatualizada tira o B/L da Revisão, como a reemissão.

const w = financeWorld(9574)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regprocedure('public.save_bl_review(text,timestamptz,jsonb,jsonb,uuid)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'save_bl_review presente')

describeLocal('574 — Salvar revisão do B/L faturado com a carga alterada', () => {
  beforeAll(() => {
    w.setup()
    w.table(1000)
  })
  afterAll(() => w.cleanup())

  function state(id: string) {
    const [review, hold, financial] = w.psql(`SELECT review_status, coalesce(billing_hold_reason, ''), financial_status FROM public.bls WHERE id = '${id}'`).split('|')
    return { review, hold, financial }
  }

  function save(id: string, payload: Record<string, unknown>) {
    const updatedAt = w.psql(`SELECT updated_at FROM public.bls WHERE id = '${id}'`)
    return w.as('operacoes', `SELECT public.save_bl_review('${id}', '${updatedAt}'::timestamptz, '${JSON.stringify(payload)}'::jsonb, '[]'::jsonb, '${w.actors.operacoes}'::uuid)`)
  }

  it('B/L pago que ganhou container fica na Revisão até a fatura ser corrigida', () => {
    const id = w.createBl('H1')
    w.calculate(id)
    const invoiceId = w.issueByCe(id, '957400000000001')
    w.pay(invoiceId, 1000)
    // Container a mais depois da fatura paga: valor maior com pagamento = Fatura desatualizada.
    w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${w.container()}', '22G1')`)
    expect(state(id)).toMatchObject({ review: 'pending_review', hold: 'Carga adicionada após faturamento; revisar e refaturar.', financial: 'paid' })
    expect(w.activeInvoiceAlerts('fatura_desatualizada', invoiceId)).toBe(1)

    // Sem mudar dado: recusado, com a orientação.
    const refused = save(id, {})
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toMatch(new RegExp(`B/L ${id} faturado com a carga alterada depois da fatura: a revisão só termina com a fatura corrigida`))
    expect(refused.stderr).toMatch(/Tentar aplicar correção/)
    expect(state(id).review).toBe('pending_review')

    // Com dado mudado: grava, e o B/L continua Pendente com a retenção na resposta.
    const saved = save(id, { notes: 'Conferido com o armador (574)' })
    expect(saved.status, saved.stderr).toBe(0)
    const result = JSON.parse(saved.stdout.trim().split('\n').at(-1) ?? '{}') as { review_status: string; pendencias: string[] }
    expect(result.review_status).toBe('pending_review')
    expect(result.pendencias).toContain('Carga adicionada após faturamento; revisar e refaturar.')
    expect(w.psql(`SELECT notes FROM public.bls WHERE id = '${id}'`)).toBe('Conferido com o armador (574)')

    // A diferença tratada à mão (avulsa) e o alerta resolvido: o B/L sai da Revisão.
    w.asOk('financeiro', `SELECT public.resolve_stale_invoice(${invoiceId}, 'Fatura avulsa FA-574 emitida com a diferença')`)
    expect(state(id)).toMatchObject({ review: 'ok', hold: '' })
  })

  it('B/L faturado sem essa retenção continua saindo da Revisão ao salvar', () => {
    const id = w.createBl('H2')
    w.calculate(id)
    w.issueByCe(id, '957400000000002')
    w.psql(`UPDATE public.bls SET review_status = 'pending_review' WHERE id = '${id}'`)
    const saved = save(id, {})
    expect(saved.status, saved.stderr).toBe(0)
    expect(state(id)).toMatchObject({ review: 'reviewed', financial: 'invoiced' })
  })
})
