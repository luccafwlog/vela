-- Correções da revisão extensa da Central de Informações.
-- Indicações pertencem à unidade física na viagem; não acompanham o registro
-- quando seu número/viagem muda. A tabela antiga permanece como histórico.
-- Valores de faturas/snapshots existentes não são alterados.
-- Reversão operacional: retirar indicação pela RPC e despublicar o cadastro.

CREATE TABLE public.container_return_instruction_groups (
  voyage_id bigint NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  container_number text NOT NULL CHECK (container_number<>'' AND container_number=upper(btrim(container_number))),
  depot_ids uuid[] NOT NULL CHECK (cardinality(depot_ids)>0 AND array_position(depot_ids,NULL) IS NULL),
  reason text NOT NULL CHECK (btrim(reason)<>''),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY(voyage_id,container_number)
);
ALTER TABLE public.container_return_instruction_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.container_return_instruction_groups FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.container_return_instruction_groups TO authenticated;
GRANT ALL ON public.container_return_instruction_groups TO service_role;
CREATE POLICY internal_instruction_group_read ON public.container_return_instruction_groups FOR SELECT TO authenticated USING(public.is_active_read_user());
INSERT INTO public.container_return_instruction_groups(voyage_id,container_number,depot_ids,reason,updated_at,updated_by)
SELECT DISTINCT ON(b.voyage_id,upper(btrim(c.container_number))) b.voyage_id,upper(btrim(c.container_number)),i.depot_ids,i.reason,i.updated_at,i.updated_by
FROM public.container_return_instructions i JOIN public.bl_containers c ON c.id=i.container_id JOIN public.bls b ON b.id=c.bl_id
ORDER BY b.voyage_id,upper(btrim(c.container_number)),i.updated_at DESC,i.container_id DESC;
COMMENT ON TABLE public.container_return_instructions IS 'Histórico do modelo inicial por registro; a fonte atual é container_return_instruction_groups.';

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

-- Consultar devolução não depende dos cadastros financeiros ou de contatos.
CREATE OR REPLACE FUNCTION public._container_return_guidance_core(p_container_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE c record; instruction public.container_return_instruction_groups%ROWTYPE; result jsonb; status text;
BEGIN
  SELECT bc.id,bc.container_number,bc.return_date,bc.ownership,bc.bl_id,b.pod,b.voyage_id INTO c
  FROM public.bl_containers bc JOIN public.bls b ON b.id=bc.bl_id WHERE bc.id=p_container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Container não disponível para consulta.' USING ERRCODE='42501'; END IF;
  SELECT g.* INTO instruction FROM public.container_return_instruction_groups g
  WHERE g.voyage_id=c.voyage_id AND g.container_number=upper(btrim(c.container_number));
  status:=CASE WHEN upper(COALESCE(c.ownership,''))='SOC' THEN 'soc' WHEN instruction.voyage_id IS NOT NULL THEN 'specific' ELSE 'general' END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',d.id,'code',d.code,'name',COALESCE(d.name,d.code),'active',d.active,
    'ports',i.ports,'address',i.address,'opening_hours',i.opening_hours,'emails',i.emails,'phones',i.phones,
    'scheduling_url',i.scheduling_url,'instructions',i.instructions,'restrictions',i.restrictions,
    'published',i.published,'updated_at',i.updated_at) ORDER BY d.code),'[]'::jsonb) INTO result
  FROM public.depots d JOIN public.depot_portal_information i ON i.depot_id=d.id
  WHERE d.tipo='depot' AND d.active AND i.published AND public.normalize_port_code(c.pod)=ANY(i.ports)
    AND status<>'soc' AND (status='general' OR d.id=ANY(instruction.depot_ids));
  IF status='specific' AND jsonb_array_length(result)=0 THEN status:='unavailable'; END IF;
  RETURN jsonb_build_object('container_id',c.id,'container_number',c.container_number,'bl_id',c.bl_id,
    'pod',public.normalize_port_code(c.pod),'return_date',c.return_date,'status',status,'depots',result,'updated_at',instruction.updated_at);
