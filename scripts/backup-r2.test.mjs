import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBackupTaskCommand, runBackupTask } from './backup-r2-task.mjs'
import { awsChildEnvironment, buildObjectNames, executeBackup, parseDatabaseUrl, parseEncryptionKey, planFor, taskBackupEnvironment, verifyR2Object } from './backup-r2.mjs'

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
  assert.match(result.stdout, /"baixa o dump cifrado enviado e compara tamanho\/SHA-256 antes de publicar o manifesto"/)
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

test('ambiente da AWS CLI recebe apenas configuracao necessaria e credenciais R2', () => {
  const env = awsChildEnvironment({
    accessKeyId: 'r2-access',
    secretAccessKey: 'r2-secret',
    endpoint: 'https://example.r2.cloudflarestorage.com',
  }, {
    PATH: 'C:\\tools',
    TEMP: 'C:\\temp',
    SUPABASE_DB_URL: 'postgresql://private',
    BACKUP_ENCRYPTION_KEY_HEX: 'a'.repeat(64),
    DATABASE_URL: 'postgresql://private-too',
    AWS_PROFILE: 'unapproved-profile',
  })

  assert.equal(env.PATH, 'C:\\tools')
  assert.equal(env.TEMP, 'C:\\temp')
  assert.equal(env.AWS_ACCESS_KEY_ID, 'r2-access')
  assert.equal(env.AWS_SECRET_ACCESS_KEY, 'r2-secret')
  assert.equal(env.AWS_ENDPOINT_URL, 'https://example.r2.cloudflarestorage.com')
  assert.equal(env.SUPABASE_DB_URL, undefined)
  assert.equal(env.BACKUP_ENCRYPTION_KEY_HEX, undefined)
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.AWS_PROFILE, undefined)
})

test('runner do Windows injeta credenciais do Credential Manager sem alterar alvos fixos de producao', () => {
  const environment = taskBackupEnvironment({
    databaseUrl: 'postgresql://backup:db-secret@db.example.test:5432/postgres?sslmode=require',
    encryptionKeyHex: 'ab'.repeat(32),
    r2AccessKeyId: 'r2-access-secret',
    r2SecretAccessKey: 'r2-secret-secret',
  }, {
    endpoint: 'https://b9f47a26b8f708444419dac863a54cd4.r2.cloudflarestorage.com',
    bucket: 'vela-database-backups',
    projectRef: 'fgmkhbzhaeebrsizwccx',
  }, {
    PATH: 'C:\\tools',
    R2_BUCKET: 'wrong-bucket',
    SUPABASE_PROJECT_REF: 'wrong-project',
    BACKUP_ALLOW_PRODUCTION: 'NO',
    DATABASE_URL: 'postgresql://unrelated:secret@db.example.test/postgres',
    AWS_PROFILE: 'unapproved-profile',
    NODE_OPTIONS: '--require=untrusted.js',
  })

  assert.equal(environment.SUPABASE_DB_URL, 'postgresql://backup:db-secret@db.example.test:5432/postgres?sslmode=require')
  assert.equal(environment.BACKUP_ENCRYPTION_KEY_HEX, 'ab'.repeat(32))
  assert.equal(environment.R2_ACCESS_KEY_ID, 'r2-access-secret')
  assert.equal(environment.R2_SECRET_ACCESS_KEY, 'r2-secret-secret')
  assert.equal(environment.R2_ENDPOINT, 'https://b9f47a26b8f708444419dac863a54cd4.r2.cloudflarestorage.com')
  assert.equal(environment.R2_BUCKET, 'vela-database-backups')
  assert.equal(environment.SUPABASE_PROJECT_REF, 'fgmkhbzhaeebrsizwccx')
  assert.equal(environment.BACKUP_ENVIRONMENT, 'production')
  assert.equal(environment.BACKUP_ALLOW_PRODUCTION, 'YES')
  assert.equal(environment.PATH, 'C:\\tools')
  assert.equal(environment.DATABASE_URL, undefined)
  assert.equal(environment.AWS_PROFILE, undefined)
  assert.equal(environment.NODE_OPTIONS, undefined)
})

test('runner do Windows recusa credencial vazia e endpoint ou bucket ausente', () => {
  const secrets = {
    databaseUrl: 'postgresql://backup:db-secret@db.example.test:5432/postgres?sslmode=require',
    encryptionKeyHex: 'ab'.repeat(32),
    r2AccessKeyId: 'r2-access-secret',
    r2SecretAccessKey: 'r2-secret-secret',
  }
  assert.throws(() => taskBackupEnvironment({ ...secrets, r2SecretAccessKey: '' }, {
    endpoint: 'https://b9f47a26b8f708444419dac863a54cd4.r2.cloudflarestorage.com', bucket: 'vela-database-backups', projectRef: 'fgmkhbzhaeebrsizwccx',
  }), /r2SecretAccessKey/)
  assert.throws(() => taskBackupEnvironment(secrets, {
    endpoint: '', bucket: 'vela-database-backups', projectRef: 'fgmkhbzhaeebrsizwccx',
  }), /endpoint/)
  assert.throws(() => taskBackupEnvironment({ ...secrets, databaseUrl: 'postgresql://backup:password@host/postgres?sslmode=disable' }, {
    endpoint: 'https://b9f47a26b8f708444419dac863a54cd4.r2.cloudflarestorage.com', bucket: 'vela-database-backups', projectRef: 'fgmkhbzhaeebrsizwccx',
  }), /sslmode=disable/)
})

