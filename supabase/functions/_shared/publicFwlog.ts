// Quadro "Chegadas e saídas" e Consulta de container públicos do fwlog.com.br
// (ADR 0114). As duas Edge Functions (`public-ship-schedule` e
// `public-container-lookup`) são finas: leem o ambiente, montam o cliente
// `service_role` e chamam os handlers daqui, que recebem tudo por `deps` para
// o teste rodar sem rede, sem Upstash e sem banco.
//
// Regras (todas fail-closed):
// - origem do navegador só da lista `PUBLIC_FWLOG_ALLOWED_ORIGINS`;
// - Turnstile próprio (`TURNSTILE_PUBLIC_SECRET_KEY`,
//   `TURNSTILE_PUBLIC_ALLOWED_HOSTNAMES`), separado do par do login do Portal,
//   com `action` por produto; sem secret ou sem hostname, recusa;
// - limite por IP no Upstash; Upstash fora do ar ou sem configuração recusa
//   (no login do Portal ele só soma bloqueio; aqui é a única trava);
// - resposta montada por lista positiva: a linha do SQL nunca é repassada;
// - logs sem número de container nem IP em claro.
import { verifyTurnstileToken } from './turnstile.ts'
import { CHECK_SCRIPT, INCREMENT_SCRIPT, buildRateLimitKey, type RateLimitAction } from './rateLimit.ts'
import { readBoundedJsonBody } from './boundedBody.ts'
import { parseConfiguredOrigins } from './cors.ts'
import { requestIp } from './portalLoginRateLimit.ts'

// --- Limites (ADR 0114) ----------------------------------------------------

/** Quadro: aberturas e "Atualizar" por IP a cada 10 minutos. */
export const SCHEDULE_IP_LIMIT = 30
export const SCHEDULE_IP_WINDOW_SECONDS = 600
/** Quadro: a resposta é a mesma para todos e o banco é lido no máximo uma vez nesta janela. */
export const SCHEDULE_CACHE_SECONDS = 90
/** Cópia antiga servida enquanto outra instância relê o banco. */
export const SCHEDULE_STALE_SECONDS = 3600
/** Busca: consultas por IP a cada 10 minutos e por dia. */
export const LOOKUP_IP_LIMIT = 20
export const LOOKUP_IP_WINDOW_SECONDS = 600
export const LOOKUP_IP_DAILY_LIMIT = 100
export const LOOKUP_IP_DAILY_WINDOW_SECONDS = 86_400
/** Busca: "não encontrado" por IP por hora (varredura de números). */
export const LOOKUP_MISS_IP_LIMIT = 10
export const LOOKUP_MISS_IP_WINDOW_SECONDS = 3600
/**
 * Disjuntor global: "não encontrado" de todos os IPs na hora cheia. Acima
 * disso a busca fica indisponível para todos até a hora virar; protege contra
 * varredura distribuída por muitos IPs.
 * ponytail: valor fixo pensado para dezenas de transportadoras; se o uso real
 * passar disso, subir por constante com base no log de volume.
 */
export const LOOKUP_MISS_GLOBAL_HOURLY_LIMIT = 300
/** Tempo mínimo da resposta da busca, para "achou" e "não achou" não se distinguirem pelo relógio. */
export const LOOKUP_MIN_RESPONSE_MS = 400
/** Teto do corpo: só o token do Turnstile (até 2048) e o número. */
export const PUBLIC_BODY_MAX_BYTES = 4 * 1024
/** Teto de Viagens no quadro, o mesmo da função SQL. */
export const SCHEDULE_MAX_VOYAGES = 100

// Mesmas listas da migration 542 e do front (testes de paridade em
// src/services/__tests__/publicFwlogEdge.test.ts).
export const PUBLIC_SCHEDULE_PORT_CODES = ['CNTAO', 'CNSHA', 'CNTAC', 'CNNGB', 'CNNSA', 'BRSSA', 'BRVIX', 'BRPEC', 'BRSUA'] as const
export const PUBLIC_LOOKUP_PORT_CODES = ['BRSSA', 'BRVIX', 'BRPEC', 'BRSUA'] as const
export const PUBLIC_LOOKUP_SITUATIONS = ['aguardando_descarga', 'no_prazo', 'prazo_vencido', 'prazo_a_confirmar', 'devolvido'] as const

