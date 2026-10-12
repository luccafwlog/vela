// Etapa 4 do plano de correção das importações (migration 178; ADR 0078, item 18).
// Viagem Cancelada sela datas de container, CE de Granito e Comunicados, e
// `cancel_voyage` encerra os efeitos pendentes da Viagem. A simulação do
// acumulado (`simulate_import_effects`) relata o que cada efeito faria e não
// grava nada.
//
// Namespace exclusivo: ids 99227xxx, B/Ls 'A227-*', usuário ...0000002270NN,
// Granito com UUID ...0000002270NN. A limpeza roda com
// `session_replication_role = replica`, porque a Viagem Cancelada recusa
// qualquer mudança nas linhas dela.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000227001'
const carrierId = 99227001
const vesselId = 99227002
const voyageId = 99227003
const customerId = 99227004
const graniteManifestId = '00000000-0000-0000-0000-000000227051'
const graniteBlId = '00000000-0000-0000-0000-000000227052'
const blId = 'A227-BL1'
const container = 'ADCU2270001'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asService(sql: string): string {
  return psql(`SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; ${sql}`)
}

function asAdmin(sql: string): { stdout: string; stderr: string } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN ('${blId}', '${graniteBlId}', '${voyageId}'));
    DELETE FROM public.import_pending_effects WHERE entity_id IN ('${blId}', '${graniteBlId}', '${voyageId}');
    DELETE FROM public.customer_communications WHERE customer_id = ${customerId};
    DELETE FROM public.billing_run_logs WHERE bl_id = '${blId}';
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id = '${blId}';
    DELETE FROM public.charge_calculations WHERE bl_id = '${blId}';
    DELETE FROM public.bl_containers WHERE bl_id = '${blId}';
    DELETE FROM public.bls WHERE id = '${blId}';
    DELETE FROM public.granite_bls WHERE id = '${graniteBlId}';
    DELETE FROM public.granite_manifests WHERE id = '${graniteManifestId}';
    DELETE FROM public.audit_logs WHERE entity_id IN ('${blId}', '${voyageId}', '${graniteBlId}') OR changed_by = '${adminId}';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    SET session_replication_role = origin;
    SET vela.retention = 'on';
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId}
      OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customer_contacts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

function effectStatuses(): string[] {
  const raw = psql(`
    SELECT COALESCE(string_agg(effect_kind || ':' || status, ',' ORDER BY id), '') FROM public.import_pending_effects
    WHERE entity_id IN ('${blId}', '${graniteBlId}');
  `)
  return raw ? raw.split(',') : []
}

function fingerprint(): string {
  return psql(`
    SELECT concat_ws('|',
      (SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${blId}'),
      (SELECT charge_status FROM public.bls WHERE id = '${blId}'),
      (SELECT count(*) FROM public.invoices WHERE bl_id = '${blId}'),
      (SELECT string_agg(status || ':' || attempts, ',' ORDER BY id) FROM public.import_pending_effects WHERE entity_id IN ('${blId}', '${graniteBlId}')));
  `)
}

describeLocal('Viagem Cancelada sela a operação e a simulação não grava (migration 178)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'a227-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'A227 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '99227004000174', 'A227 CLIENTE');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A227 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A227 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A227', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status)
      VALUES ('${blId}', ${voyageId}, ${customerId}, 'A227O', 'A227P', 'container', 'pending', 'not_calculated');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${blId}', '${container}', '40HC');
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage) VALUES ('${graniteManifestId}', ${voyageId}, 'A227 NAVIO A227');
      INSERT INTO public.granite_bls (id, manifest_id, bl_number) VALUES ('${graniteBlId}', '${graniteManifestId}', 'A227-GRA-1');
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by) VALUES
        (gen_random_uuid(), 'provisional_charges', '${blId}', '${adminId}'),
        (gen_random_uuid(), 'granite_billing', '${graniteBlId}', '${adminId}');
    `)
  })

  afterAll(cleanup)

  it('a simulação relata cada efeito pendente e não grava nada', () => {
    const before = fingerprint()
    const simulation = JSON.parse(asService(`SELECT public.simulate_import_effects('${blId}', 50);`)) as {
      simulated: number; items: Array<{ effect_kind: string; outcome: string }>
    }
    expect(simulation.simulated).toBe(1)
    expect(simulation.items[0]).toMatchObject({ effect_kind: 'provisional_charges' })
    expect(['would_succeed', 'would_fail']).toContain(simulation.items[0].outcome)
    expect(fingerprint()).toBe(before)
    expect(effectStatuses()).toEqual(['provisional_charges:pending', 'granite_billing:pending'])
  })

  it('cancelar a Viagem encerra os efeitos pendentes dela', () => {
    const cancelled = asAdmin(`SELECT public.cancel_voyage(${voyageId}, 'Armador cancelou a escala (A227)', '${adminId}');`)
    expect(cancelled.stderr).toBe('')
    expect(JSON.parse(cancelled.stdout)).toMatchObject({ status: 'cancelled', changed: true, closed_effects: 2 })
    expect(effectStatuses()).toEqual(['provisional_charges:superseded', 'granite_billing:superseded'])
  })

  it('datas de container são recusadas em Viagem Cancelada', () => {
    const attempt = asAdmin(`
      SELECT public.apply_container_dates_atomic(gen_random_uuid(), '${blId}',
        '[{"container_number":"${container}","discharge_date":"2026-10-01","return_date":null}]'::jsonb, '${adminId}'::uuid);
    `)
    expect(attempt.stderr).toMatch(/cancelada/)
    expect(psql(`SELECT COALESCE(discharge_date::text, '') FROM public.bl_containers WHERE bl_id = '${blId}';`)).toBe('')
  })

  it('CE de Granito é recusado em Viagem Cancelada', () => {
    const attempt = asAdmin(`
      SELECT public.apply_ce_mercante_rows_atomic('[{"row":2,"bl_id":"${graniteBlId}","ce":"992270000000001"}]'::jsonb, '${adminId}'::uuid, 'granite');
    `)
    const refused = attempt.stderr !== '' || JSON.parse(attempt.stdout).ok === false
    expect(refused).toBe(true)
    expect(psql(`SELECT COALESCE(ce_mercante, '') FROM public.granite_bls WHERE id = '${graniteBlId}';`)).toBe('')
  })

  it('Comunicado ancorado em Viagem Cancelada é recusado', () => {
    const attempt = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      SET request.jwt.claim.role = 'service_role';
      INSERT INTO public.customer_communications (customer_id, kind, nature, anchor_voyage_id)
      VALUES (${customerId}, 'ce_taxas', 'carga', ${voyageId});
    `], { encoding: 'utf8' })
    expect(attempt.stderr).toMatch(/cancelada/)
  })
})
