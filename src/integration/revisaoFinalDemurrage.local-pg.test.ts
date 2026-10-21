// Migration 211 — revisão final da PR 929 (Demurrage, datas de container e
// Viagem Cancelada). Cada caso falha sem a migration:
// - a baixa que confirma antes da reconciliação de datas não é cancelada e
//   reemitida: a Invoice paga só tem a Régua suspensa;
// - o status de Demurrage usa a data de São Paulo, não a da sessão;
// - `authenticated` não grava descarga nem devolução direto em `bl_containers`
//   e não executa mais `update_container_demurrage_dates`;
// - duas planilhas de datas de B/Ls que dividem containers não travam uma à
//   outra (deadlock);
// - Viagem Cancelada não recebe Invoice de Demurrage, e o estorno da baixa nela
//   cancela sem reemitir;
// - container e B/L de Granito não saem da Viagem Cancelada por UPDATE;
// - reativar a Viagem reabre os efeitos que o cancelamento encerrou;
// - a emissão de Demurrage do B/L-âncora cancelado passa ao âncora que restou.
//
// Namespace exclusivo: ids 99211xxx, B/Ls 'R211-*', containers 'RTCU211xxxx',
// usuário ...000000211001. Os testes de concorrência abrem sessões psql em
// paralelo e coordenam pela fila de locks (`pg_stat_activity`), sem depender
// de tempo fixo. A limpeza roda com `session_replication_role = replica`,
// porque a Viagem Cancelada recusa mudança nas linhas dela.
import { spawn } from 'node:child_process'
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 366: estas RPCs antigas saíram da API (só `service_role`); o
// teste as chama como o servidor, com os claims do usuário (RESET ROLE), como
// fazem as RPCs de lote da tela.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000211001'
const customerId = 99211001
const carrierId = 99211002
const vesselId = 99211003
const voyage = {
  pay: 99211010,
  deadlock: 99211011,
  cancelled: 99211012,
  target: 99211013,
  reactivate: 99211014,
  requeue: 99211015,
  sealed: 99211016,
}
const voyageIds = Object.values(voyage).join(', ')
const cancelledManifestId = '00000000-0000-0000-0000-000000211051'
const targetManifestId = '00000000-0000-0000-0000-000000211052'
const graniteBlId = '00000000-0000-0000-0000-000000211061'
const bl = {
  pay: 'R211-PAY',
  tz: 'R211-TZ',
  deadlockA: 'R211-DLA',
  deadlockB: 'R211-DLB',
  cancelledVoyage: 'R211-CV',
  cancelledVoyagePaid: 'R211-CVP',
  target: 'R211-MV',
  reactivate: 'R211-RV',
  anchor: 'R211-BA',
  sibling: 'R211-BB',
  sealed: 'R211-SL',
}
const blList = Object.values(bl).map((id) => `'${id}'`).join(', ')
const containers = {
  pay: 'RTCU2110001',
  tz: 'RTCU2110002',
  sharedX: 'RTCU2110011',
  sharedY: 'RTCU2110012',
  cancelledVoyage: 'RTCU2110021',
  cancelledVoyagePaid: 'RTCU2110022',
  shared: 'RTCU2110041',
  siblingOwn: 'RTCU2110042',
  sealed: 'RTCU2110051',
}

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function run(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
}

type Session = { status: number | null; stdout: string; stderr: string }

