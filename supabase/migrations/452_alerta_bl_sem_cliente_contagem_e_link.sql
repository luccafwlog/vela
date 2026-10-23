-- 452: alerta "B/L sem Cliente perto do ETA" mostra a contagem e leva à lista
-- de B/Ls já filtrada (observações de 2026-10-23, ponto 15).
--
-- Problema: a mensagem da migration 352 listava até dez B/Ls com o
-- consignatário, ficava longa no sino e na fila de Alertas e não abria os
-- B/Ls: o link ia para a Revisão inteira.
--
-- Mudança:
--   1. `reconcile_bl_sem_cliente_perto_eta_alerts` grava só a contagem e o
--      ETA ("3 B/Ls sem Cliente com ETA em 25/10/2026."); a lista inteira
--      continua em `metadata.bls`. O link do alerta é calculado na tela
--      (`alertEntityLink`, `src/services/alerts.ts`): o banco descarta o
--      destino gravado dos tipos do catálogo (`clear_alert_item_destination`).
--      Ele passa a abrir `/bls?voyage=<viagem>&pod=<porto>&cliente=sem`.
--   2. `operational_list_bls` e `operational_list_bl_summary` ganham
--      `p_without_customer boolean DEFAULT false`: verdadeiro mostra só B/L sem
--      Cliente vinculado. Como o parâmetro muda a assinatura, as versões
--      antigas são apagadas e recriadas (mesmo corpo da migration 322 mais a
--      cláusula nova), com as mesmas permissões da migration 226.
--
-- Os alertas já abertos ganham o texto novo na próxima rodada do detector
-- (15 minutos), que regrava a mensagem pelo upsert; nenhuma linha é
-- reescrita por esta migration.
--
-- Rollback: recriar as duas listas com a assinatura anterior (corpo da 322) e
-- a reconcile com o texto da 352.
--
-- Só redefine funções; não reescreve nem apaga linhas.

DROP FUNCTION IF EXISTS public.operational_list_bls(integer, integer, text, bigint, text, text, text, text, text, text, text);

CREATE FUNCTION public.operational_list_bls(p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_search text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_cargo_mode text DEFAULT NULL::text, p_pol text DEFAULT NULL::text, p_pod text DEFAULT NULL::text, p_review_status text DEFAULT NULL::text, p_financial_status text DEFAULT NULL::text, p_charge_status text DEFAULT NULL::text, p_cargo_profile text DEFAULT NULL::text, p_without_customer boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH filtered AS (
  SELECT b.*, COUNT(*) OVER () AS total_count
  FROM public.bls AS b
  LEFT JOIN public.customers AS c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR public.normalize_port_code(b.pol) = public.normalize_port_code(p_pol))
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR public.normalize_port_code(b.pod) = public.normalize_port_code(p_pod))
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NOT coalesce(p_without_customer, false) OR b.customer_id IS NULL)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (
      NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL
      OR public.bl_local_charges_state(b.charge_status, b.financial_status, b.cancelled_at) = lower(btrim(p_charge_status))
      -- Status cru (Calculado, Revisado…) só para valores que não são estado
      -- derivado: "exempt" cru incluiria o B/L isento depois cancelado.
      OR (lower(btrim(p_charge_status)) NOT IN ('pending', 'issued', 'exempt', 'cancelled')
          AND lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
    )
    AND (
      NULLIF(btrim(coalesce(p_search, '')), '') IS NULL
      OR b.id ILIKE '%' || btrim(p_search) || '%'
      OR b.consignee ILIKE '%' || btrim(p_search) || '%'
      OR c.name ILIKE '%' || btrim(p_search) || '%'
      OR c.cnpj_cpf ILIKE '%' || btrim(p_search) || '%'
    )
    AND (
      NULLIF(btrim(coalesce(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT EXISTS (
        SELECT 1 FROM public.bl_containers bc
        WHERE bc.bl_id = b.id AND (coalesce(bc.is_imo, false) OR coalesce(bc.is_oog, false))
      ))
      OR (p_cargo_profile = 'imo' AND EXISTS (
        SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_imo, false)
      ))
      OR (p_cargo_profile = 'oog' AND EXISTS (
        SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_oog, false)
      ))
    )
), projected AS (
  SELECT f.*, (
    to_jsonb(f) - 'total_count' || jsonb_build_object(
      'customer', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'cnpj_cpf', c.cnpj_cpf, 'name', c.name) END,
      'voyage', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v.id, 'voyage_number', v.voyage_number, 'eta', v.eta, 'ata', v.ata, 'status', v.status,
        'vessel', CASE WHEN vs.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', vs.id, 'name', vs.name, 'imo', vs.imo,
          'carrier', CASE WHEN cr.id IS NULL THEN NULL ELSE jsonb_build_object('id', cr.id, 'name', cr.name, 'scac', cr.scac) END
        ) END
      ) END,
      'bl_containers', coalesce((SELECT jsonb_agg(to_jsonb(bc) ORDER BY bc.id) FROM public.bl_containers bc WHERE bc.bl_id = f.id), '[]'::jsonb),
      'bl_freight_lines', coalesce((SELECT jsonb_agg(to_jsonb(bfl) ORDER BY bfl.seq NULLS LAST) FROM public.bl_freight_lines bfl WHERE bfl.bl_id = f.id), '[]'::jsonb),
      'bl_breakbulk_items', coalesce((SELECT jsonb_agg(to_jsonb(bb) ORDER BY bb.id) FROM public.bl_breakbulk_items bb WHERE bb.bl_id = f.id), '[]'::jsonb)
    )
  ) AS row_json
  FROM filtered f
  LEFT JOIN public.customers c ON c.id = f.customer_id
  LEFT JOIN public.voyages v ON v.id = f.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
  ORDER BY f.created_at DESC NULLS LAST, f.id DESC
  OFFSET (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_page_size, 50), 1000))
  LIMIT greatest(1, least(coalesce(p_page_size, 50), 1000))
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(row_json ORDER BY row_json->>'created_at' DESC NULLS LAST, row_json->>'id' DESC) FROM projected), '[]'::jsonb),
  'count', coalesce((SELECT max(total_count) FROM filtered), 0)
);
$function$;