test('agendador executa somente o backup de producao explicitamente protegido', () => {
  assert.deepEqual(buildBackupTaskCommand('C:\\repo\\scripts\\backup-r2.mjs', 'fgmkhbzhaeebrsizwccx'), [
    'C:\\repo\\scripts\\backup-r2.mjs',
    '--execute',
    '--allow-production',
    '--environment',
    'production',
    '--project-ref',
    'fgmkhbzhaeebrsizwccx',
  ])
  assert.throws(() => buildBackupTaskCommand('backup-r2.mjs', 'invalid'), /caminho absoluto|projectRef/i)
})

test('runner passa credenciais somente no ambiente filtrado, nunca nos argumentos do processo', () => {
  let invocation
  const source = {
    BACKUP_TASK_DATABASE_URL: 'postgresql://backup:db-secret@db.example.test:5432/postgres?sslmode=require',
    BACKUP_TASK_ENCRYPTION_KEY_HEX: 'ab'.repeat(32),
    BACKUP_TASK_R2_ACCESS_KEY_ID: 'access-secret',
    BACKUP_TASK_R2_SECRET_ACCESS_KEY: 'r2-secret',
    BACKUP_TASK_R2_ENDPOINT: 'https://b9f47a26b8f708444419dac863a54cd4.r2.cloudflarestorage.com',
    BACKUP_TASK_R2_BUCKET: 'vela-database-backups',
    PATH: 'C:\\node;C:\\windows',
    AWS_PROFILE: 'unapproved-profile',
  }
  const status = runBackupTask({
    source,
    invoke: (executable, args, options) => {
      invocation = { executable, args, options }
      return { status: 0, error: null }
    },
  })

  assert.equal(status, 0)
  assert.ok(invocation.args.includes('--allow-production'))
  assert.equal(invocation.args.some((arg) => /db-secret|access-secret|r2-secret|ab{32}/.test(arg)), false)
  assert.equal(invocation.options.env.SUPABASE_DB_URL, source.BACKUP_TASK_DATABASE_URL)
  assert.equal(invocation.options.env.BACKUP_ENCRYPTION_KEY_HEX, source.BACKUP_TASK_ENCRYPTION_KEY_HEX)
  assert.equal(invocation.options.env.R2_ACCESS_KEY_ID, source.BACKUP_TASK_R2_ACCESS_KEY_ID)
  assert.equal(invocation.options.env.R2_SECRET_ACCESS_KEY, source.BACKUP_TASK_R2_SECRET_ACCESS_KEY)
  assert.equal(invocation.options.env.BACKUP_TASK_DATABASE_URL, undefined)
  assert.equal(invocation.options.env.AWS_PROFILE, undefined)
})

test('CredMan no Windows lê e grava somente uma credencial sintética e a remove ao final', { skip: process.platform !== 'win32' }, () => {
  const wrapper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backup-r2-task.ps1')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', wrapper, '-SelfTest'], {
    encoding: 'utf8',
    timeout: 15000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'OK CredMan synthetic credential round-trip; temporary target removed.')
  assert.equal(result.stderr, '')
})

