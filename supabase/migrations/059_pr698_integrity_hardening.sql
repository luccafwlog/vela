-- 059: endurecimento da unificação de B/L misto (PR 698)
--
-- Esta migration fecha as lacunas encontradas na revisão exaustiva da PR:
--   * cargo_mode continua derivado do conteúdo e não pode ser rebaixado depois
--     de faturado;
--   * filtros operacionais tratam `misto` como lente de CNTR/BB;
--   * revisão, prontidão de comunicação e taxas usam o mesmo gate de peso;
--   * terminal herdado é resolvido por POD normalizado e a exceção individual
--     exige operação auditada;
--   * NOB automático/manual considera as duas frentes de um B/L misto;
--   * recebível e alertas são sincronizados quando a modalidade muda.

-- ---------------------------------------------------------------------------
-- 1. Regra única para filtros de modalidade
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bl_cargo_mode_matches_filter(
  p_cargo_mode text,
  p_filter text
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_mode text := lower(btrim(COALESCE(p_cargo_mode, '')));
  v_filter text := lower(btrim(COALESCE(p_filter, '')));
BEGIN
  IF v_filter = '' THEN
    RETURN true;
  ELSIF v_filter = 'container' THEN
    RETURN v_mode IN ('container', 'misto');
  ELSIF v_filter = 'carga_solta' THEN
    RETURN v_mode IN ('carga_solta', 'misto');
  ELSIF v_filter = 'misto' THEN
    RETURN v_mode = 'misto';
  END IF;
  RETURN v_mode = v_filter;
END;
$$;

REVOKE ALL ON FUNCTION public.bl_cargo_mode_matches_filter(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bl_cargo_mode_matches_filter(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Derivação atômica de cargo_mode e sincronização financeira
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalculate_bl_cargo_mode(p_bl_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
  v_curr_mode text;
  v_financial_status text;
BEGIN
  IF p_bl_id IS NULL THEN
    RETURN;
  END IF;

  -- Lock the parent before reading the children. If two imports change the
  -- same B/L concurrently, the second recalculation must observe the first
  -- commit instead of persisting a stale modality.
  SELECT cargo_mode, financial_status
    INTO v_curr_mode, v_financial_status
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = p_bl_id
  ) INTO v_has_cntr;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = p_bl_id
  ) OR EXISTS (
    SELECT 1 FROM public.bls
    WHERE id = p_bl_id
      AND (COALESCE(bb_weight_ton, 0) > 0 OR COALESCE(bb_packages_qty, 0) > 0)
  ) INTO v_has_bb;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;

  IF v_curr_mode IS NOT DISTINCT FROM v_new_mode THEN
    RETURN;
  END IF;

  IF COALESCE(v_financial_status, 'pending') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION
      'B/L % ja foi faturado (status financeiro=%); alteracao automatica de modalidade bloqueada.',
      p_bl_id, v_financial_status
      USING ERRCODE = 'P0003';
  END IF;

  UPDATE public.bls
  SET cargo_mode = v_new_mode,
      charge_status = 'not_calculated',
      updated_at = now()
  WHERE id = p_bl_id;

  -- O alerta de container sem conteúdo deixa de ser válido quando o B/L passa
  -- a conter carga solta ou recebe um contêiner real.
  IF v_new_mode <> 'container' OR v_has_cntr THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND source = 'auto'
      AND calculation_key IN ('review:no_container', 'review:no_containers');
  END IF;

  -- Não crie um recebível fantasma durante a importação: sincronize somente
  -- quando o B/L já tinha uma linha materializada.
  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE bl_id = p_bl_id AND source = 'local_charges'
  ) THEN
    PERFORM public.sync_local_charge_receivable(p_bl_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_bl_cargo_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_bl_cargo_mode(OLD.bl_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.bl_id IS DISTINCT FROM NEW.bl_id THEN
    PERFORM public.recalculate_bl_cargo_mode(OLD.bl_id);
    PERFORM public.recalculate_bl_cargo_mode(NEW.bl_id);
  ELSE
    PERFORM public.recalculate_bl_cargo_mode(NEW.bl_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bl_containers_cargo_mode ON public.bl_containers;
CREATE TRIGGER trg_bl_containers_cargo_mode
AFTER INSERT OR UPDATE OR DELETE ON public.bl_containers
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_cargo_mode();

DROP TRIGGER IF EXISTS trg_bl_breakbulk_cargo_mode ON public.bl_breakbulk_items;
CREATE TRIGGER trg_bl_breakbulk_cargo_mode
AFTER INSERT OR UPDATE OR DELETE ON public.bl_breakbulk_items
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_cargo_mode();

CREATE OR REPLACE FUNCTION public.trg_sync_bl_weight_cargo_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = NEW.id
  ) INTO v_has_cntr;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = NEW.id
  ) OR (COALESCE(NEW.bb_weight_ton, 0) > 0 OR COALESCE(NEW.bb_packages_qty, 0) > 0)
  INTO v_has_bb;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;

  IF NEW.cargo_mode IS DISTINCT FROM v_new_mode
     AND COALESCE(NEW.financial_status, 'pending') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION
      'B/L % ja foi faturado (status financeiro=%); alteracao automatica de modalidade bloqueada.',
      NEW.id, NEW.financial_status
      USING ERRCODE = 'P0003';
  END IF;

  IF TG_OP = 'INSERT' OR OLD.cargo_mode IS DISTINCT FROM v_new_mode THEN
    NEW.charge_status := 'not_calculated';
  ELSE
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
  END IF;
  NEW.cargo_mode := v_new_mode;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bl_weight_cargo_mode ON public.bls;
CREATE TRIGGER trg_bl_weight_cargo_mode
BEFORE INSERT OR UPDATE OF cargo_mode, bb_weight_ton, bb_packages_qty ON public.bls
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_weight_cargo_mode();

-- Peso de carga solta é obrigatório também no modo misto.
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
      SELECT 1 FROM public.customer_contacts AS c
      WHERE c.customer_id = p_customer_id
        AND c.deactivated_at IS NULL
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;

    IF NOT v_has_email THEN
      v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
    END IF;
    IF NOT public.customer_portal_access_ready(p_customer_id) THEN
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
-- 3. Terminal herdado, exceção auditada e pendências determinísticas
-- ---------------------------------------------------------------------------

ALTER TABLE public.bls
  DROP CONSTRAINT IF EXISTS bls_terminal_override_pair_check;

ALTER TABLE public.bls
  ADD CONSTRAINT bls_terminal_override_pair_check
  CHECK ((terminal_id IS NULL AND pod_port_id IS NULL)
      OR (terminal_id IS NOT NULL AND pod_port_id IS NOT NULL));

CREATE OR REPLACE FUNCTION public.bl_operation_front_modalidade(p_cargo_mode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_cargo_mode, '')))
    WHEN 'carga_solta' THEN 'carga_solta'
    WHEN 'misto' THEN NULL
    WHEN 'veiculo' THEN 'veiculo'
    WHEN 'veiculos' THEN 'veiculo'
    ELSE 'carga_cheia'
  END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_bl_terminal_id(p_bl_id text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_term_cntr uuid;
  v_term_bb uuid;
BEGIN
  SELECT id, voyage_id, pod, cargo_mode, terminal_id
    INTO v_bl
  FROM public.bls
  WHERE id = upper(btrim(p_bl_id));

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_bl.terminal_id IS NOT NULL THEN
    RETURN v_bl.terminal_id;
  END IF;

  IF v_bl.cargo_mode = 'container' THEN
    SELECT f.terminal_id INTO v_term_cntr
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = v_bl.voyage_id
      AND public.normalize_port_code(f.port) = public.normalize_port_code(v_bl.pod)
      AND f.sentido = 'importacao'
      AND f.modalidade = 'carga_cheia'
      AND f.terminal_id IS NOT NULL
    ORDER BY f.updated_at DESC, f.id DESC
    LIMIT 1;
    RETURN v_term_cntr;
  ELSIF v_bl.cargo_mode = 'carga_solta' THEN
    SELECT f.terminal_id INTO v_term_bb
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = v_bl.voyage_id
      AND public.normalize_port_code(f.port) = public.normalize_port_code(v_bl.pod)
      AND f.sentido = 'importacao'
      AND f.modalidade = 'carga_solta'
      AND f.terminal_id IS NOT NULL
    ORDER BY f.updated_at DESC, f.id DESC
    LIMIT 1;
    RETURN v_term_bb;
  ELSIF v_bl.cargo_mode = 'misto' THEN
    SELECT f.terminal_id INTO v_term_cntr
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = v_bl.voyage_id
      AND public.normalize_port_code(f.port) = public.normalize_port_code(v_bl.pod)
      AND f.sentido = 'importacao'
      AND f.modalidade = 'carga_cheia'
      AND f.terminal_id IS NOT NULL
    ORDER BY f.updated_at DESC, f.id DESC
    LIMIT 1;

    SELECT f.terminal_id INTO v_term_bb
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = v_bl.voyage_id
      AND public.normalize_port_code(f.port) = public.normalize_port_code(v_bl.pod)
      AND f.sentido = 'importacao'
      AND f.modalidade = 'carga_solta'
      AND f.terminal_id IS NOT NULL
    ORDER BY f.updated_at DESC, f.id DESC
    LIMIT 1;

    IF v_term_cntr IS NOT NULL AND v_term_cntr = v_term_bb THEN
      RETURN v_term_cntr;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_bl_terminal_pendencies(p_bl_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_term_cntr uuid;
  v_term_bb uuid;
  v_front_exists boolean;
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT id, voyage_id, pod, cargo_mode, terminal_id
    INTO v_bl
  FROM public.bls
  WHERE id = upper(btrim(p_bl_id));
  IF NOT FOUND THEN
    RETURN v_reasons;
  END IF;

  IF v_bl.terminal_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.voyage_escala_operation_fronts AS f
      WHERE f.voyage_id = v_bl.voyage_id
        AND public.normalize_port_code(f.port) = public.normalize_port_code(v_bl.pod)
        AND f.terminal_id = v_bl.terminal_id
        AND f.sentido = 'importacao'
    ) INTO v_front_exists;
    IF NOT v_front_exists THEN
      v_reasons := array_append(v_reasons, 'review:bl_terminal_sem_frente');
    END IF;
    RETURN v_reasons;
  END IF;

  IF v_bl.cargo_mode = 'misto' THEN
    SELECT f.terminal_id INTO v_term_cntr
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = v_bl.voyage_id
      AND public.normalize_port_code(f.port) = public.normalize_port_code(v_bl.pod)
      AND f.sentido = 'importacao'
      AND f.modalidade = 'carga_cheia'
    ORDER BY f.updated_at DESC, f.id DESC
    LIMIT 1;

    SELECT f.terminal_id INTO v_term_bb
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = v_bl.voyage_id
      AND public.normalize_port_code(f.port) = public.normalize_port_code(v_bl.pod)
      AND f.sentido = 'importacao'
      AND f.modalidade = 'carga_solta'
    ORDER BY f.updated_at DESC, f.id DESC
    LIMIT 1;

    IF v_term_cntr IS DISTINCT FROM v_term_bb OR v_term_cntr IS NULL THEN
      v_reasons := array_append(v_reasons, 'review:mixed_bl_terminal_conflict');
    END IF;
  END IF;
  RETURN v_reasons;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_bl_terminal_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF (NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
      OR NEW.pod_port_id IS DISTINCT FROM OLD.pod_port_id)
     AND current_setting('vela.bl_terminal_override', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Terminal do B/L só pode ser alterado pela exceção auditada.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_bl_terminal_override ON public.bls;
CREATE TRIGGER trg_guard_bl_terminal_override
BEFORE UPDATE OF terminal_id, pod_port_id ON public.bls
FOR EACH ROW EXECUTE FUNCTION public.guard_bl_terminal_override();

CREATE OR REPLACE FUNCTION public.set_bl_terminal_override(
  p_bl_id text,
  p_terminal_id uuid,
  p_pod_port_id bigint,
  p_justification text,
  p_changed_by uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_terminal record;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O autor da exceção deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A justificativa da exceção de terminal é obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF (p_terminal_id IS NULL) IS DISTINCT FROM (p_pod_port_id IS NULL) THEN
    RAISE EXCEPTION 'Terminal e porto devem ser informados juntos.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl
  FROM public.bls
  WHERE id = upper(btrim(p_bl_id))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF p_terminal_id IS NOT NULL THEN
    SELECT d.id, d.port_id, d.code, d.name, p.locode
      INTO v_terminal
    FROM public.depots AS d
    JOIN public.ports AS p ON p.id = d.port_id
    WHERE d.id = p_terminal_id
      AND d.port_id = p_pod_port_id
      AND d.tipo = 'terminal_portuario'
      AND d.active
      AND public.normalize_port_code(p.locode) = public.normalize_port_code(v_bl.pod);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Terminal inválido para o POD do B/L.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_old := jsonb_build_object('terminal_id', v_bl.terminal_id, 'pod_port_id', v_bl.pod_port_id);
  v_new := jsonb_build_object('terminal_id', p_terminal_id, 'pod_port_id', p_pod_port_id);
  PERFORM set_config('vela.bl_terminal_override', 'on', true);
  UPDATE public.bls
  SET terminal_id = p_terminal_id,
      pod_port_id = p_pod_port_id,
      updated_at = now()
  WHERE id = v_bl.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'bl', v_bl.id, 'terminal_override', v_old::text, v_new::text,
    v_actor, now(), btrim(p_justification)
  );

  RETURN jsonb_build_object(
    'bl_id', v_bl.id,
    'terminal_id', p_terminal_id,
    'pod_port_id', p_pod_port_id,
    'justification', btrim(p_justification),
    'changed_by', v_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_bl_terminal_override(text, uuid, bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_terminal_override(text, uuid, bigint, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Gates de revisão e prontidão de comunicação
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_readiness(
  p_voyage_id bigint,
  p_customer_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Viagem e cliente são obrigatórios.' USING ERRCODE = '22023';
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
$$;

CREATE OR REPLACE FUNCTION public.reconcile_customer_bl_review_alerts(
  p_customer_id bigint,
  p_consignee text,
  p_source text DEFAULT 'bl_review_gate'::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_customer_name text;
  v_customer_label text;
  v_entity_id text;
  v_consignee_key text;
  v_has_email boolean := false;
  v_portal_ready boolean := false;
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
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;
    v_portal_ready := public.customer_portal_access_ready(p_customer_id);

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

    IF v_total_pending > 0 AND NOT v_portal_ready THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente (Conta de Portal não provisionada)'
             ELSE ' B/Ls pendentes (Conta de Portal não provisionada)' END;
      PERFORM public.upsert_alert_item(
        'review_portal_not_ready', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending),
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
$$;

-- ---------------------------------------------------------------------------
-- 5. Taxas manuais e B/L misto: resolver tabelas por duas modalidades
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_manual_bl_charge(
  p_bl_id text,
  p_charge_item_id bigint,
  p_quantity numeric DEFAULT 1,
  p_notes text DEFAULT NULL::text,
  p_actor uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl record;
  v_item record;
  v_actor uuid;
  v_qty numeric(12,6);
  v_unit_brl numeric(12,2);
  v_unit_usd numeric(12,2);
  v_total_brl numeric(14,2);
  v_total_usd numeric(14,2);
  v_key text;
  v_calc_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;
  v_actor := COALESCE(p_actor, auth.uid());

  SELECT b.id, b.customer_id, COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.pod, b.charge_status, b.financial_status,
    COALESCE(ib.uploaded_at::date, b.created_at::date, CURRENT_DATE) AS reference_date
  INTO v_bl
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = upper(btrim(p_bl_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_bl.financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); nao e permitido lancar taxa manual.',
      p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  SELECT cti.id, cti.name, COALESCE(cti.currency, 'BRL') AS currency,
    cti.unit_value_brl, cti.unit_value_usd, cti.value_brl,
    ct.id AS charge_table_id, ct.name AS charge_table_name, ct.cargo_mode, ct.pod,
    cro.override_value
  INTO v_item
  FROM public.charge_table_items AS cti
  JOIN public.charge_tables AS ct ON ct.id = cti.charge_table_id
    AND ct.active = true
    AND ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(v_bl.id, v_bl.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(v_bl.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
    AND ct.valid_from <= v_bl.reference_date
    AND (ct.valid_to IS NULL OR ct.valid_to >= v_bl.reference_date)
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.customer_id = v_bl.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= v_bl.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= v_bl.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON true
  WHERE cti.id = p_charge_item_id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual % nao elegivel para este B/L', p_charge_item_id USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;
  IF v_item.currency = 'USD' THEN
    v_unit_brl := NULL;
    v_unit_usd := COALESCE(v_item.override_value, v_item.unit_value_usd, 0);
    v_total_brl := NULL;
    v_total_usd := round(v_qty * COALESCE(v_unit_usd, 0), 2);
  ELSE
    v_unit_brl := COALESCE(v_item.override_value, v_item.unit_value_brl, v_item.value_brl, 0);
    v_unit_usd := NULL;
    v_total_brl := round(v_qty * COALESCE(v_unit_brl, 0), 2);
    v_total_usd := NULL;
  END IF;

  v_key := concat('manual:item:', p_charge_item_id, ':',
    extract(epoch FROM clock_timestamp())::bigint, ':', floor(random() * 100000)::int);

  INSERT INTO public.charge_calculations (
    bl_id, charge_table_id, charge_item_id, quantity, unit_value_brl, unit_value_usd,
    total_value_brl, total_value_usd, override_applied, source, status,
    calculation_key, notes, manual_reason, created_by, calculated_at
  ) VALUES (
    v_bl.id, v_item.charge_table_id, p_charge_item_id, v_qty, v_unit_brl, v_unit_usd,
    v_total_brl, v_total_usd, v_item.override_value IS NOT NULL, 'manual', 'reviewed',
    v_key, NULLIF(trim(coalesce(p_notes, '')), ''), 'other_charge_manual', v_actor, now()
  ) RETURNING id INTO v_calc_id;

  UPDATE public.bls
  SET charge_status = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN 'reviewed' ELSE charge_status END,
      charges_calculated_at = COALESCE(charges_calculated_at, now()),
      charges_reviewed_at = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN now() ELSE charges_reviewed_at END
  WHERE id = v_bl.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  ) VALUES (
    'charge_calculation', v_calc_id::text, 'manual_insert', NULL,
    concat(v_item.name, ' | qty=', v_qty, ' | total=', coalesce(v_total_brl::text, v_total_usd::text)),
    auth.uid(), now(), coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Lancamento manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', v_calc_id, 'bl_id', v_bl.id, 'status', 'reviewed', 'currency', v_item.currency,
    'quantity', v_qty, 'unit_value_brl', v_unit_brl, 'unit_value_usd', v_unit_usd,
    'total_value_brl', v_total_brl, 'total_value_usd', v_total_usd
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manual_charge_items_for_bl(p_bl_id text)
RETURNS TABLE(
  charge_item_id bigint,
  charge_item_name text,
  charge_table_id bigint,
  charge_table_name text,
  cargo_mode text,
  pod text,
  currency text,
  default_unit_value_brl numeric,
  default_unit_value_usd numeric,
  effective_unit_value_brl numeric,
  effective_unit_value_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH bl_ctx AS (
    SELECT b.id, b.customer_id, b.pod,
      COALESCE(ib.uploaded_at::date, b.created_at::date, CURRENT_DATE) AS reference_date
    FROM public.bls AS b
    LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
    WHERE b.id = upper(btrim(p_bl_id))
  )
  SELECT cti.id, cti.name, ct.id, ct.name, ct.cargo_mode, ct.pod,
    COALESCE(cti.currency, 'BRL'), cti.unit_value_brl, cti.unit_value_usd,
    CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN NULL
         ELSE COALESCE(cro.override_value, cti.unit_value_brl, cti.value_brl, 0) END,
    CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD'
         THEN COALESCE(cro.override_value, cti.unit_value_usd, 0) ELSE NULL END
  FROM bl_ctx
  JOIN public.charge_tables AS ct ON ct.active = true
    AND ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(bl_ctx.id, bl_ctx.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(bl_ctx.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
    AND ct.valid_from <= bl_ctx.reference_date
    AND (ct.valid_to IS NULL OR ct.valid_to >= bl_ctx.reference_date)
  JOIN public.charge_table_items AS cti ON cti.charge_table_id = ct.id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.customer_id = bl_ctx.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= bl_ctx.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= bl_ctx.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON true
  ORDER BY ct.valid_from DESC, ct.id DESC, COALESCE(cti.sort_order, 100), cti.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPCs operacionais: `container` e `carga_solta` são lentes que incluem
--    `misto`; somente `misto` é uma seleção exata.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.operational_list_bls(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_search text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_cargo_mode text DEFAULT NULL::text,
  p_pol text DEFAULT NULL::text,
  p_pod text DEFAULT NULL::text,
  p_review_status text DEFAULT NULL::text,
  p_financial_status text DEFAULT NULL::text,
  p_charge_status text DEFAULT NULL::text,
  p_cargo_profile text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH filtered AS (
  SELECT b.*, COUNT(*) OVER () AS total_count
  FROM public.bls AS b
  LEFT JOIN public.customers AS c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || btrim(p_pol) || '%')
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || btrim(p_pod) || '%')
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL OR lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
    AND (
      NULLIF(btrim(coalesce(p_search, '')), '') IS NULL
      OR b.id ILIKE '%' || btrim(p_search) || '%'
      OR b.consignee ILIKE '%' || btrim(p_search) || '%'
      OR c.name ILIKE '%' || btrim(p_search) || '%'
      OR c.cnpj_cpf ILIKE '%' || btrim(p_search) || '%'
    )
    AND (
      NULLIF(btrim(coalesce(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT EXISTS (
        SELECT 1 FROM public.bl_containers bc
        WHERE bc.bl_id = b.id AND (coalesce(bc.is_imo, false) OR coalesce(bc.is_oog, false))
      ))
      OR (p_cargo_profile = 'imo' AND EXISTS (
        SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_imo, false)
      ))
      OR (p_cargo_profile = 'oog' AND EXISTS (
        SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_oog, false)
      ))
    )
), projected AS (
  SELECT f.*, (
    to_jsonb(f) - 'total_count' || jsonb_build_object(
      'customer', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'cnpj_cpf', c.cnpj_cpf, 'name', c.name) END,
      'voyage', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v.id, 'voyage_number', v.voyage_number, 'eta', v.eta, 'ata', v.ata, 'status', v.status,
        'vessel', CASE WHEN vs.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', vs.id, 'name', vs.name, 'imo', vs.imo,
          'carrier', CASE WHEN cr.id IS NULL THEN NULL ELSE jsonb_build_object('id', cr.id, 'name', cr.name, 'scac', cr.scac) END
        ) END
      ) END,
      'bl_containers', coalesce((SELECT jsonb_agg(to_jsonb(bc) ORDER BY bc.id) FROM public.bl_containers bc WHERE bc.bl_id = f.id), '[]'::jsonb),
      'bl_freight_lines', coalesce((SELECT jsonb_agg(to_jsonb(bfl) ORDER BY bfl.seq NULLS LAST) FROM public.bl_freight_lines bfl WHERE bfl.bl_id = f.id), '[]'::jsonb),
      'bl_breakbulk_items', coalesce((SELECT jsonb_agg(to_jsonb(bb) ORDER BY bb.id) FROM public.bl_breakbulk_items bb WHERE bb.bl_id = f.id), '[]'::jsonb)
    )
  ) AS row_json
  FROM filtered f
  LEFT JOIN public.customers c ON c.id = f.customer_id
  LEFT JOIN public.voyages v ON v.id = f.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
  ORDER BY f.created_at DESC NULLS LAST, f.id DESC
  OFFSET (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_page_size, 50), 100))
  LIMIT greatest(1, least(coalesce(p_page_size, 50), 100))
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(row_json ORDER BY row_json->>'created_at' DESC NULLS LAST, row_json->>'id' DESC) FROM projected), '[]'::jsonb),
  'count', coalesce((SELECT max(total_count) FROM filtered), 0)
);
$$;

CREATE OR REPLACE FUNCTION public.operational_list_containers(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_search text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_cargo_mode text DEFAULT NULL::text,
  p_pol text DEFAULT NULL::text,
  p_pod text DEFAULT NULL::text,
  p_review_status text DEFAULT NULL::text,
  p_financial_status text DEFAULT NULL::text,
  p_charge_status text DEFAULT NULL::text,
  p_cargo_profile text DEFAULT NULL::text,
  p_container_type text DEFAULT NULL::text,
  p_vehicle_container boolean DEFAULT NULL::boolean
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH filtered AS (
  SELECT bc.*, b.id AS bl_key, b.pol, b.pod, b.review_status, b.financial_status,
    b.charge_status, b.consignee, b.customer_id, b.voyage_id,
    c.name AS customer_name, c.cnpj_cpf AS customer_cnpj,
    v.voyage_number, v.eta, v.ata, v.status AS voyage_status,
    vs.id AS vessel_id, vs.name AS vessel_name, vs.imo AS vessel_imo,
    cr.name AS carrier_name, cr.scac AS carrier_scac, COUNT(*) OVER () AS total_count
  FROM public.bl_containers bc
  JOIN public.bls b ON b.id = bc.bl_id
  LEFT JOIN public.customers c ON c.id = b.customer_id
  LEFT JOIN public.voyages v ON v.id = b.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || btrim(p_pol) || '%')
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || btrim(p_pod) || '%')
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL OR lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
    AND (NULLIF(btrim(coalesce(p_container_type, '')), '') IS NULL OR upper(btrim(coalesce(bc.type, ''))) = upper(btrim(p_container_type)))
    AND (
      NULLIF(btrim(coalesce(p_search, '')), '') IS NULL
      OR bc.container_number ILIKE '%' || btrim(p_search) || '%'
      OR bc.seal_number ILIKE '%' || btrim(p_search) || '%'
      OR bc.type ILIKE '%' || btrim(p_search) || '%'
      OR bc.imo_class ILIKE '%' || btrim(p_search) || '%'
      OR bc.un_number ILIKE '%' || btrim(p_search) || '%'
      OR b.id ILIKE '%' || btrim(p_search) || '%'
      OR b.consignee ILIKE '%' || btrim(p_search) || '%'
      OR c.name ILIKE '%' || btrim(p_search) || '%'
      OR c.cnpj_cpf ILIKE '%' || btrim(p_search) || '%'
      OR vs.name ILIKE '%' || btrim(p_search) || '%'
      OR cr.name ILIKE '%' || btrim(p_search) || '%'
    )
    AND (
      NULLIF(btrim(coalesce(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT (coalesce(bc.is_imo, false) OR coalesce(bc.is_oog, false)))
      OR (p_cargo_profile = 'imo' AND coalesce(bc.is_imo, false))
      OR (p_cargo_profile = 'oog' AND coalesce(bc.is_oog, false))
    )
    AND (
      p_vehicle_container IS NULL
      OR (p_vehicle_container = true AND EXISTS (SELECT 1 FROM public.vehicles vh WHERE vh.container_id = bc.id))
      OR (p_vehicle_container = false AND NOT EXISTS (SELECT 1 FROM public.vehicles vh WHERE vh.container_id = bc.id))
    )
), projected AS (
  SELECT f.*, to_jsonb(f) - ARRAY[
    'bl_key','pol','pod','review_status','financial_status','charge_status','consignee','customer_id','voyage_id',
    'customer_name','customer_cnpj','voyage_number','eta','ata','voyage_status','vessel_id','vessel_name','vessel_imo',
    'carrier_name','carrier_scac','total_count'
  ]::text[] || jsonb_build_object(
    'bl', jsonb_build_object(
      'id', f.bl_key, 'pol', f.pol, 'pod', f.pod, 'review_status', f.review_status,
      'financial_status', f.financial_status, 'charge_status', f.charge_status, 'consignee', f.consignee,
      'customer', CASE WHEN f.customer_id IS NULL THEN NULL ELSE jsonb_build_object('id', f.customer_id, 'cnpj_cpf', f.customer_cnpj, 'name', f.customer_name) END,
      'voyage', CASE WHEN f.voyage_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', f.voyage_id, 'voyage_number', f.voyage_number, 'eta', f.eta, 'ata', f.ata, 'status', f.voyage_status,
        'vessel', CASE WHEN f.vessel_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', f.vessel_id, 'name', f.vessel_name, 'imo', f.vessel_imo,
          'carrier', CASE WHEN cr.id IS NULL THEN NULL ELSE jsonb_build_object('id', cr.id, 'name', f.carrier_name, 'scac', f.carrier_scac) END
        ) END
      ) END
    )
  ) AS row_json
  FROM filtered f
  LEFT JOIN public.voyages v ON v.id = f.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
), page AS (
  SELECT * FROM projected
  ORDER BY (row_json->>'created_at') DESC NULLS LAST, (row_json->>'id')::bigint DESC
  OFFSET (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_page_size, 50), 100))
  LIMIT greatest(1, least(coalesce(p_page_size, 50), 100))
), type_summary AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', type_label, 'distinctCount', distinct_count) ORDER BY distinct_count DESC, type_label), '[]'::jsonb) AS value
  FROM (
    SELECT coalesce(nullif(btrim(type), ''), 'Nao informado') AS type_label,
      count(DISTINCT upper(btrim(container_number))) FILTER (WHERE nullif(btrim(container_number), '') IS NOT NULL) AS distinct_count
    FROM filtered GROUP BY coalesce(nullif(btrim(type), ''), 'Nao informado')
  ) grouped_types
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(row_json ORDER BY (row_json->>'created_at') DESC NULLS LAST, (row_json->>'id')::bigint DESC) FROM page), '[]'::jsonb),
  'count', coalesce((SELECT max(total_count) FROM filtered), 0),
  'distinctCount', (SELECT count(DISTINCT upper(btrim(container_number))) FROM filtered WHERE nullif(btrim(container_number), '') IS NOT NULL),
  'oogDistinctCount', (SELECT count(DISTINCT upper(btrim(container_number))) FROM filtered WHERE coalesce(is_oog, false) AND nullif(btrim(container_number), '') IS NOT NULL),
  'imoDistinctCount', (SELECT count(DISTINCT upper(btrim(container_number))) FROM filtered WHERE coalesce(is_imo, false) AND nullif(btrim(container_number), '') IS NOT NULL),
  'blCount', (SELECT count(DISTINCT bl_key) FROM filtered),
  'typeSummary', (SELECT value FROM type_summary)
);
$$;

