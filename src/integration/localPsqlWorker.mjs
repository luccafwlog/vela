// Worker do helper `localPsql.ts`: guarda uma conexão `pg` por banco e imita a
// saída do `psql -At` (Lote 2 do plano docs/plans/2026-10-15-compactacao-do-ci.md).
// Roda fora do Vite, por isso é JavaScript puro. Cada pedido chega pela porta,
// a resposta volta pela mesma porta e o slot compartilhado acorda a thread de
// teste, que espera de forma síncrona (Atomics.wait).
import { readFileSync } from 'node:fs'
import { workerData } from 'node:worker_threads'
import pg from 'pg'

const { port, shared } = workerData
const flag = new Int32Array(shared)
const clients = new Map()
// Valores do servidor como texto, sem conversão: o mesmo que o psql imprime.
const rawTypes = { getTypeParser: () => (value) => value }

/** Consulta simples (protocolo de texto) que guarda cada resultado na ordem. */
class SimpleQuery {
  constructor(text, onResult) {
    this.text = text
    this.onResult = onResult
    this.current = null
  }
  submit(connection) { connection.query(this.text) }
  handleRowDescription() { this.current = [] }
  handleDataRow(msg) { this.current.push(msg.fields) }
  handleCommandComplete(msg) {
    this.onResult({ rows: this.current, tag: msg.text })
    this.current = null
  }
  handleEmptyQuery() {}
  // O pg solta a consulta no erro e não chama handleReadyForQuery; o servidor
  // já não manda mais resultados dela.
  handleError(error) { this.callback(error) }
  handlePortalSuspended() {}
  handleCopyInResponse(connection) { connection.sendCopyFail('COPY FROM STDIN não é suportado pelo helper local-pg') }
  handleCopyData() {}
  handleReadyForQuery() { this.callback(null) }
}

async function clientFor(url) {
  let client = clients.get(url)
  if (client) return client
  client = new pg.Client({ connectionString: url, types: rawTypes })
  client.on('error', () => clients.delete(url))
  client.notices = null
  client.on('notice', (msg) => client.notices?.(msg))
  await client.connect()
  clients.set(url, client)
  return client
}

function run(client, text, onResult) {
  return new Promise((resolve) => {
    const query = new SimpleQuery(text, onResult)
    query.callback = (error) => resolve(error)
    client.query(query)
  })
}

/** Linha "LINE n: ..." com o circunflexo, como o libpq (sem o corte de linhas longas). */
function errorPosition(query, position) {
  const offset = Number(position) - 1
  if (!query || !(offset >= 0)) return ''
  const before = [...query].slice(0, offset).join('')
  const lineNo = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const lineText = query.slice(lineStart).split('\n')[0].replace(/\r$/, '')
  const prefix = `LINE ${lineNo}: `
  const column = [...before.slice(lineStart)].length
  return `${prefix}${lineText}\n${' '.repeat(prefix.length + column)}^\n`
}

/** Mensagem no formato do libpq (pqBuildErrorMessage3). */
export function formatMessage(msg, { verbose, query, isError }) {
  let text = `${msg.severity}:  ${verbose && msg.code ? `${msg.code}: ` : ''}${msg.message}\n`
  if (msg.position) text += errorPosition(query, msg.position)
  else if (msg.internalPosition) text += errorPosition(msg.internalQuery, msg.internalPosition)
  if (msg.detail) text += `DETAIL:  ${msg.detail}\n`
  if (msg.hint) text += `HINT:  ${msg.hint}\n`
  if (msg.internalQuery) text += `QUERY:  ${msg.internalQuery}\n`
  if (msg.where && isError) text += `CONTEXT:  ${msg.where}\n`
  if (verbose) {
    if (msg.schema) text += `SCHEMA NAME:  ${msg.schema}\n`
    if (msg.table) text += `TABLE NAME:  ${msg.table}\n`
    if (msg.column) text += `COLUMN NAME:  ${msg.column}\n`
    if (msg.dataType) text += `DATATYPE NAME:  ${msg.dataType}\n`
    if (msg.constraint) text += `CONSTRAINT NAME:  ${msg.constraint}\n`
    if (msg.routine) text += `LOCATION:  ${msg.routine}, ${msg.file}:${msg.line}\n`
  }
  return text
}

/**
 * Divide um script como o psql em modo arquivo: um comando por `;` fora de
 * aspas, identificadores, dollar quotes e comentários. Devolve o texto e a
 * linha em que cada comando termina.
 */
