-- 604: reforço por tempo dos alertas e gravidade do item (decisão D8 do dono
-- de 2026-11-06; ADR 0131, lote 1 do plano 2026-11-06-decisoes-da-revisao-dos-alertas).
--
-- Até aqui a gravidade era só do tipo (`alert_type_catalog.severity`): todo
-- alerta aberto de um tipo tinha a mesma, e um alerta Normal esquecido avisava
-- uma vez e afundava na fila (brecha B23 da revisão de 2026-11-06).
--
-- 1. O item de alerta pode ficar Crítico acima do tipo:
--    - pelo marco: o produtor grava `metadata.severity = 'critical'` (os lotes
--      3, 4 e 5 usam isso: ATA/ATD atrasados, descarga, prazo do Desbloqueio);
--    - pelo tempo: `alert_items.escalated_at`, gravado pelo reforço por tempo,
--      vale até o alerta fechar ou mudar de marco (ocorrência nova).
--    `upsert_alert_item` deixa de rebaixar o item escalado.
-- 2. `alert_type_catalog.escalate_after_hours`: "vira Crítico depois de N
--    horas aberto". `escalate_aged_alert_items()`, a cada 5 minutos, escala o
--    item Normal aberto há mais de N horas na ocorrência atual, grava o evento
--    e avisa de novo no sino (com o desvio ao Administrativo do crítico).
-- 3. `set_alert_type_escalation(tipo, horas, motivo)`: só o Administrativo,
--    na tela Regras de alertas; `NULL` tira o reforço. Grava em `audit_logs`
--    (`alert_type`, campo `escalate_after_hours`).
-- 4. `set_alert_type_severity` (603) não rebaixa o item escalado quando o
--    tipo passa a Normal; `list_alert_type_settings` devolve também o reforço.
--
-- Plano de preservação: a migration só acrescenta duas colunas vazias
-- (`alert_type_catalog.escalate_after_hours` e `alert_items.escalated_at`,
-- nulas em todas as linhas) e não reescreve linha nenhuma. Os UPDATE abaixo
-- são corpos de função, que rodam pela ação do Administrativo (com o valor
-- anterior em `audit_logs`) ou pelo reforço por tempo, que só escala tipo
-- configurado (nenhum, ao aplicar). Conferir: `SELECT count(*) FROM
-- alert_items WHERE escalated_at IS NOT NULL` = 0 logo depois. Desfazer:
-- tirar o reforço na tela; as colunas podem ser removidas sem perda.
--
-- Rollback: reaplicar `upsert_alert_item` (8 argumentos) e
-- `upsert_alert_item_before_milestone_hardening` pela definição vigente da
-- 587/485, `set_alert_type_severity` e `list_alert_type_settings` pela 603,
-- `cron.unschedule('alerts-escalation')` e remover as duas colunas.

ALTER TABLE public.alert_type_catalog
  ADD COLUMN IF NOT EXISTS escalate_after_hours integer;
ALTER TABLE public.alert_type_catalog
  DROP CONSTRAINT IF EXISTS alert_type_catalog_escalate_after_hours_check;
ALTER TABLE public.alert_type_catalog
  ADD CONSTRAINT alert_type_catalog_escalate_after_hours_check
  CHECK (escalate_after_hours IS NULL OR escalate_after_hours BETWEEN 1 AND 720);
COMMENT ON COLUMN public.alert_type_catalog.escalate_after_hours IS
  'Reforço por tempo (604): o alerta Normal aberto há mais de N horas vira Crítico e avisa de novo. NULL = sem reforço.';

ALTER TABLE public.alert_items
  ADD COLUMN IF NOT EXISTS escalated_at timestamp with time zone;
COMMENT ON COLUMN public.alert_items.escalated_at IS
  'Quando o reforço por tempo (604) escalou o item a Crítico, na ocorrência atual; zera ao reabrir ou mudar de marco.';

-- 1. Abertura do alerta: gravidade do item ----------------------------------

