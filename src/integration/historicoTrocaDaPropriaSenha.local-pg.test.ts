import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 430 (auditoria run-3, nota de endurecimento): a troca da própria
// senha entra no Histórico, só para a própria conta e sem valor. Tudo roda numa
// transação descartada no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const OPS = '41800000-0000-4000-8000-000000000001'
const OTHER = '41800000-0000-4000-8000-000000000002'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function migration418Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('alterada pelo próprio usuário' in prosrc) > 0 FROM pg_proc WHERE proname = 'record_audit_entries';`) === 't'
  } catch {
    return false
  }
}

const entry = (entityId: string, newValue: string) =>
  `'[{"entity_type":"user_profile","entity_id":"${entityId}","field_name":"password","old_value":null,"new_value":"${newValue}"}]'::jsonb`

function scenario(sql: string): string[] {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN;
    INSERT INTO auth.users (id, email) VALUES ('${OPS}', 'c418-ops@example.test'), ('${OTHER}', 'c418-outro@example.test');
    INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
      ('${OPS}', 'Operações C418', 'operacoes', true), ('${OTHER}', 'Outro C418', 'operacoes', true);
    CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $f$
    BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $f$;
    GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated;
    SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${OPS}';
    ${sql}
    ROLLBACK;`], { encoding: 'utf8' }).trim().split(/\r?\n/)
}

const describeLocal = describeWithProbe(migration418Applied, 'migration418Applied (Histórico da troca da própria senha)')

describeLocal('430 — Histórico da troca da própria senha', () => {
  it('aceita só a própria conta, com o valor fixo', () => {
    expect(scenario(`
      SELECT pg_temp.try($q$SELECT public.record_audit_entries(${entry(OPS, 'alterada pelo próprio usuário')})$q$);
      SELECT pg_temp.try($q$SELECT public.record_audit_entries(${entry(OTHER, 'alterada pelo próprio usuário')})$q$);
      SELECT pg_temp.try($q$SELECT public.record_audit_entries(${entry(OPS, 'NovaSenha123')})$q$);
      RESET ROLE;
      SELECT count(*) FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id = '${OPS}' AND changed_by = '${OPS}';
    `)).toEqual(['ok', '42501', '42501', '1'])
  })
})
