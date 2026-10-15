import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const workerId = 's07-email-inbox-test-worker'
const providerEmailId = 's07-provider-email-1'
const recipient = 's07-email-inbox@example.test'
const deliveredEventId = 's07-provider-event-delivered'
const bounceEventId = 's07-provider-event-bounced'
const deliveredPayload = JSON.stringify({
  type: 'email.delivered',
  data: { email_id: providerEmailId, to: [recipient] },
})
const bouncePayload = JSON.stringify({
  type: 'email.bounced',
  data: { email_id: providerEmailId, to: [recipient], bounce: { type: 'permanent' } },
})

function psql(sql: string): string {
  return execPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function callAsAuthenticated(sql: string) {
  return spawnPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
}

function claimedEvents(): Array<{ id: number; attempt_count: number; status: string }> {
  const raw = psql(`
    SELECT COALESCE(json_agg(to_jsonb(e)), '[]'::json)
      FROM public.claim_portal_email_events('${workerId}', 10, 300) e;
  `)
  return JSON.parse(raw || '[]') as Array<{ id: number; attempt_count: number; status: string }>
}

function processEvent(eventId: number): Record<string, unknown> {
  return JSON.parse(psql(`SELECT public.process_portal_email_event(${eventId}, '${workerId}');`)) as Record<string, unknown>
}

function cleanup() {
  // O trigger append-only é deliberadamente incontornável pelo serviço. A
  // fixture local é removida pelo owner entre execuções do teste.
  execPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `
      ALTER TABLE public.portal_email_event_attempts DISABLE TRIGGER portal_email_event_attempts_append_only;
      DELETE FROM public.portal_email_event_attempts
       WHERE event_id IN (SELECT id FROM public.portal_email_events WHERE provider_event_id IN ('${deliveredEventId}', '${bounceEventId}'));
      DELETE FROM public.portal_email_events
       WHERE provider_event_id IN ('${deliveredEventId}', '${bounceEventId}');
      ALTER TABLE public.portal_email_event_attempts ENABLE TRIGGER portal_email_event_attempts_append_only;
      DELETE FROM public.portal_suppressed_emails WHERE email = '${recipient}';
      DELETE FROM public.portal_email_attempts WHERE provider_message_id = '${providerEmailId}';
    `,
  ], { encoding: 'utf8' })
}

describeLocal('S07 — inbox durável de eventos de email', () => {
  beforeAll(() => {
    cleanup()
  })

  afterAll(() => {
    cleanup()
  })

  it('mantém claim privado para service_role', () => {
    const denied = callAsAuthenticated(`SELECT public.claim_portal_email_events('${workerId}', 1, 300);`)
    expect(denied.status).not.toBe(0)
    expect(`${denied.stdout}\n${denied.stderr}`).toMatch(/service_role|permission denied/i)
  })

  it('reprocessa evento recebido antes da tentativa sem perder o fato', () => {
    psql(`
      INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload)
      VALUES ('${deliveredEventId}', '${providerEmailId}', 'email.delivered', '${deliveredPayload}'::jsonb);
    `)

    const firstClaim = claimedEvents()
    const event = firstClaim.find((candidate) => candidate.status === 'processing')
    expect(event).toBeDefined()
    const unresolved = processEvent(Number(event?.id))
    expect(unresolved.status).toBe('retry_wait')
    expect(psql(`SELECT status FROM public.portal_email_events WHERE id = ${event?.id};`)).toBe('retry_wait')

    psql(`
      INSERT INTO public.portal_email_attempts
        (kind, idempotency_key, provider_message_id, recipient_masked, status)
      VALUES ('convite', 's07-email-inbox-attempt', '${providerEmailId}', 's***@example.test', 'aceito');
      UPDATE public.portal_email_events
         SET process_after = now() - interval '1 second'
       WHERE id = ${event?.id};
    `)

    const secondClaim = claimedEvents().find((candidate) => Number(candidate.id) === Number(event?.id))
    expect(secondClaim).toBeDefined()
    const processed = processEvent(Number(secondClaim?.id))
    expect(processed.processed).toBe(true)
    expect(processed.status).toBe('processing')
    psql(`SELECT public.complete_portal_email_event(${event?.id}, '${workerId}', 'processed');`)

    expect(psql(`SELECT status FROM public.portal_email_attempts WHERE provider_message_id = '${providerEmailId}';`)).toBe('entregue')
    expect(psql(`SELECT status FROM public.portal_email_events WHERE id = ${event?.id};`)).toBe('processed')
    expect(psql(`SELECT count(*) FROM public.portal_email_event_attempts WHERE event_id = ${event?.id} AND status = 'processed';`)).toBe('1')
  })

  it('aplica bounce permanente uma vez e não regride por duplicata processada', () => {
    psql(`
      INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload)
      VALUES ('${bounceEventId}', '${providerEmailId}', 'email.bounced', '${bouncePayload}'::jsonb);
    `)
    const event = claimedEvents().find((candidate) => candidate.status === 'processing')
    expect(event).toBeDefined()
    const processed = processEvent(Number(event?.id))
    expect(processed.permanent_bounce).toBe(true)
    psql(`SELECT public.complete_portal_email_event(${event?.id}, '${workerId}', 'processed');`)

    expect(psql(`SELECT status FROM public.portal_email_attempts WHERE provider_message_id = '${providerEmailId}';`)).toBe('bounce')
    expect(psql(`SELECT count(*) FROM public.portal_suppressed_emails WHERE email = '${recipient}' AND reason = 'bounce_permanente';`)).toBe('1')

    const idempotent = JSON.parse(psql(`SELECT public.process_portal_email_event(${event?.id}, '${workerId}');`)) as Record<string, unknown>
    expect(idempotent.idempotent).toBe(true)
    expect(psql(`SELECT count(*) FROM public.portal_suppressed_emails WHERE email = '${recipient}';`)).toBe('1')
  })
})
