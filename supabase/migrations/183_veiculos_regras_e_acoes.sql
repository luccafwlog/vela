-- 183 — Veículos: regras da importação no servidor, recálculo imediato,
-- B/L isento anula o Recebível, Mover para outro B/L e Excluir com motivo
-- (ADR 0078, itens 8 e 23; Etapa 11 do plano 2026-10-09-correcao-importacoes-ce-mercante).
--
-- 1. `import_vehicle_rows_transactional` confere no servidor o que a tela
--    confere: B/L da Viagem e não cancelado, container do B/L, chassi em outra
--    Viagem ativa (salvo B/L ou Viagem cancelados), local de desova divergente
--    dentro do próprio arquivo. O local de desova só preenche vazio; trocar o
--    gravado exige `unpacking_confirmed` na linha.
-- 2. Sem fatura viva, a importação recalcula as Taxas Locais na hora (a
--    Liberação deixa de reaproveitar o cálculo sem o veículo novo, M15) e B/L
--    isento anula o Recebível sem fatura. O efeito `vehicle_followup` continua
--    enfileirado e faz o mesmo quando processado.
-- 3. `move_vehicles_to_bl` e `delete_vehicles_with_reason`: qualquer usuário
--    ativo, com motivo, mesmo com CE no B/L; a fatura viva segue a ADR 0077
--    pelos gatilhos de base de fatura já existentes em `vehicles`.


