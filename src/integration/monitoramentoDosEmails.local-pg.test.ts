import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migrations 310 e 313 (plano dos e-mails, 2.1, 2.4 e 2.8): provedor sem retorno,
// evento de e-mail que esgota as tentativas ou é ambíguo, e usuário interno
// com e-mail devolvido abrem Alerta; o detector fecha quando a causa some.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const adminId = '00000000-0000-4000-8000-000000310001'
const bouncedId = '00000000-0000-4000-8000-000000310002'
const customerId = 99310001
const bouncedEmail = 'r310-devolvido@example.test'
const customerEmail = 'r310-cliente@example.test'

function psql(sql: string, sub?: string): string {
  const claims = sub ? `SET request.jwt.claim.sub = '${sub}'; SET request.jwt.claim.role = 'authenticated';` : `SET request.jwt.claim.role = 'service_role';`
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `${claims} ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function alertStatus(type: string, entityType: string, entityId: string): string {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = '${entityType}' AND a.entity_id = '${entityId}'
    ORDER BY i.id DESC LIMIT 1), 'none');`)
}

function detect(): { silent_portal_attempts: number; silent_communication_attempts: number; bounced_internal_users: number } {
  return JSON.parse(psql('SELECT public.detect_email_monitoring_alerts();'))
}

function cleanup(): void {
  psql(`
    SET vela.retention = 'on';
    DELETE FROM public.portal_email_event_attempts WHERE event_id IN (SELECT id FROM public.portal_email_events WHERE provider_event_id LIKE 'r310-%');
    DELETE FROM public.portal_email_events WHERE provider_event_id LIKE 'r310-%';
    DELETE FROM public.portal_email_attempts WHERE idempotency_key LIKE 'r310-%';
    DELETE FROM public.alerts WHERE (entity_type = 'user_profile' AND entity_id IN ('${adminId}', '${bouncedId}'))
      OR (entity_type = 'portal_email_event' AND entity_id IN (SELECT id::text FROM public.portal_email_events WHERE provider_event_id LIKE 'r310-%'))
      OR (entity_type = 'email_provider' AND entity_id = 'webhook');
    DELETE FROM public.portal_suppressed_emails WHERE email IN ('${bouncedEmail}', '${customerEmail}');
    DELETE FROM public.customer_communication_suppressions WHERE email IN ('${bouncedEmail}', '${customerEmail}');
    SET session_replication_role = replica;
    DELETE FROM public.customer_contacts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${bouncedId}');
    DELETE FROM auth.users WHERE id IN ('${adminId}', '${bouncedId}');
    SET session_replication_role = origin;
  `)
}

function migration310Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.detect_email_monitoring_alerts()') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration310Applied, 'migration310Applied (monitoramento dos e-mails)')

