-- 560: Histórico de ações registra a criação de cada B/L e as lacunas menores.
--
-- Decisões do dono de 2026-11-01 (pendências do diagnóstico
-- docs/archive/audits/historico-de-acoes-2026-11-01.md):
--   - B/L e carga solta criados pela importação: uma linha curta "B/L criado"
--     por B/L, com o lote e a Viagem, sem copiar o registro inteiro;
--   - passam a registrar: observação de seção do ADR, "ciente" do impacto de
--     taxa e modelos salvos de Comunicado. O nome no Meu perfil fica de fora.
--
-- Só cria funções e gatilhos; não grava nem reescreve linhas existentes.
--
-- Mudança:
--   1. `audit_bl_created()`: AFTER INSERT em `bls` e `granite_bls` grava
--      `criado` com um resumo (B/L, Viagem, Cliente, modalidade, POL/POD, lote;
--      no Granito, B/L, manifesto e Cliente) e o contexto da importação como
--      justificativa. O gatilho genérico de `bls`/`granite_bls` continua só em
--      UPDATE e DELETE. O Histórico do B/L não muda: `bl_timeline` já mostra
--      "B/L criado" pela data de criação e não lê `bls`/`criado`.
--   2. `audit_agency_report_observation()`: a observação de cada seção do ADR
--      (`agency_departure_report_signoffs.observation`) grava linha
--      `agency_departure_report` com o id do ADR (a chave da reabertura e do
--      fechamento, 559), campo `observation|<seção>`, antes e depois.
--   3. `bl_charge_adjustment_acks` (o "ciente" do impacto de taxa alterada à
--      mão) e `customer_communication_saved_templates` (modelos salvos de
--      Comunicado) ganham o gatilho genérico `audit_row_changes`.
--
-- Rollback: DROP TRIGGER `audit_bls_created` ON bls, `audit_granite_bls_created`
-- ON granite_bls, `audit_agency_report_observation` ON
-- agency_departure_report_signoffs, `audit_bl_charge_adjustment_acks` ON
-- bl_charge_adjustment_acks, `audit_customer_communication_saved_templates` ON
-- customer_communication_saved_templates; DROP FUNCTION
-- public.audit_bl_created(), public.audit_agency_report_observation().

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_bl_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Pelo JSON: o mesmo gatilho serve a `bls` e `granite_bls`, que têm
  -- colunas diferentes (NEW.<coluna> de uma não existe na outra).
  v_row jsonb := to_jsonb(NEW);
  v_keys text[] := CASE TG_TABLE_NAME
    WHEN 'bls' THEN ARRAY['id', 'voyage_id', 'customer_id', 'cargo_mode', 'pol', 'pod', 'batch_id']
    ELSE ARRAY['id', 'bl_number', 'manifest_id', 'client_id']
  END;
  v_summary jsonb;
BEGIN
  -- Resumo, não o registro inteiro: uma importação grava centenas de B/Ls.
  SELECT jsonb_object_agg(k, v_row -> k) INTO v_summary
    FROM unnest(v_keys) AS k
   WHERE v_row -> k IS NOT NULL AND v_row -> k <> 'null'::jsonb;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_by, justification)
  VALUES (TG_TABLE_NAME, NEW.id::text, 'criado', v_summary::text, auth.uid(),
          NULLIF(btrim(current_setting('vela.import_context', true)), ''));
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_bl_created() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_bls_created ON public.bls;
CREATE TRIGGER audit_bls_created
  AFTER INSERT ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.audit_bl_created();

DROP TRIGGER IF EXISTS audit_granite_bls_created ON public.granite_bls;
CREATE TRIGGER audit_granite_bls_created
  AFTER INSERT ON public.granite_bls
  FOR EACH ROW EXECUTE FUNCTION public.audit_bl_created();

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_agency_report_observation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old text := CASE WHEN TG_OP = 'UPDATE' THEN NULLIF(btrim(COALESCE(OLD.observation, '')), '') END;
  v_new text := NULLIF(btrim(COALESCE(NEW.observation, '')), '');
BEGIN
  IF v_old IS DISTINCT FROM v_new THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('agency_departure_report', NEW.report_id::text, 'observation|' || NEW.section, v_old, v_new, auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_agency_report_observation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_agency_report_observation ON public.agency_departure_report_signoffs;
CREATE TRIGGER audit_agency_report_observation
  AFTER INSERT OR UPDATE OF observation ON public.agency_departure_report_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.audit_agency_report_observation();

-- 3 -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_bl_charge_adjustment_acks ON public.bl_charge_adjustment_acks;
CREATE TRIGGER audit_bl_charge_adjustment_acks
  AFTER INSERT OR UPDATE OR DELETE ON public.bl_charge_adjustment_acks
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');

DROP TRIGGER IF EXISTS audit_customer_communication_saved_templates ON public.customer_communication_saved_templates;
CREATE TRIGGER audit_customer_communication_saved_templates
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_communication_saved_templates
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');
