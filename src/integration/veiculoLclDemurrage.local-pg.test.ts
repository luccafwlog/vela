// Migration 592 (ADR 0123, decisão do dono de 2026-11-05): o B/L de veículo
// LCL (container, com veículo e Movement To com LCL ou CFS) tem free time fixo
// de 30 dias, e a cobrança da Demurrage dele nasce suspensa: a emissão
// automática não o cobra, a aba Containers o põe na divisão Veículo LCL e só o
// Gerar Invoice emite.
//
// Namespace exclusivo: ids 99592xxx, B/Ls 'R592-*', containers 'RQCU592xxxx',
// usuário ...000000592001. Uma Viagem por caso; a leitura filtra pela Viagem.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000592001'
const customerId = 99592001
const carrierId = 99592003
const vesselId = 99592004
const CASES = ['inside', 'running', 'returned', 'reissue', 'mixed', 'noCustomer', 'noRate', 'cancel', 'config', 'vehicleTrigger'] as const
type Case = typeof CASES[number]
const voyageOf = (name: Case) => 99592100 + CASES.indexOf(name)
const voyageIds = CASES.map(voyageOf).join(', ')
const blPrefix = 'R592-'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function run(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
}

const asAdmin = (sql: string) => `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated';
  SET LOCAL request.jwt.claim.sub = '${adminId}'; ${sql} COMMIT;`

type Box = { container_number: string; state: string; usd: number | null; free_days: number | null; free_source: string | null }
type Group = { anchor_bl_id: string; division: string; reason_code: string | null; no_rate_kind?: string | null; warning: string | null; usd: number; boxes: Box[] }

function board(voyage: Case): Group[] {
  const result = run(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${adminId}';
    SELECT public.list_demurrage_billing_board(NULL, ${voyageOf(voyage)});
    ROLLBACK;`)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '[]') as Group[]
}

const day = (offset: number) => `(now() AT TIME ZONE 'America/Sao_Paulo')::date + ${offset}`
let tableFree = 21
let p1 = 60
let p2 = 80
let p1To = 30

/** US$ da caixa com `days` dias, pela tabela 40' dry carregada no banco. */
function expectedUsd(days: number, free: number) {
  const daysP1 = Math.max(0, Math.min(days, p1To) - free)
  const daysP2 = Math.max(0, days - Math.max(p1To + 1, free + 1) + 1)
  return daysP1 * p1 + daysP2 * p2
}

let ceCounter = 0

function bl(id: string, voyage: Case, opts: { customer?: number | null; movementTo?: string | null; freeTime?: number | null } = {}) {
  const customer = opts.customer === undefined ? customerId : opts.customer
  const movement = opts.movementTo === undefined ? 'CFS/LCL' : opts.movementTo
  ceCounter += 1
  psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, movement_to, financial_status, charge_status, ce_mercante, free_time_override, demurrage_roe_manual, demurrage_roe)
        VALUES ('${blPrefix}${id}', ${voyageOf(voyage)}, ${customer ?? 'NULL'}, 'CNSHA', 'BRSSA', 'container', ${movement ? `'${movement}'` : 'NULL'}, 'pending', 'not_calculated',
                '99592${String(ceCounter).padStart(10, '0')}', ${opts.freeTime ?? 'NULL'}, true, 5.5)`)
}

function box(blId: string, number: string, opts: { type?: string; discharge?: number | null; returned?: number | null } = {}) {
  psql(`INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date, ownership)
        VALUES ('${blPrefix}${blId}', '${number}', '${opts.type ?? '40HC'}',
                ${opts.discharge == null ? 'NULL' : day(-opts.discharge)}, ${opts.returned == null ? 'NULL' : day(-opts.returned)}, 'COC')`)
}

function vehicle(blId: string, number: string) {
  psql(`INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
        SELECT b.voyage_id, c.id, b.id, 'R592CH' || c.id, 'Marca', 'Modelo', 1500, 10
          FROM public.bls AS b JOIN public.bl_containers AS c ON c.bl_id = b.id
         WHERE b.id = '${blPrefix}${blId}' AND c.container_number = '${number}'`)
}

