-- 515: Alerta "Demurrage travada" e contagem do aviso do cabeçalho (lote 2 do
-- plano da repaginação da Demurrage; ADR 0112, D4, D6 e D25).
--
-- 1. Tipo `demurrage_travado`, um por grupo de cobrança (entidade `bl`, o B/L
--    âncora), aberto na hora em que o grupo entra em Travado na classificação
--    da 514 e fechado pela origem quando sai. O setor é o do motivo (D25):
--    Documentação para CE Mercante, Cliente e Portal (o mesmo setor do
--    `review_portal_not_ready`, ADR 0107); Administrativo para tipo sem tarifa
--    e B/L cancelado. Trocar de motivo troca o setor: o item do setor antigo
--    fecha e abre o do novo.
-- 2. `reconcile_demurrage_travado_alerts(p_voyage_id)` reconcilia uma Viagem
--    (ou todas). Roda:
--    - pelos gatilhos de comando em `bl_containers` (datas, tipo, SOC/COC,
--      inclusão e exclusão), na Viagem tocada;
--    - pelo gatilho de `bls` (CE Mercante, Cliente, cancelamento, Viagem);
--    - pelos gatilhos de tarifa e de cadastro de tipos, em todas;
--    - pela rotina `demurrage-travado-alerts` a cada 15 minutos (o Gate do
--      Portal e a virada do dia não passam por esses gatilhos).
-- 3. `count_demurrage_running_boxes()`: caixas de Correndo, para o aviso
--    "N containers em atraso" do cabeçalho (D6).
--
-- Não reescreve nem apaga linhas existentes: os alertas abrem na primeira
-- reconciliação.
--
-- Rollback: `SELECT cron.unschedule('demurrage-travado-alerts')`; apagar os
-- gatilhos `trg_bl_containers_travado_alerts_*`, `trg_bls_travado_alerts`,
-- `trg_rates_travado_alerts`, `trg_container_types_travado_alerts`, as
-- funções novas; `UPDATE alert_type_catalog SET active = false WHERE type =
-- 'demurrage_travado'`.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('demurrage_travado', 'normal', 'administrativo', ARRAY['administrativo'], '/demurrage?divisao=travado')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reconcile_demurrage_travado_alerts(p_voyage_id bigint DEFAULT NULL, p_source text DEFAULT 'demurrage_travado')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_claims text := current_setting('request.jwt.claims', true);
  v_group jsonb;
  v_board jsonb;
  v_travado text[] := ARRAY[]::text[];
  v_department text;
  v_current text;
  v_item RECORD;
  v_open integer := 0;
BEGIN
  v_board := public._demurrage_billing_board_core(NULL, p_voyage_id);
  -- Chamada também pelo pg_cron e por gatilhos: o Alerta exige executor
  -- autorizado e é do sistema, não de quem gravou a data ou o CE.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  FOR v_group IN SELECT value FROM jsonb_array_elements(v_board) WHERE value->>'division' = 'travado' LOOP
    v_travado := v_travado || (v_group->>'anchor_bl_id');
    v_department := CASE WHEN v_group->>'reason_code' IN ('sem_tarifa', 'bl_cancelado') THEN 'administrativo' ELSE 'documentacao' END;
    SELECT i.department INTO v_current
      FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
     WHERE i.item_type = 'demurrage_travado' AND i.status = 'active'
       AND a.entity_type = 'bl' AND a.entity_id = v_group->>'anchor_bl_id'
     ORDER BY i.id DESC LIMIT 1;
    IF v_current IS NOT NULL AND v_current <> v_department THEN
      PERFORM public.resolve_alert_item('demurrage_travado', 'bl', v_group->>'anchor_bl_id', p_source,
        jsonb_build_object('reason', 'motivo_mudou'));
    END IF;
    PERFORM public.upsert_alert_item(
      'demurrage_travado', 'bl', v_group->>'anchor_bl_id',
      format('Demurrage do B/L %s travada: %s', v_group->>'anchor_bl_id', v_group->>'reason'),
      p_source, v_department,
      jsonb_build_object('bl_id', v_group->>'anchor_bl_id', 'bl_ids', v_group->'bl_ids',
        'reason_code', v_group->>'reason_code', 'no_rate_types', v_group->>'no_rate_types',
        'customer_id', v_group->'customer_id', 'voyage_id', v_group->'voyage_id', 'usd', v_group->'usd'),
      '/demurrage?divisao=travado&busca=' || (v_group->>'anchor_bl_id'));
    v_open := v_open + 1;
  END LOOP;

  -- Fecha pela origem o que saiu de Travado no recorte reconciliado.
  FOR v_item IN
    SELECT DISTINCT a.entity_id
      FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id
      LEFT JOIN public.bls b ON b.id = a.entity_id
     WHERE i.item_type = 'demurrage_travado' AND i.status = 'active' AND a.entity_type = 'bl'
       AND (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id OR b.id IS NULL)
       AND NOT (a.entity_id = ANY (v_travado))
  LOOP
    PERFORM public.resolve_alert_item('demurrage_travado', 'bl', v_item.entity_id, p_source, '{}'::jsonb);
  END LOOP;

  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_previous_claims, ''), true);
  RETURN v_open;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_demurrage_travado_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_demurrage_travado_alerts(bigint, text) TO service_role;