export function splitScript(script) {
  const statements = []
  let start = 0
  let line = 1
  let i = 0
  const push = (end) => {
    const text = script.slice(start, end)
    if (text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()) statements.push({ text, line })
    start = end
  }
  while (i < script.length) {
    const ch = script[i]
    if (ch === '\n') { line += 1; i += 1; continue }
    if (ch === '-' && script[i + 1] === '-') { while (i < script.length && script[i] !== '\n') i += 1; continue }
    if (ch === '/' && script[i + 1] === '*') {
      let depth = 1
      i += 2
      while (i < script.length && depth) {
        if (script[i] === '\n') line += 1
        if (script[i] === '/' && script[i + 1] === '*') { depth += 1; i += 2 } else if (script[i] === '*' && script[i + 1] === '/') { depth -= 1; i += 2 } else i += 1
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      const escapes = ch === "'" && /[eE]/.test(script[i - 1] ?? '') && !/\w/.test(script[i - 2] ?? '')
      i += 1
      while (i < script.length) {
        if (script[i] === '\n') line += 1
        if (escapes && script[i] === '\\') { i += 2; continue }
        if (script[i] === ch) { if (script[i + 1] === ch) { i += 2; continue } break }
        i += 1
      }
      i += 1
      continue
    }
    if (ch === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(script.slice(i))
      if (tag && !/\w/.test(script[i - 1] ?? '')) {
        const close = script.indexOf(tag[0], i + tag[0].length)
        const end = close === -1 ? script.length : close + tag[0].length
        for (let k = i; k < end; k += 1) if (script[k] === '\n') line += 1
        i = end
        continue
      }
    }
    if (ch === ';') { i += 1; push(i); continue }
    i += 1
  }
  push(script.length)
  return statements
}

function printResult(result, quiet, out) {
  const { rows, tag } = result
  if (rows) for (const row of rows) out.push(`${row.map((value) => value ?? '').join('|')}\n`)
  const returning = /^(INSERT|UPDATE|DELETE|MERGE)\b/.test(tag)
  if (!quiet && (!rows || returning)) out.push(`${tag}\n`)
}

async function handle(request) {
  const { url, commands, quiet, verbose, onErrorStop } = request
  const stdout = []
  let stderr = ''
  let client
  try {
    client = await clientFor(url)
  } catch (error) {
    return { status: 2, stdout: '', stderr: `psql: error: ${error.message}\n` }
  }
  let status = 0
  let prefix = ''
  let currentQuery = ''
  client.notices = (msg) => { stderr += prefix + formatMessage(msg, { verbose, query: currentQuery, isError: false }) }
  try {
    for (const command of commands) {
      const statements = command.kind === 'c'
        ? [{ text: command.text, line: 0 }]
        : splitScript(command.kind === 'f' ? readFileSync(command.path, 'utf8') : command.text)
      const where = command.kind === 'f' ? command.path : '<stdin>'
      let stop = false
      for (const statement of statements) {
        // Só `-f` prefixa a origem; `-c` e stdin sem `-f` não.
        prefix = command.prefixed ? `psql:${where}:${statement.line}: ` : ''
        currentQuery = statement.text
        const error = await run(client, statement.text, (result) => printResult(result, quiet, stdout))
        if (error) {
          stderr += prefix + formatMessage(error, { verbose, query: statement.text, isError: true })
          if (command.kind === 'c') { status = 1; stop = true; break }
          if (onErrorStop) { status = 3; stop = true; break }
        }
      }
      if (stop) break
    }
  } finally {
    // Sessão limpa para a próxima chamada, como um psql novo: desfaz transação
    // aberta, SET/SET ROLE, set_config de sessão, temporárias, locks consultivos
    // e preparações.
    client.notices = null
    // ROLLBACK sempre: no erro, o pg resolve antes do ReadyForQuery e o estado
    // da transação ainda não chegou. Sem transação, o aviso vai para o nada.
    await client.query('ROLLBACK').catch(() => {})
    await client.query('DISCARD ALL').catch(() => {})
  }
  return { status, stdout: stdout.join(''), stderr }
}

port.on('message', async (request) => {
  let response
  try {
    response = request.close ? await closeAll() : await handle(request)
  } catch (error) {
    response = { status: 2, stdout: '', stderr: `psql: error: ${error?.stack ?? error}\n` }
  }
  port.postMessage(response)
  Atomics.store(flag, 0, 1)
  Atomics.notify(flag, 0)
})

async function closeAll() {
  await Promise.all([...clients.values()].map((client) => client.end().catch(() => {})))
  clients.clear()
  return { status: 0, stdout: '', stderr: '' }
}
