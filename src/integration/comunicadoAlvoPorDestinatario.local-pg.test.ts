import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 315 (revisão do núcleo dos Comunicados): o alvo da régua só é feito
// quando todo destinatário automático tem tentativa entregue (ou devolvida);
// o status do Comunicado deixou de ser o critério. Cobre o destinatário que
// falhou sem tentativa enquanto outro recebeu (antes o Comunicado virava
// "enviado" e a@ nunca recebia), o contato devolvido que fazia o 'parcial'
// voltar a cada 30 min, a claim que sai do alerta quando o alvo é feito e o
// Comunicado "Em envio" sem dono que vira falha.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99315001
const VESSEL_ID = 99315002
const VOYAGE_ID = 99315003
const CUSTOMER = 99315011
const CONTACT_A = 99315021
const CONTACT_B = 99315022
const EMAIL_A = 'a-e315@example.test'
const EMAIL_B = 'b-e315@example.test'
const BL = 'B315-A'
const PORT = 'BRSSZ'
const CLAIM = `aviso_chegada_noa:${CUSTOMER}:${VOYAGE_ID}:${PORT}`
const STALE_IDS = [99315101, 99315102, 99315103, 99315104]

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** A produtora devolve a claim? A claim é liberada antes, para só o alvo decidir. */
function due(asOf = 'now()'): boolean {
  psql(`UPDATE public.customer_communication_automation_claims SET released_at = now() WHERE claim_key = '${CLAIM}';`)
  const candidates = JSON.parse(psql(`SELECT public.evaluate_and_dispatch_automatic_communications(${asOf});`)) as Array<{ claim_key: string; emails: string[] }>
  return candidates.some((candidate) => candidate.claim_key === CLAIM)
}

function attempt(communicationId: number, email: string, status: string, providerId: string | null, mode = 'real'): void {
  psql(`INSERT INTO public.customer_communication_attempts
      (communication_id, recipient_masked, recipient_key, status, provider_message_id, idempotency_key, dispatch_mode)
    VALUES (${communicationId}, 'x***@e***.test', public.customer_communication_recipient_key('${email}'), '${status}',
      ${providerId ? `'${providerId}'` : 'NULL'}, 'e315:${communicationId}:${email}', '${mode}')
    ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status, provider_message_id = EXCLUDED.provider_message_id;`)
}

function alertStatus(): string {
  return psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'comunicado_recusado' AND a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER}' ORDER BY i.id DESC LIMIT 1;`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE e315_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'customer' AND entity_id = '${CUSTOMER}')
         OR (entity_type = 'voyage_pod_schedule' AND entity_id LIKE '${VOYAGE_ID}::%');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM e315_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM e315_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM e315_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM e315_alerts);
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${CUSTOMER}:%';
    DELETE FROM public.customer_communication_attempts WHERE communication_id IN (SELECT id FROM public.customer_communications WHERE customer_id = ${CUSTOMER});
    DELETE FROM public.customer_communication_bls WHERE bl_id = '${BL}';
    DELETE FROM public.customer_communications WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.portal_suppressed_emails WHERE email IN ('${EMAIL_A}', '${EMAIL_B}');
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (${CONTACT_A}, ${CONTACT_B});
    DELETE FROM public.customer_contacts WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.audit_logs WHERE entity_id = '${BL}' OR (entity_type = 'voyage_pod_schedule' AND entity_id LIKE '${VOYAGE_ID}::%');
    DELETE FROM public.bls WHERE id = '${BL}';
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

