-- Migration 318: revisão rigorosa do núcleo dos Comunicados (PR #973): os
-- alvos da régua levam só os destinatários ainda não resolvidos; a Escala
-- excluída segue a grafia gravada por último; a âncora operacional grava o
-- porto normalizado; a claim que entrou no alerta comunicado_recusado fica nele
-- até o envio sair.
--
-- Plano dos e-mails (docs/plans/2026-10-17-correcao-dos-emails.md), itens 1C,
-- 1D, 2.6 e 3.4; decisões D1, D2, D4 e D18. Regra em docs/modules/clientes.md,
-- "Régua automática de Comunicados".
--
-- 1. customer_communication_target_pending_recipients (nova): devolve os
--    destinatários do alvo que ainda faltam, com a mesma conta da migration 315
--    (obrigatórios = atuais que já eram contato elegível no 1º Comunicado do
--    alvo; resolvido = tentativa entregue ou devolvida, simulada aceita conta
--    como entregue). Sem obrigatório, faltam os atuais sem tentativa resolvida,
--    só se ninguém recebeu. NULL quando o alvo está feito.
--    customer_communication_target_done passa a ser "pendentes IS NULL" e
--    customer_communication_automation_targets devolve em `emails` só os
--    pendentes. Antes, os alvos devolviam todos os destinatários atuais e o
--    runner enviava a todos: com a chave ligada depois de um NOA simulado para
--    a@ (b@ falhou sem tentativa), a rodada seguinte mandava e-mail real a a@
--    (a Edge só reaproveita, no modo real, tentativa com id do provedor ou
--    entregue) e ao contato c@ cadastrado depois, contra a D1 ("Nada sai de
--    novo") e a regra do contato novo.
-- 2. customer_communication_scale_schedules: a Escala está excluída quando
--    nenhuma grafia está ativa ou quando a grafia gravada por último (qualquer
--    campo do Histórico da Viagem) está excluída; empate fica com a ativa. Na
--    315 bastava uma grafia ativa: o "Excluir escala" da Viagem
--    (delete_escala) grava deleted na grafia normalizada (BRVIX), e a Escala de
--    dados legados em BRVIT continuava ativa para a régua — e passaria a
--    continuar na tela, que agora segue esta mesma regra
--    (projectVoyageEscalaSchedules). Escala excluída em BRVIT e recriada em
--    BRVIX depois continua ativa. A grafia passa a existir com qualquer campo
--    gravado, como na tela.
-- 3. customer_communication_anchor_validation: NOA, NOR e NOB devolvem o porto
--    normalizado (normalize_port_code), que create_customer_communication_atomic
--    grava em anchor_port. O disparo manual com B/L em BRVIT gravava 'BRVIT' e
--    a régua grava 'BRVIX': duas identidades do mesmo Comunicado.
-- 4. Alerta comunicado_recusado: coluna refusal_alerted_at nas claims. A claim
--    entra no alerta como antes (recusa definitiva, 1ª recusa por dado, 3ª
--    falha seguida do provedor) e fica nele até o envio sair
--    (complete_customer_communication_automation_claim zera a coluna) ou o alvo
--    deixar de estar devido. Antes, uma falha do provedor depois de uma recusa
--    por dado (provider_failures = 1) e a retomada da claim recusada pela
--    produtora (rejected_at limpo, attempts = 0) tiravam a claim do alerta, que
--    era resolvido sem nada ter saído e reaberto na recusa seguinte, com nova
--    notificação.
-- 5. refresh_customer_communication_refusal_alert: o cálculo dos alvos e a
--    marcação da coluna ficam dentro do bloco de exceção, como na migration
--    303: falha no alerta não desfaz o estado da claim (defer, reject,
--    complete).
--
-- Data status (AGENTS.md, seção Gotchas): o item 4 preenche refusal_alerted_at
-- das claims que hoje estão no alerta (reescreve linhas existentes de
-- customer_communication_automation_claims). Depende da afirmação de que o
-- banco de produção não tem dados de negócio; as demais partes não alteram
-- linhas.

-- 1 -------------------------------------------------------------------------
-- Conta da customer_communication_target_done da migration 315, devolvendo os
-- pendentes em vez de um booleano.
CREATE OR REPLACE FUNCTION public.customer_communication_target_pending_recipients(
  p_kind text,
  p_customer_id bigint,
  p_voyage_id bigint,
  p_port text,
  p_atracacao_id uuid,
  p_emails text[]
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH target_communications AS (
    SELECT c.id, c.created_at
    FROM public.customer_communications c
    WHERE c.customer_id = p_customer_id
      AND c.kind = p_kind
      AND CASE
        WHEN p_kind = 'aviso_atracacao_nob' THEN c.nature = 'avisos_operacionais' AND c.anchor_atracacao_id = p_atracacao_id
        -- CE e Taxas: Cliente × Viagem, envio da régua (discriminador 0), com
        -- qualquer porto gravado antes da migration 315.
        WHEN p_kind = 'ce_mercante_taxas' THEN c.nature = 'documentacao' AND c.anchor_voyage_id = p_voyage_id
          AND c.attempt_discriminator = 0
        ELSE c.nature = 'avisos_operacionais' AND c.anchor_voyage_id = p_voyage_id
          AND public.normalize_port_code(c.anchor_port) = p_port
      END
  ), first_try AS (
    -- O alvo foi tentado pela 1ª vez quando nasceu o 1º Comunicado dele.
    SELECT min(tc.created_at) AS at FROM target_communications tc
  ), target_attempts AS (
    SELECT a.recipient_key,
      (a.dispatch_mode = 'real' AND (a.status = 'entregue' OR (a.status = 'aceito' AND a.provider_message_id IS NOT NULL)))
        OR (a.dispatch_mode = 'simulado' AND a.status IN ('aceito', 'entregue')) AS delivered,
      a.status IN ('bounce', 'complaint') AS refused_by_address
    FROM target_communications tc
    JOIN public.customer_communication_attempts a ON a.communication_id = tc.id
    WHERE a.recipient_key IS NOT NULL
  ), settled AS (
    SELECT t.recipient_key, bool_or(t.delivered) AS delivered
    FROM target_attempts t
    WHERE t.delivered OR t.refused_by_address
    GROUP BY t.recipient_key
  ), current_recipients AS (
    SELECT e.email, e.ord
    FROM unnest(COALESCE(p_emails, '{}'::text[])) WITH ORDINALITY AS e(email, ord)
  ), required AS (
    -- Destinatários que o alvo precisa cobrir: os atuais que já eram contato
    -- elegível na 1ª tentativa. Contato cadastrado (ou ligado à caixa) depois
    -- não torna o alvo devido de novo; sem Comunicado ainda, todos contam.
    SELECT r.email, r.ord
    FROM current_recipients r
    CROSS JOIN first_try f
    WHERE f.at IS NULL
       OR EXISTS (
        SELECT 1
        FROM public.customer_contacts cc
        JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
        WHERE cc.customer_id = p_customer_id
          AND lower(btrim(cc.email)) = lower(btrim(r.email))
          AND ccb.box_code = ANY(CASE WHEN p_kind = 'ce_mercante_taxas'
            THEN ARRAY['documentacao_operacao', 'financeiro'] ELSE ARRAY['documentacao_operacao'] END)
          AND GREATEST(cc.created_at, ccb.created_at) <= f.at)
  ), pool AS (
    -- Sem obrigatório (nenhum contato, ou só contatos novos), o alvo vale
    -- para os atuais — se ninguém recebeu (ver o SELECT final).
    SELECT r.email, r.ord FROM required r
    UNION ALL
    SELECT c.email, c.ord FROM current_recipients c WHERE NOT EXISTS (SELECT 1 FROM required)
  ), pending AS (
    SELECT p.email, p.ord
    FROM pool p
    WHERE NOT EXISTS (
      SELECT 1 FROM settled s WHERE s.recipient_key = public.customer_communication_recipient_key(p.email))
  )
  SELECT CASE
    -- Com obrigatório: faltam os que não têm tentativa resolvida; nenhum
    -- (array_agg de zero linhas é NULL) é alvo feito.
    WHEN EXISTS (SELECT 1 FROM required) THEN (SELECT array_agg(p.email ORDER BY p.ord) FROM pending p)
    -- Sem obrigatório: feito se alguém já recebeu; senão o alvo segue devido
    -- para os atuais (vazio abre "Comunicado sem destinatário").
    WHEN EXISTS (SELECT 1 FROM settled s WHERE s.delivered) THEN NULL
    ELSE COALESCE((SELECT array_agg(p.email ORDER BY p.ord) FROM pending p), '{}'::text[])
  END;
$function$;

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
  SELECT public.customer_communication_target_pending_recipients(
    p_kind, p_customer_id, p_voyage_id, p_port, p_atracacao_id, p_emails) IS NULL;
$function$;

-- Definição da migration 315 com os pendentes do item 1 em `emails`.
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

-- 2 -------------------------------------------------------------------------
-- Definição da migration 315 com a grafia gravada por último decidindo a
-- exclusão. Espelho na tela: projectVoyageEscalaSchedules
-- (src/services/voyageRouteSchedules.ts).
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
    -- Último valor de cada campo por grafia exata do porto (entity_id). Todo
    -- campo conta para a grafia existir e para "gravada por último".
    SELECT DISTINCT ON (a.entity_id, a.field_name)
      a.entity_id, a.field_name, a.new_value, a.changed_at, a.id
    FROM public.audit_logs a
    WHERE a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id ~ '^[0-9]+::[^:]+$'
      AND (p_voyage_id IS NULL OR a.entity_id LIKE p_voyage_id::text || '::%')
    ORDER BY a.entity_id, a.field_name, a.changed_at DESC, a.id DESC
  ), spelling AS (
    -- Uma linha por grafia, com o próprio deleted e a última gravação.
    SELECT l.entity_id,
      split_part(l.entity_id, '::', 1)::bigint AS voyage_id,
      public.normalize_port_code(split_part(l.entity_id, '::', 2)) AS port,
      COALESCE(bool_or(l.field_name = 'deleted' AND public.customer_communication_flag(l.new_value)), false) AS deleted,
      max(l.changed_at) AS last_at
    FROM latest l
    GROUP BY l.entity_id
  ), ports AS (
    -- Duas grafias do mesmo porto (BRVIT e BRVIX) são a mesma Escala. Ela está
    -- excluída quando nenhuma grafia está ativa ou quando a gravada por último
    -- está excluída (empate fica com a ativa).
    SELECT s.voyage_id, s.port,
      NOT bool_or(NOT s.deleted)
        OR COALESCE(max(s.last_at) FILTER (WHERE s.deleted) > max(s.last_at) FILTER (WHERE NOT s.deleted), false) AS deleted
    FROM spelling s
    WHERE s.port IS NOT NULL
      AND (p_port IS NULL OR s.port = public.normalize_port_code(p_port))
    GROUP BY s.voyage_id, s.port
  ), chosen AS (
    -- ETA, ATA e omitted vêm das grafias ativas (ou das excluídas, se a Escala
    -- está excluída); entre elas, vence o registro mais recente.
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
-- Definição da migration 315 com o porto normalizado no NOA, NOR e NOB.
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
    -- 318: a identidade grava o porto normalizado, o mesmo da régua
    -- (BRVIT e BRVIX caem no mesmo Comunicado).
    v_port := public.normalize_port_code(v_port);
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

-- 4 -------------------------------------------------------------------------
ALTER TABLE public.customer_communication_automation_claims
  ADD COLUMN IF NOT EXISTS refusal_alerted_at timestamptz;

COMMENT ON COLUMN public.customer_communication_automation_claims.refusal_alerted_at IS
  'Quando a claim entrou no alerta comunicado_recusado (recusa definitiva, 1ª recusa por dado ou 3ª falha seguida do provedor). '
  'Fica preenchida até o envio sair (complete_customer_communication_automation_claim) ou o alvo deixar de estar devido; '
  'falha do provedor depois de recusa por dado e a retomada da claim recusada não a tiram do alerta (migration 318).';

-- Claims que hoje estão no alerta (regra da migration 315, sem o filtro de
-- alvo devido, que o refresh aplica na próxima chamada).
UPDATE public.customer_communication_automation_claims
   SET refusal_alerted_at = now()
 WHERE refusal_alerted_at IS NULL
   AND (rejected_at >= now() - interval '24 hours'
     OR (rejected_at IS NULL AND attempts > 0 AND (provider_failures = 0 OR provider_failures >= 3)));

-- Definição da migration 303 com refusal_alerted_at zerada.
CREATE OR REPLACE FUNCTION public.complete_customer_communication_automation_claim(p_claim_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_claim_key IS NULL OR btrim(p_claim_key) = '' THEN
    RAISE EXCEPTION 'Chave da claim e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_communication_automation_claims
  SET attempts = 0, provider_failures = 0, last_error = NULL, next_attempt_at = NULL,
      rejected_at = NULL, rejection_reason = NULL, refusal_alerted_at = NULL
  WHERE claim_key = p_claim_key;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM public.refresh_customer_communication_refusal_alert(public.customer_communication_claim_customer_id(p_claim_key));
  RETURN true;
END;
$function$;

-- 4 e 5 ---------------------------------------------------------------------
-- Definição da migration 315 com a entrada e a saída do alerta pela coluna
-- refusal_alerted_at e todo o cálculo dentro do bloco de exceção.
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
  v_due text[];
  v_alerted boolean := false;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_due := ARRAY(
      SELECT t.claim_key
      FROM public.customer_communication_automation_targets(now()) t
      WHERE t.customer_id = p_customer_id);

    -- Entrada: recusa definitiva, 1ª recusa por dado ou 3ª falha seguida do
    -- provedor, com o alvo ainda devido.
    UPDATE public.customer_communication_automation_claims cl
       SET refusal_alerted_at = now()
     WHERE split_part(cl.claim_key, ':', 2) = p_customer_id::text
       AND cl.refusal_alerted_at IS NULL
       AND cl.claim_key = ANY(v_due)
       AND (cl.rejected_at IS NOT NULL
         OR (cl.attempts > 0 AND (cl.provider_failures = 0 OR cl.provider_failures >= 3)));

    -- Saída sem envio: o alvo deixou de estar devido (envio por outro caminho,
    -- janela vencida, Cliente desativado). O envio da régua sai pelo complete.
    UPDATE public.customer_communication_automation_claims cl
       SET refusal_alerted_at = NULL
     WHERE split_part(cl.claim_key, ':', 2) = p_customer_id::text
       AND cl.refusal_alerted_at IS NOT NULL
       AND NOT (cl.claim_key = ANY(v_due));

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
      AND cl.refusal_alerted_at IS NOT NULL;

    IF COALESCE(v_count, 0) = 0 THEN
      PERFORM public.resolve_alert_item('comunicado_recusado', 'customer', p_customer_id::text, 'comunicado_automacao', '{}'::jsonb);
    ELSE
      v_alerted := true;
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
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Falha no alerta (inclusive no cálculo dos alvos) não desfaz o estado da
    -- claim gravado por quem chamou: parar de ciclar vem antes.
    RAISE WARNING 'Alerta comunicado_recusado do Cliente % nao atualizado: %', p_customer_id, SQLERRM;
  END;
  RETURN v_alerted;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_communication_target_pending_recipients(text, bigint, bigint, text, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_target_done(text, bigint, bigint, text, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_automation_targets(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_scale_schedules(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_anchor_validation(bigint, text, bigint, text, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_customer_communication_automation_claim(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_customer_communication_refusal_alert(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_communication_target_pending_recipients(text, bigint, bigint, text, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_target_done(text, bigint, bigint, text, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_automation_targets(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_scale_schedules(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_communication_anchor_validation(bigint, text, bigint, text, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_customer_communication_automation_claim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_customer_communication_refusal_alert(bigint) TO service_role;