export const TURNSTILE_ACTION = { schedule: 'schedule', lookup: 'lookup' } as const

// --- Dependências ----------------------------------------------------------

export type RpcResult = { data: unknown; error: unknown }

export type PublicFwlogDeps = {
  env: (name: string) => string | undefined
  /** Siteverify do Turnstile e REST do Upstash. */
  fetcher: typeof fetch
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>
  now: () => number
  sleep: (ms: number) => Promise<void>
  log: (event: string, details: Record<string, unknown>) => void
}

export function defaultLog(event: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...details }))
}

// --- Respostas -------------------------------------------------------------

export function publicCorsHeaders(origin: string | null, allowed: ReadonlySet<string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(status: number, body: unknown, cors: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors,
      ...extra,
    },
  })
}

const REFUSAL = {
  origin: { error: 'origem_nao_permitida' },
  method: { error: 'metodo_nao_permitido' },
  tooLarge: { error: 'requisicao_grande_demais' },
  challenge: { error: 'verificacao_invalida' },
  limit: { error: 'limite_atingido' },
  unavailable: { error: 'indisponivel' },
} as const

/**
 * Origens do navegador aceitas. Só a lista do ambiente (URLs HTTPS exatas);
 * o Vite local entra apenas no stack local do Supabase. Sem a variável,
 * nenhuma origem passa.
 */
export function publicAllowedOrigins(env: PublicFwlogDeps['env']): Set<string> {
  const origins = new Set(parseConfiguredOrigins(env('PUBLIC_FWLOG_ALLOWED_ORIGINS')))
  if (isLocalStack(env('SUPABASE_URL'))) {
    origins.add('http://localhost:5173')
    origins.add('http://127.0.0.1:5173')
  }
  return origins
}

