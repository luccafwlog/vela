-- 607: alerta de container sem data de descarga, por atracação (decisão D2 do
-- dono de 2026-11-06; ADR 0131, lote 4 do plano
-- 2026-11-06-decisoes-da-revisao-dos-alertas).
--
-- Sem a data de descarga, o container fica para sempre no free time; o grupo
-- sem nenhuma descarga some da página Demurrage e nunca é cobrado (brecha B05).
-- Agora, no ATB de cada terminal, abre "Container sem descarga" (Normal, de
-- Equipamentos) quando algum container de B/L daquele terminal está sem a
-- data; 24 horas depois do ATB, o mesmo alerta muda de marco e vira Crítico
-- (marco crítico da migration 604), com novo aviso. Fecha quando todos têm a
-- descarga, o B/L é cancelado ou muda de terminal, o ATB sai ou a Viagem é
-- cancelada.
--
-- O terminal do container é o do B/L (`bls.terminal_id`, a exceção do B/L) ou,
-- sem ele, o da frente de carga cheia de importação da escala, como em
-- `resolve_bl_terminal_id` para o container.
--
-- Gatilhos: o ATB do terminal (`voyage_escala_terminal_state`) e a gravação de
-- datas e containers (`bl_containers`, por instrução). A rotina
-- `container-discharge-alerts` (15 min) faz a passagem das 24 horas e é a rede
-- de segurança.
--
-- Plano de preservação: a migration só acrescenta um tipo ao catálogo, funções,
-- gatilhos e uma rotina; não reescreve nem apaga linha existente. Os alertas
-- nascem pela rotina e pelos gatilhos. Conferir: `SELECT count(*) FROM
-- alert_type_catalog WHERE type = 'container_sem_descarga'` = 1 e nenhum
-- outro tipo mudado. Desfazer: o rollback abaixo e `UPDATE
-- alert_type_catalog SET active = false WHERE type = 'container_sem_descarga'`.
--
-- Rollback: `cron.unschedule('container-discharge-alerts')`, remover os gatilhos
-- `trg_container_discharge_alert_on_atb`, `trg_container_discharge_alert_on_dates`
-- e `trg_container_discharge_alert_on_insert` e as funções desta migration.

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES ('container_sem_descarga', 'normal', 'equipamentos', ARRAY['equipamentos'], '/containers', true)
ON CONFLICT (type) DO NOTHING;