function status(number: string) {
  return psql(`SELECT demurrage_status FROM public.bl_containers WHERE container_number = '${number}' AND bl_id LIKE '${blPrefix}%' LIMIT 1`)
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._demurrage_lcl_vehicle_exempt_box(bigint,bigint,text[],text)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 592 (_demurrage_lcl_vehicle_exempt_box)')

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r592_bls AS SELECT id FROM public.bls WHERE id LIKE '${blPrefix}%';
    CREATE TEMP TABLE r592_invoices AS SELECT id FROM public.demurrage_invoices WHERE bl_id IN (SELECT id FROM r592_bls);
    CREATE TEMP TABLE r592_vehicles AS SELECT id FROM public.vehicles WHERE bl_id IN (SELECT id FROM r592_bls);
    CREATE TEMP TABLE r592_effects AS SELECT id FROM public.import_pending_effects
      WHERE entity_id IN (SELECT id FROM r592_bls) OR entity_id IN (SELECT id::text FROM public.voyages WHERE id IN (${voyageIds}));
    CREATE TEMP TABLE r592_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'demurrage_invoice' AND entity_id IN (SELECT id::text FROM r592_invoices))
         OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM r592_effects))
         OR (entity_type = 'bl' AND entity_id IN (SELECT id FROM r592_bls))
         OR (entity_type = 'customer' AND entity_id = '${customerId}')
         OR (entity_type = 'voyage' AND entity_id IN (SELECT id::text FROM public.voyages WHERE id IN (${voyageIds})));
    CREATE TEMP TABLE r592_items AS SELECT id FROM public.alert_items
      WHERE alert_id IN (SELECT id FROM r592_alerts) OR metadata->>'bl_id' LIKE '${blPrefix}%'
         OR metadata->>'effect_id' IN (SELECT id::text FROM r592_effects);
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r592_items) OR alert_id IN (SELECT id FROM r592_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r592_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r592_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r592_items) OR alert_id IN (SELECT id FROM r592_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r592_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r592_alerts);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM r592_effects);
    DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM r592_effects);
    DELETE FROM public.portal_notifications WHERE customer_id = ${customerId} OR bl_id IN (SELECT id FROM r592_bls);
    DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM r592_invoices);
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM r592_invoices);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM r592_invoices);
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM r592_invoices);
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM r592_invoices);
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM r592_invoices);
    DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM r592_invoices);
    DELETE FROM public.demurrage_box_waivers WHERE customer_id = ${customerId} OR bl_id IN (SELECT id FROM r592_bls);
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM r592_bls);
    DELETE FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM r592_bls);
    DELETE FROM public.vehicles WHERE id IN (SELECT id FROM r592_vehicles);
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM r592_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM r592_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id IN (SELECT id FROM r592_bls)
      OR (entity_type = 'vehicles' AND entity_id IN (SELECT id::text FROM r592_vehicles))
      OR (entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (SELECT id::text FROM r592_invoices));
    DELETE FROM public.voyages WHERE id IN (${voyageIds});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    SET session_replication_role = origin;
    SET vela.retention = 'on';
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

