import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { buildObjectNames, consumeArchive, heartbeatUrl, parseDatabaseUrl, parseEncryptionKey, pingHeartbeat, planFor, verifyArchive } from './backup-r2.mjs'

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

console.log('OK — backup-r2: contratos de segurança e dry-run conferidos')