test('confirma que o download remoto do objeto cifrado corresponde ao artefato local', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-r2-test-'))
  const localPath = path.join(directory, 'backup.dump.enc')
  const bytes = Buffer.from('artefato cifrado de teste')
  await writeFile(localPath, bytes)
  let requested
  try {
    await verifyR2Object({
      filePath: localPath,
      objectKey: 'vela/database/staging/testref/backup.dump.enc',
      config: { bucket: 'vela-test', endpoint: 'https://example.r2.cloudflarestorage.com' },
      download: async ({ objectKey, destination }) => {
        requested = objectKey
        await writeFile(destination, bytes)
      },
    })
    assert.equal(requested, 'vela/database/staging/testref/backup.dump.enc')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('falha se o objeto R2 nao existir ou o download estiver ausente', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-r2-test-'))
  const localPath = path.join(directory, 'backup.dump.enc')
  await writeFile(localPath, 'artefato local')
  try {
    await assert.rejects(
      verifyR2Object({
        filePath: localPath,
        objectKey: 'backup.dump.enc',
        config: { bucket: 'vela-test', endpoint: 'https://example.r2.cloudflarestorage.com' },
        download: async () => { throw new Error('objeto inexistente') },
      }),
      /objeto inexistente/,
    )
    await assert.rejects(
      verifyR2Object({
        filePath: localPath,
        objectKey: 'backup.dump.enc',
        config: { bucket: 'vela-test', endpoint: 'https://example.r2.cloudflarestorage.com' },
        download: async ({ destination }) => { await writeFile(destination, 'parcial') },
      }),
      /tamanho divergente/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('falha se o download tiver mesmo tamanho mas bytes diferentes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-r2-test-'))
  const localPath = path.join(directory, 'backup.dump.enc')
  await writeFile(localPath, 'local')
  try {
    await assert.rejects(
      verifyR2Object({
        filePath: localPath,
        objectKey: 'backup.dump.enc',
        config: { bucket: 'vela-test', endpoint: 'https://example.r2.cloudflarestorage.com' },
        download: async ({ destination }) => { await writeFile(destination, 'remot') },
      }),
      /SHA-256 divergente/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('remove dump local e manifesto somente depois que os dois objetos foram enviados e validados no R2', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'vela-r2-cleanup-test-'))
  const originalEnvironment = { ...process.env }
  Object.assign(process.env, {
    SUPABASE_DB_URL: 'postgresql://backup:synthetic@db.example.test:5432/postgres?sslmode=require',
    BACKUP_ENCRYPTION_KEY_HEX: 'a'.repeat(64),
    BACKUP_ALLOW_PRODUCTION: 'YES',
    R2_ENDPOINT: 'https://b9f47a26b8f708444419dac863a54cd4.r2.cloudflarestorage.com',
    R2_BUCKET: 'vela-test-backups',
    R2_ACCESS_KEY_ID: 'synthetic-access',
    R2_SECRET_ACCESS_KEY: 'synthetic-secret',
  })
  const uploads = []
  const log = console.log
  console.log = () => {}
  try {
    await executeBackup({
      environment: 'production',
      allowProduction: true,
      projectRef: 'fgmkhbzhaeebrsizwccx',
      prefix: 'vela/database',
      outputDir,
      retentionDays: 90,
    }, {
      encrypt: async ({ destination }) => writeFile(destination, 'synthetic-encrypted-backup'),
      verify: async () => {},
      upload: async ({ objectKey }) => { uploads.push(objectKey) },
      verifyRemote: async () => {},
    })
    assert.equal(uploads.length, 2)
    assert.deepEqual(await readdir(outputDir), [])
  } finally {
    console.log = log
    for (const name of Object.keys(process.env)) {
      if (!(name in originalEnvironment)) delete process.env[name]
    }
    Object.assign(process.env, originalEnvironment)
    await rm(outputDir, { recursive: true, force: true })
  }
})

test('preserva o dump local cifrado quando o upload R2 falha, para permitir recuperação operacional', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'vela-r2-failure-test-'))
  const originalEnvironment = { ...process.env }
  Object.assign(process.env, {
    SUPABASE_DB_URL: 'postgresql://backup:synthetic@db.example.test:5432/postgres?sslmode=require',
    BACKUP_ENCRYPTION_KEY_HEX: 'a'.repeat(64),
    BACKUP_ALLOW_PRODUCTION: 'YES',
    R2_ENDPOINT: 'https://b9f47a26b8f708444419dac863a54cd4.r2.cloudflarestorage.com',
    R2_BUCKET: 'vela-test-backups',
    R2_ACCESS_KEY_ID: 'synthetic-access',
    R2_SECRET_ACCESS_KEY: 'synthetic-secret',
  })
  const log = console.log
  console.log = () => {}
  try {
    await assert.rejects(executeBackup({
      environment: 'production',
      allowProduction: true,
      projectRef: 'fgmkhbzhaeebrsizwccx',
      prefix: 'vela/database',
      outputDir,
      retentionDays: 90,
    }, {
      encrypt: async ({ destination }) => writeFile(destination, 'synthetic-encrypted-backup'),
      verify: async () => {},
      upload: async () => { throw new Error('synthetic upload failure') },
      verifyRemote: async () => {},
    }), /synthetic upload failure/)
    const remaining = await readdir(outputDir)
    assert.equal(remaining.some((name) => name.endsWith('.dump.enc')), true)
    assert.equal(remaining.some((name) => name.endsWith('.manifest.json')), true)
    assert.equal(remaining.some((name) => name.endsWith('.part')), false)
  } finally {
    console.log = log
    for (const name of Object.keys(process.env)) {
      if (!(name in originalEnvironment)) delete process.env[name]
    }
    Object.assign(process.env, originalEnvironment)
    await rm(outputDir, { recursive: true, force: true })
  }
})

console.log('OK — backup-r2: contratos de segurança e dry-run conferidos')
