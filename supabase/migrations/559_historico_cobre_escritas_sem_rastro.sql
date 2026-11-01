-- 559: escritas que não deixavam linha no Histórico de ações passam a deixar.
--
-- Diagnóstico: docs/archive/audits/historico-de-acoes-2026-11-01.md (lacunas
-- 1, 2, 5 e 8). Só cria gatilhos e redefine `audit_row_changes`; não grava nem
-- reescreve linhas existentes.
--
-- Mudança:
--   1. `audit_row_changes` (corpo da 404): sem contexto da função, o motivo
--      gravado numa coluna da própria linha nesta operação (`justification`,
--      `revoke_reason`, `cancel_reason`, `deactivation_reason`, `handled_note`,
--      `revert_justification`, `discount_justification`) vira a justificativa
--      da linha do Histórico.
--   2. Liberação de faturamento no Portal: o gatilho de
--      `customer_billing_portal_releases` passa a registrar a criação, com a
--      justificativa obrigatória (antes só UPDATE/DELETE, 083).
--   3. Embarque de vazios e linha de serviço: os gatilhos de
--      `vazios_export_operations` e `vazios_export_service_lines` registram a
--      criação.
--   4. ADR de Saída: o fechamento (aberto → fechado) e a troca de terminal
--      gravam linha `agency_departure_report` (chave `viagem::PORTO`, a mesma
--      da reabertura), com o autor da sessão. A reabertura já gravava (509).
--   5. Pix: "Marcar como tratado" (`itau_pix_receipts`, motivo em
--      `handled_note`) e as exceções de Pix (`pix_reconciliation_exceptions`:
--      criada, vinculada, resolvida) entram no Histórico.
--
-- Rollback: reaplicar `audit_row_changes` da 404; recriar os gatilhos de
-- `customer_billing_portal_releases`, `vazios_export_operations` e
-- `vazios_export_service_lines` como AFTER DELETE OR UPDATE; DROP TRIGGER
-- `audit_agency_departure_report_changes`, `audit_itau_pix_receipts_handled`,
-- `audit_pix_reconciliation_exceptions` e DROP FUNCTION
-- `public.audit_agency_departure_report_changes()`.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_row_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_key_parts TEXT[] := string_to_array(COALESCE(TG_ARGV[0], 'id'), ',');
  v_entity_id TEXT;
  v_field RECORD;
  v_skip text[] := string_to_array(NULLIF(current_setting('vela.audit_skip', true), ''), ',');
  v_token text;
  v_context text := NULLIF(btrim(current_setting('vela.import_context', true)), '');
  -- 404: o B/L da linha, para o Histórico do B/L ler o rastro de containers e
  -- veículos mesmo depois da remoção.
  v_bl_id text := CASE WHEN TG_TABLE_NAME IN ('bl_containers', 'vehicles')
                       THEN COALESCE(v_new ->> 'bl_id', v_old ->> 'bl_id') END;
  -- 559: o motivo escrito numa coluna da própria linha (liberação de
  -- faturamento, revogação, Pix tratado) vale como justificativa quando a
  -- função não passou contexto. Só a coluna gravada nesta operação conta, para
  -- uma edição posterior não herdar um motivo antigo.
  v_row_reason text;
  v_reason_key text;
