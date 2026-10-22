import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import {
  appendRunLog,
  assertExecuteAllowed,
  awsEnvironment,
  buildObjectNames,
  consumeArchive,
  heartbeatUrl,
  parseDatabaseUrl,
  parseEncryptionKey,
  pgDumpEnvironment,
  pgRestoreEnvironment,
  pingHeartbeat,
  planFor,
  targetsProduction,
  verifyArchive,
} from './backup-r2.mjs'
import { PRODUCTION_SUPABASE_PROJECT_REF } from './wait-supabase-migrations.mjs'

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

test('aceita só sslmode que exige TLS', () => {
  for (const mode of ['allow', 'prefer', 'disable']) {
    assert.throws(() => parseDatabaseUrl(`postgresql://user:pass@db.example.test/postgres?sslmode=${mode}`), new RegExp(`sslmode=${mode} e proibido`))
  }
  for (const mode of ['require', 'verify-ca', 'verify-full']) {
    assert.equal(parseDatabaseUrl(`postgresql://user:pass@db.example.test/postgres?sslmode=${mode}`).env.PGSSLMODE, mode)
  }
  assert.equal(parseDatabaseUrl('postgresql://user:pass@db.example.test/postgres').env.PGSSLMODE, 'require')
})

const inheritedSecrets = {
  PATH: '/usr/bin',
  SystemRoot: 'C:\\Windows',
  SUPABASE_DB_URL: 'postgresql://postgres:segredo-db@db.example.test/postgres',
  DATABASE_URL: 'postgresql://postgres:segredo-db@db.example.test/postgres',
  BACKUP_ENCRYPTION_KEY_HEX: 'a'.repeat(64),
  R2_ACCESS_KEY_ID: 'segredo-r2-id',
  R2_SECRET_ACCESS_KEY: 'segredo-r2',
  BETTERSTACK_HEARTBEAT_BACKUP_URL: 'https://uptime.betterstack.com/api/v1/heartbeat/segredo-hb',
  PGPASSWORD: 'segredo-pg-herdado',
  PGHOST: 'outro-host',
  AWS_SESSION_TOKEN: 'segredo-sessao-aws',
  AWS_PROFILE: 'perfil-herdado',
  GITHUB_TOKEN: 'segredo-gh',
}

test('processos filhos recebem ambiente sem segredos além do que cada um usa', () => {
  assert.deepEqual(pgRestoreEnvironment(inheritedSecrets), { PATH: '/usr/bin', SystemRoot: 'C:\\Windows' })

  const databaseEnv = parseDatabaseUrl('postgresql://postgres.ref:senha@db.example.test:5432/postgres').env
  const dump = pgDumpEnvironment(databaseEnv, inheritedSecrets)
  assert.equal(dump.PGPASSWORD, 'senha')
  assert.equal(dump.PGHOST, 'db.example.test')
  assert.doesNotMatch(JSON.stringify(dump), /segredo/)

  const aws = awsEnvironment({ accessKeyId: 'id-r2', secretAccessKey: 'chave-r2', endpoint: 'https://conta.r2.cloudflarestorage.com' }, inheritedSecrets)
  assert.doesNotMatch(JSON.stringify(aws), /segredo|perfil-herdado|outro-host/)
  assert.deepEqual(Object.keys(aws).filter((name) => name.startsWith('AWS_')).sort(), [
    'AWS_ACCESS_KEY_ID', 'AWS_EC2_METADATA_DISABLED', 'AWS_ENDPOINT_URL', 'AWS_PAGER', 'AWS_REGION', 'AWS_SECRET_ACCESS_KEY',
  ])
  assert.equal(aws.AWS_SECRET_ACCESS_KEY, 'chave-r2')
  assert.equal(aws.PATH, '/usr/bin')
})

