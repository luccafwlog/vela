// Etapa 11 do plano de correção das importações (migration 185; ADR 0078,
// item 24). A Base de Clientes vincula só os B/Ls pendentes de Cliente com o
// mesmo CNPJ, como vínculo por documento, e reavalia a Revisão; B/L rejeitado
// nunca é vinculado; razão social diferente da gravada pede confirmação.
//
// Namespace exclusivo: ids 99232xxx, B/Ls 'A232-*', usuário ...0000002320NN.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000232001'
const carrierId = 99232001
const vesselId = 99232002
const voyageId = 99232003
const customerId = 99232004
const cnpj = '99232001000129'
const pendingBl = 'A232-PEND'
const rejectedBl = 'A232-REJ'
const cancelledBl = 'A232-CANC'
const bls = [pendingBl, rejectedBl, cancelledBl]
const list = bls.map((id) => `'${id}'`).join(', ')

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
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
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${cnpj}');
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${cnpj}'));
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${cnpj}') OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${cnpj}'));
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${cnpj}');
    DELETE FROM public.customers WHERE cnpj_cpf = '${cnpj}';
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

function importBase(name: string, confirm: boolean) {
  return asUser(`SELECT public.apply_customer_base_row_atomic('${cnpj}', '${name}', NULL, NULL, NULL, NULL, NULL,
    '["a232@example.test"]'::jsonb, '${userId}', ${confirm});`)
}

describeLocal('Base de Clientes: vínculo só dos B/Ls pendentes (migration 185)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a232-doc@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A232 Documentação', 'documentacao', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${cnpj}', 'A232 IMPORTADORA LTDA');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A232 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A232 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A232', 'active');
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, manifest_customer_cnpj_cpf, customer_reconciliation_status, review_status) VALUES
        ('${pendingBl}', ${voyageId}, 'A232O', 'A232P', 'container', '${cnpj}', 'missing_customer', 'pending_review'),
        ('${rejectedBl}', ${voyageId}, 'A232O', 'A232P', 'container', '${cnpj}', 'rejected', 'pending_review'),
        ('${cancelledBl}', ${voyageId}, 'A232O', 'A232P', 'container', '${cnpj}', 'missing_customer', 'pending_review');
      SET session_replication_role = replica;
      UPDATE public.bls SET cancelled_at = now() WHERE id = '${cancelledBl}';
    `)
  })

  afterAll(cleanup)

  it('razão social diferente sem confirmação recusa e não vincula nada', () => {
    const refused = importBase('A232 OUTRA RAZAO SA', false)
    expect(refused.stderr).toMatch(/Razão social diferente da cadastrada/)
    expect(psql(`SELECT count(*) FROM public.bls WHERE id IN (${list}) AND customer_id IS NOT NULL;`)).toBe('0')
    // Mesma razão social com outra caixa e pontuação não é troca.
    expect(importBase('a232 importadora ltda.', false).stderr).toBe('')
  })

  it('vincula só o pendente, por documento, com Histórico; rejeitado e cancelado ficam de fora', () => {
    psql(`SET session_replication_role = replica; UPDATE public.bls SET customer_id = NULL WHERE id IN (${list});
      DELETE FROM public.audit_logs WHERE entity_id IN (${list});`)
    expect(psql(`SELECT array_to_string(public.compute_bl_review_pendencies('${pendingBl}'), ',');`)).toMatch(/cliente/i)
    const result = importBase('A232 OUTRA RAZAO SA', true)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ bls_linked: 1, linked_bl_ids: [pendingBl] })
    expect(psql(`SELECT name FROM public.customers WHERE id = ${customerId};`)).toBe('A232 OUTRA RAZAO SA')
    expect(psql(`SELECT customer_id || ':' || customer_reconciliation_status FROM public.bls WHERE id = '${pendingBl}';`))
      .toBe(`${customerId}:matched_document`)
    expect(psql(`SELECT count(*) FROM public.bls WHERE id IN ('${rejectedBl}', '${cancelledBl}') AND customer_id IS NOT NULL;`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${pendingBl}' AND field_name = 'customer_id'
      AND justification = 'Vínculo por documento pela Base de Clientes';`)).toBe('1')
    // A Revisão foi reavaliada: o B/L não fica preso por falta de Cliente.
    // A Revisão foi reavaliada: a pendência de Cliente saiu; a do Portal (sem
    // conta provisionada na fixture) continua, como deve.
    const review = psql(`SELECT COALESCE(notes, '') FROM public.bls WHERE id = '${pendingBl}';`)
    expect(review).toMatch(/Acesso ao portal nao provisionado/)
    expect(review).not.toMatch(/cliente/i)
  })
})
