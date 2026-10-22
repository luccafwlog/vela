-- 399: Embarque de vazios travado também na criação (revisão da PR #1028,
-- decisão 22 da ADR 0095; complementa a 398).
--
-- Na 398 o gatilho `guard_vazios_export_adr_lock` de
-- `vazios_export_operations` só disparava em UPDATE/DELETE e a função lia só
-- OLD nessa tabela: criar o primeiro Embarque de uma Viagem e porto com o
-- ADR de Saída já fechado (`openOrCreateVaziosExportOperation`) passava.
-- Aqui a função confere a escala de NEW também na inclusão, e os gatilhos das
-- três tabelas do Embarque (`vazios_export_operations`, `vazios_bookings`,
-- `vazios_export_service_lines`) são recriados em INSERT OR UPDATE OR DELETE.
-- A exclusão da Viagem ou do B/L (`vela.deleting_records`) continua passando.
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: reaplicar `guard_vazios_export_adr_lock()` e os gatilhos da 398.

CREATE OR REPLACE FUNCTION public.guard_vazios_export_adr_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_scales jsonb := '[]'::jsonb;
  v_scale jsonb;
BEGIN
  -- Exclusão da Viagem ou do B/L pela RPC de exclusão.
  IF TG_OP = 'DELETE' AND current_setting('vela.deleting_records', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'vazios_export_operations' THEN
    -- Só a troca de Viagem ou de porto e a exclusão mexem no Embarque.
    IF TG_OP = 'UPDATE' AND OLD.voyage_id IS NOT DISTINCT FROM NEW.voyage_id
       AND upper(btrim(OLD.embark_port)) IS NOT DISTINCT FROM upper(btrim(NEW.embark_port)) THEN
      RETURN NEW;
    END IF;
    IF TG_OP <> 'INSERT' THEN
      v_scales := v_scales || jsonb_build_object('voyage_id', OLD.voyage_id, 'port', OLD.embark_port);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      -- Criar o Embarque (o primeiro da Viagem e porto) também é mudar.
      v_scales := v_scales || jsonb_build_object('voyage_id', NEW.voyage_id, 'port', NEW.embark_port);
    END IF;
  ELSIF TG_TABLE_NAME = 'vazios_bookings' THEN
    IF TG_OP <> 'INSERT' THEN
      v_scales := v_scales || jsonb_build_object('voyage_id', OLD.voyage_id, 'port', COALESCE(
        (SELECT op.embark_port FROM public.vazios_export_operations AS op WHERE op.id = OLD.operation_id), OLD.pol));
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_scales := v_scales || jsonb_build_object('voyage_id', NEW.voyage_id, 'port', COALESCE(
        (SELECT op.embark_port FROM public.vazios_export_operations AS op WHERE op.id = NEW.operation_id), NEW.pol));
    END IF;
  ELSE -- vazios_export_service_lines
    IF TG_OP <> 'INSERT' THEN
      v_scales := v_scales || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('voyage_id', op.voyage_id, 'port', op.embark_port))
        FROM public.vazios_export_operations AS op WHERE op.id = OLD.operation_id), '[]'::jsonb);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_scales := v_scales || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('voyage_id', op.voyage_id, 'port', op.embark_port))
        FROM public.vazios_export_operations AS op WHERE op.id = NEW.operation_id), '[]'::jsonb);
    END IF;
  END IF;

  FOR v_scale IN SELECT value FROM jsonb_array_elements(v_scales) LOOP
    IF (v_scale->>'voyage_id') IS NOT NULL
       AND public._vazios_export_locked_by_adr((v_scale->>'voyage_id')::bigint, v_scale->>'port') THEN
      RAISE EXCEPTION '%', public._vazios_export_adr_lock_message(v_scale->>'port') USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_vazios_export_adr_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_vazios_export_adr_lock ON public.vazios_bookings;
CREATE TRIGGER guard_vazios_export_adr_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.vazios_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_vazios_export_adr_lock();
DROP TRIGGER IF EXISTS guard_vazios_export_adr_lock ON public.vazios_export_service_lines;
CREATE TRIGGER guard_vazios_export_adr_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.vazios_export_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_vazios_export_adr_lock();
DROP TRIGGER IF EXISTS guard_vazios_export_adr_lock ON public.vazios_export_operations;
CREATE TRIGGER guard_vazios_export_adr_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.vazios_export_operations
  FOR EACH ROW EXECUTE FUNCTION public.guard_vazios_export_adr_lock();
