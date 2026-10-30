// Contrato das Edge Functions públicas do fwlog.com.br (ADR 0114) contra
// Turnstile, Upstash e banco falsos: sem rede. Roda no passo Deno do CI
// (`deno test --config supabase/functions/deno.json`).
import {
  CHECK_SCRIPT,
  INCREMENT_SCRIPT,
} from './rateLimit.ts'
import {
  LOOKUP_IP_LIMIT,
  LOOKUP_MIN_RESPONSE_MS,
  LOOKUP_MISS_GLOBAL_HOURLY_LIMIT,
  LOOKUP_MISS_IP_LIMIT,
  SCHEDULE_IP_LIMIT,
  globalMissKey,
  scheduleCacheKey,
  handlePublicContainerLookup,
  handlePublicSchedule,
  normalizePublicContainerNumber,
  secondsUntilNextHour,
  type PublicFwlogDeps,
} from './publicFwlog.ts'
import { instrumentHttpHandler, type EdgeTelemetryContext } from '../../../src/lib/telemetryContract.ts'

function assert(condition: unknown, message = 'falhou'): asserts condition {
  if (!condition) throw new Error(message)
}
function assertEquals(actual: unknown, expected: unknown, message = '') {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n esperado: ${e}\n recebido: ${a}`)
}

const ORIGIN = 'https://portalfwlog.com.br'
const IP = '203.0.113.77'
const FOUND = 'CSQU3054383'

// Lista positiva: se a resposta ganhar uma chave, este teste falha.
const SCHEDULE_KEYS = ['updated_at', 'voyages']
const VOYAGE_KEYS = ['calls', 'imo', 'vessel_name', 'voyage']
const CALL_KEYS = ['actual', 'date', 'kind', 'omitted', 'port_code']
const FOUND_KEYS = ['consulted_at', 'container', 'found']
const CONTAINER_KEYS = ['discharge_date', 'discharge_port', 'free_time_days', 'free_time_until', 'number', 'return_date', 'situation', 'type', 'vessel_name', 'voyage']

type Turnstile = { success: boolean; action: string; hostname: string }

function harness(options: {
  env?: Record<string, string | undefined>
  turnstile?: Partial<Turnstile>
  upstashDown?: boolean
  rows?: unknown
  rpcError?: boolean
  store?: Map<string, string>
} = {}) {
  const env: Record<string, string | undefined> = {
    PUBLIC_FWLOG_ALLOWED_ORIGINS: ORIGIN,
    TURNSTILE_PUBLIC_SECRET_KEY: 'segredo-publico',
    TURNSTILE_PUBLIC_ALLOWED_HOSTNAMES: 'portalfwlog.com.br',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'token',
    PORTAL_RATE_LIMIT_HMAC_SECRET: 'hmac',
    SUPABASE_URL: 'https://projeto.supabase.co',
    ...options.env,
  }
  const store = options.store ?? new Map<string, string>()
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const logs: string[] = []
  const siteverify: unknown[] = []
  let clock = 1_800_000_000_000
  let turnstile: Turnstile = { success: true, action: '', hostname: 'portalfwlog.com.br', ...options.turnstile }

  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://challenges.cloudflare.com/')) {
      const sent = JSON.parse(String(init?.body)) as { response: string }
      siteverify.push(sent)
      // Sem action forçada, o token do teste é a própria action (schedule/lookup).
      return new Response(JSON.stringify({ ...turnstile, action: turnstile.action || sent.response }))
    }
    if (url === 'https://redis.example.test/pipeline') {
      if (options.upstashDown) return new Response('down', { status: 503 })
      const commands = JSON.parse(String(init?.body)) as string[][]
      return new Response(JSON.stringify(commands.map((command) => {
        const [name, ...args] = command
        if (name === 'EVAL' && args[0] === INCREMENT_SCRIPT) {
          const count = Number(store.get(args[2]) ?? 0) + 1
          store.set(args[2], String(count))
          return { result: [count, 60] }
        }
        if (name === 'EVAL' && args[0] === CHECK_SCRIPT) return { result: [Number(store.get(args[2]) ?? 0), 60] }
        if (name === 'GET') return { result: store.get(args[0]) ?? null }
        if (name === 'SET') {
          if (args.includes('NX') && store.has(args[0])) return { result: null }
          store.set(args[0], args[1])
          return { result: 'OK' }
        }
        return { error: 'comando desconhecido' }
      })))
    }
    throw new Error(`rede inesperada: ${url}`)
  }) as typeof fetch

  const deps: PublicFwlogDeps = {
    env: (name) => env[name],
    fetcher,
    rpc: (fn, args) => {
      rpcCalls.push({ fn, args })
      if (options.rpcError) return Promise.resolve({ data: null, error: { message: 'falha' } })
      return Promise.resolve({ data: typeof options.rows === 'function' ? (options.rows as (a: unknown) => unknown)(args) : options.rows ?? [], error: null })
    },
    now: () => clock,
    sleep: (ms) => { clock += ms; return Promise.resolve() },
    log: (event, details) => logs.push(JSON.stringify({ event, ...details })),
  }
  return {
    deps, store, rpcCalls, logs, siteverify,
    setTurnstile: (value: Partial<Turnstile>) => { turnstile = { ...turnstile, ...value } },
    advance: (ms: number) => { clock += ms },
    get clock() { return clock },
  }
}

function request(body: unknown, init: { origin?: string | null; method?: string; ip?: string; raw?: string } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'CF-Connecting-IP': init.ip ?? IP })
  if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN)
  const method = init.method ?? 'POST'
  return new Request('https://projeto.supabase.co/functions/v1/x', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : init.raw ?? JSON.stringify(body),
  })
}

const SCHEDULE_ROWS = [
  { voyage_key: 1, vessel_name: 'NAVIO A', voyage: '001', imo: '9514001', port_code: 'CNSHA', kind: 'pol', date_value: '2026-09-01', actual_value: '2026-09-02', omitted: false, voyage_id: 77, customer: 'x' },
  { voyage_key: 1, vessel_name: 'NAVIO A', voyage: '001', imo: '9514001', port_code: 'BRSUA', kind: 'pod', date_value: '2026-10-20', actual_value: null, omitted: false },
  { voyage_key: 1, vessel_name: 'NAVIO A', voyage: '001', imo: '9514001', port_code: 'BRSSZ', kind: 'pod', date_value: '2026-10-25', actual_value: null, omitted: false },
  { voyage_key: 2, vessel_name: 'NAVIO B', voyage: '002', imo: 'javascript:alert(1)', port_code: 'BRPEC', kind: 'pod', date_value: null, actual_value: null, omitted: true },
]

const FOUND_ROW = {
  container_number: FOUND, container_type: '40HC', vessel_name: 'NAVIO A', voyage: '001', discharge_port: 'BRSSA',
  discharge_date: '2026-10-20', return_date: null, free_time_days: 14, free_time_until: '2026-11-03', situation: 'no_prazo',
  bl_id: 'BL-SECRETO', customer_name: 'Cliente', ce_mercante: '123', demurrage_usd: 100,
}

async function body(response: Response) {
  return await response.json() as Record<string, unknown>
}

// --- Quadro -------------------------------------------------------------------

Deno.test('quadro: devolve só a lista positiva, sem porto fora do quadro nem IMO fora do formato', async () => {
  const h = harness({ rows: SCHEDULE_ROWS })
  const response = await handlePublicSchedule(request({ turnstile_token: 'schedule' }), h.deps)
  assertEquals(response.status, 200)
  assertEquals(response.headers.get('Access-Control-Allow-Origin'), ORIGIN)
  assertEquals(response.headers.get('Cache-Control'), 'no-store')
  const data = await body(response)
  assertEquals(Object.keys(data).sort(), SCHEDULE_KEYS)
  const voyages = data.voyages as Array<Record<string, unknown>>
  for (const voyage of voyages) {
    assertEquals(Object.keys(voyage).sort(), VOYAGE_KEYS)
    for (const call of voyage.calls as Array<Record<string, unknown>>) assertEquals(Object.keys(call).sort(), CALL_KEYS)
  }
  assertEquals(voyages.map((voyage) => [voyage.vessel_name, voyage.imo, (voyage.calls as Array<{ port_code: string }>).map((call) => call.port_code)]), [
    ['NAVIO A', '9514001', ['CNSHA', 'BRSUA']],
    ['NAVIO B', null, ['BRPEC']],
  ])
  assertEquals(h.siteverify, [{ secret: 'segredo-publico', response: 'schedule' }])
})

Deno.test('quadro: a action do Turnstile é "schedule"; outra action recusa', async () => {
  const ok = harness({ rows: [] })
  assertEquals((await handlePublicSchedule(request({ turnstile_token: 'schedule' }), ok.deps)).status, 200)
  const wrong = harness({ rows: [], turnstile: { action: 'lookup' } })
  assertEquals((await handlePublicSchedule(request({ turnstile_token: 'schedule' }), wrong.deps)).status, 403)
  assertEquals(wrong.rpcCalls.length, 0)
})

Deno.test('quadro: o banco é lido uma vez por janela, qualquer que seja o tráfego', async () => {
  const h = harness({ rows: SCHEDULE_ROWS })
  for (let i = 0; i < 5; i++) {
    const response = await handlePublicSchedule(request({ turnstile_token: 'schedule' }, { ip: `198.51.100.${i}` }), h.deps)
    assertEquals(response.status, 200)
  }
  assertEquals(h.rpcCalls.length, 1)
})

Deno.test('quadro: staging e produção no mesmo Upstash não dividem cache nem disjuntor', async () => {
  const shared = new Map<string, string>()
  const staging = harness({ store: shared, rows: [{ ...SCHEDULE_ROWS[0], vessel_name: 'NAVIO DE TESTE' }], env: { SUPABASE_URL: 'https://staging.supabase.co' } })
  const production = harness({ store: shared, rows: SCHEDULE_ROWS })
  await handlePublicSchedule(request({ turnstile_token: 'schedule' }), staging.deps)
  const response = await handlePublicSchedule(request({ turnstile_token: 'schedule' }), production.deps)
  assertEquals(production.rpcCalls.length, 1)
  assert(!JSON.stringify(await body(response)).includes('NAVIO DE TESTE'), 'produção recebeu o cache do staging')

  shared.set(globalMissKey('staging.supabase.co', production.clock), String(LOOKUP_MISS_GLOBAL_HOURLY_LIMIT))
  const lookup = harness({ store: shared, rows: [FOUND_ROW] })
  assertEquals((await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), lookup.deps)).status, 200)
})

Deno.test('quadro: outra instância com a trava e sem cache serve a cópia anterior; sem ela, 503', async () => {
  const h = harness({ rows: SCHEDULE_ROWS })
  h.store.set(scheduleCacheKey('projeto.supabase.co', 'lock'), '1')
  assertEquals((await handlePublicSchedule(request({ turnstile_token: 'schedule' }), h.deps)).status, 503)
  h.store.set(scheduleCacheKey('projeto.supabase.co', 'stale'), JSON.stringify({ voyages: [], updated_at: 'x' }))
  assertEquals((await handlePublicSchedule(request({ turnstile_token: 'schedule' }, { ip: '198.51.100.9' }), h.deps)).status, 200)
  assertEquals(h.rpcCalls.length, 0)
})

Deno.test('quadro: limite por IP', async () => {
  const h = harness({ rows: [] })
  for (let i = 0; i < SCHEDULE_IP_LIMIT; i++) assertEquals((await handlePublicSchedule(request({ turnstile_token: 'schedule' }), h.deps)).status, 200)
  assertEquals((await handlePublicSchedule(request({ turnstile_token: 'schedule' }), h.deps)).status, 429)
})

// --- Recusas comuns -----------------------------------------------------------

for (const [name, handler] of [['quadro', handlePublicSchedule], ['busca', handlePublicContainerLookup]] as const) {
  const payload = { turnstile_token: 'lookup', container_number: FOUND }

  Deno.test(`${name}: Turnstile sem secret, sem hostnames, token ausente, inválido ou de outro hostname recusa`, async () => {
    const cases: Array<ReturnType<typeof harness>> = [
      harness({ env: { TURNSTILE_PUBLIC_SECRET_KEY: undefined }, rows: [FOUND_ROW] }),
      harness({ env: { TURNSTILE_PUBLIC_ALLOWED_HOSTNAMES: '' }, rows: [FOUND_ROW] }),
      harness({ turnstile: { success: false }, rows: [FOUND_ROW] }),
      harness({ turnstile: { hostname: 'evil.example' }, rows: [FOUND_ROW] }),
    ]
    for (const h of cases) {
      assertEquals((await handler(request(payload), h.deps)).status, 403)
      assertEquals(h.rpcCalls.length, 0)
    }
    // O secret do login do Portal não serve para os widgets públicos.
    const loginSecret = harness({ env: { TURNSTILE_PUBLIC_SECRET_KEY: undefined, TURNSTILE_SECRET_KEY: 'do-login' }, rows: [FOUND_ROW] })
    assertEquals((await handler(request(payload), loginSecret.deps)).status, 403)
    const noToken = harness({ rows: [FOUND_ROW] })
    assertEquals((await handler(request({ container_number: FOUND }), noToken.deps)).status, 403)
    assertEquals(noToken.siteverify.length, 0)
  })

  Deno.test(`${name}: Upstash fora do ar ou sem configuração recusa (fail-closed)`, async () => {
    const down = harness({ upstashDown: true, rows: [FOUND_ROW] })
    assertEquals((await handler(request(payload), down.deps)).status, 503)
    const unset = harness({ env: { UPSTASH_REDIS_REST_TOKEN: undefined }, rows: [FOUND_ROW] })
    assertEquals((await handler(request(payload), unset.deps)).status, 503)
    const disabled = harness({ upstashDown: true, env: { PORTAL_RATE_LIMIT_ENABLED: 'false' }, rows: [FOUND_ROW] })
    assertEquals((await handler(request(payload), disabled.deps)).status, 503)
    assertEquals(down.rpcCalls.length + unset.rpcCalls.length + disabled.rpcCalls.length, 0)
  })

  Deno.test(`${name}: CORS só para a origem configurada; outra, sem origem ou sem lista recusa`, async () => {
    const h = harness({ rows: [FOUND_ROW] })
    const evil = await handler(request(payload, { origin: 'https://evil.example' }), h.deps)
    assertEquals(evil.status, 403)
    assertEquals(evil.headers.get('Access-Control-Allow-Origin'), null)
    assertEquals((await handler(request(payload, { origin: null }), h.deps)).status, 403)
    assertEquals((await handler(request(payload, { origin: 'null' }), h.deps)).status, 403)
    const fwlog = await handler(request(payload, { origin: 'https://fwlog.com.br' }), h.deps)
    assertEquals(fwlog.status, 403, 'o WordPress não chama a Edge: o iframe roda na origem do Portal')
    const empty = harness({ env: { PUBLIC_FWLOG_ALLOWED_ORIGINS: undefined }, rows: [FOUND_ROW] })
    assertEquals((await handler(request(payload), empty.deps)).status, 403)
    const preflight = await handler(request(null, { method: 'OPTIONS' }), h.deps)
    assertEquals(preflight.status, 204)
    assertEquals(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
    assertEquals((await handler(request(null, { method: 'GET' }), h.deps)).status, 405)
    assertEquals(h.rpcCalls.length, 0)
  })

  Deno.test(`${name}: corpo acima do limite recusa com 413 antes de qualquer conferência`, async () => {
    const h = harness({ rows: [FOUND_ROW] })
    const response = await handler(request(null, { raw: JSON.stringify({ turnstile_token: 'x'.repeat(10_000) }) }), h.deps)
    assertEquals(response.status, 413)
    assertEquals(h.siteverify.length, 0)
  })
}

// --- Busca --------------------------------------------------------------------

Deno.test('busca: achou devolve só a lista positiva, com a action "lookup"', async () => {
  const h = harness({ rows: [FOUND_ROW] })
  const response = await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: ' csqu 305438-3 ' }), h.deps)
  assertEquals(response.status, 200)
  assertEquals(response.headers.get('Cache-Control'), 'no-store')
  const data = await body(response)
  assertEquals(Object.keys(data).sort(), FOUND_KEYS)
  assertEquals(Object.keys(data.container as object).sort(), CONTAINER_KEYS)
  assertEquals((data.container as Record<string, unknown>).number, FOUND)
  assertEquals(h.rpcCalls, [{ fn: 'public_container_lookup', args: { p_number: FOUND } }])
  const wrongAction = harness({ rows: [FOUND_ROW], turnstile: { action: 'schedule' } })
  assertEquals((await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), wrongAction.deps)).status, 403)
})

Deno.test('busca: dígito inválido, formato inválido, sem linha e linha de outro número dão a mesma resposta', async () => {
  const outcomes: string[] = []
  for (const [number, rows] of [
    ['CSQU3054384', [FOUND_ROW]],
    ['CSQ3054383', [FOUND_ROW]],
    ["CSQU' OR 1=1", [FOUND_ROW]],
    [FOUND, []],
    [FOUND, [{ ...FOUND_ROW, container_number: 'MSKU1234565' }]],
    [FOUND, [{ ...FOUND_ROW, discharge_port: 'BRSSZ' }]],
  ] as const) {
    const h = harness({ rows })
    const started = h.clock
    const response = await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: number }), h.deps)
    outcomes.push(`${response.status} ${JSON.stringify(await body(response))} ${response.headers.get('Cache-Control')}`)
    assert(h.clock - started >= LOOKUP_MIN_RESPONSE_MS, 'resposta sem o tempo mínimo')
  }
  assertEquals(new Set(outcomes).size, 1)
  assertEquals(outcomes[0], '200 {"found":false} no-store')
})

Deno.test('busca: achou também espera o tempo mínimo', async () => {
  const h = harness({ rows: [FOUND_ROW] })
  const started = h.clock
  await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), h.deps)
  assert(h.clock - started >= LOOKUP_MIN_RESPONSE_MS)
})

Deno.test('busca: limite por IP, teto de "não encontrado" por IP e disjuntor global', async () => {
  const perIp = harness({ rows: [FOUND_ROW] })
  for (let i = 0; i < LOOKUP_IP_LIMIT; i++) assertEquals((await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), perIp.deps)).status, 200)
  assertEquals((await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), perIp.deps)).status, 429)

  const misses = harness({ rows: [] })
  for (let i = 0; i < LOOKUP_MISS_IP_LIMIT; i++) assertEquals((await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), misses.deps)).status, 200)
  assertEquals((await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), misses.deps)).status, 429)

  const breaker = harness({ rows: [] })
  breaker.store.set(globalMissKey('projeto.supabase.co', breaker.clock), String(LOOKUP_MISS_GLOBAL_HOURLY_LIMIT))
  const response = await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }, { ip: '192.0.2.1' }), breaker.deps)
  assertEquals(response.status, 429)
  assertEquals(await body(response), { error: 'indisponivel' })
  assertEquals(response.headers.get('Retry-After'), String(secondsUntilNextHour(breaker.clock)))
  assertEquals(breaker.rpcCalls.length, 0)
  assertEquals(breaker.siteverify.length, 0)
})

Deno.test('busca: disjuntor aberto não vai ao Sentry e não passa por cima do limite por IP', async () => {
  // O mesmo wrapper das Edges (`instrumentEdgeHandler`), com um Sentry falso.
  const reported: EdgeTelemetryContext[] = []
  const report = (_error: unknown, context: EdgeTelemetryContext) => { reported.push(context); return Promise.resolve() }

  const h = harness({ rows: [FOUND_ROW] })
  h.store.set(globalMissKey('projeto.supabase.co', h.clock), String(LOOKUP_MISS_GLOBAL_HOURLY_LIMIT))
  const handler = instrumentHttpHandler('public-container-lookup', (req) => handlePublicContainerLookup(req, h.deps), report)
  const answers: string[] = []
  for (let i = 0; i <= LOOKUP_IP_LIMIT; i++) {
    const response = await handler(request({ turnstile_token: 'lookup', container_number: FOUND }))
    answers.push(`${response.status} ${(await body(response)).error}`)
  }
  // Dentro do limite do IP, "indisponível"; quem insiste passa ao próprio limite.
  assertEquals(answers.slice(0, LOOKUP_IP_LIMIT), Array(LOOKUP_IP_LIMIT).fill('429 indisponivel'))
  assertEquals(answers[LOOKUP_IP_LIMIT], '429 limite_atingido')
  assertEquals(reported, [])
  assertEquals(h.rpcCalls.length, 0)
  assertEquals(h.siteverify.length, 0)

  // Controle: falha de verdade (Upstash fora do ar) continua indo ao Sentry.
  const down = harness({ upstashDown: true, rows: [FOUND_ROW] })
  const failing = instrumentHttpHandler('public-container-lookup', (req) => handlePublicContainerLookup(req, down.deps), report)
  assertEquals((await failing(request({ turnstile_token: 'lookup', container_number: FOUND }))).status, 503)
  assertEquals(reported.map((context) => context.status), ['http_503'])
})

Deno.test('disjuntor: Retry-After até a hora UTC virar', () => {
  const hour = 3_600_000
  assertEquals(secondsUntilNextHour(500_000 * hour), 3600)
  assertEquals(secondsUntilNextHour(500_000 * hour + 1), 3600)
  assertEquals(secondsUntilNextHour(500_000 * hour + hour - 1000), 1)
  assertEquals(secondsUntilNextHour(500_000 * hour + hour - 1), 1)
})

Deno.test('busca: falha do banco é indisponibilidade, não "não encontrado"', async () => {
  const h = harness({ rpcError: true })
  assertEquals((await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), h.deps)).status, 503)
})

Deno.test('logs e chaves do Redis sem número de container nem IP em claro', async () => {
  const h = harness({ rows: [] })
  await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), h.deps)
  const found = harness({ rows: [FOUND_ROW] })
  await handlePublicContainerLookup(request({ turnstile_token: 'lookup', container_number: FOUND }), found.deps)
  await handlePublicSchedule(request({ turnstile_token: 'schedule' }), found.deps)
  const everything = [...h.logs, ...found.logs, ...h.store.keys(), ...found.store.keys()].join('\n')
  assert(h.logs.length > 0 && found.logs.length > 0)
  assert(!everything.includes(FOUND), 'número do container no log ou na chave')
  assert(!everything.includes(IP), 'IP em claro no log ou na chave')
})

Deno.test('normalização do número: maiúsculas, sem símbolo, categoria U/J/Z e dígito ISO 6346', () => {
  assertEquals(normalizePublicContainerNumber('csqu-305438 3'), FOUND)
  assertEquals(normalizePublicContainerNumber('CSQU3054384'), null)
  assertEquals(normalizePublicContainerNumber('CSQX3054383'), null)
  assertEquals(normalizePublicContainerNumber('CSQU305438'), null)
  assertEquals(normalizePublicContainerNumber(42), null)
  assertEquals(normalizePublicContainerNumber(`${FOUND}${' '.repeat(80)}`), null)
})