describeLocal('310 — monitoramento dos e-mails', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      -- O auth.users local é um esboço; adminUsuarios.local-pg faz o mesmo.
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r310-admin@example.test'), ('${bouncedId}', '${bouncedEmail}');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'R310 Administrativo', 'administrativo', true),
        ('${bouncedId}', 'R310 Devolvido', 'documentacao', true);
    `)
  })
  afterAll(cleanup)

  it('2.1 — tentativa aceita há mais de 2 h sem evento abre o alerta, e o evento o fecha', () => {
    const before = detect().silent_portal_attempts
    psql(`INSERT INTO public.portal_email_attempts (kind, idempotency_key, provider_message_id, recipient_masked, status, created_at, updated_at)
      VALUES ('convite', 'r310-silencio', 'r310-msg-silencio', 'r***@example.test', 'aceito', now() - interval '3 hours', now() - interval '3 hours'),
             ('convite', 'r310-recente', 'r310-msg-recente', 'r***@example.test', 'aceito', now() - interval '30 minutes', now() - interval '30 minutes');`)
    expect(detect().silent_portal_attempts).toBe(before + 1)
    expect(alertStatus('email_retorno_provedor_silencioso', 'email_provider', 'webhook')).toBe('active')
    expect(psql(`SELECT i.department FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'email_retorno_provedor_silencioso' AND a.entity_id = 'webhook' AND i.status = 'active';`)).toBe('administrativo')

    psql(`INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload, status)
      VALUES ('r310-evt-silencio', 'r310-msg-silencio', 'email.delivered', '{}'::jsonb, 'processed');`)
    const after = detect().silent_portal_attempts
    expect(after).toBe(before)
    if (after === 0) expect(alertStatus('email_retorno_provedor_silencioso', 'email_provider', 'webhook')).toBe('resolved')
  })

  it('2.4 — a 6ª conclusão com retry_wait vai para investigação e abre o alerta', () => {
    const fifth = psql(`INSERT INTO public.portal_email_events (provider_event_id, event_type, payload, status, attempt_count, leased_by, lease_until)
      VALUES ('r310-evt-quinta', 'email.delivered', '{}'::jsonb, 'processing', 5, 'r310-w', now() + interval '5 minutes') RETURNING id;`)
    const sixth = psql(`INSERT INTO public.portal_email_events (provider_event_id, event_type, payload, status, attempt_count, leased_by, lease_until)
      VALUES ('r310-evt-sexta', 'email.delivered', '{}'::jsonb, 'processing', 6, 'r310-w', now() + interval '5 minutes') RETURNING id;`)

    expect(JSON.parse(psql(`SELECT public.complete_portal_email_event(${fifth}, 'r310-w', 'retry_wait', 'runner_error', 'falha');`)).status).toBe('retry_wait')
    expect(alertStatus('portal_reprocessamento_falhou', 'portal_email_event', fifth)).toBe('none')

    expect(JSON.parse(psql(`SELECT public.complete_portal_email_event(${sixth}, 'r310-w', 'retry_wait', 'runner_error', 'falha');`)).status).toBe('investigate')
    expect(psql(`SELECT status || ':' || (process_after IS NULL) FROM public.portal_email_events WHERE id = ${sixth};`)).toBe('investigate:true')
    expect(alertStatus('portal_reprocessamento_falhou', 'portal_email_event', sixth)).toBe('active')
  })

  it('2.4 — evento ambíguo (id do provedor em duas tentativas) abre o alerta', () => {
    psql(`INSERT INTO public.portal_email_attempts (kind, idempotency_key, provider_message_id, recipient_masked, status)
      VALUES ('convite', 'r310-amb-1', 'r310-msg-amb', 'r***@example.test', 'entregue'),
             ('reenvio', 'r310-amb-2', 'r310-msg-amb', 'r***@example.test', 'entregue');`)
    const id = psql(`INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload, status, attempt_count, leased_by, lease_until)
      VALUES ('r310-evt-amb', 'r310-msg-amb', 'email.delivered', '{"type":"email.delivered"}'::jsonb, 'processing', 1, 'r310-w', now() + interval '5 minutes') RETURNING id;`)
    expect(JSON.parse(psql(`SELECT public.process_portal_email_event(${id}, 'r310-w');`)).status).toBe('investigate')
    expect(alertStatus('portal_reprocessamento_falhou', 'portal_email_event', id)).toBe('active')
    expect(psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'portal_email_event' AND a.entity_id = '${id}';`)).toContain('mais de uma tentativa')
  })

  it('2.8 — usuário interno com e-mail devolvido abre o alerta, aparece em Admin › Usuários e fecha ao liberar', () => {
    psql(`INSERT INTO public.portal_suppressed_emails (email, reason, suppressed_at) VALUES ('${bouncedEmail}', 'bounce_permanente', now() - interval '1 day');`)
    expect(detect().bounced_internal_users).toBeGreaterThanOrEqual(1)
    expect(alertStatus('usuario_email_devolvido', 'user_profile', bouncedId)).toBe('active')
    expect(alertStatus('usuario_email_devolvido', 'user_profile', adminId)).toBe('none')

    const rows = psql(`SELECT id || ':' || email_bounced FROM public.admin_list_users() WHERE id IN ('${adminId}', '${bouncedId}') ORDER BY id;`, adminId)
    expect(rows.split('\n')).toEqual([`${adminId}:false`, `${bouncedId}:true`])

    expect(psql(`SELECT public.release_internal_user_email_suppression('  ${bouncedEmail.toUpperCase()} ');`)).toBe('1')
    detect()
    expect(alertStatus('usuario_email_devolvido', 'user_profile', bouncedId)).toBe('resolved')
  })

  it('2.8 — usuário desativado não mantém o alerta aberto', () => {
    psql(`INSERT INTO public.portal_suppressed_emails (email, reason) VALUES ('${bouncedEmail}', 'complaint') ON CONFLICT (email) DO NOTHING;`)
    detect()
    expect(alertStatus('usuario_email_devolvido', 'user_profile', bouncedId)).toBe('active')
    psql(`SET session_replication_role = replica; UPDATE public.user_profiles SET active = false WHERE id = '${bouncedId}'; SET session_replication_role = origin;`)
    detect()
    expect(alertStatus('usuario_email_devolvido', 'user_profile', bouncedId)).toBe('resolved')
  })

  it('2.8 — a liberação não tira a supressão de endereço que também é contato de Cliente', () => {
    psql(`
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(310001)}', 'R310 Cliente');
      INSERT INTO public.customer_contacts (customer_id, name, email) VALUES (${customerId}, 'R310 Contato', '${customerEmail}');
      INSERT INTO public.portal_suppressed_emails (email, reason) VALUES ('${customerEmail}', 'bounce_permanente');
    `)
    expect(psql(`SELECT public.release_internal_user_email_suppression('${customerEmail}');`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.portal_suppressed_emails WHERE email = '${customerEmail}';`)).toBe('1')
  })

  it('313 — tira TRUNCATE, TRIGGER e REFERENCES de authenticated e anon nas tabelas de e-mail', () => {
    // O banco local não herda o padrão de privilégios de produção; a suíte o
    // recria numa transação desfeita e aplica a migration por cima.
    const migration = readFileSync(resolve('supabase/migrations/313_grants_das_tabelas_de_email.sql'), 'utf8')
    const privileges = `SELECT string_agg(r || ':' || p || '=' || has_table_privilege(r, 'public.customer_communications', p), ',' ORDER BY r, p)
      FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['TRUNCATE', 'TRIGGER', 'REFERENCES', 'SELECT']) p;`
    const output = psql(`BEGIN;
      GRANT TRUNCATE, TRIGGER, REFERENCES, SELECT ON public.customer_communications TO authenticated, anon;
      ${privileges}
      ${migration}
      ${privileges}
      ROLLBACK;`).split('\n')
    expect(output[0]).toContain('authenticated:TRUNCATE=true')
    expect(output[1]).toBe('anon:REFERENCES=false,anon:SELECT=true,anon:TRIGGER=false,anon:TRUNCATE=false,'
      + 'authenticated:REFERENCES=false,authenticated:SELECT=true,authenticated:TRIGGER=false,authenticated:TRUNCATE=false')
  })

  it('as funções novas são server-only', () => {
    expect(() => psql(`SELECT public.release_internal_user_email_suppression('${bouncedEmail}');`, adminId)).toThrow()
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.detect_email_monitoring_alerts()', 'EXECUTE');`)).toBe('f')
  })
})
