-- 205 — Correção manual de perfil (IMO/OOG) ou SOC/COC vale com B/L faturado
-- no container (ADR 0079, decisão 5).
--
-- Até aqui (194), qualquer B/L faturado entre os que dividem o container (Part
-- Lot) recusava a correção inteira, inclusive para os B/Ls ainda sem fatura.
-- Exemplo: o armador confirma por e-mail que a carga é IMO; o B/L A já foi
-- faturado e o B ainda não; a fatura do B sairia sem o adicional IMO, e o A
-- continuaria errado.
--
-- Agora a correção feita pelo B/L sem fatura vale para todos os B/Ls ativos do
-- container (ADR 0078, item 21: Part Lot tem sempre as mesmas
-- características). Os B/Ls sem fatura são recalculados na hora. No B/L
-- faturado a mudança segue a ADR 0077, pelos gatilhos de base que já tratam a
-- reimportação e o Baplie: a fatura emitida não muda de valor por recálculo; a
-- correção (ou a restituição, se paga) sai pelo fluxo da fatura. O retorno
-- lista os B/Ls faturados (`invoiced_bls`).
--
-- Continua recusada, como desde a 115, a correção que parte do próprio B/L
-- faturado (a decisão 5 tratou do Part Lot, não desse caso); a mensagem aponta
-- o B/L sem fatura do mesmo container, quando houver. Também continua recusada
-- a correção que parte de B/L cancelado (somente leitura).
--
-- Redefine `set_bl_container_profile` e `set_bl_container_ownership` a partir
-- da 194. Não reescreve nem apaga linhas existentes: só redefine funções.
-- Rollback: reaplicar as definições da 194.

