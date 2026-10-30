import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { canResolveWithJustification } from '../services/alerts'

// Migration 514: a conta da MillionSend avisa o webhook de todo e-mail dela,
// também dos que saem do site da Fwlog. Aviso de entrega sem envio do Vela
// fecha depois das 6 tentativas sem alerta; devolução, spam e evento ambíguo
// abrem "Retorno do provedor de e-mail não aplicado" para o Administrativo,
// com o endereço mascarado em Registro.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const worker = 'r514-w'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function insertEvent(key: string, eventType: string, attemptCount: number, to = 'suporte@portalfwlog.com.br'): string {
  const payload = JSON.stringify({ type: eventType, data: { email_id: `${key}-msg`, to: [to] } })
  return psql(`INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload, status, attempt_count, leased_by, lease_until, received_at)
    VALUES ('${key}', '${key}-msg', '${eventType}', '${payload}'::jsonb, 'processing', ${attemptCount}, '${worker}', now() + interval '5 minutes',
      '2026-10-30 02:59:08+00') RETURNING id;`)
}

function alertOf(entityId: string): string {
  return psql(`SELECT COALESCE((SELECT string_agg(i.item_type || ':' || i.status || ':' || i.department, ',' ORDER BY i.id)
    FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_type = 'portal_email_event' AND a.entity_id = '${entityId}'), 'none');`)
}

function cleanup(): void {
  psql(`
    SET vela.retention = 'on';
    DELETE FROM public.alerts WHERE entity_type = 'portal_email_event'
      AND entity_id IN (SELECT id::text FROM public.portal_email_events WHERE provider_event_id LIKE 'r514-%');
    DELETE FROM public.portal_email_event_attempts WHERE event_id IN (SELECT id FROM public.portal_email_events WHERE provider_event_id LIKE 'r514-%');
    DELETE FROM public.portal_email_events WHERE provider_event_id LIKE 'r514-%';
    DELETE FROM public.portal_email_attempts WHERE idempotency_key LIKE 'r514-%';
  `)
}

function migration514Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._mask_email_for_display(text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration514Applied, 'migration514Applied (retorno de e-mail não aplicado)')

describeLocal('514 — retorno do provedor de e-mail que o Vela não aplica', () => {
  beforeAll(cleanup)
  afterAll(cleanup)

  it('aviso de entrega sem envio do Vela tenta de novo até a 6ª vez e então fecha sem alerta', () => {
    const fifth = insertEvent('r514-entrega-5', 'email.delivered', 5)
    expect(JSON.parse(psql(`SELECT public.process_portal_email_event(${fifth}, '${worker}');`)).status).toBe('retry_wait')

    const sixth = insertEvent('r514-entrega-6', 'email.delivered', 6)
    const result = JSON.parse(psql(`SELECT public.process_portal_email_event(${sixth}, '${worker}');`))
    expect(result).toMatchObject({ status: 'processing', processed: true, ignored_unknown_delivery: true })
    // O runner conclui o evento como nos outros avisos ignorados.
    expect(JSON.parse(psql(`SELECT public.complete_portal_email_event(${sixth}, '${worker}', 'processed');`)).status).toBe('processed')
    expect(psql(`SELECT status || ':' || COALESCE(last_error_code, '-') FROM public.portal_email_events WHERE id = ${sixth};`)).toBe('processed:-')
    expect(alertOf(sixth)).toBe('none')
  })

  it('devolução sem envio do Vela abre o alerta do Administrativo com destinatário mascarado e o que fazer', () => {
    const id = insertEvent('r514-devolvido', 'email.bounced', 6)
    expect(JSON.parse(psql(`SELECT public.process_portal_email_event(${id}, '${worker}');`)).status).toBe('investigate')
    expect(alertOf(id)).toBe('email_retorno_nao_aplicado:active:administrativo')

    const [message, recipient] = psql(`SELECT i.message || E'\\t' || (i.metadata->>'recipient_masked')
      FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'portal_email_event' AND a.entity_id = '${id}';`).split('\t')
    expect(recipient).toBe('s***@p***.br')
    expect(message).toBe('A MillionSend avisou em 29/10/2026 às 23:59 que o e-mail para s***@p***.br foi devolvido, '
      + 'mas esse e-mail não está entre os enviados pelo Vela. Se ele saiu de outro sistema da mesma conta da MillionSend, '
      + 'como o site, resolva com justificativa; se saiu do Vela, procure o envio na MillionSend e confira o contato do Cliente.')
    expect(message).not.toContain('suporte@')
  })

  it('aviso que corresponde a mais de um envio do Vela também vai para o Administrativo', () => {
    psql(`INSERT INTO public.portal_email_attempts (kind, idempotency_key, provider_message_id, recipient_masked, status)
      VALUES ('convite', 'r514-amb-1', 'r514-amb-msg', 'c***@e***.test', 'aceito'),
             ('reenvio', 'r514-amb-2', 'r514-amb-msg', 'c***@e***.test', 'aceito');`)
    const id = insertEvent('r514-amb', 'email.delivered', 1, 'cliente@example.test')
    expect(JSON.parse(psql(`SELECT public.process_portal_email_event(${id}, '${worker}');`)).status).toBe('investigate')
    expect(alertOf(id)).toBe('email_retorno_nao_aplicado:active:administrativo')
    expect(psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'portal_email_event' AND a.entity_id = '${id}';`))
      .toContain('o e-mail para c***@e***.test foi entregue, mas o aviso corresponde a mais de um envio do Vela')
  })

  it('resolve com justificativa, no banco e na tela', () => {
    expect(psql(`SELECT public._alert_item_resolved_with_justification('email_retorno_nao_aplicado', 'portal_email_event');`)).toBe('t')
    expect(canResolveWithJustification('email_retorno_nao_aplicado', 'portal_email_event')).toBe(true)
  })

  it('a migration fecha a entrega que já estava em investigação e o alerta antigo dela', () => {
    const migration = readFileSync(resolve('supabase/migrations/514_retorno_de_email_nao_aplicado.sql'), 'utf8')
    const block = migration.match(/DO \$entregas_514\$[\s\S]*?\$entregas_514\$;/)?.[0]
    expect(block).toBeTruthy()
    const output = psql(`BEGIN;
      INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload, status, attempt_count, last_error_code)
        VALUES ('r514-legado', 'r514-legado-msg', 'email.delivered', '{}'::jsonb, 'investigate', 6, 'attempt_unresolved'),
               ('r514-legado-devolvido', 'r514-legado-dev-msg', 'email.bounced', '{}'::jsonb, 'investigate', 6, 'attempt_unresolved');
      SELECT public.upsert_alert_item('portal_reprocessamento_falhou', 'portal_email_event', id::text, 'Evento de email recebido sem tentativa vinculada',
        'r514_fixture', '{}'::jsonb, '/clientes/portal') FROM public.portal_email_events WHERE provider_event_id LIKE 'r514-legado%';
      ${block}
      SELECT e.provider_event_id || ':' || e.status || ':' || i.status
        FROM public.portal_email_events e
        JOIN public.alerts a ON a.entity_type = 'portal_email_event' AND a.entity_id = e.id::text
        JOIN public.alert_items i ON i.alert_id = a.id
       WHERE e.provider_event_id LIKE 'r514-legado%' ORDER BY e.provider_event_id;
      ROLLBACK;`).split('\n')
    // Só a entrega fecha; a devolução continua para conferência.
    expect(output.slice(-2)).toEqual(['r514-legado:processed:resolved', 'r514-legado-devolvido:investigate:active'])
  })
})