-- Viagens tocadas por um comando em `bl_containers` (uma reconciliação por Viagem).
CREATE OR REPLACE FUNCTION public._bl_containers_travado_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage bigint;
BEGIN
  FOR v_voyage IN
    SELECT DISTINCT b.voyage_id
      FROM public.bls b
     WHERE b.voyage_id IS NOT NULL AND b.id IN (
       SELECT changed.bl_id FROM changed_rows AS changed)
  LOOP
    PERFORM public.reconcile_demurrage_travado_alerts(v_voyage, 'demurrage_travado_containers');
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._bl_containers_travado_alerts() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_bl_containers_travado_alerts_ins
  AFTER INSERT ON public.bl_containers REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_travado_alerts();
CREATE TRIGGER trg_bl_containers_travado_alerts_upd
  AFTER UPDATE ON public.bl_containers REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_travado_alerts();
CREATE TRIGGER trg_bl_containers_travado_alerts_del
  AFTER DELETE ON public.bl_containers REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_travado_alerts();

CREATE OR REPLACE FUNCTION public._bls_travado_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.ce_mercante IS DISTINCT FROM OLD.ce_mercante
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.voyage_id IS DISTINCT FROM OLD.voyage_id
     OR NEW.free_time_override IS DISTINCT FROM OLD.free_time_override THEN
    IF NEW.voyage_id IS NOT NULL THEN
      PERFORM public.reconcile_demurrage_travado_alerts(NEW.voyage_id, 'demurrage_travado_bl');
    END IF;
    IF OLD.voyage_id IS NOT NULL AND OLD.voyage_id IS DISTINCT FROM NEW.voyage_id THEN
      PERFORM public.reconcile_demurrage_travado_alerts(OLD.voyage_id, 'demurrage_travado_bl');
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._bls_travado_alerts() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_bls_travado_alerts
  AFTER UPDATE OF ce_mercante, customer_id, cancelled_at, voyage_id, free_time_override ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public._bls_travado_alerts();

CREATE OR REPLACE FUNCTION public._catalog_travado_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.reconcile_demurrage_travado_alerts(NULL, 'demurrage_travado_catalogo');
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._catalog_travado_alerts() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_rates_travado_alerts
  AFTER INSERT OR UPDATE OR DELETE ON public.demurrage_rates
  FOR EACH STATEMENT EXECUTE FUNCTION public._catalog_travado_alerts();
CREATE TRIGGER trg_container_types_travado_alerts
  AFTER INSERT OR UPDATE OR DELETE ON public.container_types
  FOR EACH STATEMENT EXECUTE FUNCTION public._catalog_travado_alerts();

-- Aviso do cabeçalho: caixas de Correndo (D6).
CREATE OR REPLACE FUNCTION public.count_demurrage_running_boxes()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de leitura.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*)::integer
      FROM jsonb_array_elements(public._demurrage_billing_board_core()) AS grp(value),
           jsonb_array_elements(grp.value->'boxes') AS box(value)
     WHERE box.value->>'state' = 'running');
END;
$function$;
REVOKE ALL ON FUNCTION public.count_demurrage_running_boxes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_demurrage_running_boxes() TO authenticated;

DO $schedule_515$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING '515: pg_cron ausente; agende demurrage-travado-alerts no ambiente de produção.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demurrage-travado-alerts') THEN
    PERFORM cron.unschedule('demurrage-travado-alerts');
  END IF;
  PERFORM cron.schedule('demurrage-travado-alerts', '4-59/15 * * * *',
    $cmd_515$SELECT public.reconcile_demurrage_travado_alerts(NULL, 'demurrage-travado-alerts');$cmd_515$);
END;
$schedule_515$;
