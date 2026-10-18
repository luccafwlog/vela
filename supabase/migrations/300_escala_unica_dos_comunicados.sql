-- Migration 300: escala única para NOA, NOR e NOB, âncora do CE e Taxas por
-- Cliente × Viagem e o mesmo alvo na produtora e no detector.
--
-- Plano dos e-mails (docs/plans/2026-10-17-correcao-dos-emails.md), itens 1C,
-- 2.6, 2.7 e 4.5; decisões D2, D3 e D4.
--
-- 1C.1  customer_communication_scale_schedules: a escala vigente lida do
--       Histórico da Viagem (audit_logs), último valor por campo, porto por
--       normalize_port_code e deleted/omitted normalizados ('false' é falso).
--       ETA e ATA guardam data e hora; o texto do marco
--       (eta_text/ata_text) é a data pura quando o registro só tem data. A
--       produtora, o detector, a RPC create_customer_communication_atomic e a
--       Edge send-customer-communication (pela RPC
--       customer_communication_anchor_validation) passam a ler só daqui; o
--       snapshot voyages.pod_schedule_snapshot deixa de ser lido pelos
--       Comunicados (não é apagado).
-- 1C.2  CE e Taxas é um por Cliente × Viagem (D3): a validação confere só
--       Cliente e Viagem; o porto é informativo e determinístico
--       (customer_local_charges_communication_port: PODs distintos,
--       normalizados e ordenados), igual na produtora, no payload e no registro.
-- 1C.3  B/L cancelado (cancelled_at) não entra em NOA, NOR, NOB nem CE, na
--       produtora e na validação da Edge/RPC.
-- 1C.4  Cliente desativado não vira alvo.
-- 2.6   customer_communication_automation_targets: a seleção Cliente × alvo da
--       produtora, sem gravar claim. O detector usa a mesma seleção: escala sem
--       alvo não abre item, 'simulado' fecha (D4) e a mensagem lista os
--       Clientes pendentes.
-- 2.7   NOA/NOR e CE passam a ver o Cliente sem contato (LEFT JOIN), como o
--       NOB. O alerta nob_sem_destinatario vale para qualquer Comunicado
--       automático (rótulo "Comunicado sem destinatário"): um por Cliente,
--       lista os alvos sem destinatário e fecha quando nenhum alvo dele fica
--       sem destinatário, inclusive porque a janela venceu.
-- 4.5   customer_communication_safe_timestamptz lê data pura e data/hora sem
--       fuso no horário de Brasília e passa a STABLE.
-- A produtora também só retoma uma claim adiada depois de next_attempt_at
-- (migration 299) e, a cada rodada, recalcula os alertas comunicado_recusado.
-- Não altera nem apaga linhas existentes.

