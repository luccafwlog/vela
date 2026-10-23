// Minimal local Supabase emulator (PostgREST subset + GoTrue password auth)
// for UI auditing against a local Postgres. Not for production use.
const http = require('http')
const crypto = require('crypto')
const { Pool, types } = require('pg')
types.setTypeParser(1082, v => v)            // date -> 'YYYY-MM-DD' like PostgREST
types.setTypeParser(1700, v => parseFloat(v)) // numeric -> number
types.setTypeParser(20, v => Number(v))       // int8 -> number
// Keep timestamptz/timestamp as the raw Postgres string to preserve microsecond
// precision. The default pg parser returns a JS Date, which JSON.stringify then
// truncates to milliseconds — breaking optimistic-lock checks (save_bl_review)
// that round-trip updated_at and compare it back at full precision, like real
// PostgREST does.
types.setTypeParser(1184, v => v)            // timestamptz -> raw string
types.setTypeParser(1114, v => v)            // timestamp   -> raw string

const PORT = 54321
// Só aceita o próprio endereço local no Host. Sem isso, uma página qualquer
// aberta no navegador poderia apontar um domínio seu para 127.0.0.1 (DNS
// rebinding) e falar com o emulador, que não tem autenticação de verdade.
// O proxy /sb-proxy do Vite usa changeOrigin e chega como 127.0.0.1:54321.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'].map(host => `${host}:${PORT}`))
function isAllowedHost(hostHeader) {
  return ALLOWED_HOSTS.has(String(hostHeader || '').toLowerCase())
}
const JWT_SECRET = 'local-audit-jwt-secret-local-audit-jwt-secret-32'
const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'app',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
})

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/
function qi(name) {
  if (!IDENT.test(name)) throw new Error(`bad identifier: ${name}`)
  return `"${name}"`
}

// ---------- relationship map ----------
let fks = [] // {table, cols, ftable, fcols}
async function loadFks() {
  const sql = `
    select tc.table_name as table, ftc.table_name as ftable,
      json_agg(kcu.column_name order by kcu.ordinal_position) as cols,
      json_agg(fkcu.column_name order by fkcu.ordinal_position) as fcols
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
    join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
    join information_schema.table_constraints ftc on ftc.constraint_name = rc.unique_constraint_name and ftc.constraint_schema = rc.unique_constraint_schema
    join information_schema.key_column_usage fkcu on fkcu.constraint_name = ftc.constraint_name and fkcu.constraint_schema = ftc.constraint_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    group by tc.constraint_name, tc.table_name, ftc.table_name`
  const r = await pool.query(sql)
  fks = r.rows
}
function findRel(parent, child) {
  // to-one: parent has FK -> child ; to-many: child has FK -> parent
  const one = fks.filter(f => f.table === parent && f.ftable === child)
  if (one.length) return { kind: 'one', fk: one[0] }
  const many = fks.filter(f => f.table === child && f.ftable === parent)
  if (many.length) return { kind: 'many', fk: many[0] }
  return null
}

// ---------- select parser ----------
function splitTop(s) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map(p => p.trim()).filter(Boolean)
}
function parseSelect(sel) {
  // returns [{type:'col', name, alias} | {type:'embed', alias, table, inner, children}]
  if (!sel || sel === '*') return [{ type: 'col', name: '*' }]
  return splitTop(sel).map(tok => {
    const open = tok.indexOf('(')
    if (open >= 0 && tok.endsWith(')')) {
      let head = tok.slice(0, open)
      const body = tok.slice(open + 1, -1)
      let alias = null
      if (head.includes(':')) { const i = head.indexOf(':'); alias = head.slice(0, i); head = head.slice(i + 1) }
      const segs = head.split('!')
      const table = segs[0]
      const inner = segs.includes('inner')
      return { type: 'embed', alias: alias || table, table, inner, children: parseSelect(body) }
    }
    if (tok === '*') return { type: 'col', name: '*' }
    if (tok.includes(':')) { const i = tok.indexOf(':'); return { type: 'col', name: tok.slice(i + 1), alias: tok.slice(0, i) } }
    return { type: 'col', name: tok }
  })
}

