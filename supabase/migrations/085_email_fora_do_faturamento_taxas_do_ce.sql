-- Migration 085: o e-mail de contato deixa de ser condição de faturamento e a
-- fatura retida pelo Portal sai com as taxas do dia do CE (decisões do dono
-- em 2026-09-24, na revisão da PR #744; ADR 0070, nota de 2026-09-24 b).
--
-- - A fatura de Taxas Locais não é enviada por e-mail. Ela chega ao Cliente
--   pelo Portal ou por um usuário interno que a imprime e entrega. Por isso o
--   e-mail de contato sai de todas as condições de emissão:
--   - a Liberação de faturamento sem Portal é concedida e vale sem e-mail
--     (desfaz a exigência da 084);
--   - a pendência de revisão "Cliente sem e-mail cadastrado" deixa de existir,
--     com ou sem Portal;
--   - o Alerta review_customer_email_missing é aposentado no catálogo e os
--     itens abertos são resolvidos.
--   O e-mail de contato continua sendo usado pela cobrança de Demurrage e
--   pelos Comunicados, que não dependem desta pendência.
-- - Ao conceder a Liberação ou ativar o Portal, o reprocessamento emite com o
--   cálculo que a transição do CE gravou, sem recalcular pela tabela vigente.
--   O caminho da transição do CE não muda: ele continua calculando no momento
--   do CE. A conversão das linhas em USD segue a regra de toda emissão (ROE
--   vigente na emissão, create_invoice_from_bls_core).
--
-- Esta migration reescreve linhas existentes: aposenta um tipo em
-- alert_type_catalog e resolve os itens abertos desse tipo. Ela se apoia na
-- linha "Data status" do AGENTS.md: a base de produção só tem fixtures
-- descartáveis.

-- ---------------------------------------------------------------------------
-- 1. A Liberação vale sem e-mail de contato.
-- ---------------------------------------------------------------------------
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
  );
$$;

