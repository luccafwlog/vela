// Migration 214 — Demurrage cobrada uma vez por caixa (decisão do dono de
// 2026-10-12, revisão final da PR 929). "Já faturado" era decidido pelo grupo
// de B/Ls de hoje; agora é pela caixa (número normalizado, não-SOC) já em
// Invoice emitida, vencida ou paga da mesma Viagem e do mesmo Cliente. Cada
// caso falha sem a migration:
// - grupo que se divide depois da emissão não cobra a caixa de novo;
// - âncora cancelado com a Invoice do grupo paga: o B/L que restou não é
//   cobrado de novo;
// - irmão que chega depois com caixa nova: a emissão é enfileirada e sai uma
//   Invoice complementar só com a caixa nova; com tudo coberto, 'existing';
// - irmão que liga dois grupos: a correção de datas reemite a caixa corrigida
//   em vez de devolver a Invoice do outro grupo como 'existing';
// - a caixa que saiu do grupo é reemitida pelo âncora do B/L que a tem;
// - caixa que a reemissão não cobra (virou SOC) deixa o Alerta dizendo qual.
//
// Namespace exclusivo: ids 99214xxx, B/Ls 'R214-*', containers 'RQCU214xxxx',
// usuário ...000000214001. A limpeza roda com `session_replication_role =
// replica`, porque B/L cancelado e Invoice paga recusam mudança.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000214001'
const customerId = 99214001
const carrierId = 99214002
const vesselId = 99214003
const voyage = {
  split: 99214010,
  paid: 99214011,
  late: 99214012,
  bridge: 99214013,
  regroup: 99214014,
  lost: 99214015,
}
const voyageIds = Object.values(voyage).join(', ')
const bl = {
  splitA: 'R214-SA',
  splitB: 'R214-SB',
  paidA: 'R214-PA',
  paidB: 'R214-PB',
  lateA: 'R214-LA',
  lateB: 'R214-LB',
  bridgeA: 'R214-BA',
  bridgeB: 'R214-BB',
  bridgeC: 'R214-BC',
  regroupA: 'R214-GA',
  regroupB: 'R214-GB',
  lostA: 'R214-OA',
  lostB: 'R214-OB',
}
const blList = Object.values(bl).map((id) => `'${id}'`).join(', ')
const box = {
  splitShared: 'RQCU2140001',
  splitOwn: 'RQCU2140002',
  paidShared: 'RQCU2140011',
  lateShared: 'RQCU2140021',
  lateNew: 'RQCU2140022',
  bridgeX: 'RQCU2140031',
  bridgeZ: 'RQCU2140032',
  regroupShared: 'RQCU2140041',
  regroupOwn: 'RQCU2140042',
  lostShared: 'RQCU2140051',
  lostGone: 'RQCU2140052',
}
const discharge = '2026-07-01'
const returned = '2026-09-20'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function run(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
}

function asAdmin(sql: string) {
  return run(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${adminId}';
    ${sql};
    COMMIT;
  `)
}

function adminJson<T>(sql: string): T {
  const result = asAdmin(sql)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? 'null') as T
}

type IssueResult = { status: string; invoice_id?: number; invoice_ids?: number[]; anchor_bl_id?: string; complementary?: boolean }

function issue(blId: string): IssueResult {
  return JSON.parse(psql(`SET vela.demurrage_internal = 'on';
    SELECT public.issue_demurrage_invoice_for_bl('${blId}', 'R214-DEM-${blId}-' || floor(random() * 1e9)::bigint)`)) as IssueResult
}

function containerId(blId: string, number: string): number {
  return Number(psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${blId}' AND container_number = '${number}'`))
}

// Invoices vivas da Viagem: "id:B/L:caixas" em ordem de id.
function liveInvoices(voyageId: number): string[] {
  const rows = psql(`
    SELECT di.id || ':' || di.bl_id || ':' || string_agg(item.container_number, ',' ORDER BY item.container_number)
    FROM public.demurrage_invoices AS di
    JOIN public.bls AS b ON b.id = di.bl_id
    JOIN public.demurrage_invoice_items AS item ON item.invoice_id = di.id
    WHERE b.voyage_id = ${voyageId} AND di.status IN ('issued', 'overdue', 'paid')
    GROUP BY di.id, di.bl_id ORDER BY di.id`)
  return rows ? rows.split('\n') : []
}

