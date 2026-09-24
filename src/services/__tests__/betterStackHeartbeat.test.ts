import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { betterStackHeartbeatUrl, runWithBetterStackHeartbeat } from '../../../supabase/functions/_shared/betterStackHeartbeat.ts'

describe('heartbeats dos jobs no Better Stack', () => {
  it('deriva endpoints de sucesso e falha e rejeita URLs inseguras', () => {
    const url = 'https://uptime.betterstack.com/api/v1/heartbeat/token/'
    expect(betterStackHeartbeatUrl(url, 'success')).toBe(url.slice(0, -1))
    expect(betterStackHeartbeatUrl(url, 'failure')).toBe(`${url.slice(0, -1)}/fail`)
    expect(betterStackHeartbeatUrl(`${url}?customer=1`, 'success')).toBeNull()
    expect(betterStackHeartbeatUrl(url.replace('https:', 'http:'), 'success')).toBeNull()
  })

  it('emite sucesso sem corpo e preserva a resposta do job', async () => {
    const requests: string[] = []
    const expected = new Response(null, { status: 204 })
    const response = await runWithBetterStackHeartbeat('alertsDetector', () => expected, {
      getEnv: (name) => name === 'BETTERSTACK_HEARTBEAT_ALERTS_DETECTOR_URL'
        ? 'https://uptime.betterstack.com/api/v1/heartbeat/token'
        : undefined,
      fetcher: (input, init) => {
        requests.push(String(input))
        expect(init?.body).toBeUndefined()
        return Promise.resolve(new Response(null, { status: 200 }))
      },
    })

    expect(response).toBe(expected)
    expect(requests).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/token'])
  })

  it('sinaliza falhas operacionais em respostas 2xx sem consumir nem alterar o corpo', async () => {
    const requests: string[] = []
    const response = new Response(JSON.stringify({ failed: 1, releaseFailures: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const actual = await runWithBetterStackHeartbeat('customerCommunicationAutoRunner', () => response, {
      getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
      fetcher: (input) => {
        requests.push(String(input))
        return Promise.resolve(new Response(null, { status: 200 }))
      },
    })

    expect(actual).toBe(response)
    expect(requests).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/token/fail'])
    await expect(actual.json()).resolves.toEqual({ failed: 1, releaseFailures: 0 })
  })

  it('considera sucesso respostas 2xx com contadores operacionais zerados', async () => {
    const requests: string[] = []
    await runWithBetterStackHeartbeat('demurrageDunning', () => new Response(JSON.stringify({ failed: 0, partial: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }), {
      getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
      fetcher: (input) => {
        requests.push(String(input))
        return Promise.resolve(new Response(null, { status: 200 }))
      },
    })

    expect(requests).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/token'])
  })

  it('mapeia cada cron ativo observado para seu heartbeat sem incluir jobs inativos', () => {
    const entrypoints = {
      'alerts-detector': { job: 'alertsDetector', cronJob: 'alerts-foundation-detectors', schedule: '*/15 * * * *' },
      'demurrage-dunning': 'demurrageDunning',
      'customer-communication-auto-runner': 'customerCommunicationAutoRunner',
      'portal-daily-digest': 'portalDailyDigest',
    } as const

    const cronMigration = readFileSync(path.resolve('supabase/migrations/007_cron_secrets_no_vault.sql'), 'utf8')
    const expectedSchedules = [
      ['portal-daily-digest', '0 11 * * *', 'portal-daily-digest'],
      ['alerts-foundation-detectors', '*/15 * * * *', 'alerts-detector'],
      ['demurrage-dunning', '0 * * * *', 'demurrage-dunning'],
      ['customer-communication-auto-runner', '*/15 * * * *', 'customer-communication-auto-runner'],
    ] as const
    for (const [cronName, schedule, functionName] of expectedSchedules) {
      expect(cronMigration).toContain(`('${cronName}', '${schedule}'`)
      expect(cronMigration).toContain(`ops.dispatch_edge_job('${functionName}'`)
    }

    for (const [functionName, entrypoint] of Object.entries(entrypoints)) {
      const source = readFileSync(path.resolve('supabase/functions', functionName, 'index.ts'), 'utf8')
      const job = typeof entrypoint === 'string' ? entrypoint : entrypoint.job
      expect(source).toContain(`runWithBetterStackHeartbeat('${job}'`)
    }

    const helper = readFileSync(path.resolve('supabase/functions/_shared/betterStackHeartbeat.ts'), 'utf8')
    for (const inactive of ['portal-email-events-runner', 'import-effects-runner', 'recalc-demurrage-ptax']) {
      expect(helper).not.toContain(inactive)
    }
  })

  it('pula telemetria para chamadas não autorizadas', async () => {
    const response = new Response(null, { status: 401 })
    const fetcher = vi.fn()
    const actual = await runWithBetterStackHeartbeat('alertsDetector', () => response, {
      enabled: false,
      getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
      fetcher,
    })

    expect(actual).toBe(response)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('emite falha sem alterar respostas de erro ou exceções do job', async () => {
    const requests: string[] = []
    const options = {
      getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
      fetcher: (input: RequestInfo | URL) => {
        requests.push(String(input))
        return Promise.resolve(new Response(null, { status: 200 }))
      },
    }
    const response = new Response(null, { status: 503 })
    expect(await runWithBetterStackHeartbeat('portalDailyDigest', () => response, options)).toBe(response)
    expect(requests.at(-1)?.endsWith('/fail')).toBe(true)

    const error = new Error('private job detail')
    await expect(runWithBetterStackHeartbeat('demurrageDunning', () => Promise.reject(error), options)).rejects.toBe(error)
    expect(requests.at(-1)?.endsWith('/fail')).toBe(true)
    expect(requests.join(' ')).not.toContain('private job detail')
  })

  it('não deixa indisponibilidade ou timeout do Better Stack alterar o resultado', async () => {
    const expected = new Response('business result', { status: 202 })
    const response = await runWithBetterStackHeartbeat('customerCommunicationAutoRunner', () => expected, {
      getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
      timeoutMs: 1,
      fetcher: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true })
      }),
    })
    expect(response).toBe(expected)
  })
})
