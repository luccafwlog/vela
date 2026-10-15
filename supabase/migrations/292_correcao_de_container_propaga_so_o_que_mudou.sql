-- 292 — Na correção de lacre, peso bruto e CBM (migration 289), só o lacre
-- vale para o Part Lot; peso bruto e CBM ficam no B/L corrigido.
--
-- Na 289, a janela Corrigir envia os três valores do container aberto e a RPC
-- gravava os três em todos os B/Ls ativos da Viagem que dividem o container.
-- Corrigir só o lacre do container no B/L A sobrescrevia, no B/L B, peso
-- bruto e CBM com os valores do A, mesmo quando o arquivo do B tinha trazido
-- outros, e o histórico do B registrava essa troca como correção.
--
-- Decisão do responsável de 2026-10-15: o lacre é do container físico e vale
-- para todos os B/Ls ativos da Viagem que o dividem, quando muda no container
-- aberto; peso bruto e CBM são da parte de cada B/L (cada arquivo traz os
-- seus) e mudam só no B/L corrigido. "Nenhum dado do container mudou" olha o
-- container aberto.
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da 289.

CREATE OR REPLACE FUNCTION public.correct_bl_container_data(
  p_container_id bigint,
  p_seal_number text,
  p_gross_weight_kg numeric,
  p_cbm numeric,
  p_justification text
)
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
  v_actor uuid := auth.uid();
  v_seal text := NULLIF(btrim(COALESCE(p_seal_number, '')), '');
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_seal_changed boolean;
  v_weight_changed boolean;
  v_cbm_changed boolean;
  v_reason text;
  v_propagated jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'A justificativa da correção é obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF p_gross_weight_kg IS NOT NULL AND p_gross_weight_kg < 0 THEN
    RAISE EXCEPTION 'Peso bruto não pode ser negativo.' USING ERRCODE = '22023';
  END IF;
  IF p_cbm IS NOT NULL AND p_cbm < 0 THEN
    RAISE EXCEPTION 'CBM não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  SELECT voyage_id, cancelled_at INTO v_voyage, v_cancelled_at FROM public.bls WHERE id = v_container.bl_id;
  -- B/L cancelado é somente leitura (ADR 0071, item 9).
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', v_container.bl_id USING ERRCODE = '42501';
  END IF;
  v_number := upper(btrim(v_container.container_number));

  SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = v_container.id
     OR (b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number);

  -- Mesma ordem de travas das outras correções de container (migration 205).
  PERFORM 1 FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  -- O que mudou é medido no container aberto, já travado.
  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id;
  v_seal_changed := v_container.seal_number IS DISTINCT FROM v_seal;
  v_weight_changed := v_container.gross_weight_kg IS DISTINCT FROM p_gross_weight_kg;
  v_cbm_changed := v_container.cbm IS DISTINCT FROM p_cbm;
  IF NOT (v_seal_changed OR v_weight_changed OR v_cbm_changed) THEN
    RAISE EXCEPTION 'Nenhum dado do container mudou.' USING ERRCODE = '22023';
  END IF;

  -- Peso bruto e CBM: só o container aberto.
  IF v_weight_changed THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('bl_container', v_container.id::text, 'gross_weight_kg|' || v_container.container_number, v_container.gross_weight_kg::text, p_gross_weight_kg::text, v_actor, now(), v_justification);
  END IF;
  IF v_cbm_changed THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('bl_container', v_container.id::text, 'cbm|' || v_container.container_number, v_container.cbm::text, p_cbm::text, v_actor, now(), v_justification);
  END IF;
  IF v_weight_changed OR v_cbm_changed THEN
    UPDATE public.bl_containers
    SET gross_weight_kg = p_gross_weight_kg,
        cbm = p_cbm
    WHERE id = v_container.id;
  END IF;

  -- Lacre: o container físico, em todo o Part Lot.
  IF v_seal_changed THEN
    FOR v_target IN SELECT * FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id LOOP
      CONTINUE WHEN v_target.seal_number IS NOT DISTINCT FROM v_seal;
      v_reason := CASE WHEN v_target.bl_id = v_container.bl_id THEN v_justification
                       ELSE v_justification || ' (mesmo container do B/L ' || v_container.bl_id || ', Part Lot)' END;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl_container', v_target.id::text, 'seal_number|' || v_target.container_number, v_target.seal_number, v_seal, v_actor, now(), v_reason);
      UPDATE public.bl_containers SET seal_number = v_seal WHERE id = v_target.id;
      IF v_target.id <> v_container.id THEN
        v_propagated := v_propagated || jsonb_build_array(jsonb_build_object('bl_id', v_target.bl_id, 'container_id', v_target.id));
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'bl_id', v_container.bl_id,
    'container_id', v_container.id,
    'propagated_to', v_propagated
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_bl_container_data(bigint, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_bl_container_data(bigint, text, numeric, numeric, text) TO authenticated, service_role;