function boxesOf(invoiceId: number): string {
  return psql(`SELECT string_agg(container_number, ',' ORDER BY container_number) FROM public.demurrage_invoice_items WHERE invoice_id = ${invoiceId}`)
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._demurrage_billed_container_keys(bigint,bigint,bigint)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 214 (_demurrage_billed_container_keys)')

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r214_invoices AS SELECT id FROM public.demurrage_invoices WHERE bl_id IN (${blList});
    CREATE TEMP TABLE r214_effects AS SELECT id FROM public.import_pending_effects WHERE entity_id IN (${blList});
    CREATE TEMP TABLE r214_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'demurrage_invoice' AND entity_id IN (SELECT id::text FROM r214_invoices))
         OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM r214_effects))
         OR (entity_type = 'bl' AND entity_id IN (${blList}));
    CREATE TEMP TABLE r214_items AS SELECT id FROM public.alert_items
      WHERE alert_id IN (SELECT id FROM r214_alerts) OR metadata->>'bl_id' LIKE 'R214-%'
         OR metadata->>'effect_id' IN (SELECT id::text FROM r214_effects);
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r214_items) OR alert_id IN (SELECT id FROM r214_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r214_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r214_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r214_items) OR alert_id IN (SELECT id FROM r214_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r214_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r214_alerts);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM r214_effects);
    DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM r214_effects);
    DELETE FROM public.portal_notifications WHERE customer_id = ${customerId} OR bl_id IN (${blList});
    DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM r214_invoices);
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM r214_invoices);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM r214_invoices);
    DELETE FROM public.demurrage_refunds WHERE invoice_id IN (SELECT id FROM r214_invoices);
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM r214_invoices);
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM r214_invoices);
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM r214_invoices);
    DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM r214_invoices);
    DELETE FROM public.customer_demurrage_agreements WHERE customer_id = ${customerId};
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (${blList});
    DELETE FROM public.bl_containers WHERE bl_id IN (${blList});
    DELETE FROM public.bls WHERE id IN (${blList});
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id IN (${blList})
      OR (entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (SELECT id::text FROM r214_invoices));
    DELETE FROM public.voyages WHERE id IN (${voyageIds});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    SET session_replication_role = origin;
    SET vela.retention = 'on';
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId}
      OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

const blRow = (id: string, voyageId: number) =>
  `('${id}', ${voyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', true, 5.5)`

