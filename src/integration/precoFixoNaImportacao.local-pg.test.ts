import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// ADR 0094, A1 a A4 (migration 378): o preço das Taxas Locais fica fixo no
// primeiro cálculo (a importação) — tabela, Condição, data de referência e
// câmbio —, não no CE. A ETA não muda preço, Condição nova não mexe em B/L
// existente e só o pedido de refixar (aceite da reimportação) troca o preço.

const w = financeWorld(9314)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'refix_bl_local_charge_prices'`) === '1'
  } catch {
    return false
  }
}, 'migration 378 aplicada')

describeLocal('378 — preço fixo na importação', () => {
  let previousRoe = ''
  let item = 0
  let baseTable = 0

  beforeAll(() => {
    w.setup()
    previousRoe = w.psql(`SELECT coalesce(roe::text, '') || '|' || coalesce(effective_date::text, '') FROM public.exchange_rate_reference WHERE id = 1`)
    setRoe(5)
    ;[baseTable, item] = w.table(1000)
  })
  afterAll(() => {
    if (previousRoe) {
      const [roe, date] = previousRoe.split('|')
      w.psql(`UPDATE public.exchange_rate_reference SET roe = ${roe}, effective_date = '${date}' WHERE id = 1`)
    } else {
      w.psql(`SET session_replication_role = replica; DELETE FROM public.exchange_rate_reference WHERE id = 1; SET session_replication_role = origin;`)
    }
    w.psql(`SET session_replication_role = replica;
      UPDATE public.voyages SET eta = NULL WHERE id = ${w.voyageId};
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  function setRoe(roe: number) {
    w.psql(`INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, ${roe}, CURRENT_DATE)
      ON CONFLICT (id) DO UPDATE SET roe = EXCLUDED.roe, effective_date = EXCLUDED.effective_date`)
  }
  const freeze = (id: string) => w.psql(`SELECT reference_date || '|' || coalesce(roe::text, '') || '|' || reason FROM public.bl_price_freezes WHERE bl_id = '${id}'`)
  // Condição usada não se exclui pela API; o teste limpa a própria.
  const dropOverrides = (customer: number) => w.psql(`SET session_replication_role = replica;
    DELETE FROM public.customer_rate_overrides WHERE customer_id = ${customer}; SET session_replication_role = origin;`)
  const today = () => w.psql(`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date`)

  it('o primeiro cálculo fixa data (dia de Brasília) e câmbio; tabela nova não muda o B/L já importado', () => {
    const id = w.createBl('A1')
    w.calculate(id)
    expect(freeze(id)).toBe(`${today()}|5.0000|primeiro_calculo`)
    expect(w.calcTotal(id)).toBe(1000)
    // Reajuste por tabela nova: o B/L importado fica com o preço dele.
    w.table(1300, { validFrom: 'CURRENT_DATE' })
    w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${w.container()}', '22G1')`)
    expect(w.calcTotal(id)).toBe(2000)
    // B/L que entra depois usa a tabela nova.
    const later = w.createBl('A1N')
    w.calculate(later)
    expect(w.calcTotal(later)).toBe(1300)
    w.psql(`UPDATE public.charge_tables SET active = false WHERE pod = '${w.pod}' AND valid_from = CURRENT_DATE`)
  })

  it('o CE não fixa nem muda o preço', () => {
    const id = w.createBl('CE')
    w.calculate(id)
    const before = freeze(id)
    w.psql(`UPDATE public.bls SET ce_mercante = '931400000000001' WHERE id = '${id}'`)
    expect(freeze(id)).toBe(before)
  })

  it('a ETA não ancora a Condição nem recalcula o B/L', () => {
    // Condição que só valeria pela ETA (daqui a 20 dias): o B/L importado hoje não a usa.
    w.psql(`INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, active)
      VALUES (${w.customerId}, ${item}, 700, CURRENT_DATE + 10, true)`)
    w.psql(`UPDATE public.voyages SET eta = now() + interval '20 days' WHERE id = ${w.voyageId}`)
    const id = w.createBl('ETA')
    w.calculate(id)
    expect(w.calcTotal(id)).toBe(1000)
    const calculatedAt = w.psql(`SELECT max(calculated_at) FROM public.charge_calculations WHERE bl_id = '${id}'`)
    w.psql(`UPDATE public.voyages SET eta = now() + interval '40 days' WHERE id = ${w.voyageId}`)
    expect(w.psql(`SELECT max(calculated_at) FROM public.charge_calculations WHERE bl_id = '${id}'`)).toBe(calculatedAt)
    dropOverrides(w.customerId)
  })

  it('Condição nova não mexe no B/L existente; vale para o B/L que entra depois', () => {
    const id = w.createBl('CN')
    w.calculate(id)
    const calculatedAt = w.psql(`SELECT max(calculated_at) FROM public.charge_calculations WHERE bl_id = '${id}'`)
    w.psql(`INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, active)
      VALUES (${w.customerId}, ${item}, 800, CURRENT_DATE - 1, true)`)
    expect(w.psql(`SELECT max(calculated_at) FROM public.charge_calculations WHERE bl_id = '${id}'`)).toBe(calculatedAt)
    w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${w.container()}', '22G1')`)
    expect(w.calcTotal(id)).toBe(2000)
    const later = w.createBl('CNL')
    w.calculate(later)
    expect(w.calcTotal(later)).toBe(800)
    dropOverrides(w.customerId)
  })

  it('B/L sem Cliente: vinculado depois, vale a Condição do Cliente no dia da importação', () => {
    w.psql(`INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, valid_to, active)
      VALUES (${w.otherCustomerId}, ${item}, 600, CURRENT_DATE - 5, CURRENT_DATE + 5, true)`)
    const id = w.createBl('SC', { customerId: null })
    w.calculate(id)
    w.psql(`UPDATE public.bls SET customer_id = ${w.otherCustomerId}, customer_reconciliation_status = 'reconciled' WHERE id = '${id}'`)
    expect(w.calcTotal(id)).toBe(600)
    dropOverrides(w.otherCustomerId)
  })

  it('câmbio fixado: o recálculo e a emissão convertem pelo câmbio do primeiro cálculo', () => {
    w.psql(`UPDATE public.charge_tables SET active = false WHERE pod = '${w.pod}'`)
    const [usdTable, usdItem] = w.table(0)
    w.psql(`UPDATE public.charge_table_items SET currency = 'USD', unit_value_usd = 100, unit_value_brl = NULL, value_brl = 0 WHERE id = ${usdItem}`)
    const id = w.createBl('USD')
    w.calculate(id)
    expect(freeze(id)).toContain('|5.0000|')
    setRoe(6)
    w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${w.container()}', '22G1')`)
    expect(w.psql(`SELECT original_amount_brl FROM public.bl_receivables WHERE bl_id = '${id}' AND source = 'local_charges'`)).toBe('1000.00')
    const invoice = w.issueByCe(id, '931400000000002')
    expect(w.invoice(invoice).total).toBe(1000)
    setRoe(5)
    w.psql(`UPDATE public.charge_tables SET active = (id = ${baseTable}) WHERE pod = '${w.pod}'`)
    expect(usdTable).toBeGreaterThan(0)
  })

  it('reimportação idêntica não muda o preço; refixar só a pedido e nunca em B/L faturado', () => {
    const id = w.createBl('RF')
    w.calculate(id)
    w.table(1500, { validFrom: 'CURRENT_DATE' })
    // Reimportação sem aceite: os mesmos dados, nada muda.
    w.psql(`UPDATE public.bls SET pod = pod, movement_to = movement_to WHERE id = '${id}'`)
    expect(w.calcTotal(id)).toBe(1000)
    // Com o aceite: tabela, Condição, câmbio e data do dia.
    // Pelo sistema (385: nenhum Departamento chama pela API até existir a tela do aceite).
    const result = JSON.parse(w.psql(`SELECT public.refix_bl_local_charge_prices(ARRAY['${id}'], 'Aceite da reimportação')`)) as { refixed: string[] }
    expect(result.refixed).toEqual([id])
    expect(w.calcTotal(id)).toBe(1500)
    expect(freeze(id)).toContain('|refixado')
    expect(() => w.psql(`SELECT public.refix_bl_local_charge_prices(ARRAY['${id}'], '')`)).toThrow(/motivo/)
    const billed = w.createBl('RFB')
    w.calculate(billed)
    w.issueByCe(billed, '931400000000003')
    const skipped = JSON.parse(w.psql(`SELECT public.refix_bl_local_charge_prices(ARRAY['${billed}'], 'Aceite')`)) as { skipped: Array<{ reason: string }> }
    expect(skipped.skipped[0].reason).toBe('billed')
    w.psql(`UPDATE public.charge_tables SET active = false WHERE pod = '${w.pod}' AND valid_from = CURRENT_DATE`)
  })

  it('POD novo antes da emissão: tabela do POD novo ativa agora; Condição e data da importação', () => {
    const otherPod = `${w.pod}2`
    w.psql(`INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (99931490, 'Tabela FF9314 POD 2', '${otherPod}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc)
        VALUES (99931491, 99931490, 'Taxa POD 2', 'container', 400, 400, 'container_distinct_voyage', 'base', 'any', 'BRL', true);
      INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, valid_to, active)
        VALUES (${w.customerId}, 99931491, 350, CURRENT_DATE - 1, CURRENT_DATE + 1, true)`)
    try {
      const id = w.createBl('POD')
      w.calculate(id)
      const before = freeze(id)
      w.psql(`UPDATE public.bls SET pod = '${otherPod}' WHERE id = '${id}'`)
      expect(w.boundTable(id)).toBe(99931490)
      expect(w.calcTotal(id)).toBe(350)
      expect(freeze(id)).toBe(before)
    } finally {
      w.psql(`SET session_replication_role = replica;
        DELETE FROM public.customer_rate_overrides WHERE charge_item_id = 99931491;
        DELETE FROM public.bl_price_freeze_items WHERE charge_item_id = 99931491;
        DELETE FROM public.charge_calculations WHERE charge_item_id = 99931491;
        DELETE FROM public.bl_charge_table_links WHERE charge_table_id = 99931490;
        DELETE FROM public.pricing_rule_versions WHERE charge_table_id = 99931490;
        DELETE FROM public.charge_table_items WHERE id = 99931491;
        DELETE FROM public.charge_tables WHERE id = 99931490;
        SET session_replication_role = origin;`)
    }
  })

  it('A4: o backfill da 378 refaz o preço fixo pela data da importação e pelo câmbio do recebível; o faturado ganha o câmbio da fatura', () => {
    const source = readFileSync(resolve(process.cwd(), 'supabase/migrations/378_preco_fixo_na_importacao.sql'), 'utf8')
    const backfill = source.match(/DO \$backfill_378\$[\s\S]*?\$backfill_378\$;/)?.[0]
    expect(backfill).toBeTruthy()
    const open = w.createBl('BF')
    w.calculate(open)
    const billed = w.createBl('BFF')
    w.calculate(billed)
    w.issueByCe(billed, '931400000000004')
    // Estado anterior à 378 (preço congelado pela ETA, sem câmbio), o bloco da
    // migration e a leitura numa transação que o psql desfaz ao sair.
    const out = w.psql(`BEGIN;
      SET session_replication_role = replica;
      UPDATE public.bls SET created_at = '2026-10-01 15:00:00+00' WHERE id = '${open}';
      UPDATE public.bl_price_freezes SET reference_date = '2026-12-15', roe = NULL, roe_effective_date = NULL, reason = 'primeiro_calculo'
        WHERE bl_id IN ('${open}', '${billed}');
      UPDATE public.bl_receivables SET roe_frozen = 4.5, roe_effective_date_frozen = '2026-10-01' WHERE bl_id = '${open}' AND source = 'local_charges';
      UPDATE public.invoice_items SET snapshot_payload = snapshot_payload || '{"roe":"5.4321"}'::jsonb WHERE bl_id = '${billed}';
      SET session_replication_role = origin;
      ${backfill}
      SELECT string_agg(CASE WHEN f.bl_id = '${open}' THEN 'aberto' ELSE 'faturado' END || '=' || f.reference_date || '|' || f.roe || '|' || f.reason
          || '|' || (SELECT count(*) FROM public.bl_price_freeze_items i WHERE i.bl_id = f.bl_id), ';' ORDER BY f.bl_id = '${billed}')
        FROM public.bl_price_freezes f WHERE f.bl_id IN ('${open}', '${billed}');`)
    expect(out).toBe('aberto=2026-10-01|4.5000|importacao|1;faturado=2026-12-15|5.4321|faturado|1')
    expect(freeze(open)).toBe(`${today()}|5.0000|primeiro_calculo`)
  })
})
