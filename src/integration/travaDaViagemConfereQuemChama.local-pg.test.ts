import { spawn } from 'node:child_process'
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 421 (auditoria run-3, pendência P5): a trava de importação da
// Viagem confere quem chama antes de entrar na fila. Sessão sem permissão é
// recusada na hora, mesmo com a trava ocupada; usuário interno ativo continua
// esperando a vez, então a trava segue serializando as importações.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const VOYAGE_ID = 409001
const STAFF = '40900000-0000-4000-8000-000000000001'
const ORPHAN = '40900000-0000-4000-8000-000000000002'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function migration409Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._assert_import_caller()') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const GRANITO = `SELECT public.import_granite_manifest_transactional(${VOYAGE_ID}, 'V409', 'BRVIX', 'BRSSZ', 1, 1,
  auth.uid(), '[{"bl_id":"C409-BL"}]'::jsonb, NULL, NULL, NULL)`

function callAs(sub: string, sql: string) {
  const started = Date.now()
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL lock_timeout = '1s';
     SET LOCAL request.jwt.claims = '${JSON.stringify({ sub, role: 'authenticated' })}'; ${sql}; COMMIT;`],
  { encoding: 'utf8' })
  return { status: result.status, error: result.stderr ?? '', ms: Date.now() - started }
}

// Segura import_voyage:<id> numa sessão à parte por `seconds`.
function holdVoyageLock(seconds: number): Promise<void> {
  const child = spawn('psql', ['-X', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('import_voyage:${VOYAGE_ID}', 0)); SELECT pg_sleep(${seconds}); COMMIT;`],
  { stdio: 'ignore' })
  return new Promise((resolve) => child.on('close', () => resolve()))
}

async function lockIsHeld(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (psql(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted;`) !== '0') return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('a sessão de apoio não pegou a trava')
}

const describeLocal = describeWithProbe(migration409Applied, 'migration409Applied (trava da Viagem confere quem chama)')

describeLocal('421 — trava da Viagem confere quem chama', () => {
  beforeAll(() => {
    psql(`INSERT INTO auth.users (id, email) VALUES ('${STAFF}', 'c409-staff@example.test'), ('${ORPHAN}', 'c409-orphan@example.test')
      ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${STAFF}', 'Documentação C409', 'documentacao', true)
      ON CONFLICT (id) DO UPDATE SET active = true;`)
  })

  afterAll(() => {
    spawnPsql(['-X', '-d', databaseUrl, '-c', `DELETE FROM public.user_profiles WHERE id = '${STAFF}';
      DELETE FROM auth.users WHERE id IN ('${STAFF}', '${ORPHAN}');`], { encoding: 'utf8' })
  })

  it('com a trava ocupada, sessão sem permissão é recusada na hora; usuário ativo espera a vez', async () => {
    const holder = holdVoyageLock(4)
    await lockIsHeld()

    const orphan = callAs(ORPHAN, GRANITO)
    expect(orphan.status).not.toBe(0)
    expect(orphan.error).toContain('42501')

    const staff = callAs(STAFF, GRANITO)
    expect(staff.status).not.toBe(0)
    expect(staff.error).toContain('55P03')
    expect(staff.ms).toBeGreaterThanOrEqual(900)

    await holder
  }, 20_000)

  it('sem requisição (cron, migration) e service_role não são barrados', () => {
    expect(psql(`BEGIN; SELECT 'ok' FROM (SELECT public._lock_import_voyages(ARRAY[${VOYAGE_ID}]::bigint[])) AS chamada; COMMIT;`)).toBe('ok')
    expect(psql(`BEGIN; SET LOCAL request.jwt.claim.role = 'service_role';
      SET LOCAL request.jwt.claims = '{"role":"service_role"}';
      SELECT 'ok' FROM (SELECT public._lock_import_voyages(ARRAY[${VOYAGE_ID}]::bigint[])) AS chamada; COMMIT;`)).toBe('ok')
    const refused = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl, '-c',
      `BEGIN; SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: ORPHAN, role: 'authenticated' })}';
       SELECT public._lock_import_voyages_of_bls(ARRAY[${VOYAGE_ID}]::bigint[], ARRAY['C409-BL']); COMMIT;`],
    { encoding: 'utf8' })
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('42501')
  })
})
