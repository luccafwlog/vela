import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { Webhook } from 'https://esm.sh/svix@1.99.1'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { isBodyTooLarge, readBoundedText } from '../_shared/boundedBody.ts'

// Evento do Resend/MillionSend é um JSON de poucos KiB; o teto só existe para
// não ler um corpo arbitrário antes de conferir a assinatura.
const MAX_EVENT_BYTES = 256 * 1024

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

  const svixHeaders = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }
  // Cabeçalhos conferidos antes de ler o corpo: sem eles a assinatura nunca vale.
  if (!svixHeaders['svix-id']) return json(400, { error: 'missing_provider_event_id' })
  if (!svixHeaders['svix-timestamp'] || !svixHeaders['svix-signature']) return json(401, { error: 'invalid_signature' })

  let payload: string
  try {
    payload = await readBoundedText(req, MAX_EVENT_BYTES)
  } catch (error) {
    if (isBodyTooLarge(error)) return json(413, { error: 'payload_too_large' })
    return json(400, { error: 'invalid_body' })
  }

  let event: ResendEvent
  try {
    // O svix recusa assinatura com mais de 5 minutos de diferença (padrão da
    // biblioteca; o terceiro argumento { tolerance } não existe e era ignorado).
    event = new Webhook(Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '').verify(payload, svixHeaders) as ResendEvent
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
    console.error('[portal-email-webhook] falha ao consultar deduplicação', lookupError)
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
      console.error('[portal-email-webhook] corrida de deduplicação sem linha recuperável', raceLookupError)
      return json(500, { error: 'inbox_race_lookup_failed' })
    }
    return json(raced.status === 'processed' ? 200 : 202, {
      event_id: raced.id,
      status: raced.status,
      duplicate: true,
    })
  }
  if (insertError || !inserted) {
    console.error('[portal-email-webhook] falha ao persistir inbox', insertError)
    return json(500, { error: 'inbox_persist_failed' })
  }

  // O worker pode resolver o provider_message_id depois do recebimento. O
  // ACK só significa persistência durável, nunca processamento concluído.
  return json(202, { event_id: inserted.id, status: inserted.status ?? 'pending' })
}))
