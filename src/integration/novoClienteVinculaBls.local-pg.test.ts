// Migration 610 (pedido do dono de 2026-11-06): o Novo cliente vincula, por
// documento, os B/Ls que já esperavam por ele com o mesmo CNPJ — a regra da
// Base de Clientes (`_link_pending_bls_to_customer`). O cadastro pela ficha do
// B/L deixa esse B/L para a própria ficha vincular.
//
// Namespace exclusivo: ids 99610xxx, B/Ls 'A610-*', usuário ...0000006100NN.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000610001'
const carrierId = 99610001
const vesselId = 99610002
const voyageId = 99610003
const otherCustomerId = 99610004
const cnpj = '99610001000115'
const manifestCnpj = '99610002000160'
const otherCnpj = '99610003000104'
const pendingBl = 'A610-PEND'
const rejectedBl = 'A610-REJ'
const cancelledBl = 'A610-CANC'
const otherCustomerBl = 'A610-OUTRO'
const fichaBl = 'A610-FICHA'
const fichaSiblingBl = 'A610-IRMAO'
const bls = [pendingBl, rejectedBl, cancelledBl, otherCustomerBl, fichaBl, fichaSiblingBl]
const list = bls.map((id) => `'${id}'`).join(', ')
const cnpjs = `'${cnpj}', '${manifestCnpj}', '${otherCnpj}'`
const customersOf = `SELECT id FROM public.customers WHERE cnpj_cpf IN (${cnpjs})`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (${list});
    DELETE FROM public.billing_run_logs WHERE bl_id IN (${list});
    DELETE FROM public.charge_calculations WHERE bl_id IN (${list});
    DELETE FROM public.bls WHERE id IN (${list});
    DELETE FROM public.audit_logs WHERE entity_id IN (${list}) OR changed_by = '${userId}';
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'customer' AND (a.entity_id IN (SELECT id::text FROM public.customers WHERE cnpj_cpf IN (${cnpjs})) OR a.entity_id LIKE 'A610%'));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'customer'
      AND (entity_id IN (SELECT id::text FROM public.customers WHERE cnpj_cpf IN (${cnpjs})) OR entity_id LIKE 'A610%'));
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'customer'
      AND (entity_id IN (SELECT id::text FROM public.customers WHERE cnpj_cpf IN (${cnpjs})) OR entity_id LIKE 'A610%'));
    DELETE FROM public.alerts WHERE entity_type = 'customer'
      AND (entity_id IN (SELECT id::text FROM public.customers WHERE cnpj_cpf IN (${cnpjs})) OR entity_id LIKE 'A610%');
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_contact_change_events WHERE customer_id IN (${customersOf});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${customersOf}));
    DELETE FROM public.customer_contacts WHERE customer_id IN (${customersOf});
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (${customersOf}));
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${customersOf})
      OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (${customersOf}));
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customersOf});
    DELETE FROM public.customers WHERE cnpj_cpf IN (${cnpjs});
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

function createCustomer(document: string, name: string) {
  return asUser(`SELECT public.create_customer_with_contacts(
    jsonb_build_object('cnpj_cpf', '${document}', 'name', '${name}'),
    jsonb_build_array(jsonb_build_object('name', 'Financeiro', 'email', 'a610@example.test', 'is_primary', true)));`)
}

