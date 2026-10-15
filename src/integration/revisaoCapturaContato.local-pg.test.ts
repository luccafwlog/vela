import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 271 (decisão do dono de 2026-10-15; item B28; ADR 0064, item 6):
// o vínculo de Cliente pela Revisão (`save_bl_review`, usado também por
// "Vincular cliente ao grupo") só captura o e-mail do manifesto quando o CNPJ
// do documento é o do Cliente — a regra M14 da importação.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN = '27100000-0000-4000-8000-000000000001'
const CARRIER_ID = 99271001
const VESSEL_ID = 99271002
const VOYAGE_ID = 99271003
const CUSTOMER_XYZ = 99271011
const CUSTOMER_ABC = 99271012
const CNPJ_XYZ = syntheticCnpj(271011)
const CNPJ_ABC = syntheticCnpj(271012)

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function linkAsAdmin(blId: string, customerId: number): { ok: boolean; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${ADMIN}';
     SET LOCAL request.jwt.claim.role = 'authenticated';
     SELECT public.save_bl_review('${blId}', (SELECT updated_at FROM public.bls WHERE id = '${blId}'),
       '{"customer_id": "${customerId}"}'::jsonb, '[]'::jsonb, '${ADMIN}');
     COMMIT;`], { encoding: 'utf8' })
  return { ok: result.status === 0, error: (result.stderr ?? '').trim() }
}

function contactEmails(customerId: number): string {
  return psql(`SELECT COALESCE(string_agg(email, ',' ORDER BY email), '') FROM public.customer_contacts WHERE customer_id = ${customerId};`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM public.bls WHERE voyage_id = ${VOYAGE_ID});
    DELETE FROM public.audit_logs WHERE entity_id IN (SELECT id FROM public.bls WHERE voyage_id = ${VOYAGE_ID}) OR changed_by = '${ADMIN}';
    DELETE FROM public.bls WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.customer_contact_change_events WHERE customer_id IN (${CUSTOMER_XYZ}, ${CUSTOMER_ABC});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${CUSTOMER_XYZ}, ${CUSTOMER_ABC}));
    DELETE FROM public.customer_contacts WHERE customer_id IN (${CUSTOMER_XYZ}, ${CUSTOMER_ABC});
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${CUSTOMER_XYZ}, ${CUSTOMER_ABC});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMER_XYZ}, ${CUSTOMER_ABC});
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_XYZ}, ${CUSTOMER_ABC});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ADMIN}';
    DELETE FROM auth.users WHERE id = '${ADMIN}';
    SET session_replication_role = origin;
  `)
}

function migration271Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'save_bl_review_legacy_070'
      AND prosrc LIKE '%manifest_customer_cnpj_cpf%capture_manifest_financial_contact%';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration271Applied, 'migration271Applied (Revisão captura contato só com o CNPJ do Cliente)')

describeLocal('271 — a Revisão só captura o e-mail do manifesto com o CNPJ do Cliente (M14)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'adm-271@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN}', 'Administrativo 271', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 271');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 271', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V271');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_XYZ}, 'XYZ 271 LTDA', '${CNPJ_XYZ}'),
        (${CUSTOMER_ABC}, 'ABC TRADING 271 LTDA', '${CNPJ_ABC}');
      INSERT INTO public.bls (id, voyage_id, manifest_customer_cnpj_cpf, manifest_customer_email, manifest_customer_name, consignee)
      VALUES ('BL271DIV', ${VOYAGE_ID}, '${CNPJ_ABC}', 'financeiro@abc271.test', 'ABC TRADING 271 LTDA', 'ABC TRADING 271 LTDA'),
             ('BL271OK', ${VOYAGE_ID}, '${CNPJ_XYZ}', 'financeiro@xyz271.test', 'XYZ 271 LTDA', 'XYZ 271 LTDA');
      SELECT public.sync_customer_reconciliation_queue_for_bl('BL271DIV');
      SELECT public.sync_customer_reconciliation_queue_for_bl('BL271OK');
    `)
  })
  afterAll(cleanup)

  it('vincular a outro Cliente apesar do CNPJ divergente não leva o e-mail do manifesto', () => {
    // O B/L é da trading ABC; o operador vincula ao Cliente XYZ. Antes da 271,
    // financeiro@abc passava a ser contato de XYZ.
    expect(linkAsAdmin('BL271DIV', CUSTOMER_XYZ).error).toBe('')
    expect(psql(`SELECT customer_id FROM public.bls WHERE id = 'BL271DIV';`)).toBe(String(CUSTOMER_XYZ))
    expect(contactEmails(CUSTOMER_XYZ)).toBe('')
  })

  it('com o CNPJ do documento igual ao do Cliente, o e-mail do manifesto entra como contato', () => {
    expect(linkAsAdmin('BL271OK', CUSTOMER_XYZ).error).toBe('')
    expect(contactEmails(CUSTOMER_XYZ)).toBe('financeiro@xyz271.test')
  })
})
