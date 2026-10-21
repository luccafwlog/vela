import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 342 (sessão de testes de 2026-10-20, Obs. 4): B/L importado sem
// cliente, com taxas calculadas, ganha o recebível no vínculo do cliente — sem
// recálculo manual — e entra no saldo pendente. B/L ainda não faturado é
// recalculado com a Condição de Cliente do novo cliente antes (revisão da PR
// 1005): o cálculo sem cliente usou a tabela geral.

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
const CHARGE_TABLE_ID = 3420004
const BL_FEE_ITEM = 3420005
const CUSTOMER_A = 3420011
const CUSTOMER_B = 3420012
const CNPJ_A = '34201111000188'
const CNPJ_B = '34202222000109'
const BL_ID = 'BL342LINK'
const POD = 'R342POD'

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
    DELETE FROM public.import_pending_effects WHERE entity_id = '${BL_ID}';
    DELETE FROM public.charge_calculations WHERE bl_id = '${BL_ID}';
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${CHARGE_TABLE_ID};
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id = '${BL_ID}';
    DELETE FROM public.bl_containers WHERE bl_id = '${BL_ID}';
    DELETE FROM public.bls WHERE id = '${BL_ID}';
    DELETE FROM public.customer_rate_overrides WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${CHARGE_TABLE_ID};
    DELETE FROM public.charge_tables WHERE id = ${CHARGE_TABLE_ID};
    DELETE FROM public.customer_contacts WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
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
const blFee = () => psql(`SELECT total_value_brl || ':' || override_applied FROM public.charge_calculations WHERE bl_id = '${BL_ID}' AND charge_item_id = ${BL_FEE_ITEM};`)

describeLocal('342 — o vínculo do cliente recalcula e cria o recebível do B/L', () => {
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
      -- Tabela geral de R$ 600; o Cliente A tem Condição de R$ 450, o B não.
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (${CHARGE_TABLE_ID}, 'Tabela 342', '${POD}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, unit_value_usd, application_basis, category, cargo_profile, currency)
        VALUES (${BL_FEE_ITEM}, ${CHARGE_TABLE_ID}, 'B/L Fee', 'bl', 600, 600, NULL, 'bl', 'base', 'any', 'BRL');
      INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, active)
        VALUES (${CUSTOMER_A}, ${BL_FEE_ITEM}, 450, CURRENT_DATE - 60, true);
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, consignee, review_status, financial_status, charge_status)
        VALUES ('${BL_ID}', ${VOYAGE_ID}, 'CNTAO', '${POD}', 'container', 'CONSIGNATARIO 342', 'pending_review', 'pending', 'not_calculated');
      INSERT INTO public.bl_containers (bl_id, container_number, type, is_imo, is_oog) VALUES ('${BL_ID}', 'RCUS3420001', '22G1', false, false);
    `)
    // Cálculo da importação, ainda sem cliente: tabela geral.
    const calc = as(`SELECT public.calculate_bl_local_charges('${BL_ID}', '${USER_ID}'::uuid, true);`)
    expect(calc.stderr).toBe('')
  })

  afterAll(cleanup)

  it('sem cliente, as taxas calculadas pela tabela geral não geram recebível', () => {
    expect(blFee()).toBe('600.00:false')
    expect(receivable()).toBe('')
  })

  it('vincular pela revisão por grupo recalcula com a Condição do cliente e cria o recebível', () => {
    const run = as(`SELECT public.complete_review_customer_group(ARRAY['${BL_ID}'], ${CUSTOMER_A}, '${CNPJ_A}', 'Cliente A 342', 'a342@test.local', '${USER_ID}');`)
    expect(run.stderr).toBe('')
    expect(blFee()).toBe('450.00:true')
    expect(receivable()).toBe(`${CUSTOMER_A}:open:450.00`)
    const balance = as(`SELECT total_balance_brl FROM public.get_customer_pending_balances(ARRAY[${CUSTOMER_A}]::bigint[]);`)
    expect(balance.stdout.trim().split('\n').pop()).toBe('450.00')
  })

  it('trocar de A para B, sem recebimento, recalcula pela tabela de B e leva o recebível', () => {
    psql(`
      SELECT set_config('request.jwt.claims', '{"sub":"${USER_ID}","role":"authenticated"}', false);
      UPDATE public.bls SET customer_id = ${CUSTOMER_B} WHERE id = '${BL_ID}';
    `)
    expect(blFee()).toBe('600.00:false')
    expect(receivable()).toBe(`${CUSTOMER_B}:open:600.00`)
  })
})
