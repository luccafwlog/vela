-- 288 — Correção manual de lacre, peso bruto e CBM do container pela ficha
-- do B/L (identidade visual, lote 1, aba Carga; decisões do responsável de
-- 2026-10-15).
--
-- Até aqui lacre, peso bruto e CBM de um container só mudavam pela
-- reimportação do B/L. A janela Corrigir da aba Carga passa a corrigi-los,
-- com justificativa, pela RPC `correct_bl_container_data`:
--
-- 1. Sempre corrigíveis, inclusive com B/L faturado: nenhum dos três entra na
--    base da fatura de Taxas Locais (`bl_invoice_basis_snapshot`, migration
--    130, lê só número, IMO, OOG e SOC/COC do container), então a correção não
--    muda o valor de fatura emitida nem dispara a ADR 0077.
-- 2. Vale para todos os B/Ls ativos da viagem que dividem o container (Part
--    Lot; ADR 0078, item 21), como as correções de perfil, SOC/COC e datas.
-- 3. Não cria proteção contra a reimportação: o arquivo do B/L volta a valer
--    quando traz outro valor (decisão de 2026-10-15; migration 175, item 1).
-- 4. Cada campo que muda vira uma linha `bl_container` no histórico do B/L
--    (`<campo>|<container>`, lido por `bl_timeline`), com a justificativa.
--
-- Só cria função: não reescreve nem apaga linhas existentes.
-- Rollback: DROP FUNCTION public.correct_bl_container_data(bigint, text, numeric, numeric, text).

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
  v_reason text;
  v_changed int := 0;
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

  FOR v_target IN SELECT * FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id LOOP
    v_reason := CASE WHEN v_target.bl_id = v_container.bl_id THEN v_justification
                     ELSE v_justification || ' (mesmo container do B/L ' || v_container.bl_id || ', Part Lot)' END;

    IF v_target.seal_number IS DISTINCT FROM v_seal THEN
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl_container', v_target.id::text, 'seal_number|' || v_target.container_number, v_target.seal_number, v_seal, v_actor, now(), v_reason);
      v_changed := v_changed + 1;
    END IF;
    IF v_target.gross_weight_kg IS DISTINCT FROM p_gross_weight_kg THEN
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl_container', v_target.id::text, 'gross_weight_kg|' || v_target.container_number, v_target.gross_weight_kg::text, p_gross_weight_kg::text, v_actor, now(), v_reason);
      v_changed := v_changed + 1;
    END IF;
    IF v_target.cbm IS DISTINCT FROM p_cbm THEN
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl_container', v_target.id::text, 'cbm|' || v_target.container_number, v_target.cbm::text, p_cbm::text, v_actor, now(), v_reason);
      v_changed := v_changed + 1;
    END IF;

    UPDATE public.bl_containers
    SET seal_number = v_seal,
        gross_weight_kg = p_gross_weight_kg,
        cbm = p_cbm
    WHERE id = v_target.id
      AND (seal_number IS DISTINCT FROM v_seal OR gross_weight_kg IS DISTINCT FROM p_gross_weight_kg OR cbm IS DISTINCT FROM p_cbm);

    IF v_target.id <> v_container.id THEN
      v_propagated := v_propagated || jsonb_build_array(jsonb_build_object('bl_id', v_target.bl_id, 'container_id', v_target.id));
    END IF;
  END LOOP;

  IF v_changed = 0 THEN
    RAISE EXCEPTION 'Nenhum dado do container mudou.' USING ERRCODE = '22023';
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
