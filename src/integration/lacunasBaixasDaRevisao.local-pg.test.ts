import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 564 (revisão da release 2026-11-01, decisões do dono):
// - "B/L criado" por comando (tabela de transição), não por linha: uma linha
//   por B/L inserido, com o contexto da importação; a reimportação (ON
//   CONFLICT DO UPDATE) não grava;
// - a reabertura do ADR sem terminal grava na chave do próprio ADR, a mesma do
//   fechamento (559);
// - contato novo sem nome pela configuração de contatos fica em branco (557).
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER_ID = '56456400-0000-4000-8000-000000000001'
const CARRIER_ID = 99564001
const VESSEL_ID = 99564002
const VOYAGE_ID = 99564003
const CUSTOMER_ID = 99564004
const REPORT_ID = '56456400-0000-4000-8000-0000000000a1'
const PORT = 'BRZ64'
const BL_A = 'A564-BL1'
const BL_B = 'A564-BL2'
const CONTEXT = 'Importação de B/L · Viagem Navio 564 V564'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-F', '|', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asUser(sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function created(blId: string): string[] {
  const out = psql(`SELECT coalesce(changed_by::text, '-'), coalesce(justification, '-'), new_value::jsonb ->> 'pod'
    FROM public.audit_logs WHERE entity_type = 'bls' AND entity_id = '${blId}' AND field_name = 'criado' ORDER BY id`)
  return out ? out.split('\n') : []
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${USER_ID}' OR entity_id IN ('${BL_A}', '${BL_B}', '${REPORT_ID}');
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id = ${CUSTOMER_ID});
    DELETE FROM public.customer_contacts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.agency_departure_reports WHERE id = '${REPORT_ID}';
    DELETE FROM public.bls WHERE id IN ('${BL_A}', '${BL_B}');
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${USER_ID}';
    DELETE FROM auth.users WHERE id = '${USER_ID}';
    SET session_replication_role = origin;
  `)
}

function migration564Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'audit_bl_created_batch';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration564Applied, 'migration564Applied (lacunas baixas da revisão)')

describeLocal('564 — lacunas baixas da revisão da release', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'documentacao-564@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER_ID}', 'Diana 564', 'documentacao', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador 564');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio 564', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V564', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE 564', '${syntheticCnpj(564004)}');
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, status, closed_at, closed_by)
        VALUES ('${REPORT_ID}', ${VOYAGE_ID}, '${PORT}', 'closed', now(), '${USER_ID}');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('dois B/Ls num INSERT só: uma linha "criado" por B/L, com autor e contexto da importação; a reimportação não grava', () => {
    const insert = (pod: string) => psql(`BEGIN; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
      SELECT set_config('vela.import_context', '${CONTEXT}', true);
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status, review_status)
      VALUES ('${BL_A}', ${VOYAGE_ID}, 'CNSHA', '${pod}', 'container', 'pending', 'not_calculated', 'ok'),
             ('${BL_B}', ${VOYAGE_ID}, 'CNSHA', '${pod}', 'container', 'pending', 'not_calculated', 'ok')
      ON CONFLICT (id) DO UPDATE SET pod = EXCLUDED.pod; COMMIT;`)
    insert('BRSSZ')
    expect(created(BL_A)).toEqual([`${USER_ID}|${CONTEXT}|BRSSZ`])
    expect(created(BL_B)).toEqual([`${USER_ID}|${CONTEXT}|BRSSZ`])
    insert('BRVIX')
    expect(created(BL_A)).toHaveLength(1)
    expect(created(BL_B)).toHaveLength(1)
  })

  it('reabrir o ADR sem terminal grava na chave do próprio ADR, como o fechamento', () => {
    const reopened = asUser(`SELECT public.reopen_agency_departure_report(${VOYAGE_ID}, '${PORT}', 'Saída corrigida')`)
    expect(reopened.error).toBe('')
    expect(psql(`SELECT entity_id || '|' || old_value || '|' || new_value || '|' || justification FROM public.audit_logs
      WHERE entity_type = 'agency_departure_report' AND changed_by = '${USER_ID}' ORDER BY id`)).toBe(`${REPORT_ID}|closed|open|Saída corrigida`)
  })

  it('contato novo sem nome pela configuração de contatos fica em branco, não "Contato"', () => {
    psql(`SET request.jwt.claim.role = 'service_role';
      SELECT public._apply_customer_contact_configuration(${CUSTOMER_ID},
        '[{"email": "sem-nome-564@example.test", "is_primary": true}]'::jsonb, 'sistema')`)
    expect(psql(`SELECT coalesce(name, 'NULO') FROM public.customer_contacts WHERE customer_id = ${CUSTOMER_ID}`)).toBe('NULO')
  })
})