END $$;

CREATE OR REPLACE FUNCTION public.internal_get_return_guidance(p_container_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public,pg_temp AS $$
BEGIN
  IF NOT public.is_active_read_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501'; END IF;
  RETURN public._container_return_guidance_core(p_container_id) || jsonb_build_object('reason',COALESCE((
    SELECT g.reason FROM public.bl_containers c JOIN public.bls b ON b.id=c.bl_id
    JOIN public.container_return_instruction_groups g ON g.voyage_id=b.voyage_id AND g.container_number=upper(btrim(c.container_number))
    WHERE c.id=p_container_id),''));
END $$;

CREATE OR REPLACE FUNCTION public.set_container_return_instruction(p_container_id bigint,p_depot_ids uuid[],p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE original record; current_unit record; depot_ids uuid[]; before_state jsonb;
BEGIN
  IF NOT public.is_active_read_user() OR COALESCE(public._portal_actor_role(),'') NOT IN ('administrativo','equipamentos') THEN
    RAISE EXCEPTION 'Sem permissão para indicar devolução.' USING ERRCODE='42501';
  END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe a justificativa da alteração.' USING ERRCODE='22023'; END IF;
  IF array_position(p_depot_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Selecione depots válidos.' USING ERRCODE='22023'; END IF;
  SELECT bc.id,bc.container_number,bc.ownership,bc.bl_id,b.pod,b.voyage_id INTO original
  FROM public.bl_containers bc JOIN public.bls b ON b.id=bc.bl_id WHERE bc.id=p_container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Container inexistente.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(original.voyage_id::text||':'||upper(btrim(original.container_number)),0));
  -- Sempre a mesma ordem, antes de validar: edições simultâneas de rota/carga
  -- não podem fazer a orientação usar a identidade anterior da unidade.
  PERFORM b.id FROM public.bls b WHERE b.id=original.bl_id OR (b.voyage_id=original.voyage_id AND EXISTS(
    SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id=b.id AND upper(btrim(bc.container_number))=upper(btrim(original.container_number))))
  ORDER BY b.id FOR UPDATE OF b;
  PERFORM bc.id FROM public.bl_containers bc JOIN public.bls b ON b.id=bc.bl_id
  WHERE bc.id=p_container_id OR (b.voyage_id=original.voyage_id AND upper(btrim(bc.container_number))=upper(btrim(original.container_number)))
  ORDER BY bc.id FOR UPDATE OF bc;
  SELECT bc.id,bc.container_number,bc.ownership,bc.bl_id,b.pod,b.voyage_id INTO current_unit
  FROM public.bl_containers bc JOIN public.bls b ON b.id=bc.bl_id WHERE bc.id=p_container_id;
  IF NOT FOUND OR current_unit IS DISTINCT FROM original THEN
    RAISE EXCEPTION 'A operação do container mudou. Atualize a orientação e tente novamente.' USING ERRCODE='40001';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT selected.id),'{}'::uuid[]) INTO depot_ids FROM unnest(COALESCE(p_depot_ids,'{}'::uuid[])) selected(id);
  IF cardinality(depot_ids)>0 THEN
    IF public.normalize_port_code(current_unit.pod) IS NULL THEN RAISE EXCEPTION 'Informe o porto de destino antes de indicar devolução.' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.bl_containers bc JOIN public.bls b ON b.id=bc.bl_id
      WHERE b.voyage_id=current_unit.voyage_id AND upper(btrim(bc.container_number))=upper(btrim(current_unit.container_number))
        AND (upper(COALESCE(bc.ownership,''))='SOC' OR public.normalize_port_code(b.pod) IS DISTINCT FROM public.normalize_port_code(current_unit.pod))) THEN
      RAISE EXCEPTION 'A unidade compartilhada tem SOC ou portos de destino divergentes. Ajuste os B/Ls antes de indicar devolução.' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM unnest(depot_ids) selected(id) LEFT JOIN public.depots d ON d.id=selected.id
      LEFT JOIN public.depot_portal_information i ON i.depot_id=d.id
      WHERE d.id IS NULL OR NOT d.active OR d.tipo<>'depot' OR NOT COALESCE(i.published,false)
        OR (public.normalize_port_code(current_unit.pod)=ANY(i.ports)) IS DISTINCT FROM true) THEN
      RAISE EXCEPTION 'Selecione depots ativos e publicados no porto de destino.' USING ERRCODE='22023';
    END IF;
  END IF;
  SELECT to_jsonb(g) INTO before_state FROM public.container_return_instruction_groups g
  WHERE g.voyage_id=current_unit.voyage_id AND g.container_number=upper(btrim(current_unit.container_number));
  IF cardinality(depot_ids)=0 THEN
    DELETE FROM public.container_return_instruction_groups g WHERE g.voyage_id=current_unit.voyage_id AND g.container_number=upper(btrim(current_unit.container_number));
  ELSE
    INSERT INTO public.container_return_instruction_groups(voyage_id,container_number,depot_ids,reason,updated_by)
    VALUES(current_unit.voyage_id,upper(btrim(current_unit.container_number)),depot_ids,btrim(p_reason),auth.uid())
    ON CONFLICT(voyage_id,container_number) DO UPDATE SET depot_ids=EXCLUDED.depot_ids,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
  END IF;
  INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_by,justification)
  VALUES('container_return_instruction',p_container_id::text,'depot_ids',before_state::text,
    jsonb_build_object('voyage_id',current_unit.voyage_id,'container_number',upper(btrim(current_unit.container_number)),'depot_ids',depot_ids)::text,auth.uid(),btrim(p_reason));
