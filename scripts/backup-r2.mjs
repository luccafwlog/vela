import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { closeSync, createReadStream, createWriteStream, existsSync, openSync, readSync, statSync } from 'node:fs'
import { appendFile, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

const FORMAT_VERSION = 1
const MAGIC = Buffer.from('VELA-R2-BACKUP\0', 'ascii')
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES
const DEFAULT_OUTPUT_DIR = path.join(os.tmpdir(), 'vela-r2-backups')

function requiredValue(name, value) {
  if (!value) throw new Error(`${name} is obrigatoria para --execute.`)
  return value
}

function parseArgs(argv) {
  const args = {
    mode: 'dry-run',
    environment: process.env.BACKUP_ENVIRONMENT ?? 'non-production',
    outputDir: process.env.BACKUP_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR,
    prefix: process.env.R2_PREFIX ?? 'vela/database',
    projectRef: process.env.SUPABASE_PROJECT_REF ?? 'unspecified',
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 90),
    allowProduction: false,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') args.help = true
    else if (token === '--dry-run') args.mode = 'dry-run'
    else if (token === '--execute') args.mode = 'execute'
    else if (token === '--allow-production') args.allowProduction = true
    else if (token === '--environment') args.environment = requiredValue(token, argv[++i])
    else if (token === '--output-dir') args.outputDir = requiredValue(token, argv[++i])
    else if (token === '--prefix') args.prefix = requiredValue(token, argv[++i])
    else if (token === '--project-ref') args.projectRef = requiredValue(token, argv[++i])
    else if (token === '--retention-days') args.retentionDays = Number(requiredValue(token, argv[++i]))
    else if (token === '--verify') {
      args.mode = 'verify'
      args.verifyPath = requiredValue(token, argv[++i])
    } else throw new Error(`opcao desconhecida: ${token}`)
  }

  if (args.mode === 'execute' && args.verifyPath) throw new Error('--verify nao pode ser combinado com --execute.')
  if (!Number.isInteger(args.retentionDays) || args.retentionDays < 1) {
    throw new Error('--retention-days deve ser um inteiro positivo.')
  }
  args.environment = normalizeSegment(args.environment, 'environment')
  args.projectRef = normalizeSegment(args.projectRef, 'project-ref')
  args.prefix = normalizePrefix(args.prefix)
  return args
}

function normalizeSegment(value, label) {
  const normalized = String(value).trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(normalized)) {
    throw new Error(`${label} invalido; use somente letras, numeros, '_' ou '-'.`)
  }
  return normalized
}

function normalizePrefix(value) {
  const normalized = String(value).trim().replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || /[\u0000-\u001f]/.test(normalized)) {
    throw new Error('prefixo R2 invalido.')
  }
  return normalized.replace(/^\/+|\/+$/g, '')
}

function parseDatabaseUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('SUPABASE_DB_URL/DATABASE_URL nao e uma URL PostgreSQL valida.')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error('SUPABASE_DB_URL/DATABASE_URL deve usar o protocolo PostgreSQL.')
  }
  if (!url.username || !url.password) throw new Error('a URL PostgreSQL precisa conter usuario e senha.')
  if (url.searchParams.get('sslmode') === 'disable') throw new Error('sslmode=disable e proibido no backup.')

  return {
    env: {
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
      PGSSLMODE: url.searchParams.get('sslmode') ?? 'require',
    },
  }
}

function parseEncryptionKey(rawKey) {
  if (!/^[0-9a-f]{64}$/i.test(rawKey ?? '')) {
    throw new Error('BACKUP_ENCRYPTION_KEY_HEX deve ter exatamente 64 digitos hexadecimais.')
  }
  return Buffer.from(rawKey, 'hex')
}

function timestampForObject(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function buildObjectNames({ createdAt, environment, projectRef, prefix }) {
  const stamp = timestampForObject(createdAt)
  const base = `${prefix}/${environment}/${projectRef}/${stamp}`
  return {
    base,
    dumpKey: `${base}.dump.enc`,
    manifestKey: `${base}.manifest.json`,
  }
}

function printHelp() {
  console.log(`Backup logico cifrado para Cloudflare R2 (padrao: dry-run).

Uso:
  npm run backup:r2 -- --dry-run --environment staging --project-ref <ref>
  npm run backup:r2 -- --execute --environment staging --project-ref <ref>
  npm run backup:r2 -- --verify <arquivo.dump.enc>

--execute exige SUPABASE_DB_URL ou DATABASE_URL, BACKUP_ENCRYPTION_KEY_HEX,
R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e aws CLI.
Nenhum valor de segredo e impresso; a chave de cifragem nao e armazenada no
manifesto. --allow-production exige tambem BACKUP_ALLOW_PRODUCTION=YES.
`)
}

function planFor(args) {
  return {
    mode: args.mode,
    environment: args.environment,
    projectRef: args.projectRef,
    prefix: args.prefix,
    retentionDays: args.retentionDays,
    outputDir: path.resolve(args.outputDir),
    database: 'SUPABASE_DB_URL ou DATABASE_URL (valor oculto)',
    encryption: 'BACKUP_ENCRYPTION_KEY_HEX (valor oculto; 32 bytes)',
    upload: 'aws s3 cp para bucket R2 privado (credenciais ocultas)',
    effects: args.mode === 'dry-run'
      ? ['nao executa pg_dump', 'nao cria arquivo', 'nao acessa R2']
      : ['pg_dump public', 'cifra localmente', 'valida com pg_restore --list', 'faz upload do .dump.enc e manifesto'],
  }
}

function childEnvironment(databaseEnv = {}) {
  const env = { ...process.env, ...databaseEnv }
  delete env.DATABASE_URL
  delete env.SUPABASE_DB_URL
  delete env.PGPASSWORD_RAW
  delete env.BACKUP_ENCRYPTION_KEY_HEX
  delete env.R2_ACCESS_KEY_ID
  delete env.R2_SECRET_ACCESS_KEY
  return env
}

function waitForClose(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error(`${label} nao encontrado ou nao pode ser iniciado.`)))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
}