function isLocalStack(url: string | undefined): boolean {
  if (!url) return false
  try {
    return ['localhost', '127.0.0.1', 'kong', 'host.docker.internal'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

// --- Turnstile próprio -----------------------------------------------------

function originHostname(origin: string | null): string | null {
  if (!origin) return null
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}

export async function verifyPublicTurnstile(req: Request, token: unknown, action: string, deps: PublicFwlogDeps): Promise<boolean> {
  const secret = deps.env('TURNSTILE_PUBLIC_SECRET_KEY')?.trim() ?? ''
  const hostnames = (deps.env('TURNSTILE_PUBLIC_ALLOWED_HOSTNAMES') ?? '').split(',').map((host) => host.trim()).filter(Boolean)
  // Sem secret ou sem hostname, recusa, inclusive no stack local (lá se usa a
  // chave de teste do Turnstile, não a ausência dela).
  if (!secret || hostnames.length === 0) return false
  const hostname = originHostname(req.headers.get('Origin'))
  return verifyTurnstileToken({ token, expectedAction: action, expectedHostname: hostname, secret, allowedHostnames: hostnames, fetcher: deps.fetcher })
}

// --- Upstash ---------------------------------------------------------------

type UpstashConfig = { url: string; token: string; hmacSecret: string; scope: string }

/**
 * Projeto Supabase das chaves no Redis: staging e produção podem usar o mesmo
 * database Upstash (portal-rate-limit.md), e sem o projeto na chave o cache do
 * quadro de um serviria o outro (achado da revisão da PR #1119). O host do
 * projeto não é segredo.
 */
export function publicKeyScope(supabaseUrl: string | undefined): string {
  try {
    return new URL(supabaseUrl ?? '').hostname.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'sem-projeto'
  } catch {
    return 'sem-projeto'
  }
}

function upstashConfig(env: PublicFwlogDeps['env']): UpstashConfig | null {
  const url = env('UPSTASH_REDIS_REST_URL')?.trim().replace(/\/+$/, '')
  const token = env('UPSTASH_REDIS_REST_TOKEN')?.trim()
  const hmacSecret = env('PORTAL_RATE_LIMIT_HMAC_SECRET')?.trim()
  // `PORTAL_RATE_LIMIT_ENABLED=false` não desliga a trava pública: sem ela
  // não há widget.
  return url && token && hmacSecret ? { url, token, hmacSecret, scope: publicKeyScope(env('SUPABASE_URL')) } : null
}

class UpstashUnavailable extends Error {}

const UPSTASH_TIMEOUT_MS = 1500

async function upstash(config: UpstashConfig, deps: PublicFwlogDeps, commands: unknown[][]): Promise<unknown[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS)
  try {
    const response = await deps.fetcher(`${config.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: controller.signal,
    })
    if (!response.ok) throw new UpstashUnavailable(`HTTP ${response.status}`)
    const payload = await response.json() as Array<{ result?: unknown; error?: string }>
    if (!Array.isArray(payload) || payload.length !== commands.length) throw new UpstashUnavailable('resposta inválida')
    return payload.map((item) => {
      if (item?.error) throw new UpstashUnavailable('erro do Redis')
      return item?.result
    })
  } catch (error) {
    if (error instanceof UpstashUnavailable) throw error
    throw new UpstashUnavailable('falha de rede')
  } finally {
    clearTimeout(timer)
  }
}

function counterValue(value: unknown): number {
  if (!Array.isArray(value)) throw new UpstashUnavailable('contador inválido')
  const count = Number(value[0])
  if (!Number.isFinite(count)) throw new UpstashUnavailable('contador inválido')
  return count
}

async function ipKey(config: UpstashConfig, action: RateLimitAction, ip: string): Promise<string> {
  // O projeto entra no valor do HMAC: contadores de staging e produção separados.
  return buildRateLimitKey(config.hmacSecret, { action, ip: `${config.scope}|${ip}` })
}

/** Prefixo do HMAC do IP para log: correlaciona pedidos sem guardar o IP. */
async function ipTag(config: UpstashConfig | null, ip: string): Promise<string> {
  if (!config) return 'sem-hmac'
  const key = await buildRateLimitKey(config.hmacSecret, { action: 'public_lookup', ip })
  return key.split(':')[3]?.slice(0, 12) ?? 'sem-hmac'
}

export function globalMissKey(scope: string, now: number): string {
  const hour = new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, '')
  return `vela:public-rate:${scope}:public_lookup_miss_global:${hour}`
}

// --- Pedido comum ----------------------------------------------------------

type Prelude =
  | { ok: false; response: Response }
  | { ok: true; cors: Record<string, string>; body: Record<string, unknown>; config: UpstashConfig; ip: string }

async function prelude(req: Request, deps: PublicFwlogDeps, event: string): Promise<Prelude> {
  const allowed = publicAllowedOrigins(deps.env)
  const origin = req.headers.get('Origin')
  const cors = publicCorsHeaders(origin, allowed)
  if (!origin || !allowed.has(origin)) {
    deps.log(event, { outcome: 'origin_refused' })
    return { ok: false, response: json(403, REFUSAL.origin, cors) }
  }
  if (req.method === 'OPTIONS') return { ok: false, response: json(204, null, cors) }
  if (req.method !== 'POST') return { ok: false, response: json(405, REFUSAL.method, cors, { Allow: 'POST, OPTIONS' }) }
  const parsed = await readBoundedJsonBody(req, PUBLIC_BODY_MAX_BYTES)
  if (parsed.tooLarge) return { ok: false, response: json(413, REFUSAL.tooLarge, cors) }
  const body = parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown>
    : {}
  const config = upstashConfig(deps.env)
  if (!config) {
    deps.log(event, { outcome: 'rate_limit_unconfigured' })
    return { ok: false, response: json(503, REFUSAL.unavailable, cors) }
  }
  return { ok: true, cors, body, config, ip: requestIp(req) }
}

// --- Quadro ----------------------------------------------------------------

export type PublicScheduleCall = {
  port_code: string
  kind: 'pol' | 'pod'
  date: string | null
  actual: string | null
  omitted: boolean
}

export type PublicScheduleVoyage = {
  vessel_name: string
  voyage: string
  imo: string | null
  calls: PublicScheduleCall[]
}

export type PublicScheduleResponse = { voyages: PublicScheduleVoyage[]; updated_at: string }

const SCHEDULE_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const IMO = /^\d{7}$/

function text(value: unknown, max = 120): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null
}

function scheduleDate(value: unknown): string | null {
  const raw = text(value, 40)
  return raw && SCHEDULE_DATE.test(raw) ? raw : null
}

/**
 * Lista positiva do quadro: agrupa pela chave opaca do SQL e copia só os
 * campos da ADR 0114. Porto fora do quadro, tipo desconhecido e IMO fora do
 * formato não passam, mesmo que o SQL mude.
 */
export function projectPublicSchedule(rows: unknown, updatedAt: string): PublicScheduleResponse {
  const byKey = new Map<number, PublicScheduleVoyage>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const key = Number(record.voyage_key)
    const vessel = text(record.vessel_name)
    const voyage = text(record.voyage, 40)
    const port = text(record.port_code, 8)
    const kind = record.kind === 'pol' || record.kind === 'pod' ? record.kind : null
    if (!Number.isInteger(key) || !vessel || !voyage || !kind || !port) continue
    if (!(PUBLIC_SCHEDULE_PORT_CODES as readonly string[]).includes(port)) continue
    let entry = byKey.get(key)
    if (!entry) {
      if (byKey.size >= SCHEDULE_MAX_VOYAGES) continue
      const imo = text(record.imo, 16)
      entry = { vessel_name: vessel, voyage, imo: imo && IMO.test(imo) ? imo : null, calls: [] }
      byKey.set(key, entry)
    }
    entry.calls.push({
      port_code: port,
      kind,
      date: scheduleDate(record.date_value),
      actual: scheduleDate(record.actual_value),
      omitted: record.omitted === true,
    })
  }
  return { voyages: [...byKey.values()], updated_at: updatedAt }
}

/** Chaves do cache do quadro, por projeto Supabase. */
export function scheduleCacheKey(scope: string, part: 'fresh' | 'stale' | 'lock'): string {
  return `vela:public-cache:${scope}:schedule:v1:${part}`
}

export async function handlePublicSchedule(req: Request, deps: PublicFwlogDeps): Promise<Response> {
  const event = 'public_schedule'
  const start = await prelude(req, deps, event)
  if (!start.ok) return start.response
  const { cors, body, config, ip } = start

  try {
    const [count] = await upstash(config, deps, [
      ['EVAL', INCREMENT_SCRIPT, '1', await ipKey(config, 'public_schedule', ip), String(SCHEDULE_IP_WINDOW_SECONDS)],
    ])
    if (counterValue(count) > SCHEDULE_IP_LIMIT) {
      deps.log(event, { outcome: 'limited', ip: await ipTag(config, ip) })
      return json(429, REFUSAL.limit, cors, { 'Retry-After': String(SCHEDULE_IP_WINDOW_SECONDS) })
    }

    if (!await verifyPublicTurnstile(req, body.turnstile_token, TURNSTILE_ACTION.schedule, deps)) {
      deps.log(event, { outcome: 'challenge_refused', ip: await ipTag(config, ip) })
      return json(403, REFUSAL.challenge, cors)
    }

    const [fresh] = await upstash(config, deps, [['GET', scheduleCacheKey(config.scope, 'fresh')]])
    if (typeof fresh === 'string') {
      deps.log(event, { outcome: 'served', source: 'cache' })
      return json(200, JSON.parse(fresh), cors)
    }

    // Só quem pega a trava lê o banco; a trava vive o mesmo tempo do cache,
    // então o banco é lido no máximo uma vez por janela, com sucesso ou não.
    const [lock] = await upstash(config, deps, [['SET', scheduleCacheKey(config.scope, 'lock'), '1', 'NX', 'EX', String(SCHEDULE_CACHE_SECONDS)]])
    if (lock === 'OK') {
      const { data, error } = await deps.rpc('public_ship_schedule')
      if (error) {
        deps.log(event, { outcome: 'database_error' })
        return await serveStaleOr503(config, deps, cors, event)
      }
      const payload = JSON.stringify(projectPublicSchedule(data, new Date(deps.now()).toISOString()))
      await upstash(config, deps, [
        ['SET', scheduleCacheKey(config.scope, 'fresh'), payload, 'EX', String(SCHEDULE_CACHE_SECONDS)],
        ['SET', scheduleCacheKey(config.scope, 'stale'), payload, 'EX', String(SCHEDULE_STALE_SECONDS)],
      ])
      deps.log(event, { outcome: 'served', source: 'database' })
      return json(200, JSON.parse(payload), cors)
    }

    // Outra instância está relendo: espera o cache novo um pouco e, sem ele,
    // devolve a cópia anterior.
    for (let attempt = 0; attempt < 3; attempt++) {
      await deps.sleep(300)
      const [again] = await upstash(config, deps, [['GET', scheduleCacheKey(config.scope, 'fresh')]])
      if (typeof again === 'string') {
        deps.log(event, { outcome: 'served', source: 'cache' })
        return json(200, JSON.parse(again), cors)
      }
    }
    return await serveStaleOr503(config, deps, cors, event)
  } catch (error) {
    deps.log(event, { outcome: error instanceof UpstashUnavailable ? 'rate_limit_unavailable' : 'error' })
    return json(503, REFUSAL.unavailable, cors)
  }
}

async function serveStaleOr503(config: UpstashConfig, deps: PublicFwlogDeps, cors: Record<string, string>, event: string): Promise<Response> {
  const [stale] = await upstash(config, deps, [['GET', scheduleCacheKey(config.scope, 'stale')]])
  if (typeof stale === 'string') {
    deps.log(event, { outcome: 'served', source: 'stale' })
    return json(200, JSON.parse(stale), cors)
  }
  deps.log(event, { outcome: 'unavailable' })
  return json(503, REFUSAL.unavailable, cors)
}

// --- Busca por container ---------------------------------------------------

export type PublicContainer = {
  number: string
  type: string | null
  vessel_name: string | null
  voyage: string | null
  discharge_port: string | null
  discharge_date: string | null
  return_date: string | null
  free_time_days: number | null
  free_time_until: string | null
  situation: (typeof PUBLIC_LOOKUP_SITUATIONS)[number]
}

export type PublicLookupResponse =
  | { found: false }
  | { found: true; container: PublicContainer; consulted_at: string }

const ISO_LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24,
  N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
}

/**
 * Mesma regra de `parsePublicContainerNumber` (src/lib/containerNumber.ts) e
 * de `_iso6346_check_digit_valid` (migration 542): o teste compara as três.
 */
export function normalizePublicContainerNumber(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(normalized)) return null
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const char = normalized[i]
    sum += (i < 4 ? ISO_LETTER_VALUES[char] : Number(char)) * 2 ** i
  }
  return (sum % 11) % 10 === Number(normalized[10]) ? normalized : null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isoDate(value: unknown): string | null {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : null
}

/** Lista positiva da busca. Linha que não fecha com o número pedido vira "não encontrado". */
export function projectPublicContainer(rows: unknown, number: string): PublicContainer | null {
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  if (record.container_number !== number) return null
  const situation = PUBLIC_LOOKUP_SITUATIONS.find((value) => value === record.situation)
  const port = text(record.discharge_port, 8)
  if (!situation || !port || !(PUBLIC_LOOKUP_PORT_CODES as readonly string[]).includes(port)) return null
  const freeDays = typeof record.free_time_days === 'number' && Number.isInteger(record.free_time_days) && record.free_time_days >= 0
    ? record.free_time_days
    : null
  return {
    number,
    type: text(record.container_type, 12),
    vessel_name: text(record.vessel_name),
    voyage: text(record.voyage, 40),
    discharge_port: port,
    discharge_date: isoDate(record.discharge_date),
    return_date: isoDate(record.return_date),
    free_time_days: freeDays,
    free_time_until: freeDays === null ? null : isoDate(record.free_time_until),
    situation,
  }
}

export async function handlePublicContainerLookup(req: Request, deps: PublicFwlogDeps): Promise<Response> {
  const event = 'public_lookup'
  const start = await prelude(req, deps, event)
  if (!start.ok) return start.response
  const { cors, body, config, ip } = start

  try {
    const now = deps.now()
    const [minute, day, misses, globalMisses] = await upstash(config, deps, [
      ['EVAL', INCREMENT_SCRIPT, '1', await ipKey(config, 'public_lookup', ip), String(LOOKUP_IP_WINDOW_SECONDS)],
      ['EVAL', INCREMENT_SCRIPT, '1', await ipKey(config, 'public_lookup_day', ip), String(LOOKUP_IP_DAILY_WINDOW_SECONDS)],
      ['EVAL', CHECK_SCRIPT, '1', await ipKey(config, 'public_lookup_miss', ip)],
      ['EVAL', CHECK_SCRIPT, '1', globalMissKey(config.scope, now)],
    ])
    if (counterValue(globalMisses) >= LOOKUP_MISS_GLOBAL_HOURLY_LIMIT) {
      deps.log(event, { outcome: 'breaker_open' })
      return json(503, REFUSAL.unavailable, cors, { 'Retry-After': '3600' })
    }
    if (counterValue(minute) > LOOKUP_IP_LIMIT || counterValue(day) > LOOKUP_IP_DAILY_LIMIT || counterValue(misses) >= LOOKUP_MISS_IP_LIMIT) {
      deps.log(event, { outcome: 'limited', ip: await ipTag(config, ip) })
      return json(429, REFUSAL.limit, cors, { 'Retry-After': String(LOOKUP_IP_WINDOW_SECONDS) })
    }

    // Turnstile por consulta: cada token vale uma vez no Siteverify.
    if (!await verifyPublicTurnstile(req, body.turnstile_token, TURNSTILE_ACTION.lookup, deps)) {
      deps.log(event, { outcome: 'challenge_refused', ip: await ipTag(config, ip) })
      return json(403, REFUSAL.challenge, cors)
    }

    const number = normalizePublicContainerNumber(body.container_number)
    let container: PublicContainer | null = null
    if (number) {
      const { data, error } = await deps.rpc('public_container_lookup', { p_number: number })
      if (error) {
        deps.log(event, { outcome: 'database_error' })
        return json(503, REFUSAL.unavailable, cors)
      }
      container = projectPublicContainer(data, number)
    }

    if (!container) {
      // Número inválido, inexistente, fora da janela, cancelado, porto não
      // atendido ou SOC: a mesma resposta, o mesmo status e o mesmo tempo.
      await upstash(config, deps, [
        ['EVAL', INCREMENT_SCRIPT, '1', await ipKey(config, 'public_lookup_miss', ip), String(LOOKUP_MISS_IP_WINDOW_SECONDS)],
        ['EVAL', INCREMENT_SCRIPT, '1', globalMissKey(config.scope, now), '3600'],
      ])
      await padResponseTime(deps, now)
      deps.log(event, { outcome: 'not_found', ip: await ipTag(config, ip) })
      return json(200, { found: false } satisfies PublicLookupResponse, cors)
    }

    await padResponseTime(deps, now)
    deps.log(event, { outcome: 'found', ip: await ipTag(config, ip) })
    return json(200, { found: true, container, consulted_at: new Date(deps.now()).toISOString() } satisfies PublicLookupResponse, cors)
  } catch (error) {
    deps.log(event, { outcome: error instanceof UpstashUnavailable ? 'rate_limit_unavailable' : 'error' })
    return json(503, REFUSAL.unavailable, cors)
  }
}

async function padResponseTime(deps: PublicFwlogDeps, startedAt: number) {
  const elapsed = deps.now() - startedAt
  if (elapsed < LOOKUP_MIN_RESPONSE_MS) await deps.sleep(LOOKUP_MIN_RESPONSE_MS - elapsed)
}

// --- Execução no Deno ------------------------------------------------------

/** Dependências reais; o `index.ts` de cada função só entrega a RPC do cliente `service_role`. */
export function runtimeDeps(rpc: PublicFwlogDeps['rpc']): PublicFwlogDeps {
  const deno = (globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } }).Deno
  return {
    env: (name) => deno?.env.get(name),
    fetcher: fetch,
    rpc,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: defaultLog,
  }
}
