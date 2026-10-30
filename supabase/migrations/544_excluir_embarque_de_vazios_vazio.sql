-- 544: o Administrativo exclui, com motivo, o Embarque de vazios vazio.
--
-- Decisão do dono de 2026-10-30 (revisão da PR #1122). Desde a 541, criar o
-- embarque grava na escala a frente Vazios EXP, a Atracação e o ADR do
-- terminal, e o embarque impede voltar a frente para TBC e excluir a escala.
-- Não havia exclusão de embarque (DELETE revogado na 235), então o criado na
-- escala errada só saía com a exclusão da Viagem.
--
-- Mudança: RPC `delete_vazios_export_operation(id, dry_run, motivo)`, só do
-- Administrativo ativo, para o embarque sem unidade (`vazios_bookings`), sem
-- linha de serviço e com o ADR de Saída do porto aberto. A prévia (`p_dry_run`)
-- devolve os motivos da recusa sem gravar. A exclusão grava o motivo em
-- `audit_logs`. A frente Vazios EXP, a Atracação e o ADR do terminal ficam
-- como estão: sem o embarque, Editar escala volta a poder mudá-los.
-- Não reescreve nem apaga linhas existentes (o DELETE é da função, a pedido).
-- Rollback: DROP FUNCTION public.delete_vazios_export_operation(uuid, boolean, text).

CREATE OR REPLACE FUNCTION public.delete_vazios_export_operation(
  p_operation_id uuid,
  p_dry_run boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_operation public.vazios_export_operations%ROWTYPE;
  v_reasons text[] := ARRAY[]::text[];
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir embarque de vazios.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_operation FROM public.vazios_export_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Embarque de vazios não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.vazios_bookings WHERE operation_id = p_operation_id) THEN
    v_reasons := v_reasons || 'Embarque com unidades embarcadas'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.vazios_export_service_lines WHERE operation_id = p_operation_id) THEN
    v_reasons := v_reasons || 'Embarque com linhas de serviço'::text;
  END IF;
  IF public.vazios_export_adr_locked(v_operation.voyage_id, v_operation.embark_port) THEN
    v_reasons := v_reasons || 'ADR de Saída do porto fechado'::text;
  END IF;

  IF cardinality(v_reasons) > 0 OR p_dry_run THEN
    RETURN jsonb_build_object('deleted', false, 'deletable', cardinality(v_reasons) = 0,
      'reasons', to_jsonb(v_reasons), 'dry_run', p_dry_run);
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão do embarque de vazios.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('vazios_export_operation', p_operation_id::text, 'deleted', 'false', 'true', auth.uid(),
    format('%s (Viagem %s, %s)', v_reason, v_operation.voyage_id, v_operation.embark_port));

  DELETE FROM public.vazios_export_operations WHERE id = p_operation_id;

  RETURN jsonb_build_object('deleted', true, 'deletable', true, 'reasons', '[]'::jsonb, 'dry_run', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_vazios_export_operation(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_vazios_export_operation(uuid, boolean, text) TO authenticated, service_role;