test('URL ou ref de produção exige a liberação mesmo com outro rótulo', () => {
  const ref = PRODUCTION_SUPABASE_PROJECT_REF
  const staging = { environment: 'staging', projectRef: 'outroref', allowProduction: false }
  const direct = parseDatabaseUrl(`postgresql://postgres:senha@db.${ref}.supabase.co:5432/postgres`).env
  const pooler = parseDatabaseUrl(`postgresql://postgres.${ref}:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`).env
  const other = parseDatabaseUrl('postgresql://postgres.abcdefghijklmnopqrst:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres').env
  assert.equal(targetsProduction(staging, direct), true)
  assert.equal(targetsProduction(staging, pooler), true)
  assert.equal(targetsProduction({ ...staging, projectRef: ref }, other), true)
  assert.equal(targetsProduction({ ...staging, environment: 'production' }, other), true)
  assert.equal(targetsProduction(staging, other), false)

  const previous = process.env.BACKUP_ALLOW_PRODUCTION
  try {
    delete process.env.BACKUP_ALLOW_PRODUCTION
    assert.throws(() => assertExecuteAllowed(staging, pooler), /production bloqueada/)
    assert.throws(() => assertExecuteAllowed({ ...staging, allowProduction: true }, pooler), /production bloqueada/)
    assert.doesNotThrow(() => assertExecuteAllowed(staging, other))
    process.env.BACKUP_ALLOW_PRODUCTION = 'YES'
    assert.doesNotThrow(() => assertExecuteAllowed({ ...staging, allowProduction: true }, pooler))
  } finally {
    if (previous === undefined) delete process.env.BACKUP_ALLOW_PRODUCTION
    else process.env.BACKUP_ALLOW_PRODUCTION = previous
  }
})

