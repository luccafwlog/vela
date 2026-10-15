-- Item 24 (P6) do plano 2026-10-14: reabrir o Agency Departure Report e
-- reverter omissão de escala passam a qualquer Departamento ativo (ADR 0085,
-- D8 e D9). A justificativa continua obrigatória e vai para audit_logs.
-- Só redefine funções; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report(p_voyage_id bigint, p_port text, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN
    RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port))
    AND status = 'closed'
    AND terminal_id IS NULL
  FOR UPDATE;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_voyage_id || '::' || upper(btrim(p_port)),
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514'; END IF;
  IF v_report.status <> 'closed' THEN RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.agency_departure_reports SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL WHERE id = p_report_id;
  -- Reabrir destrava a edição sem apagar decisões, assinaturas ou histórico.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_report_id::TEXT, 'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.revert_voyage_omission(p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_omission RECORD;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_cod_count INTEGER;
  v_entity_id TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente usuario interno ativo pode reverter omissao, com o proprio usuario autenticado.'
      USING ERRCODE = '42501';
  END IF;

  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Reversao de omissao exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT o.id, o.voyage_id, o.omitted_pod, o.discharge_pod, o.reverted_at
  INTO v_omission
  FROM public.voyage_omissions AS o
  WHERE o.id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Omissao % nao encontrada.', p_omission_id USING ERRCODE = 'P0002';
  END IF;
  IF v_omission.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Omissao % ja foi revertida.', p_omission_id USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_cod_count
  FROM public.bl_transshipments AS t
  WHERE t.omission_id = p_omission_id
    AND t.disposition = 'cod';

  IF v_cod_count > 0 THEN
    RAISE EXCEPTION 'Nao e possivel reverter a omissao: % B/L(s) afetado(s) estao em COD.', v_cod_count
      USING ERRCODE = '22023';
  END IF;

  v_entity_id := v_omission.voyage_id::TEXT || '::' || upper(btrim(v_omission.omitted_pod));

  -- Este audit row é obrigatório: voyageRouteSchedules deriva omitted dele e,
  -- desde a 306, os consumidores de estado terminalizado e de alertas de ADR
  -- contam a escala ativa pela mesma decisão mais recente.
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage_pod_schedule',
    v_entity_id,
    'omitted',
    'true',
    'false',
    p_changed_by,
    v_justification
  );

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage',
    v_omission.voyage_id::TEXT,
    'omissao_revertida',
    v_omission.omitted_pod,
    v_omission.discharge_pod,
    p_changed_by,
    v_justification
  );

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id,
    b.id,
    'transshipment',
    'Correção de omissão de escala',
    'A omissão da escala de ' || v_omission.omitted_pod || ' foi revertida. O B/L ' || b.id ||
      ' voltou a seguir a programação original da viagem.',
    NULL
  FROM public.bl_transshipments AS t
  JOIN public.bls AS b ON b.id = t.bl_id
  WHERE t.omission_id = p_omission_id
    AND b.customer_id IS NOT NULL;

  UPDATE public.voyage_omissions
  SET reverted_at = now(),
      reverted_by = p_changed_by,
      revert_justification = v_justification
  WHERE id = p_omission_id;
END;
$function$;
