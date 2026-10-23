-- 430: a troca da própria senha entra no Histórico (auditoria de segurança
-- run-3, nota de endurecimento).
--
-- A redefinição pelo Administrativo (admin-users) grava `user_profile` /
-- `password` no Histórico; a troca da própria senha em Meu perfil não gravava
-- nada, e a 404 fechou o INSERT direto. `record_audit_entries` passa a aceitar
-- essa linha só para a própria conta, com o valor fixo
-- 'alterada pelo próprio usuário' e sem valor anterior.
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da 404.

CREATE OR REPLACE FUNCTION public.record_audit_entries(p_entries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_entry jsonb;
  v_type text;
  v_field text;
  v_count integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para registrar no Histórico.' USING ERRCODE = '42501';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Registros do Histórico inválidos.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_entries) > 100 THEN
    RAISE EXCEPTION 'Registros demais para o Histórico de uma vez.' USING ERRCODE = '22023';
  END IF;

  FOR v_entry IN SELECT e FROM jsonb_array_elements(p_entries) AS t(e) LOOP
    v_type := v_entry ->> 'entity_type';
    v_field := v_entry ->> 'field_name';
    IF NULLIF(btrim(COALESCE(v_entry ->> 'entity_id', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Registro do Histórico sem identificação.' USING ERRCODE = '22023';
    END IF;
    IF NOT (
         (v_type IN ('voyage_pod_schedule', 'voyage_pol_schedule') AND v_field IN (
            'etd', 'eta', 'etb', 'ata', 'atb', 'atd', 'rtw', 'ces', 'linked',
            'escala_number', 'deleted', 'omitted', 'tem_importacao'))
      -- 408 (R-13): navio, número e status da Viagem vêm só do gatilho de
      -- `voyages` (audit_voyages), com o valor que de fato mudou.
      OR (v_type = 'voyages' AND v_field IN (
            'created', 'indicated_first_brazilian_port', 'indicated_first_brazilian_eta'))
      OR (v_type = 'system_event' AND v_field IN (
            'manifest_import_rate_limited', 'manifest_import_duplicate_hash',
            'bl_review_concurrent_conflict', 'invoice_create_conflict',
            'invoice_payment_invalid', 'invoice_cancel_blocked',
            'customer_finance_communication_failed', 'granite_reimport_already_invoiced'))
      OR (v_type = 'user_profile' AND v_field IN ('created', 'email', 'password', 'role', 'active', 'full_name')
          AND public.is_admin())
      -- 430: a troca da própria senha em Meu perfil, só da própria conta e
      -- sem valor (a senha nunca vai para o Histórico).
      OR (v_type = 'user_profile' AND v_field = 'password'
          AND btrim(v_entry ->> 'entity_id') = v_actor::text
          AND v_entry ->> 'old_value' IS NULL AND v_entry ->> 'new_value' = 'alterada pelo próprio usuário')
    ) THEN
      RAISE EXCEPTION 'Registro do Histórico não aceito: % / %.', v_type, v_field USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department)
    VALUES (
      v_type, btrim(v_entry ->> 'entity_id'), v_field, v_entry ->> 'old_value', v_entry ->> 'new_value',
      v_actor,
      -- Mesma hora do INSERT direto (audit_logs_force_actor): o status de B/Ls
      -- e CEs usa a hora do relógio para ordenar gravações da mesma transação.
      CASE WHEN v_type = 'voyage_pod_schedule' AND v_field IN ('ces', 'export_ces') THEN clock_timestamp() ELSE now() END,
      NULLIF(v_entry ->> 'justification', ''),
      public.current_actor_role(), public.current_actor_role());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
