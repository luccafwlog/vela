-- Migration 084: e-mail de contato e teto da Liberação de faturamento sem
-- Portal (decisões de 2026-09-24 sobre a ADR 0070; plano arquivado
-- docs/archive/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md).
--
-- - E-mail de contato só é exigido de quem fatura sem Portal. Com Portal
--   pronto, o Cliente vê a fatura no Portal, e a emissão (manual ou pelo CE)
--   não depende de contato com e-mail. Sem Portal, pela Liberação, o e-mail é
--   o único canal: a Liberação só vale, e só pode ser concedida, com contato
--   ativo com e-mail.
-- - A data de revisão da Liberação fica limitada a 30 dias.
--
-- O contexto interno da 051 deixa de mudar qualquer gate: `p_skip_portal`
-- segue na assinatura por compatibilidade, sem efeito.
--
-- Nenhuma linha existente é reescrita.

-- ---------------------------------------------------------------------------
-- 1. Duas perguntas separadas: o Portal está pronto? Há e-mail de contato?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_portal_billing_ready(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_portal_accounts a
    WHERE a.customer_id = p_customer_id
      AND a.active = true
      AND a.account_situation = 'ativo'
      AND a.auth_user_id IS NOT NULL
      AND NULLIF(btrim(a.recovery_email), '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      AND COALESCE(a.recovery_email_status, 'ok') = 'ok'
      AND NOT EXISTS (
        SELECT 1
        FROM public.portal_suppressed_emails s
        WHERE s.email = lower(btrim(a.recovery_email))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.customer_portal_billing_ready(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_portal_billing_ready(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.customer_has_contact_email(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_contacts AS c
    WHERE c.customer_id = p_customer_id
      AND c.deactivated_at IS NULL
      AND NULLIF(btrim(c.email), '') IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.customer_has_contact_email(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_has_contact_email(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. A Liberação só vale com e-mail de contato; o gate é Portal ou Liberação.
-- ---------------------------------------------------------------------------
-- ponytail: se o último e-mail de contato for desativado com a Liberação
-- vigente, o gate fecha e o CE volta a reter, mas nada reprocessa quando um
-- e-mail novo é cadastrado; renovar a Liberação reprocessa. Caminho de
-- evolução: trigger em customer_contacts chamando o reprocessamento.
CREATE OR REPLACE FUNCTION public.customer_billing_release_active(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_billing_portal_releases AS r
    WHERE r.customer_id = p_customer_id
      AND r.revoked_at IS NULL
      AND r.review_at > now()
  )
  AND public.customer_has_contact_email(p_customer_id);
$$;

CREATE OR REPLACE FUNCTION public.customer_billing_access_ready(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_customer_id IS NOT NULL
    AND (
      public.customer_portal_billing_ready(p_customer_id)
      OR public.customer_billing_release_active(p_customer_id)
    );
$$;

-- ---------------------------------------------------------------------------
-- 3. Pendências da revisão: e-mail só sem Portal; Portal sempre, salvo
--    Liberação vigente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._compute_bl_review_pendencies(
  p_customer_id bigint,
  p_cargo_mode text,
  p_bb_weight_ton numeric,
  p_skip_portal boolean
) RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  -- `p_skip_portal` fica na assinatura por compatibilidade (051/083) e não
  -- tem mais efeito: manual e automático seguem a mesma regra.
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSE
    IF NOT public.customer_portal_billing_ready(p_customer_id)
       AND NOT public.customer_has_contact_email(p_customer_id) THEN
      v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
    END IF;
    IF NOT public.customer_billing_access_ready(p_customer_id) THEN
      v_reasons := array_append(v_reasons, 'Acesso ao portal nao provisionado');
    END IF;
  END IF;

  IF p_cargo_mode IN ('carga_solta', 'misto')
     AND (p_bb_weight_ton IS NULL OR p_bb_weight_ton <= 0) THEN
    v_reasons := array_append(v_reasons, 'Peso BB ausente');
  END IF;
  RETURN v_reasons;
END;
$$;

REVOKE ALL ON FUNCTION public._compute_bl_review_pendencies(bigint, text, numeric, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. O Alerta de e-mail ausente segue a mesma regra (corpo da 083 com essa
--    mudança).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_customer_bl_review_alerts(
  p_customer_id bigint,
  p_consignee text,
  p_source text DEFAULT 'bl_review_gate'::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_customer_name text;
  v_customer_label text;
  v_entity_id text;
  v_consignee_key text;
  v_has_email boolean := false;
  v_portal_ready boolean := false;
  v_portal_held integer := 0;
  v_total_pending integer := 0;
  v_bb_pending integer := 0;
  v_msg text;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM public.customers WHERE id = p_customer_id;
    v_customer_label := COALESCE(v_customer_name, 'Cliente #' || p_customer_id::text);
    v_entity_id := p_customer_id::text;

    SELECT EXISTS (
      SELECT 1 FROM public.customer_contacts AS c
      WHERE c.customer_id = p_customer_id
        AND c.deactivated_at IS NULL
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;
    -- A Liberação de faturamento sem Portal satisfaz o mesmo gate da emissão.
    v_portal_ready := public.customer_billing_access_ready(p_customer_id);
    -- B/Ls cuja fatura o CE reteve por falta de Portal (ADR 0070) contam junto
    -- com os pendentes de revisão: é o que o Portal está segurando.
    SELECT count(*) INTO v_portal_held
    FROM public.bls
    WHERE customer_id = p_customer_id
      AND COALESCE(financial_status, 'pending') = 'pending'
      AND review_status IS DISTINCT FROM 'pending_review'
      AND billing_hold_reason = 'Acesso ao portal nao provisionado';

    SELECT count(*), count(*) FILTER (
      WHERE cargo_mode IN ('carga_solta', 'misto')
        AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0)
    ) INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id = p_customer_id AND review_status = 'pending_review';

    -- Desde a 084 o e-mail de contato só é exigido de quem fatura sem Portal.
    IF v_total_pending > 0 AND NOT v_has_email AND NOT public.customer_portal_billing_ready(p_customer_id) THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de revisão (sem e-mail cadastrado)'
             ELSE ' B/Ls pendentes de revisão (sem e-mail cadastrado)' END;
      PERFORM public.upsert_alert_item(
        'review_customer_email_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_total_pending + v_portal_held > 0 AND NOT v_portal_ready THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || (v_total_pending + v_portal_held) ||
        CASE WHEN v_total_pending + v_portal_held = 1 THEN ' B/L pendente (Conta de Portal não provisionada)'
             ELSE ' B/Ls pendentes (Conta de Portal não provisionada)' END;
      PERFORM public.upsert_alert_item(
        'review_portal_not_ready', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending, 'held_count', v_portal_held),
        '/clientes/portal?cliente=' || p_customer_id::text
      );
    ELSE
      PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_bb_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;
    PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
  ELSE
    v_consignee_key := COALESCE(NULLIF(btrim(p_consignee), ''), 'sem_cliente');
    v_entity_id := v_consignee_key;

    SELECT count(*), count(*) FILTER (
      WHERE cargo_mode IN ('carga_solta', 'misto')
        AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0)
    ) INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id IS NULL
      AND review_status = 'pending_review'
      AND COALESCE(NULLIF(btrim(consignee), ''), 'sem_cliente') = v_consignee_key;

    IF v_total_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de vínculo com cliente'
             ELSE ' B/Ls pendentes de vínculo com cliente' END;
      PERFORM public.upsert_alert_item(
        'review_customer_unlinked', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_total_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_bb_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. A concessão exige e-mail de contato e respeita o teto de 30 dias (corpo
--    da 083 com essas duas guardas).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_customer_billing_portal_release(
  p_customer_id bigint,
  p_justification text,
  p_review_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_release_id bigint;
  v_reprocess jsonb;
BEGIN
  IF v_actor IS NULL OR public._portal_actor_role() IS DISTINCT FROM 'administrativo' THEN
    RAISE EXCEPTION 'Somente o Administrativo concede a liberação de faturamento sem Portal.' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_justification, ''))) < 3 THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF p_review_at IS NULL OR p_review_at <= now() THEN
    RAISE EXCEPTION 'A data de revisão precisa ser futura.' USING ERRCODE = '22023';
  END IF;
  -- Teto de 30 dias, contados em dias de Brasília (decisão de 2026-09-24).
  IF (p_review_at AT TIME ZONE 'America/Sao_Paulo')::date
     > (now() AT TIME ZONE 'America/Sao_Paulo')::date + 30 THEN
    RAISE EXCEPTION 'A data de revisão pode ser no máximo 30 dias à frente.' USING ERRCODE = '22023';
  END IF;

  -- Serializa concessões concorrentes do mesmo Cliente.
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.customer_has_contact_email(p_customer_id) THEN
    RAISE EXCEPTION 'Cadastre um contato com e-mail antes de liberar: sem Portal, o e-mail é o único canal da fatura.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_billing_portal_releases
     SET revoked_at = now(),
         revoked_by = v_actor,
         revoke_reason = 'Substituída por nova liberação.'
   WHERE customer_id = p_customer_id
     AND revoked_at IS NULL;

  INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
  VALUES (p_customer_id, btrim(p_justification), v_actor, p_review_at)
  RETURNING id INTO v_release_id;

  v_reprocess := public._reprocess_customer_held_billing(p_customer_id, v_actor, 'portal_billing_release');

  RETURN jsonb_build_object('release_id', v_release_id, 'reprocess', v_reprocess);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_customer_billing_portal_release(bigint, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_customer_billing_portal_release(bigint, text, timestamptz) TO authenticated, service_role;

-- Defesa em profundidade para o teto: 31 dias absorvem o fim do dia em
-- Brasília escolhido pela tela.
ALTER TABLE public.customer_billing_portal_releases
  DROP CONSTRAINT IF EXISTS customer_billing_portal_releases_review_max_check;
ALTER TABLE public.customer_billing_portal_releases
  ADD CONSTRAINT customer_billing_portal_releases_review_max_check
  CHECK (review_at <= granted_at + interval '31 days');
