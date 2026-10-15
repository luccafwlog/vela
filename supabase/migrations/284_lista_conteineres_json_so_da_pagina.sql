-- 284: a página da lista de contêineres monta o JSON só das linhas exibidas.
--
-- Problema (medição local com 28 mil contêineres): `operational_list_containers`
-- ordenava a página por `row_json->>'created_at'`. Para ordenar, o Postgres
-- montava o JSON (contêiner, B/L, cliente, viagem, navio, armador) de todas as
-- linhas filtradas e só então guardava as 20 da página: ~3,1 s por chamada.
-- Cada "Próxima" pagava o mesmo custo.
--
-- Mudança: a página escolhe os ids em `filtered` pela mesma ordem
-- (`created_at` desc, `id` desc; o texto ISO do JSON ordena igual ao timestamp)
-- e só essas linhas passam pelos joins e pelo JSON. Contagens, resumo por tipo e
-- formato da resposta não mudam. Saída idêntica (md5) na primeira página, na
-- página 9 de 100, com busca e com filtro de viagem; ~0,87 s por chamada.
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 059.

CREATE OR REPLACE FUNCTION public.operational_list_containers(p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_search text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_cargo_mode text DEFAULT NULL::text, p_pol text DEFAULT NULL::text, p_pod text DEFAULT NULL::text, p_review_status text DEFAULT NULL::text, p_financial_status text DEFAULT NULL::text, p_charge_status text DEFAULT NULL::text, p_cargo_profile text DEFAULT NULL::text, p_container_type text DEFAULT NULL::text, p_vehicle_container boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH filtered AS (
  SELECT bc.*, b.id AS bl_key, b.pol, b.pod, b.review_status, b.financial_status,
    b.charge_status, b.consignee, b.customer_id, b.voyage_id,
    c.name AS customer_name, c.cnpj_cpf AS customer_cnpj,
    v.voyage_number, v.eta, v.ata, v.status AS voyage_status,
    vs.id AS vessel_id, vs.name AS vessel_name, vs.imo AS vessel_imo,
    cr.name AS carrier_name, cr.scac AS carrier_scac, COUNT(*) OVER () AS total_count
  FROM public.bl_containers bc
  JOIN public.bls b ON b.id = bc.bl_id
  LEFT JOIN public.customers c ON c.id = b.customer_id
  LEFT JOIN public.voyages v ON v.id = b.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || btrim(p_pol) || '%')
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || btrim(p_pod) || '%')
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL OR lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
    AND (NULLIF(btrim(coalesce(p_container_type, '')), '') IS NULL OR upper(btrim(coalesce(bc.type, ''))) = upper(btrim(p_container_type)))
    AND (
      NULLIF(btrim(coalesce(p_search, '')), '') IS NULL
      OR bc.container_number ILIKE '%' || btrim(p_search) || '%'
      OR bc.seal_number ILIKE '%' || btrim(p_search) || '%'
      OR bc.type ILIKE '%' || btrim(p_search) || '%'
      OR bc.imo_class ILIKE '%' || btrim(p_search) || '%'
      OR bc.un_number ILIKE '%' || btrim(p_search) || '%'
      OR b.id ILIKE '%' || btrim(p_search) || '%'
      OR b.consignee ILIKE '%' || btrim(p_search) || '%'
      OR c.name ILIKE '%' || btrim(p_search) || '%'
      OR c.cnpj_cpf ILIKE '%' || btrim(p_search) || '%'
      OR vs.name ILIKE '%' || btrim(p_search) || '%'
      OR cr.name ILIKE '%' || btrim(p_search) || '%'
    )
    AND (
      NULLIF(btrim(coalesce(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT (coalesce(bc.is_imo, false) OR coalesce(bc.is_oog, false)))
      OR (p_cargo_profile = 'imo' AND coalesce(bc.is_imo, false))
      OR (p_cargo_profile = 'oog' AND coalesce(bc.is_oog, false))
    )
    AND (
      p_vehicle_container IS NULL
      OR (p_vehicle_container = true AND EXISTS (SELECT 1 FROM public.vehicles vh WHERE vh.container_id = bc.id))
      OR (p_vehicle_container = false AND NOT EXISTS (SELECT 1 FROM public.vehicles vh WHERE vh.container_id = bc.id))
    )
), projected AS (
  SELECT f.*, to_jsonb(f) - ARRAY[
    'bl_key','pol','pod','review_status','financial_status','charge_status','consignee','customer_id','voyage_id',
    'customer_name','customer_cnpj','voyage_number','eta','ata','voyage_status','vessel_id','vessel_name','vessel_imo',
    'carrier_name','carrier_scac','total_count'
  ]::text[] || jsonb_build_object(
    'bl', jsonb_build_object(
      'id', f.bl_key, 'pol', f.pol, 'pod', f.pod, 'review_status', f.review_status,
      'financial_status', f.financial_status, 'charge_status', f.charge_status, 'consignee', f.consignee,
      'customer', CASE WHEN f.customer_id IS NULL THEN NULL ELSE jsonb_build_object('id', f.customer_id, 'cnpj_cpf', f.customer_cnpj, 'name', f.customer_name) END,
      'voyage', CASE WHEN f.voyage_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', f.voyage_id, 'voyage_number', f.voyage_number, 'eta', f.eta, 'ata', f.ata, 'status', f.voyage_status,
        'vessel', CASE WHEN f.vessel_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', f.vessel_id, 'name', f.vessel_name, 'imo', f.vessel_imo,
          'carrier', CASE WHEN cr.id IS NULL THEN NULL ELSE jsonb_build_object('id', cr.id, 'name', f.carrier_name, 'scac', f.carrier_scac) END
        ) END
      ) END
    )
  ) AS row_json
  FROM filtered f
  LEFT JOIN public.voyages v ON v.id = f.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
), page AS (
  SELECT * FROM projected
  WHERE id IN (
    SELECT id FROM filtered
    ORDER BY created_at DESC NULLS LAST, id DESC
    OFFSET (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_page_size, 50), 100))
    LIMIT greatest(1, least(coalesce(p_page_size, 50), 100))
  )
), type_summary AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', type_label, 'distinctCount', distinct_count) ORDER BY distinct_count DESC, type_label), '[]'::jsonb) AS value
  FROM (
    SELECT coalesce(nullif(btrim(type), ''), 'Nao informado') AS type_label,
      count(DISTINCT upper(btrim(container_number))) FILTER (WHERE nullif(btrim(container_number), '') IS NOT NULL) AS distinct_count
    FROM filtered GROUP BY coalesce(nullif(btrim(type), ''), 'Nao informado')
  ) grouped_types
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(row_json ORDER BY (row_json->>'created_at') DESC NULLS LAST, (row_json->>'id')::bigint DESC) FROM page), '[]'::jsonb),
  'count', coalesce((SELECT max(total_count) FROM filtered), 0),
  'distinctCount', (SELECT count(DISTINCT upper(btrim(container_number))) FROM filtered WHERE nullif(btrim(container_number), '') IS NOT NULL),
  'oogDistinctCount', (SELECT count(DISTINCT upper(btrim(container_number))) FROM filtered WHERE coalesce(is_oog, false) AND nullif(btrim(container_number), '') IS NOT NULL),
  'imoDistinctCount', (SELECT count(DISTINCT upper(btrim(container_number))) FROM filtered WHERE coalesce(is_imo, false) AND nullif(btrim(container_number), '') IS NOT NULL),
  'blCount', (SELECT count(DISTINCT bl_key) FROM filtered),
  'typeSummary', (SELECT value FROM type_summary)
);
$function$;
