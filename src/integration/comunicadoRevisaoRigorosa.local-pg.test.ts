import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 318 (revisão rigorosa do núcleo dos Comunicados, PR #973):
// - os alvos levam só os destinatários que faltam: ligar a chave depois de um
//   NOA simulado não manda e-mail real a quem já recebeu a simulação, nem ao
//   contato cadastrado depois (D1);
// - a Escala excluída segue a grafia gravada por último ("Excluir escala" na
//   grafia normalizada exclui a Escala de dados legados em BRVIT);
// - a âncora manual grava o porto normalizado (a mesma identidade da régua);
// - a claim que entrou em comunicado_recusado fica nele até o envio sair: uma
//   falha do provedor depois da recusa por dado e a retomada da claim recusada
//   não fecham o alerta (D18);
// - falha no cálculo do alerta não desfaz o estado da claim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99318001
const VESSEL_ID = 99318002
const VOYAGE_ID = 99318003
const VOYAGE_SPELLING = 99318004
const CUSTOMER_S1 = 99318011
const CUSTOMER_ALERT = 99318012
const CONTACT_A = 99318021
const CONTACT_B = 99318022
const CONTACT_C = 99318023
const CONTACT_ALERT = 99318024
const EMAIL_A = 'a-e318@example.test'
const EMAIL_B = 'b-e318@example.test'
const EMAIL_C = 'c-e318@example.test'
const BL_S1 = 'B318-S1'
const BL_ALERT = 'B318-AL'
const PORT = 'BRVIX'
const CLAIM_S1 = `aviso_chegada_noa:${CUSTOMER_S1}:${VOYAGE_ID}:${PORT}`
const CLAIM_ALERT = `aviso_chegada_noa:${CUSTOMER_ALERT}:${VOYAGE_ID}:${PORT}`
const CUSTOMERS = `${CUSTOMER_S1}, ${CUSTOMER_ALERT}`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function targetEmails(claimKey: string): string | null {
  const value = psql(`SELECT array_to_string(t.emails, ',') FROM public.customer_communication_automation_targets(now()) t WHERE t.claim_key = '${claimKey}';`)
  return value === '' && psql(`SELECT count(*) FROM public.customer_communication_automation_targets(now()) t WHERE t.claim_key = '${claimKey}';`) === '0'
    ? null
    : value
}

function attempt(communicationId: number, email: string, status: string, providerId: string | null, mode: 'real' | 'simulado'): void {
  psql(`INSERT INTO public.customer_communication_attempts
      (communication_id, recipient_masked, recipient_key, status, provider_message_id, idempotency_key, dispatch_mode)
    VALUES (${communicationId}, 'x***@e***.test', public.customer_communication_recipient_key('${email}'), '${status}',
      ${providerId ? `'${providerId}'` : 'NULL'}, 'e318:${communicationId}:${email}', '${mode}')
    ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status, provider_message_id = EXCLUDED.provider_message_id,
      dispatch_mode = EXCLUDED.dispatch_mode;`)
}

function refusalAlert(): { id: string; status: string } | null {
  const row = psql(`SELECT i.id || '|' || i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'comunicado_recusado' AND a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER_ALERT}' ORDER BY i.id DESC LIMIT 1;`)
  if (!row) return null
  const [id, status] = row.split('|')
  return { id: id!, status: status! }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE e318_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'customer' AND entity_id IN ('${CUSTOMER_S1}', '${CUSTOMER_ALERT}'))
         OR (entity_type = 'voyage_pod_schedule' AND (entity_id LIKE '${VOYAGE_ID}::%' OR entity_id LIKE '${VOYAGE_SPELLING}::%'));
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM e318_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM e318_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM e318_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM e318_alerts);
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${CUSTOMER_S1}:%' OR claim_key LIKE '%:${CUSTOMER_ALERT}:%';
    DELETE FROM public.customer_communication_attempts WHERE communication_id IN (SELECT id FROM public.customer_communications WHERE customer_id IN (${CUSTOMERS}));
    DELETE FROM public.customer_communication_bls WHERE bl_id IN ('${BL_S1}', '${BL_ALERT}');
    DELETE FROM public.customer_communications WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (${CONTACT_A}, ${CONTACT_B}, ${CONTACT_C}, ${CONTACT_ALERT});
    DELETE FROM public.customer_contacts WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.audit_logs WHERE entity_id IN ('${BL_S1}', '${BL_ALERT}')
      OR (entity_type = 'voyage_pod_schedule' AND (entity_id LIKE '${VOYAGE_ID}::%' OR entity_id LIKE '${VOYAGE_SPELLING}::%'));
    DELETE FROM public.bls WHERE id IN ('${BL_S1}', '${BL_ALERT}');
    DELETE FROM public.customers WHERE id IN (${CUSTOMERS});
    DELETE FROM public.voyages WHERE id IN (${VOYAGE_ID}, ${VOYAGE_SPELLING});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

