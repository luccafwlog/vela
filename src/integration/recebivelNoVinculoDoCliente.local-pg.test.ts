import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 342 (sessão de testes de 2026-10-20, Obs. 4): B/L importado sem
// cliente, com taxas calculadas, ganha o recebível no vínculo do cliente — sem
// recálculo manual — e entra no saldo pendente.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function triggerPresent() {
  if (!enabled) return false
  try {
    return psql(`SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_receivable_on_bl_customer_link');`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(triggerPresent, 'triggerPresent')

const USER_ID = '34200000-0000-4000-8000-0000000000a1'
const CARRIER_ID = 3420001
const VESSEL_ID = 3420002
const VOYAGE_ID = 3420003
const CUSTOMER_A = 3420011
const CUSTOMER_B = 3420012
const CNPJ_A = '11222333000181'
const CNPJ_B = '11444777000161'
const BL_ID = 'BL342LINK'

function as(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${USER_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.bl_receivables WHERE bl_id = '${BL_ID}';
    DELETE FROM public.charge_calculations WHERE bl_id = '${BL_ID}';
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id = '${BL_ID}';
    DELETE FROM public.bls WHERE id = '${BL_ID}';
    DELETE FROM public.customer_contacts WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.audit_logs WHERE changed_by = '${USER_ID}' OR entity_id = '${BL_ID}';
    DELETE FROM public.user_profiles WHERE id = '${USER_ID}';
    DELETE FROM auth.users WHERE id = '${USER_ID}';
    SET session_replication_role = origin;
  `)
}

const receivable = () => psql(`SELECT customer_id || ':' || status || ':' || balance_brl FROM public.bl_receivables WHERE bl_id = '${BL_ID}' AND source = 'local_charges';`)

describeLocal('342 — o vínculo do cliente cria o recebível do B/L já calculado', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${USER_ID}', 'doc342@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER_ID}', 'Documental 342', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 342');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 342', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V342', 'active');
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${CUSTOMER_A}, '${CNPJ_A}', 'Cliente A 342'),
        (${CUSTOMER_B}, '${CNPJ_B}', 'Cliente B 342');
      INSERT INTO public.bls (id, voyage_id, pol, pod, consignee, review_status)
        VALUES ('${BL_ID}', ${VOYAGE_ID}, 'CNTAO', 'BRVIX', 'CONSIGNATARIO 342', 'pending_review');
      INSERT INTO public.charge_calculations (bl_id, quantity, unit_value_brl, total_value_brl, source, status)
        VALUES ('${BL_ID}', 1, 2470, 2470, 'auto', 'calculated');
    `)
  })

  afterAll(cleanup)

  it('sem cliente, as taxas calculadas não geram recebível', () => {
    expect(psql(`SELECT public.sync_local_charge_receivable('${BL_ID}') IS NULL;`)).toBe('t')
    expect(receivable()).toBe('')
  })

  it('vincular pela revisão por grupo cria o recebível aberto e o saldo pendente', () => {
    const run = as(`SELECT public.complete_review_customer_group(ARRAY['${BL_ID}'], ${CUSTOMER_A}, '${CNPJ_A}', 'Cliente A 342', 'a342@test.local', '${USER_ID}');`)
    expect(run.stderr).toBe('')
    expect(receivable()).toBe(`${CUSTOMER_A}:open:2470.00`)
    const balance = as(`SELECT total_balance_brl FROM public.get_customer_pending_balances(ARRAY[${CUSTOMER_A}]::bigint[]);`)
    expect(balance.stdout.trim().split('\n').pop()).toBe('2470.00')
  })

  it('trocar de A para B, sem recebimento, leva o recebível para B', () => {
    psql(`
      SELECT set_config('request.jwt.claims', '{"sub":"${USER_ID}","role":"authenticated"}', false);
      UPDATE public.bls SET customer_id = ${CUSTOMER_B} WHERE id = '${BL_ID}';
    `)
    expect(receivable()).toBe(`${CUSTOMER_B}:open:2470.00`)
  })
})
