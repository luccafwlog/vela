-- Correções da revisão extensa da Central de Informações.
-- Valores de faturas/snapshots existentes não são alterados.
-- Reversão operacional: despublicar o cadastro.

CREATE FUNCTION public._demurrage_canonical_type(p_type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO public,pg_temp AS $$
SELECT CASE upper(trim(COALESCE(p_type, '')))
        WHEN '20GP' THEN '20GP'
        WHEN '20G0' THEN '20GP'
        WHEN '20HC' THEN '20GP'
        WHEN '20HQ' THEN '20GP'
        WHEN '22G1' THEN '20GP'
        WHEN '20G1' THEN '20GP'
        WHEN '40GP' THEN '40GP'
        WHEN '40G0' THEN '40GP'
        WHEN '40HC' THEN '40GP'
        WHEN '40HQ' THEN '40GP'
        WHEN '40G1' THEN '40GP'
        WHEN '42G1' THEN '40GP'
        WHEN '45G1' THEN '40GP'
        WHEN '20FR' THEN '20FR'
        WHEN '20OT' THEN '20FR'
        WHEN '20FT' THEN '20FR'
        WHEN '40FR' THEN '40FR'
        WHEN '40OT' THEN '40FR'
        WHEN '40FT' THEN '40FR'
        WHEN '20RF' THEN '20RF'
        WHEN '20RQ' THEN '20RF'
        WHEN '20R1' THEN '20RF'
        WHEN '40RF' THEN '40RF'
        WHEN '40RQ' THEN '40RF'
        WHEN '40R1' THEN '40RF'
        WHEN '45R1' THEN '40RF'
        ELSE upper(trim(COALESCE(p_type, '')))
      END;
$$;
REVOKE ALL ON FUNCTION public._demurrage_canonical_type(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public._active_demurrage_rates(p_date date) RETURNS SETOF public.demurrage_rates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public,pg_temp AS $$
  SELECT DISTINCT ON(public._demurrage_canonical_type(r.container_type)) r.*
  FROM public.demurrage_rates r WHERE r.active AND r.valid_from<=p_date AND (r.valid_to IS NULL OR r.valid_to>=p_date)
  ORDER BY public._demurrage_canonical_type(r.container_type),r.valid_from DESC,r.id DESC;
$$;
REVOKE ALL ON FUNCTION public._active_demurrage_rates(date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._portal_information_core(p_internal boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
SELECT jsonb_build_object(
  'depots', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', d.id, 'code', d.code, 'name', COALESCE(d.name,d.code), 'active', d.active,
    'ports', COALESCE(i.ports,'{}'::text[]), 'address', COALESCE(i.address,''),
    'opening_hours', COALESCE(i.opening_hours,''), 'emails', COALESCE(i.emails,'{}'::text[]),
    'phones', COALESCE(i.phones,'{}'::text[]), 'scheduling_url', i.scheduling_url,
    'instructions', COALESCE(i.instructions,''), 'restrictions', COALESCE(i.restrictions,''),
    'published', COALESCE(i.published,false), 'updated_at', i.updated_at
  ) ORDER BY d.code) FROM public.depots d LEFT JOIN public.depot_portal_information i ON i.depot_id=d.id
    WHERE d.tipo='depot' AND (p_internal OR (d.active AND i.published))), '[]'::jsonb),
  'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'ports',a.ports,'emails',a.emails,'active',a.active) ORDER BY a.name)
    FROM public.port_agents a WHERE p_internal OR a.active), '[]'::jsonb),
  'contacts', COALESCE((SELECT jsonb_agg(jsonb_build_object('key',c.key,'title',c.title,'description',c.description,'emails',c.emails,'phones',c.phones,'whatsapp',c.whatsapp,'address',c.address,'active',c.active) ORDER BY c.key)
    FROM public.portal_information_contacts c WHERE p_internal OR c.active), '[]'::jsonb),
  'carriers', COALESCE((SELECT jsonb_agg(jsonb_build_object('carrier_id',c.id,'name',c.name,'tracking_url',i.tracking_url) ORDER BY c.name)
    FROM public.carriers c LEFT JOIN public.carrier_portal_information i ON i.carrier_id=c.id WHERE p_internal OR i.tracking_url IS NOT NULL), '[]'::jsonb),
  'local_tables', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'pod',public.normalize_port_code(t.pod),'cargo_mode',t.cargo_mode,'valid_from',t.valid_from,'valid_to',t.valid_to,
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'currency',COALESCE(i.currency,'BRL'),'unit_value_brl',i.unit_value_brl,'unit_value_usd',i.unit_value_usd,
       'application_basis',i.application_basis,'cargo_profile',i.cargo_profile,'manual_only',i.manual_only,'applies_to_soc',i.applies_to_soc) ORDER BY i.sort_order,i.id)
      FROM public.charge_table_items i WHERE i.charge_table_id=t.id AND i.active), '[]'::jsonb)) ORDER BY t.pod,t.cargo_mode)
    FROM public.charge_tables t WHERE t.active AND t.id=public.resolve_local_charge_table_id(t.cargo_mode,t.pod)), '[]'::jsonb),
  'demurrage_rates', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'container_type',public._demurrage_canonical_type(r.container_type),'free_days',r.free_days,'p1_day_from',r.p1_day_from,'p1_day_to',r.p1_day_to,
    'p1_usd',r.p1_usd,'p2_day_from',r.p2_day_from,'p2_usd',r.p2_usd,'valid_from',r.valid_from,'valid_to',r.valid_to) ORDER BY r.container_type)
    FROM public._active_demurrage_rates(CURRENT_DATE) r), '[]'::jsonb),
  'demurrage_notes', COALESCE((SELECT demurrage_notes FROM public.portal_information_settings WHERE id=1),''),
  'ports', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',p.code,'name',p.name) ORDER BY p.name) FROM (
    SELECT DISTINCT ON (code) code,name FROM (
      SELECT public.normalize_port_code(locode) code,COALESCE(name,locode) name,0 priority FROM public.ports WHERE locode LIKE 'BR%'
      UNION ALL SELECT unnest(i.ports),unnest(i.ports),1 FROM public.depot_portal_information i JOIN public.depots d ON d.id=i.depot_id WHERE p_internal OR (d.active AND i.published)
      UNION ALL SELECT unnest(ports),unnest(ports),1 FROM public.port_agents WHERE p_internal OR active
    ) x WHERE code IS NOT NULL ORDER BY code,priority
  ) p), '[]'::jsonb)
);
$$;


