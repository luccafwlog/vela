import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  invocationSource,
  runCronWithBetterStackHeartbeat,
  type BetterStackHeartbeatJob,
} from '../../../supabase/functions/_shared/betterStackHeartbeat.ts'
import { runCeUnlockNotify } from '../../../supabase/functions/_shared/ceUnlockNotifyEmail.ts'
import { runAutomaticCommunications } from '../../../supabase/functions/_shared/customerCommunicationAutoRunner.ts'
import { runPortalEmailEventsBatch } from '../../../supabase/functions/_shared/portalEmailEventsRunner.ts'

// Migration 456: o banco chama três rotinas de e-mail pelo evento com
// {"source":"trigger"}; o cron segue chamando com {}. A Régua de Cobrança ficou
// só com o cron (457). A rodada é a mesma nos dois modos; o sucesso só sai da
// execução do cron, para a chamada do gatilho não esconder um cron parado, e a
// falha sai nos dois (decisão do dono de 2026-10-25, ADR 0102).

const CRON = '{}'
const TRIGGER = '{"source":"trigger"}'

function edgeRequest(body: string, method = 'POST'): Request {
  return new Request('https://edge.example.test/functions/v1/rotina', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? body : undefined,
  })
}

type Runner = {
  edge: string
  job: BetterStackHeartbeatJob
  // Roda a rodada com banco falso e devolve o que ela fez no banco.
  run: () => Promise<{ status: number; body: unknown; work: string[] }>
}

const runners: Runner[] = [
  {
    edge: 'ce-unlock-notify-email',
    job: 'ceUnlockNotifyEmail',
    run: async () => {
      const work: string[] = []
      const result = await runCeUnlockNotify({
        refreshOpen: async () => { work.push('ce_unlock_refresh_open'); return { data: 0, error: null } },
        providerConfigured: true,
        communicationsEnabled: async () => true,
        pending: async () => { work.push('ce_unlock_email_pending'); return [] },
        contacts: async () => [],
        allowed: async () => 'allowed',
        recipientKey: async (email) => email,
        send: async () => 'sent',
        finish: async () => {},
      })
      return { ...result, work }
    },
  },
  {
    edge: 'customer-communication-auto-runner',
    job: 'customerCommunicationAutoRunner',
    run: async () => {
      const work: string[] = []
      const result = await runAutomaticCommunications({
        rpc: (fn) => { work.push(fn); return Promise.resolve({ data: [], error: null }) },
        fetcher: vi.fn() as unknown as typeof fetch,
        supabaseUrl: 'https://supabase.example.test',
        anonKey: 'anon',
        secret: 'secret',
      })
      return { ...result, work }
    },
  },
  {
    edge: 'portal-email-events-runner',
    job: 'portalEmailEvents',
    run: async () => {
      const work: string[] = []
      const result = await runPortalEmailEventsBatch(
        { rpc: (fn) => { work.push(fn); return Promise.resolve({ data: [{ id: 5 }], error: null }) } },
        async (eventId) => { work.push(`processa ${eventId}`); return { status: 'processed' } },
        'worker-456',
      )
      return { ...result, work }
    },
  },
]

async function invoke(runner: Runner, body: string, authorized = true) {
  let work: string[] = []
  const { response, heartbeats } = await withHeartbeat(runner.job, body, authorized, async () => {
    const result = await runner.run()
    work = result.work
    return Response.json(result.body, { status: result.status })
  })
  return { status: response.status, body: await response.json(), work, heartbeats }
}

async function withHeartbeat(job: BetterStackHeartbeatJob, body: string, authorized: boolean, operation: () => Promise<Response>) {
  const heartbeats: string[] = []
  const response = await runCronWithBetterStackHeartbeat(job, edgeRequest(body), authorized, operation, {
    getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/rotina',
    fetcher: (input: RequestInfo | URL) => {
      heartbeats.push(String(input))
      return Promise.resolve(new Response(null, { status: 200 }))
    },
  })
  return { response, heartbeats }
}

const HEARTBEAT = 'https://uptime.betterstack.com/api/v1/heartbeat/rotina'

