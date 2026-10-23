-- 433: a dispensa de alerta vale por até 30 dias (auditoria de segurança
-- run-3, decisão do dono em 2026-10-22).
--
-- `dismiss_alert_item` aceitava qualquer data futura: uma dispensa para 2099
-- tirava o item da fila ativa para sempre, sem passar pela revisão que a
-- ADR 0053 pede. Agora a data de revisão vai até o fim do 30º dia (UTC) a
-- partir de hoje, o mesmo limite que a tela oferece (`T23:59:59Z` do 30º
-- dia, `getMaxReviewDateString`). Data além disso: 22023.
--
-- Só redefine a função (corpo da 002 mais a checagem nova); não reescreve nem
-- apaga linhas: dispensas já gravadas com data mais longa seguem até a data
-- delas.
-- Rollback: reaplicar a definição da 002.

CREATE OR REPLACE FUNCTION public.dismiss_alert_item(p_item_id bigint, p_reason text, p_review_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_dismissal public.alert_item_dismissals%ROWTYPE;
  v_event_id BIGINT;
  v_actor_name TEXT;
  v_author_name TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da dispensa é obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF p_review_at IS NULL OR p_review_at <= now() THEN
    RAISE EXCEPTION 'A revisão deve ser uma data futura.' USING ERRCODE = '22023';
  END IF;
  -- 433: até o fim do 30º dia (UTC) a partir de hoje, o limite da tela.
  IF p_review_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '31 days') AT TIME ZONE 'UTC' THEN
    RAISE EXCEPTION 'A dispensa vale por no máximo 30 dias.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de alerta não está ativo.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_alert FROM public.alerts WHERE id = v_item.alert_id;

  SELECT full_name INTO v_actor_name FROM public.user_profiles WHERE id = auth.uid();
  v_author_name := COALESCE(NULLIF(btrim(v_actor_name), ''), 'Usuário');

  -- Gravar a dispensa auditada
  INSERT INTO public.alert_item_dismissals(alert_item_id, occurrence_id, reason, dismissed_by, review_at)
  VALUES (v_item.id, v_item.occurrence_id, btrim(p_reason), auth.uid(), p_review_at)
  RETURNING * INTO v_dismissal;

  -- Gravar o evento 'dismissed' na ocorrência corrente
  INSERT INTO public.alert_item_events (
    alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata
  )
  VALUES (
    v_item.id,
    v_item.occurrence_id,
    'dismissed',
    v_item.status,
    v_item.status,
    auth.uid(),
    jsonb_build_object(
      'reason', btrim(p_reason),
      'review_at', p_review_at,
      'dismissal_id', v_dismissal.id
    )
  )
  RETURNING id INTO v_event_id;

  -- Fan-out do Eco de Tratamento para os destinatários que já receberam notificações
  -- nesta ocorrência, excluindo o autor da dispensa (auth.uid()).
  INSERT INTO public.internal_notifications (
    alert_id,
    alert_item_id,
    event_id,
    recipient_id,
    recipient_department,
    is_fallback,
    item_type,
    severity,
    title,
    message,
    entity_type,
    entity_id,
    destination,
    payload
  )
  SELECT DISTINCT ON (n.recipient_id)
    v_alert.id,
    v_item.id,
    v_event_id,
    n.recipient_id,
    n.recipient_department,
    n.is_fallback,
    v_item.item_type,
    'normal',
    'Pendência dispensada',
    'Pendência dispensada por ' || v_author_name || ' até ' || to_char(p_review_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
    v_alert.entity_type,
    v_alert.entity_id,
    NULL,
    jsonb_build_object(
      'is_echo', true,
      'dismissed_by', auth.uid(),
      'dismissed_by_name', v_author_name,
      'reason', btrim(p_reason),
      'review_at', p_review_at,
      'dismissal_id', v_dismissal.id
    )
  FROM public.internal_notifications n
  JOIN public.alert_item_events e ON e.id = n.event_id
  WHERE n.alert_item_id = v_item.id
    AND e.occurrence_id = v_item.occurrence_id
    AND n.recipient_id <> auth.uid()
  ORDER BY n.recipient_id, n.id DESC
  ON CONFLICT (event_id, recipient_id) DO NOTHING;

  -- Zero destinatários no Eco é normal (ex.: autor era o único destinatário).
  -- Não grava em alert_notification_failures.

  RETURN jsonb_build_object(
    'id', v_dismissal.id,
    'item_id', v_item.id,
    'review_at', v_dismissal.review_at,
    'event_id', v_event_id
  );
END;
$function$;