describeLocal('Novo cliente vincula os B/Ls pendentes com o mesmo CNPJ (migration 610)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a610-doc@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A610 Documentação', 'documentacao', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${otherCustomerId}, '${otherCnpj}', 'A610 OUTRO CLIENTE LTDA');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A610 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A610 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A610', 'active');
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, consignee, manifest_customer_cnpj_cpf, manifest_customer_name,
        manifest_customer_email, customer_id, customer_reconciliation_status, review_status, notes) VALUES
        ('${pendingBl}', ${voyageId}, 'A610O', 'A610P', 'container', 'A610 IMPORTADORA', '${cnpj}', NULL, NULL, NULL, 'missing_customer', 'pending_review',
          'Pendencias de importacao: Cliente nao vinculado'),
        ('${rejectedBl}', ${voyageId}, 'A610O', 'A610P', 'container', 'A610 IMPORTADORA', '${cnpj}', NULL, NULL, NULL, 'rejected', 'pending_review', NULL),
        ('${cancelledBl}', ${voyageId}, 'A610O', 'A610P', 'container', 'A610 IMPORTADORA', '${cnpj}', NULL, NULL, NULL, 'missing_customer', 'pending_review', NULL),
        ('${otherCustomerBl}', ${voyageId}, 'A610O', 'A610P', 'container', 'A610 IMPORTADORA', '${cnpj}', NULL, NULL, ${otherCustomerId}, 'reconciled', 'reviewed', NULL),
        ('${fichaBl}', ${voyageId}, 'A610O', 'A610P', 'container', 'A610 MANIFESTO', '${manifestCnpj}', 'A610 MANIFESTO SA', 'a610-manifesto@example.test',
          NULL, 'missing_customer', 'pending_review', NULL),
        ('${fichaSiblingBl}', ${voyageId}, 'A610O', 'A610P', 'container', 'A610 MANIFESTO', '${manifestCnpj}', 'A610 MANIFESTO SA', NULL,
          NULL, 'missing_customer', 'pending_review', NULL);
      SET session_replication_role = replica;
      UPDATE public.bls SET cancelled_at = now() WHERE id = '${cancelledBl}';
    `)
  })

  afterAll(cleanup)

  it('vincula só o B/L pendente, por documento, com Histórico, e devolve o que vinculou', () => {
    const result = createCustomer(cnpj, 'A610 IMPORTADORA LTDA')
    expect(result.stderr).toBe('')
    const customer = JSON.parse(result.stdout)
    expect(customer).toMatchObject({ cnpj_cpf: cnpj, bl_link: { linked_bl_ids: [pendingBl], bls_suggested: 0 } })

    expect(psql(`SELECT customer_id || ':' || customer_reconciliation_status FROM public.bls WHERE id = '${pendingBl}';`))
      .toBe(`${customer.id}:matched_document`)
    // Rejeitado e cancelado ficam sem Cliente; o já vinculado a outro não muda.
    expect(psql(`SELECT count(*) FROM public.bls WHERE id IN ('${rejectedBl}', '${cancelledBl}') AND customer_id IS NOT NULL;`)).toBe('0')
    expect(psql(`SELECT customer_id FROM public.bls WHERE id = '${otherCustomerBl}';`)).toBe(String(otherCustomerId))
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${pendingBl}' AND field_name = 'customer_id'
      AND old_value IS NULL AND new_value = '${customer.id}' AND changed_by = '${userId}'
      AND justification = 'Vínculo por documento no cadastro do Cliente';`)).toBe('1')
    // A Revisão foi reavaliada pela dona da regra: a pendência de Cliente saiu;
    // a do Portal (sem conta ativa na fixture) continua, como deve.
    const notes = psql(`SELECT COALESCE(notes, '') FROM public.bls WHERE id = '${pendingBl}';`)
    expect(notes).not.toMatch(/cliente nao vinculado/i)
    expect(notes).toMatch(/Acesso ao portal nao provisionado/)
  })

  it('cadastro pela ficha do B/L deixa esse B/L para a ficha e vincula o outro pendente', () => {
    const result = asUser(`SELECT public.create_customer_from_bl_manifest('${fichaBl}');`)
    expect(result.stderr).toBe('')
    const customer = JSON.parse(result.stdout)
    expect(customer).toMatchObject({ cnpj_cpf: manifestCnpj, bl_link: { linked_bl_ids: [fichaSiblingBl] } })
    expect(psql(`SELECT COALESCE(customer_id::text, '-') FROM public.bls WHERE id = '${fichaBl}';`)).toBe('-')
    expect(psql(`SELECT customer_id FROM public.bls WHERE id = '${fichaSiblingBl}';`)).toBe(String(customer.id))
    // A marca da ficha não vaza para o resto da transação.
    expect(asUser(`SELECT public.create_customer_from_bl_manifest('${fichaBl}'); SELECT COALESCE(NULLIF(current_setting('vela.customer_from_manifest_bl', true), ''), '-');`).stdout.split('\n').at(-1)).toBe('-')
  })

  it('a função do vínculo não é exposta à API', () => {
    const result = asUser(`SELECT public._link_pending_bls_to_customer(${otherCustomerId}, '${userId}', 'x', 'x', false, NULL);`)
    expect(result.stderr).toMatch(/permission denied/i)
  })
})
