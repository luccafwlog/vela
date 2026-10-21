import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 345 (sessão de testes de 2026-10-20, melhoria 10): a leitura do
// que a próxima rodada automática vai enviar reusa os alvos da rodada
// (`customer_communication_automation_targets`) e não grava claim, não cria
// Comunicado nem envia.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER_ID = '34500000-0000-4000-8000-0000000000a1'
const CARRIER_ID = 99345001
const VESSEL_ID = 99345002
const VOYAGE_ID = 99345003
const OTHER_VOYAGE_ID = 99345005
const PORT_ID = 99345004
const PORT = 'BRQ45'
const CUSTOMER = 99345011
const CONTACT = 99345021
const BL = 'B345-FILA'
const NOA_CLAIM = `aviso_chegada_noa:${CUSTOMER}:${VOYAGE_ID}:${PORT}`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${USER_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
}

type PreviewRow = { kind: string; customer_id: number; voyage_id: number; port: string; recipient_count: number; claim_state: string }

function preview(voyageIds = [VOYAGE_ID]): PreviewRow[] {
  const run = asUser(`SELECT coalesce(json_agg(p ORDER BY p.kind), '[]') FROM public.customer_communication_queue_preview(ARRAY[${voyageIds.join(',')}]::bigint[]) p;`)
  expect(run.stderr).toBe('')
  return JSON.parse(run.stdout.trim().split('\n').pop() ?? '[]') as PreviewRow[]
}

function sideEffects() {
  return psql(`SELECT
    (SELECT count(*) FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${CUSTOMER}:%') || '|' ||
    (SELECT count(*) FROM public.customer_communications WHERE customer_id = ${CUSTOMER});`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    SET request.jwt.claim.role = 'service_role';
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${CUSTOMER}:%';
    DELETE FROM public.customer_contact_box_links WHERE contact_id = ${CONTACT};
    DELETE FROM public.customer_contacts WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.audit_logs WHERE entity_id = '${BL}' OR (entity_type = 'voyage_pod_schedule' AND entity_id = '${VOYAGE_ID}::${PORT}');
    DELETE FROM public.bls WHERE id = '${BL}';
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.voyages WHERE id IN (${VOYAGE_ID}, ${OTHER_VOYAGE_ID});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.ports WHERE id = ${PORT_ID};
    DELETE FROM public.user_profiles WHERE id = '${USER_ID}';
    DELETE FROM auth.users WHERE id = '${USER_ID}';
    SET session_replication_role = origin;
  `)
}

function previewPresent(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.customer_communication_queue_preview(bigint[])') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(previewPresent, 'previewPresent (Comunicado na fila)')

describeLocal('345 — Comunicado na fila, lido sem efeito colateral', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${USER_ID}', 'ops345@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER_ID}', 'Operações 345', 'operacoes', true);
      INSERT INTO public.ports (id, name, locode) VALUES (${PORT_ID}, 'Porto Q345', '${PORT}');
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador Q345');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio Q345', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${VOYAGE_ID}, ${VESSEL_ID}, 'Q345V', 'active'),
        (${OTHER_VOYAGE_ID}, ${VESSEL_ID}, 'Q345W', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER}, 'CLIENTE Q345', '${syntheticCnpj(345011)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${CONTACT}, ${CUSTOMER}, 'Contato Q345', 'docs-q345@example.test', true);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES (${CONTACT}, 'documentacao_operacao');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, review_status) VALUES
        ('${BL}', ${VOYAGE_ID}, ${CUSTOMER}, 'CNSHA', '${PORT}', 'container', 'pending', 'ok');
      -- ETA daqui a 2 dias: o NOA do Cliente é alvo devido (janela D-5).
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
        ('voyage_pod_schedule', '${VOYAGE_ID}::${PORT}', 'eta', NULL, to_char(now() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now() - interval '1 hour');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('mostra o NOA devido como na fila e não grava claim nem Comunicado', () => {
    const before = sideEffects()
    const rows = preview()
    expect(rows).toEqual([expect.objectContaining({
      kind: 'aviso_chegada_noa', customer_id: CUSTOMER, voyage_id: VOYAGE_ID, port: PORT, recipient_count: 1, claim_state: 'na_fila',
    })])
    expect(sideEffects()).toBe(before)
    expect(before).toBe('0|0')
    // Só as viagens pedidas.
    expect(preview([OTHER_VOYAGE_ID])).toEqual([])
  })

  it('segue a situação da claim da rodada: em envio, recusado e de volta na fila', () => {
    // A claim é de executor server-only (como a rodada a grava).
    psql(`SET request.jwt.claim.role = 'service_role'; INSERT INTO public.customer_communication_automation_claims (claim_key) VALUES ('${NOA_CLAIM}');`)
    expect(preview()[0]?.claim_state).toBe('em_envio')
    psql(`SET request.jwt.claim.role = 'service_role'; UPDATE public.customer_communication_automation_claims SET released_at = now(), rejected_at = now(), rejection_reason = 'teste' WHERE claim_key = '${NOA_CLAIM}';`)
    expect(preview()[0]?.claim_state).toBe('recusado')
    psql(`SET request.jwt.claim.role = 'service_role'; UPDATE public.customer_communication_automation_claims SET rejected_at = now() - interval '25 hours' WHERE claim_key = '${NOA_CLAIM}';`)
    expect(preview()[0]?.claim_state).toBe('na_fila')
    expect(psql(`SELECT claimed_at < now() FROM public.customer_communication_automation_claims WHERE claim_key = '${NOA_CLAIM}';`)).toBe('t')
  })

  it('Cliente sem contato na caixa aparece como sem destinatário', () => {
    psql(`SET request.jwt.claim.role = 'service_role'; DELETE FROM public.customer_communication_automation_claims WHERE claim_key = '${NOA_CLAIM}';
      UPDATE public.customer_contacts SET deactivated_at = now() WHERE id = ${CONTACT};`)
    expect(preview()[0]).toMatchObject({ claim_state: 'sem_destinatario', recipient_count: 0 })
    psql(`UPDATE public.customer_contacts SET deactivated_at = NULL WHERE id = ${CONTACT};`)
  })

  it('a leitura é de usuário interno ativo', () => {
    const anon = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.customer_communication_queue_preview(ARRAY[${VOYAGE_ID}]::bigint[]); COMMIT;`], { encoding: 'utf8' })
    expect(anon.status).not.toBe(0)
    psql(`UPDATE public.user_profiles SET active = false WHERE id = '${USER_ID}';`)
    const inactive = asUser(`SELECT * FROM public.customer_communication_queue_preview(ARRAY[${VOYAGE_ID}]::bigint[]);`)
    expect(inactive.stderr).toMatch(/Usuário interno ativo/)
    psql(`UPDATE public.user_profiles SET active = true WHERE id = '${USER_ID}';`)
  })
})