function migration318Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'customer_communication_target_pending_recipients';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration318Applied, 'migration318Applied (revisão rigorosa dos Comunicados)')

describeLocal('318 — revisão rigorosa do núcleo dos Comunicados', () => {
  let communicationId = 0

  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador E318');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio E318', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${VOYAGE_ID}, ${VESSEL_ID}, 'E318V', 'active'),
        (${VOYAGE_SPELLING}, ${VESSEL_ID}, 'E318G', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        (${CUSTOMER_S1}, 'CLIENTE E318 S1', '${syntheticCnpj(318011)}'),
        (${CUSTOMER_ALERT}, 'CLIENTE E318 ALERTA', '${syntheticCnpj(318012)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary, created_at) VALUES
        (${CONTACT_A}, ${CUSTOMER_S1}, 'Contato A', '${EMAIL_A}', true, now() - interval '1 day'),
        (${CONTACT_B}, ${CUSTOMER_S1}, 'Contato B', '${EMAIL_B}', false, now() - interval '1 day'),
        (${CONTACT_ALERT}, ${CUSTOMER_ALERT}, 'Contato alerta', 'alerta-e318@example.test', true, now() - interval '1 day');
      INSERT INTO public.customer_contact_box_links (contact_id, box_code, created_at) VALUES
        (${CONTACT_A}, 'documentacao_operacao', now() - interval '1 day'),
        (${CONTACT_B}, 'documentacao_operacao', now() - interval '1 day'),
        (${CONTACT_ALERT}, 'documentacao_operacao', now() - interval '1 day');
      -- B/L em BRVIT numa Escala gravada em BRVIX (a mesma Escala).
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status) VALUES
        ('${BL_S1}', ${VOYAGE_ID}, ${CUSTOMER_S1}, 'CNSHA', 'BRVIT', 'container', 'pending', 'calculated', 'ok'),
        ('${BL_ALERT}', ${VOYAGE_ID}, ${CUSTOMER_ALERT}, 'CNSHA', '${PORT}', 'container', 'pending', 'calculated', 'ok');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
        ('voyage_pod_schedule', '${VOYAGE_ID}::${PORT}', 'eta', NULL, to_char(now() + interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now() - interval '1 hour');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('âncora manual com B/L em BRVIT grava o porto normalizado (a identidade da régua)', () => {
    communicationId = Number(psql(`SELECT public.create_customer_communication_atomic(${CUSTOMER_S1}, 'aviso_chegada_noa', 'avisos_operacionais',
      ${VOYAGE_ID}, 'BRVIT', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ARRAY['${BL_S1}']::text[]);`))
    expect(psql(`SELECT anchor_port FROM public.customer_communications WHERE id = ${communicationId};`)).toBe('BRVIX')
    const validation = JSON.parse(psql(`SELECT public.customer_communication_anchor_validation(${CUSTOMER_S1}, 'aviso_chegada_noa', ${VOYAGE_ID}, 'vitoria', NULL, ARRAY['${BL_S1}']);`)) as { ok: boolean; port: string }
    expect(validation).toMatchObject({ ok: true, port: 'BRVIX' })
  })

  it('S1: os alvos levam só quem falta — nem a@ simulado, nem o contato novo c@', () => {
    // Chave desligada: a@ recebeu a simulação; b@ falhou sem tentativa.
    attempt(communicationId, EMAIL_A, 'aceito', null, 'simulado')
    // c@ entra na caixa depois do 1º Comunicado do alvo.
    psql(`INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES (${CONTACT_C}, ${CUSTOMER_S1}, 'Contato C', '${EMAIL_C}', false);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES (${CONTACT_C}, 'documentacao_operacao') ON CONFLICT DO NOTHING;`)
    expect(psql(`SELECT array_to_string(public.customer_communication_automatic_recipients(${CUSTOMER_S1}, ARRAY['documentacao_operacao']), ',');`))
      .toBe(`${EMAIL_A},${EMAIL_B},${EMAIL_C}`)

    // Ligada a chave, a rodada seguinte manda só a b@.
    expect(targetEmails(CLAIM_S1)).toBe(EMAIL_B)
    const candidates = JSON.parse(psql(`SELECT public.evaluate_and_dispatch_automatic_communications(now());`)) as Array<{ claim_key: string; emails: string[] }>
    expect(candidates.find((candidate) => candidate.claim_key === CLAIM_S1)?.emails).toEqual([EMAIL_B])

    // b@ recebe (real): o alvo é feito; c@ não reabre.
    attempt(communicationId, EMAIL_B, 'aceito', 'prov-e318-b', 'real')
    expect(targetEmails(CLAIM_S1)).toBeNull()
    expect(psql(`SELECT public.customer_communication_target_done('aviso_chegada_noa', ${CUSTOMER_S1}, ${VOYAGE_ID}, '${PORT}', NULL,
      ARRAY['${EMAIL_A}', '${EMAIL_B}', '${EMAIL_C}']);`)).toBe('t')
  })

  it('S1: sem obrigatório, o alvo vale para os atuais só se ninguém recebeu', () => {
    // a@ e b@ saem; só c@ (novo) fica. Alguém já recebeu: feito.
    psql(`UPDATE public.customer_contacts SET deactivated_at = now() WHERE id IN (${CONTACT_A}, ${CONTACT_B});`)
    expect(targetEmails(CLAIM_S1)).toBeNull()
    // Ninguém recebeu (as tentativas viram devolução): o alvo vale para c@.
    psql(`UPDATE public.customer_communication_attempts SET status = 'bounce' WHERE communication_id = ${communicationId};`)
    expect(targetEmails(CLAIM_S1)).toBe(EMAIL_C)
    psql(`UPDATE public.customer_contacts SET deactivated_at = NULL WHERE id IN (${CONTACT_A}, ${CONTACT_B});`)
  })

  it('S2: a grafia gravada por último decide se a Escala está excluída', () => {
    // Dados legados em BRVIT; "Excluir escala" grava deleted em BRVIX (delete_escala).
    psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
      ('voyage_pod_schedule', '${VOYAGE_SPELLING}::BRVIT', 'eta', NULL, '2026-11-01T08:00:00Z', now() - interval '3 hours'),
      ('voyage_pod_schedule', '${VOYAGE_SPELLING}::BRVIX', 'deleted', 'false', 'true', now() - interval '2 hours');`)
    expect(psql(`SELECT deleted FROM public.customer_communication_scale_schedules(${VOYAGE_SPELLING}, 'BRVIT');`)).toBe('t')
    // Reincluída depois em BRVIT: ativa, com o ETA dela.
    psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
      ('voyage_pod_schedule', '${VOYAGE_SPELLING}::BRVIT', 'ata', NULL, '2026-11-01T10:00:00Z', now() - interval '1 hour');`)
    expect(psql(`SELECT ata_text || '|' || deleted FROM public.customer_communication_scale_schedules(${VOYAGE_SPELLING}, 'BRVIX');`))
      .toBe('2026-11-01T10:00:00Z|false')
  })

  it('S3: falha do provedor depois da recusa por dado não fecha o alerta; o envio fecha', () => {
    const defer = (reason: string, provider: boolean) => JSON.parse(psql(
      `SELECT public.defer_customer_communication_automation_claim('${CLAIM_ALERT}', '${reason}', ${provider});`)) as { attempts: number; alerted: boolean }
    psql(`INSERT INTO public.customer_communication_automation_claims (claim_key) VALUES ('${CLAIM_ALERT}') ON CONFLICT (claim_key) DO NOTHING;`)

    expect(defer('Contato desativado para esta caixa ou modelo.', false)).toMatchObject({ attempts: 1, alerted: true })
    const opened = refusalAlert()
    expect(opened?.status).toBe('active')
    // 500 transitório na rodada seguinte: provider_failures = 1.
    expect(defer('HTTP 500', true)).toMatchObject({ attempts: 2, alerted: true })
    expect(refusalAlert()).toEqual(opened)
    expect(defer('HTTP 503', true)).toMatchObject({ attempts: 3, alerted: true })
    expect(refusalAlert()).toEqual(opened)

    expect(psql(`SELECT public.complete_customer_communication_automation_claim('${CLAIM_ALERT}');`)).toBe('t')
    expect(refusalAlert()?.status).toBe('resolved')
    expect(psql(`SELECT refusal_alerted_at IS NULL FROM public.customer_communication_automation_claims WHERE claim_key = '${CLAIM_ALERT}';`)).toBe('t')
  })

  it('S4: a retomada da claim recusada pela produtora não fecha nem reabre o alerta', () => {
    psql(`SELECT public.reject_customer_communication_automation_claim('${CLAIM_ALERT}', 'Anexos inválidos.');`)
    const opened = refusalAlert()
    expect(opened?.status).toBe('active')

    // 25 h depois a produtora retoma a claim (rejected_at limpo, attempts = 0).
    const candidates = JSON.parse(psql(`SELECT public.evaluate_and_dispatch_automatic_communications(now() + interval '25 hours');`)) as Array<{ claim_key: string }>
    expect(candidates.map((candidate) => candidate.claim_key)).toContain(CLAIM_ALERT)
    expect(psql(`SELECT (rejected_at IS NULL) || '|' || attempts FROM public.customer_communication_automation_claims WHERE claim_key = '${CLAIM_ALERT}';`)).toBe('true|0')
    expect(refusalAlert()).toEqual(opened)

    // A nova recusa mantém o mesmo item, sem resolver e reabrir.
    psql(`SELECT public.reject_customer_communication_automation_claim('${CLAIM_ALERT}', 'Anexos inválidos.');`)
    expect(refusalAlert()).toEqual(opened)
    expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'comunicado_recusado' AND a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER_ALERT}';`)).toBe('1')

    // O alvo deixa de estar devido (o Comunicado saiu pelo Histórico): sai do alerta.
    const manual = Number(psql(`SELECT public.create_customer_communication_atomic(${CUSTOMER_ALERT}, 'aviso_chegada_noa', 'avisos_operacionais',
      ${VOYAGE_ID}, '${PORT}', NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, ARRAY['${BL_ALERT}']::text[]);`))
    attempt(manual, 'alerta-e318@example.test', 'entregue', 'prov-e318-alerta', 'real')
    psql(`SELECT public.refresh_customer_communication_refusal_alert(${CUSTOMER_ALERT});`)
    expect(refusalAlert()?.status).toBe('resolved')
    expect(psql(`SELECT refusal_alerted_at IS NULL FROM public.customer_communication_automation_claims WHERE claim_key = '${CLAIM_ALERT}';`)).toBe('t')
  })

  it('S6: falha no cálculo dos alvos não desfaz o adiamento da claim', () => {
    psql(`INSERT INTO public.customer_communication_automation_claims (claim_key) VALUES ('${CLAIM_S1}') ON CONFLICT (claim_key) DO NOTHING;
      UPDATE public.customer_communication_automation_claims SET attempts = 0, provider_failures = 0 WHERE claim_key = '${CLAIM_S1}';`)
    // Dentro de uma transação desfeita no fim: os alvos falham porque a função
    // de destinatários some só aqui.
    const attempts = psql(`BEGIN;
      ALTER FUNCTION public.customer_communication_automatic_recipients(bigint, text[]) RENAME TO e318_recipients_off;
      SELECT (public.defer_customer_communication_automation_claim('${CLAIM_S1}', 'HTTP 500', true)) ->> 'attempts';
      ROLLBACK;`)
    expect(attempts).toBe('1')
  })
})
