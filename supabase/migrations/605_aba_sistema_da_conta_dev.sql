-- 605: aba Sistema da Administração, só da conta Dev.
--
-- Decisão do dono de 2026-11-06 (docs/archive/plans/2026-11-06-administracao-revisada.md,
-- etapa 4; diagnóstico em docs/archive/audits/administracao-2026-11-06.md): a aba
-- Sistema passa a mostrar a saúde do Vela e as configurações, e só a conta Dev
-- (ADR 0104, `is_dev_user()`) a vê e mexe. As leituras abaixo são recusadas no banco
-- a quem não é a conta Dev: esconder a aba é só navegação.
--
-- Mudança (só leitura, salvo o tipo de e-mail novo):
--   1. `admin_system_health()`: os Pontos de atenção (alertas sem destinatário em 30
--      dias, equipe sem pessoa ativa, rotinas cuja última execução falhou, leitura
--      do Pix Itaú parada, e-mails bloqueados, feriados do ano seguinte) e o estado
--      das configurações (envio real, intervalo da Régua de cobrança, conta das
--      rotinas e a que vale sem ela, Pix Itaú, feriados).
--   2. `admin_system_routines()`: as rotinas do `pg_cron` com a última execução,
--      a situação dela e as falhas em 7 dias. Lido por SQL dinâmico: sem
--      `cron.job_run_details` (banco local antigo), a execução vem vazia.
--   3. `portal_email_attempts.kind` aceita `teste_envio`: o e-mail de teste que a
--      conta Dev manda a si mesma pela Edge Function `admin-test-email`.
--
-- Não grava, não reescreve nem apaga linhas existentes (o CHECK só ganha um valor).
--
-- Rollback: DROP FUNCTION public.admin_system_health(); DROP FUNCTION
-- public.admin_system_routines(); recriar `portal_email_attempts_kind_check` sem
-- `teste_envio` (antes, conferir que nenhuma linha usa o valor).

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_system_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settings public.app_settings%ROWTYPE;
  v_failed_routines text[] := ARRAY[]::text[];
  v_failed_runs integer := 0;
  v_next_year integer := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer + 1;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_dev_user() THEN
    RAISE EXCEPTION 'Somente a conta Dev consulta o Sistema.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM public.app_settings WHERE id = 1;

  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT COALESCE(array_agg(j.jobname ORDER BY j.jobname) FILTER (WHERE last.status = 'failed'), ARRAY[]::text[]),
             COALESCE((SELECT count(*)::integer FROM cron.job_run_details d
                        WHERE d.status = 'failed' AND d.start_time > now() - interval '7 days'), 0)
        FROM cron.job j
        LEFT JOIN LATERAL (
          SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1
        ) last ON true
       WHERE j.active
    $sql$ INTO v_failed_routines, v_failed_runs;
  END IF;

  RETURN jsonb_build_object(
    'alert_failures_30d', (SELECT count(*) FROM public.alert_notification_failures f WHERE f.created_at > now() - interval '30 days'),
    'last_alert_failure_at', (SELECT max(f.created_at) FROM public.alert_notification_failures f),
    -- Equipe sem nenhuma pessoa ativa: os alertas dela não têm a quem avisar.
    'teams_without_active', COALESCE((
      SELECT jsonb_agg(t.role ORDER BY t.ord)
        FROM (VALUES ('administrativo', 1), ('financeiro', 2), ('operacoes', 3), ('documentacao', 4), ('equipamentos', 5)) AS t(role, ord)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.user_profiles p
          WHERE p.active AND p.account_kind = 'pessoa'
            AND (p.role = t.role OR (t.role = 'documentacao' AND p.role = 'operator')))
    ), '[]'::jsonb),
    'routines_failing', to_jsonb(v_failed_routines),
    'routine_failures_7d', v_failed_runs,
    'pix_provider', v_settings.pix_provider,
    'pix_polled_until', v_settings.itau_pix_polled_until,
    'pix_expiration_seconds', v_settings.itau_pix_expiration_seconds,
    'pix_settlement_actor_name', (SELECT p.full_name FROM public.user_profiles p WHERE p.id = v_settings.itau_pix_settlement_actor),
    'suppressed_emails', (SELECT count(*) FROM public.portal_suppressed_emails)
                        + (SELECT count(*) FROM public.customer_communication_suppressions),
    'holidays_last_day', (SELECT max(h.day) FROM public.business_holidays h),
    'holidays_next_year', (SELECT count(*) FROM public.business_holidays h WHERE extract(year FROM h.day) = v_next_year),
    'next_year', v_next_year,
    'communications_enabled', COALESCE(v_settings.communications_enabled, false),
    'dunning_interval_days', v_settings.demurrage_dunning_interval_days,
    'routine_actor_name', (SELECT p.full_name FROM public.user_profiles p WHERE p.id = v_settings.system_billing_actor),
    -- A conta que as rotinas usam de fato (`_import_effect_system_actor`).
    'routine_actor_effective_name', (SELECT p.full_name FROM public.user_profiles p WHERE p.id = public._import_effect_system_actor())
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_system_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_system_health() TO authenticated;
COMMENT ON FUNCTION public.admin_system_health() IS
  'Admin › Sistema (605): pontos de atenção e estado das configurações; só a conta Dev (is_dev_user).';

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_system_routines()
RETURNS TABLE(jobname text, schedule text, active boolean, last_run_at timestamp with time zone, last_status text, failures_7d integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_dev_user() THEN
    RAISE EXCEPTION 'Somente a conta Dev consulta o Sistema.' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RETURN QUERY SELECT j.jobname::text, j.schedule::text, j.active, NULL::timestamptz, NULL::text, 0 FROM cron.job j ORDER BY j.jobname;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $sql$
    SELECT j.jobname::text, j.schedule::text, j.active, last.start_time, last.status::text,
           (SELECT count(*)::integer FROM cron.job_run_details d
             WHERE d.jobid = j.jobid AND d.status = 'failed' AND d.start_time > now() - interval '7 days')
      FROM cron.job j
      LEFT JOIN LATERAL (
        SELECT d.start_time, d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1
      ) last ON true
     ORDER BY j.jobname
  $sql$;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_system_routines() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_system_routines() TO authenticated;
COMMENT ON FUNCTION public.admin_system_routines() IS
  'Admin › Sistema (605): rotinas do pg_cron com a última execução e as falhas em 7 dias; só a conta Dev (is_dev_user).';

-- 3 -------------------------------------------------------------------------
ALTER TABLE public.portal_email_attempts DROP CONSTRAINT portal_email_attempts_kind_check;
ALTER TABLE public.portal_email_attempts ADD CONSTRAINT portal_email_attempts_kind_check
  CHECK (kind = ANY (ARRAY['convite', 'reenvio', 'recuperacao', 'alteracao_email', 'alerta_critico', 'resumo_diario',
                           'contato_bounced_notificacao', 'ce_unlock_notificacao', 'senha_alterada', 'teste_envio']));