// ---------- filter parsing ----------
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE' }
function condSql(col, rawOp, value, params, tableAlias) {
  let negate = false
  let op = rawOp
  if (op.startsWith('not.')) { negate = true; op = op.slice(4) }
  const colSql = `${tableAlias}.${qi(col)}`
  let sql
  if (op === 'is') {
    const v = value.toLowerCase()
    if (v === 'null') sql = `${colSql} IS NULL`
    else if (v === 'true') sql = `${colSql} IS TRUE`
    else if (v === 'false') sql = `${colSql} IS FALSE`
    else throw new Error(`bad is value: ${value}`)
  } else if (op === 'in') {
    const inner = value.replace(/^\(/, '').replace(/\)$/, '')
    const items = []
    let cur = '', q = false
    for (const ch of inner) {
      if (ch === '"') { q = !q; continue }
      if (ch === ',' && !q) { items.push(cur); cur = '' } else cur += ch
    }
    if (cur !== '' || items.length) items.push(cur)
    if (!items.length) sql = 'FALSE'
    else {
      const ph = items.map(v => { params.push(v); return `$${params.length}` })
      sql = `${colSql} IN (${ph.join(',')})`
    }
  } else if (OPS[op]) {
    let v = value
    if (op === 'like' || op === 'ilike') v = v.replace(/\*/g, '%')
    params.push(v)
    sql = `${colSql} ${OPS[op]} $${params.length}`
  } else {
    throw new Error(`unsupported operator: ${rawOp}`)
  }
  return negate ? `NOT (${sql})` : sql
}
function parseOrGroup(value, params, tableAlias) {
  // value like (a.eq.1,b.is.null)
  const inner = value.replace(/^\(/, '').replace(/\)$/, '')
  const conds = splitTop(inner).map(part => {
    const m = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(.+)$/)
    if (!m) throw new Error(`bad or condition: ${part}`)
    const col = m[1]
    const rest = m[2]
    const dm = rest.match(/^(not\.)?([a-z]+)\.(.*)$/s)
    if (!dm) throw new Error(`bad or condition: ${part}`)
    return condSql(col, (dm[1] || '') + dm[2], dm[3], params, tableAlias)
  })
  return `(${conds.join(' OR ')})`
}

// ---------- query builder ----------
function buildEmbed(node, parentTable, parentAlias, params, embedFilters, path) {
  const rel = findRel(parentTable, node.table)
  if (!rel) throw new Error(`no relationship ${parentTable} -> ${node.table}`)
  const sub = `e_${path.replace(/\W/g, '_')}`
  const joinConds = rel.kind === 'one'
    ? rel.fk.fcols.map((fc, i) => `${sub}.${qi(fc)} = ${parentAlias}.${qi(rel.fk.cols[i])}`)
    : rel.fk.cols.map((c, i) => `${sub}.${qi(c)} = ${parentAlias}.${qi(rel.fk.fcols[i])}`)
  const myFilters = (embedFilters[node.alias] || []).map(f => condSql(f.col, f.op, f.value, params, sub))
  const selList = buildSelectList(node.children, node.table, sub, params, embedFilters, path)
  const where = [...joinConds, ...myFilters].join(' AND ')
  let expr
  if (rel.kind === 'one') {
    expr = `(SELECT to_jsonb(o) FROM (SELECT ${selList.sql} FROM ${qi(node.table)} ${sub} WHERE ${where} LIMIT 1) o)`
  } else {
    expr = `COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM (SELECT ${selList.sql} FROM ${qi(node.table)} ${sub} WHERE ${where}) o), '[]'::jsonb)`
  }
  const innerCond = node.inner
    ? `EXISTS (SELECT 1 FROM ${qi(node.table)} ${sub} WHERE ${where})`
    : null
  return { expr, innerCond }
}
function buildSelectList(nodes, table, alias, params, embedFilters, path) {
  const items = []
  const innerConds = []
  for (const n of nodes) {
    if (n.type === 'col') {
      if (n.name === '*') items.push(`${alias}.*`)
      else items.push(`${alias}.${qi(n.name)}${n.alias ? ` AS ${qi(n.alias)}` : ''}`)
    } else {
      const e = buildEmbed(n, table, alias, params, embedFilters, `${path}_${n.alias}`)
      items.push(`${e.expr} AS ${qi(n.alias)}`)
      if (e.innerCond) innerConds.push(e.innerCond)
    }
  }
  return { sql: items.join(', '), innerConds }
}