-- 2 ─────────────────────────────────────────────────────────────────────────
-- ponytail: falha do cálculo na hora não derruba a importação; o efeito
-- `vehicle_followup` enfileirado refaz quando o processamento estiver ligado.
CREATE OR REPLACE FUNCTION public._vehicle_charges_follow(p_bl_id text, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF cardinality(public._live_local_invoice_ids_for_bl(p_bl_id)) > 0 THEN RETURN; END IF;
  BEGIN
    PERFORM public.calculate_bl_local_charges(p_bl_id, p_actor, true);
    IF COALESCE(public._quote_bl_local_charges(p_bl_id, NULL)->>'status', '') = 'exempt' THEN
      PERFORM public._void_unbilled_bl_receivables(p_bl_id, p_actor, 'B/L isento de taxas locais (carga de veículos)');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Recalculo de veiculos do B/L % adiado para o efeito: %', p_bl_id, SQLERRM;
  END;
END $$;
REVOKE ALL ON FUNCTION public._vehicle_charges_follow(text, uuid) FROM PUBLIC, anon, authenticated;

-- 1 ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer := COALESCE(jsonb_array_length(p_rows), 0);
  v_action_id uuid := gen_random_uuid();
  v_bl_id text;
  v_problem text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar veiculos.'
      USING ERRCODE = '42501';
  END IF;
  IF v_count = 0 THEN RETURN 0; END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_vehicle_import (
    voyage_id bigint, container_id bigint, bl_id text, chassis text, brand text, model text,
    weight_kg numeric, cbm numeric, unpacking_location text, unpacking_confirmed boolean
  ) ON COMMIT DROP;
  TRUNCATE tmp_vehicle_import;
  INSERT INTO tmp_vehicle_import
  SELECT row.voyage_id, row.container_id, upper(btrim(row.bl_id)), upper(btrim(row.chassis)), row.brand, row.model,
         row.weight_kg, row.cbm, NULLIF(btrim(row.unpacking_location), ''), COALESCE(row.unpacking_confirmed, false)
  FROM jsonb_to_recordset(p_rows) AS row(
    voyage_id bigint, container_id bigint, bl_id text, chassis text, brand text, model text,
    weight_kg numeric, cbm numeric, unpacking_location text, unpacking_confirmed boolean
  );

  -- B/L da Viagem, ativo; sem busca de B/L "parecido".
  SELECT 'B/L ' || t.bl_id || ' não encontrado na Viagem ou cancelado.' INTO v_problem
  FROM tmp_vehicle_import t
  LEFT JOIN public.bls b ON b.id = t.bl_id AND b.voyage_id = t.voyage_id AND b.cancelled_at IS NULL
  WHERE b.id IS NULL LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;

  -- Mesmo chassi em outra Viagem ativa.
  SELECT 'Chassi ' || t.chassis || ' já cadastrado na Viagem ' || COALESCE(v.voyage_number, v.id::text) || '.' INTO v_problem
  FROM tmp_vehicle_import t
  JOIN public.vehicles ve ON ve.chassis = t.chassis AND ve.voyage_id <> t.voyage_id
  JOIN public.bls b ON b.id = ve.bl_id AND b.cancelled_at IS NULL
  JOIN public.voyages v ON v.id = ve.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
  LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '23505'; END IF;

  -- Local de desova diferente para o mesmo container no arquivo.
  SELECT 'Local de desova diferente para o container ' || c.container_number || ' no mesmo arquivo.' INTO v_problem
  FROM tmp_vehicle_import t JOIN public.bl_containers c ON c.id = t.container_id
  WHERE t.unpacking_location IS NOT NULL
  GROUP BY c.container_number
  HAVING count(DISTINCT upper(t.unpacking_location)) > 1
  LIMIT 1;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;

  INSERT INTO public.vehicles(voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
  SELECT voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm FROM tmp_vehicle_import;

  -- Só preenche vazio; troca o gravado apenas com confirmação.
  UPDATE public.bl_containers AS c
  SET unpacking_location = t.unpacking_location
  FROM (SELECT DISTINCT ON (container_id) container_id, unpacking_location, unpacking_confirmed
        FROM tmp_vehicle_import WHERE unpacking_location IS NOT NULL ORDER BY container_id) AS t
  WHERE c.id = t.container_id
    AND c.unpacking_location IS DISTINCT FROM t.unpacking_location
    AND (NULLIF(btrim(COALESCE(c.unpacking_location, '')), '') IS NULL OR t.unpacking_confirmed);

  FOR v_bl_id IN SELECT DISTINCT bl_id FROM tmp_vehicle_import ORDER BY 1 LOOP
    INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by, source_snapshot)
    VALUES (v_action_id, 'vehicle_followup', v_bl_id, auth.uid(),
      jsonb_build_object('row_count', v_count, 'voyage_ids',
        (SELECT jsonb_agg(DISTINCT voyage_id ORDER BY voyage_id) FROM tmp_vehicle_import)))
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    PERFORM public._vehicle_charges_follow(v_bl_id, auth.uid());
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.import_vehicle_rows_transactional(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vehicle_rows_transactional(jsonb) TO authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.move_vehicles_to_bl(
  p_vehicle_ids bigint[], p_target_bl_id text, p_reason text, p_target_container_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_target public.bls%ROWTYPE;
  v_container bigint := p_target_container_id;
  v_vehicle record;
  v_sources text[] := ARRAY[]::text[];
  v_moved integer := 0;
  v_bl text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para mover veículos.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo.' USING ERRCODE = '22023'; END IF;
  IF COALESCE(cardinality(p_vehicle_ids), 0) = 0 THEN RAISE EXCEPTION 'Selecione ao menos um veículo.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_target FROM public.bls WHERE id = upper(btrim(COALESCE(p_target_bl_id, ''))) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'B/L % não encontrado.', p_target_bl_id USING ERRCODE = 'P0002'; END IF;
  IF v_target.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'B/L % está cancelado.', v_target.id USING ERRCODE = '22023'; END IF;

  IF v_container IS NULL THEN
    SELECT CASE WHEN count(*) = 1 THEN min(id) END INTO v_container FROM public.bl_containers WHERE bl_id = v_target.id;
    IF v_container IS NULL THEN
      RAISE EXCEPTION 'Escolha o container do B/L % que recebe os veículos.', v_target.id USING ERRCODE = '22023';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.bl_containers WHERE id = v_container AND bl_id = v_target.id) THEN
    RAISE EXCEPTION 'O container escolhido não é do B/L %.', v_target.id USING ERRCODE = '22023';
  END IF;

  FOR v_vehicle IN SELECT * FROM public.vehicles WHERE id = ANY(p_vehicle_ids) ORDER BY id FOR UPDATE LOOP
    IF v_vehicle.bl_id = v_target.id AND v_vehicle.container_id = v_container THEN CONTINUE; END IF;
    IF v_vehicle.voyage_id <> v_target.voyage_id AND EXISTS (
      SELECT 1 FROM public.vehicles WHERE voyage_id = v_target.voyage_id AND chassis = v_vehicle.chassis
    ) THEN
      RAISE EXCEPTION 'Chassi % já está na Viagem do B/L %.', v_vehicle.chassis, v_target.id USING ERRCODE = '23505';
    END IF;
    PERFORM public._audit_skip_once('vehicles', v_vehicle.id::text, 'bl_id');
    PERFORM public._audit_skip_once('vehicles', v_vehicle.id::text, 'container_id');
    PERFORM public._audit_skip_once('vehicles', v_vehicle.id::text, 'voyage_id');
    UPDATE public.vehicles SET bl_id = v_target.id, container_id = v_container, voyage_id = v_target.voyage_id
    WHERE id = v_vehicle.id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('vehicles', v_vehicle.id::text, 'bl_id', v_vehicle.bl_id, v_target.id, auth.uid(), v_reason);
    v_sources := array_append(v_sources, v_vehicle.bl_id);
    v_moved := v_moved + 1;
  END LOOP;

  FOR v_bl IN SELECT DISTINCT unnest(v_sources || v_target.id) LOOP
    PERFORM public._vehicle_charges_follow(v_bl, auth.uid());
  END LOOP;
  RETURN jsonb_build_object('moved', v_moved, 'target_bl_id', v_target.id, 'container_id', v_container);
END $$;
REVOKE ALL ON FUNCTION public.move_vehicles_to_bl(bigint[], text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_vehicles_to_bl(bigint[], text, text, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_vehicles_with_reason(p_vehicle_ids bigint[], p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_deleted bigint[];
  v_bls text[];
  v_bl text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para excluir veículos.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo.' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('vela.delete_reason', v_reason, true);
  WITH gone AS (DELETE FROM public.vehicles WHERE id = ANY(COALESCE(p_vehicle_ids, ARRAY[]::bigint[])) RETURNING id, bl_id)
  SELECT array_agg(id ORDER BY id), array_agg(DISTINCT bl_id) INTO v_deleted, v_bls FROM gone;
  PERFORM set_config('vela.delete_reason', '', true);
  FOR v_bl IN SELECT unnest(COALESCE(v_bls, ARRAY[]::text[])) LOOP
    PERFORM public._vehicle_charges_follow(v_bl, auth.uid());
  END LOOP;
  RETURN jsonb_build_object('deleted_ids', to_jsonb(COALESCE(v_deleted, ARRAY[]::bigint[])));
END $$;
REVOKE ALL ON FUNCTION public.delete_vehicles_with_reason(bigint[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_vehicles_with_reason(bigint[], text) TO authenticated;

-- 2 (efeito) ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._run_import_effect_vehicle_followup(p_entity_id text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text := NULLIF(btrim(COALESCE(p_entity_id, '')), '');
  v_live bigint[];
  v_quote jsonb;
  v_invoice_id bigint;
  v_cancelled_ids bigint[] := ARRAY[]::bigint[];
  v_cancel_results jsonb := '[]'::jsonb;
  v_charge jsonb;
  v_voided integer := 0;
BEGIN
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L inválido no efeito de veículos.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado para efeito de veículos.', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  v_live := public._live_local_invoice_ids_for_bl(v_bl_id);
  v_quote := public._quote_bl_local_charges(v_bl_id, NULL);

  -- Fatura viva de B/L que continua cobrado: o valor e o Cliente já foram
  -- tratados no commit da importação de veículos (ADR 0077). Nada é cancelado.
  IF cardinality(v_live) > 0 AND COALESCE(v_quote->>'status', '') <> 'exempt' THEN
    RETURN jsonb_build_object(
      'entity_id', v_bl_id,
      'status', 'skipped',
      'reason', 'live_invoice_follows_adr_0077',
      'live_invoice_ids', to_jsonb(v_live)
    );
  END IF;

  IF cardinality(v_live) > 0 THEN
    -- Isenção confirmada agora (veículo com desova LCL/CFS): a fatura sai.
    PERFORM set_config('import_effects.consumer', 'vehicle_followup', true);

    -- A consolidada que cobra este B/L sai junto: não pode voltar com os mesmos
    -- B/Ls, então é encerrada sem reemissão (decisão de 2026-10-02).
    FOR v_invoice_id IN
      SELECT DISTINCT inv.id
      FROM public.invoice_receivable_links AS l
      JOIN public.invoices AS inv ON inv.id = l.invoice_id
      WHERE l.bl_id = v_bl_id
        AND l.status IN ('active', 'settled_by_this_invoice')
        AND inv.invoice_type = 'consolidated'
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
      ORDER BY inv.id
    LOOP
      v_cancel_results := v_cancel_results || jsonb_build_array(
        public._cancel_invoice_core(v_invoice_id, 'Carga de veiculos: BL ' || v_bl_id || ' isento de taxas locais.', p_actor));
      UPDATE public.invoices
      SET reissue_requested_at = now(), reissue_closed_at = now(),
          reissue_closed_reason = 'Nao reemitida: B/L ' || v_bl_id || ' isento por carga de veiculos.'
      WHERE id = v_invoice_id;
      v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
    END LOOP;

    FOR v_invoice_id IN
      SELECT DISTINCT inv.id
      FROM public.invoice_bls AS link
      JOIN public.invoices AS inv ON inv.id = link.invoice_id
      WHERE link.bl_id = v_bl_id
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
      ORDER BY inv.id
    LOOP
      v_cancel_results := v_cancel_results || jsonb_build_array(
        public.cancel_invoice(v_invoice_id, 'Carga de veiculos: BL isento de taxas locais.', p_actor));
      v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
    END LOOP;
  END IF;

  v_charge := public.calculate_bl_local_charges(v_bl_id, p_actor, true);
  -- B/L isento sem fatura: o Recebível aberto é anulado (M15).
  IF COALESCE(public._quote_bl_local_charges(v_bl_id, NULL)->>'status', '') = 'exempt' THEN
    v_voided := public._void_unbilled_bl_receivables(v_bl_id, p_actor, 'B/L isento de taxas locais (carga de veículos)');
  END IF;
  RETURN jsonb_build_object(
    'entity_id', v_bl_id,
    'status', CASE WHEN cardinality(v_cancelled_ids) > 0 THEN 'exempt_invoices_cancelled' ELSE 'recalculated' END,
    'cancelled_invoice_ids', v_cancelled_ids,
    'cancel_results', v_cancel_results,
    'voided_receivables', v_voided,
    'charge_result', v_charge
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._run_import_effect_vehicle_followup(text, uuid) FROM PUBLIC, anon, authenticated;
