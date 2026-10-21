import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { alertDetectorFailureContexts } from '../../../supabase/functions/_shared/alertDetectorFailures.ts'
import { runWithBetterStackHeartbeat } from '../../../supabase/functions/_shared/betterStackHeartbeat.ts'
import { applyEdgeTelemetryScope } from '../../../supabase/functions/_shared/telemetryScope.ts'

// Migration 351 (decisão P5): rodada parcial do detector de alertas. Os outros
// detectores valeram, a resposta é 2xx, o heartbeat vai para /fail e o Sentry
// recebe um evento por detector que falhou.
const partialRound = {
  agency_report_pending: 0,
  voyage_operation_alerts: null,
  client_portal: { customers_scanned: 3 },
  failed: 1,
  failures: [{ detector: 'detect_voyage_operation_alerts', sqlstate: '22007', message: 'invalid input syntax for type date: "31/12/2026"' }],
}

function fingerprintOf(context: Parameters<typeof applyEdgeTelemetryScope>[1]) {
  let fingerprint: string[] = []
  const tags: Record<string, string> = {}
  applyEdgeTelemetryScope({
    setTag: (key, value) => { tags[key] = value },
    setFingerprint: (value) => { fingerprint = value },
  }, context)
  return { fingerprint, tags }
}

describe('detector de alertas com rodada parcial', () => {
  it('um evento por detector que falhou, com o nome e o SQLSTATE, sem a mensagem do banco', () => {
    const contexts = alertDetectorFailureContexts(partialRound)
    expect(contexts).toEqual([{
      functionName: 'alerts-detector',
      status: 'detector_failed:detect_voyage_operation_alerts',
      category: 'detector_failed',
      result: 'partial',
      failedRpc: 'run_alert_detectors',
      errorCode: '22007',
    }])
    expect(JSON.stringify(contexts)).not.toContain('31/12/2026')
  })

  it('detectores diferentes caem em issues diferentes do Sentry', () => {
    const [voyage, portal] = alertDetectorFailureContexts({
      failed: 2,
      failures: [
        { detector: 'detect_voyage_operation_alerts', sqlstate: '22007' },
        { detector: 'reconcile_client_portal_alerts', sqlstate: 'P0001' },
      ],
    })
    expect(fingerprintOf(voyage).fingerprint).toEqual(['edge', 'alerts-detector', 'detector_failed:detect_voyage_operation_alerts'])
    expect(fingerprintOf(portal).fingerprint).toEqual(['edge', 'alerts-detector', 'detector_failed:reconcile_client_portal_alerts'])
    expect(fingerprintOf(portal).tags).toMatchObject({ codigo_erro: 'P0001', rpc: 'run_alert_detectors', result: 'partial' })
  })

  it('rodada limpa ou corpo inesperado não gera evento; nome ou código fora do formato não vazam', () => {
    expect(alertDetectorFailureContexts({ failed: 0, failures: [] })).toEqual([])
    expect(alertDetectorFailureContexts(null)).toEqual([])
    expect(alertDetectorFailureContexts({ agency_report_pending: 0 })).toEqual([])
    expect(alertDetectorFailureContexts({ failures: 'x' })).toEqual([])
    const odd = alertDetectorFailureContexts({ failures: [
      { detector: 'Cliente X; drop', sqlstate: '22007' },
      { detector: 'detect_email_monitoring_alerts', sqlstate: 'mensagem com dado' },
    ] })
    expect(odd).toHaveLength(1)
    expect(odd[0]).not.toHaveProperty('errorCode')
  })

  it('o corpo da rodada parcial manda o heartbeat para /fail e a resposta continua 2xx', async () => {
    const requests: string[] = []
    const response = await runWithBetterStackHeartbeat('alertsDetector', () => new Response(
      JSON.stringify({ ...partialRound, orphaned_dispute_attachments_removed: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ), {
      getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
      fetcher: (input) => {
        requests.push(String(input))
        return Promise.resolve(new Response(null, { status: 200 }))
      },
    })
    expect(response.status).toBe(200)
    expect(requests).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/token/fail'])
  })

  it('a Edge reporta cada falha antes de responder', () => {
    const source = readFileSync('supabase/functions/alerts-detector/index.ts', 'utf8')
    expect(source).toMatch(/for \(const context of alertDetectorFailureContexts\(data\)\)[\s\S]*captureEdgeException\(/)
  })
})