function parseQuery(table, urlObj) {
  const params = []
  const embedFilters = {} // alias -> [{col, op, value}]
  const where = []
  let order = '', limit = null, offset = null, selectRaw = '*'
  const entries = [...urlObj.searchParams.entries()]
  for (const [key, value] of entries) {
    if (key === 'select') { selectRaw = value; continue }
    if (key === 'order') {
      const parts = value.split(',').map(o => {
        const seg = o.split('.')
        const col = seg[0]
        const dir = seg.includes('desc') ? 'DESC' : 'ASC'
        const nulls = seg.includes('nullsfirst') ? ' NULLS FIRST' : seg.includes('nullslast') ? ' NULLS LAST' : ''
        return `t.${qi(col)} ${dir}${nulls}`
      })
      order = ` ORDER BY ${parts.join(', ')}`
      continue
    }
    if (key === 'limit') { limit = parseInt(value, 10); continue }
    if (key === 'offset') { offset = parseInt(value, 10); continue }
    if (key === 'on_conflict' || key === 'columns') continue
    if (key === 'or') { where.push(parseOrGroup(value, params, 't')); continue }
    if (key === 'and') { continue }
    // column filter, possibly dotted (embed)
    const m = value.match(/^(not\.)?([a-z]+)\.(.*)$/s)
    if (!m) continue
    const op = (m[1] || '') + m[2]
    const val = m[3]
    if (key.includes('.')) {
      const i = key.indexOf('.')
      const embedAlias = key.slice(0, i)
      const col = key.slice(i + 1)
      ;(embedFilters[embedAlias] = embedFilters[embedAlias] || []).push({ col, op, value: val })
    } else {
      where.push(condSql(key, op, val, params, 't'))
    }
  }
  const nodes = parseSelect(selectRaw)
  const sel = buildSelectList(nodes, table, 't', params, embedFilters, 'r')
  const allWhere = [...where, ...sel.innerConds]
  const whereSql = allWhere.length ? ` WHERE ${allWhere.join(' AND ')}` : ''
  let sql = `SELECT ${sel.sql} FROM ${qi(table)} t${whereSql}${order}`
  if (limit != null) sql += ` LIMIT ${limit}`
  if (offset != null) sql += ` OFFSET ${offset}`
  const countSql = `SELECT count(*)::int AS n FROM ${qi(table)} t${whereSql}`
  return { sql, countSql, params, limit, offset }
}

// ---------- jwt ----------
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}
function verifyJwt(token) {
  try {
    const [h, b, s] = token.split('.')
    const expect = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest())
    if (s !== expect) return null
    const payload = JSON.parse(Buffer.from(b, 'base64').toString())
    if (payload.exp && payload.exp < Date.now() / 1000) return null
    return payload
  } catch { return null }
}
const refreshTokens = new Map() // token -> user row

function userObj(row) {
  return {
    id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email,
    email_confirmed_at: row.email_confirmed_at, phone: '', confirmed_at: row.email_confirmed_at,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [], created_at: row.created_at, updated_at: row.updated_at,
  }
}
function session(row) {
  const now = Math.floor(Date.now() / 1000)
  const claims = { aud: 'authenticated', exp: now + 3600 * 8, iat: now, iss: 'local-shim', sub: row.id, email: row.email, phone: '', app_metadata: { provider: 'email' }, user_metadata: {}, role: 'authenticated', session_id: crypto.randomUUID() }
  const refresh = crypto.randomBytes(24).toString('hex')
  refreshTokens.set(refresh, row)
  return { access_token: signJwt(claims), token_type: 'bearer', expires_in: 3600 * 8, expires_at: now + 3600 * 8, refresh_token: refresh, user: userObj(row) }
}

// ---------- http ----------
function send(res, status, body, headers = {}) {
  // Always JSON-encode (content-type is application/json). Scalar RPC results
  // (e.g. portal_resolve_login returns text) must be quoted JSON, otherwise the
  // supabase-js client fails to parse a bare string and treats it as an error.
  const data = body == null ? '' : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(data)
}
async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : null
}

async function withClaims(claims, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (claims) {
      await client.query(`SET LOCAL ROLE authenticated`)
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    } else {
      await client.query(`SET LOCAL ROLE anon`)
    }
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    throw e
  } finally {
    client.release()
  }
}

