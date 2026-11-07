-- 617: Liberação de faturamento vencendo (decisão 9 do dono de 2026-11-07; ADR
-- 0132, lote E do plano 2026-11-07-brechas-restantes-da-revisao-dos-alertas).
--
-- A Liberação de faturamento (`customer_billing_portal_releases`) deixa sair a
-- fatura do Cliente sem Portal pronto até `review_at`. Ela vencia sem aviso, e
-- o alerta do vencimento caía na Documentação, que não renova (brecha B15).
-- Agora abre **Liberação de faturamento vencendo** (`liberacao_vencendo`,
-- Normal, Administrativo), por Cliente, 2 dias úteis antes do vencimento
-- (`_add_business_hours`, 608: o vencimento cai dentro das próximas 18 horas
-- úteis), se o Cliente ainda não tem o Portal pronto para faturar
-- (`customer_portal_billing_ready`). Fecha com a renovação (nova Liberação
-- além da janela), o Portal pronto, a revogação ou o vencimento (dali em
-- diante vale o fluxo do vencimento).
-- Abre e fecha pela rotina `billing-release-expiring-alerts` (de hora em
-- hora) e na hora em que uma Liberação é concedida ou revogada (gatilho).
--
-- Plano de preservação: a migration só acrescenta um tipo ao catálogo,
-- funções, um gatilho e uma rotina; não reescreve nem apaga linha existente.
-- Conferir: `SELECT status, count(*) FROM alert_items WHERE item_type =
-- 'liberacao_vencendo' GROUP BY 1`. Desfazer: o rollback abaixo e `UPDATE
-- alert_type_catalog SET active = false WHERE type = 'liberacao_vencendo'`.
--
-- Rollback: `cron.unschedule('billing-release-expiring-alerts')`, `DROP
-- TRIGGER trg_billing_release_expiring_alert ON
-- customer_billing_portal_releases` e dropar
-- `reconcile_billing_release_expiring_alert`,
-- `reconcile_billing_release_expiring_alerts` e
-- `_billing_release_expiring_alert_trigger`.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES ('liberacao_vencendo', 'normal', 'administrativo', ARRAY['administrativo'], '/clientes/portal', true)
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reconcile_billing_release_expiring_alert(p_customer_id bigint, p_source text DEFAULT 'billing_release_expiring')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_until timestamptz;
  v_customer text;
BEGIN
  -- A Liberação vigente que vai mais longe.
  SELECT max(r.review_at) INTO v_until
  FROM public.customer_billing_portal_releases r
  WHERE r.customer_id = p_customer_id AND r.revoked_at IS NULL AND r.review_at > now();

  IF v_until IS NULL
     OR v_until > public._add_business_hours(now(), 18)
     OR public.customer_portal_billing_ready(p_customer_id) THEN
    PERFORM public.resolve_alert_item('liberacao_vencendo', 'customer', p_customer_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT c.name INTO v_customer FROM public.customers c WHERE c.id = p_customer_id;
  PERFORM public.upsert_alert_item(
    'liberacao_vencendo', 'customer', p_customer_id::text,
    format('A Liberação de faturamento de %s vence em %s e o Portal do Cliente ainda não está pronto. Renove a Liberação ou conclua o Portal: depois do vencimento, as faturas dele ficam retidas.',
      COALESCE(v_customer, 'Cliente ' || p_customer_id), to_char(v_until AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')),
    p_source, 'administrativo',
    jsonb_build_object('customer_id', p_customer_id, 'review_at', v_until),
    '/clientes/portal?cliente=' || p_customer_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_billing_release_expiring_alert(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_billing_release_expiring_alert(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_billing_release_expiring_alerts(p_source text DEFAULT 'billing-release-expiring-alerts')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  FOR r IN
    SELECT DISTINCT x.customer_id FROM (
      SELECT rel.customer_id FROM public.customer_billing_portal_releases rel
      WHERE rel.revoked_at IS NULL AND rel.review_at > now() AND rel.review_at <= now() + interval '10 days'
      UNION
      SELECT a.entity_id::bigint FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'liberacao_vencendo' AND i.status = 'active'
    ) x
  LOOP
    PERFORM public.reconcile_billing_release_expiring_alert(r.customer_id, p_source);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_billing_release_expiring_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_billing_release_expiring_alerts(text) TO service_role;

-- Conceder ou revogar a Liberação fecha (ou abre) na hora.
CREATE OR REPLACE FUNCTION public._billing_release_expiring_alert_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.reconcile_billing_release_expiring_alert(NEW.customer_id, 'billing_release');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Alerta da Liberação vencendo ignorado: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._billing_release_expiring_alert_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_billing_release_expiring_alert ON public.customer_billing_portal_releases;
CREATE TRIGGER trg_billing_release_expiring_alert
  AFTER INSERT OR UPDATE OF review_at, revoked_at ON public.customer_billing_portal_releases
  FOR EACH ROW EXECUTE FUNCTION public._billing_release_expiring_alert_trigger();

DO $schedule_617$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '617: pg_cron ausente; agende billing-release-expiring-alerts no ambiente de produção.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'billing-release-expiring-alerts';
  PERFORM cron.schedule('billing-release-expiring-alerts', '23 * * * *',
    $cmd_617$SELECT public.reconcile_billing_release_expiring_alerts('billing-release-expiring-alerts');$cmd_617$);
END;
$schedule_617$;