REVOKE ALL ON FUNCTION public.operational_list_bls(integer, integer, text, bigint, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_bls(integer, integer, text, bigint, text, text, text, text, text, text, text, boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text);

CREATE FUNCTION public.operational_list_bl_summary(p_search text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_cargo_mode text DEFAULT NULL::text, p_pol text DEFAULT NULL::text, p_pod text DEFAULT NULL::text, p_review_status text DEFAULT NULL::text, p_financial_status text DEFAULT NULL::text, p_charge_status text DEFAULT NULL::text, p_cargo_profile text DEFAULT NULL::text, p_without_customer boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH filtered AS (
  SELECT b.*
  FROM public.bls b
  LEFT JOIN public.customers c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR public.normalize_port_code(b.pol) = public.normalize_port_code(p_pol))
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR public.normalize_port_code(b.pod) = public.normalize_port_code(p_pod))
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NOT coalesce(p_without_customer, false) OR b.customer_id IS NULL)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (
      NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL
      OR public.bl_local_charges_state(b.charge_status, b.financial_status, b.cancelled_at) = lower(btrim(p_charge_status))
      -- Status cru (Calculado, Revisado…) só para valores que não são estado
      -- derivado: "exempt" cru incluiria o B/L isento depois cancelado.
      OR (lower(btrim(p_charge_status)) NOT IN ('pending', 'issued', 'exempt', 'cancelled')
          AND lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
    )
    AND (NULLIF(btrim(coalesce(p_search, '')), '') IS NULL OR b.id ILIKE '%' || btrim(p_search) || '%' OR b.consignee ILIKE '%' || btrim(p_search) || '%' OR c.name ILIKE '%' || btrim(p_search) || '%' OR c.cnpj_cpf ILIKE '%' || btrim(p_search) || '%')
    AND (
      NULLIF(btrim(coalesce(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND (coalesce(bc.is_imo, false) OR coalesce(bc.is_oog, false))))
      OR (p_cargo_profile = 'imo' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_imo, false)))
      OR (p_cargo_profile = 'oog' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_oog, false)))
    )
)
SELECT jsonb_build_object(
  'totalBls', count(*)::integer,
  'totalDistinctContainers', (SELECT count(DISTINCT upper(btrim(bc.container_number))) FROM public.bl_containers bc JOIN filtered f ON f.id = bc.bl_id WHERE nullif(btrim(bc.container_number), '') IS NOT NULL),
  'pendingReview', count(*) FILTER (WHERE review_status = 'pending_review')::integer,
  'pendingFinancial', count(*) FILTER (WHERE financial_status = 'pending')::integer,
  'chargePending', count(*) FILTER (WHERE public.bl_local_charges_state(charge_status, financial_status, cancelled_at) = 'pending')::integer,
  'chargeIssued', count(*) FILTER (WHERE public.bl_local_charges_state(charge_status, financial_status, cancelled_at) = 'issued')::integer,
  'chargeReady', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'ready_for_billing')::integer,
  'chargeExempt', count(*) FILTER (WHERE public.bl_local_charges_state(charge_status, financial_status, cancelled_at) = 'exempt')::integer,
  'totalMachines', coalesce(sum(bb_machine_qty), 0),
  'totalPackages', coalesce(sum(coalesce(bb_packages_total, bb_packages_qty)), 0),
  'breakbulkWeightTon', coalesce(sum(bb_weight_ton), 0),
  'totalWeightTon', coalesce(sum(coalesce(total_weight_kg, 0) / 1000 + coalesce(bb_weight_ton, 0)), 0),
  'breakbulkCbm', coalesce(sum(bb_cbm), 0),
  -- Somar os dois componentes evita perder a cubagem de conteiner em B/L misto.
  'totalCbm', coalesce(sum(coalesce(total_cbm, 0) + coalesce(bb_cbm, 0)), 0)
)
FROM filtered;
$function$;