function migration315Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('customer_communication_target_done', 'settle_stale_pending_customer_communications');`) === '2'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration315Applied, 'migration315Applied (alvo feito por destinatário)')

describeLocal('315 — alvo da régua feito só quando todo destinatário recebeu', () => {
  let communicationId = 0

  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador E315');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio E315', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'E315V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER}, 'CLIENTE E315', '${syntheticCnpj(315011)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${CONTACT_A}, ${CUSTOMER}, 'Contato A', '${EMAIL_A}', true),
        (${CONTACT_B}, ${CUSTOMER}, 'Contato B', '${EMAIL_B}', false);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES
        (${CONTACT_A}, 'documentacao_operacao'), (${CONTACT_B}, 'documentacao_operacao');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status) VALUES
        ('${BL}', ${VOYAGE_ID}, ${CUSTOMER}, 'CNSHA', '${PORT}', 'container', 'pending', 'calculated', 'ok');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
        ('voyage_pod_schedule', '${VOYAGE_ID}::${PORT}', 'eta', NULL, to_char(now() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now() - interval '1 hour');
      SET session_replication_role = origin;
    `)
    // O que a Edge faz ao receber o 1º destinatário: registra o Comunicado.
    communicationId = Number(psql(`SELECT public.create_customer_communication_atomic(${CUSTOMER}, 'aviso_chegada_noa', 'avisos_operacionais',
      ${VOYAGE_ID}, '${PORT}', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ARRAY['${BL}']::text[]);`))
  })
  afterAll(cleanup)

  it('a@ falha sem tentativa e b@ recebe: o Comunicado fica "enviado", mas o alvo continua devido', () => {
    expect(due()).toBe(true)
    // a@: 500 antes de gravar tentativa (ou Edge derrubada antes de a@). b@ recebe.
    attempt(communicationId, EMAIL_B, 'aceito', 'prov-e315-b')
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${communicationId};`)).toBe('enviado')
    expect(due()).toBe(true)
    // O detector também continua listando o Cliente.
    psql(`SELECT public.detect_customer_communication_alerts();`)
    expect(psql(`SELECT i.message LIKE '%CLIENTE E315%' FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'comunicado_noa_pendente' AND a.entity_id = '${VOYAGE_ID}::${PORT}' AND i.status = 'active';`)).toBe('t')
  })

  it('tentativa aceita sem id do provedor não conta como entregue', () => {
    attempt(communicationId, EMAIL_A, 'aceito', null)
    expect(due()).toBe(true)
    attempt(communicationId, EMAIL_A, 'aceito', 'prov-e315-a')
    expect(due()).toBe(false)
    psql(`DELETE FROM public.customer_communication_attempts WHERE idempotency_key = 'e315:${communicationId}:${EMAIL_A}';`)
    expect(due()).toBe(true)
  })

  it('a@ suprimido ou devolvido (bounce): o alvo é feito e não volta a cada 30 min', () => {
    psql(`INSERT INTO public.portal_suppressed_emails (email, reason, suppressed_at) VALUES ('${EMAIL_A}', 'bounce_permanente', now());`)
    expect(due()).toBe(false)
    expect(due(`now() + interval '1 hour'`)).toBe(false)
    psql(`DELETE FROM public.portal_suppressed_emails WHERE email = '${EMAIL_A}';`)
    expect(due()).toBe(true)

    // Bounce sem supressão (devolução temporária): a mesma chave nunca mais
    // chama o provedor, então o destinatário está resolvido.
    attempt(communicationId, EMAIL_A, 'bounce', 'prov-e315-a')
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${communicationId};`)).toBe('parcial')
    expect(due()).toBe(false)
    expect(due(`now() + interval '1 hour'`)).toBe(false)
  })

  it('sem destinatário, o alvo só é feito se alguém já recebeu', () => {
    psql(`UPDATE public.customer_contacts SET deactivated_at = now() WHERE customer_id = ${CUSTOMER};`)
    expect(due()).toBe(false)
    psql(`UPDATE public.customer_communication_attempts SET status = 'bounce' WHERE idempotency_key = 'e315:${communicationId}:${EMAIL_B}';`)
    // Ninguém recebeu: volta a ser alvo (e abre "Comunicado sem destinatário").
    expect(psql(`SELECT count(*) FROM public.customer_communication_automation_targets(now()) WHERE claim_key = '${CLAIM}';`)).toBe('1')
    psql(`UPDATE public.customer_communication_attempts SET status = 'entregue' WHERE idempotency_key = 'e315:${communicationId}:${EMAIL_B}';
      UPDATE public.customer_contacts SET deactivated_at = NULL WHERE customer_id = ${CUSTOMER};`)
  })

  it('a claim sai do alerta comunicado_recusado quando o alvo deixa de estar devido', () => {
    psql(`DELETE FROM public.customer_communication_attempts WHERE idempotency_key = 'e315:${communicationId}:${EMAIL_A}';`)
    expect(due()).toBe(true)
    psql(`SELECT public.defer_customer_communication_automation_claim('${CLAIM}', 'Contato desativado para esta caixa ou modelo.', false);`)
    expect(alertStatus()).toBe('active')
    // a@ recebe por outro caminho (Histórico, mesma âncora): o alvo é feito.
    attempt(communicationId, EMAIL_A, 'entregue', 'prov-e315-a2')
    psql(`SELECT public.refresh_customer_communication_refusal_alert(${CUSTOMER});`)
    expect(alertStatus()).toBe('resolved')
  })

  it('Comunicado "Em envio" sem dono vira falha; o que tem envio recente ou entregue não', () => {
    const [noAttempt, acceptedNoId, recent, delivered] = STALE_IDS
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, dispatch_id, created_at) VALUES
        (${noAttempt}, ${CUSTOMER}, 'livre', 'avisos_gerais', 'pendente', gen_random_uuid(), now() - interval '20 minutes'),
        (${acceptedNoId}, ${CUSTOMER}, 'livre', 'avisos_gerais', 'pendente', gen_random_uuid(), now() - interval '1 hour'),
        (${recent}, ${CUSTOMER}, 'livre', 'avisos_gerais', 'pendente', gen_random_uuid(), now() - interval '1 hour'),
        (${delivered}, ${CUSTOMER}, 'livre', 'avisos_gerais', 'pendente', gen_random_uuid(), now() - interval '1 hour');
      INSERT INTO public.customer_communication_attempts
        (communication_id, recipient_masked, recipient_key, status, provider_message_id, idempotency_key, dispatch_mode, created_at, updated_at) VALUES
        (${acceptedNoId}, 'x***@e***.test', 'sha256:e315a', 'aceito', NULL, 'e315-stale-a', 'real', now() - interval '50 minutes', now() - interval '50 minutes'),
        (${recent}, 'x***@e***.test', 'sha256:e315b', 'aceito', NULL, 'e315-stale-b', 'real', now() - interval '2 minutes', now() - interval '2 minutes'),
        (${delivered}, 'x***@e***.test', 'sha256:e315c', 'entregue', 'prov-e315-c', 'e315-stale-c', 'real', now() - interval '50 minutes', now() - interval '50 minutes');
      SET session_replication_role = origin;
    `)
    const result = JSON.parse(psql(`SELECT public.detect_customer_communication_alerts();`)) as { stale_pending_settled: number }
    expect(result.stale_pending_settled).toBeGreaterThanOrEqual(2)
    const statuses = psql(`SELECT string_agg(status, ',' ORDER BY id) FROM public.customer_communications WHERE id IN (${STALE_IDS.join(', ')});`)
    expect(statuses).toBe('falha,falha,pendente,enviado')
  })

  it('a varredura é server-only', () => {
    expect(() => execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `SET request.jwt.claim.role = 'authenticated'; SELECT public.settle_stale_pending_customer_communications();`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).toThrow(/server-only/)
  })
})
