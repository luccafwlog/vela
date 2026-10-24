import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 094 (ADR 0074): a rotina de guarda apaga auditoria com mais de 5
// anos (menos as marcas de escala, que são dado operacional) e eventos do
// Portal com mais de 1 ano; fora dela, esses eventos continuam imutáveis.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function functionPresent() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.run_retention()') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(functionPresent, 'functionPresent')

const CUSTOMER_ID = 9400001
const TAG = 'ret094'

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_id LIKE '${TAG}%' OR entity_id LIKE '9400001::%';
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.portal_login_attempts WHERE cnpj_hash LIKE '${TAG}%';
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    SET session_replication_role = origin;
  `)
}

describeLocal('094 — rotina de guarda de dados', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'Cliente 094', '09400000000194');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_at) VALUES
        ('bl', '${TAG}-old', 'pod', 'x', now() - interval '6 years'),
        ('bl', '${TAG}-new', 'pod', 'x', now() - interval '4 years'),
        ('voyage_pod_schedule', '9400001::BRSSZ', 'eta', '2020-01-01', now() - interval '6 years'),
        ('voyages', '${TAG}-voyage', 'indicated_first_brazilian_port', 'BRSSZ', now() - interval '6 years');
      INSERT INTO public.portal_provisioning_events (customer_id, actor_type, created_at) VALUES
        (${CUSTOMER_ID}, 'sistema', now() - interval '2 years'),
        (${CUSTOMER_ID}, 'sistema', now() - interval '6 months');
      INSERT INTO public.portal_login_attempts (cnpj_hash, attempted_at) VALUES
        ('${TAG}-old', now() - interval '2 years'),
        ('${TAG}-new', now() - interval '1 month');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('fora da rotina, eventos do Portal continuam imutáveis', () => {
    expect(() => psql(`DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};`))
      .toThrow(/somente inclusão/)
  })

  it('apaga só o que passou do prazo e preserva as marcas de escala', () => {
    const result = JSON.parse(psql(`SELECT public.run_retention();`))
    expect(result.audit_logs).toBeGreaterThanOrEqual(1)

    expect(psql(`SELECT string_agg(entity_id, ',' ORDER BY entity_id) FROM public.audit_logs
      WHERE entity_id LIKE '${TAG}%' OR entity_id = '9400001::BRSSZ';`)).toBe(`9400001::BRSSZ,${TAG}-new,${TAG}-voyage`)
    expect(psql(`SELECT count(*) FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};`)).toBe('1')
    expect(psql(`SELECT string_agg(cnpj_hash, ',') FROM public.portal_login_attempts WHERE cnpj_hash LIKE '${TAG}%';`)).toBe(`${TAG}-new`)
  })

  it('a rotina está agendada todo dia onde há pg_cron', () => {
    // O Postgres do CI (scripts/setup-local-pg.sh) pode não ter pg_cron; a
    // migration então só avisa. Com a extensão, o job tem de existir.
    const hasCron = psql(`SELECT to_regclass('cron.job') IS NOT NULL;`) === 't'
    if (!hasCron) return
    expect(psql(`SELECT schedule FROM cron.job WHERE jobname = 'data-retention';`)).toBe('30 6 * * *')
  })
})

// Migration 311 (plano dos e-mails, 5.2, D17): eventos do provedor com mais de
// 1 ano saem com o histórico; tentativas de envio ficam, sem o e-mail em claro.
const EMAIL_TAG = 'ret312'
const COMMUNICATION_CUSTOMER_ID = 9400312
const COMMUNICATION_ID = 9400312

function cleanupEmails() {
  psql(`
    SET vela.retention = 'on';
    DELETE FROM public.portal_email_event_attempts WHERE event_id IN (SELECT id FROM public.portal_email_events WHERE provider_event_id LIKE '${EMAIL_TAG}%');
    DELETE FROM public.portal_email_events WHERE provider_event_id LIKE '${EMAIL_TAG}%';
    DELETE FROM public.portal_email_attempts WHERE recipient_masked = '${EMAIL_TAG}';
    DELETE FROM public.customer_communication_attempts WHERE communication_id = ${COMMUNICATION_ID};
    SET session_replication_role = replica;
    DELETE FROM public.customer_communications WHERE id = ${COMMUNICATION_ID};
    DELETE FROM public.customers WHERE id = ${COMMUNICATION_CUSTOMER_ID};
    SET session_replication_role = origin;
  `)
}

describeLocal('311 — retenção de 1 ano dos e-mails', () => {
  beforeAll(() => {
    cleanupEmails()
    psql(`
      SET request.jwt.claim.role = 'service_role';
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${COMMUNICATION_CUSTOMER_ID}, 'Cliente 312', '09400000031294');
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, dispatch_id)
      VALUES (${COMMUNICATION_ID}, ${COMMUNICATION_CUSTOMER_ID}, 'institucional', 'avisos_gerais', 'enviado', '00000000-0000-0000-0000-000009400312');
      SET session_replication_role = origin;
      INSERT INTO public.portal_email_attempts (kind, idempotency_key, recipient_masked, status, last_error, created_at) VALUES
        ('resumo_diario', 'resumo:2025-01-02:Velho@Example.test', '${EMAIL_TAG}', 'falha_permanente', 'recusado para velho@example.test', now() - interval '2 years'),
        ('resumo_diario', 'resumo:2026-10-01:novo@example.test', '${EMAIL_TAG}', 'entregue', NULL, now() - interval '1 month');
      INSERT INTO public.customer_communication_attempts (communication_id, recipient_masked, recipient_email, status, idempotency_key, dispatch_mode, created_at) VALUES
        (${COMMUNICATION_ID}, 'v***@example.test', 'velho@example.test', 'entregue', 'comunicado:${COMMUNICATION_ID}:0:velho@example.test', 'real', now() - interval '2 years'),
        (${COMMUNICATION_ID}, 'n***@example.test', 'novo@example.test', 'entregue', 'comunicado:${COMMUNICATION_ID}:0:novo@example.test', 'real', now() - interval '1 month');
      INSERT INTO public.portal_email_events (provider_event_id, event_type, payload, status, received_at) VALUES
        ('${EMAIL_TAG}-old', 'email.delivered', '{"data":{"to":["velho@example.test"]}}', 'processed', now() - interval '2 years'),
        ('${EMAIL_TAG}-new', 'email.delivered', '{"data":{"to":["novo@example.test"]}}', 'processed', now() - interval '1 month');
      INSERT INTO public.portal_email_event_attempts (event_id, attempt_no, worker_id, status, occurred_at)
      SELECT id, 1, 'w', 'processed', CASE WHEN provider_event_id = '${EMAIL_TAG}-old' THEN now() - interval '11 months' ELSE now() - interval '1 month' END
      FROM public.portal_email_events WHERE provider_event_id LIKE '${EMAIL_TAG}%';
    `)
  })

  afterAll(cleanupEmails)

  it('apaga o evento antigo com o histórico e mascara o e-mail das tentativas antigas', () => {
    const result = JSON.parse(psql(`SELECT public.run_retention();`))
    expect(result.portal_email_events).toBeGreaterThanOrEqual(1)

    expect(psql(`SELECT string_agg(provider_event_id, ',') FROM public.portal_email_events WHERE provider_event_id LIKE '${EMAIL_TAG}%';`))
      .toBe(`${EMAIL_TAG}-new`)
    expect(psql(`SELECT count(*) FROM public.portal_email_event_attempts a JOIN public.portal_email_events e ON e.id = a.event_id
      WHERE e.provider_event_id LIKE '${EMAIL_TAG}%';`)).toBe('1')

    const portal = psql(`SELECT idempotency_key || '|' || COALESCE(last_error, '') FROM public.portal_email_attempts
      WHERE recipient_masked = '${EMAIL_TAG}' ORDER BY created_at;`).split('\n')
    expect(portal[0]).toMatch(/^resumo:2025-01-02:email-[0-9a-f]{32}\|recusado para email-[0-9a-f]{32}$/)
    // Mesmo endereço (com caixa diferente) vira o mesmo marcador.
    const keyHash = portal[0].match(/resumo:2025-01-02:(email-[0-9a-f]{32})/)?.[1] ?? 'ausente'
    expect(portal[0].endsWith(keyHash)).toBe(true)
    expect(portal[1]).toBe('resumo:2026-10-01:novo@example.test|')

    expect(psql(`SELECT string_agg(idempotency_key, ',' ORDER BY created_at) FROM public.customer_communication_attempts
      WHERE communication_id = ${COMMUNICATION_ID};`))
      .toMatch(new RegExp(`^comunicado:${COMMUNICATION_ID}:0:email-[0-9a-f]{32},comunicado:${COMMUNICATION_ID}:0:novo@example\\.test$`))
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${COMMUNICATION_ID};`)).toBe('enviado')
    // 451 (ponto 8 de 2026-10-23): o e-mail exato do Histórico segue a mesma guarda de 1 ano.
    expect(psql(`SELECT string_agg(recipient_masked || '=' || COALESCE(recipient_email, '-'), ',' ORDER BY created_at) FROM public.customer_communication_attempts
      WHERE communication_id = ${COMMUNICATION_ID};`)).toBe('v***@example.test=-,n***@example.test=novo@example.test')
  })

  it('451: a tentativa antiga com chave no formato novo (hash, sem @) também perde o e-mail exato', () => {
    // A chave `comunicado:<id>:<n>:sha256:…` não tem @: só o ramo
    // `recipient_email IS NOT NULL` da 451 alcança esta linha.
    psql(`
      SET request.jwt.claim.role = 'service_role';
      INSERT INTO public.customer_communication_attempts (communication_id, recipient_masked, recipient_email, status, idempotency_key, dispatch_mode, created_at)
      VALUES (${COMMUNICATION_ID}, 'h***@example.test', 'hash@example.test', 'entregue',
        'comunicado:${COMMUNICATION_ID}:1:sha256:' || encode(sha256('hash@example.test'::bytea), 'hex'), 'real', now() - interval '2 years');
    `)
    const result = JSON.parse(psql(`SELECT public.run_retention();`))
    expect(result.customer_communication_attempts_masked).toBeGreaterThanOrEqual(1)

    expect(psql(`SELECT idempotency_key || '|' || COALESCE(recipient_email, '-') FROM public.customer_communication_attempts
      WHERE communication_id = ${COMMUNICATION_ID} AND recipient_masked = 'h***@example.test';`))
      .toMatch(new RegExp(`^comunicado:${COMMUNICATION_ID}:1:sha256:[0-9a-f]{64}\\|-$`))
  })

  it('451: o e-mail exato da tentativa é lido por usuário interno ativo e nunca pela sessão do Portal', () => {
    expect(psql(`SELECT has_column_privilege('authenticated', 'public.customer_communication_attempts', 'recipient_email', 'SELECT')::text;`)).toBe('true')
    // A política da tabela é só interna (is_active_read_user); sem perfil interno, nada volta.
    expect(psql(`SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.customer_communication_attempts'::regclass AND polcmd = 'r';`))
      .toContain('is_active_read_user()')
    const portalRead = psql(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000009400999';
      SELECT count(*) FROM public.customer_communication_attempts WHERE recipient_email IS NOT NULL; ROLLBACK;`)
    expect(portalRead.split('\n').filter(Boolean).at(-1)).toBe('0')
  })
})