function drain(stream) {
  let tail = ''
  if (stream) stream.on('data', (chunk) => { tail = (tail + chunk).slice(-500) })
  return () => tail.trim()
}

async function encryptPgDump({ destination, databaseEnv, key }) {
  const iv = randomBytes(IV_BYTES)
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), iv])
  await writeFile(destination, header, { flag: 'wx' })

  const pgDump = spawn(process.env.PG_DUMP_BIN ?? 'pg_dump', [
    '--format=custom',
    '--schema=public',
    '--no-owner',
    '--no-privileges',
    // Sem --file: o dump sai no stdout. pg_dump no Windows trata --file=- como
    // um arquivo chamado "-" e grava o banco em texto claro no diretório atual.
  ],{ env: childEnvironment(databaseEnv), stdio: ['ignore', 'pipe', 'pipe'] })
  const pgDumpStderr = drain(pgDump.stderr)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const output = createWriteStream(destination, { flags: 'a' })
  const closing = waitForClose(pgDump, 'pg_dump')

  try {
    await pipeline(pgDump.stdout, cipher, output)
  } catch (error) {
    pgDump.kill()
    await closing.catch(() => {})
    throw new Error(`pg_dump falhou durante a cifragem (${error.message}).`)
  }

  const result = await closing
  // pg_dump nao imprime a senha (vem de PGPASSWORD); o stderr so diz o motivo.
  if (result.code !== 0) throw new Error(`pg_dump terminou com codigo ${result.code ?? 'desconhecido'}: ${pgDumpStderr()}`)
  await appendFile(destination, cipher.getAuthTag())
}

function readArchiveParts(filePath) {
  const fd = requireFileDescriptor(filePath)
  try {
    const fileSize = requireFileSize(filePath)
    if (fileSize < HEADER_BYTES + AUTH_TAG_BYTES) throw new Error('arquivo cifrado incompleto.')
    const header = Buffer.alloc(HEADER_BYTES)
    readSync(fd, header, 0, HEADER_BYTES, 0)
    if (!header.subarray(0, MAGIC.length).equals(MAGIC) || header[MAGIC.length] !== FORMAT_VERSION) {
      throw new Error('formato de backup desconhecido.')
    }
    const tag = Buffer.alloc(AUTH_TAG_BYTES)
    readSync(fd, tag, 0, AUTH_TAG_BYTES, fileSize - AUTH_TAG_BYTES)
    return { fileSize, iv: header.subarray(MAGIC.length + 1), tag }
  } finally {
    closeSync(fd)
  }
}

function requireFileDescriptor(filePath) {
  try {
    return openSync(filePath, 'r')
  } catch {
    throw new Error(`arquivo de backup nao encontrado: ${filePath}`)
  }
}

function requireFileSize(filePath) {
  try {
    return statSync(filePath).size
  } catch {
    throw new Error(`arquivo de backup nao encontrado: ${filePath}`)
  }
}

