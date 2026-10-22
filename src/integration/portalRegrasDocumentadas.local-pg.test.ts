import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 416 (auditoria run-3, notas de endurecimento): consolidada, convite,
// recuperação e eventos de e-mail do Portal seguem a regra documentada. Tudo
// roda numa transação descartada no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '41600000-0000-4000-8000-000000000001'
const PORTAL_A = '41600000-0000-4000-8000-000000000002'
const CUSTOMER_A = 416001
const CUSTOMER_B = 416002
const VOYAGE = 416012
const BL_B = 'C416-BL-B'
const DRAFT = 416020
const ISSUED = 416021
const RECEIVABLE_B = 416030

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function migration416Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('''convite''' in prosrc) > 0 FROM pg_proc WHERE proname = 'portal_assisted_email_change';`) === 't'
  } catch {
    return false
  }
}

const FIXTURES = `
  SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '${ADM}';
  INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'c416-adm@example.test'), ('${PORTAL_A}', 'c416-a@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADM}', 'Administrativo C416', 'administrativo', true);
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
    (${CUSTOMER_A}, '${syntheticCnpj(41601)}', 'Cliente C416 A'), (${CUSTOMER_B}, '${syntheticCnpj(41602)}', 'Cliente C416 B');
  UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL_A}', active = true, account_situation = 'ativo',
    recovery_email = 'atual-416@example.test', recovery_email_status = 'ok' WHERE customer_id = ${CUSTOMER_A};
  INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
    VALUES (${CUSTOMER_A}, 'Fixture C416', '${ADM}', now() + interval '1 day'), (${CUSTOMER_B}, 'Fixture C416', '${ADM}', now() + interval '1 day');
  INSERT INTO public.carriers (id, name) VALUES (416010, 'Carrier C416');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (416011, 'Vessel C416', 416010);
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, 416011, 'V416', 'active');
  INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('${BL_B}', ${VOYAGE}, ${CUSTOMER_B}, 'CE416');
  INSERT INTO public.bl_receivables (id, bl_id, customer_id, original_amount_brl, balance_brl) VALUES (${RECEIVABLE_B}, '${BL_B}', ${CUSTOMER_B}, 10, 10);
  INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, status, pix_payload, invoice_type) VALUES
    (${DRAFT}, 'C416-RASCUNHO', ${CUSTOMER_A}, 10, 'draft', 'C416R', 'consolidated'),
    (${ISSUED}, 'C416-EMITIDA', ${CUSTOMER_A}, 10, 'issued', 'C416E', 'consolidated');
  CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN EXECUTE q; RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $f$;
  GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated, service_role;
`

const as = (sub: string) => `RESET ROLE; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${sub}';`
const asOwner = `RESET ROLE; SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '${ADM}';`
const try_ = (sql: string) => `SELECT pg_temp.try($q$${sql}$q$);`

function scenario(sql: string): string[] {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`], { encoding: 'utf8' }).trim().split(/\r?\n/)
}

const describeLocal = describeWithProbe(migration416Applied, 'migration416Applied (Portal segue a regra documentada)')

describeLocal('416 — Portal segue a regra documentada', () => {
  it('desfazer consolidada vale só para a emitida e ainda a pagar', () => {
    const [draft, issued] = scenario(`
      ${as(PORTAL_A)}
      ${try_(`SELECT public.portal_obsolete_consolidation(${DRAFT})`)}
      ${try_(`SELECT public.portal_obsolete_consolidation(${ISSUED})`)}
    `)
    expect(draft).toMatch(/^P0002 /)
    expect(issued).toBe('ok')
  })

  it('consolidar recebível de outro Cliente tem a mesma recusa de id inexistente', () => {
    const [foreign, missing] = scenario(`
      ${as(PORTAL_A)}
      ${try_(`SELECT public.portal_create_consolidation(ARRAY[${RECEIVABLE_B}]::bigint[])`)}
      ${try_(`SELECT public.portal_create_consolidation(ARRAY[${RECEIVABLE_B + 900}]::bigint[])`)}
    `)
    expect(foreign).toMatch(/^42501 /)
    expect(foreign).toBe(missing)
  })

  it('troca assistida do e-mail invalida também o convite pendente', () => {
    expect(scenario(`
      INSERT INTO public.portal_invites (account_id, purpose, token_hash, sent_to_email, expires_at)
        SELECT id, 'convite', 'c416-convite', 'antigo-416@example.test', now() + interval '1 day'
        FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_A};
      ${as(ADM)}
      SELECT public.portal_assisted_email_change(${CUSTOMER_A}, 'novo-416@example.test', 'Fixture C416');
      ${asOwner}
      SELECT status FROM public.portal_invites WHERE token_hash = 'c416-convite';
    `).at(-1)).toBe('invalidado_por_reenvio')
  })

  it('redefinição de senha não começa para Cliente desativado', () => {
    expect(scenario(`
      INSERT INTO public.portal_invites (account_id, purpose, token_hash, sent_to_email, expires_at)
        SELECT id, 'recuperacao', 'c416-rec', 'atual-416@example.test', now() + interval '1 day'
        FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_A};
      SET LOCAL vela.allow_customer_state = 'on';
      UPDATE public.customers SET deactivated_at = now() WHERE id = ${CUSTOMER_A};
      SELECT coalesce(public.portal_begin_password_reset('c416-rec')::text, '<nulo>');
    `).at(-1)).toBe('<nulo>')
  })

  it('bounce de outro endereço não marca o Email de Recuperação atual', () => {
    expect(scenario(`
      INSERT INTO public.portal_email_attempts (account_id, kind, idempotency_key, provider_message_id, recipient_masked)
        SELECT id, 'alteracao_email', 'c416-confirm', 'c416-msg', 'n***@example.test' FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_A};
      INSERT INTO public.portal_email_events (provider_event_id, provider_message_id, event_type, payload, status, leased_by, lease_until, attempt_count)
        VALUES ('c416-ev', 'c416-msg', 'email.bounced',
          '{"type":"email.bounced","data":{"email_id":"c416-msg","to":["pendente-416@example.test"],"bounce":{"type":"permanent"}}}'::jsonb,
          'processing', 'c416-worker', now() + interval '5 minutes', 1);
      SELECT public.process_portal_email_event((SELECT id FROM public.portal_email_events WHERE provider_event_id = 'c416-ev'), 'c416-worker')->>'permanent_bounce';
      SELECT recovery_email_status FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_A};
    `).slice(-2)).toEqual(['true', 'ok'])
  })
})
