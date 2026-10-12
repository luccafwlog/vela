-- 198 — Granito: a sugestão de Cliente entra na detecção de mudança da
-- reimportação (revisão da PR 929, achado da revisão automática na 196).
--
-- A reimportação por número do B/L (186/192/196) grava `suggested_client_id`
-- quando o B/L ainda não tem Cliente, mas a comparação que decide se a linha
-- mudou não olhava essa coluna. Planilha igual à anterior, com um Cliente
-- cadastrado depois da primeira importação que agora gera a sugestão por nome:
-- nada era atualizado e o B/L seguia na Revisão sem a sugestão nova. A sugestão
-- efetiva passa a fazer parte da comparação.
--
-- Redefine `import_granite_manifest_transactional_legacy_189` a partir da 196;
-- o invólucro da 189 não muda. Não reescreve linhas fora do que a própria
-- importação grava. Rollback: reaplicar a definição da 196.

CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional_legacy_189(p_voyage_id bigint, p_vessel_voyage text, p_loading_port text, p_discharge_port text, p_total_bls integer, p_total_weight_kg numeric, p_uploaded_by uuid, p_bls jsonb, p_remove_missing text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_kept_invoiced text[] := ARRAY[]::text[];
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

    -- ponytail: uma planilha de Granito por Viagem (ADR 0078, item 25). Qualquer
    -- arquivo depois do primeiro é reimportação da Viagem inteira: B/Ls novos
    -- entram no manifesto mais recente e os de outra planilha contam como
    -- ausentes (só saem com confirmação). Teto: duas planilhas COSCO legítimas
    -- da mesma Viagem não convivem — decisão pendente do dono no plano
    -- 2026-10-09. Caminho de evolução: identidade estável do manifesto (ou alvo
    -- explícito da reimportação) escolhida na tela.
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
             g.cargo_readiness_date, g.phase, g.client_id, g.suggested_client_id)
            IS DISTINCT FROM
            (t.sequence, t.booking_number, t.shipper_ref, t.vessel_voyage, t.loading_port, t.discharge_port,
             t.shipper_name, t.shipper_cnpj, t.consignee_name, t.charter, t.shipper_m3::numeric(12,3), t.shipper_weight_kg::numeric(14,3),
             t.blocks_qty, t.received_blocks_qty, t.final_m3::numeric(12,3), t.real_weight_kg::numeric(14,3), t.stockyard, t.remarks,
             COALESCE(t.partial_restriction, false), t.cosco_transport, t.fragile_blocks, t.cssc_selection,
             t.cargo_readiness_date, t.phase, COALESCE(g.client_id, t.client_id),
             CASE WHEN g.client_id IS NULL THEN t.suggested_client_id ELSE g.suggested_client_id END)
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

    -- Ausentes do arquivo novo: saem só com confirmação. O B/L com Invoice
    -- nunca sai: fica e volta em `kept_missing_invoiced_bl_numbers` (V3);
    -- antes, um só deles recusava (23503) o arquivo inteiro, contra o que a
    -- confirmação da tela promete.
    SELECT COALESCE(array_agg(g.bl_number ORDER BY g.bl_number), ARRAY[]::text[]) INTO v_kept_invoiced
    FROM public.granite_bls g JOIN public.granite_manifests m ON m.id = g.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND upper(btrim(g.bl_number)) = ANY (SELECT upper(btrim(x)) FROM unnest(COALESCE(p_remove_missing, ARRAY[]::text[])) AS x)
      AND NOT EXISTS (SELECT 1 FROM tmp_granite_import t WHERE t.key = upper(btrim(g.bl_number)))
      AND EXISTS (SELECT 1 FROM public.invoice_granite_bls ig WHERE ig.granite_bl_id = g.id);

    WITH gone AS (
      DELETE FROM public.granite_bls AS g
      USING public.granite_manifests AS m
      WHERE m.id = g.manifest_id AND m.voyage_id = p_voyage_id
        AND upper(btrim(g.bl_number)) = ANY (SELECT upper(btrim(x)) FROM unnest(COALESCE(p_remove_missing, ARRAY[]::text[])) AS x)
        AND NOT EXISTS (SELECT 1 FROM tmp_granite_import t WHERE t.key = upper(btrim(g.bl_number)))
        AND NOT EXISTS (SELECT 1 FROM public.invoice_granite_bls ig WHERE ig.granite_bl_id = g.id)
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
    SET vessel_voyage = btrim(p_vessel_voyage), loading_port = p_loading_port, discharge_port = p_discharge_port
    WHERE id = v_manifest_id;
    -- A atualização e a saída por número alcançam B/Ls de qualquer manifesto
    -- da Viagem (legado com mais de um): os totais de todos eles são refeitos,
    -- não só os do mais recente.
    UPDATE public.granite_manifests AS gm
    SET total_bls = (SELECT count(*) FROM public.granite_bls WHERE manifest_id = gm.id),
        total_weight_kg = (SELECT COALESCE(sum(real_weight_kg), 0) FROM public.granite_bls WHERE manifest_id = gm.id)
    WHERE gm.voyage_id = p_voyage_id;

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
    'kept_missing_bl_numbers', to_jsonb(v_missing),
    'kept_missing_invoiced_bl_numbers', to_jsonb(v_kept_invoiced)
  );
END;
$function$;
