-- 058: Atualização de operational_list_voyage_summaries para suporte a B/Ls mistos
--
-- Conforme spec docs/spec/2026-09-17-unificacao-bls-carga-mista-design.md:
--   B/L misto possui simultaneamente contêineres e carga solta.
--   Ele deve ser contabilizado em container_bl_count e em breakbulk_bl_count,
--   mantendo bl_count como o total exato de B/Ls únicos da escala/rota.

CREATE OR REPLACE FUNCTION public.operational_list_voyage_summaries(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH visible AS (
  SELECT
    v.id,
    v.voyage_number,
    v.etd,
    v.eta,
    v.ata,
    v.status,
    v.created_at,
    v.vessel_id,
    v.pol_id,
    v.pod_id,
    COUNT(*) OVER () AS total_count
  FROM public.voyages AS v
  WHERE COALESCE(v.status, 'active') IN ('active', 'completed', 'cancelled')
), page AS (
  SELECT *
  FROM visible
  ORDER BY created_at DESC NULLS LAST, id DESC
  OFFSET (GREATEST(COALESCE(p_page, 1), 1) - 1)
    * GREATEST(1, LEAST(COALESCE(p_page_size, 100), 100))
  LIMIT GREATEST(1, LEAST(COALESCE(p_page_size, 100), 100))
), projected AS (
  SELECT
    p.*,
    vessel.name AS vessel_name,
    vessel.imo AS vessel_imo,
    carrier.id AS carrier_id,
    carrier.name AS carrier_name,
    carrier.scac AS carrier_scac,
    pol.name AS pol_name,
    pol.locode AS pol_locode,
    pol.country AS pol_country,
    pod.name AS pod_name,
    pod.locode AS pod_locode,
    pod.country AS pod_country,
    COALESCE(bl_summary.bl_count, 0)::integer AS bl_count,
    COALESCE(bl_summary.container_bl_count, 0)::integer AS container_bl_count,
    COALESCE(bl_summary.breakbulk_bl_count, 0)::integer AS breakbulk_bl_count,
    COALESCE(bl_summary.ce_filled, 0)::integer AS ce_filled,
    COALESCE(bl_summary.ce_total, 0)::integer AS ce_total,
    COALESCE(bl_summary.routes, '[]'::jsonb) AS routes,
    COALESCE(container_summary.container_count, 0)::integer AS container_count,
    COALESCE(baplie_summary.baplie_count, 0)::integer AS baplie_count
  FROM page AS p
  LEFT JOIN public.vessels AS vessel ON vessel.id = p.vessel_id
  LEFT JOIN public.carriers AS carrier ON carrier.id = vessel.carrier_id
  LEFT JOIN public.ports AS pol ON pol.id = p.pol_id
  LEFT JOIN public.ports AS pod ON pod.id = p.pod_id
  LEFT JOIN LATERAL (
    WITH route_rows AS (
      SELECT
        b.pol,
        b.pod,
        COUNT(*)::integer AS bl_count,
        COUNT(*) FILTER (WHERE b.cargo_mode IN ('container', 'misto'))::integer AS container_bl_count,
        COUNT(*) FILTER (WHERE b.cargo_mode IN ('carga_solta', 'misto'))::integer AS breakbulk_bl_count,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(b.ce_mercante, '')), '') IS NOT NULL)::integer AS ce_filled
      FROM public.bls AS b
      WHERE b.voyage_id = p.id
      GROUP BY b.pol, b.pod
    )
    SELECT
      COALESCE(SUM(route_rows.bl_count), 0)::integer AS bl_count,
      COALESCE(SUM(route_rows.container_bl_count), 0)::integer AS container_bl_count,
      COALESCE(SUM(route_rows.breakbulk_bl_count), 0)::integer AS breakbulk_bl_count,
      COALESCE(SUM(route_rows.ce_filled), 0)::integer AS ce_filled,
      COALESCE(SUM(route_rows.bl_count), 0)::integer AS ce_total,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'pol', route_rows.pol,
          'pod', route_rows.pod,
          'blCount', route_rows.bl_count,
          'containerBlCount', route_rows.container_bl_count,
          'breakbulkBlCount', route_rows.breakbulk_bl_count,
          'ceFilled', route_rows.ce_filled,
          'ceTotal', route_rows.bl_count
        )
        ORDER BY route_rows.pol NULLS LAST, route_rows.pod NULLS LAST
      ), '[]'::jsonb) AS routes
    FROM route_rows
  ) AS bl_summary ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT NULLIF(UPPER(BTRIM(bc.container_number)), ''))::integer AS container_count
    FROM public.bl_containers AS bc
    JOIN public.bls AS b ON b.id = bc.bl_id
    WHERE b.voyage_id = p.id
  ) AS container_summary ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS baplie_count
    FROM public.baplie_containers AS baplie
    WHERE baplie.voyage_id = p.id
  ) AS baplie_summary ON true
)
SELECT jsonb_build_object(
  'rows', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', projected.id,
        'voyage_number', projected.voyage_number,
        'etd', projected.etd,
        'eta', projected.eta,
        'ata', projected.ata,
        'status', projected.status,
        'created_at', projected.created_at,
        'vessel', CASE WHEN projected.vessel_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', projected.vessel_id,
          'name', projected.vessel_name,
          'imo', projected.vessel_imo,
          'carrier', CASE WHEN projected.carrier_id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', projected.carrier_id,
            'name', projected.carrier_name,
            'scac', projected.carrier_scac
          ) END
        ) END,
        'pol', CASE WHEN projected.pol_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', projected.pol_id,
          'name', projected.pol_name,
          'locode', projected.pol_locode,
          'country', projected.pol_country
        ) END,
        'pod', CASE WHEN projected.pod_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', projected.pod_id,
          'name', projected.pod_name,
          'locode', projected.pod_locode,
          'country', projected.pod_country
        ) END,
        'blCount', projected.bl_count,
        'containerBlCount', projected.container_bl_count,
        'breakbulkBlCount', projected.breakbulk_bl_count,
        'containerCount', projected.container_count,
        'baplieCount', projected.baplie_count,
        'ceCoverage', jsonb_build_object('filled', projected.ce_filled, 'total', projected.ce_total),
        'routes', projected.routes
      )
      ORDER BY projected.created_at DESC NULLS LAST, projected.id DESC
    )
    FROM projected
  ), '[]'::jsonb),
  'count', COALESCE((SELECT MAX(total_count) FROM visible), 0)
);
$$;