-- 4.5 ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_communication_safe_timestamptz(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_value text := btrim(COALESCE(p_value, ''));
BEGIN
  IF v_value !~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN NULL;
  END IF;
  -- Data pura: o dia começa à 00:00 de Brasília, não à 00:00 UTC (21:00 da
  -- véspera em Brasília).
  IF v_value ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN v_value::date::timestamp AT TIME ZONE 'America/Sao_Paulo';
  END IF;
  IF v_value ~* '(z|[+-]\d{2}(:?\d{2})?)$' THEN
    RETURN v_value::timestamptz;
  END IF;
  RETURN v_value::timestamp AT TIME ZONE 'America/Sao_Paulo';
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- Texto do marco para o e-mail: data pura fica data pura (o modelo mostra só
-- a data); data e hora vira ISO em UTC (o modelo converte para Brasília).
CREATE OR REPLACE FUNCTION public.customer_communication_milestone_text(p_value text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN btrim(COALESCE(p_value, '')) ~ '^\d{4}-\d{2}-\d{2}$'
      AND public.customer_communication_safe_timestamptz(p_value) IS NOT NULL THEN btrim(p_value)
    ELSE to_char(public.customer_communication_safe_timestamptz(p_value) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  END;
$function$;

-- Rótulo do marco no alerta: só a data para data pura; data e hora de Brasília
-- nos demais.
CREATE OR REPLACE FUNCTION public.customer_communication_milestone_label(p_text text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_text IS NULL THEN '—'
    WHEN p_text ~ '^\d{4}-\d{2}-\d{2}$' THEN to_char(p_text::date, 'DD/MM/YYYY')
    ELSE to_char(public.customer_communication_safe_timestamptz(p_text) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
  END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_communication_flag(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(lower(btrim(p_value)) IN ('true', 't', '1', 'yes', 'sim', 'on'), false);
$function$;

-- 1C.1 --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_communication_scale_schedules(
  p_voyage_id bigint DEFAULT NULL,
  p_port text DEFAULT NULL
)
RETURNS TABLE (
  voyage_id bigint,
  port text,
  eta timestamptz,
  eta_text text,
  ata timestamptz,
  ata_text text,
  deleted boolean,
  omitted boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH latest AS (
    -- Último valor de cada campo. Duas grafias do mesmo porto (BRVIT e BRVIX)
    -- são a mesma escala: vence o registro mais recente entre elas.
    SELECT DISTINCT ON (s.voyage_id, s.port, a.field_name)
      s.voyage_id, s.port, a.field_name, a.new_value
    FROM public.audit_logs a
    CROSS JOIN LATERAL (
      SELECT split_part(a.entity_id, '::', 1)::bigint AS voyage_id,
        public.normalize_port_code(split_part(a.entity_id, '::', 2)) AS port
    ) s
    WHERE a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id ~ '^[0-9]+::[^:]+$'
      AND a.field_name IN ('eta', 'ata', 'deleted', 'omitted')
      AND (p_voyage_id IS NULL OR a.entity_id LIKE p_voyage_id::text || '::%')
    ORDER BY s.voyage_id, s.port, a.field_name, a.changed_at DESC, a.id DESC
  ), pivot AS (
    SELECT l.voyage_id, l.port,
      max(l.new_value) FILTER (WHERE l.field_name = 'eta') AS eta_raw,
      max(l.new_value) FILTER (WHERE l.field_name = 'ata') AS ata_raw,
      max(l.new_value) FILTER (WHERE l.field_name = 'deleted') AS deleted_raw,
      max(l.new_value) FILTER (WHERE l.field_name = 'omitted') AS omitted_raw
    FROM latest l
    WHERE l.port IS NOT NULL
      AND (p_port IS NULL OR l.port = public.normalize_port_code(p_port))
    GROUP BY l.voyage_id, l.port
  )
  SELECT p.voyage_id, p.port,
    public.customer_communication_safe_timestamptz(p.eta_raw),
    public.customer_communication_milestone_text(p.eta_raw),
    public.customer_communication_safe_timestamptz(p.ata_raw),
    public.customer_communication_milestone_text(p.ata_raw),
    public.customer_communication_flag(p.deleted_raw),
    public.customer_communication_flag(p.omitted_raw)
  FROM pivot p;
$function$;

-- 1C.2 --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_port(p_voyage_id bigint, p_customer_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(string_agg(DISTINCT public.normalize_port_code(b.pod), ' / ' ORDER BY public.normalize_port_code(b.pod)), '—')
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND b.customer_id = p_customer_id
    AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
    AND b.cancelled_at IS NULL
    AND public.normalize_port_code(b.pod) IS NOT NULL;
$function$;

-- Definição vigente (migration 297) com o porto informativo de
-- customer_local_charges_communication_port no lugar do POD do 1º B/L.
CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_payload(p_voyage_id bigint, p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH base_bls AS (
      SELECT b.id AS bl_id, b.ce_mercante, b.pod, c.name AS customer_name,
             v.eta, v.voyage_number, vs.name AS vessel_name
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE b.voyage_id = p_voyage_id
        AND b.customer_id = p_customer_id
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND b.cancelled_at IS NULL
    ), direct_totals AS (
      SELECT ib.bl_id, sum(COALESCE(ib.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_bls ib
      JOIN base_bls b ON b.bl_id = ib.bl_id
      JOIN public.invoices i ON i.id = ib.invoice_id
      WHERE i.status IN ('issued', 'partially_paid', 'paid', 'covered')
      GROUP BY ib.bl_id
    ), ledger_totals AS (
      SELECT rl.bl_id, sum(COALESCE(rl.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_receivable_links rl
      JOIN base_bls b ON b.bl_id = rl.bl_id
      JOIN public.invoices i ON i.id = rl.invoice_id
      WHERE COALESCE(rl.status, '') <> 'obsolete'
        AND i.status IN ('issued', 'partially_paid', 'paid', 'covered')
        AND NOT EXISTS (SELECT 1 FROM direct_totals d WHERE d.bl_id = rl.bl_id)
      GROUP BY rl.bl_id
    )
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
      'customer_id', p_customer_id,
      'customer_name', max(base_bls.customer_name),
      'vessel_name', max(base_bls.vessel_name),
      'voyage_number', max(base_bls.voyage_number),
      'port', public.customer_local_charges_communication_port(p_voyage_id, p_customer_id),
      'milestone_at', max(COALESCE(base_bls.eta::TEXT, '')),
      'bls', jsonb_agg(jsonb_build_object(
        'bl_id', base_bls.bl_id,
        'ce_mercante', NULLIF(btrim(base_bls.ce_mercante), ''),
        'total_brl', COALESCE(direct_totals.total_brl, ledger_totals.total_brl, 0)
      ) ORDER BY base_bls.bl_id)
    ) END
    FROM base_bls
    LEFT JOIN direct_totals ON direct_totals.bl_id = base_bls.bl_id
    LEFT JOIN ledger_totals ON ledger_totals.bl_id = base_bls.bl_id
  );
END;
$function$;

-- Validação única da âncora (1C.1, 1C.2, 1C.3): usada pela RPC
-- create_customer_communication_atomic e pela Edge send-customer-communication.
-- Devolve {ok, error} e, quando válida, a viagem, o porto a gravar, o marco
-- (texto) e, no NOB, o terminal.
CREATE OR REPLACE FUNCTION public.customer_communication_anchor_validation(
  p_customer_id bigint,
  p_kind text,
  p_anchor_voyage_id bigint,
  p_anchor_port text,
  p_anchor_atracacao_id uuid,
  p_bl_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint := p_anchor_voyage_id;
  v_port text := NULLIF(btrim(p_anchor_port), '');
  v_bl record;
  v_count integer := 0;
  v_requested integer;
  v_schedule record;
  v_milestone text;
  v_berth record;
  v_terminal_id uuid;
  v_terminal_code text;
  v_operational boolean := p_kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT x) INTO v_requested FROM unnest(COALESCE(p_bl_ids, '{}'::text[])) AS x;
  IF (v_operational OR p_kind = 'ce_mercante_taxas') AND v_requested = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Comunicado operacional exige B/L.');
  END IF;

  FOR v_bl IN
    SELECT b.id, b.customer_id, b.voyage_id, b.pod, b.cancelled_at, b.financial_status
    FROM public.bls b WHERE b.id = ANY(p_bl_ids) ORDER BY b.id
  LOOP
    v_count := v_count + 1;
    IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Um ou mais B/Ls não pertencem ao cliente selecionado.');
    END IF;
    IF v_bl.cancelled_at IS NOT NULL OR COALESCE(v_bl.financial_status, 'pending') = 'cancelled' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'B/L cancelado não recebe Comunicado.');
    END IF;
    IF v_voyage_id IS NULL THEN v_voyage_id := v_bl.voyage_id; END IF;
    IF v_bl.voyage_id IS DISTINCT FROM v_voyage_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'A viagem-âncora não corresponde aos B/Ls selecionados.');
    END IF;
    -- CE e Taxas é por Cliente × Viagem (D3): o porto não restringe os B/Ls.
    IF p_kind <> 'ce_mercante_taxas' THEN
      IF v_port IS NULL THEN v_port := NULLIF(btrim(v_bl.pod), ''); END IF;
      IF public.normalize_port_code(v_bl.pod) IS DISTINCT FROM public.normalize_port_code(v_port) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'O porto-âncora não corresponde aos B/Ls selecionados.');
      END IF;
    END IF;
  END LOOP;
  IF v_count <> v_requested THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Um ou mais B/Ls não pertencem ao cliente selecionado.');
  END IF;

  IF p_kind = 'ce_mercante_taxas' THEN
    IF v_voyage_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Viagem obrigatória para o comunicado financeiro.');
    END IF;
    v_port := public.customer_local_charges_communication_port(v_voyage_id, p_customer_id);
  END IF;

  IF v_operational THEN
    IF v_voyage_id IS NULL OR v_port IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Viagem e porto são obrigatórios para o comunicado operacional.');
    END IF;
    SELECT * INTO v_schedule FROM public.customer_communication_scale_schedules(v_voyage_id, v_port) LIMIT 1;
    IF COALESCE(v_schedule.deleted, false) OR COALESCE(v_schedule.omitted, false)
       OR (p_kind <> 'aviso_atracacao_nob' AND v_schedule.voyage_id IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'A escala canônica do porto não está disponível para este comunicado.');
    END IF;
    IF p_kind <> 'aviso_atracacao_nob' THEN
      v_milestone := CASE WHEN p_kind = 'aviso_prontidao_nor' THEN v_schedule.ata_text ELSE v_schedule.eta_text END;
      IF v_milestone IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Marco operacional ausente.');
      END IF;
    END IF;
  END IF;

  IF p_kind = 'aviso_atracacao_nob' THEN
    SELECT t.id, t.voyage_id, t.port, t.terminal_id, t.terminal_atb, public.voyage_terminal_code(t.terminal_id) AS terminal_code
    INTO v_berth
    FROM public.voyage_escala_terminal_state t
    WHERE t.id = p_anchor_atracacao_id;
    IF v_berth.id IS NULL OR v_berth.voyage_id IS DISTINCT FROM v_voyage_id
       OR public.normalize_port_code(v_berth.port) IS DISTINCT FROM public.normalize_port_code(v_port)
       OR v_berth.terminal_id IS NULL OR v_berth.terminal_atb IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'A Atracação não corresponde à viagem e ao porto informados.');
    END IF;
    IF v_berth.terminal_code IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'O terminal da Atracação está sem sigla cadastrada.');
    END IF;
    -- Regra única do NOB (ADR 0068, item 7; migration 243).
    IF EXISTS (SELECT 1 FROM unnest(p_bl_ids) AS x WHERE NOT public.bl_belongs_to_atracacao(x, p_anchor_atracacao_id)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Um B/L não pertence à Frente de Operação desta Atracação.');
    END IF;
    v_milestone := to_char(v_berth.terminal_atb AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    v_terminal_id := v_berth.terminal_id;
    v_terminal_code := v_berth.terminal_code;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'voyage_id', v_voyage_id,
    'port', v_port,
    'milestone_at', v_milestone,
    'terminal_id', v_terminal_id,
    'terminal_code', v_terminal_code
  );
END;
$function$;

-- Definição vigente (migration 243) com a validação única da âncora.
CREATE OR REPLACE FUNCTION public.create_customer_communication_atomic(p_customer_id bigint, p_kind text, p_nature text, p_anchor_voyage_id bigint DEFAULT NULL::bigint, p_anchor_port text DEFAULT NULL::text, p_anchor_atracacao_id uuid DEFAULT NULL::uuid, p_anchor_invoice_id bigint DEFAULT NULL::bigint, p_attempt_discriminator integer DEFAULT 0, p_dispatch_id uuid DEFAULT NULL::uuid, p_vessel_name text DEFAULT NULL::text, p_voyage_number text DEFAULT NULL::text, p_terminal_name text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_bl_ids text[] DEFAULT '{}'::text[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint := p_anchor_voyage_id;
  v_port text := nullif(btrim(p_anchor_port), '');
  v_vessel_name text := nullif(btrim(p_vessel_name), '');
  v_voyage_number text := nullif(btrim(p_voyage_number), '');
  v_terminal_name text := nullif(btrim(p_terminal_name), '');
  v_validation jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob', 'ce_mercante_taxas') THEN
    -- Trava os B/Ls e a viagem enquanto confere e registra.
    PERFORM 1 FROM public.bls b WHERE b.id = ANY(p_bl_ids) ORDER BY b.id FOR UPDATE;
    v_validation := public.customer_communication_anchor_validation(
      p_customer_id, p_kind, p_anchor_voyage_id, p_anchor_port, p_anchor_atracacao_id, p_bl_ids);
    IF NOT COALESCE((v_validation->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '%', v_validation->>'error' USING ERRCODE = '22023';
    END IF;
    v_voyage_id := (v_validation->>'voyage_id')::bigint;
    v_port := v_validation->>'port';
    PERFORM 1 FROM public.voyages v WHERE v.id = v_voyage_id FOR UPDATE;
    SELECT v.voyage_number, vs.name INTO v_voyage_number, v_vessel_name
    FROM public.voyages v LEFT JOIN public.vessels vs ON vs.id = v.vessel_id WHERE v.id = v_voyage_id;
  ELSIF p_kind = 'institucional' AND coalesce(cardinality(p_bl_ids), 0) > 0 THEN
    RAISE EXCEPTION 'Comunicado institucional não pode conter B/Ls.' USING ERRCODE = '22023';
  END IF;

  RETURN public.create_customer_communication_atomic_legacy_070(
    p_customer_id, p_kind, p_nature, v_voyage_id, v_port, p_anchor_atracacao_id,
    p_anchor_invoice_id, p_attempt_discriminator, p_dispatch_id, v_vessel_name,
    v_voyage_number, v_terminal_name, p_created_by, p_bl_ids
  );
END;
$function$;

-- 2.6 / 2.7 ---------------------------------------------------------------
-- Endereços que a régua automática usa para um Cliente nas caixas dadas.
CREATE OR REPLACE FUNCTION public.customer_communication_automatic_recipients(p_customer_id bigint, p_boxes text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT btrim(cc.email) ORDER BY btrim(cc.email)), '{}'::text[])
  FROM public.customer_contacts cc
  JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id AND ccb.box_code = ANY(p_boxes)
  WHERE cc.customer_id = p_customer_id
    AND cc.deactivated_at IS NULL
    AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    AND NOT EXISTS (
      SELECT 1 FROM public.portal_suppressed_emails pse
      WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente')
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_communication_suppressions ccs
      WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email)));
$function$;

-- Alvos da régua automática em p_as_of: um por Cliente × escala (NOA/NOR),
-- Cliente × Viagem (CE e Taxas) ou Cliente × Atracação (NOB), ainda sem
-- Comunicado enviado ou simulado. Inclui Cliente sem destinatário (emails
-- vazio). Não grava claim: a produtora e o detector leem a mesma seleção.
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
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications sent
        WHERE sent.customer_id = b.customer_id
          AND sent.kind = sched.kind
          AND sent.nature = 'avisos_operacionais'
          AND sent.status IN ('enviado', 'simulado')
          AND sent.anchor_voyage_id = sched.voyage_id
          AND public.normalize_port_code(sent.anchor_port) = sched.port)
    GROUP BY sched.kind, sched.voyage_id, sched.port, sched.vessel_name, sched.voyage_number,
      sched.milestone_at, sched.milestone_text, b.customer_id, c.name, c.cnpj_cpf
  )
  SELECT g.kind, 'avisos_operacionais'::text,
    g.kind || ':' || g.customer_id || ':' || g.voyage_id || ':' || g.port,
    g.customer_id, g.customer_name, g.cnpj_cpf, g.voyage_id, g.vessel_name, g.voyage_number, g.port,
    g.milestone_at, g.milestone_text, NULL::uuid, NULL::uuid, NULL::text, g.bl_ids,
    public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao'])
  FROM grouped g;

  -- CE e Taxas: um por Cliente × Viagem pronta (D3).
  RETURN QUERY
  WITH grouped AS (
    SELECT b.voyage_id, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      v.voyage_number, vs.name AS vessel_name, v.eta AS milestone_at,
      array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids
    FROM public.bls b
    JOIN public.customers c ON c.id = b.customer_id AND c.deactivated_at IS NULL
    JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE v.status IS DISTINCT FROM 'cancelled'
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications sent
        WHERE sent.customer_id = b.customer_id AND sent.kind = 'ce_mercante_taxas'
          AND sent.nature = 'documentacao' AND sent.status IN ('enviado', 'simulado')
          AND sent.anchor_voyage_id = b.voyage_id AND sent.attempt_discriminator = 0)
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  )
  SELECT 'ce_mercante_taxas'::text, 'documentacao'::text,
    'ce_mercante_taxas:' || g.customer_id || ':' || g.voyage_id,
    g.customer_id, g.customer_name, g.cnpj_cpf, g.voyage_id, g.vessel_name, g.voyage_number,
    public.customer_local_charges_communication_port(g.voyage_id, g.customer_id),
    g.milestone_at, to_char(g.milestone_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    NULL::uuid, NULL::uuid, NULL::text, g.bl_ids,
    public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao', 'financeiro'])
  FROM grouped g
  WHERE (public.customer_local_charges_communication_readiness(g.voyage_id, g.customer_id)->>'ready')::boolean;

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
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications sent
        WHERE sent.customer_id = b.customer_id
          AND sent.kind = 'aviso_atracacao_nob'
          AND sent.nature = 'avisos_operacionais'
          AND sent.status IN ('enviado', 'simulado')
          AND sent.anchor_atracacao_id = br.state_id)
    GROUP BY br.state_id, br.voyage_id, br.port, br.terminal_id, br.terminal_atb, br.terminal_code,
      br.voyage_number, br.vessel_name, b.customer_id, c.name, c.cnpj_cpf
  )
  SELECT 'aviso_atracacao_nob'::text, 'avisos_operacionais'::text,
    'aviso_atracacao_nob:' || g.customer_id || ':' || g.state_id,
    g.customer_id, g.customer_name, g.cnpj_cpf, g.voyage_id, g.vessel_name, g.voyage_number, g.port,
    g.terminal_atb, to_char(g.terminal_atb AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    g.state_id, g.terminal_id, g.terminal_code, g.bl_ids,
    public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao'])
  FROM grouped g;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_communication_kind_short_label(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_kind
    WHEN 'aviso_chegada_noa' THEN 'NOA'
    WHEN 'aviso_prontidao_nor' THEN 'NOR'
    WHEN 'aviso_atracacao_nob' THEN 'NOB'
    WHEN 'ce_mercante_taxas' THEN 'CE e Taxas'
    ELSE p_kind
  END;
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_target record;
  v_customer record;
  v_candidates jsonb := '[]'::jsonb;
  v_unreachable jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  FOR v_target IN SELECT * FROM public.customer_communication_automation_targets(v_as_of) t ORDER BY t.claim_key
  LOOP
    IF COALESCE(cardinality(v_target.emails), 0) = 0 THEN
      -- 2.7: Cliente sem destinatário vira alerta, não candidato.
      v_unreachable := jsonb_set(v_unreachable, ARRAY[v_target.customer_id::text],
        COALESCE(v_unreachable -> (v_target.customer_id::text), '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'kind', v_target.kind, 'voyage_id', v_target.voyage_id, 'port', v_target.port,
          'voyage_number', v_target.voyage_number, 'atracacao_id', v_target.anchor_atracacao_id,
          'terminal_code', v_target.terminal_code, 'bl_ids', to_jsonb(v_target.bl_ids),
          'customer_name', v_target.customer_name)));
      CONTINUE;
    END IF;

    INSERT INTO public.customer_communication_automation_claims (claim_key)
    VALUES (v_target.claim_key)
    ON CONFLICT (claim_key) DO UPDATE
      SET claimed_at = now(), released_at = NULL, rejected_at = NULL, rejection_reason = NULL
      WHERE (customer_communication_automation_claims.released_at IS NOT NULL
         OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes')
        AND (customer_communication_automation_claims.rejected_at IS NULL
         OR customer_communication_automation_claims.rejected_at < v_as_of - interval '24 hours')
        -- 1D: recusa não definitiva só volta depois do intervalo (migration 299).
        AND (customer_communication_automation_claims.next_attempt_at IS NULL
         OR customer_communication_automation_claims.next_attempt_at <= v_as_of);
    IF FOUND THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'claim_key', v_target.claim_key, 'kind', v_target.kind, 'nature', v_target.nature,
        'customer_id', v_target.customer_id, 'customer_name', v_target.customer_name,
        'customer_cnpj', v_target.customer_cnpj, 'voyage_id', v_target.voyage_id,
        'vessel_name', v_target.vessel_name, 'voyage_number', v_target.voyage_number,
        'port', v_target.port, 'milestone_at', v_target.milestone_text,
        'anchor_atracacao_id', v_target.anchor_atracacao_id, 'terminal_id', v_target.terminal_id,
        'terminal_name', v_target.terminal_code,
        'bl_ids', to_jsonb(v_target.bl_ids), 'emails', to_jsonb(v_target.emails)
      )));
    END IF;
  END LOOP;

  -- 2.7: um alerta por Cliente sem destinatário, com todos os seus alvos. Falha
  -- no alerta não aborta a rodada dos outros Clientes.
  FOR v_customer IN SELECT key AS customer_id, value AS targets FROM jsonb_each(v_unreachable)
  LOOP
    BEGIN
      PERFORM public.upsert_alert_item(
        'nob_sem_destinatario',
        'customer',
        v_customer.customer_id,
        'Cliente ' || (v_customer.targets -> 0 ->> 'customer_name') || ': sem contato ativo para receber '
          || (SELECT string_agg(public.customer_communication_kind_short_label(t ->> 'kind')
                || ' da viagem ' || COALESCE(t ->> 'voyage_number', t ->> 'voyage_id')
                || CASE WHEN t ->> 'kind' = 'ce_mercante_taxas' THEN '' ELSE ' (' || COALESCE(t ->> 'port', '—')
                  || COALESCE(' · ' || (t ->> 'terminal_code'), '') || ')' END,
                '; ' ORDER BY t ->> 'kind', t ->> 'voyage_id')
              FROM jsonb_array_elements(v_customer.targets) t)
          || '. Cadastre um contato na caixa Documentação e Operação (ou Financeiro, para o CE e Taxas).',
        'comunicado_automacao',
        jsonb_build_object('customer_id', v_customer.customer_id::bigint, 'targets', v_customer.targets),
        '/clientes'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta nob_sem_destinatario do Cliente % nao gravado: %', v_customer.customer_id, SQLERRM;
    END;
  END LOOP;

  -- Fecha o alerta de quem já tem destinatário ou não tem mais alvo (janela
  -- vencida, Comunicado registrado, Cliente desativado).
  FOR v_customer IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'nob_sem_destinatario' AND i.status = 'active'
      AND a.entity_type = 'customer'
      AND NOT (v_unreachable ? a.entity_id)
  LOOP
    BEGIN
      PERFORM public.resolve_alert_item('nob_sem_destinatario', 'customer', v_customer.entity_id, 'comunicado_automacao', '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta nob_sem_destinatario do Cliente % nao resolvido: %', v_customer.entity_id, SQLERRM;
    END;
  END LOOP;

  -- 1D: tira do alerta comunicado_recusado as claims cujo alvo deixou de existir.
  FOR v_customer IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'comunicado_recusado' AND i.status = 'active'
      AND a.entity_type = 'customer' AND a.entity_id ~ '^[0-9]+$'
  LOOP
    PERFORM public.refresh_customer_communication_refusal_alert(v_customer.entity_id::bigint);
  END LOOP;

  RETURN v_candidates;
END;
$function$;

-- 2.6: o detector usa os alvos da produtora. Definição vigente (migration 045)
-- com o bloco de NOA/NOR/NOB trocado; o bloco de bounce é o mesmo.
CREATE OR REPLACE FUNCTION public.detect_customer_communication_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_source TEXT := 'customer_communication_detector';
  v_pending RECORD;
  v_stale RECORD;
  v_customer RECORD;
  v_keys text[] := '{}'::text[];
  v_has_bounced_contact BOOLEAN;
  v_valid_contacts INTEGER;
  v_noa_pending INTEGER := 0;
  v_nor_pending INTEGER := 0;
  v_nob_pending INTEGER := 0;
  v_bounce_pending INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- Um item por escala (NOA/NOR) ou Atracação (NOB) que ainda tem Cliente sem
  -- Comunicado enviado ou simulado (D4). Escala sem alvo não abre item.
  FOR v_pending IN
    SELECT t.kind, t.voyage_id, t.port, t.milestone_at, t.milestone_text,
      t.anchor_atracacao_id, t.terminal_id, t.terminal_code,
      CASE WHEN t.kind = 'aviso_chegada_noa' THEN 'comunicado_noa_pendente'
           WHEN t.kind = 'aviso_prontidao_nor' THEN 'comunicado_nor_pendente'
           ELSE 'comunicado_nob_pendente' END AS item_type,
      CASE WHEN t.kind = 'aviso_atracacao_nob' THEN 'voyage_escala_terminal' ELSE 'voyage_pod_schedule' END AS entity_type,
      t.voyage_id || '::' || t.port || CASE WHEN t.kind = 'aviso_atracacao_nob' THEN '::' || t.terminal_code ELSE '' END AS entity_id,
      string_agg(t.customer_name, ', ' ORDER BY t.customer_name) AS customers,
      jsonb_agg(t.customer_id ORDER BY t.customer_id) AS customer_ids
    FROM public.customer_communication_automation_targets(v_now) t
    WHERE t.kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob')
    GROUP BY t.kind, t.voyage_id, t.port, t.milestone_at, t.milestone_text,
      t.anchor_atracacao_id, t.terminal_id, t.terminal_code
  LOOP
    v_keys := v_keys || (v_pending.item_type || '|' || v_pending.entity_id);
    IF v_pending.kind = 'aviso_chegada_noa' THEN v_noa_pending := v_noa_pending + 1;
    ELSIF v_pending.kind = 'aviso_prontidao_nor' THEN v_nor_pending := v_nor_pending + 1;
    ELSE v_nob_pending := v_nob_pending + 1;
    END IF;
    PERFORM public.upsert_alert_item(
      v_pending.item_type, v_pending.entity_type, v_pending.entity_id,
      CASE v_pending.kind
        WHEN 'aviso_chegada_noa' THEN 'NOA pendente para a escala ' || v_pending.port
          || ' (ETA ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
        WHEN 'aviso_prontidao_nor' THEN 'NOR pendente para a escala ' || v_pending.port
          || ' (ATA ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
        ELSE 'NOB pendente no terminal ' || v_pending.terminal_code || ' para a escala ' || v_pending.port
          || ' (ATB ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
      END || ': ' || v_pending.customers,
      v_source, 'documentacao',
      jsonb_strip_nulls(jsonb_build_object(
        'voyage_id', v_pending.voyage_id,
        'port', v_pending.port,
        'milestone', CASE v_pending.kind WHEN 'aviso_chegada_noa' THEN 'eta' WHEN 'aviso_prontidao_nor' THEN 'ata' ELSE 'atb' END,
        'milestone_at', v_pending.milestone_at,
        'terminal_id', v_pending.terminal_id,
        'terminal_code', v_pending.terminal_code,
        'state_id', v_pending.anchor_atracacao_id,
        'customer_ids', v_pending.customer_ids,
        'window_days', CASE WHEN v_pending.kind = 'aviso_chegada_noa' THEN 5 ELSE 30 END
      )),
      '/clientes/comunicacao'
    );
  END LOOP;

  -- Fecha o que não é mais alvo: enviado ou simulado, janela vencida, escala
  -- excluída ou omitida, terminal removido, sem B/L elegível.
  FOR v_stale IN
    SELECT DISTINCT i.item_type, a.entity_type, a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type IN ('comunicado_noa_pendente', 'comunicado_nor_pendente', 'comunicado_nob_pendente')
      AND i.status = 'active'
  LOOP
    IF NOT (v_stale.item_type || '|' || v_stale.entity_id) = ANY(v_keys) THEN
      PERFORM public.resolve_alert_item(
        v_stale.item_type, v_stale.entity_type, v_stale.entity_id,
        v_source, jsonb_build_object('reason', 'no_pending_target')
      );
    END IF;
  END LOOP;

  -- A cascata de bounce é o produtor imediato, mas a varredura também fecha
  -- a pendência quando um novo contato válido é cadastrado na Ficha.
  FOR v_customer IN
    SELECT c.id, c.cnpj_cpf
    FROM public.customers c
  LOOP
    SELECT
      EXISTS (
        SELECT 1
        FROM public.customer_contacts cc
        JOIN public.portal_suppressed_emails pse
          ON lower(btrim(pse.email)) = lower(btrim(cc.email))
         AND pse.reason = 'bounce_permanente'
        WHERE cc.customer_id = v_customer.id
          AND NULLIF(btrim(cc.email), '') IS NOT NULL
      ),
      COUNT(*) FILTER (
        WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = lower(btrim(cc.email))
          )
      )::INTEGER
    INTO v_has_bounced_contact, v_valid_contacts
    FROM public.customer_contacts cc
    WHERE cc.customer_id = v_customer.id;

    IF v_has_bounced_contact AND v_valid_contacts = 0 THEN
      v_bounce_pending := v_bounce_pending + 1;
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE type = 'cliente_contato_bounced_sem_alternativa'
        AND entity_type = 'customer'
        AND entity_id = v_customer.id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.alert_items i
          WHERE i.alert_id = public.alerts.id
            AND i.item_type = 'cliente_contato_bounced_sem_alternativa'
        )
        AND status <> 'closed';

      PERFORM public.upsert_alert_item(
        'cliente_contato_bounced_sem_alternativa', 'customer', v_customer.id::TEXT,
        'Cliente sem contato alternativo válido após bounce permanente; atualize o cadastro.',
        v_source, 'documentacao',
        jsonb_build_object(
          'customer_id', v_customer.id,
          'customer_cnpj', v_customer.cnpj_cpf,
          'reason', 'all_contacts_bounced_or_suppressed'
        ),
        '/clientes'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'cliente_contato_bounced_sem_alternativa', 'customer', v_customer.id::TEXT,
        v_source, jsonb_build_object('reason', 'valid_contact_available')
      );
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE type = 'cliente_contato_bounced_sem_alternativa'
        AND entity_type = 'customer'
        AND entity_id = v_customer.id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.alert_items i
          WHERE i.alert_id = public.alerts.id
            AND i.item_type = 'cliente_contato_bounced_sem_alternativa'
        )
        AND status <> 'closed';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'noa_pending', v_noa_pending,
    'nor_pending', v_nor_pending,
    'nob_pending', v_nob_pending,
    'bounced_without_alternative', v_bounce_pending
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_communication_safe_timestamptz(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_milestone_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_milestone_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_flag(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_kind_short_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_scale_schedules(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_local_charges_communication_port(bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_anchor_validation(bigint, text, bigint, text, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_automatic_recipients(bigint, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_automation_targets(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_communication_scale_schedules(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_anchor_validation(bigint, text, bigint, text, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_automation_targets(timestamptz) TO service_role;
