-- 115: Perfil do container (Standard/OOG/IMO/IMO + OOG) passa a ser uma
-- mutação de domínio: exige justificativa, registra autor/valores no
-- histórico e recalcula as taxas locais do B/L na mesma transação, porque
-- `resolve_bl_local_charge_items` usa is_imo/is_oog para escolher as tarifas.
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.set_bl_container_profile(
  p_container_id bigint,
  p_profile text,
  p_justification text,
  p_changed_by uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_container public.bl_containers%ROWTYPE;
  v_financial_status text;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_is_imo boolean := p_profile IN ('imo', 'imo_oog');
  v_is_oog boolean := p_profile IN ('oog', 'imo_oog');
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_charges jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O autor da alteração deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_profile IS NULL OR p_profile NOT IN ('standard', 'oog', 'imo', 'imo_oog') THEN
    RAISE EXCEPTION 'Perfil de container inválido: %.', p_profile USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'A justificativa da alteração de perfil é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;

  SELECT financial_status INTO v_financial_status FROM public.bls WHERE id = v_container.bl_id FOR UPDATE;
  IF v_financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado; o perfil não pode mudar porque as taxas não podem ser recalculadas.', v_container.bl_id
      USING ERRCODE = '55000';
  END IF;

  IF COALESCE(v_container.is_imo, false) = v_is_imo AND COALESCE(v_container.is_oog, false) = v_is_oog THEN
    RAISE EXCEPTION 'O container já está com este perfil.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bl_containers
  SET is_imo = v_is_imo,
      is_oog = v_is_oog,
      imo_class = CASE WHEN v_is_imo THEN imo_class END,
      un_number = CASE WHEN v_is_imo THEN un_number END
  WHERE id = v_container.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'bl', v_container.bl_id, 'container_profile',
    jsonb_build_object('container', v_container.container_number, 'is_imo', COALESCE(v_container.is_imo, false), 'is_oog', COALESCE(v_container.is_oog, false))::text,
    jsonb_build_object('container', v_container.container_number, 'is_imo', v_is_imo, 'is_oog', v_is_oog)::text,
    v_actor, now(), v_justification
  );

  v_charges := public.calculate_bl_local_charges(v_container.bl_id, v_actor, true);

  RETURN jsonb_build_object(
    'bl_id', v_container.bl_id,
    'container_id', v_container.id,
    'profile', p_profile,
    'charges', v_charges
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_container_profile(bigint, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_container_profile(bigint, text, text, uuid) TO authenticated, service_role;