REVOKE ALL ON FUNCTION public.operational_list_voyage_summaries(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operational_list_voyage_summaries(integer, integer) TO authenticated, service_role;

-- 2. Atualizacao de _portal_list_operation_bls_without_transshipment_core para retornar cargo_mode, bb_weight_ton e bb_packages_qty
CREATE OR REPLACE FUNCTION public._portal_list_operation_bls_without_transshipment_core(p_customer_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN (
    WITH active_rates AS (
      SELECT DISTINCT ON (upper(trim(container_type)))
        upper(trim(container_type)) AS container_type,
        free_days
      FROM public.demurrage_rates
      WHERE active = true
        AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
        AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      ORDER BY upper(trim(container_type)), valid_from DESC NULLS LAST, id DESC
    ),
    bl_rows AS (
      SELECT
        b.id AS bl_id,
        b.ce_mercante,
        b.pol,
        b.pod,
        b.voyage_id,
        v.voyage_number,
        vs.name AS vessel_name,
        b.free_time_override,
        b.cargo_mode,
        b.bb_weight_ton,
        b.bb_packages_qty
      FROM public.bls AS b
      LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
      LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
      WHERE b.customer_id = p_customer_id AND public.bl_has_portal_release(b.id)
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bl_id', bl.bl_id,
          'ce_mercante', bl.ce_mercante,
          'pol', bl.pol,
          'pod', bl.pod,
          'voyage_id', bl.voyage_id,
          'voyage_number', bl.voyage_number,
          'vessel_name', bl.vessel_name,
          'container_count', container_summary.container_count,
          'containers_in_demurrage', container_summary.containers_in_demurrage,
          'containers_returned', container_summary.containers_returned,
          'containers', container_summary.containers,
          'cargo_mode', bl.cargo_mode,
          'bb_weight_ton', bl.bb_weight_ton,
          'bb_packages_qty', bl.bb_packages_qty
        )
        ORDER BY bl.voyage_id DESC NULLS LAST, bl.bl_id
      ),
      '[]'::jsonb
    )
    FROM bl_rows AS bl
    LEFT JOIN LATERAL (
      WITH calculated AS (
        SELECT
          c.id,
          c.container_number,
          c.type,
          c.discharge_date,
          c.return_date,
          CASE
            WHEN c.discharge_date IS NULL THEN NULL
            ELSE GREATEST(COALESCE(c.return_date, CURRENT_DATE) - c.discharge_date, 0)
          END AS usage_days,
          CASE
            WHEN c.discharge_date IS NULL THEN NULL
            ELSE COALESCE(
              bl.free_time_override,
              ar.free_days,
              CASE
                WHEN upper(trim(COALESCE(c.type, ''))) IN ('20RF', '20RQ', '20R1', '40RF', '40RQ', '40R1', '45R1')
                  THEN 10
                ELSE 21
              END
            )
          END AS free_time_days
        FROM public.bl_containers AS c
        LEFT JOIN active_rates AS ar
          ON ar.container_type = upper(trim(COALESCE(c.type, '')))
        WHERE c.bl_id = bl.bl_id
      ),
      with_demurrage AS (
        SELECT
          calculated.*,
          CASE
            WHEN usage_days IS NULL OR free_time_days IS NULL THEN NULL
            ELSE GREATEST(usage_days - free_time_days, 0)
          END AS demurrage_days
        FROM calculated
      ),
      with_status AS (
        SELECT
          with_demurrage.*,
          CASE
            WHEN discharge_date IS NULL THEN 'sem_descarga'
            WHEN return_date IS NOT NULL THEN 'devolvido'
            WHEN COALESCE(demurrage_days, 0) > 0 THEN 'em_demurrage'
            ELSE 'dentro_free_time'
          END AS status
        FROM with_demurrage
      )
      SELECT
        COUNT(*)::int AS container_count,
        COUNT(*) FILTER (WHERE status = 'em_demurrage')::int AS containers_in_demurrage,
        COUNT(*) FILTER (WHERE status = 'devolvido')::int AS containers_returned,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', id,
              'container_number', container_number,
              'type', type,
              'discharge_date', discharge_date,
              'return_date', return_date,
              'usage_days', usage_days,
              'free_time_days', free_time_days,
              'demurrage_days', demurrage_days,
              'status', status
            )
            ORDER BY container_number
          ),
          '[]'::jsonb
        ) AS containers
      FROM with_status
    ) AS container_summary ON true
  );
END;
$$;

REVOKE ALL ON FUNCTION public._portal_list_operation_bls_without_transshipment_core(bigint) FROM PUBLIC, anon, authenticated;
