-- Migration 339: um B/L sem Cliente não derruba a rodada dos Comunicados.
--
-- Incidente de 2026-10-20 (Sentry VELA-24 e VELA-25; Better Stack 1034976963
-- e 1034977549): um B/L da viagem 62 foi importado às 15:25 (BRT) sem Cliente,
-- e o Cliente só foi cadastrado às 15:36. Nesse intervalo, os jobs
-- alerts-foundation-detectors e customer-communication-auto-runner
-- terminaram em 500 com "Viagem e cliente são obrigatórios." (22023), para
-- todos os Clientes.
--
-- 1. customer_local_charges_communication_readiness (definição da migration
--    179): Viagem ou Cliente NULL devolve "não pronto" (ready = false,
--    reason_code sem_cliente ou sem_viagem, sem B/Ls) em vez de RAISE.
--    Assinatura, permissão de acesso e campos do retorno não mudam.
-- 2. customer_communication_automation_targets (definição da migration 318):
--    o ramo de CE e Taxas filtra customer_id e voyage_id NOT NULL de forma
--    explícita e materializa os grupos antes de chamar a prontidão. A função
--    é STABLE e o filtro de prontidão referencia só colunas agrupadas: o
--    planner podia empurrá-lo para o scan de `bls`, antes do JOIN com
--    `customers`, e chamá-la com Cliente NULL. Os outros ramos não chamam a
--    prontidão e ficam iguais.
--
-- evaluate_and_dispatch_automatic_communications (régua) e
-- detect_customer_communication_alerts (detector) leem os alvos daqui. As
-- legadas evaluate_and_dispatch_automatic_communications_045 e
-- find_due_customer_communication_automations, sem chamador, já filtram
-- b.customer_id IS NOT NULL e herdam o item 1. CREATE OR REPLACE conserva os
-- grants. Não altera linhas.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_readiness(p_voyage_id bigint, p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  -- B/L importado sem Cliente (ou sem Viagem) não está pronto: devolve o
  -- veredito em vez de abortar a consulta inteira de quem chamou.
  IF p_voyage_id IS NULL OR p_customer_id IS NULL THEN
    RETURN jsonb_build_object(
      'voyage_id', p_voyage_id,
      'customer_id', p_customer_id,
      'ready', false,
      'reason_code', CASE WHEN p_customer_id IS NULL THEN 'sem_cliente' ELSE 'sem_viagem' END,
      'bl_count', 0,
      'blocked_bl_count', 0,
      'reasons', jsonb_build_array(CASE WHEN p_customer_id IS NULL THEN 'sem_cliente' ELSE 'sem_viagem' END),
      'bls', '[]'::jsonb);
  END IF;

  WITH bl_state AS (
    SELECT
      b.id AS bl_id,
      NULLIF(btrim(b.ce_mercante), '') AS ce_mercante,
      COALESCE(b.financial_status, 'pending') AS financial_status,
      COALESCE(b.cargo_mode, 'container') AS cargo_mode,
      b.bb_weight_ton,
      array_remove(ARRAY[
        CASE WHEN b.review_status = 'pending_review' THEN 'revisao_pendente'::text END,
        CASE WHEN COALESCE(b.cargo_mode, 'container') IN ('carga_solta', 'misto')
                  AND (b.bb_weight_ton IS NULL OR b.bb_weight_ton <= 0)
             THEN 'peso_bb_ausente'::text END
      ], NULL) AS review_pendencies
    FROM public.bls AS b
    WHERE b.voyage_id = p_voyage_id
      AND b.customer_id = p_customer_id
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
  ), annotated AS (
    SELECT
      bl_state.*,
      array_remove(ARRAY[
        CASE WHEN bl_state.ce_mercante IS NULL THEN 'ce_mercante_ausente'::text END,
        CASE WHEN COALESCE(cardinality(bl_state.review_pendencies), 0) > 0 THEN 'revisao_pendente'::text END,
        CASE WHEN bl_state.financial_status NOT IN ('invoiced', 'paid') THEN 'faturamento_pendente'::text END
      ], NULL) AS blocked_reasons
    FROM bl_state
  ), aggregate AS (
    SELECT
      count(*)::integer AS bl_count,
      count(*) FILTER (WHERE cardinality(blocked_reasons) > 0)::integer AS blocked_bl_count,
      COALESCE(bool_and(cardinality(blocked_reasons) = 0), false) AS ready,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'bl_id', bl_id,
          'ce_mercante', ce_mercante,
          'financial_status', financial_status,
          'cargo_mode', cargo_mode,
          'review_pendencies', to_jsonb(review_pendencies),
          'blocked_reasons', to_jsonb(blocked_reasons)
        ) ORDER BY bl_id
      ), '[]'::jsonb) AS bls
    FROM annotated
  ), reason_aggregate AS (
    SELECT COALESCE(jsonb_agg(DISTINCT reason ORDER BY reason), '[]'::jsonb) AS reasons
    FROM annotated
    CROSS JOIN LATERAL unnest(annotated.blocked_reasons) AS reason
  )
  SELECT jsonb_build_object(
    'voyage_id', p_voyage_id,
    'customer_id', p_customer_id,
    'ready', CASE WHEN bl_count = 0 THEN false ELSE ready END,
    'reason_code', CASE
      WHEN bl_count = 0 THEN 'no_bls'
      WHEN ready THEN 'ready'
      ELSE COALESCE(reasons ->> 0, 'readiness_blocked')
    END,
    'bl_count', bl_count,
    'blocked_bl_count', blocked_bl_count,
    'reasons', reasons,
    'bls', bls
  ) INTO v_result
  FROM aggregate CROSS JOIN reason_aggregate;
  RETURN v_result;
