import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { runCronWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { processPortalEmailEvent } from '../_shared/portalEmailEventProcessor.ts'
import { runPortalEmailEventsBatch } from '../_shared/portalEmailEventsRunner.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

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

function isAuthorized(req: Request): boolean {
  const expectedSecret = Deno.env.get('PORTAL_EMAIL_EVENTS_CRON_SECRET') ?? ''
  const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  return req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!isAuthorized(req)) return json(401, { error: 'unauthorized' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'supabase_configuration_missing' })

  const admin = createClient(url, serviceKey)
  const workerId = `portal-email-events-runner:${crypto.randomUUID()}`
  const result = await runPortalEmailEventsBatch(
    admin,
    (eventId, worker) => processPortalEmailEvent(admin, eventId, worker),
    workerId,
  )
  return json(result.status, result.body)
}

if (import.meta.main) {
  const edgeHandler = instrumentEdgeHandler('portal-email-events-runner', handler)
  // Heartbeat só para chamada autorizada do cron (plano dos e-mails, 2.3);
  // manda /fail com resposta não-2xx (falha no claim ou na devolução do
  // evento) ou com `failed > 0` (evento devolvido para nova tentativa). O
  // evento gravado pelo webhook (migration 456) chama com {"source":"trigger"},
  // que reporta só a falha.
  Deno.serve((req) => runCronWithBetterStackHeartbeat('portalEmailEvents', req, isAuthorized(req), () => edgeHandler(req)))
}
