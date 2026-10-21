import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-01 e F-02 do plano da frente financeira (ADR 0093, decisão 3; migration
// 355): no dia do CE só o preço fica congelado; a base (containers e rateio,
// Movement To, veículos) é a atual na emissão, inclusive da fatura retida.

const w = financeWorld(9302)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regclass('public.bl_price_freezes') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 355 aplicada')

describeLocal('355 — preço do dia do CE, base atual', () => {
  let item = 0

  beforeAll(() => {
    w.setup()
    ;[, item] = w.table(1000)
    w.closeGate()
  })
  afterAll(() => w.cleanup())

  it('F-01: irmão que chega depois do CE divide o container da retida; o container é cobrado uma vez', () => {
    const shared = w.container()
    const p1 = w.createBl('P1', { container: shared })
    w.calculate(p1)
    w.issueByCe(p1, '935500000000001')
    expect(w.psql(`SELECT billing_hold_reason IS NOT NULL FROM public.bls WHERE id = '${p1}'`)).toBe('t')
    expect(w.calcTotal(p1)).toBe(1000)

    const p2 = w.createBl('P2', { container: shared })
    w.calculate(p2)
    expect(w.calcTotal(p2)).toBe(500)
    // O fim da transação que trouxe o irmão recalculou a retida com CE.
    expect(w.calcTotal(p1)).toBe(500)

    w.openGate()
    const first = w.liveInvoice(p1)
    expect(w.invoice(first).total).toBe(500)
    const second = w.issueByCe(p2, '935500000000002')
    expect(w.invoice(second).total).toBe(500)
  })

  it('F-01: irmão cancelado antes da Liberação devolve o container inteiro à retida', () => {
    w.closeGate()
    const shared = w.container()
    const r1 = w.createBl('R1', { container: shared })
    const r2 = w.createBl('R2', { container: shared })
    w.calculate(r1)
    w.calculate(r2)
    w.issueByCe(r1, '935500000000003')
    expect(w.calcTotal(r1)).toBe(500)

    w.cancelBl(r2)
    expect(w.calcTotal(r1)).toBe(1000)
    w.openGate()
    expect(w.invoice(w.liveInvoice(r1)).total).toBe(1000)
  })

  it('F-02: correção da ficha entre o CE e a Liberação entra na emissão (Movement To vira LCL e o B/L de veículos fica isento)', () => {
    w.closeGate()
    const v = w.createBl('VEH')
    w.psql(`INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
      SELECT ${w.voyageId}, c.id, '${v}', 'FF9302CHASSI0001', 'Marca', 'Modelo', 1500, 10 FROM public.bl_containers c WHERE c.bl_id = '${v}'`)
    w.calculate(v)
    w.issueByCe(v, '935500000000004')
    expect(w.calcTotal(v)).toBe(1000)

    w.psql(`UPDATE public.bls SET movement_to = 'LCL / CFS' WHERE id = '${v}'`)
    expect(w.psql(`SELECT charge_status FROM public.bls WHERE id = '${v}'`)).toBe('exempt')
    w.openGate()
    expect(w.psql(`SELECT count(*) FROM public.invoice_bls WHERE bl_id = '${v}'`)).toBe('0')
  })

  it('o preço fixo fica: Condição nova não entra; correção da base usa o preço congelado; correção do item entra', () => {
    w.closeGate()
    const f = w.createBl('FRZ')
    w.calculate(f)
    w.issueByCe(f, '935500000000005')
    expect(w.calcTotal(f)).toBe(1000)

    w.asOk('operacoes', `INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from)
      VALUES (${w.customerId}, ${item}, 300, CURRENT_DATE - 365)`)
    expect(w.calcTotal(f)).toBe(1000)

    // Segundo container: base nova, preço do CE (sem a Condição criada depois).
    w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${f}', '${w.container()}', '22G1')`)
    expect(w.calcTotal(f)).toBe(2000)

    // Correção do item (decisão 2) vale também para o preço congelado.
    w.asOk('administrativo', `UPDATE public.charge_table_items SET unit_value_brl = 1100, value_brl = 1100 WHERE id = ${item}`)
    expect(w.calcTotal(f)).toBe(2200)
  })
})