CREATE OR REPLACE FUNCTION public.operational_list_bl_summary(
  p_search text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_cargo_mode text DEFAULT NULL::text,
  p_pol text DEFAULT NULL::text,
  p_pod text DEFAULT NULL::text,
  p_review_status text DEFAULT NULL::text,
  p_financial_status text DEFAULT NULL::text,
  p_charge_status text DEFAULT NULL::text,
  p_cargo_profile text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH filtered AS (
  SELECT b.*
  FROM public.bls b
  LEFT JOIN public.customers c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || btrim(p_pol) || '%')
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || btrim(p_pod) || '%')
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL OR lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
    AND (NULLIF(btrim(coalesce(p_search, '')), '') IS NULL OR b.id ILIKE '%' || btrim(p_search) || '%' OR b.consignee ILIKE '%' || btrim(p_search) || '%' OR c.name ILIKE '%' || btrim(p_search) || '%' OR c.cnpj_cpf ILIKE '%' || btrim(p_search) || '%')
    AND (
      NULLIF(btrim(coalesce(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND (coalesce(bc.is_imo, false) OR coalesce(bc.is_oog, false))))
      OR (p_cargo_profile = 'imo' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_imo, false)))
      OR (p_cargo_profile = 'oog' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_oog, false)))
    )
)
SELECT jsonb_build_object(
  'totalBls', count(*)::integer,
  'totalDistinctContainers', (SELECT count(DISTINCT upper(btrim(bc.container_number))) FROM public.bl_containers bc JOIN filtered f ON f.id = bc.bl_id WHERE nullif(btrim(bc.container_number), '') IS NOT NULL),
  'pendingReview', count(*) FILTER (WHERE review_status = 'pending_review')::integer,
  'pendingFinancial', count(*) FILTER (WHERE financial_status = 'pending')::integer,
  'chargePending', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) IN ('review_required', 'not_calculated'))::integer,
  'chargeReady', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'ready_for_billing')::integer,
  'chargeExempt', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'exempt')::integer,
  'totalMachines', coalesce(sum(bb_machine_qty), 0),
  'totalPackages', coalesce(sum(coalesce(bb_packages_total, bb_packages_qty)), 0),
  'totalWeightTon', coalesce(sum(coalesce(bb_weight_ton, total_weight_kg / 1000)), 0),
  'totalCbm', coalesce(sum(total_cbm), 0)
)
FROM filtered;
$$;

