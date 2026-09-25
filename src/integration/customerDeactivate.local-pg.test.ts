import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 092 (ADR 0073, itens 5 e 6): cliente desativado sai das escolhas,
// perde o Portal, não se desativa com cobrança aberta, e B/L com o CNPJ dele
// vai para a Revisão em vez de se vincular.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function functionPresent() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.deactivate_customer(bigint,text,boolean)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = functionPresent() ? describe : describe.skip

const ADMIN_ID = '09200000-0000-4000-8000-0000000000a1'
const OPS_ID = '09200000-0000-4000-8000-0000000000b1'
const PORTAL_USER = '09200000-0000-4000-8000-0000000000c1'
const CUSTOMER_FREE = 9200001
const CUSTOMER_OPEN = 9200002
const CARRIER_ID = 9200003
const VESSEL_ID = 9200004
const VOYAGE_ID = 9200005

function as(userId: string, sql: string) {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  const last = run.stdout.trim().split('\n').pop() ?? ''
  return { ...run, json: run.status === 0 && last.startsWith('{') ? JSON.parse(last) : null }
}

const CUSTOMERS = `${CUSTOMER_FREE}, ${CUSTOMER_OPEN}`

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM public.invoices WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.bls WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customers WHERE id IN (${CUSTOMERS});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPS_ID}', '${PORTAL_USER}');
    SET session_replication_role = origin;
  `)
}

describeLocal('092 — cliente desativado', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm092@test.local', 'authenticated', 'authenticated'),
        ('${OPS_ID}', 'ops092@test.local', 'authenticated', 'authenticated'),
        ('${PORTAL_USER}', 'portal092@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 092', 'administrativo', true),
        ('${OPS_ID}', 'Operações 092', 'operacoes', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        (${CUSTOMER_FREE}, 'Cliente livre 092', '61198164000160'),
        (${CUSTOMER_OPEN}, 'Cliente com fatura 092', '43283811000150');
      INSERT INTO public.invoices (invoice_number, customer_id, total_brl, status)
        VALUES ('INV-092', ${CUSTOMER_OPEN}, 10, 'draft');
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 092');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 092', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V092', 'active');
      SET session_replication_role = replica;
      DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_FREE};
      INSERT INTO public.customer_portal_accounts (customer_id, auth_user_id, active, account_situation)
        VALUES (${CUSTOMER_FREE}, '${PORTAL_USER}', true, 'ativo');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('só o Administrativo desativa; cobrança em aberto bloqueia; coluna só pela RPC', () => {
    expect(as(OPS_ID, `SELECT public.deactivate_customer(${CUSTOMER_FREE}, 'encerrou');`).stderr).toMatch(/Somente o Administrativo desativa cliente/)
    expect(as(ADMIN_ID, `SELECT public.deactivate_customer(${CUSTOMER_OPEN}, 'encerrou');`).json)
      .toMatchObject({ deactivated: false, reasons: ['fatura em aberto'] })
    expect(as(ADMIN_ID, `UPDATE public.customers SET deactivated_at = now() WHERE id = ${CUSTOMER_FREE};`).stderr)
      .toMatch(/Use deactivate_customer/)
  })

  it('cliente desativado perde o Portal', () => {
    expect(as(PORTAL_USER, `SELECT public.current_portal_customer_id();`).stdout.trim().split('\n').pop()).toBe(String(CUSTOMER_FREE))
    expect(as(ADMIN_ID, `SELECT public.deactivate_customer(${CUSTOMER_FREE}, 'encerrou a operação');`).json)
      .toMatchObject({ deactivated: true })
    expect(as(PORTAL_USER, `SELECT public.current_portal_customer_id();`).stderr).toMatch(/cliente desativado/)
  })

  it('B/L com o CNPJ do cliente desativado vai para a Revisão; vínculo manual é recusado', () => {
    psql(`INSERT INTO public.bls (id, voyage_id, customer_id, customer_reconciliation_status)
      VALUES ('BL092AUTO', ${VOYAGE_ID}, ${CUSTOMER_FREE}, 'matched_document');`)
    expect(psql(`SELECT coalesce(customer_id::text, 'null') || '|' || suggested_customer_id || '|' || customer_reconciliation_status
      FROM public.bls WHERE id = 'BL092AUTO';`)).toBe(`null|${CUSTOMER_FREE}|matched_name`)

    expect(() => psql(`INSERT INTO public.bls (id, voyage_id, customer_id, customer_reconciliation_status)
      VALUES ('BL092MAN', ${VOYAGE_ID}, ${CUSTOMER_FREE}, 'reconciled');`)).toThrow(/desativado: reative antes de vincular/)
  })

  it('Reativar devolve o cliente, com auditoria', () => {
    expect(as(ADMIN_ID, `SELECT public.reactivate_customer(${CUSTOMER_FREE}, 'voltou a operar');`).json).toMatchObject({ reactivated: true })
    expect(psql(`SELECT deactivated_at IS NULL FROM public.customers WHERE id = ${CUSTOMER_FREE};`)).toBe('t')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'customer'
      AND entity_id = '${CUSTOMER_FREE}' AND field_name = 'deactivated';`)).toBe('2')
  })
})
