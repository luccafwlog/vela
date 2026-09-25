import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 089 (ADR 0071, itens 5, 8 e 9): B/L com CE que não segue é
// cancelado, fica selado e não entra em fatura; volta por Reativar. Viagem
// cancelada por engano volta por Reativar. O CE não se apaga com fatura
// emitida.

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
    return psql(`SELECT to_regprocedure('public.cancel_bl(text,text,boolean)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = functionPresent() ? describe : describe.skip

const ADMIN_ID = '08900000-0000-4000-8000-0000000000a1'
const OPS_ID = '08900000-0000-4000-8000-0000000000b1'
const CARRIER_ID = 8900001
const VESSEL_ID = 8900002
const VOYAGE_ID = 8900003
const VOYAGE_CANCELLED = 8900004
const CUSTOMER_ID = 8900005

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

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM public.invoices WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.bls WHERE voyage_id IN (${VOYAGE_ID}, ${VOYAGE_CANCELLED});
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id IN (${VOYAGE_ID}, ${VOYAGE_CANCELLED});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('089 — B/L cancelado, Reativar e CE', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm089@test.local', 'authenticated', 'authenticated'),
        ('${OPS_ID}', 'ops089@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 089', 'administrativo', true),
        ('${OPS_ID}', 'Operações 089', 'operacoes', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 089');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 089', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${VOYAGE_ID}, ${VESSEL_ID}, 'V089', 'active'),
        (${VOYAGE_CANCELLED}, ${VESSEL_ID}, 'V089C', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'Cliente 089', '33000167000101');
      INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES
        ('BL089A', ${VOYAGE_ID}, ${CUSTOMER_ID}, '089000000000001'),
        ('BL089B', ${VOYAGE_ID}, ${CUSTOMER_ID}, '089000000000002');
      INSERT INTO public.invoices (invoice_number, customer_id, bl_id, total_brl, status)
        VALUES ('INV-089B', ${CUSTOMER_ID}, 'BL089B', 10, 'draft');
    `)
  })

  afterAll(cleanup)

  it('só o Administrativo cancela, e fatura em aberto bloqueia', () => {
    expect(as(OPS_ID, `SELECT public.cancel_bl('BL089A', 'não embarcou');`).stderr).toMatch(/Somente o Administrativo cancela B\/L/)
    const blocked = as(ADMIN_ID, `SELECT public.cancel_bl('BL089B', 'não embarcou');`)
    expect(blocked.json).toMatchObject({ cancelled: false, reasons: ['fatura em aberto'] })
  })

  it('B/L cancelado fica selado, não entra em fatura e aparece com a data', () => {
    const run = as(ADMIN_ID, `SELECT public.cancel_bl('BL089A', 'armador reemitiu com outro número');`)
    expect(run.json).toMatchObject({ cancelled: true })
    expect(psql(`SELECT cancel_reason FROM public.bls WHERE id = 'BL089A';`)).toBe('armador reemitiu com outro número')

    expect(() => psql(`UPDATE public.bls SET pod = 'BRSSZ' WHERE id = 'BL089A';`)).toThrow(/cancelado: somente leitura/)
    expect(() => psql(`UPDATE public.bls SET cancelled_at = NULL WHERE id = 'BL089A';`)).toThrow(/Use cancel_bl ou reactivate_bl/)
    expect(() => psql(`INSERT INTO public.invoices (invoice_number, customer_id, bl_id, total_brl, status)
      VALUES ('INV-089A', ${CUSTOMER_ID}, 'BL089A', 5, 'draft');`)).toThrow(/cancelado não entra em fatura/)
  })

  it('Reativar devolve o B/L e registra o motivo', () => {
    const run = as(ADMIN_ID, `SELECT public.reactivate_bl('BL089A', 'cancelado por engano');`)
    expect(run.json).toMatchObject({ reactivated: true })
    expect(psql(`SELECT cancelled_at IS NULL FROM public.bls WHERE id = 'BL089A';`)).toBe('t')
    expect(psql(`SELECT count(*) FROM public.audit_logs
      WHERE entity_type = 'bl' AND entity_id = 'BL089A' AND field_name = 'cancelled';`)).toBe('2')
  })

  it('CE não se apaga com fatura emitida; sem fatura, pode', () => {
    psql(`SET session_replication_role = replica;
      UPDATE public.invoices SET status = 'cancelled' WHERE invoice_number = 'INV-089B';
      INSERT INTO public.invoices (invoice_number, customer_id, bl_id, total_brl, status)
      VALUES ('INV-089B2', ${CUSTOMER_ID}, 'BL089B', 10, 'issued');
      SET session_replication_role = origin;`)
    expect(() => psql(`UPDATE public.bls SET ce_mercante = NULL WHERE id = 'BL089B';`)).toThrow(/não pode ser apagado: há fatura emitida/)
    psql(`UPDATE public.bls SET ce_mercante = NULL WHERE id = 'BL089A';`)
    expect(psql(`SELECT ce_mercante IS NULL FROM public.bls WHERE id = 'BL089A';`)).toBe('t')
  })

  it('cancelar viagem exige o Administrativo; Reativar devolve a viagem', () => {
    expect(as(OPS_ID, `SELECT public.cancel_voyage(${VOYAGE_CANCELLED}, 'armador cancelou', '${OPS_ID}');`).stderr)
      .toMatch(/Somente o Administrativo cancela viagem/)
    as(ADMIN_ID, `SELECT public.cancel_voyage(${VOYAGE_CANCELLED}, 'armador cancelou', '${ADMIN_ID}');`)
    expect(psql(`SELECT status FROM public.voyages WHERE id = ${VOYAGE_CANCELLED};`)).toBe('cancelled')

    const run = as(ADMIN_ID, `SELECT public.reactivate_voyage(${VOYAGE_CANCELLED}, 'cancelada por engano');`)
    expect(run.json).toMatchObject({ reactivated: true })
    expect(psql(`SELECT status FROM public.voyages WHERE id = ${VOYAGE_CANCELLED};`)).not.toBe('cancelled')
  })
})