// Sessão em paralelo: a promessa resolve quando o psql termina.
function runAsync(sql: string): Promise<Session> {
  return new Promise((resolve) => {
    const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function adminSql(sql: string): string {
  return `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${adminId}';
    ${sql};
    COMMIT;
  `
}

function asAdmin(sql: string) {
  return run(adminSql(sql))
}

function asService(sql: string) {
  return run(`SET request.jwt.claim.role = 'service_role'; ${sql}`)
}

// Segura a transação aberta até outra sessão (pela marca) esperar um lock.
function holdUntilWaiting(marker: string): string {
  return `
    DO $hold$
    DECLARE t0 timestamptz := clock_timestamp();
    BEGIN
      LOOP
        PERFORM pg_stat_clear_snapshot();
        EXIT WHEN EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND query LIKE '%${marker}%' AND wait_event_type = 'Lock');
        EXIT WHEN clock_timestamp() - t0 > interval '20 seconds';
        PERFORM pg_sleep(0.05);
      END LOOP;
    END $hold$;`
}

function sessionState(marker: string): string {
  return psql(`
    SELECT COALESCE(string_agg(COALESCE(wait_event_type, '-') || ':' || COALESCE(wait_event, '-'), ','), '')
    FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query LIKE '%${marker}%'`)
}

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 20000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Tempo esgotado esperando ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function containerId(blId: string, number: string): number {
  return Number(psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${blId}' AND container_number = '${number}'`))
}

function issueDemurrage(blId: string): number {
  psql(`SET vela.demurrage_internal = 'on'; SELECT public.issue_demurrage_invoice_for_bl('${blId}', 'R211-DEM-${blId}-' || floor(random() * 1e9)::bigint)`)
  return Number(psql(`SELECT id FROM public.demurrage_invoices WHERE bl_id = '${blId}' AND status = 'issued' ORDER BY id DESC LIMIT 1`))
}

function payDemurrage(invoiceId: number) {
  const paid = asService(`SELECT public.register_demurrage_payment(gen_random_uuid(), ${invoiceId}, (now() AT TIME ZONE 'America/Sao_Paulo')::date)`)
  expect(paid.status, paid.stderr).toBe(0)
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._lock_container_date_sets(bigint[])') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 211 (_lock_container_date_sets)')

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r211_invoices AS SELECT id FROM public.demurrage_invoices WHERE bl_id IN (${blList});
    CREATE TEMP TABLE r211_effects AS SELECT id FROM public.import_pending_effects WHERE entity_id IN (${blList});
    CREATE TEMP TABLE r211_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'demurrage_invoice' AND entity_id IN (SELECT id::text FROM r211_invoices))
         OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM r211_effects));
    CREATE TEMP TABLE r211_items AS SELECT id FROM public.alert_items
      WHERE alert_id IN (SELECT id FROM r211_alerts) OR metadata->>'bl_id' LIKE 'R211-%'
         OR metadata->>'effect_id' IN (SELECT id::text FROM r211_effects);
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r211_items) OR alert_id IN (SELECT id FROM r211_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r211_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r211_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r211_items) OR alert_id IN (SELECT id FROM r211_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r211_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r211_alerts);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM r211_effects);
    DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM r211_effects);
    DELETE FROM public.portal_notifications WHERE customer_id = ${customerId} OR bl_id IN (${blList});
    DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM r211_invoices);
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM r211_invoices);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM r211_invoices);
    DELETE FROM public.demurrage_refunds WHERE invoice_id IN (SELECT id FROM r211_invoices);
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM r211_invoices);
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM r211_invoices);
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM r211_invoices);
    DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM r211_invoices);
    DELETE FROM public.customer_demurrage_agreements WHERE customer_id = ${customerId};
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (${blList});
    DELETE FROM public.bl_containers WHERE bl_id IN (${blList});
    DELETE FROM public.bls WHERE id IN (${blList});
    DELETE FROM public.granite_bls WHERE id = '${graniteBlId}';
    DELETE FROM public.granite_manifests WHERE id IN ('${cancelledManifestId}', '${targetManifestId}');
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id IN (${blList})
      OR (entity_type IN ('voyages', 'voyage') AND entity_id IN (${Object.values(voyage).map((id) => `'${id}'`).join(', ')}))
      OR (entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (SELECT id::text FROM r211_invoices));
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