END;
$function$;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_communication_automation_targets(p_as_of timestamptz DEFAULT now())
RETURNS TABLE (
  kind text,
  nature text,
  claim_key text,
  customer_id bigint,
  customer_name text,
  customer_cnpj text,
  voyage_id bigint,
  vessel_name text,
  voyage_number text,
  port text,
  milestone_at timestamptz,
  milestone_text text,
  anchor_atracacao_id uuid,
  terminal_id uuid,
  terminal_code text,
  bl_ids text[],
  emails text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_as_of timestamptz := COALESCE(p_as_of, now());
BEGIN
  -- NOA: de D-5 até antes do ETA. NOR: até 30 dias depois da ATA.
  RETURN QUERY
  WITH sched AS (
    SELECT s.voyage_id, s.port, v.voyage_number, vs.name AS vessel_name,
      CASE WHEN s.ata IS NOT NULL THEN 'aviso_prontidao_nor' ELSE 'aviso_chegada_noa' END AS kind,
      CASE WHEN s.ata IS NOT NULL THEN s.ata ELSE s.eta END AS milestone_at,
      CASE WHEN s.ata IS NOT NULL THEN s.ata_text ELSE s.eta_text END AS milestone_text
    FROM public.customer_communication_scale_schedules() s
    JOIN public.voyages v ON v.id = s.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE NOT s.deleted AND NOT s.omitted
      AND v.status IS DISTINCT FROM 'cancelled'
      AND ((s.ata IS NULL AND s.eta IS NOT NULL AND v_as_of >= s.eta - interval '5 days' AND v_as_of < s.eta)
        OR (s.ata IS NOT NULL AND s.ata BETWEEN v_as_of - interval '30 days' AND v_as_of))
  ), grouped AS (
    SELECT sched.kind, sched.voyage_id, sched.port, sched.vessel_name, sched.voyage_number,
      sched.milestone_at, sched.milestone_text, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids
    FROM sched
    JOIN public.bls b ON b.voyage_id = sched.voyage_id AND public.normalize_port_code(b.pod) = sched.port
    JOIN public.customers c ON c.id = b.customer_id AND c.deactivated_at IS NULL
    WHERE COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
    GROUP BY sched.kind, sched.voyage_id, sched.port, sched.vessel_name, sched.voyage_number,
      sched.milestone_at, sched.milestone_text, b.customer_id, c.name, c.cnpj_cpf
  ), addressed AS (
    SELECT g.*, public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao']) AS recipients
    FROM grouped g
  )
  SELECT a.kind, 'avisos_operacionais'::text,
    a.kind || ':' || a.customer_id || ':' || a.voyage_id || ':' || a.port,
    a.customer_id, a.customer_name, a.cnpj_cpf, a.voyage_id, a.vessel_name, a.voyage_number, a.port,
    a.milestone_at, a.milestone_text, NULL::uuid, NULL::uuid, NULL::text, a.bl_ids, pr.pending
  FROM addressed a
  CROSS JOIN LATERAL (
    SELECT public.customer_communication_target_pending_recipients(a.kind, a.customer_id, a.voyage_id, a.port, NULL, a.recipients) AS pending
  ) pr
  WHERE pr.pending IS NOT NULL;

  -- CE e Taxas: um por Cliente × Viagem pronta (D3).
  -- MATERIALIZED: a prontidão roda só sobre os grupos já formados, com
  -- Viagem e Cliente presentes. Sem a barreira, o planner podia avaliar o
  -- filtro de prontidão no scan de `bls`, antes do JOIN com `customers`, e
  -- chamar a prontidão para o B/L sem Cliente.
  RETURN QUERY
  WITH grouped AS MATERIALIZED (
    SELECT b.voyage_id, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      v.voyage_number, vs.name AS vessel_name, v.eta AS milestone_at,
      array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids
    FROM public.bls b
    JOIN public.customers c ON c.id = b.customer_id AND c.deactivated_at IS NULL
    JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE b.customer_id IS NOT NULL
      AND b.voyage_id IS NOT NULL
      AND v.status IS DISTINCT FROM 'cancelled'
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  ), addressed AS (
    SELECT g.*, public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao', 'financeiro']) AS recipients
    FROM grouped g
    WHERE g.customer_id IS NOT NULL
      AND g.voyage_id IS NOT NULL
      AND (public.customer_local_charges_communication_readiness(g.voyage_id, g.customer_id)->>'ready')::boolean
  )
  SELECT 'ce_mercante_taxas'::text, 'documentacao'::text,
    'ce_mercante_taxas:' || a.customer_id || ':' || a.voyage_id,
    a.customer_id, a.customer_name, a.cnpj_cpf, a.voyage_id, a.vessel_name, a.voyage_number,
    public.customer_local_charges_communication_port(a.voyage_id, a.customer_id),
    a.milestone_at, to_char(a.milestone_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    NULL::uuid, NULL::uuid, NULL::text, a.bl_ids, pr.pending
  FROM addressed a
  CROSS JOIN LATERAL (
    SELECT public.customer_communication_target_pending_recipients('ce_mercante_taxas', a.customer_id, a.voyage_id, NULL, NULL, a.recipients) AS pending
  ) pr
  WHERE pr.pending IS NOT NULL;

  -- NOB: Cliente × Atracação com ATB nos últimos 30 dias, pela regra única
  -- (ADR 0068, item 7; migration 243).
  RETURN QUERY
  WITH berths AS (
    SELECT ts.id AS state_id, ts.voyage_id, upper(btrim(ts.port)) AS port, ts.terminal_id, ts.terminal_atb,
      public.voyage_terminal_code(ts.terminal_id) AS terminal_code, v.voyage_number, vs.name AS vessel_name
    FROM public.voyage_escala_terminal_state ts
    JOIN public.voyages v ON v.id = ts.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE ts.terminal_id IS NOT NULL
      AND v.status IS DISTINCT FROM 'cancelled'
      AND ts.terminal_atb IS NOT NULL
      AND ts.terminal_atb <= v_as_of
      AND ts.terminal_atb >= v_as_of - interval '30 days'
      AND public.voyage_terminal_code(ts.terminal_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_scale_schedules(ts.voyage_id, ts.port) s
        WHERE s.deleted OR s.omitted)
  ), grouped AS (
    SELECT br.state_id, br.voyage_id, br.port, br.terminal_id, br.terminal_atb, br.terminal_code,
      br.voyage_number, br.vessel_name, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids
    FROM berths br
    JOIN public.bls b ON b.voyage_id = br.voyage_id AND public.normalize_port_code(b.pod) = public.normalize_port_code(br.port)
    JOIN public.customers c ON c.id = b.customer_id AND c.deactivated_at IS NULL
    WHERE COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
      AND public.bl_belongs_to_atracacao(b.id, br.state_id)
    GROUP BY br.state_id, br.voyage_id, br.port, br.terminal_id, br.terminal_atb, br.terminal_code,
      br.voyage_number, br.vessel_name, b.customer_id, c.name, c.cnpj_cpf
  ), addressed AS (
    SELECT g.*, public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao']) AS recipients
    FROM grouped g
  )
  SELECT 'aviso_atracacao_nob'::text, 'avisos_operacionais'::text,
    'aviso_atracacao_nob:' || a.customer_id || ':' || a.state_id,
    a.customer_id, a.customer_name, a.cnpj_cpf, a.voyage_id, a.vessel_name, a.voyage_number, a.port,
    a.terminal_atb, to_char(a.terminal_atb AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    a.state_id, a.terminal_id, a.terminal_code, a.bl_ids, pr.pending
  FROM addressed a
  CROSS JOIN LATERAL (
    SELECT public.customer_communication_target_pending_recipients('aviso_atracacao_nob', a.customer_id, a.voyage_id, a.port, a.state_id, a.recipients) AS pending
  ) pr
  WHERE pr.pending IS NOT NULL;
END;
$function$;
