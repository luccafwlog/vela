// Lote 7 das correções decididas pelo dono em 2026-10-27 (migration 475; ADR
// 0106): o nome do autor do Histórico para todos os setores (ACE-D16), a
// reativação de usuário numa linha só, no assunto Usuário e com o motivo
// (ACE-D12), e a leitura das falhas de entrega e das linhas de Usuário do
// Histórico de ações só pelo Administrativo (ACE-D06).
//
// Namespace exclusivo: usuários ...000000472NNN, falha 'a472_teste'.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '00000000-0000-0000-0000-000000472001'
const DOC = '00000000-0000-0000-0000-000000472002'
const FIN = '00000000-0000-0000-0000-000000472003'
const USERS = [ADM, DOC, FIN].map((id) => `'${id}'`).join(', ')
const BL_ENTITY = 'A472-BL'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(user: string, sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${user}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_id IN (${USERS}, '${BL_ENTITY}') OR changed_by IN (${USERS});
    DELETE FROM public.alert_notification_failures WHERE item_type = 'a472_teste';
    DELETE FROM public.user_profiles WHERE id IN (${USERS});
    DELETE FROM auth.users WHERE id IN (${USERS});
    SET session_replication_role = origin;
  `)
}

describeLocal('Acesso, usuários e Histórico decididos pelo dono (migration 475)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'a472-adm@example.test'), ('${DOC}', 'a472-doc@example.test'), ('${FIN}', 'a472-fin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADM}', 'A472 Ana Administrativo', 'administrativo', true),
        ('${DOC}', 'A472 Paula Documentação', 'documentacao', true),
        ('${FIN}', 'A472 Rafael Financeiro', 'financeiro', true);
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
        VALUES ('bls', '${BL_ENTITY}', 'notes', NULL, 'nota', '${FIN}');
      INSERT INTO public.alert_notification_failures (item_type, department, reason) VALUES ('a472_teste', 'documentacao', 'sem destinatário');
    `)
  })

  afterAll(cleanup)

  it('ACE-D16: a Documentação lê o nome do autor, e só o nome', () => {
    const names = asUser(DOC, `SELECT string_agg(full_name, '|' ORDER BY full_name) FROM public.get_user_display_names(ARRAY['${FIN}', '${ADM}']::uuid[]);`)
    expect(names.stderr).toBe('')
    expect(names.stdout).toBe('A472 Ana Administrativo|A472 Rafael Financeiro')
    expect(psql(`SELECT pg_get_function_result('public.get_user_display_names(uuid[])'::regprocedure);`)).toBe('TABLE(user_id uuid, full_name text)')
    // O cadastro de usuários continua fechado: a leitura direta só traz o próprio perfil.
    expect(asUser(DOC, `SELECT count(*) FROM public.user_profiles WHERE id IN (${USERS});`).stdout).toBe('1')
    expect(psql(`SELECT has_function_privilege('anon', 'public.get_user_display_names(uuid[])', 'EXECUTE');`)).toBe('f')
  })

  it('ACE-D12: reativar o usuário grava uma linha só, no assunto Usuário, com o motivo', () => {
    psql(`SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${ADM}';
      UPDATE public.user_profiles SET active = false WHERE id = '${FIN}';
      DELETE FROM public.audit_logs WHERE entity_id = '${FIN}';`)
    const run = asUser(ADM, `SELECT public.reactivate_catalog_row('user_profiles', '${FIN}', 'voltou de férias');`)
    expect(run.stderr).toBe('')
    expect(psql(`SELECT string_agg(entity_type || ':' || field_name || ':' || new_value || ':' || COALESCE(justification, '-'), ' ; ')
      FROM public.audit_logs WHERE entity_id = '${FIN}';`)).toBe('user_profile:active:true:voltou de férias')
  })

  it('ACE-D06: falhas de entrega e linhas de Usuário do Histórico de ações são só do Administrativo', () => {
    expect(asUser(DOC, `SELECT count(*) FROM public.alert_notification_failures WHERE item_type = 'a472_teste';`).stdout).toBe('0')
    expect(asUser(ADM, `SELECT count(*) FROM public.alert_notification_failures WHERE item_type = 'a472_teste';`).stdout).toBe('1')
    expect(asUser(DOC, `SELECT count(*) FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id = '${FIN}';`).stdout).toBe('0')
    expect(asUser(ADM, `SELECT count(*) FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id = '${FIN}';`).stdout).toBe('1')
    // Os demais assuntos seguem lidos por todos: são o Histórico de cada tela.
    expect(asUser(DOC, `SELECT count(*) FROM public.audit_logs WHERE entity_id = '${BL_ENTITY}';`).stdout).toBe('1')
  })
})
