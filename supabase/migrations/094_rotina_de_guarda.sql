-- Migration 094: rotina de guarda de dados (ADR 0074, item 3; plano
-- docs/plans/2026-09-24-politica-de-exclusao.md, Fase 6).
--
-- - run_retention() apaga:
--   - audit_logs com mais de 5 anos, exceto as marcas de escala
--     (voyage_pod_schedule, voyage_pol_schedule), que são dado operacional:
--     a programação das viagens é reconstruída a partir delas (achado A4);
--     e o primeiro porto brasileiro indicado da viagem (entity_type voyages,
--     indicated_first_brazilian_port/eta), que só existe na auditoria;
--   - cliente com CNPJ continua sem poder ser excluído depois do expurgo dos
--     eventos do Portal: a regra é explícita em delete_records (087/088);
--   - eventos e tentativas do Portal com mais de 1 ano:
--     portal_provisioning_events, portal_email_event_attempts,
--     portal_inspection_events, portal_login_attempts,
--     portal_login_resolution_attempts. portal_email_attempts fica: é estado
--     dos envios, referenciado por portal_email_events.
--   Devolve quantas linhas saíram de cada tabela.
-- - As tabelas somente inclusão (portal_provisioning_events,
--   portal_email_event_attempts) aceitam DELETE só quando a rotina liga
--   vela.retention na própria transação. audit_logs não tem DELETE para
--   authenticated (migration 086); a rotina roda como dono.
-- - Anonimização de dados pessoais: não será feita (decisão do dono do negócio
--   em 2026-09-25; nota editorial na ADR 0074).
-- - Agenda: todo dia às 06:30 UTC (03:30 em Brasília), por pg_cron, quando a
--   extensão existe. SQL puro: não usa Vault nem Edge Function.
--
-- A migration não apaga linhas; quem apaga é a rotina, ao rodar.

CREATE OR REPLACE FUNCTION public.run_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  PERFORM set_config('vela.retention', 'on', true);

  DELETE FROM public.audit_logs
  WHERE changed_at < now() - interval '5 years'
    AND entity_type NOT IN ('voyage_pod_schedule', 'voyage_pol_schedule')
    AND NOT (entity_type = 'voyages'
             AND field_name IN ('indicated_first_brazilian_port', 'indicated_first_brazilian_eta'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('audit_logs', v_count);

  DELETE FROM public.portal_provisioning_events WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_provisioning_events', v_count);

  DELETE FROM public.portal_email_event_attempts WHERE occurred_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_email_event_attempts', v_count);

  DELETE FROM public.portal_inspection_events WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_inspection_events', v_count);

  DELETE FROM public.portal_login_attempts WHERE attempted_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_login_attempts', v_count);

  DELETE FROM public.portal_login_resolution_attempts WHERE attempted_at < now() - interval '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('portal_login_resolution_attempts', v_count);

  PERFORM set_config('vela.retention', 'off', true);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_retention() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('vela.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'portal_provisioning_events é somente inclusão';
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_email_event_attempts_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('vela.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Histórico de eventos de email é append-only.' USING ERRCODE = '55006';
END;
$function$;

DO $job_094$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-retention') THEN
      PERFORM cron.unschedule('data-retention');
    END IF;
    PERFORM cron.schedule('data-retention', '30 6 * * *', $cmd_094$SELECT public.run_retention();$cmd_094$);
  ELSE
    RAISE WARNING '094: pg_cron ausente; agende public.run_retention() diariamente neste ambiente.';
  END IF;
END;
$job_094$;
