-- 063: operational_bl_summary - separação explícita de peso breakbulk vs total
--
-- Separa a contagem de peso de carga solta (bb_weight_ton) da contagem
-- consolidada (totalWeightTon = containers + carga solta) no retorno da RPC
-- operational_list_bl_summary. Isso permite que a interface exiba no card
-- "Carga Solta" estritamente as toneladas de carga solta, eliminando a
-- exibição indevida do peso de contêineres quando filtrados B/Ls de contêiner.

CREATE OR REPLACE FUNCTION public.operational_list_bl_summary(
  p_search text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_cargo_mode text DEFAULT NULL::text,
  p_pol text DEFAULT NULL::text,
  p_pod text DEFAULT NULL::text,
  p_review_status text DEFAULT NULL::text,
  p_financial_status text DEFAULT NULL::text,
  p_charge_status text DEFAULT NULL::text,
  p_cargo_profile text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
WITH filtered AS (
  SELECT b.*
  FROM public.bls b
  LEFT JOIN public.customers c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || btrim(p_pol) || '%')
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || btrim(p_pod) || '%')
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL OR lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
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
  'chargePending', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) IN ('review_required', 'not_calculated'))::integer,
  'chargeReady', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'ready_for_billing')::integer,
  'chargeExempt', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'exempt')::integer,
  'totalMachines', coalesce(sum(bb_machine_qty), 0),
  'totalPackages', coalesce(sum(coalesce(bb_packages_total, bb_packages_qty)), 0),
  'breakbulkWeightTon', coalesce(sum(bb_weight_ton), 0),
  -- Somar os dois componentes evita perder o peso de contêiner em B/L misto.
  'totalWeightTon', coalesce(sum(coalesce(total_weight_kg, 0) / 1000 + coalesce(bb_weight_ton, 0)), 0),
  'totalCbm', coalesce(sum(total_cbm), 0)
)
FROM filtered;
$function$;

REVOKE ALL ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) TO authenticated, service_role;
