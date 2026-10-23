import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 423 (auditoria run-3, achado C6): o evento de provisionamento
// gravado pelas Edge Functions (service_role) leva o autor que o getUser()
// confirmou. Sessão de usuário não executa a função nem escolhe outro autor.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const STAFF = '41100000-0000-4000-8000-000000000001'
const CUSTOMER_ID = 411001

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function migration411Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._portal_log_event(bigint,bigint,bigint,text,text,text,text,text,text,text,uuid)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const logAs = (settings: string, actor: string) => `BEGIN; ${settings}
  SELECT public._portal_log_event(${CUSTOMER_ID}, (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID}),
    NULL, 'aguardando_analise', 'aguardando_analise', 'ativo', 'suspenso', 'documentacao', 'C411 teste', NULL, ${actor});
  COMMIT;`

const lastActor = () => psql(`SELECT coalesce(actor_id::text, '-') FROM public.portal_provisioning_events
  WHERE customer_id = ${CUSTOMER_ID} ORDER BY id DESC LIMIT 1;`)

const describeLocal = describeWithProbe(migration411Applied, 'migration411Applied (autor dos eventos do Portal)')

describeLocal('423 — autor dos eventos do Portal gravados pelas Edges', () => {
  beforeAll(() => {
    psql(`INSERT INTO auth.users (id, email) VALUES ('${STAFF}', 'c411-staff@example.test') ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${STAFF}', 'Documentação C411', 'documentacao', true)
      ON CONFLICT (id) DO UPDATE SET active = true;`)
    psql(`INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER_ID}, '${syntheticCnpj(411001)}', 'Cliente C411') ON CONFLICT (id) DO NOTHING;`)
  })

  afterAll(() => {
    spawnPsql(['-X', '-d', databaseUrl, '-c', `DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};
      DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};
      DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
      DELETE FROM public.user_profiles WHERE id = '${STAFF}'; DELETE FROM auth.users WHERE id = '${STAFF}';`], { encoding: 'utf8' })
  })

  it('service_role grava o autor confirmado pela Edge', () => {
    psql(logAs(`SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role = 'service_role';
      SET LOCAL request.jwt.claims = '{"role":"service_role"}';`, `'${STAFF}'`))
    expect(lastActor()).toBe(STAFF)
  })

  it('chamada sem autor (as demais Edges) continua valendo, sem autor', () => {
    psql(logAs(`SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role = 'service_role';`, 'NULL'))
    expect(lastActor()).toBe('-')
  })

  it('sessão de usuário não executa a função', () => {
    const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      logAs(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: STAFF, role: 'authenticated' })}';`, `'${STAFF}'`)],
    { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('permission denied')
  })

  it('fora do service_role o autor informado é ignorado: vale a sessão', () => {
    // Como portal_cancel_invite e as outras RPCs, que chamam a função com a sessão do usuário.
    psql(logAs(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: STAFF, role: 'authenticated' })}';`,
      `'00000000-0000-4000-8000-0000000000aa'`))
    expect(lastActor()).toBe(STAFF)
  })
})
