import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const describeLocal = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const user = '12100000-0000-4000-8000-000000000001'
const fixtures = `
  -- Supabase Auth relations omitted by the minimal local replay shim.
  CREATE TABLE IF NOT EXISTS auth.sessions(id uuid PRIMARY KEY,user_id uuid);
  CREATE TABLE IF NOT EXISTS auth.refresh_tokens(id bigint PRIMARY KEY,user_id text);
  INSERT INTO auth.users(id,email) VALUES ('${user}', 'security121@example.invalid');
  INSERT INTO public.user_profiles(id,full_name,role,active) VALUES ('${user}','Security 121','documentacao',true);
  INSERT INTO public.customers(id,cnpj_cpf,name) VALUES (99121001,'99121001000151','Security 121');
  UPDATE public.customer_portal_accounts SET auth_user_id='${user}', active=true, account_situation='ativo',
    recovery_email='old@example.invalid', pending_recovery_email='new@example.invalid' WHERE customer_id=99121001;
  INSERT INTO public.portal_invites(account_id,purpose,token_hash,sent_to_email,expires_at)
    SELECT id,'recuperacao','reset121','old@example.invalid',now()+interval '1 hour' FROM public.customer_portal_accounts WHERE customer_id=99121001;
  INSERT INTO public.portal_invites(account_id,purpose,token_hash,sent_to_email,expires_at)
    SELECT id,'confirmacao_email','confirm121','new@example.invalid',now()+interval '1 hour' FROM public.customer_portal_accounts WHERE customer_id=99121001;
  CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $f$
    BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $f$;
  GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated,service_role;
`
const service = `SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role'; SET LOCAL request.jwt.claim.sub='';`
const member = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='${user}';`
function scenario(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-d', databaseUrl,
    '-c', `BEGIN; ${fixtures} ${sql} ROLLBACK;`], { encoding: 'utf8' }).trim().split(/\r?\n/)
}

describeLocal('recovery authority and inactive notification policies', () => {
  it('email confirmation cancels old recovery authority and is single-use', () => {
    expect(scenario(`${service}
      SELECT public.portal_confirm_recovery_email('confirm121')->>'outcome';
      SELECT public.portal_begin_password_reset('reset121') IS NULL;
      SELECT public.portal_confirm_recovery_email('confirm121')->>'outcome';
      RESET ROLE;
      SELECT status FROM public.portal_invites WHERE token_hash='reset121';
      SELECT recovery_email FROM public.customer_portal_accounts WHERE customer_id=99121001;
    `)).toEqual(['aplicar', 't', 'pedido_ja_resolvido', 'cancelado', 'new@example.invalid'])
  })

  it('reset in flight blocks every email writer until successful completion', () => {
    expect(scenario(`${service}
      SELECT public.portal_begin_password_reset('reset121') IS NOT NULL;
      SELECT public.portal_begin_password_reset('reset121') IS NULL;
      SELECT pg_temp.try($q$SELECT public.portal_confirm_recovery_email('confirm121')$q$);
      SELECT pg_temp.try($q$UPDATE public.customer_portal_accounts SET recovery_email='other@example.invalid' WHERE customer_id=99121001$q$);
      SELECT public.portal_finish_password_reset(id,recovery_reset_invite_id) FROM public.customer_portal_accounts WHERE customer_id=99121001;
      SELECT public.portal_confirm_recovery_email('confirm121')->>'outcome';
    `)).toEqual(['t', 't', '55000', '55000', '', 'aplicar'])
  })

  it('rejects stale recipients, expired links and unauthorized RPC callers', () => {
    expect(scenario(`
      UPDATE public.portal_invites SET sent_to_email='stale@example.invalid' WHERE token_hash='reset121';
      ${service}
      SELECT public.portal_begin_password_reset('reset121') IS NULL;
      RESET ROLE;
      UPDATE public.portal_invites SET expires_at=now()-interval '1 second' WHERE token_hash='confirm121';
      ${service}
      SELECT public.portal_confirm_recovery_email('confirm121')->>'outcome';
      RESET ROLE; ${member}
      SELECT pg_temp.try($q$SELECT public.portal_begin_password_reset('reset121')$q$);
      SELECT pg_temp.try($q$SELECT public.portal_confirm_recovery_email('confirm121')$q$);
    `)).toEqual(['t', 'link_invalido', '42501', '42501'])
  })

  it('recipient-only SELECT and UPDATE deny inactive users, preserve active access', () => {
    // Suppress producer fanout while inserting a complete notification fixture.
    expect(scenario(`
      SET LOCAL session_replication_role=replica;
      INSERT INTO public.alert_type_catalog(type,severity) VALUES ('test121','normal');
      INSERT INTO public.alerts(id,type,message) VALUES (99121001,'test121','Message');
      INSERT INTO public.alert_items(id,alert_id,item_type,source,severity,message)
        VALUES (99121001,99121001,'test121','test','normal','Message');
      INSERT INTO public.alert_item_events(id,alert_item_id,occurrence_id,event_type,new_status)
        SELECT 99121001,id,occurrence_id,'opened','active' FROM public.alert_items WHERE id=99121001;
      INSERT INTO public.internal_notifications(alert_id,alert_item_id,event_id,recipient_id,recipient_department,item_type,severity,title,message)
        VALUES(99121001,99121001,99121001,'${user}','documentacao','test','normal','Title','Message');
      SET LOCAL session_replication_role=origin;
      ${member}
      SELECT count(*) FROM public.internal_notifications;
      WITH changed AS (UPDATE public.internal_notifications SET read_at=now() RETURNING id) SELECT count(*) FROM changed;
      RESET ROLE; ${service} UPDATE public.user_profiles SET active=false WHERE id='${user}';
      RESET ROLE;
      ${member}
      SELECT count(*) FROM public.internal_notifications;
      WITH changed AS (UPDATE public.internal_notifications SET read_at=now() RETURNING id) SELECT count(*) FROM changed;
    `)).toEqual(['1','1','0','0'])
  })
})
