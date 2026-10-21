import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Lote 2 da frente das importações (migration 392; ADR 0095, decisões 5, 8, 9,
// 10, 26 e 27; revisão de 2026-10-21, F-05, F-15, F-27 e F-50). Chama a RPC da
// tela (`import_bl_freight_file_atomic`) como o operador, com payloads montados
// à mão: o servidor confere as regras sem confiar na prévia.

const w = financeWorld(9392)
const otherVoyageId = 99_000_000 + 9392 * 100 + 50

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'bl_file_import_preview'`) === '1'
  } catch {
    return false
  }
}, 'migration 392 aplicada')

describeLocal('392 — arquivo de B/L com as regras no servidor', () => {
  let cnpjA = ''
  let cnpjB = ''
  let previousRoe = ''
  let ce = 0

  beforeAll(() => {
    w.setup()
    previousRoe = w.psql(`SELECT coalesce(roe::text, '') || '|' || coalesce(effective_date::text, '') FROM public.exchange_rate_reference WHERE id = 1`)
    w.psql(`INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, 5, CURRENT_DATE)
      ON CONFLICT (id) DO UPDATE SET roe = EXCLUDED.roe, effective_date = EXCLUDED.effective_date`)
    w.table(1000)
    cnpjA = w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.customerId}`)
    cnpjB = w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.otherCustomerId}`)
    w.psql(`INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      SELECT ${otherVoyageId}, vessel_id, 'FF9392B', 'active' FROM public.voyages WHERE id = ${w.voyageId}`)
  })
  afterAll(() => {
    if (previousRoe) {
      const [roe, date] = previousRoe.split('|')
      w.psql(`UPDATE public.exchange_rate_reference SET roe = ${roe}, effective_date = '${date}' WHERE id = 1`)
    }
    w.psql(`SET session_replication_role = replica;
      DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM public.bls WHERE voyage_id = ${otherVoyageId});
      DELETE FROM public.bls WHERE voyage_id = ${otherVoyageId};
      DELETE FROM public.voyages WHERE id = ${otherVoyageId};
      DELETE FROM public.import_batches WHERE voyage_id IN (${w.voyageId}, ${otherVoyageId});
      SET session_replication_role = origin;`)
    w.cleanup()
  })

  /** Linha do arquivo como a tela monta (Cliente A por padrão). */
  function line(id: string, containers: string[], extra: Record<string, unknown> = {}) {
    return {
      id, voyage_id: w.voyageId, pol: 'CNSHA', pod: w.pod, cargo_mode: 'container',
      customer_id: w.customerId, customer_reconciliation_status: 'matched_document',
      manifest_customer_cnpj_cpf: cnpjA, manifest_customer_name: 'Cliente FF9392-0',
      billing_impact: false, override_billing: false,
      containers: containers.map((number) => ({ container_number: number, type: '22G1', gross_weight_kg: 12000, cbm: 30 })),
      total_weight_kg: 12000 * containers.length, total_cbm: 30 * containers.length,
      ...extra,
    }
  }
  function importFile(lines: unknown[]) {
    return w.as('administrativo', `SELECT public.import_bl_freight_file_atomic($json$${JSON.stringify(lines)}$json$::jsonb, '${w.actors.administrativo}'::uuid, NULL)`)
  }
  function importOk(lines: unknown[]): Record<string, unknown> {
    const result = importFile(lines)
    expect(result.status, result.stderr).toBe(0)
    return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
  }
  const containersOf = (id: string) => w.psql(`SELECT string_agg(container_number, ',' ORDER BY container_number) FROM public.bl_containers WHERE bl_id = '${id}'`)
  const blField = (id: string, field: string) => w.psql(`SELECT coalesce(${field}::text, 'null') FROM public.bls WHERE id = '${id}'`)
  function invoicedBl(name: string) {
    const id = w.createBl(name)
    w.calculate(id)
    ce += 1
    w.issueByCe(id, `9392${String(ce).padStart(11, '0')}`)
    return id
  }

  it('decisão 5: B/L que está em outra Viagem recusa o arquivo e não sai da Viagem dele', () => {
    const id = w.createBl('OUTRA')
    const container = containersOf(id)
    const result = importFile([{ ...line(id, [container]), voyage_id: otherVoyageId }])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`O B/L ${id} já está na Viagem Vessel FF9392 FF9392: cancele ou exclua o B/L lá e importe de novo.`)
    expect(blField(id, 'voyage_id')).toBe(String(w.voyageId))

    w.cancelBl(id)
    const cancelled = importFile([{ ...line(id, [container]), voyage_id: otherVoyageId }])
    expect(cancelled.stderr).toContain(`O B/L ${id} está cancelado na Viagem Vessel FF9392 FF9392: o número continua lá. Exclua o B/L na Viagem`)
  })

  it('decisão 8: B/L cancelado fica de fora com aviso e o resto do arquivo entra', () => {
    const cancelled = w.createBl('CANC')
    const before = containersOf(cancelled)
    w.cancelBl(cancelled)
    const fresh = w.bl('NOVO8')
    const result = importOk([line(cancelled, [before, w.container()]), line(fresh, [w.container()])])
    expect(result.cancelled_skipped).toEqual([{ bl_id: cancelled, message: expect.stringContaining('reative o B/L pela ficha (Administrativo) e importe de novo') }])
    expect(containersOf(cancelled)).toBe(before)
    expect(blField(cancelled, 'cancelled_at')).not.toBe('null')
    expect(blField(fresh, 'customer_id')).toBe(String(w.customerId))
  })

  it('F-15: o Cliente sai do CNPJ; customer_id de outro Cliente é recusado', () => {
    const id = w.bl('F15')
    const wrong = importFile([line(id, [w.container()], { customer_id: w.otherCustomerId })])
    expect(wrong.stderr).toContain(`B/L ${id}: o Cliente enviado não é o do CNPJ do consignatário no arquivo.`)
    expect(blField(id, 'id')).toBe('')

    importOk([line(id, [w.container()], { customer_id: null, customer_reconciliation_status: 'missing_customer' })])
    expect(blField(id, 'customer_id')).toBe(String(w.customerId))
    expect(blField(id, 'customer_reconciliation_status')).toBe('matched_document')
  })

  it('decisão 10: B/L só calculado recebe a base sem confirmação; a confirmação sem fatura é recusada', () => {
    const id = w.createBl('CALC')
    w.calculate(id)
    const kept = containersOf(id)
    const added = w.container()
    const refused = importFile([line(id, [kept, added], { override_billing: true, billing_impact: true })])
    expect(refused.stderr).toContain(`B/L ${id}: a confirmação de faturamento só vale para B/L com fatura emitida.`)

    importOk([line(id, [kept, added])])
    expect(containersOf(id)).toBe([kept, added].sort().join(','))
    expect(Number(blField(id, 'total_weight_kg'))).toBe(24000)
  })

  it('decisão 10 / F-27: B/L faturado sem a confirmação não muda containers, peso, cubagem, POD nem Place of Delivery', () => {
    const id = invoicedBl('FAT')
    const kept = containersOf(id)
    const before = ['total_weight_kg', 'total_cbm', 'pod', 'place_of_delivery'].map((field) => blField(id, field))
    const payload = line(id, [kept, w.container()], { pod: 'BRRIO', place_of_delivery: 'BRRIO', billing_impact: true })

    const noImpact = importFile([{ ...payload, override_billing: true, billing_impact: false }])
    expect(noImpact.stderr).toContain(`B/L ${id}: a confirmação de faturamento chegou sem o impacto mostrado na prévia.`)

    importOk([payload])
    expect(containersOf(id)).toBe(kept)
    expect(['total_weight_kg', 'total_cbm', 'pod', 'place_of_delivery'].map((field) => blField(id, field))).toEqual(before)

    const refix = importFile([{ ...line(id, [kept]), refix_prices: true }])
    expect(refix.stderr).toContain(`B/L ${id} já faturado: o preço é o da fatura e não é refixado.`)
  })

  it('decisão 9: a prévia mostra o preço de hoje sem gravar; só o aceite refixa', () => {
    const id = w.createBl('REFIX')
    w.calculate(id)
    const container = containersOf(id)
    const freeze = () => w.psql(`SELECT reference_date || '|' || roe || '|' || reason FROM public.bl_price_freezes WHERE bl_id = '${id}'`)
    const frozen = freeze()
    expect(w.calcTotal(id)).toBe(1000)
    // Tabela nova, mais nova que a vinculada: o preço de hoje muda.
    w.table(1500, { validFrom: 'CURRENT_DATE' })

    const [state] = w.json<Array<{ invoiced: boolean; refix: { before: { total_brl: number }; after: { total_brl: number }; differs: boolean } }>>(
      'administrativo', `SELECT public.bl_file_import_preview(${w.voyageId}, ARRAY['${id}'])`)
    expect(state.invoiced).toBe(false)
    expect(state.refix.differs).toBe(true)
    expect(Number(state.refix.before.total_brl)).toBe(1000)
    expect(Number(state.refix.after.total_brl)).toBe(1500)
    // Nada ficou gravado pela prévia.
    expect(freeze()).toBe(frozen)
    expect(w.calcTotal(id)).toBe(1000)

    const without = importOk([line(id, [container])])
    expect(without.prices_refixed).toEqual([])
    expect(freeze()).toBe(frozen)

    const accepted = importOk([line(id, [container], { refix_prices: true })])
    expect(accepted.prices_refixed).toEqual([id])
    expect(freeze()).toMatch(/\|refixado$/)
    expect(w.calcTotal(id)).toBe(1500)
    expect(w.psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${id}' AND field_name = 'local_charge_prices_refixed'`)).toBe('1')

    // A função de refixar continua sem EXECUTE para a API.
    expect(w.psql(`SELECT has_function_privilege('authenticated', 'public.refix_bl_local_charge_prices(text[], text)', 'EXECUTE')`)).toBe('f')
    expect(w.psql(`SELECT has_function_privilege('authenticated', 'public.bl_file_import_preview(bigint, text[])', 'EXECUTE')`)).toBe('t')
  })

  it('decisão 26: a aba VIN não grava veículos e acaba a exceção vela.vin_reissue', () => {
    const id = w.bl('VIN')
    const container = w.container()
    importOk([line(id, [container], {
      vehicles: [{ chassis: 'FF9392VIN00000001', container_number: container, brand: 'B', model: 'M', weight_kg: 1, cbm: 1 }],
      confirm_vehicle_changes: true,
    })])
    expect(w.psql(`SELECT count(*) FROM public.vehicles WHERE bl_id = '${id}'`)).toBe('0')

    w.psql(`INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
      SELECT ${w.voyageId}, id, '${id}', 'FF9392VIN00000002', 'B', 'M', 1, 1 FROM public.bl_containers WHERE bl_id = '${id}'`)
    w.cancelBl(id)
    const other = w.createBl('VIN2')
    // O marcador da 385 não abre mais o B/L cancelado.
    expect(() => w.psql(`BEGIN; SELECT set_config('vela.vin_reissue', 'on', true);
      UPDATE public.vehicles SET bl_id = '${other}' WHERE bl_id = '${id}'; COMMIT;`)).toThrow(/cancelado é somente leitura/)
  })

  it('decisão 27: B/L LCL divide o container com outro Cliente; FCL é recusado; arquivo sem modalidade mantém a gravada', () => {
    const shared = w.container()
    importOk([line(w.bl('LCL1'), [shared])])
    const lcl = w.bl('LCL2')
    const fromB = { customer_id: w.otherCustomerId, manifest_customer_cnpj_cpf: cnpjB }

    const fcl = importFile([line(lcl, [shared], { ...fromB, container_load_type: 'FCL' })])
    expect(fcl.stderr).toContain('container FCL nao e dividido entre Clientes diferentes')

    importOk([line(lcl, [shared], { ...fromB, container_load_type: 'LCL' })])
    expect(blField(lcl, 'container_load_type')).toBe('LCL')
    expect(blField(lcl, 'customer_id')).toBe(String(w.otherCustomerId))

    importOk([line(lcl, [shared], { ...fromB, container_load_type: null })])
    expect(blField(lcl, 'container_load_type')).toBe('LCL')
  })
})
