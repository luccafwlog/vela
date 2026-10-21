import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Lote 0 do plano da frente financeira (ADR 0093, decisões 1 e 2; migration
// 354): o B/L fica com a tabela do primeiro cálculo; tabela nova vale para
// B/L novo; editar item ou Condição é correção, só do Administrativo, e
// reemite as faturas sem pagamento.

const w = financeWorld(9301)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regclass('public.bl_charge_table_links') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 354 aplicada')

describeLocal('354 — B/L vinculado à tabela de taxas', () => {
  let tableA = 0
  let itemA = 0
  let tableB = 0

  beforeAll(() => {
    w.setup()
    ;[tableA, itemA] = w.table(500, { validFrom: 'CURRENT_DATE - 60' })
  })
  afterAll(() => w.cleanup())

  it('tabela nova ativada não muda o B/L já calculado; vale para B/L novo', () => {
    const old = w.createBl('OLD')
    w.calculate(old)
    expect(w.boundTable(old)).toBe(tableA)
    expect(w.calcTotal(old)).toBe(500)

    ;[tableB] = w.table(700, { validFrom: 'CURRENT_DATE - 1' })
    w.calculate(old)
    expect(w.boundTable(old)).toBe(tableA)
    expect(w.calcTotal(old)).toBe(500)

    const fresh = w.createBl('NEW')
    w.calculate(fresh)
    expect(w.boundTable(fresh)).toBe(tableB)
    expect(w.calcTotal(fresh)).toBe(700)

    // Desativar a tabela não desvincula.
    w.psql(`UPDATE public.charge_tables SET active = false WHERE id = ${tableA}`)
    w.calculate(old)
    expect(w.boundTable(old)).toBe(tableA)
    expect(w.calcTotal(old)).toBe(500)
    w.psql(`UPDATE public.charge_tables SET active = true WHERE id = ${tableA}`)

    // Mudar o POD vincula ao escopo novo (aqui, sem tabela: pendente).
    w.psql(`UPDATE public.bls SET pod = 'FF9301OUTRO' WHERE id = '${fresh}'`)
    w.calculate(fresh)
    expect(w.boundTable(fresh)).toBeNull()
    w.psql(`UPDATE public.bls SET pod = '${w.pod}' WHERE id = '${fresh}'`)
    w.calculate(fresh)
    expect(w.boundTable(fresh)).toBe(tableB)
  })

  it('só o Administrativo edita item de tabela usada e Condição; tabela nova aceita item de todos', () => {
    const edit = w.as('operacoes', `UPDATE public.charge_table_items SET unit_value_brl = 1, value_brl = 1 WHERE id = ${itemA}`)
    expect(edit.status).not.toBe(0)
    expect(edit.stderr).toMatch(/Só o Administrativo corrige item de tabela já usada/)

    const [unused] = w.table(10, { validFrom: 'CURRENT_DATE - 400', active: false })
    w.asOk('operacoes', `INSERT INTO public.charge_table_items (charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
      VALUES (${unused}, 'Item novo', 'bl', 5, 5, 'bl', 'base', 'any', 'BRL')`)
    const used = w.as('operacoes', `INSERT INTO public.charge_table_items (charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
      VALUES (${tableA}, 'Item novo', 'bl', 5, 5, 'bl', 'base', 'any', 'BRL')`)
    expect(used.stderr).toMatch(/Só o Administrativo/)

    w.asOk('operacoes', `INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from)
      VALUES (${w.otherCustomerId}, ${itemA}, 450, CURRENT_DATE - 400)`)
    const condition = w.as('operacoes', `UPDATE public.customer_rate_overrides SET override_value = 1 WHERE customer_id = ${w.otherCustomerId}`)
    expect(condition.stderr).toMatch(/Só o Administrativo edita Condição de Cliente/)
  })

  it('editar item é correção: recalcula o não faturado, reemite sem pagamento e abre Fatura desatualizada na paga', () => {
    // B/Ls novos nascem na Tabela A de novo: a B sai de cena.
    w.psql(`UPDATE public.charge_tables SET active = false WHERE id = ${tableB}`)
    const unbilled = w.createBl('UNB')
    const unpaid = w.createBl('UNP')
    const paid = w.createBl('PAID')
    for (const id of [unbilled, unpaid, paid]) w.calculate(id)
    for (const id of [unbilled, unpaid, paid]) expect(w.boundTable(id)).toBe(tableA)

    const unpaidInvoice = w.issueByCe(unpaid, '935400000000001')
    const paidInvoice = w.issueByCe(paid, '935400000000002')
    expect(w.invoice(unpaidInvoice).total).toBe(500)
    w.pay(paidInvoice, 500)
    expect(w.invoice(paidInvoice).status).toBe('paid')

    w.asOk('administrativo', `UPDATE public.charge_table_items SET unit_value_brl = 600, value_brl = 600 WHERE id = ${itemA}`)

    expect(w.calcTotal(unbilled)).toBe(600)
    expect(w.invoice(unpaidInvoice).status).toBe('cancelled')
    const successor = w.successorOf(unpaidInvoice)
    expect(successor).not.toBeNull()
    expect(w.invoice(successor!).total).toBe(600)
    expect(w.invoice(paidInvoice).status).toBe('paid')
    expect(w.activeInvoiceAlerts('fatura_desatualizada', paidInvoice)).toBe(1)
  })

  it('Condição nova recalcula o B/L sem fatura e sem CE do Cliente', () => {
    w.psql(`UPDATE public.charge_tables SET active = true WHERE id = ${tableB}`)
    const fresh = w.createBl('COND', { customerId: w.otherCustomerId })
    w.psql(`UPDATE public.customer_rate_overrides SET active = false WHERE customer_id = ${w.otherCustomerId}`)
    w.calculate(fresh)
    const linked = w.boundTable(fresh)!
    const linkedItem = Number(w.psql(`SELECT id FROM public.charge_table_items WHERE charge_table_id = ${linked} ORDER BY id LIMIT 1`))
    const before = w.calcTotal(fresh)
    w.asOk('operacoes', `INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from)
      VALUES (${w.otherCustomerId}, ${linkedItem}, 123, CURRENT_DATE - 300)`)
    expect(before).not.toBe(123)
    expect(w.calcTotal(fresh)).toBe(123)
  })
})
