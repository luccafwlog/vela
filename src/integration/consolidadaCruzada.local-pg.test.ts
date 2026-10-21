import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-03, F-04, F-11 e F-44 do plano da frente financeira (ADR 0093, decisões
// 6 a 8; migration 356): cada baixa e cada estorno reprojetam todas as
// faturas abertas ligadas ao recebível.

const w = financeWorld(9303)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regproc('public._reproject_invoices_for_receivables') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 356 aplicada')

describeLocal('356 — consolidada e individuais coerentes', () => {
  beforeAll(() => {
    w.setup()
    w.table(100)
  })
  afterAll(() => w.cleanup())

  let ce = 0
  function issued(names: string[]) {
    return names.map((name) => {
      const id = w.createBl(name)
      w.calculate(id)
      ce += 1
      return { id, invoice: w.issueByCe(id, `9356${String(ce).padStart(11, '0')}`) }
    })
  }

  it('parcial na consolidada: a individual quitada fica Coberta; a outra mostra o saldo do seu B/L', () => {
    const [a, b] = issued(['A1', 'B1'])
    const c = w.consolidate([a.id, b.id])
    expect(w.invoice(c).total).toBe(200)
    w.pay(c, 150)
    expect(w.invoice(c)).toMatchObject({ status: 'partially_paid', balance: 50 })
    expect(w.invoice(a.invoice)).toMatchObject({ status: 'covered', balance: 0 })
    expect(w.invoice(b.invoice)).toMatchObject({ status: 'issued', balance: 50 })
  })

  it('parcial na individual: a consolidada mostra o saldo restante com o mesmo número', () => {
    const [d, e] = issued(['D2', 'E2'])
    const c = w.consolidate([d.id, e.id])
    w.pay(d.invoice, 40)
    expect(w.invoice(d.invoice)).toMatchObject({ status: 'partially_paid', balance: 60 })
    expect(w.invoice(c)).toMatchObject({ status: 'issued', total: 200, balance: 160 })
    expect(w.successorOf(c)).toBeNull()
  })

  it('individual paga por inteiro: a consolidada é substituída pelos B/Ls restantes, com aviso no Portal; o estorno não revive a substituída', () => {
    const [g, h] = issued(['G3', 'H3'])
    const c = w.consolidate([g.id, h.id])
    const payment = w.pay(g.invoice, 100)
    expect(w.invoice(g.invoice).status).toBe('paid')
    expect(w.invoice(c).status).toBe('obsolete')
    const successor = w.successorOf(c)
    expect(successor).not.toBeNull()
    expect(w.invoice(successor!)).toMatchObject({ status: 'issued', total: 100, balance: 100, replaces: c })
    expect(w.psql(`SELECT obsolete_reason FROM public.invoices WHERE id = ${c}`)).toMatch(/^Substituida pela /)
    expect(Number(w.psql(`SELECT count(*) FROM public.portal_notifications WHERE customer_id = ${w.customerId} AND title = 'Fatura consolidada substituída'`))).toBeGreaterThan(0)
    // F-44: um evento `obsolete` só.
    expect(w.psql(`SELECT count(*) FROM public.invoice_lifecycle_events WHERE invoice_id = ${c} AND event_type = 'obsolete'`)).toBe('1')

    // Decisão 8 (migration 361): a substituída aparece no Portal em "Cancelada", com a sucessora.
    expect(w.psql(`SELECT status || '|' || balance_brl FROM public._portal_list_invoices_core(${w.customerId}) WHERE id = ${c}`)).toBe('obsolete|0')
    const page = JSON.parse(w.psql(`SELECT public._portal_list_invoices_page_core(${w.customerId}, 100, 0, 'cancelled')`)) as {
      rows: Array<{ id: number; replaced_by_invoice_number: string | null }>
    }
    const successorNumber = w.psql(`SELECT invoice_number FROM public.invoices WHERE id = ${successor}`)
    expect(page.rows.find((row) => row.id === c)?.replaced_by_invoice_number).toBe(successorNumber)
    const detail = JSON.parse(w.psql(`SELECT public._portal_invoice_details_core(${w.customerId}, ${c})`)) as { invoice: Record<string, unknown> }
    expect(detail.invoice).toMatchObject({ status: 'obsolete', replaced_by_invoice_id: successor, pix_payload: null })

    w.reversePayment(payment.payment_id)
    expect(w.invoice(g.invoice)).toMatchObject({ status: 'issued', balance: 100 })
    expect(w.invoice(c).status).toBe('obsolete')
    expect(w.invoice(successor!)).toMatchObject({ status: 'issued', balance: 100 })
  })

  it('estorno revive só a consolidada obsoletada pelo próprio pagamento, quando ela não tem sucessora', () => {
    const [f] = issued(['F4'])
    const [k] = issued(['K4'])
    const solo = w.consolidate([f.id])
    const other = w.consolidate([k.id])
    const paidF = w.pay(f.invoice, 100)
    expect(w.invoice(solo).status).toBe('obsolete')
    expect(w.successorOf(solo)).toBeNull()
    w.pay(k.invoice, 100)
    expect(w.invoice(other).status).toBe('obsolete')

    w.reversePayment(paidF.payment_id)
    expect(w.invoice(solo)).toMatchObject({ status: 'issued', balance: 100 })
    expect(w.invoice(other).status).toBe('obsolete')
  })

  it('um B/L fica em uma consolidada aberta só', () => {
    const [m, n] = issued(['M5', 'N5'])
    w.consolidate([m.id, n.id])
    const again = w.as('administrativo', `SELECT public.create_local_consolidated_invoice(${w.customerId}, ARRAY[${w.receivableId(m.id)}]::bigint[], NULL, '${w.actors.administrativo}'::uuid)`)
    expect(again.status).not.toBe(0)
    expect(again.stderr).toMatch(/consolidada aberta/)
  })

  it('QR antigo da consolidada substituída, pago pelo Itaú, quita a sucessora e o excedente vira restituição (decisão 8)', () => {
    const settings = w.psql(`SELECT pix_provider || '|' || coalesce(itau_pix_settlement_actor::text, '') FROM public.app_settings WHERE id = 1`)
    const [provider, actor] = settings.split('|')
    try {
      w.psql(`UPDATE public.app_settings SET pix_provider = 'itau', itau_pix_settlement_actor = '${w.actors.administrativo}' WHERE id = 1`)
      const [p, q] = issued(['P6', 'Q6'])
      const c = w.consolidate([p.id, q.id])
      const txid = w.psql(`SELECT txid FROM public.itau_pix_charges WHERE invoice_id = ${c} ORDER BY id LIMIT 1`)
      expect(txid).not.toBe('')
      w.pay(p.invoice, 100)
      const successor = w.successorOf(c)!
      expect(w.invoice(successor).balance).toBe(100)
      expect(w.psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_settle('E3610000000000000000000000000001', '${txid}', 200, now())`)).toBe('settled')
      expect(w.invoice(successor).status).toBe('paid')
      expect(w.psql(`SELECT coalesce(sum(amount_brl), 0) FROM public.invoice_refunds WHERE invoice_id = ${successor} AND status = 'pending'`)).toBe('100.00')
    } finally {
      w.psql(`DELETE FROM public.itau_pix_receipts WHERE end_to_end_id = 'E3610000000000000000000000000001';
        DELETE FROM public.itau_pix_charges WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${w.customerId});
        UPDATE public.app_settings SET pix_provider = '${provider}', itau_pix_settlement_actor = ${actor ? `'${actor}'` : 'NULL'} WHERE id = 1`)
    }
  })
})
