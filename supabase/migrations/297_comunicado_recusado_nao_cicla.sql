-- Migration 297: recusa definitiva de Comunicado automático para de ciclar.
--
-- O runner customer-communication-auto-runner liberava a claim a cada 422 da
-- Edge send-customer-communication, e a produtora também retomava qualquer
-- claim com mais de 30 minutos. Uma recusa que não muda sem alteração de
-- código ou payload (ex.: o CE Mercante recusado por "anexos" com lista vazia)
-- virava um loop: ~250 recusas em 24 h, 84 rodadas × 3 destinatários.
--
-- 1. customer_communication_automation_claims ganha rejected_at e
--    rejection_reason.
-- 2. reject_customer_communication_automation_claim(p_claim_key, p_reason),
--    server-only como release_customer_communication_automation_claim: marca a
--    claim recusada e abre o alerta comunicado_recusado para a triagem.
-- 3. evaluate_and_dispatch_automatic_communications: a definição da migration
--    244 com uma única mudança no ON CONFLICT dos três blocos (NOA/NOR, CE e
--    NOB): claim recusada nas últimas 24 h não volta como candidata. Ao
--    retomar depois da janela, a marca de recusa é limpa.
--
-- Só adiciona colunas anuláveis sem default; não altera nem apaga linhas.

