import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildObjectNames, parseDatabaseUrl, parseEncryptionKey, planFor } from './backup-r2.mjs'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backup-r2.mjs')

test('dry-run nao acessa banco, R2 ou arquivos e nao imprime segredos', () => {
  const secret = 'postgresql://postgres:nao-deve-aparecer@db.example.test:5432/postgres'
  const result = spawnSync(process.execPath, [script, '--dry-run', '--environment', 'staging', '--project-ref', 'testref'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_DB_URL: secret,
      BACKUP_ENCRYPTION_KEY_HEX: 'a'.repeat(64),
      R2_SECRET_ACCESS_KEY: 'segredo-r2-nao-deve-aparecer',
    },
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /"mode": "dry-run"/)
  assert.match(result.stdout, /"nao acessa R2"/)
  assert.doesNotMatch(result.stdout, /nao-deve-aparecer|segredo-r2/)
  assert.equal(result.stderr, '')
})

test('parseia URL PostgreSQL sem expor a URL nos argumentos do pg_dump', () => {
  const parsed = parseDatabaseUrl('postgresql://postgres.user:p%40ss@db.example.test:5432/postgres?sslmode=require')
  assert.deepEqual(parsed.env, {
    PGHOST: 'db.example.test',
    PGPORT: '5432',
    PGUSER: 'postgres.user',
    PGPASSWORD: 'p@ss',
    PGDATABASE: 'postgres',
    PGSSLMODE: 'require',
  })
  assert.throws(() => parseDatabaseUrl('postgresql://user:pass@db.example.test/postgres?sslmode=disable'), /sslmode=disable/)
})

test('exige uma chave AES de 32 bytes em hexadecimal', () => {
  assert.equal(parseEncryptionKey('ab'.repeat(32)).length, 32)
  assert.throws(() => parseEncryptionKey('not-a-key'), /64 digitos/)
})

test('nomeia objetos por ambiente, projeto e instante sem credenciais', () => {
  const names = buildObjectNames({
    createdAt: new Date('2026-09-22T12:34:56.789Z'),
    environment: 'staging',
    projectRef: 'testref',
    prefix: 'vela/database',
  })
  assert.equal(names.dumpKey, 'vela/database/staging/testref/20260922T123456Z.dump.enc')
  assert.equal(names.manifestKey, 'vela/database/staging/testref/20260922T123456Z.manifest.json')
  assert.doesNotMatch(JSON.stringify(planFor({
    mode: 'dry-run', environment: 'staging', projectRef: 'testref', prefix: 'vela/database',
    retentionDays: 90, outputDir: '.tmp',
  })), /password|segredo|postgresql:\/\//i)
})

console.log('OK — backup-r2: contratos de segurança e dry-run conferidos')
