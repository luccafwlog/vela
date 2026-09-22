import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { logEdgeFailure } from '../_shared/logger.ts'

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

if (typeof Deno !== 'undefined') {
  const edgeHandler = instrumentEdgeHandler('alerts-detector', async (req) => {
    if (req.method !== 'POST') return new Response(null, { status: 405 })

    const expectedSecret = Deno.env.get('ALERTS_DETECTOR_SECRET') ?? ''
    const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data, error } = await admin.rpc('run_alert_detectors')
    if (error) {
      logEdgeFailure({ functionName: 'alerts-detector', job: 'run_detectors', errorCode: 'unexpected_failure' })
      return new Response(JSON.stringify({ error: 'Detector execution failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify(data ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  Deno.serve((req) => {
    const expectedSecret = Deno.env.get('ALERTS_DETECTOR_SECRET') ?? ''
    const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const authorized = req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
    return runWithBetterStackHeartbeat('alertsDetector', () => edgeHandler(req), { enabled: authorized })
  })
}
