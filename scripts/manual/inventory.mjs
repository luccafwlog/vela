#!/usr/bin/env node
// Inventário do sistema para o Manual do Operador (plano
// docs/plans/2026-10-26-manual-do-operador.md, Etapa 1.1).
//
// Lista tudo o que o manual precisa cobrir, com um identificador estável por
// item. Parte vem do código (rotas, funções de servidor, modelos de e-mail,
// matriz de permissões, funções chamadas pelas telas) e parte do banco local
// com todas as migrations aplicadas (funções chamáveis, regras automáticas,
// restrições, rotinas agendadas, catálogo de alertas, parâmetros, arquivos e
// mensagens), porque o estado final de cada regra é a última definição.
//
//   Uso: LOCAL_DATABASE_URL=... node scripts/manual/inventory.mjs [--out arquivo.json]
//
// Só LOCAL_DATABASE_URL: DATABASE_URL pode apontar para um banco remoto real.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { extractDocRoutes } from '../lib/docs-routes.mjs'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const SCHEMAS = ['public', 'ops', 'ce_unlock_private']

function connectionEnvironment(rawUrl) {
  const url = new URL(rawUrl)
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
  return env
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.git', '__tests__', 'integration'].includes(entry.name)) return []
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolute) : [absolute]
  })
}

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const rel = (absolute) => path.relative(root, absolute).split(path.sep).join('/')

/** Arquivos .ts/.tsx do app e das funções de servidor, sem testes. */
function sourceFiles() {
  return [
    ...walk(path.join(root, 'src')),
    ...walk(path.join(root, 'supabase', 'functions')),
  ].filter((file) => /\.(?:ts|tsx)$/.test(file) && !/\.test\.tsx?$|_test\.ts$/.test(file))
}

/** Função do banco → arquivos que a chamam por `rpc('nome')`. */
function rpcCallers(files) {
  const callers = new Map()
  const rpcCall = /(?:\.|\b)rpc\(\s*['"`]([a-z0-9_]+)['"`]/g
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    for (const [, name] of content.matchAll(rpcCall)) {
      if (!callers.has(name)) callers.set(name, new Set())
      callers.get(name).add(rel(file))
    }
  }
  return callers
}

function codeItems(files) {
  const items = []
  for (const source of ['src/AppInterno.tsx', 'src/AppPortal.tsx']) {
    for (const route of extractDocRoutes(read(source), source)) {
      items.push({ id: `rota:${route.path}`, kind: 'rota', name: route.path, source })
    }
  }

  const functionsDir = path.join(root, 'supabase', 'functions')
  for (const entry of fs.readdirSync(functionsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('_')) {
      items.push({ id: `servidor:${entry.name}`, kind: 'servidor', name: entry.name, source: `supabase/functions/${entry.name}` })
    }
  }

  const templateSources = [
    ['supabase/functions/_shared/portalEmailTemplates.ts', /export function (\w+Template)\b/g],
    ['src/services/customerCommunicationTemplates.ts', /export function (render\w+Template)\b/g],
    ['supabase/functions/_shared/dailyDigestEmail.ts', /export function (\w+)\b/g],
    ['supabase/functions/_shared/ceUnlockNotifyEmail.ts', /export function (\w+)\b/g],
  ]
  for (const [source, pattern] of templateSources) {
    for (const [, name] of read(source).matchAll(pattern)) {
      items.push({ id: `email:${name}`, kind: 'email', name, source })
    }
  }

  for (const [, id, action] of read('src/services/permissionMatrix.ts').matchAll(/id: '([^']+)',\s*group: '[^']+',\s*action: '([^']+)'/g)) {
    items.push({ id: `permissao:${id}`, kind: 'permissao', name: id, detail: action, source: 'src/services/permissionMatrix.ts' })
  }
  void files
  return items
}

function psqlRows(env, sql) {
  const output = execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t', '-c', sql], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return output.split('\n').filter(Boolean).map((line) => line.split('\t'))
}

