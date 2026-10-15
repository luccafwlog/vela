-- Item 33 (B5) do plano 2026-10-14: no ADR terminalizado, o sign-off
-- departamental recusa seção Pendente no banco, como o caminho legado já fazia
-- (ADR 0029). Só redefine a função; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.set_agency_report_department_signoff_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_department text, p_signed boolean, p_justification text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_report RECORD;
  v_current BOOLEAN;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  IF p_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN RAISE EXCEPTION 'Departamento invalido.' USING ERRCODE = '22023'; END IF;
  IF v_role NOT IN ('administrativo', p_department) THEN RAISE EXCEPTION 'Sign-off pertence ao departamento %.', p_department USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar o sign-off departamental.' USING ERRCODE = '42501'; END IF;
  SELECT signed_at IS NOT NULL INTO v_current FROM public.agency_departure_report_department_signoffs
  WHERE report_id = p_report_id AND department = p_department FOR UPDATE;
  v_current := COALESCE(v_current, FALSE);
  IF v_current = p_signed THEN RETURN jsonb_build_object('report_id', p_report_id, 'unchanged', TRUE); END IF;
  -- B5: assinar exige todas as seções do departamento resolvidas, como no
  -- caminho legado; antes a trava existia só na tela.
  IF p_signed AND EXISTS (
    SELECT 1 FROM (VALUES
      ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'),
      ('vazios_embarcados'), ('vazios_descarregados')
    ) AS all_sections(section)
    WHERE public.agency_report_section_owner(all_sections.section) = p_department
      AND COALESCE((
        SELECT so.state FROM public.agency_departure_report_signoffs so
        WHERE so.report_id = p_report_id AND so.section = all_sections.section
      ), 'pending') = 'pending'
  ) THEN
    RAISE EXCEPTION 'Departamento % tem secoes pendentes: resolva-as antes de assinar.', p_department
      USING ERRCODE = '23514';
  END IF;
  IF NOT p_signed AND v_current AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reabrir o sign-off departamental exige justificativa.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agency_departure_report_department_signoffs (report_id, department, signed_by, signed_at)
  VALUES (p_report_id, p_department, auth.uid(), CASE WHEN p_signed THEN now() ELSE NULL END)
  ON CONFLICT (report_id, department) DO UPDATE SET signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_department_signoff', p_report_id::TEXT || '::' || p_department, 'signed', v_current::TEXT, p_signed::TEXT, auth.uid(), v_justification);
  IF p_signed THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_department_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = public.agency_report_alert_entity_id(
        v_report.voyage_id,
        v_report.port,
        (SELECT d.code FROM public.depots AS d WHERE d.id = v_report.terminal_id),
        p_department
      )
      AND status <> 'closed';
  END IF;
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;
