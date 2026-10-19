import { describe, expect, it, vi } from 'vitest'
import { runPortalEmailEventsBatch, type EventsRunnerAdmin } from '../../../supabase/functions/_shared/portalEmailEventsRunner.ts'
import { runWithBetterStackHeartbeat } from '../../../supabase/functions/_shared/betterStackHeartbeat.ts'

// Plano dos e-mails, 2.3 (INF-08): o processamento dos eventos do provedor tem
// heartbeat; falha no claim ou num evento deixa o monitor vermelho. Só a
// falha no claim ou na devolução do evento vira erro HTTP (Sentry e o Alerta
// rotina_http_falhou); evento devolvido para nova tentativa responde 200.
const HEARTBEAT = 'https://uptime.betterstack.com/api/v1/heartbeat/eventos'

function fakeAdmin(options: { claimError?: boolean; completionError?: boolean; events?: number[] } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const admin: EventsRunnerAdmin = {
    rpc: (fn, args) => {
      calls.push({ fn, args })
      if (fn === 'claim_portal_email_events') {
        return Promise.resolve(options.claimError
          ? { data: null, error: { message: 'down' } }
          : { data: (options.events ?? []).map((id) => ({ id })), error: null })
      }
      return Promise.resolve({ data: null, error: options.completionError ? { message: 'lease' } : null })
    },
  }
  return { admin, calls }
}

async function runWithHeartbeat(admin: EventsRunnerAdmin, processEvent: (id: number) => Promise<{ status: string }>) {
  const pings: string[] = []
  const response = await runWithBetterStackHeartbeat('portalEmailEvents', async () => {
    const result = await runPortalEmailEventsBatch(admin, processEvent, 'worker-1')
    return new Response(JSON.stringify(result.body), { status: result.status })
  }, {
    getEnv: (name) => (name === 'BETTERSTACK_HEARTBEAT_PORTAL_EMAIL_EVENTS_URL' ? HEARTBEAT : undefined),
    fetcher: (input) => {
      pings.push(String(input))
      return Promise.resolve(new Response(null, { status: 200 }))
    },
  })
  return { response, pings, body: await response.json() }
}

describe('portal-email-events-runner', () => {
  it('rodada sem falha manda o ping de sucesso e conta cada desfecho', async () => {
    const { admin } = fakeAdmin({ events: [1, 2, 3] })
    const statuses: Record<number, string> = { 1: 'processed', 2: 'retry_wait', 3: 'investigate' }
    const { response, pings, body } = await runWithHeartbeat(admin, (id) => Promise.resolve({ status: statuses[id] }))
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ claimed: 3, processed: 1, retried: 1, investigated: 1, failed: 0, releaseFailures: 0 })
    expect(pings).toEqual([HEARTBEAT])
  })

  it('evento com exceção volta para nova tentativa: responde 200 com failed, os outros seguem e o heartbeat chama /fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { admin, calls } = fakeAdmin({ events: [1, 2] })
    const { response, pings, body } = await runWithHeartbeat(admin, (id) => (id === 1
      ? Promise.reject(new Error('falha no efeito'))
      : Promise.resolve({ status: 'processed' })))
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ claimed: 2, processed: 1, failed: 1, releaseFailures: 0 })
    expect(calls).toContainEqual({ fn: 'complete_portal_email_event', args: expect.objectContaining({ p_event_id: 1, p_status: 'retry_wait', p_error_code: 'runner_error' }) })
    expect(pings).toEqual([`${HEARTBEAT}/fail`])
    vi.restoreAllMocks()
  })

  it('falha no claim responde 500 e chama /fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const process = vi.fn()
    const { response, pings, body } = await runWithHeartbeat(fakeAdmin({ claimError: true }).admin, process)
    expect(response.status).toBe(500)
    expect(body.error).toBe('claim_failed')
    expect(process).not.toHaveBeenCalled()
    expect(pings).toEqual([`${HEARTBEAT}/fail`])
    vi.restoreAllMocks()
  })

  it('falha ao devolver o evento para nova tentativa responde 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await runPortalEmailEventsBatch(fakeAdmin({ events: [7], completionError: true }).admin, () => Promise.reject(new Error('x')), 'w')
    expect(result).toMatchObject({ status: 500, body: { failed: 1, releaseFailures: 1 } })
    vi.restoreAllMocks()
  })
})
