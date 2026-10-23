import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-rpc-catalog.mjs')
const secretUrl = 'postgresql://postgres:senha-secreta@127.0.0.1:1/vela_test'

// psql falso que grava argv e ambiente e falha como numa conexão recusada.
// Usa shebang, então só roda onde o sistema executa script direto.
const FAKE_PSQL = `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.FAKE_PSQL_RECORD, JSON.stringify({ argv: process.argv.slice(2), env: process.env }))
process.stderr.write('psql: conexão recusada\\n')
process.exit(2)
`

test('rpc:check passa a conexão por PG* e não mostra a senha', { skip: process.platform === 'win32' && 'psql falso usa shebang' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rpc-catalog-test-'))
  try {
    writeFileSync(path.join(dir, 'psql'), FAKE_PSQL)
    chmodSync(path.join(dir, 'psql'), 0o755)
    const record = path.join(dir, 'record.json')
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        LOCAL_DATABASE_URL: secretUrl,
        DATABASE_URL: 'postgresql://remoto:senha-remota@db.example.test/postgres',
        FAKE_PSQL_RECORD: record,
      },
    })
    assert.equal(result.status, 2)
    assert.doesNotMatch(result.stdout + result.stderr, /senha-secreta|senha-remota/)
    assert.match(result.stderr, /could not connect to postgresql:\/\/postgres:\*\*\*@127\.0\.0\.1:1\/vela_test/)

    const { argv, env } = JSON.parse(readFileSync(record, 'utf8'))
    assert.doesNotMatch(argv.join(' '), /postgres(ql)?:\/\/|senha/)
    assert.equal(env.PGHOST, '127.0.0.1')
    assert.equal(env.PGPORT, '1')
    assert.equal(env.PGUSER, 'postgres')
    assert.equal(env.PGPASSWORD, 'senha-secreta')
    assert.equal(env.PGDATABASE, 'vela_test')
    assert.equal(env.LOCAL_DATABASE_URL, undefined)
    assert.equal(env.DATABASE_URL, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rpc:check ignora DATABASE_URL e usa o banco local padrão', { skip: process.platform === 'win32' && 'psql falso usa shebang' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rpc-catalog-test-'))
  try {
    writeFileSync(path.join(dir, 'psql'), FAKE_PSQL)
    chmodSync(path.join(dir, 'psql'), 0o755)
    const record = path.join(dir, 'record.json')
    const env = {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      DATABASE_URL: 'postgresql://remoto:senha-remota@db.example.test/postgres',
      FAKE_PSQL_RECORD: record,
    }
    delete env.LOCAL_DATABASE_URL
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env })
    assert.equal(result.status, 2)
    assert.doesNotMatch(result.stderr, /senha-remota|db\.example\.test/)
    const recorded = JSON.parse(readFileSync(record, 'utf8')).env
    assert.equal(recorded.PGHOST, '127.0.0.1')
    assert.equal(recorded.PGDATABASE, 'vela_test')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