ALTER TABLE public.customer_communication_automation_claims
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('comunicado_recusado', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/comunicacao')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reject_customer_communication_automation_claim(p_claim_key text, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'Recusa sem motivo informado.'), 500);
  v_kind text;
  v_customer_id bigint;
  v_customer_name text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_claim_key IS NULL OR btrim(p_claim_key) = '' THEN
    RAISE EXCEPTION 'Chave da claim e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_communication_automation_claims
  SET rejected_at = now(), rejection_reason = v_reason
  WHERE claim_key = p_claim_key;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Toda chave da produtora começa por kind:customer_id:...
  v_kind := split_part(p_claim_key, ':', 1);
  IF split_part(p_claim_key, ':', 2) ~ '^[0-9]+$' THEN
    v_customer_id := split_part(p_claim_key, ':', 2)::bigint;
    SELECT c.name INTO v_customer_name FROM public.customers c WHERE c.id = v_customer_id;
  END IF;

  IF v_customer_id IS NOT NULL THEN
    -- Falha no alerta não desfaz a recusa: a claim parar de ciclar vem antes.
    BEGIN
      PERFORM public.upsert_alert_item(
        'comunicado_recusado',
        'customer',
        v_customer_id::text,
        'Cliente ' || COALESCE(v_customer_name, v_customer_id::text) || ': Comunicado automático ' || v_kind || ' recusado pelo envio. Motivo: ' || v_reason,
        'comunicado_automacao',
        jsonb_build_object('customer_id', v_customer_id, 'kind', v_kind, 'claim_key', p_claim_key, 'reason', v_reason),
        '/clientes/comunicacao'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta comunicado_recusado da claim % nao gravado: %', p_claim_key, SQLERRM;
    END;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_customer_communication_automation_claim(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_customer_communication_automation_claim(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_schedule record;
  v_customer_bl record;
  v_candidates jsonb := '[]'::jsonb;
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_kind text;
  v_milestone timestamptz;
  v_key text;
  v_voyage_id bigint;
  v_vessel_name text;
  v_voyage_number text;
  v_port text;
  v_atracacao record;
  v_nob_suppressed boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- NOA/NOR: somente D-5 até antes do ETA; NOR a partir do ATA no dia do marco.
  FOR v_schedule IN
    WITH entities AS (
      SELECT DISTINCT entity_id
      FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule'
        AND entity_id ~ '^[0-9]+::[^:]+$'
    ), latest AS (
      SELECT e.entity_id,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'eta' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS eta,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'ata' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS ata,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS deleted,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS omitted
      FROM entities e
    )
    SELECT
      split_part(l.entity_id, '::', 1)::bigint AS voyage_id,
      split_part(l.entity_id, '::', 2) AS port,
      l.eta, l.ata, v.voyage_number, vs.name AS vessel_name
    FROM latest l
    JOIN public.voyages v ON v.id = split_part(l.entity_id, '::', 1)::bigint
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE NOT l.deleted AND NOT l.omitted
      AND v.status IS DISTINCT FROM 'cancelled'
      AND ((l.ata IS NULL AND l.eta IS NOT NULL
            AND v_as_of >= l.eta - interval '5 days' AND v_as_of < l.eta)
        OR (l.ata IS NOT NULL AND l.ata BETWEEN v_as_of - interval '30 days' AND v_as_of))
  LOOP
    v_voyage_id := v_schedule.voyage_id;
    v_vessel_name := v_schedule.vessel_name;
    v_voyage_number := v_schedule.voyage_number;
    v_port := v_schedule.port;
    v_kind := CASE WHEN v_schedule.ata IS NOT NULL THEN 'aviso_prontidao_nor' ELSE 'aviso_chegada_noa' END;
    v_milestone := CASE WHEN v_kind = 'aviso_prontidao_nor' THEN v_schedule.ata ELSE v_schedule.eta END;

    FOR v_customer_bl IN
      SELECT b.customer_id,
        array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name,
        c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), ''))
          FILTER (WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
            AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
      JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
      WHERE b.voyage_id = v_schedule.voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(v_schedule.port)
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND cc.deactivated_at IS NULL
        AND ccb.box_code = 'documentacao_operacao'
        AND NULLIF(btrim(cc.email), '') IS NOT NULL
        AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = v_kind
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_voyage_id = v_schedule.voyage_id
            AND public.normalize_port_code(sent.anchor_port) = public.normalize_port_code(v_schedule.port)
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      v_key := v_kind || ':' || v_customer_bl.customer_id || ':' || v_schedule.voyage_id || ':' || public.normalize_port_code(v_schedule.port);
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL, rejected_at = NULL, rejection_reason = NULL
        WHERE (customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes')
          AND (customer_communication_automation_claims.rejected_at IS NULL
           OR customer_communication_automation_claims.rejected_at < v_as_of - interval '24 hours');
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key, 'kind', v_kind, 'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_schedule.voyage_id,
          'vessel_name', v_schedule.vessel_name, 'voyage_number', v_schedule.voyage_number,
          'port', v_schedule.port, 'milestone_at', v_milestone,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  -- CE Mercante: produtor server-side durável, independente da tela de B/L.
  FOR v_customer_bl IN
    SELECT b.voyage_id, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      v.voyage_number, vs.name AS vessel_name, min(b.pod) AS port,
      v.eta AS milestone_at, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
      array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), '')) AS emails
    FROM public.bls b
    JOIN public.customers c ON c.id = b.customer_id
    JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
    JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
    WHERE b.customer_id IS NOT NULL
      AND v.status IS DISTINCT FROM 'cancelled'
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND cc.deactivated_at IS NULL
      AND ccb.box_code IN ('documentacao_operacao', 'financeiro')
      AND NULLIF(btrim(cc.email), '') IS NOT NULL
      AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails pse WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente')
      AND NOT EXISTS (SELECT 1 FROM public.customer_communication_suppressions ccs WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email)))
      AND (public.customer_local_charges_communication_readiness(b.voyage_id, b.customer_id)->>'ready')::boolean
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications sent
        WHERE sent.customer_id = b.customer_id AND sent.kind = 'ce_mercante_taxas'
          AND sent.nature = 'documentacao' AND sent.status IN ('enviado', 'simulado')
          AND sent.anchor_voyage_id = b.voyage_id AND sent.attempt_discriminator = 0
      )
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  LOOP
    v_key := 'ce_mercante_taxas:' || v_customer_bl.customer_id || ':' || v_customer_bl.voyage_id;
    INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL, rejected_at = NULL, rejection_reason = NULL
        WHERE (customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes')
          AND (customer_communication_automation_claims.rejected_at IS NULL
           OR customer_communication_automation_claims.rejected_at < v_as_of - interval '24 hours');
    IF FOUND THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'claim_key', v_key, 'kind', 'ce_mercante_taxas', 'nature', 'documentacao',
        'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
        'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_customer_bl.voyage_id,
        'vessel_name', v_customer_bl.vessel_name, 'voyage_number', v_customer_bl.voyage_number,
        'port', COALESCE(v_customer_bl.port, '—'), 'milestone_at', v_customer_bl.milestone_at,
        'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
      ));
    END IF;
  END LOOP;

  -- NOB: o agrupamento já contém todos os B/Ls elegíveis do cliente para a
  -- atracação. A claim só é criada depois da composição, evitando que um B/L
  -- puro consuma a claim antes que o B/L misto entre no mesmo envio.
  -- P3: clientes sem contatos válidos disparam alerta nob_sem_destinatario.
  FOR v_atracacao IN
    SELECT ts.id AS state_id, ts.voyage_id, upper(btrim(ts.port)) AS port,
      ts.terminal_id, ts.terminal_atb,
      public.voyage_terminal_code(ts.terminal_id) AS terminal_code,
      v.voyage_number, vs.name AS vessel_name
    FROM public.voyage_escala_terminal_state ts
    JOIN public.voyages v ON v.id = ts.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE ts.terminal_id IS NOT NULL
      AND v.status IS DISTINCT FROM 'cancelled'
      AND ts.terminal_atb IS NOT NULL
      AND ts.terminal_atb <= v_as_of
      AND ts.terminal_atb >= v_as_of - interval '30 days'
      AND public.voyage_terminal_code(ts.terminal_id) IS NOT NULL
  LOOP
    SELECT COALESCE((
      SELECT lower(btrim(a.new_value)) = 'true'
      FROM public.audit_logs a
      WHERE a.entity_type = 'voyage_pod_schedule'
        AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
        AND a.field_name = 'deleted'
      ORDER BY a.changed_at DESC, a.id DESC LIMIT 1
    ), false) INTO v_nob_suppressed;
    v_nob_suppressed := v_nob_suppressed OR COALESCE((
      SELECT lower(btrim(a.new_value)) = 'true'
      FROM public.audit_logs a
      WHERE a.entity_type = 'voyage_pod_schedule'
        AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
        AND a.field_name = 'omitted'
      ORDER BY a.changed_at DESC, a.id DESC LIMIT 1
    ), false);
    CONTINUE WHEN v_nob_suppressed;

    FOR v_customer_bl IN
      SELECT b.customer_id,
        array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name,
        c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), ''))
          FILTER (WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
            AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      LEFT JOIN (
        public.customer_contacts cc
        JOIN public.customer_contact_box_links ccb
          ON ccb.contact_id = cc.id
         AND ccb.box_code = 'documentacao_operacao'
      ) ON cc.customer_id = b.customer_id
       AND cc.deactivated_at IS NULL
       AND NULLIF(btrim(cc.email), '') IS NOT NULL
       AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       AND NOT EXISTS (
         SELECT 1 FROM public.portal_suppressed_emails pse
         WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.customer_communication_suppressions ccs
         WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
       )
      WHERE b.voyage_id = v_atracacao.voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(v_atracacao.port)
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        -- Regra única do NOB (ADR 0068, item 7; migration 243): a mesma da RPC,
        -- da Edge Function e da conferência manual.
        AND public.bl_belongs_to_atracacao(b.id, v_atracacao.state_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = 'aviso_atracacao_nob'
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_atracacao_id = v_atracacao.state_id
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      IF COALESCE(cardinality(v_customer_bl.emails), 0) = 0 THEN
        -- Falha no alerta não aborta a rodada dos outros Clientes (B4).
        BEGIN
        PERFORM public.upsert_alert_item(
          'nob_sem_destinatario',
          'customer',
          v_customer_bl.customer_id::text,
          'Cliente ' || v_customer_bl.customer_name || ': possui carga na atracação mas sem contato ativo na caixa documentacao_operacao para envio do NOB.',
          'nob_automacao',
          jsonb_build_object('customer_id', v_customer_bl.customer_id, 'bl_ids', v_customer_bl.bl_ids, 'atracacao_id', v_atracacao.state_id),
          '/clientes'
        );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'Alerta nob_sem_destinatario do Cliente % nao gravado: %', v_customer_bl.customer_id, SQLERRM;
        END;
        CONTINUE;
      ELSE
        BEGIN
          PERFORM public.resolve_alert_item('nob_sem_destinatario', 'customer', v_customer_bl.customer_id::text, 'nob_automacao', '{}'::jsonb);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'Alerta nob_sem_destinatario do Cliente % nao resolvido: %', v_customer_bl.customer_id, SQLERRM;
        END;
      END IF;

      v_key := 'aviso_atracacao_nob:' || v_customer_bl.customer_id || ':' || v_atracacao.state_id;
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL, rejected_at = NULL, rejection_reason = NULL
        WHERE (customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes')
          AND (customer_communication_automation_claims.rejected_at IS NULL
           OR customer_communication_automation_claims.rejected_at < v_as_of - interval '24 hours');
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key,
          'kind', 'aviso_atracacao_nob',
          'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id,
          'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf,
          'voyage_id', v_atracacao.voyage_id,
          'vessel_name', v_atracacao.vessel_name,
          'voyage_number', v_atracacao.voyage_number,
          'port', v_atracacao.port,
          'milestone_at', v_atracacao.terminal_atb,
          'anchor_atracacao_id', v_atracacao.state_id,
          'terminal_id', v_atracacao.terminal_id,
          'terminal_name', v_atracacao.terminal_code,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids),
          'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_candidates;
END;
$function$;
