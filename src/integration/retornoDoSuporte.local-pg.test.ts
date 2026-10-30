import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

// Migration 469, seção 8 (ADR 0104): com a chave desligada o e-mail sai para o
// suporte e a tentativa guarda o id do provedor com o prefixo `suporte:`. O
// retorno do provedor para essa mensagem (entrega ou devolução da caixa do
// suporte) fecha o evento na primeira rodada, sem mudar a tentativa, sem
// suprimir o endereço do Cliente e sem cair em "tentativa não encontrada"
// (que, depois de seis rodadas, abriria "Retorno do provedor de e-mail não
// aplicado", migration 514).
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

describeLocal('migration 469 — retorno do provedor para o e-mail enviado ao suporte', () => {
  it('fecha o evento de devolução sem mexer na tentativa nem suprimir o endereço do Cliente', () => {
    const result = psql(`
      BEGIN;
      SET LOCAL request.jwt.claim.role = 'service_role';
      INSERT INTO public.portal_email_attempts (kind, idempotency_key, provider_message_id, recipient_masked, status)
        VALUES ('convite', 'r466-attempt', 'suporte:r466-msg', 'c***@e***.test', 'aceito');
      INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload, status, leased_by, lease_until, attempt_count)
        VALUES ('r466-ev', 'r466-msg', 'email.bounced',
          '{"type":"email.bounced","data":{"email_id":"r466-msg","to":["suporte@portalfwlog.com.br"],"bounce":{"type":"permanent"}}}'::jsonb,
          'processing', 'r466-worker', now() + interval '5 minutes', 1);
      SELECT concat_ws('|',
        public.process_portal_email_event((SELECT id FROM public.portal_email_events WHERE provider_event_id = 'r466-ev'), 'r466-worker')->>'ignored_redirected_to_support',
        (SELECT status FROM public.portal_email_attempts WHERE idempotency_key = 'r466-attempt'),
        (SELECT count(*) FROM public.portal_suppressed_emails WHERE email = 'suporte@portalfwlog.com.br'),
        (SELECT count(*) FROM public.alert_items WHERE item_type = 'email_retorno_nao_aplicado' AND metadata->>'provider_message_id' = 'r466-msg'));
      ROLLBACK;
    `)
    expect(result.split('\n').at(-1)).toBe('true|aceito|0|0')
  })
})
