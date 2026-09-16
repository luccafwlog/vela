-- 051: CE Mercante e o gatilho server-side do faturamento automático.
--
-- O fluxo anterior deixava a emissão dependente de um callback React depois de
-- `save_bl_review`; importações de CE e outros RPCs só recalculavam as taxas e
-- colocavam um efeito na fila. A transição do CE passa a ser a fonte de verdade:
-- calcula, valida e emite na mesma transação, com a fila como recuperação para
-- bloqueios operacionais.
--
-- A conta do Portal continua sendo exigida pelos fluxos originados no Portal.
-- O contexto interno é representado por uma tabela temporária criada sob o
-- owner da função privada abaixo e permite que o faturamento interno não
-- dependa de provisionamento do Portal.

-- ---------------------------------------------------------------------------
-- 1. Contexto privado do faturamento automático.
-- ---------------------------------------------------------------------------
-- GUCs de sessão são ponteiros, não credenciais: o nome aponta para uma tabela
-- temporária criada pelo SECURITY DEFINER. O owner da tabela precisa ser o
-- mesmo owner desta função; portanto, uma sessão autenticada não consegue
-- forjar o contexto apenas chamando set_config com um nome próprio.
CREATE OR REPLACE FUNCTION public.is_internal_auto_billing_context()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.oid = pg_catalog.pg_my_temp_schema()
      AND c.relname = current_setting('vela.billing_context_table', true)
      AND c.relpersistence = 't'
      AND c.relkind = 'r'
      AND c.relowner = (
        SELECT r.oid
        FROM pg_catalog.pg_roles AS r
        WHERE r.rolname = current_user
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_internal_auto_billing_context() FROM PUBLIC, anon, authenticated;

-- O Portal não é pré-requisito do faturamento interno automático.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_billing_access_ready(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_customer_id IS NOT NULL
    AND (
      public.is_internal_auto_billing_context()
      OR EXISTS (
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
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- 2. As triggers financeiros preservam o gate do Portal, exceto no contexto
--    interno automático criado pela função abaixo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_portal_invoice_bl_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status text;
  v_gate jsonb;
BEGIN
  IF public.is_internal_auto_billing_context() THEN
    RETURN NEW;
  END IF;

  SELECT status
    INTO v_status
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF v_status = 'issued' THEN
    v_gate := public.portal_billing_gate(NEW.bl_id);
    IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
      RAISE EXCEPTION 'Faturamento bloqueado pelo Portal para B/L %: %', NEW.bl_id, v_gate->>'reason'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_portal_invoice_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_gate jsonb;
  v_bl record;
BEGIN
  IF public.is_internal_auto_billing_context() THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'issued' THEN
    IF NEW.bl_id IS NOT NULL THEN
      v_gate := public.portal_billing_gate(NEW.bl_id);
      IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'Faturamento bloqueado pelo Portal: %', v_gate->>'reason'
          USING ERRCODE = 'P0003';
      END IF;
    END IF;

    FOR v_bl IN
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = NEW.id
    LOOP
      v_gate := public.portal_billing_gate(v_bl.bl_id);
      IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'Faturamento bloqueado pelo Portal para B/L %: %', v_bl.bl_id, v_gate->>'reason'
          USING ERRCODE = 'P0003';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- A prontidão do Portal não deve transformar um CE já validado em pendência
-- financeira. O e-mail continua sendo uma pendência da revisão normal; no
-- contexto transacional do faturamento automático, somente os dados do B/L e
-- da carga continuam governando a elegibilidade.
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
  v_has_email boolean := false;
BEGIN
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSIF NOT COALESCE(p_skip_portal, false) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.customer_contacts AS c
      WHERE c.customer_id = p_customer_id
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    )
    INTO v_has_email;

    IF NOT v_has_email THEN
      v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
    END IF;

    IF NOT public.customer_portal_access_ready(p_customer_id) THEN
      v_reasons := array_append(v_reasons, 'Acesso ao portal nao provisionado');
    END IF;
  END IF;

  IF p_cargo_mode = 'carga_solta'
     AND (p_bb_weight_ton IS NULL OR p_bb_weight_ton <= 0) THEN
    v_reasons := array_append(v_reasons, 'Peso BB ausente');
  END IF;

  RETURN v_reasons;
END;
$$;

REVOKE ALL ON FUNCTION public._compute_bl_review_pendencies(bigint, text, numeric, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(
  p_customer_id bigint,
  p_cargo_mode text,
  p_bb_weight_ton numeric
) RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public._compute_bl_review_pendencies(
    p_customer_id,
    p_cargo_mode,
    p_bb_weight_ton,
    public.is_internal_auto_billing_context()
  );
$$;

CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(p_bl_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_reasons text[];
BEGIN
  SELECT customer_id, cargo_mode, bb_weight_ton, financial_status
    INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RETURN ARRAY[]::text[];
  END IF;

  -- Uma revisão posterior à emissão não reabre uma pendência de e-mail/Portal
  -- que já não participa do faturamento interno. O booleano é argumento de
  -- uma função privada, não um marcador que o chamador possa forjar.
  IF COALESCE(v_bl.financial_status, 'pending') <> 'pending' THEN
    v_reasons := public._compute_bl_review_pendencies(
      v_bl.customer_id,
      v_bl.cargo_mode,
      v_bl.bb_weight_ton,
      true
    );
    RETURN v_reasons;
  END IF;

  RETURN public.compute_bl_review_pendencies(
    v_bl.customer_id,
    v_bl.cargo_mode,
    v_bl.bb_weight_ton
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Função privada e idempotente que materializa o contrato do CE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_bill_bl_after_ce_mercante(
  p_bl_id text,
  p_actor uuid DEFAULT NULL::uuid
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
  v_context_table text := format('vela_auto_billing_%s_%s', pg_backend_pid(), txid_current());
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

  -- O worker carrega o iniciador no GUC antes de chamar esta função. Em uma
  -- chamada server-side direta, o ator explícito recebe o mesmo tratamento.
  IF auth.uid() IS DISTINCT FROM v_actor THEN
    PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Ator inativo para faturamento automatico.' USING ERRCODE = '42501';
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

  -- O marcador é uma tabela temporária criada sob o owner do SECURITY
  -- DEFINER. O GUC só carrega o nome da tabela e é limpo antes de retornar.
  EXECUTE format(
    'CREATE TEMP TABLE pg_temp.%I (marker boolean NOT NULL) ON COMMIT DROP',
    v_context_table
  );
  EXECUTE format(
    'INSERT INTO pg_temp.%I(marker) VALUES (true)',
    v_context_table
  );
  PERFORM set_config('vela.billing_context_table', v_context_table, true);

  v_calculation := public.calculate_bl_local_charges(v_bl.id, v_actor, true);

  -- Isenção legítima não possui linha positiva para uma invoice. O CE foi
  -- processado corretamente, mas não há documento financeiro a emitir.
  IF v_calculation->>'status' = 'exempt' THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    RETURN v_calculation || jsonb_build_object('status', 'skipped', 'reason', 'exempt');
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

  PERFORM public.link_invoice_to_ledger((v_invoice->>'invoice_id')::bigint);
  EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
  PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);

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
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);

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

-- O consumidor é server-only; o trigger e o dispatcher são os únicos callers.
REVOKE ALL ON FUNCTION public.auto_bill_bl_after_ce_mercante(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_bill_bl_after_ce_mercante(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Trigger de transição documental e de reconciliação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auto_bill_bl_after_ce_mercante()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  v_result := public.auto_bill_bl_after_ce_mercante(NEW.id, v_actor);

  IF v_result->>'status' NOT IN ('invoiced', 'already_invoiced', 'skipped')
     AND v_actor IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.import_pending_effects AS e
       WHERE e.entity_id = NEW.id
         AND e.effect_kind = 'local_billing'
         AND e.status IN ('pending', 'running', 'retry_wait')
     ) THEN
    PERFORM public.enqueue_import_effect(
      gen_random_uuid(),
      'local_billing',
      NEW.id,
      v_actor,
      1,
      NULL,
      jsonb_build_object(
        'source', 'ce_mercante_auto_billing',
        'ce_mercante', NEW.ce_mercante,
        'reason', v_result->>'reason',
        'message', v_result->>'message'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_auto_bill_bl_after_ce_mercante() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auto_bill_bl_after_ce_mercante ON public.bls;
CREATE TRIGGER trg_auto_bill_bl_after_ce_mercante
AFTER UPDATE OF ce_mercante, customer_id, customer_reconciliation_status ON public.bls
FOR EACH ROW
WHEN (
  (
    NULLIF(BTRIM(OLD.ce_mercante), '') IS NULL
    AND NULLIF(BTRIM(NEW.ce_mercante), '') IS NOT NULL
  )
  OR (
    NULLIF(BTRIM(NEW.ce_mercante), '') IS NOT NULL
    AND NEW.customer_id IS NOT NULL
    AND (
      OLD.customer_id IS DISTINCT FROM NEW.customer_id
      OR OLD.customer_reconciliation_status IS DISTINCT FROM NEW.customer_reconciliation_status
    )
  )
)
EXECUTE FUNCTION public.trg_auto_bill_bl_after_ce_mercante();

-- As RPCs antigas de importação ainda registram um local_billing depois do
-- UPDATE. Se o trigger já criou o efeito de recuperação, absorva somente essa
-- segunda linha de mesma revisão para não deixar duas tentativas concorrentes.
CREATE OR REPLACE FUNCTION public.suppress_duplicate_ce_auto_billing_effect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_existing_id bigint;
  v_bl_financial_status text;
BEGIN
  IF NEW.effect_kind IS DISTINCT FROM 'local_billing'
     OR NEW.status IS DISTINCT FROM 'pending'
     OR COALESCE(NEW.source_snapshot, '{}'::jsonb)->>'source' = 'ce_mercante_auto_billing' THEN
    RETURN NEW;
  END IF;

  SELECT b.financial_status
    INTO v_bl_financial_status
  FROM public.bls AS b
  WHERE b.id = NEW.entity_id;

  SELECT e.id
    INTO v_existing_id
  FROM public.import_pending_effects AS e
  WHERE e.entity_id = NEW.entity_id
    AND e.effect_kind = NEW.effect_kind
    AND e.source_revision = NEW.source_revision
    AND e.status IN ('pending', 'running', 'retry_wait')
    AND COALESCE(e.source_snapshot, '{}'::jsonb)->>'source' = 'ce_mercante_auto_billing'
  ORDER BY e.id
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    NEW.status := 'superseded';
    NEW.superseded_by_effect_id := v_existing_id;
    NEW.lease_until := NULL;
    NEW.leased_by := NULL;
    NEW.next_attempt_at := now();
    NEW.result := COALESCE(NEW.result, '{}'::jsonb) || jsonb_build_object(
      'superseded_by_effect_id', v_existing_id,
      'deduplicated', true
    );
    NEW.updated_at := now();
  ELSIF COALESCE(v_bl_financial_status, 'pending') <> 'pending' THEN
    -- Quando a emissão imediata terminou antes da RPC legada registrar seu
    -- efeito, a linha de origem já não tem trabalho financeiro a executar.
    NEW.status := 'superseded';
    NEW.lease_until := NULL;
    NEW.leased_by := NULL;
    NEW.next_attempt_at := now();
    NEW.result := COALESCE(NEW.result, '{}'::jsonb) || jsonb_build_object(
      'already_invoiced', true,
      'financial_status', v_bl_financial_status
    );
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.suppress_duplicate_ce_auto_billing_effect() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_suppress_duplicate_ce_auto_billing_effect ON public.import_pending_effects;
CREATE TRIGGER trg_suppress_duplicate_ce_auto_billing_effect
BEFORE INSERT ON public.import_pending_effects
FOR EACH ROW
EXECUTE FUNCTION public.suppress_duplicate_ce_auto_billing_effect();

-- ---------------------------------------------------------------------------
-- 5. A fila antiga de local_billing passa a emitir quando o CE já existe.
--    Efeitos criados pela origem continuam válidos; se o trigger já emitiu,
--    o resultado abaixo é idempotente e não recalcula um B/L faturado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges(
  p_entity_id text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl_id text;
  v_voyage_id bigint;
  v_container_numbers text[];
  v_bl_ids text[];
  v_result jsonb := '[]'::jsonb;
  v_calculated integer := 0;
  v_financial_status text;
  v_ce_mercante text;
  v_one jsonb;
BEGIN
  SELECT b.id, b.voyage_id, b.financial_status, b.ce_mercante
    INTO v_bl_id, v_voyage_id, v_financial_status, v_ce_mercante
  FROM public.bls AS b
  WHERE b.id = NULLIF(btrim(p_entity_id), '');

  IF v_bl_id IS NOT NULL THEN
    IF COALESCE(v_financial_status, 'pending') <> 'pending' THEN
      RETURN jsonb_build_object(
        'entity_id', p_entity_id,
        'calculated', 0,
        'results', jsonb_build_array(jsonb_build_object(
          'status', 'already_invoiced',
          'idempotent', true,
          'bl_id', v_bl_id,
          'financial_status', v_financial_status
        ))
      );
    END IF;

    SELECT COALESCE(array_agg(DISTINCT upper(btrim(c.container_number))), ARRAY[]::text[])
      INTO v_container_numbers
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL;

    IF cardinality(v_container_numbers) = 0 THEN
      v_container_numbers := NULL;
    END IF;
  ELSE
    IF NULLIF(btrim(p_entity_id), '') IS NULL OR p_entity_id !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Entidade de efeito local desconhecida: %.', p_entity_id
        USING ERRCODE = 'P0002';
    END IF;

    SELECT v.id
      INTO v_voyage_id
    FROM public.voyages AS v
    WHERE v.id = p_entity_id::bigint;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem de efeito local nao encontrada: %.', p_entity_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.id ORDER BY b.id), ARRAY[]::text[])
    INTO v_bl_ids
  FROM public.bls AS b
  WHERE b.voyage_id = v_voyage_id
    AND COALESCE(b.cargo_mode, 'container') = 'container'
    AND COALESCE(b.financial_status, 'pending') = 'pending'
    AND (
      COALESCE(b.charge_status, '') <> 'ready_for_billing'
      OR NULLIF(btrim(b.ce_mercante), '') IS NOT NULL
    )
    AND (
      v_container_numbers IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.bl_containers AS c
        WHERE c.bl_id = b.id
          AND upper(btrim(c.container_number)) = ANY(v_container_numbers)
      )
    );

  -- Um efeito criado por um B/L sem containers ainda precisa produzir um
  -- resultado de domínio (review/no_containers), em vez de desaparecer.
  IF v_bl_id IS NOT NULL AND cardinality(v_bl_ids) = 0 THEN
    v_bl_ids := ARRAY[v_bl_id];
  END IF;

  IF cardinality(v_bl_ids) = 0 THEN
    RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', 0, 'results', v_result);
  END IF;

  FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
    SELECT b.financial_status, b.ce_mercante
      INTO v_financial_status, v_ce_mercante
    FROM public.bls AS b
    WHERE b.id = v_bl_id;

    IF COALESCE(v_financial_status, 'pending') <> 'pending' THEN
      v_one := jsonb_build_object(
        'status', 'already_invoiced',
        'idempotent', true,
        'bl_id', v_bl_id,
        'financial_status', v_financial_status
      );
    ELSIF NULLIF(btrim(COALESCE(v_ce_mercante, '')), '') IS NOT NULL THEN
      v_one := public.auto_bill_bl_after_ce_mercante(v_bl_id, p_actor);
      IF v_one->>'status' = 'blocked' THEN
        RAISE EXCEPTION 'Faturamento automatico do B/L % bloqueado: %', v_bl_id, v_one->>'message'
          USING ERRCODE = 'P0003';
      END IF;
    ELSE
      v_one := public.calculate_bl_local_charges(v_bl_id, p_actor, true);
    END IF;

    v_result := v_result || jsonb_build_array(v_one);
    v_calculated := v_calculated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'entity_id', p_entity_id,
    'calculated', v_calculated,
    'results', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public._run_import_effect_local_charges(text, uuid) FROM PUBLIC, anon, authenticated;