REVOKE ALL ON FUNCTION public.customer_billing_release_active(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_billing_release_active(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Pendências da revisão: sem e-mail de contato. O Portal vale sempre,
--    salvo Liberação vigente.
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
  -- tem efeito.
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSIF NOT public.customer_billing_access_ready(p_customer_id) THEN
    v_reasons := array_append(v_reasons, 'Acesso ao portal nao provisionado');
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
-- 3. Alertas de revisão do Cliente sem o de e-mail (corpo da 084 com essa
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

    -- Desde a 085 o e-mail de contato não é condição de faturamento: a fatura
    -- não é enviada por e-mail. O tipo foi aposentado; só fecha item antigo.
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);

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
-- 4. A concessão não exige e-mail de contato (corpo da 084 sem essa guarda;
--    o teto de 30 dias continua).
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

-- ---------------------------------------------------------------------------
-- 5. Emissão pelo caminho do CE com a opção de reaproveitar o cálculo do CE
--    (corpo da 083 da auto_bill_bl_after_ce_mercante, com o passo de cálculo
--    condicionado). A transição do CE usa o wrapper, que continua calculando.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._auto_bill_bl_core(
  p_bl_id text,
  p_actor uuid,
  p_reuse_calculation boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_calculation jsonb;
  v_ready jsonb;
  v_invoice jsonb;
  v_existing_invoice_id bigint;
  v_previous_context_table text := current_setting('vela.billing_context_table', true);
  v_previous_request_sub text := current_setting('request.jwt.claim.sub', true);
  v_context_table text := format('vela_auto_billing_%s', replace(gen_random_uuid()::text, '-', ''));
  v_impersonated boolean := false;
  v_context_created boolean := false;
  v_sqlstate text;
  v_error_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM auth.uid() OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para faturamento automatico.' USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Faturamento automatico sem ator validado.' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'bl_not_found',
      'bl_id', p_bl_id
    );
  END IF;

  -- Repetir o save/import não pode criar uma segunda invoice. O status do B/L
  -- é a guarda rápida; o link ativo cobre estados antigos parcialmente gravados.
  IF COALESCE(v_bl.financial_status, 'pending') <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'financial_status', v_bl.financial_status
    );
  END IF;

  SELECT inv.id
    INTO v_existing_invoice_id
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ORDER BY inv.id DESC
  LIMIT 1;

  IF v_existing_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'invoice_id', v_existing_invoice_id
    );
  END IF;

  IF NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'ce_mercante_missing',
      'bl_id', v_bl.id
    );
  END IF;

  IF v_bl.customer_id IS NULL
     OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'customer_reconciliation_pending',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'customer_reconciliation_status', v_bl.customer_reconciliation_status
    );
  END IF;

  -- O worker carrega o iniciador no GUC antes de chamar esta função. Em uma
  -- chamada server-side direta, o ator explícito recebe o mesmo tratamento.
  -- Só altere a identidade depois das saídas idempotentes acima e restaure-a
  -- em qualquer caminho, para não vazar o ator para o restante da sessão.
  IF auth.uid() IS DISTINCT FROM v_actor THEN
    PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
    v_impersonated := true;
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Ator inativo para faturamento automatico.' USING ERRCODE = '42501';
  END IF;

  -- O marcador é uma tabela temporária criada sob o owner do SECURITY
  -- DEFINER. O GUC só carrega o nome da tabela e é limpo antes de retornar.
  EXECUTE format(
    'CREATE TEMP TABLE pg_temp.%I (marker boolean NOT NULL) ON COMMIT DROP',
    v_context_table
  );
  v_context_created := true;
  EXECUTE format(
    'INSERT INTO pg_temp.%I(marker) VALUES (true)',
    v_context_table
  );
  PERFORM set_config('vela.billing_context_table', v_context_table, true);

  -- Taxas do dia do CE (decisão de 2026-09-24): ao abrir o gate, a fatura
  -- retida sai com o cálculo que a transição do CE já gravou. Só calcula
  -- quando o B/L nunca teve cálculo (não há cálculo do dia do CE a manter).
  -- `review_required` também é mantido: recalcular apagaria a revisão feita,
  -- e `mark_bl_ready_for_billing` recusa o B/L até a revisão terminar.
  IF p_reuse_calculation
     AND v_bl.charge_status IN ('calculated', 'reviewed', 'ready_for_billing', 'review_required', 'exempt') THEN
    v_calculation := jsonb_build_object('bl_id', v_bl.id, 'status', v_bl.charge_status, 'reused', true);
  ELSE
    v_calculation := public.calculate_bl_local_charges(v_bl.id, v_actor, true);
  END IF;

  -- Isenção legítima não possui linha positiva para uma invoice. O CE foi
  -- processado corretamente, mas não há documento financeiro a emitir.
  IF v_calculation->>'status' = 'exempt' THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN v_calculation || jsonb_build_object('status', 'skipped', 'reason', 'exempt');
  END IF;

  -- Trava universal do Portal (ADR 0070): sem Portal pronto e sem Liberação
  -- de faturamento vigente, o CE calcula mas não emite. A retenção fica no
  -- B/L e sai pela ativação do Portal ou pela concessão da Liberação, que
  -- reprocessam o Cliente. Não é falha: a fila de efeitos não é acionada.
  IF NOT public.customer_billing_access_ready(v_bl.customer_id) THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    UPDATE public.bls
       SET billing_hold_reason = COALESCE(NULLIF(btrim(billing_hold_reason), ''), 'Acesso ao portal nao provisionado')
     WHERE id = v_bl.id;
    PERFORM public.reconcile_customer_bl_review_alerts(v_bl.customer_id, NULL, 'portal_billing_hold');
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN jsonb_build_object(
      'status', 'held',
      'reason', 'portal_not_provisioned',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'calculation', v_calculation
    );
  END IF;

  v_ready := public.mark_bl_ready_for_billing(v_bl.id, v_actor);
  v_invoice := public.create_invoice_from_bls_core(
    ARRAY[v_bl.id],
    v_bl.customer_id,
    'Fatura automatica apos vinculacao do CE Mercante.',
    true,
    v_actor,
    'internal',
    NULL
  );

  IF NULLIF(v_invoice->>'invoice_id', '') IS NULL THEN
    RAISE EXCEPTION 'Emissao automatica nao retornou invoice para o B/L %.', v_bl.id
      USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
  v_context_created := false;
  PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
  PERFORM public.link_invoice_to_ledger((v_invoice->>'invoice_id')::bigint);

  IF v_impersonated THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
  END IF;

  RETURN jsonb_build_object(
    'status', 'invoiced',
    'idempotent', false,
    'bl_id', v_bl.id,
    'calculation', v_calculation,
    'ready', v_ready,
    'invoice', v_invoice
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_context_created THEN
      EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
      v_context_created := false;
    END IF;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;

    -- A atualização documental não é desfeita porque o efeito recuperável
    -- será criado pelo trigger. O worker registrará o bloqueio com o erro
    -- original e poderá ser reprocessado depois da correção operacional.
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'auto_billing_failed',
      'bl_id', p_bl_id,
      'sqlstate', v_sqlstate,
      'message', left(regexp_replace(COALESCE(v_error_message, ''), '[[:cntrl:]]', ' ', 'g'), 1000)
    );
END;
$$;