async function handleRest(req, res, urlObj, claims) {
  const seg = urlObj.pathname.split('/').filter(Boolean) // ['rest','v1', table|rpc, fn?]
  const prefer = (req.headers['prefer'] || '')
  const wantCount = prefer.includes('count=exact') || req.method === 'HEAD'
  const wantSingle = (req.headers['accept'] || '').includes('vnd.pgrst.object+json')

  if (seg[2] === 'rpc') {
    const fn = seg[3]
    if (!IDENT.test(fn)) return send(res, 400, { message: 'bad function name' })
    const args = req.method === 'POST' ? (await readBody(req)) || {} : Object.fromEntries(urlObj.searchParams)
    const names = Object.keys(args)
    names.forEach(n => { if (!IDENT.test(n)) throw new Error('bad arg name') })
    const argSql = names.map((n, i) => `${qi(n)} := $${i + 1}`).join(', ')
    const signatures = await pool.query(
      `select
         p.proretset,
         t.typtype,
         t.typname,
         p.proargnames[1:p.pronargs] as argnames,
         array(
           select format_type(arg_oid, null)
           from unnest(p.proargtypes::oid[]) with ordinality as args(arg_oid, ord)
           order by ord
         ) as argtypes
       from pg_proc p
       join pg_type t on t.oid = p.prorettype
       where p.pronamespace = 'public'::regnamespace
         and p.proname = $1`,
      [fn],
    )
    // PostgREST resolves overloads allowing DEFAULT parameters to be omitted:
    // a call is valid when the supplied arg names are a subset of the function's
    // argnames. Prefer an exact-arity match, then fall back to a subset match so
    // functions with default params (or zero args) resolve like real PostgREST.
    const candidates = signatures.rows.map(row => ({ ...row, argnames: row.argnames ?? [] }))
    const meta =
      candidates.find(row => row.argnames.length === names.length && names.every(name => row.argnames.includes(name))) ||
      candidates.find(row => names.every(name => row.argnames.includes(name)))
    if (!meta) return send(res, 404, { message: `function ${fn} not found for supplied arguments` })
    const typeByName = new Map(meta.argnames.map((name, index) => [name, meta.argtypes[index]]))
    const params = names.map(n => {
      const v = args[n]
      const expectedType = typeByName.get(n)
      if (Array.isArray(v) && expectedType !== 'json' && expectedType !== 'jsonb') return v
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
    })
    const { proretset, typtype, typname } = meta
    const r = await withClaims(claims, c => c.query(`SELECT * FROM ${qi(fn)}(${argSql})`, params))
    let out
    if (typname === 'void') out = null
    else if (typtype === 'c' || proretset || r.fields.length > 1) {
      const rows = r.rows
      // PostgREST desembrulha funcao que devolve escalar em conjunto
      // (SETOF jsonb, SETOF text): o corpo e o proprio valor, nao um objeto
      // com o nome da funcao como chave. Sem isto, list_alert_queue_page
      // chega ao cliente como [{ list_alert_queue_page: {...} }] e a tela de
      // alertas quebra ao ler `type` de um objeto que nao o tem.
      const scalarSet = proretset && typtype !== 'c' && r.fields.length === 1
      out = scalarSet
        ? rows.map(row => row[r.fields[0].name])
        : (proretset ? rows : (rows[0] ?? null))
    } else {
      out = r.rows.length ? r.rows[0][r.fields[0].name] : null
    }
    return send(res, 200, out)
  }

  const table = seg[2]
  if (!IDENT.test(table)) return send(res, 400, { message: 'bad table name' })

  if (req.method === 'GET' || req.method === 'HEAD') {
    const q = parseQuery(table, urlObj)
    const rows = req.method === 'HEAD' ? [] : (await withClaims(claims, c => c.query(q.sql, q.params))).rows
    let headers = {}
    if (wantCount) {
      const cr = await withClaims(claims, c => c.query(q.countSql, q.params.slice(0, q.params.length)))
      const total = cr.rows[0].n
      const off = q.offset || 0
      headers['content-range'] = `${off}-${off + Math.max(rows.length - 1, 0)}/${total}`
    }
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-type': 'application/json', ...headers }); return res.end() }
    if (wantSingle) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: `JSON object requested, multiple (or no) rows returned: ${rows.length} rows` })
      return send(res, 200, rows[0], headers)
    }
    return send(res, 200, rows, headers)
  }

  if (req.method === 'POST') {
    const body = await readBody(req)
    const rowsIn = Array.isArray(body) ? body : [body]
    if (!rowsIn.length) return send(res, 201, [])
    const cols = [...new Set(rowsIn.flatMap(r => Object.keys(r)))]
    cols.forEach(c => { if (!IDENT.test(c)) throw new Error('bad column') })
    const params = []
    const valuesSql = rowsIn.map(r => `(${cols.map(c => {
      const v = r[c]
      params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? null)
      return `$${params.length}`
    }).join(',')})`).join(',')
    let conflict = ''
    if (prefer.includes('resolution=merge-duplicates')) {
      const oc = urlObj.searchParams.get('on_conflict')
      const target = oc ? oc.split(',').map(qi).join(',') : null
      conflict = target
        ? ` ON CONFLICT (${target}) DO UPDATE SET ${cols.map(c => `${qi(c)} = EXCLUDED.${qi(c)}`).join(', ')}`
        : ` ON CONFLICT DO NOTHING`
    }
    const returning = prefer.includes('return=representation') ? ' RETURNING *' : ''
    const sql = `INSERT INTO ${qi(table)} (${cols.map(qi).join(',')}) VALUES ${valuesSql}${conflict}${returning}`
    const r = await withClaims(claims, c => c.query(sql, params))
    const out = returning ? (wantSingle ? r.rows[0] : r.rows) : null
    return send(res, 201, out)
  }

  if (req.method === 'PATCH' || req.method === 'DELETE') {
    const params = []
    const where = []
    for (const [key, value] of urlObj.searchParams.entries()) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
      if (key === 'or') { where.push(parseOrGroup(value, params, 't')); continue }
      const m = value.match(/^(not\.)?([a-z]+)\.(.*)$/s)
      if (!m) continue
      where.push(condSql(key, (m[1] || '') + m[2], m[3], params, 't'))
    }
    if (!where.length) return send(res, 400, { message: 'update/delete without filters refused' })
    const returning = prefer.includes('return=representation') ? ' RETURNING *' : ''
    let sql
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const sets = Object.keys(body).map(c => {
        if (!IDENT.test(c)) throw new Error('bad column')
        const v = body[c]
        params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? null)
        return `${qi(c)} = $${params.length}`
      })
      sql = `UPDATE ${qi(table)} t SET ${sets.join(', ')} WHERE ${where.join(' AND ')}${returning}`
    } else {
      sql = `DELETE FROM ${qi(table)} t WHERE ${where.join(' AND ')}${returning}`
    }
    const r = await withClaims(claims, c => c.query(sql, params))
    const out = returning ? (wantSingle ? r.rows[0] : r.rows) : null
    return send(res, req.method === 'DELETE' ? 200 : 200, out)
  }

  send(res, 405, { message: 'method not allowed' })
}

