import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
// Só LOCAL_DATABASE_URL: DATABASE_URL pode apontar para um banco remoto real.
const databaseUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

// A conexão vai ao psql por variáveis PG*, não pelo argv (visível em `ps`), e
// a senha nunca aparece numa mensagem.
function connectionEnvironment(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('LOCAL_DATABASE_URL nao e uma URL PostgreSQL valida.')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('LOCAL_DATABASE_URL deve usar o protocolo PostgreSQL.')
  }
  const env = {
    PGHOST: decodeURIComponent(url.hostname.replace(/^\[|\]$/g, '')) || '127.0.0.1',
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
  }
  if (url.username) env.PGUSER = decodeURIComponent(url.username)
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password)
  const sslmode = url.searchParams.get('sslmode')
  if (sslmode) env.PGSSLMODE = sslmode
  return env
}

function redactDatabaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.password) url.password = '***'
    return url.href
  } catch {
    return '(URL invalida)'
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return []
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolute) : [absolute]
  })
}

const sourceFiles = [
  ...walk(path.join(root, 'src')).filter((file) => /\.(?:ts|tsx)$/.test(file) && !file.includes('/__tests__/') && !file.includes('/integration/')),
  ...walk(path.join(root, 'supabase', 'functions')).filter((file) => /\.(?:ts|tsx)$/.test(file)),
]
const called = new Set()
// `rpc(` sem ponto cobre o cliente injetado (laço do import-effects-runner).
const rpcCall = /(?:\.|\b)rpc\(\s*['"`]([^'"`]+)['"`]/g
for (const file of sourceFiles) {
  const content = fs.readFileSync(file, 'utf8')
  for (const match of content.matchAll(rpcCall)) called.add(match[1])
}

// callPortalRpc resolves a literal map before invoking `.rpc`; include its
// values so the dynamic dispatcher receives the same catalog check.
const portalContracts = fs.readFileSync(path.join(root, 'src/services/portalRpcContracts.ts'), 'utf8')
for (const match of portalContracts.matchAll(/:\s*'([a-z0-9_]+)'/g)) {
  if (match[1].includes('portal_') || match[1].includes('agency_report') || match[1] === 'add_demurrage_dispute_attachment') called.add(match[1])
}

const sql = `
  SELECT DISTINCT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  ORDER BY p.proname;
`
let rows
try {
  const env = { ...process.env, ...connectionEnvironment(databaseUrl) }
  // A URL não segue para o psql nem para quem ele chamar.
  delete env.LOCAL_DATABASE_URL
  delete env.DATABASE_URL
  rows = execFileSync('psql', ['-X', '-At', '-c', sql], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'] })
} catch (error) {
  console.error(`RPC catalog could not connect to ${redactDatabaseUrl(databaseUrl)}. Run scripts/setup-local-pg.sh first.`)
  process.exitCode = 2
}

if (rows !== undefined) {
  const available = new Set(rows.split('\n').map((name) => name.trim()).filter(Boolean))
  const missing = [...called].filter((name) => !available.has(name)).sort()
  if (missing.length) {
    console.error(`RPC catalog failed: ${missing.length} caller(s) point to absent public functions:`)
    for (const name of missing) console.error(`- ${name}`)
    process.exitCode = 1
  } else {
    console.log(`RPC catalog passed: ${called.size} production RPC names resolve in public.pg_proc.`)
  }
}