-- Terminal do container do B/L: a exceção do B/L ou a frente de carga cheia.
CREATE OR REPLACE FUNCTION public._bl_container_terminal_id(p_bl_id text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(b.terminal_id, (
    SELECT f.terminal_id
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = b.voyage_id
      AND public.normalize_port_code(f.port) = public.normalize_port_code(b.pod)
      AND f.sentido = 'importacao'
      AND f.modalidade = 'carga_cheia'
      AND f.terminal_id IS NOT NULL
    ORDER BY f.updated_at DESC, f.id DESC
    LIMIT 1))
  FROM public.bls AS b
  WHERE b.id = p_bl_id;
$function$;
REVOKE ALL ON FUNCTION public._bl_container_terminal_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bl_container_terminal_id(text) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_container_discharge_alert(p_voyage_id bigint, p_port text, p_terminal_id uuid, p_source text DEFAULT 'container_discharge')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := upper(btrim(p_port));
  v_code text := public.voyage_terminal_code(p_terminal_id);
  v_entity_id text := p_voyage_id || '::' || v_port || '::' || v_code;
  v_atb timestamptz;
  v_status text;
  v_missing integer := 0;
  v_late boolean;
BEGIN
  IF p_voyage_id IS NULL OR p_terminal_id IS NULL OR v_port = '' THEN RETURN; END IF;

  SELECT s.terminal_atb INTO v_atb
  FROM public.voyage_escala_terminal_state s
  WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = p_terminal_id;
  SELECT v.status INTO v_status FROM public.voyages v WHERE v.id = p_voyage_id;

  IF v_atb IS NOT NULL AND COALESCE(v_status, '') <> 'cancelled' THEN
    SELECT count(*) INTO v_missing
    FROM public.bl_containers c
    JOIN public.bls b ON b.id = c.bl_id
    WHERE b.voyage_id = p_voyage_id
      AND public.normalize_port_code(b.pod) = public.normalize_port_code(v_port)
      AND b.cancelled_at IS NULL
      AND c.discharge_date IS NULL
      AND public._bl_container_terminal_id(b.id) = p_terminal_id;
  END IF;

  IF v_missing = 0 THEN
    PERFORM public.resolve_alert_item('container_sem_descarga', 'voyage_escala_terminal', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_late := now() >= v_atb + interval '24 hours';
  PERFORM public.upsert_alert_item(
    'container_sem_descarga', 'voyage_escala_terminal', v_entity_id,
    'Terminal ' || v_code || ': ' || v_missing
      || CASE WHEN v_missing = 1 THEN ' container sem data de descarga' ELSE ' containers sem data de descarga' END
      || ' desde o ATB de ' || to_char(v_atb AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      || CASE WHEN v_late THEN ' (mais de 24 horas).' ELSE '.' END,
    p_source, 'equipamentos',
    jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port, 'terminal', v_code, 'containers', v_missing)
      || CASE WHEN v_late THEN jsonb_build_object('milestone', 'sem_descarga_24h', 'severity', 'critical')
              ELSE jsonb_build_object('milestone', 'sem_descarga') END,
    NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_container_discharge_alert(bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_container_discharge_alert(bigint, text, uuid, text) TO service_role;

-- Rotina: atracações com ATB nos últimos 60 dias e os alertas ainda abertos.
CREATE OR REPLACE FUNCTION public.reconcile_container_discharge_alerts(p_source text DEFAULT 'container-discharge-alerts')
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
    SELECT s.voyage_id, s.port, s.terminal_id
    FROM public.voyage_escala_terminal_state s
    WHERE s.terminal_id IS NOT NULL
      AND s.terminal_atb IS NOT NULL
      AND s.terminal_atb >= now() - interval '60 days'
    UNION
    SELECT s.voyage_id, s.port, s.terminal_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    JOIN public.voyage_escala_terminal_state s
      ON a.entity_id = s.voyage_id || '::' || s.port || '::' || public.voyage_terminal_code(s.terminal_id)
    WHERE i.item_type = 'container_sem_descarga' AND i.status = 'active'
  LOOP
    PERFORM public.reconcile_container_discharge_alert(r.voyage_id, r.port, r.terminal_id, p_source);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_container_discharge_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_container_discharge_alerts(text) TO service_role;

-- Gatilho do ATB do terminal.
CREATE OR REPLACE FUNCTION public._container_discharge_alert_on_atb()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.terminal_id IS NOT NULL THEN
    PERFORM public.reconcile_container_discharge_alert(OLD.voyage_id, OLD.port, OLD.terminal_id, 'terminal_atb');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.terminal_id IS NOT NULL THEN
    PERFORM public.reconcile_container_discharge_alert(NEW.voyage_id, NEW.port, NEW.terminal_id, 'terminal_atb');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Alerta de container sem descarga ignorado no ATB: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._container_discharge_alert_on_atb() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_container_discharge_alert_on_atb ON public.voyage_escala_terminal_state;
CREATE TRIGGER trg_container_discharge_alert_on_atb
AFTER INSERT OR DELETE OR UPDATE OF terminal_atb, terminal_id ON public.voyage_escala_terminal_state
FOR EACH ROW EXECUTE FUNCTION public._container_discharge_alert_on_atb();

-- Gatilho das datas e dos containers: uma conferência por atracação afetada,
-- não por linha (a planilha de datas grava centenas de containers).
CREATE OR REPLACE FUNCTION public._container_discharge_alert_on_containers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR r IN
    SELECT DISTINCT s.voyage_id, s.port, s.terminal_id
    FROM changed_rows AS c
    JOIN public.bls b ON b.id = c.bl_id
    JOIN public.voyage_escala_terminal_state s
      ON s.voyage_id = b.voyage_id
     AND public.normalize_port_code(s.port) = public.normalize_port_code(b.pod)
     AND s.terminal_id = public._bl_container_terminal_id(b.id)
    WHERE s.terminal_atb IS NOT NULL
  LOOP
    PERFORM public.reconcile_container_discharge_alert(r.voyage_id, r.port, r.terminal_id, 'container_dates');
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Alerta de container sem descarga ignorado nas datas: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._container_discharge_alert_on_containers() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_container_discharge_alert_on_dates ON public.bl_containers;
CREATE TRIGGER trg_container_discharge_alert_on_dates
AFTER UPDATE ON public.bl_containers
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public._container_discharge_alert_on_containers();

DROP TRIGGER IF EXISTS trg_container_discharge_alert_on_insert ON public.bl_containers;
CREATE TRIGGER trg_container_discharge_alert_on_insert
AFTER INSERT ON public.bl_containers
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public._container_discharge_alert_on_containers();

DO $schedule_607$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '607: pg_cron ausente; agende container-discharge-alerts no ambiente de produção.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'container-discharge-alerts';
  PERFORM cron.schedule('container-discharge-alerts', '11-59/15 * * * *',
    $cmd_607$SELECT public.reconcile_container_discharge_alerts('container-discharge-alerts');$cmd_607$);
END;
$schedule_607$;