REVOKE ALL ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconcile_bl_sem_cliente_perto_eta_alerts(p_voyage_id bigint, p_source text DEFAULT 'bl_sem_cliente_perto_eta'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Decisão P4 (2026-10-21): o alerta abre a 5 dias do ETA da escala.
  v_limit date := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 5;
  v_status text;
  v_scale record;
  v_open text[] := ARRAY[]::text[];
  v_entity text;
BEGIN
  IF p_voyage_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT v.status INTO v_status FROM public.voyages v WHERE v.id = p_voyage_id;

  IF FOUND AND v_status IS DISTINCT FROM 'cancelled' THEN
    FOR v_scale IN
      WITH scales AS (
        SELECT s.port, (s.eta AT TIME ZONE 'America/Sao_Paulo')::date AS eta_day
        FROM public.customer_communication_scale_schedules(p_voyage_id, NULL) s
        WHERE NOT s.deleted
          AND NOT COALESCE(s.omitted, false)
          AND s.eta IS NOT NULL
          AND (s.eta AT TIME ZONE 'America/Sao_Paulo')::date <= v_limit
      )
      SELECT sc.port, sc.eta_day,
        count(*) AS bl_count,
        array_agg(b.id ORDER BY b.id) AS bl_ids,
        jsonb_agg(jsonb_build_object('bl_id', b.id, 'consignee', NULLIF(btrim(b.consignee), '')) ORDER BY b.id) AS bls
      FROM scales sc
      JOIN public.bls b
        ON b.voyage_id = p_voyage_id
       AND b.cancelled_at IS NULL
       AND b.customer_id IS NULL
       AND public.normalize_port_code(b.pod) = sc.port
      GROUP BY sc.port, sc.eta_day
      ORDER BY sc.port
    LOOP
      v_entity := p_voyage_id::text || '::' || v_scale.port;
      -- Viagem concluída: só reavalia a escala que já está no alerta (346).
      CONTINUE WHEN v_status IS DISTINCT FROM 'active' AND NOT EXISTS (
        SELECT 1 FROM public.alert_items i
        JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'bl_sem_cliente_perto_eta' AND i.status = 'active'
          AND a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_entity);
      v_open := array_append(v_open, v_entity);
      PERFORM public.upsert_alert_item(
        'bl_sem_cliente_perto_eta', 'voyage_pod_schedule', v_entity,
        CASE WHEN v_scale.bl_count = 1 THEN '1 B/L sem Cliente' ELSE v_scale.bl_count || ' B/Ls sem Cliente' END
          || ' com ETA em ' || to_char(v_scale.eta_day, 'DD/MM/YYYY') || '.',
        p_source,
        jsonb_build_object(
          'voyage_id', p_voyage_id,
          'port', v_scale.port,
          'eta', v_scale.eta_day::text,
          'deadline_days', 5,
          'bl_ids', to_jsonb(v_scale.bl_ids),
          'bls', v_scale.bls
        ),
        '/revisao?causa=cliente'
      );
    END LOOP;
  END IF;

  -- Escala que saiu do prazo, ficou sem B/L pendente, foi excluída ou omitida,
  -- ou viagem cancelada ou apagada: fecha.
  FOR v_entity IN
    SELECT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'bl_sem_cliente_perto_eta'
      AND i.status = 'active'
      AND a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id LIKE p_voyage_id::text || '::%'
      AND NOT (a.entity_id = ANY (v_open))
  LOOP
    PERFORM public.resolve_alert_item('bl_sem_cliente_perto_eta', 'voyage_pod_schedule', v_entity, p_source, '{}'::jsonb);
  END LOOP;

  RETURN cardinality(v_open);
END;
$function$;
