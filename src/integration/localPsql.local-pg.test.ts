import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { execPsql, parsePsqlArgs, spawnPsql } from './localPsql'

// Contrato do helper de conexão reaproveitada: para cada caso, a mesma saída,
// o mesmo erro e o mesmo status do binário `psql`. Este é o único arquivo das
// suítes que chama o `psql` de propósito, como referência.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function probe() {
  if (!enabled) return false
  try {
    return execPsql(['-X', '-At', '-d', databaseUrl, '-c', 'SELECT 1'], { encoding: 'utf8' }).trim() === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(probe, 'Postgres local acessível em LOCAL_DATABASE_URL')

type Case = { name: string; args: string[]; input?: string }

const base = ['-X', '-v', 'ON_ERROR_STOP=1', '-At']
const scriptDir = mkdtempSync(join(tmpdir(), 'local-psql-'))
const scriptPath = join(scriptDir, 'script.sql')
writeFileSync(scriptPath, `SELECT 'arquivo';\nSELECT 1/0;\nSELECT 'depois';\n`)

const cases: Case[] = [
  { name: 'tipos como texto', args: [...base, '-q', '-d', databaseUrl, '-c', `SELECT true, false, 1.50::numeric, NULL, 'a|b', ARRAY[1,2], '{"k":1}'::jsonb, '2026-10-15'::date, 'x'::bytea, E'linha\\nnova';`] },
  { name: 'várias linhas', args: [...base, '-q', '-d', databaseUrl, '-c', 'SELECT g, g * 2 FROM generate_series(1, 3) g;'] },
  { name: 'zero linhas', args: [...base, '-q', '-d', databaseUrl, '-c', 'SELECT 1 WHERE false;'] },
  { name: 'vários comandos, -q', args: [...base, '-q', '-d', databaseUrl, '-c', `SET request.jwt.claim.role = 'service_role'; SELECT current_setting('request.jwt.claim.role'); SELECT 2;`] },
  { name: 'vários comandos sem -q mostra etiquetas', args: [...base, '-d', databaseUrl, '-c', `BEGIN; SET LOCAL ROLE authenticated; SELECT current_user; CREATE TEMP TABLE t_psql (id int); INSERT INTO t_psql VALUES (1), (2) RETURNING id; UPDATE t_psql SET id = id; COMMIT;`] },
  { name: 'erro de função', args: [...base, '-q', '-d', databaseUrl, '-c', 'SELECT 1; SELECT 1/0;'] },
  { name: 'erro com DETAIL, HINT e CONTEXT', args: [...base, '-q', '-d', databaseUrl, '-c', `DO $$ BEGIN RAISE EXCEPTION 'não pode ser apagada (TRUNCATE)' USING DETAIL = 'detalhe', HINT = 'dica'; END $$;`] },
  { name: 'erro verbose', args: [...base, '-v', 'VERBOSITY=verbose', '-q', '-d', databaseUrl, '-c', `DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'falhou'; END $$;`] },
  { name: 'erro de sintaxe com posição', args: [...base, '-q', '-d', databaseUrl, '-c', 'SELECT 1;\nSELEC 2;'] },
  { name: 'erro de restrição verbose', args: [...base, '-v', 'VERBOSITY=verbose', '-q', '-d', databaseUrl, '-c', 'CREATE TEMP TABLE t_uq (id int PRIMARY KEY); INSERT INTO t_uq VALUES (1), (1);'] },
  { name: 'avisos', args: [...base, '-q', '-d', databaseUrl, '-c', `DO $$ BEGIN RAISE NOTICE 'aviso %', 1; RAISE WARNING 'cuidado' USING DETAIL = 'd'; END $$; SELECT 'ok';`] },
  { name: 'script por stdin', args: ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-f', '-'], input: `SELECT 'a;b';\n-- comentário; aqui\nSELECT $f$ x; y $f$;\nDO $$ BEGIN RAISE NOTICE 'n'; END $$;\nSELECT 1/0;\nSELECT 'não roda';\n` },
  { name: 'stdin sem -f', args: [...base, '-q', '-d', databaseUrl], input: `CREATE TEMP TABLE t_stdin (v text);\nINSERT INTO t_stdin VALUES ('it''s');\nSELECT v FROM t_stdin;\n` },
  { name: 'stdin: erro não desfaz comando anterior', args: [...base, '-q', '-d', databaseUrl], input: `CREATE TEMP TABLE t_auto (v int);\nINSERT INTO t_auto VALUES (1);\nSELECT 1/0;\n` },
  { name: 'arquivo', args: [...base, '-q', '-d', databaseUrl, '-f', scriptPath] },
]

describeLocal('localPsql imita o psql', () => {
  it.each(cases)('$name', ({ args, input }) => {
    const options = { encoding: 'utf8' as const, input }
    const real = spawnSync('psql', args, options)
    const emulated = spawnPsql(args, options)
    // O número do schema temporário depende da sessão, não do helper.
    const shape = (run: { status: number | null; stdout: string; stderr: string }) =>
      ({ status: run.status, stdout: run.stdout, stderr: run.stderr.replace(/pg_temp_\d+/g, 'pg_temp_N') })
    expect(shape(emulated)).toEqual(shape(real))
  })

  it('execPsql lança como execFileSync, com o stderr na mensagem', () => {
    const args = [...base, '-q', '-d', databaseUrl, '-c', 'SELECT 1/0;']
    const realError = (() => { try { execFileSync('psql', args, { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { return error as { status: number; stderr: string } } })()
    expect(() => execPsql(args, { encoding: 'utf8' })).toThrow(/division by zero|divisão por zero/)
    try {
      execPsql(args, { encoding: 'utf8' })
    } catch (error) {
      const { status, stderr } = error as { status: number; stderr: string }
      expect({ status, stderr }).toEqual({ status: realError?.status, stderr: realError?.stderr })
    }
    expect(execPsql([...base, '-d', databaseUrl, '-c', 'SELECT 7'])).toEqual(Buffer.from('7\n'))
  })

  it('cada chamada começa numa sessão limpa', () => {
    const q = (sql: string) => execPsql([...base, '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
    const pid = q('SELECT pg_backend_pid();')
    q(`SET session_replication_role = replica; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'x', false); CREATE TEMP TABLE captured (v int); SELECT pg_advisory_lock(4242); PREPARE p AS SELECT 1;`)
    q('BEGIN; CREATE TEMP TABLE aberta (v int);')
    expect(() => q('BEGIN; SELECT 1/0;')).toThrow()
    expect(q('SELECT pg_backend_pid();')).toBe(pid)
    expect(q(`SELECT current_user, coalesce(current_setting('request.jwt.claim.sub', true), ''), current_setting('session_replication_role'), to_regclass('pg_temp.captured') IS NULL, to_regclass('pg_temp.aberta') IS NULL, (SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), (SELECT count(*) FROM pg_prepared_statements);`))
      .toBe('postgres||origin|t|t|0|0')
  })

  it('limite conhecido: variável personalizada já usada fica como texto vazio', () => {
    const q = (sql: string) => execPsql([...base, '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
    q(`SELECT set_config('vela.limite_helper', 'on', false);`)
    expect(q(`SELECT current_setting('vela.limite_helper', true) IS NULL, current_setting('vela.limite_helper', true);`)).toBe('f|\n')
    expect(execFileSync('psql', [...base, '-q', '-d', databaseUrl, '-c', `SELECT current_setting('vela.limite_helper', true) IS NULL;`], { encoding: 'utf8' })).toBe('t\n')
  })

  it('cai no binário quando não imita o argumento', () => {
    expect(parsePsqlArgs(['-X', '-q', '-d', databaseUrl, '-c', 'SELECT 1'], undefined)).toBeNull()
    expect(execPsql(['-X', '-q', '-d', databaseUrl, '-c', 'SELECT 1'], { encoding: 'utf8' })).toMatch(/\(1 row\)/)
  })
})
