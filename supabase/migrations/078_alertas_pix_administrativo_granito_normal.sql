-- Migration 078: responsável do PIX sem conciliação e severidade do Granito
-- sem cliente (decisões R2 e R7 de 2026-09-23, plano
-- docs/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md).
--
-- - pix_unreconciled: a Conciliação PIX só abre para o Administrativo, então
--   o Administrativo passa a tratar o Alerta. Documentação e Equipamentos
--   continuam na audiência da notificação interna (o PIX pode ser Demurrage).
-- - review_granite_customer_unlinked: Granito é apoio operacional e não
--   fatura (nota de 2026-09-23 na ADR 0042); sem dinheiro em risco, o Alerta
--   passa de Crítico para Normal.
--
-- Esta migration reescreve itens de Alerta já abertos para que a fila reflita
-- o catálogo novo. Ela se apoia na linha "Data status" do AGENTS.md: a base de
-- produção só tem fixtures descartáveis.

-- A fila aceitava só os três setores operacionais como responsável do item
-- (migration 029). O Administrativo passa a ser setor de fila válido, com o
-- mesmo corpo da 029 e apenas esta ampliação.
CREATE OR REPLACE FUNCTION public.upsert_alert_item_before_milestone_hardening(
  p_type text,
  p_entity_type text,
  p_entity_id text,
  p_message text,
  p_source text,
  p_department text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_destination text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_type), '') IS NULL OR NULLIF(btrim(p_entity_type), '') IS NULL
     OR NULLIF(btrim(p_entity_id), '') IS NULL OR NULLIF(btrim(p_message), '') IS NULL
     OR NULLIF(btrim(p_source), '') IS NULL OR v_department IS NULL THEN
    RAISE EXCEPTION 'Tipo, entidade, mensagem, origem e departamento são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF v_department NOT IN ('operacoes', 'documentacao', 'equipamentos', 'administrativo') THEN
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

  IF NOT FOUND THEN
    INSERT INTO public.alert_items (
      alert_id, item_type, source, severity, department, destination,
      message, metadata, status
    )
    VALUES (
      v_alert.id, p_type, p_source, v_catalog.severity, v_department,
      v_effective_destination, p_message,
      COALESCE(p_metadata, '{}'::jsonb), 'active'
    )
    RETURNING * INTO v_item;
    v_new_item := true;
  ELSE
    v_reopened := v_item.status = 'resolved';
    IF v_reopened
       OR v_item.source IS DISTINCT FROM p_source
       OR v_item.severity IS DISTINCT FROM v_catalog.severity
       OR v_item.department IS DISTINCT FROM v_department
       OR v_item.destination IS DISTINCT FROM v_effective_destination
       OR v_item.message IS DISTINCT FROM p_message
       OR v_item.metadata IS DISTINCT FROM COALESCE(p_metadata, '{}'::jsonb) THEN
      UPDATE public.alert_items
      SET source = p_source,
          severity = v_catalog.severity,
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
$$;

UPDATE public.alert_type_catalog
   SET responsible_department = 'administrativo',
       audience_departments = ARRAY['administrativo', 'documentacao', 'equipamentos']
 WHERE type = 'pix_unreconciled';

UPDATE public.alert_type_catalog
   SET severity = 'normal'
 WHERE type = 'review_granite_customer_unlinked';

UPDATE public.alert_items
   SET department = 'administrativo',
       updated_at = now()
 WHERE item_type = 'pix_unreconciled'
   AND status = 'active'
   AND department IS DISTINCT FROM 'administrativo';

UPDATE public.alert_items
   SET severity = 'normal',
       updated_at = now()
 WHERE item_type = 'review_granite_customer_unlinked'
   AND status = 'active'
   AND severity IS DISTINCT FROM 'normal';