END $$;

-- A guarda de exclusão exige catálogo explícito de cada dependência.
CREATE OR REPLACE FUNCTION public.voyage_delete_children_spec()
RETURNS TABLE(ord integer, table_name text, column_name text, action text, label text)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  VALUES
    (1, 'vehicles', 'voyage_id', 'delete', 'veículo(s)'),
    (2, 'bls', 'voyage_id', 'delete', 'B/L(s), com containers e taxas'),
    (3, 'import_batches', 'voyage_id', 'delete', 'importação(ões) de manifesto'),
    (4, 'manifestos_mercante', 'voyage_id', 'delete', 'Manifesto(s) Mercante'),
    (5, 'voyage_route_ce_master', 'voyage_id', 'delete', 'CE Master por rota'),
    (6, 'baplie_reconciliation_resolutions', 'voyage_id', 'delete', 'resolução(ões) de BAPLIE'),
    (7, 'baplie_containers', 'voyage_id', 'delete', 'container(es) do BAPLIE'),
    (8, 'agency_departure_reports', 'voyage_id', 'delete', 'ADR(s) de Saída em aberto'),
    (9, 'vazios_bookings', 'voyage_id', 'delete', 'unidade(s) de vazios'),
    (10, 'vazios_export_operations', 'voyage_id', 'delete', 'operação(ões) de embarque de vazios'),
    (11, 'voyage_omissions', 'voyage_id', 'delete', 'omissão(ões) de escala e transbordo'),
    (12, 'voyage_escala_terminal_state', 'voyage_id', 'delete', 'atracação(ões)'),
    (13, 'voyage_escala_operation_fronts', 'voyage_id', 'delete', 'frente(s) de operação'),
    (14, 'voyage_escala_revision_state', 'voyage_id', 'delete', 'revisão(ões) de escala'),
    (15, 'voyage_export_schedules', 'voyage_id', 'delete', 'escala(s) de exportação'),
    (16, 'granite_manifests', 'voyage_id', 'detach', 'manifesto(s) de Granito ficam sem viagem'),
    (17, 'vazios_manifests', 'voyage_id', 'detach', 'manifesto(s) de vazios ficam sem viagem'),
    (18, 'vazios_importacao_manifests', 'voyage_id', 'detach', 'manifesto(s) de vazios de importação ficam sem viagem'),
    (19, 'container_return_instruction_groups', 'voyage_id', 'delete', 'indicação(ões) de devolução');
$function$;
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
