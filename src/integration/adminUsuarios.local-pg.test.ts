import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '40000000-0000-0000-0000-000000000001'
const memberId = '50000000-0000-0000-0000-000000000002'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function callAs(userId: string, sql: string) {
  return spawnPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', true); ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
}

describeLocal('migration 259 — administração de usuários internos', () => {
  beforeAll(() => {
    psql(`
      -- The disposable local auth schema is intentionally minimal; production
      -- Supabase auth.users includes this column used by the protected RPC.
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'admin-258@example.test'),
        ('${memberId}', 'member-258@example.test')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'Admin 258', 'administrativo', true),
        ('${memberId}', 'Membro 258', 'documentacao', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active;
      DELETE FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id = '${memberId}';
    `)
  })

  afterAll(() => {
    psql(`
      DELETE FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id IN ('${adminId}', '${memberId}');
      DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${memberId}');
      DELETE FROM auth.users WHERE id IN ('${adminId}', '${memberId}');
    `)
  })

  it('admin_list_users devolve e-mail do auth.users para o admin', () => {
    const result = callAs(adminId, `SELECT email FROM public.admin_list_users() WHERE id = '${memberId}';`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('member-258@example.test')
  })

  it('admin_list_users recusa quem nao e administrador', () => {
    const result = callAs(memberId, 'SELECT count(*) FROM public.admin_list_users();')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Apenas administradores')
  })

  it('trigger registra a troca de setor com o autor da mudanca', () => {
    callAs(adminId, `UPDATE public.user_profiles SET role = 'financeiro' WHERE id = '${memberId}';`)
    const row = psql(`
      SELECT field_name || '|' || old_value || '|' || new_value || '|' || changed_by
      FROM public.audit_logs
      WHERE entity_type = 'user_profile' AND entity_id = '${memberId}' AND field_name = 'role'
      ORDER BY changed_at DESC LIMIT 1;
    `)
    expect(row).toBe(`role|documentacao|financeiro|${adminId}`)
  })

  it('trigger registra a desativacao', () => {
    callAs(adminId, `UPDATE public.user_profiles SET active = false WHERE id = '${memberId}';`)
    const row = psql(`
      SELECT old_value || '|' || new_value
      FROM public.audit_logs
      WHERE entity_type = 'user_profile' AND entity_id = '${memberId}' AND field_name = 'active'
      ORDER BY changed_at DESC LIMIT 1;
    `)
    expect(row).toBe('true|false')
  })

  // A2 (migration 239): o sistema mantém ao menos um Administrativo ativo.
  // Tudo numa transação desfeita: os demais Administrativos do banco local
  // ficam inativos só dentro dela, para este ser o último.
  function asLastAdmin(sql: string) {
    return spawnPsql([
      '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl,
      '-c', `BEGIN;
        SET LOCAL session_replication_role = replica;
        UPDATE public.user_profiles SET active = false WHERE role = 'administrativo' AND id <> '${adminId}';
        SET LOCAL session_replication_role = origin;
        SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${adminId}', true);
        ${sql}
        ROLLBACK;`,
    ], { encoding: 'utf8' })
  }

  it('A2: o último Administrativo ativo não muda de setor nem é desativado', () => {
    const demote = asLastAdmin(`UPDATE public.user_profiles SET role = 'financeiro' WHERE id = '${adminId}';`)
    expect(demote.status).not.toBe(0)
    expect(demote.stderr).toContain('Admin 258 é o último usuário Administrativo ativo')

    const deactivate = asLastAdmin(`UPDATE public.user_profiles SET active = false WHERE id = '${adminId}';`)
    expect(deactivate.status).not.toBe(0)
    expect(deactivate.stderr).toContain('último usuário Administrativo ativo')

    // Com outro Administrativo ativo, a troca passa (e é desfeita no fim).
    const withOther = asLastAdmin(`RESET ROLE; UPDATE public.user_profiles SET role = 'administrativo', active = true WHERE id = '${memberId}';
      SET LOCAL ROLE authenticated; UPDATE public.user_profiles SET role = 'financeiro' WHERE id = '${adminId}';`)
    expect(withOther.stderr).not.toContain('último usuário Administrativo ativo')
    expect(withOther.status).toBe(0)
  })

  it('A3 (migration 240): nem o Administrativo exclui perfil interno pela API', () => {
    const result = callAs(adminId, `DELETE FROM public.user_profiles WHERE id = '${memberId}';`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/permission denied for table user_profiles/)
    expect(psql(`SELECT count(*) FROM public.user_profiles WHERE id = '${memberId}';`)).toBe('1')
  })
})