function databaseItems(env, callers) {
  const items = []
  const schemaList = SCHEMAS.map((schema) => `'${schema}'`).join(',')
  // Funções que não são de extensão (pg_trgm etc.).
  const ownFunctions = `
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (${schemaList}) and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`

  const functionRows = psqlRows(env, `
    select n.nspname, p.proname,
           bool_or(has_function_privilege('authenticated', p.oid, 'execute')),
           bool_or(has_function_privilege('anon', p.oid, 'execute')),
           bool_or(p.prorettype = 'trigger'::regtype),
           bool_or(p.prosecdef)
    ${ownFunctions}
    group by n.nspname, p.proname order by 1, 2`)
  const callableNames = new Set()
  for (const [schema, name, authenticated, anon, isTrigger] of functionRows) {
    if (isTrigger === 't') continue
    const calledBy = callers.get(name)
    if (authenticated !== 't' && anon !== 't' && !calledBy) continue
    callableNames.add(name)
    items.push({
      id: `funcao:${name}`,
      kind: 'funcao',
      name,
      detail: [
        schema !== 'public' ? `esquema ${schema}` : null,
        authenticated === 't' ? 'tela (usuário logado)' : null,
        anon === 't' ? 'sem login' : null,
        calledBy ? `chamada em ${[...calledBy].sort().join(', ')}` : 'sem chamada no código do app',
      ].filter(Boolean).join('; '),
    })
  }
  for (const [name, files] of callers) {
    if (!callableNames.has(name) && !functionRows.some(([, fn]) => fn === name)) {
      items.push({ id: `funcao:${name}`, kind: 'funcao', name, detail: `chamada em ${[...files].sort().join(', ')}; não existe no banco` })
    }
  }

  const triggerRows = psqlRows(env, `
    select p.proname, string_agg(distinct c.relname || '.' || t.tgname, ', ' order by c.relname || '.' || t.tgname)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and cn.nspname in (${schemaList}, 'storage', 'auth')
    group by p.proname order by 1`)
  for (const [name, attached] of triggerRows) {
    items.push({ id: `gatilho:${name}`, kind: 'gatilho', name, detail: attached })
  }

  for (const [table, name, definition] of psqlRows(env, `
    select cl.relname, c.conname, pg_get_constraintdef(c.oid)
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname in (${schemaList}) and c.contype = 'c'
    order by 1, 2`)) {
    items.push({ id: `restricao:${table}.${name}`, kind: 'restricao', name: `${table}.${name}`, detail: definition })
  }

  for (const [table, name, definition] of psqlRows(env, `
    select t.relname, ic.relname, pg_get_indexdef(i.indexrelid)
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname in (${schemaList}) and i.indisunique and not i.indisprimary
    order by 1, 2`)) {
    items.push({ id: `unico:${table}.${name}`, kind: 'unico', name: `${table}.${name}`, detail: definition })
  }

  for (const [table, name, command, roles] of psqlRows(env, `
    select tablename, policyname, cmd, array_to_string(roles, ',')
    from pg_policies
    where schemaname in (${schemaList}, 'storage') and cmd <> 'SELECT'
    order by 1, 2`)) {
    items.push({ id: `politica:${table}.${name}`, kind: 'politica', name: `${table}.${name}`, detail: `${command} para ${roles}` })
  }

  for (const [name, schedule, command] of psqlRows(env, 'select jobname, schedule, command from cron.job order by 1')) {
    items.push({ id: `rotina:${name}`, kind: 'rotina', name, detail: `${schedule} · ${command.replace(/\s+/g, ' ').slice(0, 200)}` })
  }

  for (const [type, severity, responsible, audience, active] of psqlRows(env, `
    select type, severity, coalesce(responsible_department, ''), array_to_string(audience_departments, ','), active
    from alert_type_catalog order by 1`)) {
    items.push({
      id: `alerta:${type}`,
      kind: 'alerta',
      name: type,
      detail: `${active === 't' ? 'ativo' : 'inativo'}; severidade ${severity}; responsável ${responsible || '—'}; avisa ${audience || '—'}`,
    })
  }

  for (const [column, type] of psqlRows(env, `
    select column_name, data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings'
      and column_name not in ('id', 'created_at', 'updated_at')
    order by ordinal_position`)) {
    items.push({ id: `parametro:${column}`, kind: 'parametro', name: column, detail: type })
  }

  for (const [bucket] of psqlRows(env, 'select id from storage.buckets order by 1')) {
    items.push({ id: `arquivo:${bucket}`, kind: 'arquivo', name: bucket })
  }

  // Mensagens: cada RAISE EXCEPTION com texto literal, na última definição
  // de cada função. O texto exato é o identificador (é o que a tela mostra).
  const messages = new Map()
  for (const [functionName, message] of psqlRows(env, `
    select p.proname, (regexp_matches(p.prosrc, 'RAISE\\s+EXCEPTION\\s+''((?:[^'']|'''')*)''', 'gi'))[1]
    ${ownFunctions}`)) {
    const text = message.replace(/''/g, "'")
    if (!messages.has(text)) messages.set(text, new Set())
    messages.get(text).add(functionName)
  }
  for (const [text, functions] of [...messages].sort(([a], [b]) => a.localeCompare(b))) {
    items.push({ id: `mensagem:${text}`, kind: 'mensagem', name: text, detail: `em ${[...functions].sort().join(', ')}` })
  }
  return items
}

export function collectInventory(databaseUrl = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test') {
  const files = sourceFiles()
  const callers = rpcCallers(files)
  const items = [...codeItems(files), ...databaseItems(connectionEnvironment(databaseUrl), callers)]
  const seen = new Set()
  return items.filter((item) => (seen.has(item.id) ? false : seen.add(item.id)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const items = collectInventory()
  const outIndex = process.argv.indexOf('--out')
  const json = `${JSON.stringify(items, null, 2)}\n`
  if (outIndex > 0) fs.writeFileSync(process.argv[outIndex + 1], json)
  else process.stdout.write(json)
  const counts = items.reduce((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] ?? 0) + 1 }), {})
  console.error(`Inventário: ${items.length} itens · ${Object.entries(counts).map(([kind, count]) => `${kind} ${count}`).join(' · ')}`)
}
