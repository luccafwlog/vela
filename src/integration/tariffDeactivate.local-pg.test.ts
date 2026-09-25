import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 091 (ADR 0073): tarifa usada só se desativa; override desativado
// sai do cálculo; desativar/reativar tarifa é do Administrativo.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_used_tariff_delete');`) === 't'
  } catch {
    return false
  }
}

const describeLocal = migrationApplied() ? describe : describe.skip

const ADMIN_ID = '09100000-0000-4000-8000-0000000000a1'
const OPS_ID = '09100000-0000-4000-8000-0000000000b1'
const TABLE_ID = 9100001
const ITEM_USED = 9100002
const ITEM_FREE = 9100003
const CUSTOMER_ID = 9100004

function as(userId: string, sql: string) {
  return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.charge_calculations WHERE charge_item_id IN (${ITEM_USED}, ${ITEM_FREE});
    DELETE FROM public.customer_rate_overrides WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.charge_table_items WHERE id IN (${ITEM_USED}, ${ITEM_FREE});
    DELETE FROM public.charge_tables WHERE id = ${TABLE_ID};
    DELETE FROM public.demurrage_rates WHERE container_type IN ('T091V', 'T091F');
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('091 — tarifa usada só se desativa', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm091@test.local', 'authenticated', 'authenticated'),
        ('${OPS_ID}', 'ops091@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 091', 'administrativo', true),
        ('${OPS_ID}', 'Operações 091', 'operacoes', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'Cliente 091', '27865757000102');
      INSERT INTO public.charge_tables (id, name, valid_from) VALUES (${TABLE_ID}, 'Tabela 091', '2026-01-01');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl) VALUES
        (${ITEM_USED}, ${TABLE_ID}, 'Item usado', 'bl', 10),
        (${ITEM_FREE}, ${TABLE_ID}, 'Item livre', 'bl', 10);
      SET session_replication_role = replica;
      INSERT INTO public.charge_calculations (charge_item_id, charge_table_id, source, status) VALUES
        (${ITEM_USED}, ${TABLE_ID}, 'auto', 'calculated');
      SET session_replication_role = origin;
      INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value) VALUES
        (${CUSTOMER_ID}, ${ITEM_USED}, 8);
      INSERT INTO public.demurrage_rates (container_type, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, valid_from) VALUES
        ('T091V', 1, 5, 10, 6, 20, current_date - 1),
        ('T091F', 1, 5, 10, 6, 20, current_date + 30);
    `)
  })

  afterAll(cleanup)

  it('item usado em cálculo não se exclui; o livre sai', () => {
    expect(() => psql(`DELETE FROM public.charge_table_items WHERE id = ${ITEM_USED};`)).toThrow(/desative em vez de excluir/)
    psql(`DELETE FROM public.charge_table_items WHERE id = ${ITEM_FREE};`)
    expect(psql(`SELECT count(*) FROM public.charge_table_items WHERE id = ${ITEM_FREE};`)).toBe('0')
  })

  it('tarifa de Demurrage em vigor não se exclui; a futura sai', () => {
    expect(() => psql(`DELETE FROM public.demurrage_rates WHERE container_type = 'T091V';`)).toThrow(/desative em vez de excluir/)
    psql(`DELETE FROM public.demurrage_rates WHERE container_type = 'T091F';`)
    expect(psql(`SELECT count(*) FROM public.demurrage_rates WHERE container_type = 'T091F';`)).toBe('0')
  })

  it('só o Administrativo desativa override; desativado sai da lista de cobrança manual', () => {
    const ops = as(OPS_ID, `UPDATE public.customer_rate_overrides SET active = false WHERE customer_id = ${CUSTOMER_ID};`)
    expect(ops.stderr).toMatch(/Somente o Administrativo desativa ou reativa tarifas/)

    const admin = as(ADMIN_ID, `UPDATE public.customer_rate_overrides SET active = false WHERE customer_id = ${CUSTOMER_ID};`)
    expect(admin.status).toBe(0)
    expect(psql(`SELECT active FROM public.customer_rate_overrides WHERE customer_id = ${CUSTOMER_ID};`)).toBe('f')
    expect(psql(`SELECT count(*) FROM pg_proc WHERE proname IN
      ('resolve_bl_local_charge_items', 'add_manual_bl_charge', 'list_manual_charge_items_for_bl')
      AND prosrc LIKE '%WHERE cro.active%';`)).toBe('3')
  })

  it('só o Administrativo desativa tabela de taxas', () => {
    const ops = as(OPS_ID, `UPDATE public.charge_tables SET active = false WHERE id = ${TABLE_ID};`)
    expect(ops.stderr).toMatch(/Somente o Administrativo desativa ou reativa tarifas/)
  })
})
