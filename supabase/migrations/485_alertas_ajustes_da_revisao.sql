-- 485: Alertas e sino, ajustes da revisão da PR #1070 (decisões do dono de
-- 2026-10-27; ADRs 0107 e 0108).
--
-- Problema e mudança, por seção:
--   1. P3 — os quatro alertas críticos da Documentação (Exceção crítica de
--      fatura do Portal, Caixa de comunicação sem destinatário, Cliente sem
--      contato principal, Contato com bounce sem alternativa) deixaram de
--      avisar o Administrativo na 476. Decisão do dono: avisam também o
--      Administrativo, como o Financeiro nos tipos do dinheiro. A audiência do
--      catálogo volta a incluí-lo e a entrega lê as exceções do catálogo.
--   2. P4 — resolvido com justificativa, um alerta de origem externa ficava
--      calado sem prazo enquanto a causa continuasse. Agora volta 24 h depois
--      da justificativa, se a causa ainda estiver lá.
--   3. M6 — "Rotina agendada com resposta de erro" usa um registro só para
--      todas as rotinas: a justificativa de uma falha calava a falha nova de
--      outra rotina. Agora, se aparece um tipo de falha que não estava na
--      justificativa (outro código HTTP, tempo esgotado, fila parada), o
--      alerta reabre na hora.
--   4. M7 — o sino e o número chamavam uma função por notificação, e as
--      notificações de alertas resolvidos ficam não lidas para sempre: o custo
--      crescia sem limite. A leitura passa a ser direta.
--
-- Data status: a seção 1 reescreve `alert_type_catalog.audience_departments`
-- dos quatro tipos. Depende da afirmação "Data status" do AGENTS.md
-- (2026-09-18): a produção não tem dados reais de negócio.
--
-- Rollback: reaplicar da `476` `fanout_alert_item_for_department`,
-- `_alert_item_held_by_justification`, `upsert_alert_item`,
-- `list_internal_notifications` e `count_unread_internal_notifications`;
-- DROP FUNCTION public._alert_cause_within_justified(bigint, text, jsonb),
-- public._alert_http_failure_kinds(jsonb); voltar a audiência dos quatro tipos
-- a `{documentacao}`; recriar `_internal_notification_is_current` da `476`.

-- 1. Os quatro críticos da Documentação avisam também o Administrativo -------
UPDATE public.alert_type_catalog
SET audience_departments = ARRAY['documentacao', 'administrativo']
WHERE type IN ('portal_excecao_critica_fatura', 'caixa_sem_destinatario',
               'cliente_sem_contato_principal', 'cliente_contato_bounced_sem_alternativa')
  AND audience_departments IS DISTINCT FROM ARRAY['documentacao', 'administrativo'];

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
  -- Exceções do dono: a audiência do catálogo é o responsável mais os setores
  -- que também são avisados — o Financeiro nos tipos do dinheiro (Pix,
  -- consulta Itaú, Restituição, Fatura desatualizada; 476) e o Administrativo
  -- nos quatro críticos da Documentação (Exceção crítica de fatura do Portal,
  -- Caixa sem destinatário, Cliente sem contato principal, Contato com bounce
  -- sem alternativa; 485).
  v_audience := ARRAY[v_department] || ARRAY(
    SELECT DISTINCT d FROM unnest(COALESCE(v_catalog.audience_departments, '{}'::text[])) AS d
    WHERE d IS DISTINCT FROM v_catalog.responsible_department AND d IS DISTINCT FROM v_department);

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


-- 2. A justificativa cala por 24 h ------------------------------------------
CREATE OR REPLACE FUNCTION public._alert_item_held_by_justification(p_item_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT e.metadata->>'source' = 'resolved_with_justification'
      AND e.created_at > now() - interval '24 hours'
    FROM public.alert_item_events e
    WHERE e.alert_item_id = p_item_id
    ORDER BY e.id DESC
    LIMIT 1
  ), false);
$function$;
REVOKE ALL ON FUNCTION public._alert_item_held_by_justification(bigint) FROM PUBLIC, anon, authenticated;

-- 3. Outra causa no mesmo registro reabre ------------------------------------

-- Tipos de falha das rotinas HTTP. ponytail: o pg_net não guarda qual rotina
-- chamou, então a "causa" é o conjunto de tipos (código HTTP, tempo esgotado,
-- sem resposta, fila parada) das últimas falhas do metadata; duas rotinas com
-- o mesmo código não se distinguem. Upgrade: gravar o nome da rotina no pedido.
CREATE OR REPLACE FUNCTION public._alert_http_failure_kinds(p_metadata jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT kind), '{}'::text[])
  FROM (
    SELECT CASE
      WHEN COALESCE((e->>'timed_out')::boolean, false) THEN 'tempo_esgotado'
      WHEN e->>'status_code' IS NULL THEN 'sem_resposta'
      ELSE 'http_' || (e->>'status_code') END AS kind
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_metadata->'examples') = 'array'
                                   THEN p_metadata->'examples' ELSE '[]'::jsonb END) AS e
    UNION ALL
    SELECT 'fila_parada' WHERE COALESCE((p_metadata->>'queued')::integer, 0) >= 30
  ) AS kinds;
$function$;
REVOKE ALL ON FUNCTION public._alert_http_failure_kinds(jsonb) FROM PUBLIC, anon, authenticated;

-- A causa de agora cabe na que foi justificada? Só as rotinas HTTP misturam
-- causas num registro; nos outros tipos, o registro já é a causa.
CREATE OR REPLACE FUNCTION public._alert_cause_within_justified(p_item_id bigint, p_type text, p_metadata jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_type <> 'rotina_http_falhou'
    OR public._alert_http_failure_kinds(p_metadata) <@ public._alert_http_failure_kinds(
      (SELECT i.metadata FROM public.alert_items i WHERE i.id = p_item_id));
$function$;
REVOKE ALL ON FUNCTION public._alert_cause_within_justified(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;

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

-- 4. Sino e número sem função por linha -------------------------------------
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
    AND EXISTS (
      -- 485 (M7): leitura direta, sem função por linha; vale a notificação do
      -- alerta ainda aberto, na mesma ocorrência.
      SELECT 1 FROM public.alert_items i
      JOIN public.alert_item_events e ON e.id = n.event_id
      WHERE i.id = n.alert_item_id AND i.status = 'active' AND e.occurrence_id = i.occurrence_id)
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
    AND EXISTS (
      -- 485 (M7): leitura direta, sem função por linha; vale a notificação do
      -- alerta ainda aberto, na mesma ocorrência.
      SELECT 1 FROM public.alert_items i
      JOIN public.alert_item_events e ON e.id = n.event_id
      WHERE i.id = n.alert_item_id AND i.status = 'active' AND e.occurrence_id = i.occurrence_id);

  RETURN v_count;
END;
$function$;

-- A função por linha da 476 fica sem uso.
DROP FUNCTION IF EXISTS public._internal_notification_is_current(bigint, bigint);
