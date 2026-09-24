-- Migration 083: Portal como trava universal do faturamento e Liberação de
-- faturamento sem Portal (decisões R4, R5 e 3.6 de 2026-09-23; plano
-- docs/archive/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md; ADR 0070).
--
-- - A 051 deixava a emissão automática pelo CE passar sem Portal, por um
--   contexto interno. Agora nenhuma emissão passa sem Portal pronto, inclusive
--   a automática: o CE calcula, retém a fatura no B/L com
--   `billing_hold_reason = 'Acesso ao portal nao provisionado'` e avisa.
-- - A saída é por Cliente: ativar o Portal ou o Administrativo conceder uma
--   Liberação de faturamento sem Portal, com justificativa, autor e data de
--   revisão. As duas reprocessam o Cliente e emitem o que foi retido.
-- - Vencida a data de revisão, a trava volta sozinha (o gate lê `now()`).
-- - O Alerta `review_portal_not_ready` continua com a Documentação e passa a
--   avisar também o Administrativo.
--
-- O contexto interno da 051 continua existindo só para dispensar o e-mail de
-- contato na emissão automática; ele não dispensa mais o Portal.
--
-- Esta migration reescreve uma linha de configuração existente (a audiência
-- do tipo `review_portal_not_ready` em `alert_type_catalog`). Ela se apoia na
-- linha "Data status" do AGENTS.md: a base de produção só tem fixtures
-- descartáveis.

-- ---------------------------------------------------------------------------
-- 1. Liberação de faturamento sem Portal, por Cliente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_billing_portal_releases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  justification text NOT NULL,
  granted_by uuid NOT NULL REFERENCES public.user_profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  review_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.user_profiles(id),
  revoke_reason text,
  CONSTRAINT customer_billing_portal_releases_justification_check
    CHECK (char_length(btrim(justification)) >= 3),
  CONSTRAINT customer_billing_portal_releases_review_check
    CHECK (review_at > granted_at),
  CONSTRAINT customer_billing_portal_releases_revoke_check
    CHECK (
      (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL
          AND char_length(btrim(COALESCE(revoke_reason, ''))) >= 3)
    )
);

COMMENT ON TABLE public.customer_billing_portal_releases IS
  'Liberação de faturamento sem Portal (ADR 0070). Vigente enquanto não revogada e review_at > now().';