-- ---------------------------------------------------------------------------
-- 7. NOB automático: preservar NOA/NOR/CE existentes e acrescentar o caso
--    que a implementação anterior não podia representar (B/L misto e exceção
--    individual). O produtor legado continua sendo o responsável pelos demais
--    tipos, enquanto esta camada usa resolve_bl_terminal_id para os casos
--    ambíguos.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public.evaluate_and_dispatch_automatic_communications(timestamp with time zone)') IS NOT NULL
     AND to_regprocedure('public.evaluate_and_dispatch_automatic_communications_045(timestamp with time zone)') IS NULL THEN
    ALTER FUNCTION public.evaluate_and_dispatch_automatic_communications(timestamptz)
      RENAME TO evaluate_and_dispatch_automatic_communications_045;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(
  p_as_of timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_candidates jsonb := '[]'::jsonb;
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_atracacao record;
  v_customer_bl record;
  v_nob_suppressed boolean;
  v_key text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- NOA, NOR e CE usam exatamente a produtora já validada da migration 045.
  v_candidates := coalesce(
    public.evaluate_and_dispatch_automatic_communications_045(v_as_of),
    '[]'::jsonb
  );

  -- Complemento NOB. Só reavalia B/L misto ou B/L com exceção explícita;
  -- B/L puro herdado continua idempotente pela claim_key da produtora legada.
  FOR v_atracacao IN
    SELECT ts.id AS state_id, ts.voyage_id, upper(btrim(ts.port)) AS port,
      ts.terminal_id, ts.terminal_atb,
      public.voyage_terminal_code(ts.terminal_id) AS terminal_code,
      v.voyage_number, vs.name AS vessel_name
    FROM public.voyage_escala_terminal_state AS ts
    JOIN public.voyages AS v ON v.id = ts.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE ts.terminal_id IS NOT NULL
      AND ts.terminal_atb IS NOT NULL
      AND ts.terminal_atb <= v_as_of
      AND ts.terminal_atb >= v_as_of - interval '30 days'
      AND public.voyage_terminal_code(ts.terminal_id) IS NOT NULL
  LOOP
    SELECT coalesce((
      SELECT lower(btrim(a.new_value)) = 'true'
      FROM public.audit_logs AS a
      WHERE a.entity_type = 'voyage_pod_schedule'
        AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
        AND a.field_name = 'deleted'
      ORDER BY a.changed_at DESC, a.id DESC
      LIMIT 1
    ), false) INTO v_nob_suppressed;
    v_nob_suppressed := v_nob_suppressed OR coalesce((
      SELECT lower(btrim(a.new_value)) = 'true'
      FROM public.audit_logs AS a
      WHERE a.entity_type = 'voyage_pod_schedule'
        AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
        AND a.field_name = 'omitted'
      ORDER BY a.changed_at DESC, a.id DESC
      LIMIT 1
    ), false);
    CONTINUE WHEN v_nob_suppressed;

    FOR v_customer_bl IN
      SELECT b.customer_id,
        array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name,
        c.cnpj_cpf,
        array_agg(DISTINCT nullif(btrim(cc.email), '') ORDER BY nullif(btrim(cc.email), ''))
          FILTER (WHERE nullif(btrim(cc.email), '') IS NOT NULL
            AND nullif(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls AS b
      JOIN public.customers AS c ON c.id = b.customer_id
      LEFT JOIN public.customer_contacts AS cc ON cc.customer_id = b.customer_id
      JOIN public.customer_contact_box_links AS ccb ON ccb.contact_id = cc.id
      WHERE b.voyage_id = v_atracacao.voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(v_atracacao.port)
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND (b.cargo_mode = 'misto' OR b.terminal_id IS NOT NULL)
        AND public.resolve_bl_terminal_id(b.id) = v_atracacao.terminal_id
        AND cc.deactivated_at IS NULL
        AND ccb.box_code = 'documentacao_operacao'
        AND nullif(btrim(cc.email), '') IS NOT NULL
        AND nullif(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND EXISTS (
          SELECT 1
          FROM public.voyage_escala_operation_fronts AS f
          WHERE f.voyage_id = b.voyage_id
            AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
            AND f.terminal_id = v_atracacao.terminal_id
            AND f.sentido = 'importacao'
            AND (
              (b.cargo_mode = 'misto' AND f.modalidade IN ('carga_cheia', 'carga_solta'))
              OR (b.cargo_mode <> 'misto' AND f.modalidade = public.bl_operation_front_modalidade(b.cargo_mode))
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_contact_preferences AS cp
          WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails AS pse
          WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions AS ccs
          WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications AS sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = 'aviso_atracacao_nob'
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_atracacao_id = v_atracacao.state_id
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      v_key := 'aviso_atracacao_nob:' || v_customer_bl.customer_id || ':' || v_atracacao.state_id;
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
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
$$;

REVOKE ALL ON FUNCTION public.evaluate_and_dispatch_automatic_communications(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_and_dispatch_automatic_communications(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.evaluate_and_dispatch_automatic_communications_045(timestamptz) FROM PUBLIC, anon, authenticated;
