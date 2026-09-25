-- Migration 090: retirar a escala de importação (marca "deleted" do POD em
-- audit_logs) segue a regra de Excluir escala: só o Administrativo e sem
-- trava do CE Mercante no porto (ADR 0071; decisão de 2026-09-25 sobre
-- "não escala" em Chegadas e Saídas).
--
-- A marca é inserida pelo navegador (Chegadas e Saídas, "não escala") e por
-- delete_escala. A regra fica no banco, num trigger de inserção em
-- audit_logs, para valer em todo caminho. Desfazer a remoção (marca
-- deleted = false, ao reinserir o POD) e contextos sem usuário (rotinas do
-- banco) não são afetados.
--
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.guard_pod_schedule_removal_mark()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id bigint;
  v_port text;
  v_lock text[];
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'voyage_pod_schedule'
     OR NEW.field_name IS DISTINCT FROM 'deleted'
     OR NEW.new_value IS DISTINCT FROM 'true'
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo retira escala da viagem.' USING ERRCODE = '42501';
  END IF;

  v_voyage_id := NULLIF(split_part(NEW.entity_id, '::', 1), '')::bigint;
  v_port := NULLIF(split_part(NEW.entity_id, '::', 2), '');
  v_lock := public.delete_lock_reasons(v_voyage_id, v_port);
  IF cardinality(v_lock) > 0 THEN
    RAISE EXCEPTION 'Escala % travada: %.', v_port, array_to_string(v_lock, ', ') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_pod_schedule_removal_mark() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_pod_schedule_removal_mark ON public.audit_logs;
CREATE TRIGGER trg_guard_pod_schedule_removal_mark
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_pod_schedule_removal_mark();