describe('rotinas de e-mail nos modos cron e gatilho (migration 456)', () => {
  for (const runner of runners) {
    it(`${runner.edge}: a rodada é a mesma nos dois modos e só o cron manda o sucesso`, async () => {
      const cron = await invoke(runner, CRON)
      const trigger = await invoke(runner, TRIGGER)

      expect(cron.status).toBe(200)
      expect(trigger.status).toBe(cron.status)
      expect(trigger.body).toEqual(cron.body)
      expect(cron.work.length).toBeGreaterThan(0)
      expect(trigger.work).toEqual(cron.work)
      expect(cron.heartbeats).toEqual([HEARTBEAT])
      expect(trigger.heartbeats).toEqual([])
    })
  }

  it('a falha sai nos dois modos: contagem de falha, resposta fora de 2xx e exceção', async () => {
    const failing = [
      () => Promise.resolve(Response.json({ sent: 0, failed: 1 })),
      () => Promise.resolve(Response.json({ error: 'Envio de e-mail não configurado' }, { status: 503 })),
    ]
    for (const operation of failing) {
      for (const body of [CRON, TRIGGER]) {
        expect((await withHeartbeat('customerCommunicationAutoRunner', body, true, operation)).heartbeats).toEqual([`${HEARTBEAT}/fail`])
      }
    }
    const error = new Error('rodada caiu')
    for (const body of [CRON, TRIGGER]) {
      const heartbeats: string[] = []
      await expect(runCronWithBetterStackHeartbeat('ceUnlockNotifyEmail', edgeRequest(body), true, () => Promise.reject(error), {
        getEnv: () => HEARTBEAT,
        fetcher: (input: RequestInfo | URL) => { heartbeats.push(String(input)); return Promise.resolve(new Response(null, { status: 200 })) },
      })).rejects.toBe(error)
      expect(heartbeats).toEqual([`${HEARTBEAT}/fail`])
    }
  })

  it('chamada não autorizada não reporta, nem com corpo de cron, nem com falha', async () => {
    const result = await invoke(runners[0], CRON, false)
    expect(result.heartbeats).toEqual([])
    const failed = await withHeartbeat('ceUnlockNotifyEmail', TRIGGER, false, () => Promise.resolve(new Response(null, { status: 401 })))
    expect(failed.heartbeats).toEqual([])
  })

  it('origem: só {"source":"trigger"} é gatilho; corpo vazio, inválido ou outro valor é cron', async () => {
    expect(await invocationSource(edgeRequest(TRIGGER))).toBe('trigger')
    expect(await invocationSource(edgeRequest(CRON))).toBe('cron')
    expect(await invocationSource(edgeRequest(''))).toBe('cron')
    expect(await invocationSource(edgeRequest('não é json'))).toBe('cron')
    expect(await invocationSource(edgeRequest('{"source":"manual"}'))).toBe('cron')
    expect(await invocationSource(edgeRequest('', 'GET'))).toBe('cron')
  })

  it('ler a origem não consome o corpo da requisição', async () => {
    const request = edgeRequest(TRIGGER)
    await invocationSource(request)
    expect(await request.json()).toEqual({ source: 'trigger' })
  })

  it('as três Edge Functions chamadas pelo banco distinguem a origem; as que só o cron chama seguem como estavam', () => {
    const source = (name: string) => readFileSync(path.resolve('supabase/functions', name, 'index.ts'), 'utf8')
    for (const runner of runners) {
      expect(source(runner.edge)).toMatch(new RegExp(`runCronWithBetterStackHeartbeat\\(['"]${runner.job}['"], req,`))
      expect(source(runner.edge)).not.toContain('runWithBetterStackHeartbeat(')
    }
    expect(source('alerts-detector')).toContain("runWithBetterStackHeartbeat('alertsDetector'")
    expect(source('demurrage-dunning')).toContain("runWithBetterStackHeartbeat('demurrageDunning'")
    expect(source('portal-daily-digest')).toContain("runWithBetterStackHeartbeat('portalDailyDigest'")
  })
})
