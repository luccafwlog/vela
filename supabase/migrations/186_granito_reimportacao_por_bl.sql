-- 186 — Reimportação do Granito atualiza por número de B/L na Viagem
-- (ADR 0078, item 25; Etapa 11 do plano 2026-10-09-correcao-importacoes-ce-mercante).
--
-- Antes, reimportar a planilha COSCO da mesma Viagem criava outro manifesto e
-- duplicava os B/Ls. Agora, quando a Viagem já tem B/Ls de Granito:
-- - o B/L do arquivo com número já gravado na Viagem é atualizado, preservando
--   CE Mercante, Cliente vinculado e status de cobrança;
-- - B/L novo entra no manifesto mais recente da Viagem;
-- - B/L gravado que o arquivo novo não traz só sai se vier em
--   `p_remove_missing` (a tela pede confirmação); com Invoice, nunca sai;
-- - o efeito `granite_billing` é enfileirado só para B/L novo ou alterado.
-- O CE Mercante de Granito continua sem cálculo automático.

DROP FUNCTION public.import_granite_manifest_transactional(bigint, text, text, text, integer, numeric, uuid, jsonb);

CREATE FUNCTION public.import_granite_manifest_transactional(
  p_voyage_id bigint,
  p_vessel_voyage text,
  p_loading_port text,
  p_discharge_port text,
  p_total_bls integer,
  p_total_weight_kg numeric,
  p_uploaded_by uuid,
  p_bls jsonb,
  p_remove_missing text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
  v_manifest_id uuid;
  v_action_id uuid := gen_random_uuid();
  v_granite_bl record;
  v_touched uuid[] := ARRAY[]::uuid[];
  v_updated uuid[] := ARRAY[]::uuid[];
  v_inserted uuid[] := ARRAY[]::uuid[];
  v_removed text[] := ARRAY[]::text[];
  v_missing text[] := ARRAY[]::text[];
  v_dup text;
  v_blocked text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar manifesto Granito.'
      USING ERRCODE = '42501';
  END IF;

  -- Duas planilhas da mesma Viagem não se cruzam.
  PERFORM pg_advisory_xact_lock(hashtextextended('granite_voyage:' || p_voyage_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
    WHERE m.voyage_id = p_voyage_id
  ) THEN
    -- Primeira importação da Viagem: caminho original.
    v_result := public.import_granite_manifest_transactional_legacy_136(
      p_voyage_id, p_vessel_voyage, p_loading_port, p_discharge_port,
      p_total_bls, p_total_weight_kg, p_uploaded_by, p_bls
    );
    v_manifest_id := (v_result->>'manifest_id')::uuid;
    UPDATE public.granite_bls AS g
    SET suggested_client_id = NULLIF(item->>'suggested_client_id', '')::bigint
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE g.manifest_id = v_manifest_id AND g.bl_number = item->>'bl_number';
    SELECT array_agg(id ORDER BY id) INTO v_touched FROM public.granite_bls WHERE manifest_id = v_manifest_id;
    v_inserted := COALESCE(v_touched, ARRAY[]::uuid[]);
  ELSE
    IF NULLIF(btrim(COALESCE(p_vessel_voyage, '')), '') IS NULL
       OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
      RAISE EXCEPTION 'Manifesto Granito invalido.' USING ERRCODE = '22023';
    END IF;

    CREATE TEMP TABLE tmp_granite_import ON COMMIT DROP AS
    SELECT upper(btrim(item.bl_number)) AS key, item.*
    FROM jsonb_to_recordset(p_bls) AS item(
      client_id bigint, suggested_client_id bigint, sequence integer, booking_number text, bl_number text,
      shipper_ref text, vessel_voyage text, loading_port text, discharge_port text, shipper_name text,
      shipper_cnpj text, consignee_name text, charter text, shipper_m3 numeric, shipper_weight_kg numeric,
      blocks_qty integer, received_blocks_qty integer, final_m3 numeric, real_weight_kg numeric,
      stockyard text, remarks text, partial_restriction boolean, cosco_transport text, fragile_blocks integer,
      cssc_selection text, cargo_readiness_date date, phase text
    );

    SELECT key INTO v_dup FROM tmp_granite_import GROUP BY key HAVING count(*) > 1 LIMIT 1;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'B/L % aparece mais de uma vez no arquivo.', v_dup USING ERRCODE = '22023';
    END IF;

    SELECT m.id INTO v_manifest_id FROM public.granite_manifests m
    WHERE m.voyage_id = p_voyage_id ORDER BY m.imported_at DESC NULLS LAST, m.id DESC LIMIT 1
    FOR UPDATE;

    -- Atualiza por número do B/L, preservando CE, Cliente e status de cobrança.
    WITH changed AS (
      UPDATE public.granite_bls AS g
      SET sequence = t.sequence, booking_number = t.booking_number, shipper_ref = t.shipper_ref,
          vessel_voyage = t.vessel_voyage, loading_port = t.loading_port, discharge_port = t.discharge_port,
          shipper_name = t.shipper_name, shipper_cnpj = t.shipper_cnpj, consignee_name = t.consignee_name,
          charter = t.charter, shipper_m3 = t.shipper_m3, shipper_weight_kg = t.shipper_weight_kg,
          blocks_qty = t.blocks_qty, received_blocks_qty = t.received_blocks_qty, final_m3 = t.final_m3,
          real_weight_kg = t.real_weight_kg, stockyard = t.stockyard, remarks = t.remarks,
          partial_restriction = COALESCE(t.partial_restriction, false), cosco_transport = t.cosco_transport,
          fragile_blocks = t.fragile_blocks, cssc_selection = t.cssc_selection,
          cargo_readiness_date = t.cargo_readiness_date, phase = t.phase,
          client_id = COALESCE(g.client_id, t.client_id),
          suggested_client_id = CASE WHEN g.client_id IS NULL THEN t.suggested_client_id ELSE g.suggested_client_id END
      FROM tmp_granite_import AS t, public.granite_manifests AS m
      WHERE m.id = g.manifest_id AND m.voyage_id = p_voyage_id AND upper(btrim(g.bl_number)) = t.key
        AND (g.sequence, g.booking_number, g.shipper_ref, g.vessel_voyage, g.loading_port, g.discharge_port,
             g.shipper_name, g.shipper_cnpj, g.consignee_name, g.charter, g.shipper_m3, g.shipper_weight_kg,
             g.blocks_qty, g.received_blocks_qty, g.final_m3, g.real_weight_kg, g.stockyard, g.remarks,
             g.partial_restriction, g.cosco_transport, g.fragile_blocks, g.cssc_selection,
             g.cargo_readiness_date, g.phase, g.client_id)
            IS DISTINCT FROM
            (t.sequence, t.booking_number, t.shipper_ref, t.vessel_voyage, t.loading_port, t.discharge_port,
             t.shipper_name, t.shipper_cnpj, t.consignee_name, t.charter, t.shipper_m3::numeric(12,3), t.shipper_weight_kg::numeric(14,3),
             t.blocks_qty, t.received_blocks_qty, t.final_m3::numeric(12,3), t.real_weight_kg::numeric(14,3), t.stockyard, t.remarks,
             COALESCE(t.partial_restriction, false), t.cosco_transport, t.fragile_blocks, t.cssc_selection,
             t.cargo_readiness_date, t.phase, COALESCE(g.client_id, t.client_id))
      RETURNING g.id
    )
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_updated FROM changed;

    WITH added AS (
      INSERT INTO public.granite_bls (
        manifest_id, client_id, suggested_client_id, sequence, booking_number, bl_number, shipper_ref, vessel_voyage,
        loading_port, discharge_port, shipper_name, shipper_cnpj, consignee_name, charter, shipper_m3,
        shipper_weight_kg, blocks_qty, received_blocks_qty, final_m3, real_weight_kg, stockyard, remarks,
        partial_restriction, cosco_transport, fragile_blocks, cssc_selection, cargo_readiness_date, phase, charge_status)
      SELECT v_manifest_id, t.client_id, t.suggested_client_id, t.sequence, t.booking_number, btrim(t.bl_number), t.shipper_ref,
        t.vessel_voyage, t.loading_port, t.discharge_port, t.shipper_name, t.shipper_cnpj, t.consignee_name, t.charter,
        t.shipper_m3, t.shipper_weight_kg, t.blocks_qty, t.received_blocks_qty, t.final_m3, t.real_weight_kg,
        t.stockyard, t.remarks, COALESCE(t.partial_restriction, false), t.cosco_transport, t.fragile_blocks,
        t.cssc_selection, t.cargo_readiness_date, t.phase, 'not_calculated'
      FROM tmp_granite_import AS t
      WHERE NOT EXISTS (
        SELECT 1 FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
        WHERE m.voyage_id = p_voyage_id AND upper(btrim(g.bl_number)) = t.key)
      RETURNING id
    )
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_inserted FROM added;

    -- Ausentes do arquivo novo: saem só com confirmação; com Invoice, nunca.
    SELECT g.bl_number INTO v_blocked
    FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND upper(btrim(g.bl_number)) = ANY (SELECT upper(btrim(x)) FROM unnest(COALESCE(p_remove_missing, ARRAY[]::text[])) AS x)
      AND NOT EXISTS (SELECT 1 FROM tmp_granite_import t WHERE t.key = upper(btrim(g.bl_number)))
      AND EXISTS (SELECT 1 FROM public.invoice_granite_bls ig WHERE ig.granite_bl_id = g.id)
    LIMIT 1;
    IF v_blocked IS NOT NULL THEN
      RAISE EXCEPTION 'B/L de Granito % tem Invoice e não sai pela reimportação.', v_blocked USING ERRCODE = '23503';
    END IF;

    WITH gone AS (
      DELETE FROM public.granite_bls AS g
      USING public.granite_manifests AS m
      WHERE m.id = g.manifest_id AND m.voyage_id = p_voyage_id
        AND upper(btrim(g.bl_number)) = ANY (SELECT upper(btrim(x)) FROM unnest(COALESCE(p_remove_missing, ARRAY[]::text[])) AS x)
        AND NOT EXISTS (SELECT 1 FROM tmp_granite_import t WHERE t.key = upper(btrim(g.bl_number)))
      RETURNING g.bl_number
    )
    SELECT COALESCE(array_agg(bl_number ORDER BY bl_number), ARRAY[]::text[]) INTO v_removed FROM gone;

    IF cardinality(v_removed) > 0 THEN
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      SELECT 'granite_bls', r, 'deleted', r, NULL, auth.uid(), 'Reimportação do Granito: ausente do arquivo novo, saída confirmada'
      FROM unnest(v_removed) AS r;
    END IF;

    SELECT COALESCE(array_agg(g.bl_number ORDER BY g.bl_number), ARRAY[]::text[]) INTO v_missing
    FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND NOT EXISTS (SELECT 1 FROM tmp_granite_import t WHERE t.key = upper(btrim(g.bl_number)));

    UPDATE public.granite_manifests
    SET vessel_voyage = btrim(p_vessel_voyage), loading_port = p_loading_port, discharge_port = p_discharge_port,
        total_bls = (SELECT count(*) FROM public.granite_bls WHERE manifest_id = v_manifest_id),
        total_weight_kg = (SELECT COALESCE(sum(real_weight_kg), 0) FROM public.granite_bls WHERE manifest_id = v_manifest_id)
    WHERE id = v_manifest_id;

    v_touched := v_updated || v_inserted;
    v_result := jsonb_build_object('manifest_id', v_manifest_id, 'inserted_bls', cardinality(v_inserted));
  END IF;

  FOR v_granite_bl IN
    SELECT id, bl_number FROM public.granite_bls WHERE id = ANY (v_touched) ORDER BY id
  LOOP
    INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by, source_snapshot)
    VALUES (v_action_id, 'granite_billing', v_granite_bl.id::text, p_uploaded_by,
      jsonb_build_object('manifest_id', v_manifest_id, 'bl_number', v_granite_bl.bl_number, 'voyage_id', p_voyage_id))
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  RETURN v_result || jsonb_build_object(
    'updated_bls', cardinality(v_updated),
    'removed_bl_numbers', to_jsonb(v_removed),
    'kept_missing_bl_numbers', to_jsonb(v_missing)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.import_granite_manifest_transactional(bigint, text, text, text, integer, numeric, uuid, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_granite_manifest_transactional(bigint, text, text, text, integer, numeric, uuid, jsonb, text[]) TO authenticated;
