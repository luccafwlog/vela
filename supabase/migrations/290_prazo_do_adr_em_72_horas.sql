-- 290 — Prazo de conclusão do ADR em 72 horas corridas a partir da hora do ATD
-- (decisão do responsável de 2026-10-15; nota na ADR 0039).
--
-- Antes (258): o prazo vencia ao fim do 3º dia útil depois do dia do ATD, no
-- dia de Brasília. Agora o alerta "prazo de conclusão vencido" compara o
-- instante de agora com ATD + 72 horas; sábado, domingo e feriado contam. O
-- ATD da Atracação já é TIMESTAMPTZ com hora (a hora passou a ser obrigatória
-- na mesma decisão). No caminho legado por porto, o ATD é uma data: vale
-- 00:00 de Brasília. ADRs abertos passam a usar a regra; os fechados guardam
-- o prazo congelado no retrato do fechamento e não são reavaliados.
--
-- Redefine `reconcile_agency_report_alerts` e
-- `reconcile_agency_report_alerts_for_scale` a partir da 258. Só redefine
-- funções; não reescreve nem apaga linhas. `agency_report_deadline_date`
-- (3 dias úteis) fica para os leitores antigos, sem uso pelo alerta.
-- Rollback: reaplicar as definições da 258.

CREATE OR REPLACE FUNCTION public.reconcile_agency_report_alerts(p_report_id uuid, p_pending boolean DEFAULT true, p_deadline boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report RECORD;
  v_atd DATE;
  v_atd_at TIMESTAMPTZ;
  v_atd_updated_at TIMESTAMPTZ;
  v_deadline DATE;
  v_deadline_at TIMESTAMPTZ;
  v_deadline_baseline DATE;
  v_pending_baseline TIMESTAMPTZ := TIMESTAMPTZ '2026-07-19 00:00:00+00';
  v_pending_eligible BOOLEAN := false;
  v_deadline_eligible BOOLEAN := false;
  v_omitted BOOLEAN := false;
  v_deleted BOOLEAN := false;
  v_entity_id TEXT;
  v_department TEXT;
  v_pending BOOLEAN;
  v_signed BOOLEAN;
  v_deadline_missed BOOLEAN;
  v_metadata JSONB;
  v_message TEXT;
  v_upsert_result JSONB;
  v_changed INTEGER := 0;
  v_created INTEGER := 0;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;

  SELECT r.*, d.code AS terminal_code INTO v_report
  FROM public.agency_departure_reports r
  LEFT JOIN public.depots d ON d.id = r.terminal_id
  WHERE r.id = p_report_id FOR UPDATE OF r;
  IF NOT FOUND THEN RETURN jsonb_build_object('report_id', p_report_id, 'eligible', false, 'changed', 0); END IF;

  SELECT (terminal_atd AT TIME ZONE 'America/Sao_Paulo')::date, terminal_atd, updated_at INTO v_atd, v_atd_at, v_atd_updated_at
  FROM public.voyage_escala_terminal_state
  WHERE voyage_id = v_report.voyage_id AND port = upper(btrim(v_report.port)) AND terminal_id = v_report.terminal_id;

  SELECT COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port)) AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) INTO v_omitted;
  SELECT COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port)) AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) INTO v_deleted;
  SELECT captured_at::date INTO v_deadline_baseline FROM public.agency_report_pending_baselines WHERE baseline_key = 'agency_report_deadline_missed';

  v_pending_eligible := v_report.status = 'open' AND v_report.terminal_id IS NOT NULL AND v_atd IS NOT NULL AND v_atd_updated_at >= v_pending_baseline AND NOT v_omitted AND NOT v_deleted AND upper(btrim(v_report.port)) LIKE 'BR%';
  v_deadline_eligible := v_report.status = 'open' AND v_report.terminal_id IS NOT NULL AND v_atd IS NOT NULL AND NOT v_omitted AND NOT v_deleted AND upper(btrim(v_report.port)) LIKE 'BR%' AND (v_deadline_baseline IS NULL OR v_atd >= v_deadline_baseline);
  v_entity_id := public.agency_report_alert_entity_key(v_report.voyage_id, v_report.port, v_report.terminal_code);
  v_deadline_at := v_atd_at + interval '72 hours';
  v_deadline := (v_deadline_at AT TIME ZONE 'America/Sao_Paulo')::date;

  FOR v_department IN SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos']) LOOP
    v_metadata := jsonb_build_object('report_id', v_report.id, 'voyage_id', v_report.voyage_id, 'port', upper(btrim(v_report.port)), 'terminal_code', v_report.terminal_code, 'department', v_department, 'deadline_date', v_deadline, 'deadline_at', v_deadline_at);
    IF p_pending THEN
      SELECT EXISTS (
        SELECT 1 FROM (VALUES ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'), ('vazios_embarcados'), ('vazios_descarregados')) AS sections(section)
        LEFT JOIN public.agency_departure_report_signoffs so ON so.report_id = v_report.id AND so.section = sections.section
        WHERE public.agency_report_section_owner(sections.section) = v_department AND COALESCE(so.state, 'pending') = 'pending'
      ) INTO v_pending;
      v_message := 'ADR ' || upper(btrim(v_report.port)) || ' / ' || COALESCE(v_report.terminal_code, 'terminal') || ': departamento "' || public.agency_report_department_label(v_department) || '" pendente.';
      IF v_pending_eligible AND v_pending THEN
        v_upsert_result := public.upsert_alert_item('agency_report_department_pending', 'agency_departure_report', v_entity_id, v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens');
        IF COALESCE((v_upsert_result->>'created')::boolean, false) OR COALESCE((v_upsert_result->>'reopened')::boolean, false) THEN v_changed := v_changed + 1; v_created := v_created + 1; END IF;
      ELSE
        IF public.resolve_alert_item_for_department('agency_report_department_pending', 'agency_departure_report', v_entity_id, v_department, 'agency_report_reconcile', v_metadata) THEN v_changed := v_changed + 1; END IF;
      END IF;
    END IF;
    IF p_deadline THEN
      SELECT COALESCE((SELECT signed_at IS NOT NULL FROM public.agency_departure_report_department_signoffs ds WHERE ds.report_id = v_report.id AND ds.department = v_department), false) INTO v_signed;
      -- 290: ATD + 72 horas, comparado ao instante de agora.
      v_deadline_missed := v_deadline_eligible AND v_deadline_at < now() AND NOT v_signed;
      v_message := 'ADR ' || upper(btrim(v_report.port)) || ' / ' || COALESCE(v_report.terminal_code, 'terminal') || ': prazo de conclusão vencido para "' || public.agency_report_department_label(v_department) || '".';
      IF v_deadline_missed THEN
        v_upsert_result := public.upsert_alert_item('agency_report_deadline_missed', 'agency_departure_report', v_entity_id, v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens');
        IF COALESCE((v_upsert_result->>'created')::boolean, false) OR COALESCE((v_upsert_result->>'reopened')::boolean, false) THEN v_changed := v_changed + 1; v_created := v_created + 1; END IF;
      ELSE
        IF public.resolve_alert_item_for_department('agency_report_deadline_missed', 'agency_departure_report', v_entity_id, v_department, 'agency_report_reconcile', v_metadata) THEN v_changed := v_changed + 1; END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('report_id', v_report.id, 'entity_id', v_entity_id, 'eligible', v_deadline_eligible, 'pending_eligible', v_pending_eligible, 'atd', v_atd, 'deadline_date', v_deadline, 'deadline_at', v_deadline_at, 'changed', v_changed, 'created', v_created);
END;
$function$;

-- Caminho legado (ADR por porto), mesma regra.
CREATE OR REPLACE FUNCTION public.reconcile_agency_report_alerts_for_scale(p_voyage_id bigint, p_port text, p_atd date, p_pending_eligible boolean, p_deadline_eligible boolean, p_omitted boolean DEFAULT false, p_deleted boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_department TEXT;
  v_pending BOOLEAN;
  v_deadline_missed BOOLEAN;
  -- Caminho legado: o ATD é uma data, que vale 00:00 de Brasília.
  v_deadline_at TIMESTAMPTZ := (p_atd::timestamp AT TIME ZONE 'America/Sao_Paulo') + interval '72 hours';
  v_deadline DATE := (v_deadline_at AT TIME ZONE 'America/Sao_Paulo')::date;
  v_entity_id TEXT := public.agency_report_alert_entity_key(p_voyage_id, p_port);
  v_metadata JSONB;
  v_message TEXT;
  v_upsert_result JSONB;
  v_changed INTEGER := 0;
  v_created INTEGER := 0;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF upper(btrim(p_port)) NOT LIKE 'BR%' THEN
    RETURN jsonb_build_object('entity_id', v_entity_id, 'created', 0, 'changed', 0);
  END IF;

  FOR v_department IN SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos'])
  LOOP
    v_metadata := jsonb_build_object(
      'report_id', NULL,
      'voyage_id', p_voyage_id,
      'port', upper(btrim(p_port)),
      'terminal_code', NULL,
      'department', v_department,
      'deadline_date', v_deadline,
      'deadline_at', v_deadline_at
    );
    v_message := 'ADR ' || upper(btrim(p_port))
      || ': departamento "' || public.agency_report_department_label(v_department) || '" pendente.';
    v_pending := p_pending_eligible AND NOT p_omitted AND NOT p_deleted;
    IF v_pending THEN
      v_upsert_result := public.upsert_alert_item(
        'agency_report_department_pending', 'agency_departure_report', v_entity_id,
        v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens'
      );
      IF COALESCE((v_upsert_result->>'created')::BOOLEAN, false)
         OR COALESCE((v_upsert_result->>'reopened')::BOOLEAN, false) THEN
        v_changed := v_changed + 1;
        v_created := v_created + 1;
      END IF;
    ELSE
      IF public.resolve_alert_item_for_department(
        'agency_report_department_pending', 'agency_departure_report', v_entity_id,
        v_department, 'agency_report_reconcile', v_metadata
      ) THEN
        v_changed := v_changed + 1;
      END IF;
    END IF;

    v_deadline_missed := p_deadline_eligible AND NOT p_omitted AND NOT p_deleted
      AND v_deadline_at < now();
    v_message := 'ADR ' || upper(btrim(p_port))
      || ': prazo de conclusão vencido para "' || public.agency_report_department_label(v_department) || '".';
    IF v_deadline_missed THEN
      v_upsert_result := public.upsert_alert_item(
        'agency_report_deadline_missed', 'agency_departure_report', v_entity_id,
        v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens'
      );
      IF COALESCE((v_upsert_result->>'created')::BOOLEAN, false)
         OR COALESCE((v_upsert_result->>'reopened')::BOOLEAN, false) THEN
        v_changed := v_changed + 1;
        v_created := v_created + 1;
      END IF;
    ELSE
      IF public.resolve_alert_item_for_department(
        'agency_report_deadline_missed', 'agency_departure_report', v_entity_id,
        v_department, 'agency_report_reconcile', v_metadata
      ) THEN
        v_changed := v_changed + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('entity_id', v_entity_id, 'created', v_created, 'changed', v_changed);
END;
$function$;
