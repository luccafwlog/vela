-- 476: Alertas e sino (decisões do dono de 2026-10-27, lote 8 do plano de
-- correções; pontos 2 e 3 de `docs/manual/decisoes/pontos-do-dono.md`; ADRs
-- 0107 e 0108).
--
-- Problema e mudança, por seção:
--   1. Ponto 2 — o sino entregava à audiência do catálogo, que em 5 tipos
--      incluía setor que não é o responsável. Agora entrega só ao setor
--      responsável pelo item (`alert_items.department`; sem ele, o do
--      catálogo). Exceção decidida pelo dono em 2026-10-27: os tipos com o
--      Financeiro na audiência (Pix sem conciliação segura, Consulta de Pix do
--      Itaú parada, Restituição pendente e Fatura desatualizada) continuam
--      avisando também o Financeiro (P5 da ADR 0085). Alerta crítico sem
--      ninguém ativo nesses setores continua indo ao Administrativo.
--   2. Ponto 2 — a notificação ficava no sino e no número até a pessoa marcar
--      como lida, mesmo com o alerta resolvido. O sino e o número passam a
--      mostrar só as notificações do alerta ainda aberto, na ocorrência atual
--      (reaberto, o alerta volta pela notificação nova).
--   3. Ponto 3 — a dispensa sai: `dismiss_alert_item` é removida, a fila, a
--      contagem e o resumo por setor deixam de olhar `alert_item_dismissals`
--      (as dispensas vigentes acabam na hora; o histórico fica guardado) e o
--      filtro `dismissed` deixa de existir. ALE-D07 deixa de valer.
--   4. Ponto 3 (b) — tipos cuja origem a equipe não corrige pela tela
--      (consulta de Pix do Itaú parada, retorno do provedor de e-mail calado,
--      rotina por horário com falha e fila de efeitos de importação parada)
--      ganham "Resolver com justificativa". O alerta resolvido assim não
--      reabre enquanto a mesma causa continua; reabre se a causa sumir e
--      voltar (a varredura registra o fim da causa).
--   5. ALE-D06 — a fila devolve `opened_at`, a abertura da ocorrência atual,
--      para a coluna "Aberto em".
--   6. ALE-D08 — a resolução com justificativa grava uma linha em
--      `audit_logs` (assunto Alerta), lida em Admin › Histórico de ações com
--      o autor e a justificativa.
--   7. ALE-D12 — "Caixa de comunicação sem destinatário" e "Cliente sem
--      contato principal" passam a guardar o CNPJ do Cliente
--      (`metadata.customer_cnpj`), e Resolver abre a ficha dele.
--
-- Data status: a seção 1 reescreve `alert_type_catalog.audience_departments`
-- e a seção 7 acrescenta `customer_cnpj` ao `metadata` de itens de alerta
-- existentes. Depende da afirmação "Data status" do AGENTS.md
-- (2026-09-18): a produção não tem dados reais de negócio.
--
-- Rollback: reaplicar `fanout_alert_item` e `fanout_alert_item_for_department`
-- da `440`, `list_internal_notifications` e `count_unread_internal_notifications`
-- da `002`, `dismiss_alert_item` da `441`, `list_alert_queue_page`,
-- `count_alert_queue` e `summarize_alert_queue_by_department` da `002`
-- (com a lente de dispensa), `upsert_alert_item` da `330`, `resolve_alert_item`
-- da `426`, `_alert_types_resolved_with_justification` e
-- `resolve_alert_item_with_justification` da `441`.

-- 1. Sino só para o setor responsável --------------------------------------