CREATE OR REPLACE FUNCTION public.upsert_alert_item_before_milestone_hardening(p_type text, p_entity_type text, p_entity_id text, p_message text, p_source text, p_department text, p_metadata jsonb DEFAULT '{}'::jsonb, p_destination text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_item public.alert_items%ROWTYPE;
  v_event_id BIGINT;
  v_reopened BOOLEAN := false;
  v_new_item BOOLEAN := false;
  v_item_changed BOOLEAN := false;
  v_department TEXT := NULLIF(btrim(p_department), '');
  v_effective_destination TEXT;
  -- 604 (ADR 0131): gravidade do item, que pode ficar acima da do tipo.
  v_severity TEXT;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_type), '') IS NULL OR NULLIF(btrim(p_entity_type), '') IS NULL
     OR NULLIF(btrim(p_entity_id), '') IS NULL OR NULLIF(btrim(p_message), '') IS NULL
     OR NULLIF(btrim(p_source), '') IS NULL OR v_department IS NULL THEN
    RAISE EXCEPTION 'Tipo, entidade, mensagem, origem e departamento são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF v_department NOT IN ('operacoes', 'documentacao', 'equipamentos', 'administrativo', 'financeiro') THEN
    RAISE EXCEPTION 'Departamento inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_catalog
  FROM public.alert_type_catalog
  WHERE type = p_type AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de alerta fora do catálogo: %', p_type USING ERRCODE = '22023';
  END IF;

  -- The catalog trigger deliberately removes per-item destinations. Compare
  -- against that effective stored value so a normalized row is idempotent.
  v_effective_destination := NULL;

  PERFORM set_config('alerts.foundation_internal', 'on', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('alert:' || p_entity_type || ':' || p_entity_id, 0));

  SELECT * INTO v_alert
  FROM public.alerts a
  WHERE a.type = 'aggregate'
    AND a.entity_type = p_entity_type
    AND a.entity_id = p_entity_id
  ORDER BY a.id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.alerts(type, entity_type, entity_id, message, status)
    VALUES ('aggregate', p_entity_type, p_entity_id, p_message, 'open')
    RETURNING * INTO v_alert;
  ELSE
    UPDATE public.alerts
    SET status = 'open', closed_at = NULL
    WHERE id = v_alert.id;
    v_alert.status := 'open';
  END IF;

  SELECT * INTO v_item
  FROM public.alert_items
  WHERE alert_id = v_alert.id AND item_type = p_type AND department = v_department
  FOR UPDATE;

  -- 604 (ADR 0131): o item é Crítico quando o tipo é, quando o produtor marca
  -- o marco como crítico (`metadata.severity`) ou quando o reforço por tempo
  -- já o escalou nesta ocorrência (`escalated_at`, zerado ao reabrir).
  v_severity := CASE
    WHEN v_catalog.severity = 'critical' THEN 'critical'
    WHEN COALESCE(p_metadata, '{}'::jsonb)->>'severity' = 'critical' THEN 'critical'
    WHEN FOUND AND v_item.status = 'active' AND v_item.escalated_at IS NOT NULL THEN 'critical'
    ELSE 'normal'
  END;

  IF NOT FOUND THEN
    INSERT INTO public.alert_items (
      alert_id, item_type, source, severity, department, destination,
      message, metadata, status
    )
    VALUES (
      v_alert.id, p_type, p_source, v_severity, v_department,
      v_effective_destination, p_message,
      COALESCE(p_metadata, '{}'::jsonb), 'active'
    )
    RETURNING * INTO v_item;
    v_new_item := true;
  ELSE
    v_reopened := v_item.status = 'resolved';
    IF v_reopened
       OR v_item.source IS DISTINCT FROM p_source
       OR v_item.severity IS DISTINCT FROM v_severity
       OR v_item.department IS DISTINCT FROM v_department
       OR v_item.destination IS DISTINCT FROM v_effective_destination
       OR v_item.message IS DISTINCT FROM p_message
       OR v_item.metadata IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb) THEN
      UPDATE public.alert_items
      SET source = p_source,
          severity = v_severity,
          escalated_at = CASE WHEN v_reopened THEN NULL ELSE escalated_at END,
          department = v_department,
          destination = v_effective_destination,
          message = p_message,
          metadata = COALESCE(p_metadata, '{}'::jsonb),
          status = 'active',
          updated_at = now(),
          resolved_at = NULL,
          occurrence_id = CASE WHEN v_reopened THEN gen_random_uuid() ELSE occurrence_id END
      WHERE id = v_item.id
      RETURNING * INTO v_item;
      v_item_changed := true;
    END IF;
  END IF;

  IF v_new_item OR v_reopened THEN
    INSERT INTO public.alert_item_events (
      alert_item_id, occurrence_id, event_type, previous_status, new_status,
      actor_id, metadata
    )
    VALUES (
      v_item.id, v_item.occurrence_id, 'opened',
      CASE WHEN v_new_item THEN NULL ELSE 'resolved' END,
      'active', auth.uid(), COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_event_id;
    IF p_source <> 'foundation_backfill' THEN
      PERFORM public.fanout_alert_item_for_department(v_alert.id, v_item.id, v_event_id, v_department);
    END IF;
  ELSIF v_item_changed THEN
    INSERT INTO public.alert_item_events (
      alert_item_id, occurrence_id, event_type, previous_status, new_status,
      actor_id, metadata
    )
    VALUES (v_item.id, v_item.occurrence_id, 'updated', 'active', 'active',
            auth.uid(), COALESCE(p_metadata, '{}'::jsonb));
  END IF;

  PERFORM public.refresh_alert_aggregate(v_alert.id);
  PERFORM set_config('alerts.foundation_internal', 'off', true);
  RETURN jsonb_build_object(
    'alert_id', v_alert.id, 'item_id', v_item.id, 'event_id', v_event_id,
    'reopened', v_reopened, 'created', v_new_item
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_alert_item(p_type text, p_entity_type text, p_entity_id text, p_message text, p_source text, p_department text, p_metadata jsonb DEFAULT '{}'::jsonb, p_destination text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_before RECORD;
  v_after RECORD;
  v_result JSONB;
  v_event_id BIGINT;
  v_metadata JSONB := COALESCE(p_metadata, '{}'::jsonb);
  v_held_id BIGINT;
  v_cnpj TEXT;
BEGIN
  -- 587: tipo do Financeiro grava o item no Financeiro.
  p_department := public._alert_item_department(p_type, p_department);
  -- 476: resolvido com justificativa, o alerta de origem externa só volta
  -- quando a causa some e reaparece; 485: ou 24 h depois da justificativa, ou
  -- quando aparece outra causa no mesmo registro.
  IF p_type = ANY (public._alert_types_held_after_justification()) THEN
    SELECT i.id INTO v_held_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = p_type
      AND a.entity_type = p_entity_type
      AND a.entity_id = p_entity_id
      AND i.status = 'resolved'
      AND public._alert_item_held_by_justification(i.id)
      -- 485 (M6): outra causa do mesmo registro reabre o alerta.
      AND public._alert_cause_within_justified(i.id, p_type, v_metadata)
    ORDER BY i.id DESC
    LIMIT 1;
    IF v_held_id IS NOT NULL THEN
      RETURN jsonb_build_object('item_id', v_held_id, 'held_by_justification', true);
    END IF;
  END IF;

  -- 476 (ALE-D12): os alertas de contato abrem a ficha pelo CNPJ.
  IF p_type IN ('caixa_sem_destinatario', 'cliente_sem_contato_principal')
     AND p_entity_type = 'customer' AND NOT (v_metadata ? 'customer_cnpj') THEN
    SELECT c.cnpj_cpf INTO v_cnpj FROM public.customers c WHERE c.id::text = p_entity_id;
    IF v_cnpj IS NOT NULL THEN
      v_metadata := v_metadata || jsonb_build_object('customer_cnpj', v_cnpj);
    END IF;
  END IF;

  SELECT i.id, i.status, i.metadata
  INTO v_before
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type = p_type
    AND i.department = NULLIF(btrim(p_department), '')
    AND a.entity_type = p_entity_type
    AND a.entity_id = p_entity_id
  ORDER BY i.id DESC
  LIMIT 1;

  v_result := public.upsert_alert_item_before_milestone_hardening(
    p_type, p_entity_type, p_entity_id, p_message, p_source,
    p_department, v_metadata, p_destination
  );

  IF v_before.id IS NOT NULL
     AND v_before.status = 'active'
     AND v_metadata ? 'milestone'
     AND v_before.metadata->>'milestone' IS DISTINCT FROM v_metadata->>'milestone' THEN
    SELECT i.id, i.alert_id, i.occurrence_id
    INTO v_after
    FROM public.alert_items i
    WHERE i.id = v_before.id
    FOR UPDATE;

    -- 604 (ADR 0131): marco novo é ocorrência nova; o reforço por tempo
    -- recomeça, e a gravidade é a do tipo ou a do marco.
    UPDATE public.alert_items
    SET occurrence_id = gen_random_uuid(), updated_at = now(), escalated_at = NULL,
        severity = CASE
          WHEN (SELECT c.severity FROM public.alert_type_catalog c WHERE c.type = p_type) = 'critical' THEN 'critical'
          WHEN v_metadata->>'severity' = 'critical' THEN 'critical'
          ELSE 'normal' END
    WHERE id = v_after.id
    RETURNING id, alert_id, occurrence_id INTO v_after;

    INSERT INTO public.alert_item_events(
      alert_item_id, occurrence_id, event_type, previous_status, new_status,
      actor_id, metadata
    )
    VALUES (
      v_after.id, v_after.occurrence_id, 'opened', 'active', 'active',
      auth.uid(), v_metadata
    )
    RETURNING id INTO v_event_id;

    IF p_source <> 'foundation_backfill' THEN
      PERFORM public.fanout_alert_item_for_department(
        v_after.alert_id, v_after.id, v_event_id, p_department
      );
    END IF;

    v_result := jsonb_set(v_result, '{event_id}', to_jsonb(v_event_id), true);
  END IF;

  RETURN v_result;
END;
$function$;

-- 2. Reforço por tempo -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.escalate_aged_alert_items()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r RECORD;
  v_event_id bigint;
  v_count integer := 0;
BEGIN
  -- Rotina do sistema (pg_cron), como as da Demurrage (520).
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  FOR r IN
    SELECT i.id, i.alert_id, i.department, i.occurrence_id, c.escalate_after_hours
    FROM public.alert_items i
    JOIN public.alert_type_catalog c ON c.type = i.item_type
    WHERE i.status = 'active'
      AND i.severity = 'normal'
      AND i.escalated_at IS NULL
      AND c.active
      AND c.escalate_after_hours IS NOT NULL
      AND COALESCE(
            (SELECT min(e.created_at) FROM public.alert_item_events e
              WHERE e.alert_item_id = i.id AND e.occurrence_id = i.occurrence_id AND e.event_type = 'opened'),
            i.created_at)
          <= now() - make_interval(hours => c.escalate_after_hours)
    FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE public.alert_items
    SET severity = 'critical', escalated_at = now(), updated_at = now()
    WHERE id = r.id;

    INSERT INTO public.alert_item_events (
      alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata
    ) VALUES (
      r.id, r.occurrence_id, 'updated', 'active', 'active', NULL,
      jsonb_build_object('source', 'escalated_by_age', 'after_hours', r.escalate_after_hours)
    ) RETURNING id INTO v_event_id;

    PERFORM public.fanout_alert_item_for_department(r.alert_id, r.id, v_event_id, r.department);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.escalate_aged_alert_items() IS
  'Reforço por tempo (604, ADR 0131): escala a Crítico o alerta Normal aberto há mais horas que o tipo permite, e avisa de novo.';
REVOKE ALL ON FUNCTION public.escalate_aged_alert_items() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_aged_alert_items() TO service_role;

DO $schedule_604$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '604: pg_cron ausente; agende alerts-escalation no ambiente de produção.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'alerts-escalation';
  PERFORM cron.schedule('alerts-escalation', '*/5 * * * *',
    $cmd_604$SELECT public.escalate_aged_alert_items();$cmd_604$);
END;
$schedule_604$;

-- 3. Configuração pela tela --------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_alert_type_escalation(p_type text, p_hours integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_type text := NULLIF(btrim(COALESCE(p_type, '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_previous integer;
  v_severity text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo muda o reforço por tempo de um alerta.' USING ERRCODE = '42501';
  END IF;
  IF p_hours IS NOT NULL AND (p_hours < 1 OR p_hours > 720) THEN
    RAISE EXCEPTION 'Informe de 1 a 720 horas.' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da troca, com pelo menos 10 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT c.escalate_after_hours, c.severity INTO v_previous, v_severity
  FROM public.alert_type_catalog c
  WHERE c.type = v_type AND c.active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de alerta fora do catálogo: %.', COALESCE(v_type, '(vazio)') USING ERRCODE = 'P0002';
  END IF;
  IF v_previous IS NOT DISTINCT FROM p_hours THEN
    RAISE EXCEPTION 'O reforço deste alerta já é esse; atualize a página.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.alert_type_catalog SET escalate_after_hours = p_hours WHERE type = v_type;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('alert_type', v_type, 'escalate_after_hours', v_previous::text, p_hours::text, auth.uid(), v_reason);

  RETURN jsonb_build_object('type', v_type, 'previous_hours', v_previous, 'hours', p_hours, 'severity', v_severity);
END;
$function$;

COMMENT ON FUNCTION public.set_alert_type_escalation(text, integer, text) IS
  'Liga, muda ou tira (NULL) o reforço por tempo de um tipo de alerta; só o Administrativo, com motivo (604, ADR 0131).';
REVOKE ALL ON FUNCTION public.set_alert_type_escalation(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_alert_type_escalation(text, integer, text) TO authenticated, service_role;

-- 4. Troca de gravidade (603) sem rebaixar o item escalado ------------------

CREATE OR REPLACE FUNCTION public.set_alert_type_severity(p_type text, p_severity text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_type text := NULLIF(btrim(COALESCE(p_type, '')), '');
  v_severity text := NULLIF(btrim(COALESCE(p_severity, '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_previous text;
  v_items integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  -- ADR 0130: só o Administrativo (e a conta Dev, que é do Administrativo).
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo troca a gravidade de um alerta.' USING ERRCODE = '42501';
  END IF;
  IF v_severity IS NULL OR v_severity NOT IN ('critical', 'normal') THEN
    RAISE EXCEPTION 'Gravidade inválida: escolha Crítico ou Normal.' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da troca, com pelo menos 10 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT c.severity INTO v_previous
  FROM public.alert_type_catalog c
  WHERE c.type = v_type AND c.active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de alerta fora do catálogo: %.', COALESCE(v_type, '(vazio)') USING ERRCODE = 'P0002';
  END IF;
  IF v_previous = v_severity THEN
    RAISE EXCEPTION 'A gravidade deste alerta já é %; atualize a página.',
      CASE v_severity WHEN 'critical' THEN 'Crítico' ELSE 'Normal' END
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.alert_type_catalog
  SET severity = v_severity
  WHERE type = v_type;

  -- 604: o item escalado por tempo ou crítico pelo marco continua Crítico.
  UPDATE public.alert_items
  SET severity = v_severity,
      updated_at = now()
  WHERE item_type = v_type
    AND status = 'active'
    AND severity IS DISTINCT FROM v_severity
    AND NOT (v_severity = 'normal' AND (escalated_at IS NOT NULL OR COALESCE(metadata->>'severity', '') = 'critical'));
  GET DIAGNOSTICS v_items = ROW_COUNT;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('alert_type', v_type, 'severity', v_previous, v_severity, auth.uid(), v_reason);

  RETURN jsonb_build_object(
    'type', v_type,
    'previous_severity', v_previous,
    'severity', v_severity,
    'active_items', v_items
  );
END;
$function$;

-- 5. Leitura da tela, com o reforço ------------------------------------------

DROP FUNCTION IF EXISTS public.list_alert_type_settings();
CREATE FUNCTION public.list_alert_type_settings()
 RETURNS TABLE(
   type text,
   severity text,
   active_items integer,
   changed_at timestamp with time zone,
   changed_by_name text,
   previous_severity text,
   change_reason text,
   escalate_after_hours integer,
   escalation_changed_at timestamp with time zone,
   escalation_changed_by_name text,
   escalation_reason text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.type,
         c.severity,
         (SELECT count(*)::integer
            FROM public.alert_items i
           WHERE i.item_type = c.type AND i.status = 'active'),
         sev.changed_at,
         sev_by.full_name,
         sev.old_value,
         sev.justification,
         c.escalate_after_hours,
         esc.changed_at,
         esc_by.full_name,
         esc.justification
  FROM public.alert_type_catalog c
  LEFT JOIN LATERAL (
    SELECT l.changed_at, l.changed_by, l.old_value, l.justification
    FROM public.audit_logs l
    WHERE l.entity_type = 'alert_type' AND l.entity_id = c.type AND l.field_name = 'severity'
    ORDER BY l.changed_at DESC, l.id DESC
    LIMIT 1
  ) sev ON true
  LEFT JOIN public.user_profiles sev_by ON sev_by.id = sev.changed_by
  LEFT JOIN LATERAL (
    SELECT l.changed_at, l.changed_by, l.justification
    FROM public.audit_logs l
    WHERE l.entity_type = 'alert_type' AND l.entity_id = c.type AND l.field_name = 'escalate_after_hours'
    ORDER BY l.changed_at DESC, l.id DESC
    LIMIT 1
  ) esc ON true
  LEFT JOIN public.user_profiles esc_by ON esc_by.id = esc.changed_by
  WHERE c.active
  ORDER BY c.type;
END;
$function$;

COMMENT ON FUNCTION public.list_alert_type_settings() IS
  'Gravidade vigente, reforço por tempo, alertas abertos e as últimas trocas de cada tipo ativo de alerta (603, 604; ADRs 0130 e 0131).';
REVOKE ALL ON FUNCTION public.list_alert_type_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_alert_type_settings() TO authenticated, service_role;
