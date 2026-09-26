import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 096 (ADR 0072): exclusão de cadastro pela RPC delete_catalog_row,
// com motivo obrigatório gravado na auditoria; DELETE direto pela API recusado.

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
    return psql(`SELECT to_regprocedure('public.delete_catalog_row(text,text,text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = migrationApplied() ? describe : describe.skip

const ADMIN_ID = '09600000-0000-4000-8000-0000000000a1'
const OPS_ID = '09600000-0000-4000-8000-0000000000b1'
const TABLE_ID = 9600001
const ITEM_USED = 9600002
const ITEM_FREE = 9600003

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
    DELETE FROM public.charge_table_items WHERE id IN (${ITEM_USED}, ${ITEM_FREE});
    DELETE FROM public.charge_tables WHERE id = ${TABLE_ID};
    DELETE FROM public.audit_logs WHERE entity_type = 'charge_table_items' AND entity_id IN ('${ITEM_USED}', '${ITEM_FREE}');
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('096 — motivo na exclusão de cadastros', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm096@test.local', 'authenticated', 'authenticated'),
        ('${OPS_ID}', 'ops096@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 096', 'administrativo', true),
        ('${OPS_ID}', 'Operações 096', 'operacoes', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.charge_tables (id, name, valid_from) VALUES (${TABLE_ID}, 'Tabela 096', '2026-01-01');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl) VALUES
        (${ITEM_USED}, ${TABLE_ID}, 'Item usado', 'bl', 10),
        (${ITEM_FREE}, ${TABLE_ID}, 'Item livre', 'bl', 10);
      SET session_replication_role = replica;
      INSERT INTO public.charge_calculations (charge_item_id, charge_table_id, source, status) VALUES
        (${ITEM_USED}, ${TABLE_ID}, 'auto', 'calculated');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('recusa DELETE direto pela API, mesmo do Administrativo', () => {
    const result = as(ADMIN_ID, `DELETE FROM public.charge_table_items WHERE id = ${ITEM_FREE};`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/permission denied/)
  })

  it('recusa quem não é Administrativo', () => {
    const result = as(OPS_ID, `SELECT public.delete_catalog_row('charge_table_items', '${ITEM_FREE}', 'duplicado');`)
    expect(result.stderr).toMatch(/Somente o Administrativo pode excluir/)
  })

  it('mantém a linha de serviço de vazios aberta a qualquer usuário ativo', () => {
    const result = as(OPS_ID, `SELECT public.delete_catalog_row('vazios_export_service_lines', '00000000-0000-4000-8000-000000000096', 'lançada errada');`)
    expect(result.stderr).toMatch(/Nada foi excluído/)
  })

  it('exige motivo e recusa tabela fora da lista', () => {
    expect(as(ADMIN_ID, `SELECT public.delete_catalog_row('charge_table_items', '${ITEM_FREE}', '  ');`).stderr)
      .toMatch(/Informe o motivo da exclusão/)
    expect(as(ADMIN_ID, `SELECT public.delete_catalog_row('invoices', '1', 'x');`).stderr)
      .toMatch(/Tabela fora da exclusão de cadastro/)
  })

  it('mantém a trava de tarifa usada', () => {
    expect(as(ADMIN_ID, `SELECT public.delete_catalog_row('charge_table_items', '${ITEM_USED}', 'limpeza');`).stderr)
      .toMatch(/desative em vez de excluir/)
  })

  it('exclui e grava o motivo na auditoria; segunda vez avisa que não existe', () => {
    const ok = as(ADMIN_ID, `SELECT public.delete_catalog_row('charge_table_items', '${ITEM_FREE}', 'cadastrado em duplicidade');`)
    expect(ok.status, ok.stderr).toBe(0)
    expect(psql(`SELECT justification || '|' || changed_by FROM public.audit_logs
      WHERE entity_type = 'charge_table_items' AND entity_id = '${ITEM_FREE}' AND field_name = 'excluido';`))
      .toBe(`cadastrado em duplicidade|${ADMIN_ID}`)
    expect(as(ADMIN_ID, `SELECT public.delete_catalog_row('charge_table_items', '${ITEM_FREE}', 'de novo');`).stderr)
      .toMatch(/Nada foi excluído/)
  })
})