CREATE OR REPLACE FUNCTION public.fanout_alert_item_for_department(p_alert_id bigint, p_item_id bigint, p_event_id bigint, p_department text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_user RECORD;
  v_department TEXT;
  v_audience TEXT[];
  v_count INTEGER := 0;
  v_fallback BOOLEAN := false;
BEGIN
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id;
  SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;
  SELECT * INTO v_catalog FROM public.alert_type_catalog WHERE type = v_item.item_type;

  -- 476: o sino é do setor responsável pelo item (ponto 2 do dono); a
  -- audiência do catálogo não amplia mais a entrega.
  v_department := COALESCE(NULLIF(btrim(p_department), ''), NULLIF(btrim(v_item.department), ''), v_catalog.responsible_department);
  -- Exceção do dono: o Financeiro, sem ser responsável, segue avisado nos
  -- tipos em que está na audiência (Pix, consulta Itaú, Restituição, Fatura
  -- desatualizada).
  v_audience := ARRAY[v_department]
    || CASE WHEN 'financeiro' = ANY (COALESCE(v_catalog.audience_departments, '{}'::text[]))
              AND v_department IS DISTINCT FROM 'financeiro'
            THEN ARRAY['financeiro'] ELSE '{}'::text[] END;

  -- O papel legado `operator` é Documentação, como no resto do sistema (328).
  -- Conta de integração não é pessoa e não recebe aviso (440).
  FOR v_user IN
    SELECT up.id, CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END AS department
    FROM public.user_profiles up
    WHERE up.active = true
      AND up.account_kind <> 'integracao'
      AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY (v_audience)
  LOOP
    INSERT INTO public.internal_notifications (
      alert_id, alert_item_id, event_id, recipient_id, recipient_department,
      is_fallback, item_type, severity, title, message, entity_type, entity_id,
      destination, payload
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
      false, v_item.item_type, v_item.severity, 'Nova pendência operacional',
      v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
      v_item.metadata
    )
    ON CONFLICT (event_id, recipient_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 AND v_item.severity = 'critical' THEN
    v_fallback := true;
    FOR v_user IN
      SELECT up.id, up.role AS department
      FROM public.user_profiles up
      WHERE up.active = true AND up.role = 'administrativo'
        AND up.account_kind <> 'integracao'
    LOOP
      INSERT INTO public.internal_notifications (
        alert_id, alert_item_id, event_id, recipient_id, recipient_department,
        is_fallback, item_type, severity, title, message, entity_type, entity_id,
        destination, payload
      )
      VALUES (
        p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
        true, v_item.item_type, v_item.severity, 'Nova pendência operacional',
        v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
        jsonb_build_object('fallback_for', v_department) || v_item.metadata
      )
      ON CONFLICT (event_id, recipient_id) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  IF v_count = 0 THEN
    INSERT INTO public.alert_notification_failures (
      alert_id, alert_item_id, event_id, item_type, department, reason
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_item.item_type,
      COALESCE(v_department, 'desconhecido'),
      CASE WHEN v_fallback THEN 'Nenhum destinatário ativo no fallback Administrativo.'
           ELSE 'Nenhum destinatário ativo no setor responsável do item.' END
    );
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fanout_alert_item(p_alert_id bigint, p_item_id bigint, p_event_id bigint)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 476: mesma entrega da versão por setor, com o setor gravado no item.
  SELECT public.fanout_alert_item_for_department(p_alert_id, p_item_id, p_event_id, NULL);
$function$;

-- A audiência do catálogo passa a dizer o mesmo que a entrega: o responsável
-- e, nos quatro tipos da exceção, o Financeiro (Data status no cabeçalho).
UPDATE public.alert_type_catalog
SET audience_departments = ARRAY[responsible_department]
  || CASE WHEN 'financeiro' = ANY (audience_departments) AND responsible_department <> 'financeiro'
          THEN ARRAY['financeiro'] ELSE '{}'::text[] END
WHERE audience_departments IS DISTINCT FROM (ARRAY[responsible_department]
  || CASE WHEN 'financeiro' = ANY (audience_departments) AND responsible_department <> 'financeiro'
          THEN ARRAY['financeiro'] ELSE '{}'::text[] END);

-- 2. Alerta resolvido sai do sino e do número ------------------------------

-- A notificação vale enquanto o alerta dela está aberto, na mesma ocorrência.
CREATE OR REPLACE FUNCTION public._internal_notification_is_current(p_item_id bigint, p_event_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.alert_items i
    JOIN public.alert_item_events e ON e.id = p_event_id
    WHERE i.id = p_item_id
      AND i.status = 'active'
      AND e.occurrence_id = i.occurrence_id
  );
$function$;
REVOKE ALL ON FUNCTION public._internal_notification_is_current(bigint, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_internal_notifications(p_include_read boolean DEFAULT false, p_limit integer DEFAULT 20, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id bigint DEFAULT NULL::bigint)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id', n.id,
    'alert_id', n.alert_id,
    'alert_item_id', n.alert_item_id,
    'item_type', n.item_type,
    'severity', n.severity,
    'title', n.title,
    'message', n.message,
    'entity_type', n.entity_type,
    'entity_id', n.entity_id,
    'destination', n.destination,
    'is_fallback', n.is_fallback,
    'read_at', n.read_at,
    'created_at', n.created_at,
    'payload', n.payload
  )
  FROM public.internal_notifications n
  WHERE public.is_active_read_user()
    AND n.recipient_id = auth.uid()
    AND (p_include_read OR n.read_at IS NULL)
    AND public._internal_notification_is_current(n.alert_item_id, n.event_id)
    AND (
      p_before_created_at IS NULL
      OR n.created_at < p_before_created_at
      OR (n.created_at = p_before_created_at AND n.id < p_before_id)
    )
  ORDER BY n.created_at DESC, n.id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$function$;

CREATE OR REPLACE FUNCTION public.count_unread_internal_notifications()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.internal_notifications n
  WHERE n.recipient_id = auth.uid()
    AND n.read_at IS NULL
    AND public._internal_notification_is_current(n.alert_item_id, n.event_id);

  RETURN v_count;
END;
$function$;

-- 3. Fim da dispensa, e 5. "Aberto em" da ocorrência atual -----------------

DROP FUNCTION IF EXISTS public.dismiss_alert_item(bigint, text, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.list_alert_queue_page(p_filter text DEFAULT 'active'::text, p_entity_type text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 100, p_department text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  -- 476: sem dispensa, 'active' e 'all' são a mesma fila.
  IF p_filter NOT IN ('active', 'all') THEN
    RAISE EXCEPTION 'Filtro inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_offset < 0 OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Paginação inválida.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH queue_rows AS (
    SELECT jsonb_build_object(
      'id', a.id,
      'item_id', i.id,
      'status', a.status,
      'item_status', i.status,
      'type', i.item_type,
      'severity', i.severity,
      'department', i.department,
      'message', i.message,
      'entity_type', a.entity_type,
      'entity_id', a.entity_id,
      'destination', i.destination,
      'created_at', a.created_at,
      'opened_at', COALESCE(o.opened_at, i.created_at),
      'updated_at', i.updated_at,
      'metadata', i.metadata
    ) AS payload,
    (i.severity = 'critical') AS is_critical,
    COALESCE(o.opened_at, i.created_at) AS sort_at,
    i.id AS item_id
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
    LEFT JOIN LATERAL (
      SELECT min(e.created_at) AS opened_at
      FROM public.alert_item_events e
      WHERE e.alert_item_id = i.id AND e.occurrence_id = i.occurrence_id
    ) o ON true
    WHERE a.status <> 'closed'
      AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
      AND (
        p_department IS NULL
        OR i.department = p_department
        OR (p_department = 'sem_departamento' AND (i.department IS NULL OR btrim(i.department) = ''))
      )

    UNION ALL

    SELECT jsonb_build_object(
      'id', a.id,
      'item_id', NULL,
      'status', a.status,
      'item_status', NULL,
      'type', a.type,
      'severity', COALESCE(c.severity, 'normal'),
      'department', c.responsible_department,
      'message', a.message,
      'entity_type', a.entity_type,
      'entity_id', a.entity_id,
      'destination', c.default_destination,
      'created_at', a.created_at,
      'opened_at', a.created_at,
      'updated_at', a.created_at,
      'metadata', '{}'::jsonb
    ) AS payload,
    (COALESCE(c.severity, 'normal') = 'critical') AS is_critical,
    a.created_at AS sort_at,
    a.id AS item_id
    FROM public.alerts a
    LEFT JOIN public.alert_type_catalog c ON c.type = a.type
    WHERE a.status <> 'closed'
      AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
      AND (
        p_department IS NULL
        OR c.responsible_department = p_department
        OR (p_department = 'sem_departamento' AND (c.responsible_department IS NULL OR btrim(c.responsible_department) = ''))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id
      )
  )
  SELECT payload
  FROM queue_rows
  ORDER BY
    is_critical DESC,
    sort_at DESC,
    item_id DESC
  OFFSET p_offset
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_alert_queue(p_filter text DEFAULT 'active'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF p_filter NOT IN ('active', 'all') THEN RAISE EXCEPTION 'Filtro inválido.' USING ERRCODE = '22023'; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT i.id
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
    WHERE a.status <> 'closed'
    UNION ALL
    SELECT a.id
    FROM public.alerts a
    WHERE a.status <> 'closed'
      AND NOT EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id)
  ) queue_rows;

  RETURN v_count;
END;
$function$;

-- O resumo perde a coluna `dismissed_count`: o tipo de retorno muda.
DROP FUNCTION IF EXISTS public.summarize_alert_queue_by_department();
CREATE FUNCTION public.summarize_alert_queue_by_department()
 RETURNS TABLE(department text, active_count bigint, is_legacy boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH item_rows AS (
    SELECT
      COALESCE(NULLIF(btrim(i.department), ''), 'sem_departamento') AS dept,
      false AS is_legacy
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
    WHERE a.status <> 'closed'

    UNION ALL

    SELECT
      COALESCE(NULLIF(btrim(c.responsible_department), ''), 'sem_departamento') AS dept,
      true AS is_legacy
    FROM public.alerts a
    LEFT JOIN public.alert_type_catalog c ON c.type = a.type
    WHERE a.status <> 'closed'
      AND NOT EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id)
  )
  SELECT
    dept AS department,
    COUNT(*) AS active_count,
    bool_or(item_rows.is_legacy) AS is_legacy
  FROM item_rows
  GROUP BY dept
  ORDER BY
    CASE WHEN dept = 'sem_departamento' THEN 1 ELSE 0 END,
    dept ASC;
END;
$function$;
REVOKE ALL ON FUNCTION public.summarize_alert_queue_by_department() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.summarize_alert_queue_by_department() TO authenticated, service_role;

-- 4. Justificativa nos tipos de origem externa ------------------------------

-- Tipos de estado (a varredura reabre enquanto a causa continua) cuja origem
-- a equipe não corrige pela tela: depois da justificativa, só reabrem quando
-- a causa some e volta (476, ponto 3 do dono).
CREATE OR REPLACE FUNCTION public._alert_types_held_after_justification()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['itau_pix_consulta_parada', 'email_retorno_provedor_silencioso',
    'rotina_http_falhou', 'import_effects_queue_stalled']::text[];
$function$;
REVOKE ALL ON FUNCTION public._alert_types_held_after_justification() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._alert_types_resolved_with_justification()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['portal_abuso_login', 'bl_vehicles_changed_on_reimport', 'ce_trocado_com_desbloqueio',
    'cobranca_demurrage_recusada', 'desbloqueio_ce_aviso_nao_enviado',
    'demurrage_invoice_dates_changed', 'comunicado_recusado']::text[]
    || public._alert_types_held_after_justification();
$function$;

-- Último evento do item é a resolução com justificativa: a causa ainda não sumiu.
CREATE OR REPLACE FUNCTION public._alert_item_held_by_justification(p_item_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT e.metadata->>'source' = 'resolved_with_justification'
    FROM public.alert_item_events e
    WHERE e.alert_item_id = p_item_id
    ORDER BY e.id DESC
    LIMIT 1
  ), false);
$function$;
REVOKE ALL ON FUNCTION public._alert_item_held_by_justification(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_alert_item_with_justification(p_item_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_item public.alert_items%ROWTYPE;
  v_entity_type text;
  v_entity_id text;
  v_event_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa da resolução.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de alerta não está ativo.' USING ERRCODE = 'P0002';
  END IF;
  SELECT a.entity_type, a.entity_id INTO v_entity_type, v_entity_id FROM public.alerts a WHERE a.id = v_item.alert_id;
  IF NOT public._alert_item_resolved_with_justification(v_item.item_type, v_entity_type) THEN
    RAISE EXCEPTION 'Este alerta fecha sozinho quando a origem é corrigida; não se resolve com justificativa.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.alert_items
  SET status = 'resolved', updated_at = now(), resolved_at = now()
  WHERE id = v_item.id;
  INSERT INTO public.alert_item_events(
    alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata
  ) VALUES (
    v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved', auth.uid(),
    jsonb_build_object('source', 'resolved_with_justification', 'reason', v_reason)
  ) RETURNING id INTO v_event_id;
  PERFORM public.refresh_alert_aggregate(v_item.alert_id);

  -- ALE-D08: a resolução aparece em Admin › Histórico de ações (assunto Alerta).
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('alert_item', v_item.id::text, 'status', v_item.item_type, 'resolved', auth.uid(), v_reason);

  RETURN jsonb_build_object('item_id', v_item.id, 'event_id', v_event_id, 'reason', v_reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_alert_item(p_type text, p_entity_type text, p_entity_id text, p_source text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD;
  v_found BOOLEAN := false;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  FOR v_item IN
    SELECT i.id, i.alert_id, i.occurrence_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = p_type
      AND a.entity_type = p_entity_type
      AND a.entity_id = p_entity_id
      AND i.status = 'active'
    FOR UPDATE
  LOOP
    v_found := true;
    UPDATE public.alert_items
    SET status = 'resolved', updated_at = now(), resolved_at = now()
    WHERE id = v_item.id;
    INSERT INTO public.alert_item_events(
      alert_item_id, occurrence_id, event_type, previous_status,
      new_status, actor_id, metadata
    ) VALUES (
      v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved',
      auth.uid(), COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', p_source)
    );
    PERFORM public.refresh_alert_aggregate(v_item.alert_id);
  END LOOP;

  -- 476: a causa sumiu depois de uma resolução com justificativa; se voltar,
  -- o alerta reabre.
  IF p_type = ANY (public._alert_types_held_after_justification()) THEN
    INSERT INTO public.alert_item_events(
      alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata
    )
    SELECT i.id, i.occurrence_id, 'resolved', 'resolved', 'resolved', auth.uid(),
      jsonb_build_object('source', 'origin_cleared', 'by', p_source)
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = p_type
      AND a.entity_type = p_entity_type
      AND a.entity_id = p_entity_id
      AND i.status = 'resolved'
      AND public._alert_item_held_by_justification(i.id);
  END IF;
  RETURN v_found;
END;
$function$;

-- 4 e 7. A abertura respeita a justificativa e guarda o CNPJ do Cliente ----

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
  -- 476: resolvido com justificativa, o alerta de origem externa só volta
  -- quando a causa some e reaparece.
  IF p_type = ANY (public._alert_types_held_after_justification()) THEN
    SELECT i.id INTO v_held_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = p_type
      AND a.entity_type = p_entity_type
      AND a.entity_id = p_entity_id
      AND i.status = 'resolved'
      AND public._alert_item_held_by_justification(i.id)
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

    UPDATE public.alert_items
    SET occurrence_id = gen_random_uuid(), updated_at = now()
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

-- Itens já abertos dos dois tipos ganham o CNPJ (Data status no cabeçalho).
UPDATE public.alert_items i
SET metadata = i.metadata || jsonb_build_object('customer_cnpj', c.cnpj_cpf)
FROM public.alerts a, public.customers c
WHERE a.id = i.alert_id
  AND a.entity_type = 'customer'
  AND c.id::text = a.entity_id
  AND i.item_type IN ('caixa_sem_destinatario', 'cliente_sem_contato_principal')
  AND NOT (i.metadata ? 'customer_cnpj')
  AND c.cnpj_cpf IS NOT NULL;