CREATE OR REPLACE FUNCTION public.set_bl_container_profile(p_container_id bigint, p_profile text, p_justification text, p_changed_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_container public.bl_containers%ROWTYPE;
  v_voyage bigint;
  v_cancelled_at timestamptz;
  v_number text;
  v_ids bigint[];
  v_target public.bl_containers%ROWTYPE;
  v_invoiced text[];
  v_open_bl text;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_is_imo boolean := p_profile IN ('imo', 'imo_oog');
  v_is_oog boolean := p_profile IN ('oog', 'imo_oog');
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_recalc text[] := ARRAY[]::text[];
  v_bl_id text;
  v_charges jsonb;
  v_propagated jsonb := '[]'::jsonb;
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

  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  SELECT voyage_id, cancelled_at INTO v_voyage, v_cancelled_at FROM public.bls WHERE id = v_container.bl_id;
  v_number := upper(btrim(v_container.container_number));
  -- B/L cancelado é somente leitura (ADR 0071, item 9): a correção não parte
  -- dele para os B/Ls ativos do container.
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', v_container.bl_id USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = v_container.id
     OR (b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number);

  -- Containers e B/Ls travados na ordem do id (a mesma da aplicação do Baplie).
  PERFORM 1 FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.bls
  WHERE id IN (SELECT bl_id FROM public.bl_containers WHERE id = ANY(v_ids))
  ORDER BY id FOR UPDATE;

  -- Irmão faturado no Part Lot não recusa mais a correção (ADR 0079, decisão
  -- 5): a marca vale para todo o Part Lot, e a fatura emitida segue a ADR 0077
  -- pelos gatilhos de base (`capture_invoice_basis` /
  -- `process_invoice_basis_changes`): não muda de valor por recálculo; a
  -- correção sai pelo fluxo da fatura. O próprio B/L faturado ainda recusa.
  SELECT COALESCE(array_agg(DISTINCT c.bl_id ORDER BY c.bl_id), ARRAY[]::text[]) INTO v_invoiced
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = ANY(v_ids) AND b.financial_status IN ('invoiced', 'partially_paid', 'paid');

  IF v_container.bl_id = ANY(v_invoiced) THEN
    SELECT min(c.bl_id) INTO v_open_bl FROM public.bl_containers AS c
    WHERE c.id = ANY(v_ids) AND NOT (c.bl_id = ANY(v_invoiced));
    RAISE EXCEPTION 'B/L % já foi faturado; o perfil não pode mudar porque as taxas não podem ser recalculadas.%', v_container.bl_id,
      CASE WHEN v_open_bl IS NULL THEN '' ELSE ' O container também está no B/L ' || v_open_bl || ', sem fatura: corrija por ele.' END
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers
    WHERE id = ANY(v_ids) AND (COALESCE(is_imo, false) <> v_is_imo OR COALESCE(is_oog, false) <> v_is_oog)
  ) THEN
    RAISE EXCEPTION 'O container já está com este perfil.' USING ERRCODE = '22023';
  END IF;

  -- Correção manual (o armador confirma fora do Baplie): o Baplie não a
  -- sobrescreve; Baplie diferente vira Divergente (migration 182).
  FOR v_target IN SELECT * FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id LOOP
    UPDATE public.bl_containers
    SET is_imo = v_is_imo,
        is_oog = v_is_oog,
        imo_class = CASE WHEN v_is_imo THEN imo_class END,
        un_number = CASE WHEN v_is_imo THEN un_number END,
        profile_source = 'manual'
    WHERE id = v_target.id;

    IF COALESCE(v_target.is_imo, false) <> v_is_imo OR COALESCE(v_target.is_oog, false) <> v_is_oog THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification
      ) VALUES (
        'bl', v_target.bl_id, 'container_profile',
        jsonb_build_object('container', v_target.container_number, 'is_imo', COALESCE(v_target.is_imo, false), 'is_oog', COALESCE(v_target.is_oog, false))::text,
        jsonb_build_object('container', v_target.container_number, 'is_imo', v_is_imo, 'is_oog', v_is_oog)::text,
        v_actor, now(),
        CASE WHEN v_target.bl_id = v_container.bl_id THEN v_justification
             ELSE v_justification || ' (mesmo container do B/L ' || v_container.bl_id || ', Part Lot)' END
      );
      v_recalc := array_append(v_recalc, v_target.bl_id);
    END IF;
    IF v_target.id <> v_container.id THEN
      v_propagated := v_propagated || jsonb_build_array(jsonb_build_object('bl_id', v_target.bl_id, 'container_id', v_target.id));
    END IF;
  END LOOP;

  -- Recalcula só os B/Ls sem fatura; o faturado segue a ADR 0077.
  v_charges := public.calculate_bl_local_charges(v_container.bl_id, v_actor, true);
  FOR v_bl_id IN
    SELECT DISTINCT bl FROM unnest(v_recalc) AS bl
    WHERE bl <> v_container.bl_id AND NOT (bl = ANY(v_invoiced)) ORDER BY 1
  LOOP
    PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
  END LOOP;

  RETURN jsonb_build_object(
    'bl_id', v_container.bl_id,
    'container_id', v_container.id,
    'profile', p_profile,
    'charges', v_charges,
    'propagated_to', v_propagated,
    'invoiced_bls', to_jsonb(v_invoiced)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_bl_container_ownership(p_container_id bigint, p_ownership text, p_justification text, p_changed_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_container public.bl_containers%ROWTYPE;
  v_voyage bigint;
  v_cancelled_at timestamptz;
  v_number text;
  v_ids bigint[];
  v_target public.bl_containers%ROWTYPE;
  v_invoiced text[];
  v_open_bl text;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_ownership text := upper(btrim(COALESCE(p_ownership, '')));
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_recalc text[] := ARRAY[]::text[];
  v_bl_id text;
  v_charges jsonb;
  v_propagated jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O autor da alteração deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF v_ownership NOT IN ('SOC', 'COC') THEN
    RAISE EXCEPTION 'Propriedade do container inválida: %.', p_ownership USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'A justificativa da alteração de SOC/COC é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  SELECT voyage_id, cancelled_at INTO v_voyage, v_cancelled_at FROM public.bls WHERE id = v_container.bl_id;
  v_number := upper(btrim(v_container.container_number));
  -- B/L cancelado é somente leitura (ADR 0071, item 9): a correção não parte
  -- dele para os B/Ls ativos do container.
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', v_container.bl_id USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = v_container.id
     OR (b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number);

  PERFORM 1 FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.bls
  WHERE id IN (SELECT bl_id FROM public.bl_containers WHERE id = ANY(v_ids))
  ORDER BY id FOR UPDATE;

  -- Irmão faturado no Part Lot não recusa mais a correção (ADR 0079, decisão
  -- 5): a marca vale para todo o Part Lot, e a fatura emitida segue a ADR 0077
  -- pelos gatilhos de base (`capture_invoice_basis` /
  -- `process_invoice_basis_changes`): não muda de valor por recálculo; a
  -- correção sai pelo fluxo da fatura. O próprio B/L faturado ainda recusa.
  SELECT COALESCE(array_agg(DISTINCT c.bl_id ORDER BY c.bl_id), ARRAY[]::text[]) INTO v_invoiced
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = ANY(v_ids) AND b.financial_status IN ('invoiced', 'partially_paid', 'paid');

  IF v_container.bl_id = ANY(v_invoiced) THEN
    SELECT min(c.bl_id) INTO v_open_bl FROM public.bl_containers AS c
    WHERE c.id = ANY(v_ids) AND NOT (c.bl_id = ANY(v_invoiced));
    RAISE EXCEPTION 'B/L % já foi faturado; SOC/COC não pode mudar porque as taxas não podem ser recalculadas.%', v_container.bl_id,
      CASE WHEN v_open_bl IS NULL THEN '' ELSE ' O container também está no B/L ' || v_open_bl || ', sem fatura: corrija por ele.' END
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bl_containers WHERE id = ANY(v_ids) AND ownership IS DISTINCT FROM v_ownership) THEN
    RAISE EXCEPTION 'O container já está como %.', v_ownership USING ERRCODE = '22023';
  END IF;

  FOR v_target IN SELECT * FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id LOOP
    UPDATE public.bl_containers
    SET ownership = v_ownership,
        ownership_source = 'manual'
    WHERE id = v_target.id;

    IF v_target.ownership IS DISTINCT FROM v_ownership THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification
      ) VALUES (
        'bl', v_target.bl_id, 'container_ownership',
        jsonb_build_object('container', v_target.container_number, 'ownership', v_target.ownership, 'source', v_target.ownership_source)::text,
        jsonb_build_object('container', v_target.container_number, 'ownership', v_ownership, 'source', 'manual')::text,
        v_actor, now(),
        CASE WHEN v_target.bl_id = v_container.bl_id THEN v_justification
             ELSE v_justification || ' (mesmo container do B/L ' || v_container.bl_id || ', Part Lot)' END
      );
      v_recalc := array_append(v_recalc, v_target.bl_id);
    END IF;
    IF v_target.id <> v_container.id THEN
      v_propagated := v_propagated || jsonb_build_array(jsonb_build_object('bl_id', v_target.bl_id, 'container_id', v_target.id));
    END IF;
  END LOOP;

  -- Recalcula só os B/Ls sem fatura; o faturado segue a ADR 0077.
  v_charges := public.calculate_bl_local_charges(v_container.bl_id, v_actor, true);
  FOR v_bl_id IN
    SELECT DISTINCT bl FROM unnest(v_recalc) AS bl
    WHERE bl <> v_container.bl_id AND NOT (bl = ANY(v_invoiced)) ORDER BY 1
  LOOP
    PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
  END LOOP;

  RETURN jsonb_build_object(
    'bl_id', v_container.bl_id,
    'container_id', v_container.id,
    'ownership', v_ownership,
    'charges', v_charges,
    'propagated_to', v_propagated,
    'invoiced_bls', to_jsonb(v_invoiced)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_container_profile(bigint, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_container_profile(bigint, text, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_bl_container_ownership(bigint, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_container_ownership(bigint, text, text, uuid) TO authenticated, service_role;
