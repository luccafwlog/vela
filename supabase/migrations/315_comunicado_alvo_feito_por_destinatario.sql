-- Migration 315: o alvo da régua automática só é feito quando todo destinatário
-- recebeu; escala por grafia exata; CE e Taxas sem porto na identidade;
-- Comunicado "Em envio" sem dono vira falha; alerta comunicado_recusado só com
-- alvo devido.
--
-- Plano dos e-mails (docs/plans/2026-10-17-correcao-dos-emails.md), revisão do
-- núcleo dos Comunicados (itens 1B, 1C, 1D e 2.6; decisões D2, D3 e D18).
--
-- 1. customer_communication_target_done: a produtora e o detector davam o alvo
--    como feito pelo status do Comunicado ('enviado'/'simulado'), que só vê as
--    tentativas gravadas. Um destinatário que falhava sem tentativa, ou que a
--    Edge derrubada nem chegou a tentar, sumia quando outro recebia; e o
--    'parcial' com contato devolvido voltava a cada 30 min para sempre. Agora o
--    alvo é feito quando cada destinatário automático atual
--    (customer_communication_automatic_recipients, que já tira os suprimidos)
--    tem, em algum Comunicado do alvo, tentativa entregue (real com id do
--    provedor ou entregue; simulada aceita) ou devolvida (bounce, complaint).
--    O destinatário é casado por recipient_key (sha256 do e-mail normalizado,
--    o mesmo de _shared/email.ts). Sem destinatário, o alvo é feito só se
--    alguém já recebeu. customer_communication_automation_targets passa a usar
--    essa regra; o status do Comunicado deixa de ser critério.
-- 2. customer_communication_scale_schedules: deleted e omitted são lidos por
--    grafia exata (entity_id) e só depois agregados por porto normalizado; a
--    grafia ativa vence a excluída (escala excluída em BRVIT e recriada em
--    BRVIX fica ativa). ETA e ATA continuam com data e hora (D2).
-- 3. CE e Taxas (D3): a identidade é Cliente × Viagem com anchor_port nulo (o
--    índice customer_communications_idempotency é NULLS NOT DISTINCT); o porto
--    informativo fica só no corpo do e-mail. Antes, a lista de PODs entrava na
--    identidade e a troca de POD de um B/L criava outro Comunicado e reenviava
--    o CE. A validação da âncora devolve porto nulo para o CE e a linha mais
--    recente de cada identidade de CE já gravada passa a anchor_port nulo.
-- 4. settle_stale_pending_customer_communications: Comunicado 'pendente' há
--    mais de 15 min sem tentativa nova (500 depois de registrar, Edge derrubada)
--    é recalculado pelas tentativas; se continuar 'pendente', vira 'falha'.
--    Roda no detector dos Comunicados (run_alert_detectors, a cada 15 min).
--    A tentativa 'aceito' sem id do provedor fica como está: a produtora volta
--    a chamar o provedor com a mesma chave (o provedor deduplica em 24 h).
-- 5. refresh_customer_communication_refusal_alert: a claim só fica no alerta
--    enquanto o alvo dela está devido (consta dos alvos); o Comunicado que saiu
--    por outro caminho (Histórico) tira a claim na rodada seguinte.
--
-- Correção do cabeçalho da migration 302: lá se lê que a produtora e o scanner
-- da Régua de Cobrança "só aceitam enviado/simulado/parcial". A produtora
-- aceitava só enviado/simulado (e, desde esta migration, olha as tentativas);
-- a Régua de Cobrança dá parcial como feito. E o refresh não resolve um
-- 'pendente' sem tentativa: quem o resolve é o item 4.
--
-- Data status (AGENTS.md, seção Gotchas): o item 3 reescreve anchor_port de
-- Comunicados de CE e Taxas já gravados. Depende da afirmação de que o banco de
-- produção não tem dados de negócio; as demais partes não alteram linhas.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_communication_recipient_key(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Igual a recipientKey() de supabase/functions/_shared/email.ts.
  SELECT 'sha256:' || encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$function$;

-- ponytail: uma consulta por alvo (tentativas dos Comunicados do alvo). Com
-- muitos alvos por rodada, trocar por um conjunto calculado uma vez na
-- produtora.
CREATE OR REPLACE FUNCTION public.customer_communication_target_done(
  p_kind text,
  p_customer_id bigint,
  p_voyage_id bigint,
  p_port text,
  p_atracacao_id uuid,
  p_emails text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH target_attempts AS (
    SELECT a.recipient_key,
      (a.dispatch_mode = 'real' AND (a.status = 'entregue' OR (a.status = 'aceito' AND a.provider_message_id IS NOT NULL)))
        OR (a.dispatch_mode = 'simulado' AND a.status IN ('aceito', 'entregue')) AS delivered,
      a.status IN ('bounce', 'complaint') AS refused_by_address
    FROM public.customer_communications c
    JOIN public.customer_communication_attempts a ON a.communication_id = c.id
    WHERE c.customer_id = p_customer_id
      AND c.kind = p_kind
      AND a.recipient_key IS NOT NULL
      AND CASE
        WHEN p_kind = 'aviso_atracacao_nob' THEN c.nature = 'avisos_operacionais' AND c.anchor_atracacao_id = p_atracacao_id
        -- CE e Taxas: Cliente × Viagem, envio da régua (discriminador 0), com
        -- qualquer porto gravado antes desta migration.
        WHEN p_kind = 'ce_mercante_taxas' THEN c.nature = 'documentacao' AND c.anchor_voyage_id = p_voyage_id
          AND c.attempt_discriminator = 0
        ELSE c.nature = 'avisos_operacionais' AND c.anchor_voyage_id = p_voyage_id
          AND public.normalize_port_code(c.anchor_port) = p_port
      END
  ), settled AS (
    SELECT t.recipient_key, bool_or(t.delivered) AS delivered
    FROM target_attempts t
    WHERE t.delivered OR t.refused_by_address
    GROUP BY t.recipient_key
  )
  SELECT CASE
    -- Sem destinatário: feito só se alguém já recebeu; senão o Cliente segue no
    -- alerta "Comunicado sem destinatário".
    WHEN COALESCE(cardinality(p_emails), 0) = 0 THEN EXISTS (SELECT 1 FROM settled s WHERE s.delivered)
    ELSE NOT EXISTS (
      SELECT 1 FROM unnest(p_emails) AS e(email)
      WHERE NOT EXISTS (
        SELECT 1 FROM settled s WHERE s.recipient_key = public.customer_communication_recipient_key(e.email)))
  END;
$function$;

-- Definição da migration 304 com a regra do item 1 no lugar do status.
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
    a.milestone_at, a.milestone_text, NULL::uuid, NULL::uuid, NULL::text, a.bl_ids, a.recipients
  FROM addressed a
  WHERE NOT public.customer_communication_target_done(a.kind, a.customer_id, a.voyage_id, a.port, NULL, a.recipients);

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
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  ), addressed AS (
    SELECT g.*, public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao', 'financeiro']) AS recipients
    FROM grouped g
    WHERE (public.customer_local_charges_communication_readiness(g.voyage_id, g.customer_id)->>'ready')::boolean
  )
  SELECT 'ce_mercante_taxas'::text, 'documentacao'::text,
    'ce_mercante_taxas:' || a.customer_id || ':' || a.voyage_id,
    a.customer_id, a.customer_name, a.cnpj_cpf, a.voyage_id, a.vessel_name, a.voyage_number,
    public.customer_local_charges_communication_port(a.voyage_id, a.customer_id),
    a.milestone_at, to_char(a.milestone_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    NULL::uuid, NULL::uuid, NULL::text, a.bl_ids, a.recipients
  FROM addressed a
  WHERE NOT public.customer_communication_target_done('ce_mercante_taxas', a.customer_id, a.voyage_id, NULL, NULL, a.recipients);

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
    a.state_id, a.terminal_id, a.terminal_code, a.bl_ids, a.recipients
  FROM addressed a
  WHERE NOT public.customer_communication_target_done('aviso_atracacao_nob', a.customer_id, a.voyage_id, a.port, a.state_id, a.recipients);
END;
$function$;

-- 2 -------------------------------------------------------------------------
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
    -- Último valor de cada campo por grafia exata do porto (entity_id).
    SELECT DISTINCT ON (a.entity_id, a.field_name)
      a.entity_id, a.field_name, a.new_value, a.changed_at, a.id
    FROM public.audit_logs a
    WHERE a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id ~ '^[0-9]+::[^:]+$'
      AND a.field_name IN ('eta', 'ata', 'deleted', 'omitted')
      AND (p_voyage_id IS NULL OR a.entity_id LIKE p_voyage_id::text || '::%')
    ORDER BY a.entity_id, a.field_name, a.changed_at DESC, a.id DESC
  ), spelling AS (
    -- Uma linha por grafia, com o próprio deleted.
    SELECT l.entity_id,
      split_part(l.entity_id, '::', 1)::bigint AS voyage_id,
      public.normalize_port_code(split_part(l.entity_id, '::', 2)) AS port,
      COALESCE(bool_or(l.field_name = 'deleted' AND public.customer_communication_flag(l.new_value)), false) AS deleted
    FROM latest l
    GROUP BY l.entity_id
  ), ports AS (
    -- Duas grafias do mesmo porto (BRVIT e BRVIX) são a mesma escala: ela só
    -- está excluída quando todas as grafias estão.
    SELECT s.voyage_id, s.port, bool_and(s.deleted) AS deleted
    FROM spelling s
    WHERE s.port IS NOT NULL
      AND (p_port IS NULL OR s.port = public.normalize_port_code(p_port))
    GROUP BY s.voyage_id, s.port
  ), chosen AS (
    -- ETA, ATA e omitted vêm das grafias ativas (ou de todas, se a escala está
    -- excluída); entre elas, vence o registro mais recente.
    SELECT DISTINCT ON (p.voyage_id, p.port, l.field_name)
      p.voyage_id, p.port, l.field_name, l.new_value
    FROM ports p
    JOIN spelling s ON s.voyage_id = p.voyage_id AND s.port = p.port AND s.deleted = p.deleted
    JOIN latest l ON l.entity_id = s.entity_id AND l.field_name IN ('eta', 'ata', 'omitted')
    ORDER BY p.voyage_id, p.port, l.field_name, l.changed_at DESC, l.id DESC
  )
  SELECT p.voyage_id, p.port,
    public.customer_communication_safe_timestamptz(x.eta_raw),
    public.customer_communication_milestone_text(x.eta_raw),
    public.customer_communication_safe_timestamptz(x.ata_raw),
    public.customer_communication_milestone_text(x.ata_raw),
    p.deleted,
    public.customer_communication_flag(x.omitted_raw)
  FROM ports p
  LEFT JOIN LATERAL (
    SELECT max(c.new_value) FILTER (WHERE c.field_name = 'eta') AS eta_raw,
      max(c.new_value) FILTER (WHERE c.field_name = 'ata') AS ata_raw,
      max(c.new_value) FILTER (WHERE c.field_name = 'omitted') AS omitted_raw
    FROM chosen c
    WHERE c.voyage_id = p.voyage_id AND c.port = p.port
  ) x ON true;
$function$;

-- 3 -------------------------------------------------------------------------
-- Definição da migration 304 com o porto nulo no CE e Taxas.
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
    -- 315: o porto não entra na identidade do CE (anchor_port nulo); o porto
    -- informativo vai só no corpo (customer_local_charges_communication_port).
    v_port := NULL;
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

-- CE e Taxas já gravados: a linha mais recente de cada identidade (sem o
-- porto) passa a anchor_port nulo, para o próximo envio cair nela. As outras
-- ficam como estão (histórico); o alvo as considera pelo item 1.
UPDATE public.customer_communications c
   SET anchor_port = NULL
 WHERE c.kind = 'ce_mercante_taxas'
   AND c.anchor_port IS NOT NULL
   AND c.id = (
     SELECT max(o.id) FROM public.customer_communications o
     WHERE o.kind = c.kind AND o.customer_id = c.customer_id
       AND o.anchor_voyage_id IS NOT DISTINCT FROM c.anchor_voyage_id
       AND o.anchor_atracacao_id IS NOT DISTINCT FROM c.anchor_atracacao_id
       AND o.anchor_invoice_id IS NOT DISTINCT FROM c.anchor_invoice_id
       AND o.dispatch_id IS NOT DISTINCT FROM c.dispatch_id
       AND o.attempt_discriminator = c.attempt_discriminator)
   AND NOT EXISTS (
     SELECT 1 FROM public.customer_communications o
     WHERE o.kind = c.kind AND o.customer_id = c.customer_id
       AND o.anchor_voyage_id IS NOT DISTINCT FROM c.anchor_voyage_id
       AND o.anchor_atracacao_id IS NOT DISTINCT FROM c.anchor_atracacao_id
       AND o.anchor_invoice_id IS NOT DISTINCT FROM c.anchor_invoice_id
       AND o.dispatch_id IS NOT DISTINCT FROM c.dispatch_id
       AND o.attempt_discriminator = c.attempt_discriminator
       AND o.anchor_port IS NULL);

-- 4 -------------------------------------------------------------------------
-- ponytail: até 500 Comunicados por rodada do detector, um refresh por
-- Comunicado. Um acúmulo maior drena em rodadas seguintes; com volume alto,
-- trocar por um UPDATE em lote com o mesmo cálculo do refresh.
CREATE OR REPLACE FUNCTION public.settle_stale_pending_customer_communications(
  p_stale_after interval DEFAULT interval '15 minutes'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_status text;
  v_settled integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT c.id
    FROM public.customer_communications c
    WHERE c.status = 'pendente'
      AND c.created_at < now() - p_stale_after
      -- Envio em andamento (tentativa criada ou atualizada há pouco) fica.
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_attempts a
        WHERE a.communication_id = c.id
          AND GREATEST(a.created_at, a.updated_at) >= now() - p_stale_after)
    ORDER BY c.id
    LIMIT 500
  LOOP
    v_status := public.refresh_customer_communication_status(v_row.id);
    IF v_status = 'pendente' THEN
      UPDATE public.customer_communications SET status = 'falha' WHERE id = v_row.id AND status = 'pendente';
      v_settled := v_settled + 1;
    END IF;
  END LOOP;
  RETURN v_settled;
END;
$function$;

-- Definição da migration 304 com a varredura do item 4 no início e o total
-- dela no retorno.
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
  v_stale_pending_settled INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- 315: Comunicado "Em envio" sem dono vira falha. Falha aqui não derruba os
  -- alertas abaixo.
  BEGIN
    v_stale_pending_settled := public.settle_stale_pending_customer_communications();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Comunicados pendentes nao reconciliados: %', SQLERRM;
  END;

  -- Um item por escala (NOA/NOR) ou Atracação (NOB) que ainda tem Cliente sem
  -- Comunicado entregue a todos os destinatários (migration 315; simulado
  -- conta, D4). Escala sem alvo não abre item.
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

  -- Fecha o que não é mais alvo: entregue a todos, janela vencida, escala
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
    'bounced_without_alternative', v_bounce_pending,
    'stale_pending_settled', v_stale_pending_settled
  );
