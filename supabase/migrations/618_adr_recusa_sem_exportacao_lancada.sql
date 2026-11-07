-- 618: o ADR de Saída recusa "Nada a declarar" e "Fechar ADR" com a exportação
-- declarada e não lançada (decisão D5 do dono de 2026-11-06; ADR 0133, lote 6
-- do plano 2026-11-06-decisoes-da-revisao-dos-alertas).
--
-- A escala declara a exportação em `voyage_export_schedules` (POL, Granito e
-- vazios). Sem o manifesto vinculado à Viagem, o ADR fechava com "Nada a
-- declarar" e a exportação sumia do retrato (brecha B10). Agora:
--   1. A seção **Carga carregada** não aceita "Nada a declarar" com Granito
--      declarado no porto e nenhum manifesto de Granito vinculado; a seção
--      **Vazios embarcados**, com vazios declarados e nenhum manifesto de
--      Embarque de vazios.
--   2. O ADR não fecha enquanto a escala tiver exportação declarada e não
--      lançada (vale também para o fechamento automático do lote 8).
-- A conta é a mesma do alerta "Exportação pendente pós-ATD"
-- (`reconcile_voyage_export_after_atd_alerts`): escala excluída ou omitida não
-- cobra, e o vínculo vale para a Viagem toda (mesmo ponytail).
-- As travas são gatilhos nas tabelas, e valem para as duas RPCs de assinatura
-- e as duas de fechamento.
--
-- Plano de preservação: a migration só acrescenta uma função de leitura e dois
-- gatilhos que recusam gravações novas; não reescreve nem apaga linha
-- existente. Assinaturas "Nada a declarar" e ADRs fechados antes dela ficam
-- como estão. Conferir: `SELECT tgname FROM pg_trigger WHERE tgname LIKE
-- 'trg_adr_export_%'` mostra os dois gatilhos. Desfazer: o rollback abaixo.
--
-- Rollback: remover os gatilhos `trg_adr_export_nothing_to_declare` e
-- `trg_adr_export_close` e as funções `_adr_export_pending`,
-- `_adr_export_guard_signoff` e `_adr_export_guard_close`.

-- O que falta lançar da exportação declarada na escala: 'granito', 'vazios',
-- os dois ou nenhum (array vazio).
CREATE OR REPLACE FUNCTION public._adr_export_pending(p_voyage_id bigint, p_port text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := upper(btrim(p_port));
  v_export record;
  v_removed boolean;
  v_pending text[] := '{}';
BEGIN
  SELECT tem_exportacao, has_granite, has_empty INTO v_export
  FROM public.voyage_export_schedules
  WHERE voyage_id = p_voyage_id AND upper(btrim(pol)) = v_port;
  IF NOT FOUND OR NOT COALESCE(v_export.tem_exportacao, false) THEN RETURN v_pending; END IF;

  SELECT COALESCE(bool_or(l.new_value = 'true'), false) INTO v_removed
  FROM (
    SELECT DISTINCT ON (a.field_name) a.new_value
    FROM public.audit_logs a
    WHERE a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id = p_voyage_id || '::' || v_port
      AND a.field_name IN ('deleted', 'omitted')
    ORDER BY a.field_name, a.changed_at DESC, a.id DESC
  ) l;
  IF v_removed THEN RETURN v_pending; END IF;

  -- ponytail: por Viagem, não por porto, como o alerta pós-ATD.
  IF COALESCE(v_export.has_granite, false)
     AND NOT EXISTS (SELECT 1 FROM public.granite_manifests WHERE voyage_id = p_voyage_id) THEN
    v_pending := v_pending || 'granito'::text;
  END IF;
  IF COALESCE(v_export.has_empty, false)
     AND NOT EXISTS (SELECT 1 FROM public.vazios_manifests WHERE voyage_id = p_voyage_id) THEN
    v_pending := v_pending || 'vazios'::text;
  END IF;
  RETURN v_pending;
END;
$function$;
REVOKE ALL ON FUNCTION public._adr_export_pending(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._adr_export_pending(bigint, text) TO authenticated, service_role;

-- 1 --- "Nada a declarar" ---------------------------------------------------
CREATE OR REPLACE FUNCTION public._adr_export_guard_signoff()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report public.agency_departure_reports;
  v_pending text[];
BEGIN
  IF NEW.state <> 'nothing_to_declare' OR NEW.section NOT IN ('carga_carregada', 'vazios_embarcados') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = NEW.state THEN RETURN NEW; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = NEW.report_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_pending := public._adr_export_pending(v_report.voyage_id, v_report.port);
  IF NEW.section = 'carga_carregada' AND 'granito' = ANY (v_pending) THEN
    RAISE EXCEPTION 'A escala declara exportação de Granito e nenhum manifesto de Granito foi vinculado à Viagem. Vincule o manifesto ou corrija a exportação da escala antes de marcar Nada a declarar.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.section = 'vazios_embarcados' AND 'vazios' = ANY (v_pending) THEN
    RAISE EXCEPTION 'A escala declara embarque de vazios e nenhum manifesto de Embarque de vazios foi vinculado à Viagem. Vincule o manifesto ou corrija a exportação da escala antes de marcar Nada a declarar.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._adr_export_guard_signoff() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_adr_export_nothing_to_declare ON public.agency_departure_report_signoffs;
CREATE TRIGGER trg_adr_export_nothing_to_declare
BEFORE INSERT OR UPDATE OF state ON public.agency_departure_report_signoffs
FOR EACH ROW EXECUTE FUNCTION public._adr_export_guard_signoff();

-- 2 --- Fechar ADR ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public._adr_export_guard_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pending text[];
BEGIN
  IF NEW.status <> 'closed' OR OLD.status = 'closed' THEN RETURN NEW; END IF;
  v_pending := public._adr_export_pending(NEW.voyage_id, NEW.port);
  IF cardinality(v_pending) > 0 THEN
    RAISE EXCEPTION 'O ADR não fecha: a escala declara exportação (%) e o manifesto não foi vinculado à Viagem. Vincule o manifesto ou corrija a exportação da escala.',
      array_to_string(ARRAY(SELECT CASE p WHEN 'granito' THEN 'Granito' ELSE 'Embarque de vazios' END FROM unnest(v_pending) p), ' e ')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._adr_export_guard_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_adr_export_close ON public.agency_departure_reports;
CREATE TRIGGER trg_adr_export_close
BEFORE UPDATE OF status ON public.agency_departure_reports
FOR EACH ROW EXECUTE FUNCTION public._adr_export_guard_close();
