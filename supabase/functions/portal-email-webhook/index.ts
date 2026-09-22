import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix@1'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { logEdgeFailure } from '../_shared/logger.ts'

type ResendEvent = {
  type: string
  data?: {
    email_id?: string
    to?: string[]
    bounce?: { type?: string }
  }
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function minimalPayload(event: ResendEvent): Record<string, unknown> {
  const data = event.data ?? {}
  return {
    type: event.type,
    data: {
      email_id: data.email_id ?? null,
      // O provedor envia vários destinatários em alguns eventos; o domínio
      // usa o primeiro como destinatário da tentativa individual.
      to: Array.isArray(data.to) ? data.to.slice(0, 10) : [],
      ...(data.bounce?.type ? { bounce: { type: data.bounce.type } } : {}),
    },
  }
}

if (typeof Deno !== 'undefined') Deno.serve(instrumentEdgeHandler('portal-email-webhook', async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const payload = await req.text()
  const svixHeaders = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }
  if (!svixHeaders['svix-id']) return json(400, { error: 'missing_provider_event_id' })

  let event: ResendEvent
  try {
    event = new Webhook(Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '').verify(payload, svixHeaders, { tolerance: 300 }) as ResendEvent
  } catch {
    return json(401, { error: 'invalid_signature' })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'supabase_configuration_missing' })
  const admin = createClient(url, serviceKey)
  const eventPayload = minimalPayload(event)
  const providerMessageId = typeof eventPayload.data === 'object' && eventPayload.data !== null
    ? ((eventPayload.data as { email_id?: string }).email_id ?? null)
    : null

  const { data: existing, error: lookupError } = await admin
    .from('portal_email_events')
    .select('id, status')
    .eq('provider_event_id', svixHeaders['svix-id'])
    .maybeSingle() as { data: { id: number; status: string } | null; error: { code?: string; message?: string } | null }
  if (lookupError) {
    logEdgeFailure({ functionName: 'portal-email-webhook', job: 'deduplication', errorCode: 'deduplication_lookup_failed' })
    return json(500, { error: 'inbox_lookup_failed' })
  }
  if (existing) {
    // Duplicata processada é no-op; duplicata pendente continua respondendo
    // sucesso ao provedor, mas permanece elegível para o worker.
    return json(existing.status === 'processed' ? 200 : 202, {
      event_id: existing.id,
      status: existing.status,
      duplicate: true,
    })
  }

  const { data: inserted, error: insertError } = await admin
    .from('portal_email_events')
    .insert({
      provider_event_id: svixHeaders['svix-id'],
      provider_message_id: providerMessageId,
      event_type: event.type,
      payload: eventPayload,
      status: 'pending',
    })
    .select('id, status')
    .single() as { data: { id: number; status: string } | null; error: { code?: string; message?: string } | null }

  if (insertError?.code === '23505') {
    const { data: raced, error: raceLookupError } = await admin
      .from('portal_email_events')
      .select('id, status')
      .eq('provider_event_id', svixHeaders['svix-id'])
      .maybeSingle() as { data: { id: number; status: string } | null; error: { code?: string; message?: string } | null }
    if (raceLookupError || !raced) {
      logEdgeFailure({ functionName: 'portal-email-webhook', job: 'deduplication', errorCode: 'deduplication_race_unresolved' })
      return json(500, { error: 'inbox_race_lookup_failed' })
    }
    return json(raced.status === 'processed' ? 200 : 202, {
      event_id: raced.id,
      status: raced.status,
      duplicate: true,
    })
  }
  if (insertError || !inserted) {
    logEdgeFailure({ functionName: 'portal-email-webhook', job: 'inbox_persist', errorCode: 'inbox_persist_failed' })
    return json(500, { error: 'inbox_persist_failed' })
  }

  // O worker pode resolver o provider_message_id depois do recebimento. O
  // ACK só significa persistência durável, nunca processamento concluído.
  return json(202, { event_id: inserted.id, status: inserted.status ?? 'pending' })
}))