describeLocal('Veículo LCL na Demurrage (migration 592)', () => {
  beforeAll(() => {
    cleanup()
    const rate = psql(`SELECT free_days || ',' || p1_usd || ',' || p2_usd || ',' || p1_day_to FROM public.demurrage_rates WHERE container_type = '40GP' AND active ORDER BY valid_from DESC LIMIT 1`).split(',')
    ;[tableFree, p1, p2, p1To] = rate.map(Number)
    // Os casos de status precisam de um dia entre o free time da tabela e os 30 dias.
    expect(tableFree).toBeLessThan(29)
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r592-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R592 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(592001)}', 'R592 CLIENTE VEICULOS');
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${customerId}, 'Fixture R592: gate aberto para a Demurrage', '${adminId}', now() + interval '1 day');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R592 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R592 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        ${CASES.map((name) => `(${voyageOf(name)}, ${vesselId}, 'R592-${name}', 'active')`).join(',\n        ')};
    `)
    // Dentro dos 30 dias, com condição do B/L de 7 dias e um dia além da tabela.
    bl('INSIDE', 'inside', { freeTime: 7 }); box('INSIDE', 'RQCU5920001', { discharge: tableFree + 1 }); vehicle('INSIDE', 'RQCU5920001')
    bl('RUNNING', 'running'); box('RUNNING', 'RQCU5920011', { discharge: 40 }); vehicle('RUNNING', 'RQCU5920011')
    bl('RETURNED', 'returned'); box('RETURNED', 'RQCU5920021', { discharge: 45, returned: 5 }); vehicle('RETURNED', 'RQCU5920021')
    bl('REISSUE', 'reissue'); box('REISSUE', 'RQCU5920031', { discharge: 45, returned: 5 }); vehicle('REISSUE', 'RQCU5920031')
    // Grupo do mesmo Cliente: MIXA (outra carga, FCL) e MIXB (veículo LCL) dividem
    // o RQCU5920042; o RQCU5920041 é só do veículo LCL.
    bl('MIXA', 'mixed', { movementTo: 'CY/FCL' }); bl('MIXB', 'mixed')
    box('MIXA', 'RQCU5920042', { discharge: 45, returned: 5 })
    box('MIXB', 'RQCU5920041', { discharge: 45, returned: 5 }); box('MIXB', 'RQCU5920042', { discharge: 45, returned: 5 })
    vehicle('MIXB', 'RQCU5920041')
    bl('NOCUST', 'noCustomer', { customer: null }); box('NOCUST', 'RQCU5920051', { discharge: 40 }); vehicle('NOCUST', 'RQCU5920051')
    bl('NORATE', 'noRate'); box('NORATE', 'RQCU5920061', { discharge: 40, type: 'R592ZZ' }); vehicle('NORATE', 'RQCU5920061')
    bl('CANCEL', 'cancel'); box('CANCEL', 'RQCU5920071', { discharge: 40 }); vehicle('CANCEL', 'RQCU5920071')
    bl('CONFIG', 'config'); box('CONFIG', 'RQCU5920081', { discharge: 10 }); vehicle('CONFIG', 'RQCU5920081')
    // Movement To LCL sem veículo: ainda não é veículo LCL.
    bl('VEHICLE', 'vehicleTrigger'); box('VEHICLE', 'RQCU5920091', { discharge: tableFree + 1 })
  })

  afterAll(cleanup)

  it('free time de 30 dias acima da condição do B/L, do acordo e da tarifa, no status, na Consulta e no Portal', () => {
    expect(psql(`SELECT public._container_free_days('${blPrefix}INSIDE', '40HC', ${day(-(tableFree + 1))})`)).toBe('30')
    expect(status('RQCU5920001')).toBe('within_free_time')
    expect(board('inside')).toEqual([])
    const portal = JSON.parse(psql(`SELECT public._portal_list_operation_bls_without_transshipment_core(${customerId})`)) as
      { bl_id: string; containers: { container_number: string; free_time_days: number; status: string }[] }[]
    const container = portal.find((row) => row.bl_id === `${blPrefix}INSIDE`)?.containers[0]
    expect(container).toMatchObject({ container_number: 'RQCU5920001', free_time_days: 30, status: 'dentro_free_time' })
  })

  it('passados os 30 dias, o container fica em Veículo LCL, fora de Correndo, com o US$ previsto', () => {
    expect(status('RQCU5920011')).toBe('overdue')
    const [group] = board('running')
    expect(group).toMatchObject({ division: 'veiculo_lcl', reason_code: null, warning: null, usd: expectedUsd(40, 30) })
    expect(group.boxes[0]).toMatchObject({ state: 'lcl_vehicle', free_days: 30, free_source: 'veiculo_lcl', usd: expectedUsd(40, 30) })
  })

  it('devolvido com sobreestadia: a emissão automática não cobra; o Gerar Invoice cobra com 30 dias de free time', () => {
    expect(board('returned')[0]).toMatchObject({ division: 'veiculo_lcl', reason_code: null })
    const auto = JSON.parse(psql(`SET vela.demurrage_internal = 'on'; SELECT public._run_import_effect_demurrage(NULL, '${blPrefix}RETURNED', '${adminId}')`)) as
      { status: string; containers: string[] }
    expect(auto).toMatchObject({ status: 'lcl_vehicle', containers: ['RQCU5920021'] })
    expect(psql(`SELECT count(*) FROM public.demurrage_invoices WHERE bl_id = '${blPrefix}RETURNED'`)).toBe('0')

    const manual = run(asAdmin(`SELECT public.issue_demurrage_invoice_for_bl('${blPrefix}RETURNED')->>'status';`))
    expect(manual.status, manual.stderr).toBe(0)
    expect(manual.stdout.trim()).toBe('issued')
    expect(psql(`SELECT item.free_days || '|' || item.subtotal_usd::numeric FROM public.demurrage_invoice_items AS item
      JOIN public.demurrage_invoices AS di ON di.id = item.invoice_id WHERE di.bl_id = '${blPrefix}RETURNED'`))
      .toBe(`30|${expectedUsd(40, 30).toFixed(2)}`)
    expect(board('returned')).toEqual([])
  })

  it('cobrada à mão: datas alteradas reemitem sozinhas; cancelada à mão, volta a esperar o Gerar Invoice', () => {
    expect(run(asAdmin(`SELECT public.issue_demurrage_invoice_for_bl('${blPrefix}REISSUE');`)).status).toBe(0)
    const dates = run(asAdmin(`SELECT public.set_container_dates((SELECT id FROM public.bl_containers WHERE container_number = 'RQCU5920031'),
      ${day(-45)}, ${day(-3)}, 'Correção do EIR do container', false)->'demurrage'->'demurrage_invoices'->0->'reissue'->>'status';`))
    expect(dates.status, dates.stderr).toBe(0)
    expect(dates.stdout.trim()).toBe('issued')
    expect(psql(`SELECT string_agg(status, ',' ORDER BY id) FROM public.demurrage_invoices WHERE bl_id = '${blPrefix}REISSUE'`)).toBe('cancelled,issued')

    // Sem registro de cancelamento automático: conta como cancelada à mão (530).
    psql(`SET session_replication_role = replica;
      UPDATE public.demurrage_invoices SET status = 'cancelled' WHERE bl_id = '${blPrefix}REISSUE' AND status = 'issued'`)
    expect(board('reissue')[0]).toMatchObject({ division: 'veiculo_lcl' })
    expect(psql(`SET vela.demurrage_internal = 'on';
      SELECT public._run_import_effect_demurrage(NULL, '${blPrefix}REISSUE', '${adminId}')->>'status'`)).toBe('lcl_vehicle')
  })

  it('container dividido com B/L de outra carga do mesmo Cliente é cobrado sozinho; o do veículo LCL espera', () => {
    const [before] = board('mixed')
    expect(before.division).toBe('a_emitir')
    const states = Object.fromEntries(before.boxes.map((item) => [item.container_number, item.state]))
    expect(states).toEqual({ RQCU5920041: 'lcl_vehicle', RQCU5920042: 'returned_overstay' })
    const auto = JSON.parse(psql(`SET vela.demurrage_internal = 'on'; SELECT public._run_import_effect_demurrage(NULL, '${blPrefix}MIXA', '${adminId}')`)) as { status: string }
    expect(auto.status).toBe('issued')
    expect(psql(`SELECT string_agg(item.container_number, ',') FROM public.demurrage_invoice_items AS item
      JOIN public.demurrage_invoices AS di ON di.id = item.invoice_id WHERE di.bl_id = '${blPrefix}MIXA' AND di.status = 'issued'`)).toBe('RQCU5920042')
    expect(board('mixed')[0]).toMatchObject({ division: 'veiculo_lcl', usd: expectedUsd(40, 30) })
  })

  it('sem Cliente ou com tipo sem tarifa: fica em Veículo LCL com o motivo, sem Travado nem Alerta', () => {
    expect(board('noCustomer')[0]).toMatchObject({ division: 'veiculo_lcl', reason_code: 'sem_cliente' })
    expect(board('noRate')[0]).toMatchObject({ division: 'veiculo_lcl', reason_code: 'sem_tarifa', no_rate_kind: 'tipo_novo' })
    for (const name of ['noCustomer', 'noRate'] as const) psql(`SELECT public.reconcile_demurrage_travado_alerts(${voyageOf(name)})`)
    expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'demurrage_travado' AND i.status = 'active' AND a.entity_id IN ('${blPrefix}NOCUST', '${blPrefix}NORATE')`)).toBe('0')
  })

  it('o B/L de veículo LCL se cancela sem a recusa da Demurrage e, cancelado, sai da aba', () => {
    expect(psql(`SELECT cardinality(public.bl_open_financial_reasons('${blPrefix}CANCEL'))`)).toBe('0')
    psql(`SET session_replication_role = replica; UPDATE public.bls SET cancelled_at = now() WHERE id = '${blPrefix}CANCEL'`)
    expect(board('cancel')).toEqual([])
  })

  it('a condição do B/L recusa free time próprio e aceita as diárias', () => {
    const refused = run(asAdmin(`SELECT public.save_bl_demurrage_config('${blPrefix}CONFIG', NULL, 45, NULL, NULL, '${adminId}');`))
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toMatch(/O B\/L R592-CONFIG é de veículo LCL: o free time é fixo de 30 dias/)
    const accepted = run(asAdmin(`SELECT public.save_bl_demurrage_config('${blPrefix}CONFIG', NULL, NULL, 70, NULL, '${adminId}');`))
    expect(accepted.status, accepted.stderr).toBe(0)
    expect(psql(`SELECT demurrage_rate_override_p1_usd::numeric FROM public.bls WHERE id = '${blPrefix}CONFIG'`)).toBe('70.00')
  })

  it('veículo que entra ou sai e Movement To que muda refazem o status gravado na hora', () => {
    expect(status('RQCU5920091')).toBe('overdue')
    vehicle('VEHICLE', 'RQCU5920091')
    expect(status('RQCU5920091')).toBe('within_free_time')
    psql(`UPDATE public.bls SET movement_to = 'CY/FCL' WHERE id = '${blPrefix}VEHICLE'`)
    expect(status('RQCU5920091')).toBe('overdue')
    psql(`UPDATE public.bls SET movement_to = 'CFS/LCL' WHERE id = '${blPrefix}VEHICLE'`)
    expect(status('RQCU5920091')).toBe('within_free_time')
    psql(`DELETE FROM public.vehicles WHERE bl_id = '${blPrefix}VEHICLE'`)
    expect(status('RQCU5920091')).toBe('overdue')
  })
})
