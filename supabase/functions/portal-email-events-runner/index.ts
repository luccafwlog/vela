import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { processPortalEmailEvent } from '../_shared/portalEmailEventProcessor.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { logPortalEmailEvent } from '../_shared/logger.ts'

type ClaimedEvent = { id: number }

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const expectedSecret = Deno.env.get('PORTAL_EMAIL_EVENTS_CRON_SECRET') ?? ''
  const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return json(401, { error: 'unauthorized' })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'supabase_configuration_missing' })

  const admin = createClient(url, serviceKey)
  const workerId = `portal-email-events-runner:${crypto.randomUUID()}`
  const { data, error } = await admin.rpc('claim_portal_email_events', {
    p_worker_id: workerId,
    p_limit: 50,
    p_lease_seconds: 300,
  })
  if (error) {
    logPortalEmailEvent({ job: 'event_claim', status: 'error', errorCode: 'event_claim_failed' })
    return json(500, { error: 'claim_failed' })
  }

  const events = (data ?? []) as ClaimedEvent[]
  let processed = 0
  let retried = 0
  let investigated = 0
  let failures = 0

  for (const event of events) {
    try {
      const result = await processPortalEmailEvent(admin, Number(event.id), workerId)
      if (result.status === 'processed') processed += 1
      else if (result.status === 'retry_wait') retried += 1
      else if (result.status === 'investigate') investigated += 1
    } catch {
      failures += 1
      logPortalEmailEvent({ job: 'event_processing', status: 'error', errorCode: 'event_processing_failed' })
      const { error: completionError } = await admin.rpc('complete_portal_email_event', {
        p_event_id: Number(event.id),
        p_worker_id: workerId,
        p_status: 'retry_wait',
        p_error_code: 'runner_error',
        p_error_message: 'Falha interna no processamento do evento.',
      })
      if (completionError) {
        failures += 1
        logPortalEmailEvent({ job: 'event_retry', status: 'error', errorCode: 'event_retry_enqueue_failed' })
      }
    }
  }

  return json(failures > 0 ? 500 : 200, {
    worker_id: workerId,
    claimed: events.length,
    processed,
    retried,
    investigated,
    failures,
  })
}

if (import.meta.main) Deno.serve(instrumentEdgeHandler('portal-email-events-runner', handler))