REVOKE ALL ON FUNCTION public._auto_bill_bl_core(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auto_bill_bl_core(text, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_bill_bl_after_ce_mercante(
  p_bl_id text,
  p_actor uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN public._auto_bill_bl_core(p_bl_id, p_actor, false);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_bill_bl_after_ce_mercante(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_bill_bl_after_ce_mercante(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Reprocessamento do Cliente quando o gate abre: emite com o cálculo do
--    dia do CE (corpo da 083 com essa mudança).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._reprocess_customer_held_billing(
  p_customer_id bigint,
  p_actor uuid,
  p_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_result jsonb;
  v_issued integer := 0;
  v_blocked integer := 0;
  v_failed integer := 0;
  v_sqlstate text;
BEGIN
  IF NOT public.customer_billing_access_ready(p_customer_id) THEN
    PERFORM public.reconcile_customer_bl_review_alerts(p_customer_id, NULL, p_source);
    RETURN jsonb_build_object('customer_id', p_customer_id, 'gate_open', false,
      'issued', 0, 'blocked', 0, 'failed', 0);
  END IF;

  -- Com o gate aberto, a retenção do Portal deixa de ser verdadeira. Quem não
  -- emitir abaixo fica com o próprio bloqueio, não com um motivo velho.
  UPDATE public.bls
     SET billing_hold_reason = NULL
   WHERE customer_id = p_customer_id
     AND COALESCE(financial_status, 'pending') = 'pending'
     AND billing_hold_reason = 'Acesso ao portal nao provisionado';

  FOR v_bl IN
    SELECT b.id
    FROM public.bls b
    WHERE b.customer_id = p_customer_id
      AND COALESCE(b.financial_status, 'pending') = 'pending'
      AND b.customer_reconciliation_status IN ('matched_document', 'reconciled')
    ORDER BY b.id
  LOOP
    -- Reaproveita o cálculo do dia do CE (085); não recalcula pela tabela de hoje.
    v_result := public._auto_bill_bl_core(v_bl.id, p_actor, true);
    IF v_result->>'status' = 'invoiced' THEN
      v_issued := v_issued + 1;
      PERFORM public.block521_resolve_alert('portal_reprocessamento_falhou', 'bl', v_bl.id, 'documentacao', p_source);
    ELSIF v_result->>'status' IN ('already_invoiced', 'skipped') THEN
      NULL;
    ELSE
      v_sqlstate := v_result->>'sqlstate';
      -- Bloqueio de negócio (CE, revisão, tabela, gate) é esperado e fica na
      -- Validação; só falha técnica abre o Alerta de reprocessamento.
      IF v_result->>'reason' = 'auto_billing_failed'
         AND COALESCE(v_sqlstate, '') NOT IN ('P0003', '22023', 'P0002', 'P0004') THEN
        v_failed := v_failed + 1;
        PERFORM public.block521_upsert_alert('portal_reprocessamento_falhou', 'bl', v_bl.id,
          'Falha técnica ao reprocessar faturamento após abertura do gate do Portal.', p_source, 'documentacao',
          jsonb_build_object('sqlstate', v_sqlstate, 'error', v_result->>'message'),
          '/manifestos/' || v_bl.id || '?tab=faturamento');
      ELSE
        v_blocked := v_blocked + 1;
      END IF;
    END IF;
  END LOOP;

  PERFORM public.reconcile_customer_bl_review_alerts(p_customer_id, NULL, p_source);
  RETURN jsonb_build_object('customer_id', p_customer_id, 'gate_open', true,
    'issued', v_issued, 'blocked', v_blocked, 'failed', v_failed);
END;
$$;

REVOKE ALL ON FUNCTION public._reprocess_customer_held_billing(bigint, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Aposenta o Alerta de e-mail ausente e fecha os itens abertos.
--    resolve_alert_item não consulta o catálogo e fecha item histórico.
-- ---------------------------------------------------------------------------
DO $resolve$
DECLARE
  v_item record;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_item IN
    SELECT DISTINCT a.entity_type, a.entity_id
    FROM public.alert_items AS ai
    JOIN public.alerts AS a ON a.id = ai.alert_id
    WHERE ai.item_type = 'review_customer_email_missing'
      AND ai.status = 'active'
  LOOP
    PERFORM public.resolve_alert_item('review_customer_email_missing', v_item.entity_type, v_item.entity_id,
      'migration_085_email_nao_e_condicao', '{}'::jsonb);
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
END;
$resolve$;

UPDATE public.alert_type_catalog
SET active = false
WHERE type = 'review_customer_email_missing';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.alert_type_catalog WHERE type = 'review_customer_email_missing' AND active) THEN
    RAISE EXCEPTION 'review_customer_email_missing continua ativo no catálogo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.alert_items WHERE item_type = 'review_customer_email_missing' AND status = 'active') THEN
    RAISE EXCEPTION 'Ainda há Alerta de e-mail ausente aberto.';
  END IF;
END;
$verify$;