function insertBls(rows: Array<[string, number]>) {
  psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
                                demurrage_roe_manual, demurrage_roe)
        VALUES ${rows.map(([id, voyageId]) => blRow(id, voyageId)).join(', ')}`)
}

function insertBoxes(rows: Array<[string, string]>) {
  psql(`INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date)
        VALUES ${rows.map(([blId, number]) => `('${blId}', '${number}', '40HC', '${discharge}', '${returned}')`).join(', ')}`)
}

describeLocal('Demurrage cobrada uma vez por caixa (migration 214)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r214-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R214 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(214001)}', 'R214 CLIENTE');
      INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, p1_usd, p2_usd, valid_from, active)
      VALUES (${customerId}, 5, 100, 200, '2026-01-01', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R214 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R214 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyage.split}, ${vesselId}, 'R214A', 'active'),
        (${voyage.paid}, ${vesselId}, 'R214B', 'active'),
        (${voyage.late}, ${vesselId}, 'R214C', 'active'),
        (${voyage.bridge}, ${vesselId}, 'R214D', 'active'),
        (${voyage.regroup}, ${vesselId}, 'R214E', 'active'),
        (${voyage.lost}, ${vesselId}, 'R214F', 'active');
    `)
    insertBls([
      [bl.splitA, voyage.split], [bl.splitB, voyage.split],
      [bl.paidA, voyage.paid], [bl.paidB, voyage.paid],
      [bl.lateA, voyage.late],
      [bl.bridgeA, voyage.bridge], [bl.bridgeC, voyage.bridge],
      [bl.regroupA, voyage.regroup], [bl.regroupB, voyage.regroup],
      [bl.lostA, voyage.lost], [bl.lostB, voyage.lost],
    ])
    insertBoxes([
      [bl.splitA, box.splitShared], [bl.splitB, box.splitShared], [bl.splitB, box.splitOwn],
      [bl.paidA, box.paidShared], [bl.paidB, box.paidShared],
      [bl.lateA, box.lateShared],
      [bl.bridgeA, box.bridgeX], [bl.bridgeC, box.bridgeZ],
      [bl.regroupA, box.regroupShared], [bl.regroupB, box.regroupShared], [bl.regroupB, box.regroupOwn],
      [bl.lostA, box.lostShared], [bl.lostB, box.lostShared], [bl.lostB, box.lostGone],
    ])
  })

  afterAll(cleanup, 60000)

  it('as funções internas da regra não são executáveis por anon nem authenticated', () => {
    for (const fn of ['public._demurrage_billed_container_keys(bigint,bigint,bigint)', 'public._lock_demurrage_box_billing(bigint,bigint)']) {
      for (const role of ['anon', 'authenticated']) {
        expect(psql(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE')`), `${role} ${fn}`).toBe('f')
      }
    }
  })

  it('grupo que se divide depois da emissão não cobra a mesma caixa de novo', () => {
    const first = issue(bl.splitB)
    expect(first).toMatchObject({ status: 'issued', anchor_bl_id: bl.splitA })
    const invoiceId = Number(first.invoice_id)
    expect(boxesOf(invoiceId)).toBe(`${box.splitShared},${box.splitOwn}`)

    // O B/L B deixa de dividir o container: cada B/L vira o próprio grupo.
    psql(`DELETE FROM public.bl_containers WHERE bl_id = '${bl.splitB}' AND container_number = '${box.splitShared}'`)
    expect(psql(`SELECT array_to_string(public.demurrage_group_bl_ids('${bl.splitB}'), ',')`)).toBe(bl.splitB)

    expect(issue(bl.splitB)).toMatchObject({ status: 'existing', invoice_ids: [invoiceId], anchor_bl_id: bl.splitB })
    expect(issue(bl.splitA)).toMatchObject({ status: 'existing', invoice_ids: [invoiceId] })
    expect(liveInvoices(voyage.split)).toEqual([`${invoiceId}:${bl.splitA}:${box.splitShared},${box.splitOwn}`])
  })

  it('âncora cancelado com a Invoice do grupo paga: o B/L que restou não é cobrado de novo', () => {
    const first = issue(bl.paidB)
    expect(first).toMatchObject({ status: 'issued', anchor_bl_id: bl.paidA })
    const invoiceId = Number(first.invoice_id)
    const paid = run(`SET request.jwt.claim.role = 'service_role';
      SELECT public.register_demurrage_payment(gen_random_uuid(), ${invoiceId}, (now() AT TIME ZONE 'America/Sao_Paulo')::date)`)
    expect(paid.status, paid.stderr).toBe(0)
    const cancelled = asAdmin(`SELECT public.cancel_bl('${bl.paidA}', 'Armador reemitiu o B/L (R214)')`)
    expect(cancelled.status, cancelled.stderr).toBe(0)

    expect(issue(bl.paidB)).toMatchObject({ status: 'existing', invoice_ids: [invoiceId], anchor_bl_id: bl.paidB })
    expect(liveInvoices(voyage.paid)).toEqual([`${invoiceId}:${bl.paidA}:${box.paidShared}`])
  })

  it('irmão que chega depois com caixa nova recebe Invoice complementar só com ela; tudo coberto devolve existing', () => {
    const first = issue(bl.lateA)
    expect(first).toMatchObject({ status: 'issued', anchor_bl_id: bl.lateA })
    const original = Number(first.invoice_id)

    // O irmão chega pela planilha de datas, dividindo a caixa já cobrada e com uma nova.
    insertBls([[bl.lateB, voyage.late]])
    psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
      ('${bl.lateB}', '${box.lateShared}', '40HC'), ('${bl.lateB}', '${box.lateNew}', '40HC')`)
    const dates = JSON.stringify([box.lateShared, box.lateNew].map((number) => ({
      container_number: number, discharge_date: discharge, return_date: returned,
    })))
    const applied = adminJson<{ demurrage: { demurrage_effects: string[] } }>(
      `SELECT public.apply_container_dates_atomic(gen_random_uuid(), '${bl.lateB}', '${dates}'::jsonb, '${adminId}'::uuid)`)
    // A caixa nova descoberta enfileira a emissão do âncora.
    expect(applied.demurrage.demurrage_effects).toEqual([bl.lateA])

    const complementary = issue(bl.lateB)
    expect(complementary).toMatchObject({ status: 'issued', anchor_bl_id: bl.lateA, complementary: true })
    const complementaryId = Number(complementary.invoice_id)
    expect(boxesOf(complementaryId)).toBe(box.lateNew)
    expect(boxesOf(original)).toBe(box.lateShared)
    expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${original}`)).toBe('issued')

    expect(issue(bl.lateA)).toMatchObject({ status: 'existing', invoice_ids: [original, complementaryId] })
    expect(liveInvoices(voyage.late)).toHaveLength(2)
  })

  it('irmão que liga dois grupos: a correção de datas reemite a caixa corrigida, sem devolver a Invoice do outro grupo', () => {
    const fromA = issue(bl.bridgeA)
    const fromC = issue(bl.bridgeC)
    expect([fromA.status, fromC.status]).toEqual(['issued', 'issued'])
    const otherGroup = Number(fromC.invoice_id)

    insertBls([[bl.bridgeB, voyage.bridge]])
    insertBoxes([[bl.bridgeB, box.bridgeX], [bl.bridgeB, box.bridgeZ]])
    expect(psql(`SELECT array_to_string(public.demurrage_group_bl_ids('${bl.bridgeA}'), ',')`))
      .toBe(`${bl.bridgeA},${bl.bridgeB},${bl.bridgeC}`)

    const corrected = adminJson<{ demurrage: { demurrage_invoices: Array<Record<string, unknown>> } }>(
      `SELECT public.set_container_dates(${containerId(bl.bridgeA, box.bridgeX)}, '${discharge}', '2026-09-22', 'Terminal corrigiu a devolução (R214)')`)
    expect(corrected.demurrage.demurrage_invoices).toEqual([expect.objectContaining({
      invoice_id: Number(fromA.invoice_id),
      status: 'cancelled',
      reissue: expect.objectContaining({ status: 'issued', anchor_bl_id: bl.bridgeA, complementary: true }),
      reissue_complete: true,
      unbilled_containers: [],
    })])

    const live = liveInvoices(voyage.bridge)
    expect(live).toHaveLength(2)
    expect(live[0]).toBe(`${otherGroup}:${bl.bridgeC}:${box.bridgeZ}`)
    expect(live[1]).toMatch(new RegExp(`^\\d+:${bl.bridgeA}:${box.bridgeX}$`))
    const reissued = Number(live[1].split(':')[0])
    expect(psql(`SELECT return_date FROM public.demurrage_invoice_items WHERE invoice_id = ${reissued}`)).toBe('2026-09-22')
  })

  it('a caixa que saiu do grupo é reemitida pelo âncora do B/L que ainda a tem', () => {
    const first = issue(bl.regroupB)
    expect(first).toMatchObject({ status: 'issued', anchor_bl_id: bl.regroupA })
    const invoiceId = Number(first.invoice_id)
    expect(boxesOf(invoiceId)).toBe(`${box.regroupShared},${box.regroupOwn}`)

    // O grupo se divide e a devolução da caixa do B/L B é corrigida depois.
    psql(`DELETE FROM public.bl_containers WHERE bl_id = '${bl.regroupB}' AND container_number = '${box.regroupShared}'`)
    const corrected = adminJson<{ demurrage: { demurrage_invoices: Array<Record<string, unknown>> } }>(
      `SELECT public.set_container_dates(${containerId(bl.regroupB, box.regroupOwn)}, '${discharge}', '2026-09-25', 'Terminal corrigiu a devolução (R214)')`)
    expect(corrected.demurrage.demurrage_invoices).toEqual([expect.objectContaining({
      invoice_id: invoiceId, status: 'cancelled', reissue_complete: true,
      reissue_extra: [expect.objectContaining({ status: 'issued', anchor_bl_id: bl.regroupB })],
    })])
    const live = liveInvoices(voyage.regroup)
    expect(live.map((row) => row.replace(/^\d+:/, ''))).toEqual([
      `${bl.regroupA}:${box.regroupShared}`,
      `${bl.regroupB}:${box.regroupOwn}`,
    ])
  })

  it('caixa da Invoice cancelada que a reemissão não cobre fica no Alerta, não passa por sucesso', () => {
    const first = issue(bl.lostB)
    expect(first).toMatchObject({ status: 'issued', anchor_bl_id: bl.lostA })
    const invoiceId = Number(first.invoice_id)
    expect(boxesOf(invoiceId)).toBe(`${box.lostShared},${box.lostGone}`)

    // A caixa própria do B/L B passa a SOC (não gera Demurrage); a outra tem a
    // devolução corrigida. A reemissão não pode cobrar a SOC: alguém confere.
    psql(`UPDATE public.bl_containers SET ownership = 'SOC' WHERE bl_id = '${bl.lostB}' AND container_number = '${box.lostGone}'`)
    const corrected = adminJson<{ demurrage: { demurrage_invoices: Array<Record<string, unknown>> } }>(
      `SELECT public.set_container_dates(${containerId(bl.lostA, box.lostShared)}, '${discharge}', '2026-09-22', 'Terminal corrigiu a devolução (R214)')`)
    expect(corrected.demurrage.demurrage_invoices).toEqual([expect.objectContaining({
      invoice_id: invoiceId, status: 'cancelled', reissue_complete: false, unbilled_containers: [box.lostGone],
    })])
    expect(liveInvoices(voyage.lost).map((row) => row.replace(/^\d+:/, ''))).toEqual([`${bl.lostA}:${box.lostShared}`])
    expect(psql(`SELECT i.status || '|' || i.message FROM public.alert_items AS i JOIN public.alerts AS a ON a.id = i.alert_id
      WHERE i.item_type = 'demurrage_invoice_dates_changed' AND a.entity_type = 'demurrage_invoice' AND a.entity_id = '${invoiceId}'
      ORDER BY i.id DESC LIMIT 1`)).toMatch(new RegExp(`^active\\|.*não cobrou o\\(s\\) container\\(s\\) ${box.lostGone}`))
  })
})