END;
$function$;

-- 5 -------------------------------------------------------------------------
-- Definição da migration 303 com o filtro de alvo devido no lugar da folga de
-- 1 h depois de next_attempt_at.
-- ponytail: calcula todos os alvos da régua (customer_communication_automation_targets)
-- a cada chamada, que acontece por Cliente com alerta ativo em cada rodada da
-- produtora e a cada desfecho de claim. Com muitos Clientes, aceitar o
-- Cliente como parâmetro nos alvos.
CREATE OR REPLACE FUNCTION public.refresh_customer_communication_refusal_alert(p_customer_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_name text;
  v_claims jsonb;
  v_summary text;
  v_count integer;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  WITH due AS (
    SELECT t.claim_key
    FROM public.customer_communication_automation_targets(now()) t
    WHERE t.customer_id = p_customer_id
  )
  SELECT jsonb_agg(jsonb_build_object(
      'claim_key', cl.claim_key,
      'kind', split_part(cl.claim_key, ':', 1),
      'reason', COALESCE(cl.rejection_reason, cl.last_error),
      'permanent', cl.rejected_at IS NOT NULL,
      'attempts', cl.attempts,
      'next_attempt_at', cl.next_attempt_at
    ) ORDER BY cl.claim_key),
    string_agg(cl.claim_key || ' (' || COALESCE(cl.rejection_reason, cl.last_error, 'sem motivo')
      || CASE WHEN cl.rejected_at IS NULL AND cl.attempts > 0 THEN '; ' || cl.attempts || 'ª tentativa' ELSE '' END
      || ')', '; ' ORDER BY cl.claim_key),
    count(*)
  INTO v_claims, v_summary, v_count
  FROM public.customer_communication_automation_claims cl
  WHERE split_part(cl.claim_key, ':', 2) = p_customer_id::text
    -- Só a claim cujo alvo ainda está devido: o envio por outro caminho, a
    -- janela vencida ou o Cliente desativado tiram a claim do alerta.
    AND cl.claim_key IN (SELECT due.claim_key FROM due)
    AND (
      cl.rejected_at >= now() - interval '24 hours'
      OR (cl.rejected_at IS NULL
        AND cl.attempts > 0
        AND (cl.provider_failures = 0 OR cl.provider_failures >= 3))
    );

  BEGIN
    IF COALESCE(v_count, 0) = 0 THEN
      PERFORM public.resolve_alert_item('comunicado_recusado', 'customer', p_customer_id::text, 'comunicado_automacao', '{}'::jsonb);
      RETURN false;
    END IF;

    SELECT c.name INTO v_customer_name FROM public.customers c WHERE c.id = p_customer_id;
    PERFORM public.upsert_alert_item(
      'comunicado_recusado',
      'customer',
      p_customer_id::text,
      'Cliente ' || COALESCE(v_customer_name, p_customer_id::text) || ': ' || v_count
        || ' Comunicado(s) automático(s) sem envio: ' || v_summary,
      'comunicado_automacao',
      jsonb_build_object('customer_id', p_customer_id, 'claims', v_claims),
      '/clientes/comunicacao'
    );
  EXCEPTION WHEN OTHERS THEN
    -- Falha no alerta não desfaz o estado da claim: parar de ciclar vem antes.
    RAISE WARNING 'Alerta comunicado_recusado do Cliente % nao atualizado: %', p_customer_id, SQLERRM;
  END;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_communication_recipient_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_target_done(text, bigint, bigint, text, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_automation_targets(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_scale_schedules(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_anchor_validation(bigint, text, bigint, text, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_stale_pending_customer_communications(interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_customer_communication_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_customer_communication_refusal_alert(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_communication_target_done(text, bigint, bigint, text, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_automation_targets(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_scale_schedules(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_anchor_validation(bigint, text, bigint, text, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_stale_pending_customer_communications(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_customer_communication_alerts() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_customer_communication_refusal_alert(bigint) TO service_role;