CREATE OR REPLACE FUNCTION public._portal_list_operation_bls_without_transshipment_core(p_customer_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN (
    WITH active_rates AS (
      SELECT public._demurrage_canonical_type(r.container_type) container_type,r.free_days
      FROM public._active_demurrage_rates(CURRENT_DATE) r
    ),
    bl_rows AS (
      SELECT
        b.id AS bl_id,
        b.customer_id,
        vs.carrier_id,
        carrier.name AS carrier_name,
        tracking.tracking_url,
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
      LEFT JOIN public.carriers carrier ON carrier.id=vs.carrier_id
      LEFT JOIN public.carrier_portal_information tracking ON tracking.carrier_id=carrier.id
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
          'carrier_id',bl.carrier_id,'carrier_name',bl.carrier_name,'tracking_url',bl.tracking_url,
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
          c.ownership,
          c.discharge_date,
          c.return_date,
          CASE
            WHEN c.discharge_date IS NULL OR upper(COALESCE(c.ownership,''))='SOC' THEN NULL
            ELSE GREATEST(COALESCE(c.return_date, CURRENT_DATE) - c.discharge_date, 0)
          END AS usage_days,
          CASE
            WHEN c.discharge_date IS NULL OR upper(COALESCE(c.ownership,''))='SOC' THEN NULL
            ELSE COALESCE(bl.free_time_override,agreement.free_days,ar.free_days)
          END AS free_time_days
        FROM public.bl_containers AS c
        LEFT JOIN active_rates AS ar
          ON ar.container_type = public._demurrage_canonical_type(c.type)
        LEFT JOIN LATERAL (
          SELECT a.free_days FROM public.customer_demurrage_agreements a
          WHERE a.customer_id=bl.customer_id AND a.active AND c.discharge_date>=a.valid_from
            AND (a.valid_to IS NULL OR c.discharge_date<=a.valid_to)
          ORDER BY a.valid_from DESC,a.id DESC LIMIT 1
        ) agreement ON true
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
            WHEN upper(COALESCE(ownership,''))='SOC' THEN 'soc'
            WHEN discharge_date IS NULL THEN 'sem_descarga'
            WHEN return_date IS NOT NULL THEN 'devolvido'
            WHEN free_time_days IS NULL THEN 'tarifa_indisponivel'
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

CREATE OR REPLACE FUNCTION public._calculate_demurrage_invoice_authoritative(
  p_bl_id text,
  p_container_ids bigint[],
  p_calculation_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requested_count integer := COALESCE(array_length(p_container_ids, 1), 0);
  v_distinct_count integer;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(p_bl_id), '') IS NULL
     OR v_requested_count = 0
     OR p_calculation_date IS NULL THEN
    RAISE EXCEPTION 'B/L, containers e data de cálculo são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.id)::integer
    INTO v_distinct_count
  FROM unnest(p_container_ids) AS requested(id);
  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'A emissão de Demurrage não aceita container duplicado.' USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT requested.id
    FROM unnest(p_container_ids) AS requested(id)
  ), base AS (
    SELECT
      container.id,
      container.bl_id,
      container.container_number,
      container.type,
      container.discharge_date,
      container.return_date,
      container.demurrage_status,
      bl.customer_id,
      bl.free_time_override,
      bl.demurrage_rate_override_p1_usd,
      bl.demurrage_rate_override_p2_usd,
      public._demurrage_canonical_type(container.type) AS canonical_type
    FROM requested
    LEFT JOIN public.bl_containers AS container
      ON container.id = requested.id
     AND container.bl_id = p_bl_id
    LEFT JOIN public.bls AS bl ON bl.id = container.bl_id
  ), resolved AS (
    SELECT
      base.*,
      rate.free_days AS table_free_days,
      rate.p1_day_to,
      rate.p1_usd AS table_p1_usd,
      rate.p2_day_from,
      rate.p2_usd AS table_p2_usd,
      agreement.free_days AS agreement_free_days,
      agreement.p1_usd AS agreement_p1_usd,
      agreement.p2_usd AS agreement_p2_usd
    FROM base
    LEFT JOIN LATERAL (
      SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
      FROM public._active_demurrage_rates(p_calculation_date) AS r
      WHERE r.active = true
        AND r.valid_from <= p_calculation_date
        AND (r.valid_to IS NULL OR r.valid_to >= p_calculation_date)
        AND public._demurrage_canonical_type(r.container_type) = base.canonical_type
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1
    ) AS rate ON true
    LEFT JOIN LATERAL (
      SELECT a.free_days, a.p1_usd, a.p2_usd
      FROM public.customer_demurrage_agreements AS a
      WHERE a.customer_id = base.customer_id
        AND a.active = true
        AND base.discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR base.discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1
    ) AS agreement ON true
  ), calculated AS (
    SELECT
      resolved.*,
      (resolved.return_date - resolved.discharge_date)::integer AS total_days,
      COALESCE(resolved.free_time_override, resolved.agreement_free_days, resolved.table_free_days) AS free_days,
      COALESCE(resolved.demurrage_rate_override_p1_usd, resolved.agreement_p1_usd, resolved.table_p1_usd) AS rate_p1_usd,
      COALESCE(resolved.demurrage_rate_override_p2_usd, resolved.agreement_p2_usd, resolved.table_p2_usd) AS rate_p2_usd
    FROM resolved
  ), valued AS (
    SELECT
      calculated.*,
      GREATEST(0, LEAST(calculated.total_days, calculated.p1_day_to) - calculated.free_days)::integer AS days_p1,
      GREATEST(
        0,
        calculated.total_days - GREATEST(calculated.p2_day_from, calculated.free_days + 1) + 1
      )::integer AS days_p2
    FROM calculated
  ), totals AS (
    SELECT
      valued.*,
      round(valued.days_p1 * valued.rate_p1_usd + valued.days_p2 * valued.rate_p2_usd, 2) AS subtotal_usd,
      (
        valued.id IS NULL
        OR valued.bl_id IS NULL
        OR valued.demurrage_status NOT IN ('overdue', 'returned')
        OR valued.discharge_date IS NULL
        OR valued.return_date IS NULL
        OR valued.return_date < valued.discharge_date
        OR valued.total_days < 0
        OR valued.free_days IS NULL
        OR valued.free_days < 0
        OR valued.p1_day_to IS NULL
        OR valued.p2_day_from IS NULL
        OR valued.rate_p1_usd IS NULL
        OR valued.rate_p2_usd IS NULL
        OR valued.rate_p1_usd < 0
        OR valued.rate_p2_usd < 0
      ) AS invalid
    FROM valued
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'container_id', totals.id,
          'container_number', totals.container_number,
          'container_type', totals.type,
          'discharge_date', totals.discharge_date,
          'return_date', totals.return_date,
          'total_days', totals.total_days,
          'free_days', totals.free_days,
          'days_p1', totals.days_p1,
          'rate_p1_usd', totals.rate_p1_usd,
          'days_p2', totals.days_p2,
          'rate_p2_usd', totals.rate_p2_usd,
          'subtotal_usd', totals.subtotal_usd
        ) ORDER BY totals.id
      ) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd > 0),
      '[]'::jsonb
    ),
    'total_usd', COALESCE(sum(totals.subtotal_usd) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd > 0), 0),
    'ready_at', CASE WHEN bool_and(totals.return_date IS NOT NULL) THEN max(totals.return_date) ELSE NULL END,
    'requested_count', count(*)::integer,
    'calculated_count', count(*) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd > 0)::integer,
    'invalid_count', count(*) FILTER (WHERE totals.invalid)::integer
  )
    INTO v_result
  FROM totals;

  IF COALESCE((v_result->>'requested_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Um ou mais containers não pertencem ao B/L informado.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'invalid_count')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'Dados insuficientes ou tarifa inválida para calcular a Demurrage.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'calculated_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Nenhum container faturável ou conjunto de containers desatualizado.' USING ERRCODE = '22023';
  END IF;

  RETURN v_result;
END;
$$;

-- A API não pode armazenar links que o navegador necessariamente rejeitará.
CREATE FUNCTION public._portal_information_valid_url(p_url text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO public,pg_temp AS $$
DECLARE parts text[]; authority text; host text; port text; address inet;
BEGIN
  IF p_url IS NULL THEN RETURN true; END IF;
  parts:=regexp_match(btrim(p_url),'^https?://([^/?#[:space:]]+)([/?#][^[:space:]]*)?$','i');
  IF parts IS NULL THEN RETURN false; END IF;
  authority:=parts[1];
  IF left(authority,1)='[' THEN
    parts:=regexp_match(authority,'^[[]([0-9a-f:.]+)[]](:([0-9]{1,5}))?$','i');
    IF parts IS NULL THEN RETURN false; END IF;
    host:=parts[1]; port:=parts[3]; address:=host::inet;
    IF family(address)<>6 THEN RETURN false; END IF;
  ELSE
    parts:=regexp_match(authority,'^([[:alnum:]_.-]+)(:([0-9]{1,5}))?$');
    IF parts IS NULL THEN RETURN false; END IF;
    host:=parts[1]; port:=parts[3];
    IF host ~ '^[0-9.]+$' THEN address:=host::inet; END IF;
  END IF;
  RETURN port IS NULL OR port::integer<=65535;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._portal_information_valid_url(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._portal_information_valid_url(text) TO service_role;
ALTER TABLE public.depot_portal_information ADD CONSTRAINT depot_portal_valid_host CHECK(public._portal_information_valid_url(scheduling_url));
ALTER TABLE public.carrier_portal_information ADD CONSTRAINT carrier_tracking_valid_host CHECK(public._portal_information_valid_url(tracking_url));
ALTER TABLE public.portal_information_contacts ADD CONSTRAINT portal_whatsapp_valid_host CHECK(public._portal_information_valid_url(whatsapp));
