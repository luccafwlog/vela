import { spawn } from 'node:child_process'
import { execPsql } from './localPsql'
import { afterEach, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 413 (auditoria run-3, pendência P3; ADR 0049): o balde de login do
// Portal reserva a tentativa sob trava do CNPJ, então pedidos simultâneos não
// passam das 5 falhas em 15 minutos, como passavam com consulta e registro em
// passos separados.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const CNPJ = syntheticCnpj(410001)

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function migration410Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.portal_login_reserve_attempt(text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

// Uma reserva como a Edge Function faz, numa conexão própria, segurando a
// transação um pouco para as outras chegarem enquanto ela está aberta.
function reserveConcurrently(): Promise<string> {
  const child = spawn('psql', ['-X', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE service_role; SELECT coalesce(public.portal_login_reserve_attempt('${CNPJ}')::text, 'bloqueado'); SELECT pg_sleep(0.2); COMMIT;`],
  { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (chunk) => { out += String(chunk) })
  return new Promise((resolve) => child.on('close', () => resolve(out.trim().split('\n')[0] ?? '')))
}

const failures = () => psql(`SELECT count(*) FROM public.portal_login_attempts
  WHERE cnpj_hash = encode(extensions.digest('${CNPJ}', 'sha256'), 'hex') AND source = 'login' AND succeeded = false;`)

const describeLocal = describeWithProbe(migration410Applied, 'migration410Applied (reserva atômica do balde de login)')

describeLocal('413 — reserva atômica no balde de login do Portal', () => {
  afterEach(() => {
    psql(`DELETE FROM public.portal_login_attempts WHERE cnpj_hash = encode(extensions.digest('${CNPJ}', 'sha256'), 'hex');`)
  })

  it('dez tentativas simultâneas para o mesmo CNPJ admitem no máximo cinco', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveConcurrently()))
    expect(results.filter((r) => r !== 'bloqueado' && r !== '')).toHaveLength(5)
    expect(results.filter((r) => r === 'bloqueado')).toHaveLength(5)
    expect(failures()).toBe('5')
  }, 30_000)

  it('sucesso tira a reserva das falhas; falha do Auth a apaga; senha errada a mantém', () => {
    const asService = (sql: string) => psql(`BEGIN; SET LOCAL ROLE service_role; ${sql}; COMMIT;`)
    const ok = asService(`SELECT public.portal_login_reserve_attempt('${CNPJ}')`)
    const upstream = asService(`SELECT public.portal_login_reserve_attempt('${CNPJ}')`)
    asService(`SELECT public.portal_login_reserve_attempt('${CNPJ}')`)
    asService(`SELECT public.portal_login_settle_attempt(${ok}, 'success')`)
    asService(`SELECT public.portal_login_settle_attempt(${upstream}, 'void')`)
    expect(failures()).toBe('1')
    expect(psql(`SELECT count(*) FROM public.portal_login_attempts WHERE id = ${ok} AND succeeded;`)).toBe('1')
  })

  it('só service_role reserva', () => {
    for (const role of ['anon', 'authenticated']) {
      expect(psql(`SELECT has_function_privilege('${role}', 'public.portal_login_reserve_attempt(text)', 'EXECUTE')
        OR has_function_privilege('${role}', 'public.portal_login_settle_attempt(bigint,text)', 'EXECUTE');`)).toBe('f')
    }
  })
})