-- Uma liberação aberta (não revogada) por Cliente; renovar revoga a anterior.
CREATE UNIQUE INDEX IF NOT EXISTS customer_billing_portal_releases_open_uidx
  ON public.customer_billing_portal_releases (customer_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.customer_billing_portal_releases ENABLE ROW LEVEL SECURITY;

-- Leitura para a equipe interna; escrita só pelas RPCs abaixo. O Portal não
-- enxerga a tabela: `is_active_user()` exige perfil interno.
DROP POLICY IF EXISTS customer_billing_portal_releases_select ON public.customer_billing_portal_releases;
CREATE POLICY customer_billing_portal_releases_select
  ON public.customer_billing_portal_releases
  FOR SELECT TO authenticated
  USING (public.is_active_user());

REVOKE ALL ON TABLE public.customer_billing_portal_releases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.customer_billing_portal_releases TO authenticated;
GRANT ALL ON TABLE public.customer_billing_portal_releases TO service_role;

DROP TRIGGER IF EXISTS audit_customer_billing_portal_releases ON public.customer_billing_portal_releases;
CREATE TRIGGER audit_customer_billing_portal_releases
AFTER DELETE OR UPDATE ON public.customer_billing_portal_releases
FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');

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

-- ponytail: a vigência é lida na hora (review_at > now()), sem job. A trava
-- volta no instante do vencimento, mas o Alerta só reaparece no próximo
-- evento que reconcilia o Cliente (nova retenção pelo CE, revisão ou o
-- detector de revisão). Se o vencimento precisar avisar por si, o caminho é
-- um pg_cron diário que reconcilie os Clientes com liberação vencida.
REVOKE ALL ON FUNCTION public.customer_billing_release_active(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_billing_release_active(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. O gate: Portal pronto ou Liberação vigente. Sem exceção interna.
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
      public.customer_billing_release_active(p_customer_id)
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

-- `reason` continua dizendo o que falta no Portal; com a Liberação vigente a
-- emissão é permitida e `released_without_portal` registra o motivo.
CREATE OR REPLACE FUNCTION public.portal_billing_gate(p_bl_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $_$
DECLARE
  v_customer_id BIGINT;
  v_account public.customer_portal_accounts%ROWTYPE;
  v_reason TEXT;
  v_email TEXT;
  v_released BOOLEAN := false;
BEGIN
  SELECT customer_id INTO v_customer_id FROM public.bls WHERE id = p_bl_id;
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Cliente não reconciliado para faturamento.');
  END IF;

  SELECT * INTO v_account
  FROM public.customer_portal_accounts
  WHERE customer_id = v_customer_id;

  v_email := lower(NULLIF(btrim(v_account.recovery_email), ''));
  IF v_account.id IS NULL OR NOT COALESCE(v_account.active, false)
     OR v_account.account_situation <> 'ativo'
     OR v_account.auth_user_id IS NULL THEN
    v_reason := 'Portal do Cliente não está ativo.';
  ELSIF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    v_reason := 'Email de recuperação ausente ou inválido.';
  ELSIF COALESCE(v_account.recovery_email_status, 'ok') <> 'ok'
     OR EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = v_email) THEN
    v_reason := 'Email de recuperação suprimido ou sem entrega utilizável.';
  END IF;

  IF v_reason IS NOT NULL THEN
    v_released := public.customer_billing_release_active(v_customer_id);
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_reason IS NULL OR v_released,
    'reason', v_reason,
    'released_without_portal', v_released,
    'customer_id', v_customer_id,
    'account_id', v_account.id,
    'recovery_email', v_email
  );
END;
$_$;

-- ---------------------------------------------------------------------------
-- 3. As triggers financeiros deixam de dispensar o contexto interno.
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

-- ---------------------------------------------------------------------------
-- 4. Pendências da revisão: o Portal vale sempre; o contexto interno só
--    dispensa o e-mail de contato (corpo da 059 com essa separação).
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
  v_has_email boolean := false;
BEGIN
  -- `p_skip_portal` manteve o nome da 051 por compatibilidade de assinatura;
  -- desde a 083 ele dispensa só o e-mail de contato.
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSE
    IF NOT COALESCE(p_skip_portal, false) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.customer_contacts AS c
        WHERE c.customer_id = p_customer_id
          AND c.deactivated_at IS NULL
          AND NULLIF(btrim(c.email), '') IS NOT NULL
      ) INTO v_has_email;

      IF NOT v_has_email THEN
        v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
      END IF;
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
-- 5. O CE retém a emissão quando o gate está fechado (corpo da 051 com a
--    retenção antes de `mark_bl_ready_for_billing`).
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

  v_calculation := public.calculate_bl_local_charges(v_bl.id, v_actor, true);

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

REVOKE ALL ON FUNCTION public.auto_bill_bl_after_ce_mercante(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_bill_bl_after_ce_mercante(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_auto_bill_bl_after_ce_mercante()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_previous_request_role text := current_setting('request.jwt.claim.role', true);
  v_role_impersonated boolean := false;
  v_result jsonb;
BEGIN
  v_result := public.auto_bill_bl_after_ce_mercante(NEW.id, v_actor);

  -- `held` é a retenção do Portal: quem a desfaz é a ativação do Portal ou a
  -- Liberação, não uma nova tentativa da fila.
  IF v_result->>'status' NOT IN ('invoiced', 'already_invoiced', 'skipped', 'held')
     AND NOT EXISTS (
       SELECT 1
       FROM public.import_pending_effects AS e
       WHERE e.entity_id = NEW.id
         AND e.effect_kind = 'local_billing'
         AND e.status IN ('pending', 'running', 'retry_wait')
     ) THEN
    -- A trigger disparado por uma conexão sem JWT já passou pela autorização
    -- da operação que alterou o B/L. Para deixar a recuperação registrada sem
    -- inventar um usuário, chama a fila como service_role e restaura o claim
    -- imediatamente depois do insert.
    IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      v_role_impersonated := true;
    END IF;

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
        'message', v_result->>'message',
        'actor_source', CASE WHEN v_actor IS NULL THEN 'system' ELSE 'request' END
      )
    );

    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
      v_role_impersonated := false;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_auto_bill_bl_after_ce_mercante() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. O Alerta de Portal não provisionado conta os B/Ls retidos e respeita a
--    Liberação (corpo da 060 com essas duas mudanças).
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

    IF v_total_pending > 0 AND NOT v_has_email THEN
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
-- 7. Reprocessamento do Cliente quando o gate abre.
--    Usa o mesmo caminho do CE (`auto_bill_bl_after_ce_mercante`), para que
--    ativar o Portal ou conceder a Liberação emita exatamente o que a
--    transição do CE teria emitido.
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
    v_result := public.auto_bill_bl_after_ce_mercante(v_bl.id, p_actor);
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

-- Contrato preservado para a Edge Function `portal-invite-activate`.
CREATE OR REPLACE FUNCTION public.reprocess_customer_billing_after_portal_activation(p_customer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_actor FROM public.user_profiles WHERE active AND role IN ('admin', 'administrativo') ORDER BY created_at, id LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Não há usuário Administrativo ativo para reprocessar faturamento.' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  RETURN public._reprocess_customer_held_billing(p_customer_id, v_actor, 'portal_activation');
END;
$$;

REVOKE ALL ON FUNCTION public.reprocess_customer_billing_after_portal_activation(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reprocess_customer_billing_after_portal_activation(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. RPCs do Administrativo: conceder e revogar a Liberação.
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

CREATE OR REPLACE FUNCTION public.revoke_customer_billing_portal_release(
  p_customer_id bigint,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_release_id bigint;
BEGIN
  IF v_actor IS NULL OR public._portal_actor_role() IS DISTINCT FROM 'administrativo' THEN
    RAISE EXCEPTION 'Somente o Administrativo revoga a liberação de faturamento sem Portal.' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Motivo da revogação é obrigatório.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_billing_portal_releases
     SET revoked_at = now(),
         revoked_by = v_actor,
         revoke_reason = btrim(p_reason)
   WHERE customer_id = p_customer_id
     AND revoked_at IS NULL
  RETURNING id INTO v_release_id;

  IF v_release_id IS NULL THEN
    RAISE EXCEPTION 'Não há liberação aberta para este Cliente.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.reconcile_customer_bl_review_alerts(p_customer_id, NULL, 'portal_billing_release_revoked');
  RETURN jsonb_build_object('release_id', v_release_id, 'revoked', true);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_customer_billing_portal_release(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_customer_billing_portal_release(bigint, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. O Administrativo passa a ser avisado do Alerta de Portal não provisionado.
--    A Documentação continua responsável (decisão 3.6).
-- ---------------------------------------------------------------------------
UPDATE public.alert_type_catalog
   SET audience_departments = ARRAY['documentacao', 'administrativo']
 WHERE type = 'review_portal_not_ready';