BEGIN
  IF v_context IS NULL AND TG_OP IN ('INSERT', 'UPDATE') THEN
    FOREACH v_reason_key IN ARRAY ARRAY['justification', 'revoke_reason', 'cancel_reason', 'deactivation_reason',
                                         'handled_note', 'revert_justification', 'discount_justification'] LOOP
      IF NULLIF(btrim(v_new ->> v_reason_key), '') IS NOT NULL
         AND (TG_OP = 'INSERT' OR v_old ->> v_reason_key IS DISTINCT FROM v_new ->> v_reason_key) THEN
        v_row_reason := btrim(v_new ->> v_reason_key);
        EXIT;
      END IF;
    END LOOP;
    v_context := v_row_reason;
  END IF;
  SELECT string_agg(COALESCE(v_new ->> k, v_old ->> k), '/')
    INTO v_entity_id
    FROM unnest(v_key_parts) AS k;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification, bl_id)
    VALUES (TG_TABLE_NAME, v_entity_id, 'criado', v_new::TEXT, auth.uid(), v_context, v_bl_id);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, changed_by, justification, bl_id)
    VALUES (TG_TABLE_NAME, v_entity_id, 'excluido', v_old::TEXT, auth.uid(),
            COALESCE(NULLIF(btrim(current_setting('vela.delete_reason', true)), ''), v_context), v_bl_id);
  ELSE
    FOR v_field IN
      SELECT key, value AS old_value, v_new ->> key AS new_value
      FROM jsonb_each_text(v_old)
      WHERE v_old ->> key IS DISTINCT FROM v_new ->> key
    LOOP
      v_token := TG_TABLE_NAME || '/' || v_entity_id || '/' || v_field.key;
      IF v_skip IS NOT NULL AND v_token = ANY(v_skip) THEN
        v_skip := array_remove(v_skip, v_token);
        PERFORM set_config('vela.audit_skip', COALESCE(array_to_string(v_skip, ','), ''), true);
        CONTINUE;
      END IF;
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, bl_id)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.old_value, v_field.new_value, auth.uid(), v_context, v_bl_id);
    END LOOP;
    FOR v_field IN
      SELECT key, value AS new_value
      FROM jsonb_each_text(v_new)
      WHERE NOT (v_old ? key)
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification, bl_id)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.new_value, auth.uid(), v_context, v_bl_id);
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;

-- 2 e 3 ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_customer_billing_portal_releases ON public.customer_billing_portal_releases;
CREATE TRIGGER audit_customer_billing_portal_releases
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_billing_portal_releases
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');

DROP TRIGGER IF EXISTS audit_vazios_export_operations ON public.vazios_export_operations;
CREATE TRIGGER audit_vazios_export_operations
  AFTER INSERT OR UPDATE OR DELETE ON public.vazios_export_operations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');

DROP TRIGGER IF EXISTS audit_vazios_export_service_lines ON public.vazios_export_service_lines;
CREATE TRIGGER audit_vazios_export_service_lines
  AFTER INSERT OR UPDATE OR DELETE ON public.vazios_export_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_agency_departure_report_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := NEW.voyage_id::text || '::' || upper(btrim(NEW.port));
BEGIN
  -- A reabertura (fechado → aberto) já grava a linha com a justificativa.
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'closed' THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('agency_departure_report', v_key, 'status', OLD.status, NEW.status, auth.uid());
  END IF;
  IF OLD.terminal_id IS DISTINCT FROM NEW.terminal_id THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('agency_departure_report', v_key, 'terminal_id', OLD.terminal_id::text, NEW.terminal_id::text, auth.uid());
  ELSIF OLD.terminal IS DISTINCT FROM NEW.terminal THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('agency_departure_report', v_key, 'terminal', OLD.terminal, NEW.terminal, auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_agency_departure_report_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_agency_departure_report_changes ON public.agency_departure_reports;
CREATE TRIGGER audit_agency_departure_report_changes
  AFTER UPDATE OF status, terminal, terminal_id ON public.agency_departure_reports
  FOR EACH ROW EXECUTE FUNCTION public.audit_agency_departure_report_changes();

-- 5 -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_itau_pix_receipts_handled ON public.itau_pix_receipts;
CREATE TRIGGER audit_itau_pix_receipts_handled
  AFTER UPDATE OF handled_at, handled_note ON public.itau_pix_receipts
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('end_to_end_id');

DROP TRIGGER IF EXISTS audit_pix_reconciliation_exceptions ON public.pix_reconciliation_exceptions;
CREATE TRIGGER audit_pix_reconciliation_exceptions
  AFTER INSERT OR UPDATE OR DELETE ON public.pix_reconciliation_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');
