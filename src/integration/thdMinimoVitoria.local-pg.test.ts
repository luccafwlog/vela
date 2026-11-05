import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// ADR 0125 (migration 594): o THD por tonelada da tabela de carga solta de
// Vitória cobra no mínimo R$ 380,00 por B/L, também com Condição do Cliente.
// Quantidade e unitário ficam os da tabela; só o total sobe. Outros itens por
// tonelada e tabelas de outros portos não mudam.

const vix = financeWorld(9594, { pod: 'BRVIX' })
const outro = financeWorld(9595)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return vix.psql(`SELECT count(*) FROM pg_proc WHERE proname = '_thd_weight_ton_minimum_brl'`) === '1'
  } catch {
    return false
  }
}, 'migration 594 aplicada')

type World = ReturnType<typeof financeWorld>

/** Tabela de carga solta no POD do mundo com THD e Armazenagem por tonelada. */
function cargaSoltaTable(w: World) {
  const tableId = 99_000_000 + w.ns * 100 + 10
  w.psql(`
    INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${tableId}, 'Carga solta FF${w.ns}', '${w.pod}', CURRENT_DATE - 30, true, 'carga_solta');
    INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc, sort_order) VALUES
      (${tableId + 30}, ${tableId}, 'THD', 'bl', 62.5, 62.5, 'weight_ton', 'base', 'any', 'BRL', true, 1),
      (${tableId + 31}, ${tableId}, 'Armazenagem', 'bl', 10, 10, 'weight_ton', 'base', 'any', 'BRL', true, 2);
  `)
  return { tableId, thd: tableId + 30, armazenagem: tableId + 31 }
}

/** B/L de carga solta vinculado à tabela do teste (a cadeia já traz outra de Vitória). */
function bbBl(w: World, tableId: number, name: string, weightTon: number, customerId = w.customerId) {
  const id = w.bl(name)
  w.psql(`
    INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, bb_weight_ton)
      VALUES ('${id}', ${w.voyageId}, ${customerId}, '${w.pod}', 'carga_solta', 'pending', 'not_calculated', 'reconciled', ${weightTon});
    INSERT INTO public.bl_charge_table_links (bl_id, scope, charge_table_id) VALUES ('${id}', 'carga_solta', ${tableId})
      ON CONFLICT (bl_id, scope) DO UPDATE SET charge_table_id = EXCLUDED.charge_table_id;
  `)
  w.calculate(id)
  return id
}

/** quantidade|unitário|total da linha automática do item. */
function line(w: World, blId: string, itemId: number) {
  return w.psql(`SELECT quantity || '|' || unit_value_brl || '|' || total_value_brl FROM public.charge_calculations
    WHERE bl_id = '${blId}' AND calculation_key = 'auto:item:${itemId}' AND status = 'calculated'`)
}

describeLocal('594 — THD mínimo de R$ 380 na carga solta de Vitória', () => {
  let vixTable: ReturnType<typeof cargaSoltaTable>
  let outroTable: ReturnType<typeof cargaSoltaTable>

  beforeAll(() => {
    vix.setup()
    outro.setup()
    vixTable = cargaSoltaTable(vix)
    outroTable = cargaSoltaTable(outro)
  })
  afterAll(() => {
    vix.cleanup()
    outro.cleanup()
  })

  it('2 t × R$ 62,50 = R$ 125,00 cobra R$ 380,00; quantidade e unitário ficam os da tabela', () => {
    const id = bbBl(vix, vixTable.tableId, 'DUAS', 2)
    expect(line(vix, id, vixTable.thd)).toBe('2.000|62.50|380.00')
    expect(vix.psql(`SELECT notes FROM public._resolve_bl_local_charge_items_table('${id}', 'BRVIX') WHERE charge_item_id = ${vixTable.thd}`))
      .toBe('THD com valor mínimo de R$ 380,00 por B/L')
  })

  it('acima do mínimo cobra toneladas × unitário', () => {
    const id = bbBl(vix, vixTable.tableId, 'DEZ', 10)
    expect(line(vix, id, vixTable.thd)).toBe('10.000|62.50|625.00')
  })

  it('com Condição do Cliente no THD o mínimo continua valendo', () => {
    // A condição é do outro Cliente do mundo: tarifa usada não se exclui, e
    // os demais B/Ls do teste seguem sem condição.
    vix.psql(`INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, active)
      VALUES (${vix.otherCustomerId}, ${vixTable.thd}, 50, CURRENT_DATE - 60, true)`)
    const id = bbBl(vix, vixTable.tableId, 'COND', 2, vix.otherCustomerId)
    expect(line(vix, id, vixTable.thd)).toBe('2.000|50.00|380.00')
    expect(vix.psql(`SELECT override_applied FROM public.charge_calculations WHERE bl_id = '${id}' AND calculation_key = 'auto:item:${vixTable.thd}'`)).toBe('t')
  })

  it('outro item por tonelada e o THD de tabela de outro porto não têm mínimo', () => {
    const id = bbBl(vix, vixTable.tableId, 'ARMZ', 2)
    expect(line(vix, id, vixTable.armazenagem)).toBe('2.000|10.00|20.00')
    const fora = bbBl(outro, outroTable.tableId, 'FORA', 2)
    expect(line(outro, fora, outroTable.thd)).toBe('2.000|62.50|125.00')
  })

  it('a fatura emitida cobra o mínimo', () => {
    const id = bbBl(vix, vixTable.tableId, 'FAT', 2)
    const invoice = vix.issueByCe(id, '959400000000001')
    // THD R$ 380,00 + Armazenagem 2 t × R$ 10,00.
    expect(vix.invoice(invoice).total).toBe(400)
  })
})