async function handleAuth(req, res, urlObj) {
  const path = urlObj.pathname.replace(/^\/auth\/v1/, '')
  if (req.method === 'POST' && path === '/token') {
    const grant = urlObj.searchParams.get('grant_type')
    const body = (await readBody(req)) || {}
    if (grant === 'password') {
      const r = await pool.query(
        `select id, email, email_confirmed_at, created_at, updated_at from auth.users
         where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`,
        [body.email, body.password])
      if (!r.rows.length) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', error_code: 'invalid_credentials', code: 400, msg: 'Invalid login credentials' })
      return send(res, 200, session(r.rows[0]))
    }
    if (grant === 'refresh_token') {
      const row = refreshTokens.get(body.refresh_token)
      if (!row) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' })
      refreshTokens.delete(body.refresh_token)
      return send(res, 200, session(row))
    }
    return send(res, 400, { error: 'unsupported_grant_type' })
  }
  if (req.method === 'GET' && path === '/user') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer /, '')
    const claims = verifyJwt(token)
    if (!claims) return send(res, 401, { message: 'invalid token' })
    const r = await pool.query(`select id, email, email_confirmed_at, created_at, updated_at from auth.users where id = $1`, [claims.sub])
    if (!r.rows.length) return send(res, 401, { message: 'user not found' })
    return send(res, 200, userObj(r.rows[0]))
  }
  if (req.method === 'POST' && path === '/logout') return send(res, 204, null)
  send(res, 404, { message: `auth path not implemented: ${path}` })
}

const server = http.createServer(async (req, res) => {
  if (!isAllowedHost(req.headers.host)) return send(res, 403, { message: 'host not allowed' })
  const urlObj = new URL(req.url, 'http://localhost')
  try {
    if (urlObj.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, urlObj)
    if (urlObj.pathname.startsWith('/rest/v1')) {
      const token = (req.headers['authorization'] || '').replace(/^Bearer /, '')
      const claims = token ? verifyJwt(token) : null
      return await handleRest(req, res, urlObj, claims)
    }
    send(res, 404, { message: `not implemented: ${urlObj.pathname}` })
  } catch (e) {
    console.error(`[shim] ${req.method} ${req.url} -> ${e.message}`)
    send(res, 400, {
      message: e.message,
      code: e.code || 'SHIM',
      details: e.detail || null,
      hint: e.hint || null,
    })
  }
})

if (require.main === module) {
  loadFks().then(() => {
    server.listen(PORT, '127.0.0.1', () => console.log(`sb-shim listening on ${PORT}, ${fks.length} FKs loaded`))
  }).catch(e => { console.error(e); process.exit(1) })
}

module.exports = { isAllowedHost, server }
