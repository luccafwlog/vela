import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 419 (auditoria run-3, achado C1; ADR 0099): depois de
// `internal_revoke_sessions`, o access token interno emitido antes do marco
// não autoriza mais nada — helpers, `ce_unlock_private.actor`, políticas e a
// checagem que roda antes de toda requisição do PostgREST. Token emitido
// depois do marco, usuário sem marco, rotina de serviço que age em nome do
// usuário e `anon` seguem como antes.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const DOC = '40700000-0000-4000-8000-000000000001'
const ADMIN = '40700000-0000-4000-8000-000000000002'
const FRESH = '40700000-0000-4000-8000-000000000003'
const MISSING = '40700000-0000-4000-8000-0000000000ff'
const CUSTOMER_ID = 407001

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function migration407Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regclass('public.internal_credential_revocations') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

type Claims = Record<string, unknown>

// Sessão do PostgREST: o papel da requisição e os claims do JWT.
function asSession(role: 'authenticated' | 'anon' | 'service_role', claims: Claims | null, sql: string) {
  const settings = claims === null ? '' : `SET LOCAL request.jwt.claims = '${JSON.stringify(claims)}';`
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE ${role}; ${settings} ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { status: result.status, output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function staff(sub: string, iat: number | string | null, sql: string) {
  const claims: Claims = { sub, role: 'authenticated' }
  if (iat !== null) claims.iat = iat
  return asSession('authenticated', claims, sql)
}

function revoke(userId: string): number {
  asSession('service_role', null, `SELECT public.internal_revoke_sessions('${userId}')`)
  return Number(psql(`SELECT floor(extract(epoch FROM revoked_at))::bigint
    FROM public.internal_credential_revocations WHERE user_id = '${userId}';`))
}

const HELPERS = `SELECT public.is_active_user(), public.is_active_read_user(), public.is_admin(),
  public.is_financeiro_user(), coalesce(public.current_actor_role(), '-'), coalesce(public.portal_current_role(), '-')`

const describeLocal = describeWithProbe(migration407Applied, 'migration407Applied (corte do token interno)')

describeLocal('419 — corte do access token interno na revogação', () => {
  beforeAll(() => {
    psql(`INSERT INTO auth.users (id, email) VALUES
      ('${DOC}', 'c407-doc@example.test'), ('${ADMIN}', 'c407-admin@example.test'), ('${FRESH}', 'c407-fresh@example.test')
      ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
      ('${DOC}', 'Documentação C407', 'documentacao', true),
      ('${ADMIN}', 'Administrativo C407', 'administrativo', true),
      ('${FRESH}', 'Operações C407', 'operacoes', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;`)
    psql(`INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER_ID}, '${syntheticCnpj(407001)}', 'Cliente C407')
      ON CONFLICT (id) DO NOTHING;`)
    psql(`DELETE FROM public.internal_credential_revocations WHERE user_id IN ('${DOC}', '${ADMIN}', '${FRESH}');`)
    // O shim local não traz as tabelas de sessão do GoTrue (mesmo arranjo de auditoriaRun2).
    psql(`CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
      CREATE TABLE IF NOT EXISTS auth.refresh_tokens (id bigserial PRIMARY KEY, user_id text);
      GRANT ALL ON auth.sessions, auth.refresh_tokens TO service_role;
      INSERT INTO auth.sessions (user_id) VALUES ('${DOC}');
      INSERT INTO auth.refresh_tokens (user_id) VALUES ('${DOC}');`)
  })

  afterAll(() => {
    for (const sql of [
      `DELETE FROM public.internal_credential_revocations WHERE user_id IN ('${DOC}', '${ADMIN}', '${FRESH}');`,
      `DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};`,
      `DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};`,
      `DELETE FROM public.user_profiles WHERE id IN ('${DOC}', '${ADMIN}', '${FRESH}');`,
      `DELETE FROM auth.users WHERE id IN ('${DOC}', '${ADMIN}', '${FRESH}');`,
    ]) {
      spawnPsql(['-X', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
    }
  })

  it('a revogação grava o marco e o token anterior perde a autoridade em todos os helpers', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(staff(DOC, now - 60, HELPERS).output).toBe('t|t|f|f|documentacao|documentacao')

    const cut = revoke(DOC)
    expect(cut).toBeGreaterThanOrEqual(now - 1)
    expect(psql(`SELECT (SELECT count(*) FROM auth.sessions WHERE user_id = '${DOC}')
      + (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = '${DOC}');`)).toBe('0')
    expect(staff(DOC, cut - 60, HELPERS).output).toBe('f|f|f|f|-|-')

    const adminCut = revoke(ADMIN)
    expect(staff(ADMIN, adminCut - 60, `SELECT public.is_admin()`).output).toBe('f')
  })

  it('a checagem antes da requisição recusa o token anterior com 28000 e as políticas não deixam ler nem gravar', () => {
    const cut = revoke(DOC)
    const blocked = staff(DOC, cut - 60, `SELECT public.check_internal_token_cutoff()`)
    expect(blocked.status).not.toBe(0)
    expect(blocked.error).toContain('28000')

    // Política que lia `user_profiles` direto (app_settings_communications_read).
    expect(staff(DOC, cut - 60, `SELECT count(*) FROM public.app_settings`).output).toBe('0')
    // Política por helper (customers_update_active_global): nenhuma linha muda.
    const update = staff(DOC, cut - 60, `UPDATE public.customers SET name = 'C407 alterado' WHERE id = ${CUSTOMER_ID} RETURNING id`)
    expect(update.output).toBe('')
    expect(psql(`SELECT name FROM public.customers WHERE id = ${CUSTOMER_ID};`)).toBe('Cliente C407')
  })

  it('token emitido depois do marco segue valendo', () => {
    const cut = revoke(DOC)
    // Migration 439: o `iat` tem segundos inteiros; o token do mesmo segundo do
    // marco pode ser anterior à revogação e é recusado.
    expect(staff(DOC, cut, HELPERS).output).toBe('f|f|f|f|-|-')
    expect(staff(DOC, cut - 1, HELPERS).output).toBe('f|f|f|f|-|-')
    expect(staff(DOC, cut + 1, HELPERS).output).toBe('t|t|f|f|documentacao|documentacao')
    expect(staff(DOC, cut + 1, `SELECT public.check_internal_token_cutoff()`).status).toBe(0)
    expect(staff(DOC, cut + 1, `SELECT count(*) FROM public.app_settings`).output).toBe('1')
  })

  it('com marco ativo, token sem iat numérico é recusado; usuário sem marco não muda', () => {
    revoke(DOC)
    expect(staff(DOC, null, `SELECT public.is_active_user()`).output).toBe('f')
    expect(staff(DOC, 'nao-numero', `SELECT public.is_active_user()`).output).toBe('f')

    expect(staff(FRESH, null, `SELECT public.is_active_user(), coalesce(public.current_actor_role(), '-')`).output)
      .toBe('t|operacoes')
    expect(staff(FRESH, null, `SELECT public.check_internal_token_cutoff()`).status).toBe(0)
  })

  it('o desbloqueio de CE recusa o token anterior', () => {
    const cut = revoke(DOC)
    const claims = (iat: number) => JSON.stringify({ sub: DOC, role: 'authenticated', iat })
    const stale = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `BEGIN; SET LOCAL request.jwt.claims = '${claims(cut - 60)}'; SELECT ce_unlock_private.actor(true); COMMIT;`],
    { encoding: 'utf8' })
    expect(stale.status).not.toBe(0)
    expect(stale.stderr).toContain('42501')
    expect(psql(`BEGIN; SET LOCAL request.jwt.claims = '${claims(cut + 1)}'; SELECT ce_unlock_private.actor(true); COMMIT;`))
      .toBe('documentacao')
  })

  it('rotina de serviço que age em nome do usuário revogado não é cortada', () => {
    const cut = revoke(DOC)
    // Como process_import_effect (394): dentro da função SECURITY DEFINER, troca
    // só o sub e segue com o JWT do service_role.
    const serviceJwt = JSON.stringify({ role: 'service_role', iat: cut - 86400 })
    expect(psql(`BEGIN; SET LOCAL request.jwt.claims = '${serviceJwt}'; SET LOCAL request.jwt.claim.sub = '${DOC}';
      SELECT public.is_active_user(), public.is_admin(); COMMIT;`)).toBe('t|f')
  })

  it('anon passa pela checagem sem sessão e não alcança o marco', () => {
    expect(asSession('anon', { role: 'anon' }, `SELECT public.check_internal_token_cutoff()`).status).toBe(0)
    const read = staff(FRESH, null, `SELECT count(*) FROM public.internal_credential_revocations`)
    expect(read.status).not.toBe(0)
    expect(read.error).toContain('permission denied')
    const erase = staff(DOC, Math.floor(Date.now() / 1000) - 60, `DELETE FROM public.internal_credential_revocations`)
    expect(erase.status).not.toBe(0)
    expect(erase.error).toContain('permission denied')
  })

  it('reativar o usuário não devolve a autoridade ao token anterior', () => {
    psql(`UPDATE public.user_profiles SET active = false WHERE id = '${DOC}';`)
    const cut = revoke(DOC)
    psql(`UPDATE public.user_profiles SET active = true WHERE id = '${DOC}';`)
    expect(staff(DOC, cut - 60, `SELECT public.is_active_user()`).output).toBe('f')
    expect(staff(DOC, cut + 1, `SELECT public.is_active_user()`).output).toBe('t')
  })

  it('revogar usuário inexistente falha com P0002, sem marco', () => {
    const result = asSession('service_role', null, `SELECT public.internal_revoke_sessions('${MISSING}')`)
    expect(result.status).not.toBe(0)
    expect(result.error).toContain('não encontrado')
    expect(psql(`SELECT count(*) FROM public.internal_credential_revocations WHERE user_id = '${MISSING}';`)).toBe('0')
  })
})