test('registro da execução gira ao passar do limite', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backup-r2-test-'))
  try {
    writeFileSync(path.join(dir, 'backup-r2.log'), 'x'.repeat(256 * 1024))
    await appendRunLog(dir, 'ok: objeto')
    assert.equal(statSync(path.join(dir, 'backup-r2.log.1')).size, 256 * 1024)
    assert.match(readFileSync(path.join(dir, 'backup-r2.log'), 'utf8'), /^\S+ ok: objeto\n$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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

// No Windows o mesmo fechamento chega como EOF ("write EOF"), conforme o
// estado do pipe; foi o que derrubou o backup de 2026-10-19.
for (const code of ['EPIPE', 'EOF']) {
  test(`catálogo fecha cedo sem ${code}, mas dados posteriores ainda exigem autenticação`, async () => {
    const key = Buffer.alloc(32, 1)
    const iv = Buffer.alloc(12, 2)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(Buffer.alloc(1024 * 1024, 3)), cipher.final()])
    const tag = cipher.getAuthTag()
    async function verify(bytes) {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      const earlyClosingInput = new Writable({
        write(_chunk, _encoding, callback) {
          callback(Object.assign(new Error('catálogo já lido'), { code }))
        },
      })
      await consumeArchive(Readable.from([bytes.subarray(0, 65536), bytes.subarray(65536)]), decipher, earlyClosingInput)
    }
    await verify(encrypted)
    const corrupted = Buffer.from(encrypted)
    corrupted[corrupted.length - 1] ^= 1
    await assert.rejects(verify(corrupted), /authenticate|authentication/i)
  })
}

test('heartbeat avisa sucesso na URL e falha em /fail, sem mudar o resultado do backup', async () => {
  const base = 'https://uptime.betterstack.com/api/v1/heartbeat/abc123'
  assert.equal(heartbeatUrl(base, true), base)
  assert.equal(heartbeatUrl(base, false), `${base}/fail`)
  assert.equal(heartbeatUrl(`${base}/`, false), `${base}/fail`)
  assert.equal(heartbeatUrl(undefined, true), null)
  assert.throws(() => heartbeatUrl('http://uptime.betterstack.com/x', true), /https/)

  const previous = process.env.BETTERSTACK_HEARTBEAT_BACKUP_URL
  const originalError = console.error
  const logged = []
  console.error = (line) => logged.push(line)
  try {
    delete process.env.BETTERSTACK_HEARTBEAT_BACKUP_URL
    assert.equal(await pingHeartbeat(true, () => assert.fail('sem URL nao chama')), 'skipped')

    process.env.BETTERSTACK_HEARTBEAT_BACKUP_URL = base
    const called = []
    assert.equal(await pingHeartbeat(false, async (url) => { called.push(url); return { ok: true } }), 'sent')
    assert.deepEqual(called, [`${base}/fail`])
    assert.equal(await pingHeartbeat(true, async () => { throw new Error('rede fora') }), 'failed')
    assert.equal(await pingHeartbeat(true, async () => ({ ok: false, status: 404 })), 'failed')
    assert.doesNotMatch(logged.join('\n'), /abc123/)
  } finally {
    console.error = originalError
    if (previous === undefined) delete process.env.BETTERSTACK_HEARTBEAT_BACKUP_URL
    else process.env.BETTERSTACK_HEARTBEAT_BACKUP_URL = previous
  }
})

test('falha do pg_restore traz o motivo do stderr na mensagem', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backup-r2-test-'))
  const previous = process.env.PG_RESTORE_BIN
  try {
    const key = Buffer.alloc(32, 1)
    const iv = Buffer.alloc(12, 2)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([cipher.update(Buffer.alloc(1024, 3)), cipher.final()])
    const archive = path.join(dir, 'teste.dump.enc')
    writeFileSync(archive, Buffer.concat([Buffer.from('VELA-R2-BACKUP\0', 'ascii'), Buffer.from([1]), iv, body, cipher.getAuthTag()]))
    // O próprio node faz o papel de um pg_restore que recusa a entrada: com
    // "--list" ele escreve o motivo no stderr e sai com código diferente de 0.
    process.env.PG_RESTORE_BIN = process.execPath
    await assert.rejects(verifyArchive(archive, key), /pg_restore --list terminou com codigo \d+: .*--list/)
  } finally {
    if (previous === undefined) delete process.env.PG_RESTORE_BIN
    else process.env.PG_RESTORE_BIN = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test('execução com falha grava o motivo no registro, sem segredos', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backup-r2-test-'))
  try {
    const env = { ...process.env, R2_SECRET_ACCESS_KEY: 'segredo-r2-nao-deve-aparecer' }
    delete env.SUPABASE_DB_URL
    delete env.DATABASE_URL
    delete env.BETTERSTACK_HEARTBEAT_BACKUP_URL
    const result = spawnSync(process.execPath, [script, '--execute', '--environment', 'staging', '--project-ref', 'testref', '--output-dir', dir], { encoding: 'utf8', env })
    assert.equal(result.status, 2)
    const log = readFileSync(path.join(dir, 'backup-r2.log'), 'utf8')
    assert.match(log, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z falha: SUPABASE_DB_URL\/DATABASE_URL nao e uma URL PostgreSQL valida\.\n$/)
    assert.doesNotMatch(log, /segredo-r2/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('execução com URL de produção sob outro rótulo é bloqueada', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backup-r2-test-'))
  try {
    const env = { ...process.env, SUPABASE_DB_URL: `postgresql://postgres.${PRODUCTION_SUPABASE_PROJECT_REF}:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres` }
    delete env.BACKUP_ALLOW_PRODUCTION
    delete env.BETTERSTACK_HEARTBEAT_BACKUP_URL
    const result = spawnSync(process.execPath, [script, '--execute', '--environment', 'staging', '--project-ref', 'testref', '--output-dir', dir], { encoding: 'utf8', env })
    assert.equal(result.status, 2)
    assert.match(readFileSync(path.join(dir, 'backup-r2.log'), 'utf8'), /falha: production bloqueada/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Binários falsos de pg_dump, pg_restore e aws gravam o argv e o ambiente que
// receberam. Usam shebang, então só rodam onde o sistema executa script direto.
const FAKE_BIN = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const role = path.basename(process.argv[1])
fs.appendFileSync(path.join(process.env.FAKE_RECORD_DIR, role + '.jsonl'), JSON.stringify({ argv: process.argv.slice(2), env: process.env }) + '\\n')
if (role === 'pg_dump') process.stdout.write(Buffer.alloc(4096, 7))
if (role === 'pg_restore') { process.stdin.resume(); process.stdin.on('end', () => process.exit(0)) }
if (role === 'aws' && process.env.FAKE_AWS_FAIL === '1') { process.stderr.write('upload recusado'); process.exit(1) }
`

function runFakeBackup(dir, extraEnv = {}) {
  const bin = path.join(dir, 'bin')
  const out = path.join(dir, 'out')
  const record = path.join(dir, 'record')
  for (const folder of [bin, out, record]) {
    rmSync(folder, { recursive: true, force: true })
    mkdirSync(folder)
  }
  for (const role of ['pg_dump', 'pg_restore', 'aws']) {
    writeFileSync(path.join(bin, role), FAKE_BIN)
    chmodSync(path.join(bin, role), 0o755)
  }
  const env = {
    ...process.env,
    ...inheritedSecrets,
    PATH: process.env.PATH,
    SUPABASE_DB_URL: 'postgresql://postgres.abcdefghijklmnopqrst:senha-db@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
    R2_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
    R2_BUCKET: 'vela-backup',
    PG_DUMP_BIN: path.join(bin, 'pg_dump'),
    PG_RESTORE_BIN: path.join(bin, 'pg_restore'),
    AWS_BIN: path.join(bin, 'aws'),
    FAKE_RECORD_DIR: record,
    ...extraEnv,
  }
  delete env.BETTERSTACK_HEARTBEAT_BACKUP_URL
  delete env.BACKUP_ALLOW_PRODUCTION
  const result = spawnSync(process.execPath, [script, '--execute', '--environment', 'staging', '--project-ref', 'testref', '--output-dir', out], { encoding: 'utf8', env })
  const calls = (role) => existsSync(path.join(record, `${role}.jsonl`))
    ? readFileSync(path.join(record, `${role}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    : []
  return { result, out, calls }
}

test('execução completa: filhos sem segredos e cópia local apagada depois do upload', { skip: process.platform === 'win32' && 'binários falsos usam shebang' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backup-r2-test-'))
  try {
    const ok = runFakeBackup(dir)
    assert.equal(ok.result.status, 0, ok.result.stderr)
    assert.deepEqual(readdirSync(ok.out), ['backup-r2.log'])
    assert.match(readFileSync(path.join(ok.out, 'backup-r2.log'), 'utf8'), /ok: vela\/database\/staging\/testref\/\d{8}T\d{6}Z\.dump\.enc\n$/)

    const [dump] = ok.calls('pg_dump')
    assert.equal(dump.env.PGPASSWORD, 'senha-db')
    assert.doesNotMatch(JSON.stringify(dump.env), /segredo|postgresql:\/\//)
    const [restore] = ok.calls('pg_restore')
    assert.doesNotMatch(JSON.stringify(restore.env), /segredo|senha-db|postgresql:\/\/|"PG[A-Z]+"/)
    const uploads = ok.calls('aws')
    assert.equal(uploads.length, 2)
    for (const upload of uploads) {
      assert.equal(upload.env.AWS_SECRET_ACCESS_KEY, 'segredo-r2')
      assert.equal(upload.env.AWS_ACCESS_KEY_ID, 'segredo-r2-id')
      delete upload.env.AWS_SECRET_ACCESS_KEY
      delete upload.env.AWS_ACCESS_KEY_ID
      assert.doesNotMatch(JSON.stringify(upload.env), /segredo|senha-db|perfil-herdado|postgresql:\/\//)
    }

    // Upload recusado: dump e manifesto ficam para o operador reenviar.
    const failed = runFakeBackup(dir, { FAKE_AWS_FAIL: '1' })
    assert.equal(failed.result.status, 2)
    const kept = readdirSync(failed.out).sort()
    assert.equal(kept.length, 3)
    assert.match(kept.join(' '), /\.dump\.enc .*\.manifest\.json/)
    assert.match(readFileSync(path.join(failed.out, 'backup-r2.log'), 'utf8'), /falha: upload R2 falhou com codigo 1: upload recusado/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log('OK — backup-r2: contratos de segurança e dry-run conferidos')