async function verifyArchive(filePath, key) {
  const { fileSize, iv, tag } = readArchiveParts(filePath)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const input = createReadStream(filePath, { start: HEADER_BYTES, end: fileSize - AUTH_TAG_BYTES - 1 })
  const restore = spawn(process.env.PG_RESTORE_BIN ?? 'pg_restore', ['--list', '--exit-on-error'], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  drain(restore.stderr)
  const closing = waitForClose(restore, 'pg_restore')
  try {
    await pipeline(input, decipher, restore.stdin)
  } catch (error) {
    restore.kill()
    await closing.catch(() => {})
    throw new Error(`validacao pg_restore --list falhou (${error.message}).`)
  }
  const result = await closing
  if (result.code !== 0) throw new Error(`pg_restore --list terminou com codigo ${result.code ?? 'desconhecido'}.`)
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function r2Config() {
  const endpoint = process.env.R2_ENDPOINT
  let endpointUrl
  try {
    endpointUrl = new URL(endpoint)
  } catch {
    throw new Error('R2_ENDPOINT deve ser um endpoint HTTPS do R2.')
  }
  if (endpointUrl.protocol !== 'https:' || !endpointUrl.hostname || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash || endpointUrl.pathname !== '/') {
    throw new Error('R2_ENDPOINT deve ser um endpoint HTTPS do R2 sem credenciais ou caminho.')
  }
  const bucket = requiredValue('R2_BUCKET', process.env.R2_BUCKET)
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('R2_BUCKET invalido.')
  return {
    endpoint: endpointUrl.origin,
    bucket,
    accessKeyId: requiredValue('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: requiredValue('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY),
  }
}

function assertExecuteAllowed(args) {
  if (args.environment === 'production' && !(args.allowProduction && process.env.BACKUP_ALLOW_PRODUCTION === 'YES')) {
    throw new Error('production bloqueada: use --allow-production e BACKUP_ALLOW_PRODUCTION=YES apos aprovacao operacional.')
  }
}

async function uploadToR2({ filePath, objectKey, config, contentType }) {
  const target = `s3://${config.bucket}/${objectKey}`
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: config.accessKeyId,
    AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
    AWS_REGION: 'auto',
    AWS_ENDPOINT_URL: config.endpoint,
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_PAGER: '',
  }
  const cliArgs = [
    's3', 'cp', filePath, target,
    '--endpoint-url', config.endpoint,
    '--region', 'auto',
    '--only-show-errors',
    '--no-progress',
  ]
  if (contentType) cliArgs.push('--content-type', contentType)
  const aws = spawn(process.env.AWS_BIN ?? 'aws', cliArgs, { env, stdio: ['ignore', 'ignore', 'pipe'] })
  drain(aws.stderr)
  const result = await waitForClose(aws, 'aws')
  if (result.code !== 0) throw new Error(`upload R2 falhou com codigo ${result.code ?? 'desconhecido'}.`)
}

async function executeBackup(args) {
  assertExecuteAllowed(args)
  const database = parseDatabaseUrl(process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL)
  const key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY_HEX)
  const r2 = r2Config()
  const createdAt = new Date()
  const names = buildObjectNames({ createdAt, environment: args.environment, projectRef: args.projectRef, prefix: args.prefix })
  const outputDir = path.resolve(args.outputDir)
  const encryptedPath = path.join(outputDir, path.basename(names.dumpKey))
  const partPath = `${encryptedPath}.part`
  const manifestPath = path.join(outputDir, path.basename(names.manifestKey))
  if (existsSync(encryptedPath) || existsSync(manifestPath) || existsSync(partPath)) {
    throw new Error('o destino local ja existe; escolha outro --output-dir para evitar sobrescrita.')
  }

  await mkdir(outputDir, { recursive: true })
  try {
    await encryptPgDump({ destination: partPath, databaseEnv: database.env, key })
    await verifyArchive(partPath, key)
    await rename(partPath, encryptedPath)
    const bytes = (await stat(encryptedPath)).size
    const manifest = {
      formatVersion: 'vela-r2-backup-v1',
      createdAt: createdAt.toISOString(),
      environment: args.environment,
      projectRef: args.projectRef,
      objectKey: names.dumpKey,
      format: 'pg_dump custom; schema public; schema e dados',
      encrypted: true,
      encryption: 'AES-256-GCM; chave externa BACKUP_ENCRYPTION_KEY_HEX',
      sha256: await sha256File(encryptedPath),
      bytes,
      retentionDays: args.retentionDays,
      localVerification: 'pg_restore --list concluido antes do upload',
      restoreMode: 'manual e destrutivo somente em ambiente descartavel autorizado',
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    console.log(`dump cifrado e validado localmente: ${encryptedPath}`)
    await uploadToR2({ filePath: encryptedPath, objectKey: names.dumpKey, config: r2 })
    await uploadToR2({ filePath: manifestPath, objectKey: names.manifestKey, config: r2, contentType: 'application/json' })
    console.log(`upload concluido no prefixo R2: ${args.prefix}/${args.environment}/${args.projectRef}/`)
  } finally {
    await unlink(partPath).catch(() => {})
  }
}

async function verifyOnly(args) {
  const key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY_HEX)
  await verifyArchive(path.resolve(args.verifyPath), key)
  console.log(`OK — pg_restore --list validou o backup cifrado: ${path.resolve(args.verifyPath)}`)
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) return printHelp()
  if (args.mode === 'dry-run') return console.log(JSON.stringify(planFor(args), null, 2))
  if (args.mode === 'verify') return verifyOnly(args)
  return executeBackup(args)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    console.error(`backup-r2: ${error.message}`)
    process.exitCode = 2
  })
}

export { buildObjectNames, parseArgs, parseDatabaseUrl, parseEncryptionKey, planFor }
