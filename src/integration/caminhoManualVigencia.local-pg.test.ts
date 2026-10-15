import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Item A10 do plano docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md
// (migration 248; ADR 0083, item 10; ADR 0040): o lançamento manual e o Item da
// tabela da avulsa escolhem a tabela (ativa, sem data) e a Condição de Cliente
// (Data de Referência: ETA da escala do POD) como o cálculo automático.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER_ID = '24824800-0000-4000-8000-000000000001'
const CARRIER_ID = 99248001
const VESSEL_ID = 99248002
const VOYAGE_ID = 99248003
const BATCH_ID = 99248004
const CUSTOMER_ID = 99248011
const TABLE_ID = 99248021
const ITEM_ID = 99248022
const POD = 'BRA48'
const BL = 'A248-BL1'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asUser(sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_id = '${BL}' OR changed_by = '${USER_ID}';
    DELETE FROM public.charge_calculations WHERE bl_id = '${BL}';
    DELETE FROM public.bls WHERE id = '${BL}';
    DELETE FROM public.import_batches WHERE id = ${BATCH_ID};
    DELETE FROM public.customer_rate_overrides WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${TABLE_ID} OR charge_item_id = ${ITEM_ID};
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${TABLE_ID};
    DELETE FROM public.charge_tables WHERE id = ${TABLE_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${USER_ID}';
    DELETE FROM auth.users WHERE id = '${USER_ID}';
    SET session_replication_role = origin;
  `)
}

function migration248Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'bl_local_charge_reference_date';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration248Applied, 'migration248Applied (caminho manual segue a vigência do automático)')

describeLocal('248 — lançamento manual e avulsa seguem a regra do automático (A10)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'operacoes-a248@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER_ID}', 'Operações A248', 'operacoes', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador A248');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio A248', ${CARRIER_ID});
      -- ETA da escala do POD em março; o lote foi enviado em junho.
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status, eta, pod_schedule_snapshot)
      VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'A248V', 'active', '2026-05-20', '{"${POD}": {"eta": "2026-03-10"}}'::jsonb);
      INSERT INTO public.import_batches (id, voyage_id, filename, uploaded_at) VALUES (${BATCH_ID}, ${VOYAGE_ID}, 'a248.xlsx', '2026-06-15');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE A248 LTDA', '${syntheticCnpj(248011)}');
      -- Tabela ativa com vigência vencida: a vigência é informativa (ADR 0040).
      INSERT INTO public.charge_tables (id, name, pod, valid_from, valid_to, cargo_mode, active)
      VALUES (${TABLE_ID}, 'Tabela A248', '${POD}', '2025-01-01', '2025-12-31', 'container', true);
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, application_basis, value_brl, unit_value_brl, currency, manual_only)
      VALUES (${ITEM_ID}, ${TABLE_ID}, 'Taxa manual A248', 'bl', 'bl', 100, 100, 'BRL', true);
      INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, valid_to) VALUES
        (${CUSTOMER_ID}, ${ITEM_ID}, 70, '2026-03-01', '2026-03-31'),
        (${CUSTOMER_ID}, ${ITEM_ID}, 90, '2026-06-01', NULL);
      INSERT INTO public.bls (id, voyage_id, batch_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status)
      VALUES ('${BL}', ${VOYAGE_ID}, ${BATCH_ID}, ${CUSTOMER_ID}, 'CNSHA', '${POD}', 'container', 'pending', 'calculated', 'ok');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('a Data de Referência é a ETA da escala do POD, não a data do upload', () => {
    expect(psql(`SELECT public.bl_local_charge_reference_date('${BL}');`)).toBe('2026-03-10')
  })

  it('o catálogo do lançamento manual lista a tabela ativa vencida com a Condição da ETA', () => {
    const result = asUser(`SELECT charge_table_id || ':' || effective_unit_value_brl FROM public.list_manual_charge_items_for_bl('${BL}')`)
    expect(result.error).toBe('')
    expect(result.output).toBe(`${TABLE_ID}:70.00`)
  })

  it('o Item da tabela da avulsa cota com a mesma Condição', () => {
    const result = asUser(`SELECT public.quote_manual_invoice_charge('${BL}', ${ITEM_ID})`)
    expect(result.error).toBe('')
    expect(JSON.parse(result.output)).toMatchObject({ unit_value_brl: 70, total_brl: 70 })
  })

  it('o lançamento manual grava o valor da Condição da ETA', () => {
    const result = asUser(`SELECT public.add_manual_bl_charge('${BL}', ${ITEM_ID}, 1, 'Teste A248', '${USER_ID}')`)
    expect(result.error).toBe('')
    expect(psql(`SELECT unit_value_brl || ':' || override_applied FROM public.charge_calculations WHERE bl_id = '${BL}' AND source = 'manual';`))
      .toBe('70.00:true')
  })
})
