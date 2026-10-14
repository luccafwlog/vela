import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Item B19 do plano docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md
// (migration 245): caixa_sem_destinatario e cliente_sem_contato_principal,
// abertos pelo banco, fecham pela origem quando a Documentação salva os contatos.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const DOCS_USER = '24524500-0000-4000-8000-000000000001'
const CUSTOMER_ID = 99245001
const CONTACT_ID = 99245011
const SUPPRESSED = 'suprimido-b245@example.test'
const VALID = 'docs-b245@example.test'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asDocumentacao(sql: string): { output: string; error: string } {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${DOCS_USER}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function save(email: string) {
  const contacts = `'[{"id": ${CONTACT_ID}, "name": "Contato B245", "email": "${email}", "is_primary": true, "active": true, "box_codes": []}]'::jsonb`
  return asDocumentacao(`SELECT public.internal_save_customer_contact_configuration(${CUSTOMER_ID}, ${contacts}, 'Teste B245')`)
}

function itemStatus(type: string): string {
  return psql(`SELECT string_agg(i.status, ',') FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER_ID}';`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE b245_alerts AS SELECT id FROM public.alerts WHERE entity_type = 'customer' AND entity_id = '${CUSTOMER_ID}';
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM b245_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM b245_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM b245_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM b245_alerts);
    DELETE FROM public.customer_contact_change_events WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id = ${CUSTOMER_ID});
    DELETE FROM public.customer_contacts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_communication_suppressions WHERE email = '${SUPPRESSED}';
    DELETE FROM public.audit_logs WHERE changed_by = '${DOCS_USER}';
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.user_profiles WHERE id = '${DOCS_USER}';
    DELETE FROM auth.users WHERE id = '${DOCS_USER}';
    SET session_replication_role = origin;
  `)
}

function migration245Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = '_apply_customer_contact_configuration'
      AND prosrc LIKE '%resolve_alert_item(%cliente_sem_contato_principal%';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration245Applied, 'migration245Applied (alertas de contato fecham pela origem)')

describeLocal('245 — alertas de contato fecham pela origem (B19)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${DOCS_USER}', 'docs-b245-user@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${DOCS_USER}', 'Documentação B245', 'documentacao', true);
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE B245', '${syntheticCnpj(245001)}');
      -- Contato desativado e nenhum principal ativo.
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary, deactivated_at)
      VALUES (${CONTACT_ID}, ${CUSTOMER_ID}, 'Contato B245', '${VALID}', false, now());
      INSERT INTO public.customer_communication_suppressions (email, reason) VALUES ('${SUPPRESSED}', 'complaint');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('cliente_sem_contato_principal abre pela captura do B/L e fecha ao salvar os contatos', () => {
    psql(`SET request.jwt.claim.role = 'service_role';
      SELECT public.ensure_customer_contact_email(${CUSTOMER_ID}, '${VALID}', 'bl_automatico', NULL, NULL);`)
    expect(itemStatus('cliente_sem_contato_principal')).toBe('active')

    const saved = save(VALID)
    expect(saved.error).toBe('')
    expect(itemStatus('cliente_sem_contato_principal')).toBe('resolved')
  })

  it('caixa_sem_destinatario abre com o principal suprimido e fecha quando o e-mail volta a ser elegível', () => {
    expect(save(SUPPRESSED).error).toBe('')
    expect(itemStatus('caixa_sem_destinatario')).toBe('active')

    expect(save(VALID).error).toBe('')
    expect(itemStatus('caixa_sem_destinatario')).toBe('resolved')
  })
})
