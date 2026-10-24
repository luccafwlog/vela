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
import { runDemurrageDunning, type DunningStore } from '../../../supabase/functions/_shared/demurrageDunningRunner.ts'
import { runPortalEmailEventsBatch } from '../../../supabase/functions/_shared/portalEmailEventsRunner.ts'

// Migration 447: o banco chama as quatro rotinas de e-mail pelo evento com
// {"source":"trigger"}; o cron segue chamando com {}. A rodada é a mesma nos
// dois modos; só a execução do cron reporta ao Better Stack, para a chamada do
// gatilho não esconder um cron parado.

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
    edge: 'demurrage-dunning',
    job: 'demurrageDunning',
    run: async () => {
      const work: string[] = []
      const store = {
        loadCommunicationsEnabled: async () => true,
        claimCandidates: async () => { work.push('claim_demurrage_dunning_candidates'); return [] },
      } as unknown as DunningStore
      const result = await runDemurrageDunning({ store, config: { portalUrl: 'https://portal.example.test/portal/billing' } })
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
        'worker-447',
      )
      return { ...result, work }
    },
  },
]

async function invoke(runner: Runner, body: string, authorized = true) {
  const heartbeats: string[] = []
  let work: string[] = []
  const response = await runCronWithBetterStackHeartbeat(runner.job, edgeRequest(body), authorized, async () => {
    const result = await runner.run()
    work = result.work
    return Response.json(result.body, { status: result.status })
  }, {
    getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/rotina',
    fetcher: (input: RequestInfo | URL) => {
      heartbeats.push(String(input))
      return Promise.resolve(new Response(null, { status: 200 }))
    },
  })
  return { status: response.status, body: await response.json(), work, heartbeats }
}

describe('rotinas de e-mail nos modos cron e gatilho (migration 447)', () => {
  for (const runner of runners) {
    it(`${runner.edge}: a rodada é a mesma nos dois modos e só o cron manda heartbeat`, async () => {
      const cron = await invoke(runner, CRON)
      const trigger = await invoke(runner, TRIGGER)

      expect(cron.status).toBe(200)
      expect(trigger.status).toBe(cron.status)
      expect(trigger.body).toEqual(cron.body)
      expect(cron.work.length).toBeGreaterThan(0)
      expect(trigger.work).toEqual(cron.work)
      expect(cron.heartbeats).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/rotina'])
      expect(trigger.heartbeats).toEqual([])
    })
  }

  it('chamada não autorizada não reporta, nem com corpo de cron', async () => {
    const result = await invoke(runners[0], CRON, false)
    expect(result.heartbeats).toEqual([])
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

  it('as quatro Edge Functions chamadas pelo banco usam o heartbeat só do cron; as que só o cron chama seguem como estavam', () => {
    const source = (name: string) => readFileSync(path.resolve('supabase/functions', name, 'index.ts'), 'utf8')
    for (const runner of runners) {
      expect(source(runner.edge)).toMatch(new RegExp(`runCronWithBetterStackHeartbeat\\(['"]${runner.job}['"], req,`))
      expect(source(runner.edge)).not.toContain('runWithBetterStackHeartbeat(')
    }
    expect(source('alerts-detector')).toContain("runWithBetterStackHeartbeat('alertsDetector'")
    expect(source('portal-daily-digest')).toContain("runWithBetterStackHeartbeat('portalDailyDigest'")
  })
})
