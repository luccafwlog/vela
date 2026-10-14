-- Item 25 (P7) do plano 2026-10-14: Equipamentos também reprocessa efeito
-- de importação bloqueado, com justificativa (ADR 0085, D10).
-- Só redefine a função; não reescreve nem apaga linhas.

CREATE OR REPLACE FUNCTION public.retry_import_effect(p_effect_id bigint, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_actor uuid := auth.uid();
  v_role text := public.current_actor_role();
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR NOT public.is_active_user()
          OR v_role NOT IN ('administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos')) THEN
    RAISE EXCEPTION 'Usuario sem permissao para reabrir efeito.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL OR char_length(v_justification) > 500 THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para retry.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Somente efeitos bloqueados podem ser reabertos.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         result = COALESCE(result, '{}'::jsonb)
           || jsonb_build_object('manual_retry_justification', v_justification),
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'import_effect', v_row.id::text, 'retry',
    jsonb_build_object('status', 'blocked', 'attempts', v_row.attempts)::text,
    jsonb_build_object('status', 'retry_wait', 'attempts', 0)::text,
    v_actor, v_justification, COALESCE(v_role, 'sistema'), COALESCE(v_role, 'sistema')
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$function$;