describeLocal('Revisão final de Demurrage, datas e Viagem Cancelada (migration 211)', () => {
  beforeAll(() => {
    cleanup()
    const blRow = (id: string, voyageId: number) =>
      `('${id}', ${voyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', true, 5.5)`
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r211-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R211 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(211001)}', 'R211 CLIENTE');
      INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, p1_usd, p2_usd, valid_from, active)
      VALUES (${customerId}, 5, 100, 200, '2026-01-01', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R211 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R211 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyage.pay}, ${vesselId}, 'R211A', 'active'),
        (${voyage.deadlock}, ${vesselId}, 'R211B', 'active'),
        (${voyage.cancelled}, ${vesselId}, 'R211C', 'active'),
        (${voyage.target}, ${vesselId}, 'R211D', 'active'),
        (${voyage.reactivate}, ${vesselId}, 'R211E', 'active'),
        (${voyage.requeue}, ${vesselId}, 'R211F', 'active'),
        (${voyage.sealed}, ${vesselId}, 'R211G', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
                              demurrage_roe_manual, demurrage_roe) VALUES
        ${blRow(bl.pay, voyage.pay)}, ${blRow(bl.tz, voyage.pay)},
        ${blRow(bl.deadlockA, voyage.deadlock)}, ${blRow(bl.deadlockB, voyage.deadlock)},
        ${blRow(bl.cancelledVoyage, voyage.cancelled)}, ${blRow(bl.cancelledVoyagePaid, voyage.cancelled)},
        ${blRow(bl.target, voyage.target)}, ${blRow(bl.reactivate, voyage.reactivate)},
        ${blRow(bl.anchor, voyage.requeue)}, ${blRow(bl.sibling, voyage.requeue)},
        ${blRow(bl.sealed, voyage.sealed)};
      UPDATE public.bls SET free_time_override = 5 WHERE id = '${bl.tz}';
      INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date) VALUES
        ('${bl.pay}', '${containers.pay}', '40HC', '2026-07-01', '2026-09-20'),
        ('${bl.tz}', '${containers.tz}', '40HC', NULL, NULL),
        ('${bl.cancelledVoyage}', '${containers.cancelledVoyage}', '40HC', '2026-07-01', '2026-09-30'),
        ('${bl.cancelledVoyagePaid}', '${containers.cancelledVoyagePaid}', '40HC', '2026-07-01', '2026-09-30'),
        ('${bl.anchor}', '${containers.shared}', '40HC', NULL, NULL),
        ('${bl.sibling}', '${containers.shared}', '40HC', NULL, NULL),
        ('${bl.sibling}', '${containers.siblingOwn}', '40HC', NULL, NULL),
        ('${bl.sealed}', '${containers.sealed}', '40HC', NULL, NULL);
      -- Ordem dos ids: A/X, B/X, A/Y, B/Y.
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.deadlockA}', '${containers.sharedX}', '40HC');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.deadlockB}', '${containers.sharedX}', '40HC');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.deadlockA}', '${containers.sharedY}', '40HC');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.deadlockB}', '${containers.sharedY}', '40HC');
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage) VALUES
        ('${cancelledManifestId}', ${voyage.sealed}, 'R211 NAVIO R211G'),
        ('${targetManifestId}', ${voyage.target}, 'R211 NAVIO R211D');
      INSERT INTO public.granite_bls (id, manifest_id, bl_number) VALUES ('${graniteBlId}', '${cancelledManifestId}', 'R211-GRA-1');
    `)
  })

  afterAll(cleanup, 60000)

  it('a baixa que confirma antes da reconciliação de datas mantém a Invoice paga, sem cancelar nem reemitir', async () => {
    const invoiceId = issueDemurrage(bl.pay)
    expect(invoiceId).toBeGreaterThan(0)
    // A baixa trava a Invoice e só confirma quando a correção da devolução,
    // pela ficha do B/L, já espera por ela.
    const payment = runAsync(`
      SET request.jwt.claim.role = 'service_role';
      BEGIN;
      SELECT 'r211-race-pay';
      SELECT public.register_demurrage_payment(gen_random_uuid(), ${invoiceId}, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
      ${holdUntilWaiting('r211-race-reconcile')}
      COMMIT;`)
    await waitFor('a baixa travar a Invoice', () => sessionState('r211-race-pay').includes('PgSleep'))
    const reconcile = runAsync(adminSql(`
      SELECT 'r211-race-reconcile';
      SELECT public.set_container_dates(${containerId(bl.pay, containers.pay)}, '2026-07-01', '2026-09-25', 'Terminal corrigiu a devolução (R211)')`))
    const [paid, reconciled] = await Promise.all([payment, reconcile])
    expect(paid.status, paid.stderr).toBe(0)
    expect(reconciled.status, reconciled.stderr).toBe(0)

    expect(psql(`SELECT status || '|' || COALESCE(dunning_suspended_reason, '-') FROM public.demurrage_invoices WHERE id = ${invoiceId}`))
      .toBe('paid|Datas de container alteradas depois do pagamento; conferir a diferença.')
    expect(psql(`SELECT count(*) FROM public.demurrage_invoices WHERE bl_id = '${bl.pay}' AND id <> ${invoiceId}`)).toBe('0')
  }, 60000)

  it('o status de Demurrage conta os dias pela data de São Paulo, qualquer que seja o fuso da sessão', () => {
    // Um fuso cuja data difere da de São Paulo agora: UTC+14 (adiantado) ou UTC-12 (atrasado).
    const zone = psql(`SELECT CASE WHEN (now() AT TIME ZONE 'Etc/GMT-14')::date <> (now() AT TIME ZONE 'America/Sao_Paulo')::date
                                   THEN 'Etc/GMT-14' ELSE 'Etc/GMT+12' END`)
    const ahead = zone === 'Etc/GMT-14'
    // Free time de 5 dias: na data de São Paulo, 5 dias está no prazo e 6, em atraso.
    const days = ahead ? 5 : 6
    const expected = ahead ? 'within_free_time' : 'overdue'
    const status = psql(`
      SET timezone = '${zone}';
      SELECT public._container_demurrage_status('${bl.tz}', '40HC',
        (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${days}, NULL, NULL)`)
    expect(status).toBe(expected)
    // O gatilho do container usa a mesma regra.
    const written = psql(`
      SET timezone = '${zone}';
      UPDATE public.bl_containers SET discharge_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${days}
      WHERE bl_id = '${bl.tz}';
      SELECT demurrage_status FROM public.bl_containers WHERE bl_id = '${bl.tz}'`)
    expect(written).toBe(expected)
  })

  it('authenticated não grava descarga nem devolução direto no container; a ficha do B/L continua gravando', () => {
    expect(psql(`SELECT has_function_privilege('authenticated',
      'public.update_container_demurrage_dates(bigint,date,date,text,text)', 'EXECUTE')`)).toBe('f')

    const id = containerId(bl.tz, containers.tz)
    const before = psql(`SELECT COALESCE(discharge_date::text, '-') || '|' || COALESCE(return_date::text, '-') FROM public.bl_containers WHERE id = ${id}`)
    const direct = asAdmin(`UPDATE public.bl_containers SET return_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = ${id}`)
    expect(direct.stderr).toMatch(/ficha do B\/L ou pela planilha de datas/)
    const discharge = asAdmin(`UPDATE public.bl_containers SET discharge_date = '2026-08-01' WHERE id = ${id}`)
    expect(discharge.stderr).toMatch(/ficha do B\/L ou pela planilha de datas/)
    expect(psql(`SELECT COALESCE(discharge_date::text, '-') || '|' || COALESCE(return_date::text, '-') FROM public.bl_containers WHERE id = ${id}`))
      .toBe(before)

    // Outra coluna do container segue editável pela tela.
    const other = asAdmin(`UPDATE public.bl_containers SET unpacking_location = 'R211 ARMAZEM' WHERE id = ${id}`)
    expect(other.stderr).toBe('')
    // A RPC da ficha (SECURITY DEFINER) grava as datas.
    const viaRpc = asAdmin(`SELECT public.set_container_dates(${id}, '2026-08-01', NULL, NULL)`)
    expect(viaRpc.status, viaRpc.stderr).toBe(0)
    expect(psql(`SELECT discharge_date FROM public.bl_containers WHERE id = ${id}`)).toBe('2026-08-01')
  })

  it('duas planilhas de datas de B/Ls que dividem containers não entram em deadlock', async () => {
    const lockedRow = containerId(bl.deadlockA, containers.sharedY)
    const rows = (numbers: string[]) => JSON.stringify(numbers.map((number) => ({
      container_number: number, discharge_date: '2026-09-01', return_date: '2026-09-03',
    })))
    const importSql = (marker: string, blId: string, numbers: string[]) => adminSql(`
      SELECT '${marker}';
      RESET ROLE; SELECT public.apply_container_dates_atomic(gen_random_uuid(), '${blId}', '${rows(numbers)}'::jsonb, '${adminId}'::uuid)`)

    // Outra sessão segura o container A/Y até as duas planilhas estarem na fila.
    const holder = runAsync(`
      BEGIN;
      SELECT 'r211-dl-holder';
      SELECT 1 FROM public.bl_containers WHERE id = ${lockedRow} FOR UPDATE;
      ${holdUntilWaiting('r211-dl-second')}
      COMMIT;`)
    await waitFor('a sessão segurar o container', () => sessionState('r211-dl-holder').includes('PgSleep'))
    const first = runAsync(importSql('r211-dl-first', bl.deadlockA, [containers.sharedX, containers.sharedY]))
    await waitFor('a planilha do B/L A esperar', () => sessionState('r211-dl-first').startsWith('Lock'))
    const second = runAsync(importSql('r211-dl-second', bl.deadlockB, [containers.sharedY, containers.sharedX]))

    const [held, a, b] = await Promise.all([holder, first, second])
    expect(held.status, held.stderr).toBe(0)
    expect(a.stderr).not.toMatch(/deadlock/)
    expect(b.stderr).not.toMatch(/deadlock/)
    expect(a.status, a.stderr).toBe(0)
    expect(b.status, b.stderr).toBe(0)
    expect(psql(`SELECT string_agg(DISTINCT discharge_date || '/' || return_date, ',') FROM public.bl_containers
                 WHERE bl_id IN ('${bl.deadlockA}', '${bl.deadlockB}')`)).toBe('2026-09-01/2026-09-03')
  }, 60000)

  it('a Viagem Cancelada não recebe Invoice de Demurrage, e o estorno da baixa nela cancela sem reemitir', () => {
    // Invoice paga antes do cancelamento, com a devolução corrigida depois da baixa.
    const paidInvoice = issueDemurrage(bl.cancelledVoyagePaid)
    payDemurrage(paidInvoice)
    const corrected = asAdmin(`SELECT public.set_container_dates(${containerId(bl.cancelledVoyagePaid, containers.cancelledVoyagePaid)},
      '2026-07-01', '2026-10-02', 'Terminal corrigiu a devolução (R211)')`)
    expect(corrected.status, corrected.stderr).toBe(0)
    expect(psql(`SELECT status || '|' || (dunning_suspended_reason IS NOT NULL) FROM public.demurrage_invoices WHERE id = ${paidInvoice}`))
      .toBe('paid|true')

    // Desde a 363 (ADR 0093, decisão 14) a Viagem com Invoice viva ou baixa
    // não se cancela; o estado legado (Viagem já Cancelada com a Invoice paga)
    // é montado direto para o resto do cenário.
    const refused = asAdmin(`SELECT public.cancel_voyage(${voyage.cancelled}, 'Armador cancelou a escala (R211)', '${adminId}')`)
    expect(refused.stderr).toMatch(/fatura viva ou baixa/)
    psql(`SET session_replication_role = replica; UPDATE public.voyages SET status = 'cancelled' WHERE id = ${voyage.cancelled}; SET session_replication_role = origin;`)

    const issued = run(`SET vela.demurrage_internal = 'on'; SELECT public.issue_demurrage_invoice_for_bl('${bl.cancelledVoyage}', 'R211-DEM-CV')`)
    expect(issued.stderr).toMatch(/cancelada/)
    const direct = run(`INSERT INTO public.demurrage_invoices (doc_number, bl_id, customer_id, total_usd, status)
                        VALUES ('R211-DEM-DIRETA', '${bl.cancelledVoyage}', ${customerId}, 10, 'draft')`)
    expect(direct.stderr).toMatch(/cancelada/)
    expect(psql(`SELECT count(*) FROM public.demurrage_invoices WHERE bl_id = '${bl.cancelledVoyage}'`)).toBe('0')

    // O estorno reconcilia: a Invoice é cancelada e não renasce na Viagem Cancelada.
    const reversed = asAdmin(`SELECT public.reverse_demurrage_payment(${paidInvoice}, 'Baixa lançada na fatura errada (R211)')`)
    expect(reversed.status, reversed.stderr).toBe(0)
    expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${paidInvoice}`)).toBe('cancelled')
    expect(psql(`SELECT count(*) FROM public.demurrage_invoices WHERE bl_id = '${bl.cancelledVoyagePaid}' AND id <> ${paidInvoice}`)).toBe('0')
  })

  it('container, B/L e B/L de Granito não saem da Viagem Cancelada por UPDATE', () => {
    const cancelled = asAdmin(`SELECT public.cancel_voyage(${voyage.sealed}, 'Armador cancelou a escala (R211)', '${adminId}')`)
    expect(cancelled.status, cancelled.stderr).toBe(0)
    const container = run(`UPDATE public.bl_containers SET bl_id = '${bl.target}' WHERE bl_id = '${bl.sealed}'`)
    expect(container.stderr).toMatch(/cancelada: operação selada/)
    expect(psql(`SELECT count(*) FROM public.bl_containers WHERE bl_id = '${bl.sealed}'`)).toBe('1')

    const granite = run(`UPDATE public.granite_bls SET manifest_id = '${targetManifestId}' WHERE id = '${graniteBlId}'`)
    expect(granite.stderr).toMatch(/cancelada: operação selada/)
    expect(psql(`SELECT manifest_id FROM public.granite_bls WHERE id = '${graniteBlId}'`)).toBe(cancelledManifestId)

    // O B/L também não sai trocando de Viagem (216: guarda pela linha antiga).
    const movedBl = run(`UPDATE public.bls SET voyage_id = ${voyage.target} WHERE id = '${bl.sealed}'`)
    expect(movedBl.stderr).toMatch(/cancelada: operação selada/)
    expect(psql(`SELECT voyage_id FROM public.bls WHERE id = '${bl.sealed}'`)).toBe(String(voyage.sealed))

    // O status de Demurrage, que o gatilho recalcula, continua permitido (200).
    expect(run(`UPDATE public.bl_containers SET demurrage_status = 'overdue' WHERE bl_id = '${bl.sealed}'`).stderr).toBe('')
  })

  it('reativar a Viagem reabre os efeitos que o cancelamento encerrou, salvo os já substituídos', () => {
    const insertEffect = (kind: string) => psql(`
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by)
      VALUES (gen_random_uuid(), '${kind}', '${bl.reactivate}', '${adminId}') RETURNING id`)
    const localBilling = insertEffect('local_billing')
    const provisional = insertEffect('provisional_charges')
    const cancelled = asAdmin(`SELECT public.cancel_voyage(${voyage.reactivate}, 'Armador cancelou a escala (R211)', '${adminId}')`)
    expect(cancelled.status, cancelled.stderr).toBe(0)
    expect(psql(`SELECT string_agg(status || ':' || (result->>'reason'), ',' ORDER BY id) FROM public.import_pending_effects
                 WHERE id IN (${localBilling}, ${provisional})`)).toBe('superseded:voyage_cancelled,superseded:voyage_cancelled')
    // Um efeito novo do mesmo tipo nasceu depois: o antigo fica encerrado.
    const newer = insertEffect('provisional_charges')

    const reactivated = asAdmin(`SELECT public.reactivate_voyage(${voyage.reactivate}, 'Escala confirmada de novo (R211)')`)
    expect(reactivated.status, reactivated.stderr).toBe(0)
    expect(psql(`SELECT status || '|' || (result ? 'reopened_on_reactivation') || '|' || (lease_until IS NULL) || '|' || (next_attempt_at <= now())
                 FROM public.import_pending_effects WHERE id = ${localBilling}`)).toBe('pending|true|true|true')
    expect(psql(`SELECT status FROM public.import_pending_effects WHERE id = ${provisional}`)).toBe('superseded')
    expect(psql(`SELECT status FROM public.import_pending_effects WHERE id = ${newer}`)).toBe('pending')
  })

  it('a emissão de Demurrage do âncora cancelado passa ao âncora que restou no grupo', () => {
    expect(psql(`SELECT array_to_string(public.demurrage_group_bl_ids('${bl.sibling}'), ',')`)).toBe(`${bl.anchor},${bl.sibling}`)
    const effectId = psql(`
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by, status, attempts, leased_by, lease_until)
      VALUES (gen_random_uuid(), 'demurrage_billing', '${bl.anchor}', '${adminId}', 'running', 1, 'r211-worker', now() + interval '5 minutes')
      RETURNING id`)
    psql(`SET session_replication_role = replica; UPDATE public.bls SET cancelled_at = now() WHERE id = '${bl.anchor}';`)

    const processed = asService(`SELECT public.process_import_effect(${effectId}, 'r211-worker')`)
    expect(processed.status, processed.stderr).toBe(0)
    expect(psql(`SELECT status || '|' || (result->>'reason') FROM public.import_pending_effects WHERE id = ${effectId}`))
      .toBe('superseded|bl_cancelled')
    expect(psql(`SELECT string_agg(status || ':' || created_by, ',') FROM public.import_pending_effects
                 WHERE effect_kind = 'demurrage_billing' AND entity_id = '${bl.sibling}'`)).toBe(`pending:${adminId}`)
    // Reprocessar o efeito encerrado não enfileira de novo.
    expect(asService(`SELECT public.process_import_effect(${effectId}, 'r211-worker')`).status).toBe(0)
    expect(psql(`SELECT count(*) FROM public.import_pending_effects WHERE effect_kind = 'demurrage_billing' AND entity_id = '${bl.sibling}'`)).toBe('1')
  })
})
