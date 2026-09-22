import {
  betterStackHeartbeatUrl,
  runWithBetterStackHeartbeat,
  type BetterStackHeartbeatJob,
} from './betterStackHeartbeat.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('derives success and failure URLs without query data', () => {
  const base = 'https://uptime.betterstack.com/api/v1/heartbeat/opaque-token/'
  assert(betterStackHeartbeatUrl(base, 'success') === base.slice(0, -1), 'expected success URL')
  assert(betterStackHeartbeatUrl(base, 'failure') === `${base.slice(0, -1)}/fail`, 'expected failure URL')
  assert(betterStackHeartbeatUrl(`${base}?customer_id=123`, 'success') === null, 'must reject query data')
  assert(betterStackHeartbeatUrl(base.replace('https:', 'http:'), 'success') === null, 'must require HTTPS')
})

Deno.test('reports success for successful job responses', async () => {
  const requested: string[] = []
  const job: BetterStackHeartbeatJob = 'alertsDetector'
  const response = await runWithBetterStackHeartbeat(job, () => new Response(null, { status: 204 }), {
    getEnv: (name) => name === 'BETTERSTACK_HEARTBEAT_ALERTS_DETECTOR_URL'
      ? 'https://uptime.betterstack.com/api/v1/heartbeat/token'
      : undefined,
    fetcher: (input, init) => {
      requested.push(String(input))
      assert(init?.body === undefined, 'heartbeat requests must not include job data')
      return Promise.resolve(new Response(null, { status: 200 }))
    },
  })
  assert(response.status === 204, 'must preserve original response')
  assert(requested.join(',') === 'https://uptime.betterstack.com/api/v1/heartbeat/token', 'expected success heartbeat')
})

Deno.test('uses a distinct environment variable for each scheduled production job', async () => {
  const names: string[] = []
  for (const job of [
    'alertsDetector',
    'demurrageDunning',
    'customerCommunicationAutoRunner',
    'portalDailyDigest',
  ] as const) {
    await runWithBetterStackHeartbeat(job, () => new Response(null, { status: 204 }), {
      getEnv: (name) => { names.push(name); return undefined },
    })
  }
  assert(new Set(names).size === 4, 'each job must use a distinct secret name')
  assert(names.every((name) => name.startsWith('BETTERSTACK_HEARTBEAT_')), 'secrets must be job-specific')
})

Deno.test('skips heartbeat traffic for calls that fail the cron authorization gate', async () => {
  let lookedUpSecret = false
  const response = new Response(null, { status: 401 })
  const actual = await runWithBetterStackHeartbeat('alertsDetector', () => response, {
    enabled: false,
    getEnv: () => { lookedUpSecret = true; return 'should-not-be-read' },
    fetcher: () => Promise.reject(new Error('must not be called')),
  })
  assert(actual === response, 'must retain the unauthorized response')
  assert(!lookedUpSecret, 'must not read a heartbeat secret for unauthorized calls')
})

Deno.test('reports failure for non-success responses and thrown job errors', async () => {
  const requested: string[] = []
  const options = {
    getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
    fetcher: (input: RequestInfo | URL) => {
      requested.push(String(input))
      return Promise.resolve(new Response(null, { status: 200 }))
    },
  }
  const response = await runWithBetterStackHeartbeat('portalDailyDigest', () => new Response(null, { status: 503 }), options)
  assert(response.status === 503, 'must preserve failed HTTP response')
  assert(requested.at(-1)?.endsWith('/fail'), '5xx response must report failure')

  const originalError = new Error('private operation detail')
  try {
    await runWithBetterStackHeartbeat('demurrageDunning', () => Promise.reject(originalError), options)
    throw new Error('expected operation error')
  } catch (error) {
    assert(error === originalError, 'must preserve original thrown error')
  }
  assert(requested.at(-1)?.endsWith('/fail'), 'thrown error must report failure')
  assert(requested.every((url) => !url.includes('private operation detail')), 'must not send error details')
})

Deno.test('keeps job results when Better Stack rejects or times out', async () => {
  const expected = new Response('business result', { status: 202 })
  const response = await runWithBetterStackHeartbeat('customerCommunicationAutoRunner', () => expected, {
    getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
    timeoutMs: 5,
    fetcher: (_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      assert(signal, 'heartbeat requests must be bounded by an abort signal')
      signal.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true })
    }),
  })
  assert(response === expected, 'must return the original result when telemetry times out')

  const rejectedResponse = await runWithBetterStackHeartbeat('portalDailyDigest', () => expected, {
    getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
    fetcher: () => Promise.reject(new Error('network unavailable')),
  })
  assert(rejectedResponse === expected, 'must return the original result when telemetry rejects')
})
