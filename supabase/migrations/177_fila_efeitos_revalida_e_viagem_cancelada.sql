-- 177: fila de efeitos de importação revalida o estado atual e Viagem
-- Cancelada fica selada também para containers, Granito, faturas, comunicados
-- e efeitos (M04 e M20 da revisão de 2026-10-09; ADR 0078, item 18).
--
-- 1. `vehicle_followup` revalida: B/L com fatura viva que continua cobrado não
--    é tocado (a fatura já seguiu a ADR 0077 no commit da importação de
--    veículos, gatilho adiado da 128); só a isenção confirmada agora
--    (`_quote_bl_local_charges` = exempt) cancela as faturas, e B/L sem fatura
--    viva é recalculado.
-- 2. `local_billing`/`provisional_charges` trava o B/L de origem (contenção vira
--    nova tentativa), reaproveita o cálculo do dia do CE
--    (`_auto_bill_bl_core(..., true)`), não varre a Viagem a partir de B/L de
--    carga solta e nunca recalcula B/L retido ou com CE de outro efeito; a
--    falha capturada pelo faturamento automático volta com o SQLSTATE original.
-- 3. `process_import_effect`: 40001/40P01/55P03 viram `retry_wait`; P0001 de
--    domínio vira `effect_domain_refused` (não mais `invalid_effect_payload`
--    nem `unsupported_effect_kind`); tipo desconhecido usa 0A000.
-- 4. `claim_import_effects`: lease esgotado e dependência bloqueada abrem o
--    Alerta `import_effect_blocked`.
-- 5. `enqueue_import_effect`: efeito novo da mesma entidade e tipo substitui o
--    pendente (qualquer revisão), e `import_bl_freight_with_metadata` deixa de
--    enfileirar `physical_flags`, que já aplica na própria transação.
-- 6. Viagem Cancelada: guardas em `bl_containers`, `granite_bls`, `invoices`,
--    `invoice_bls`, `customer_communications` e `customer_communication_bls`;
--    `cancel_voyage` encerra os efeitos pendentes da Viagem; consumidores
--    encerram como `superseded` o efeito de Viagem Cancelada.
-- 7. Simulação do acumulado: `simulate_import_effects` (server-only) roda cada
--    efeito pendente numa subtransação desfeita e devolve o que faria;
--    `apply_import_effects_review` processa os aprovados e descarta os demais
--    com registro em `audit_logs`.
-- 8. Métrica e Alerta de fila parada: `import_effects_queue_health()` e
--    `reconcile_import_effects_queue_alert()` (Alerta
--    `import_effects_queue_stalled`), agendada de hora em hora por pg_cron
--    quando a extensão existe. Não processa efeitos: o `import-effects-runner`
--    continua desligado (Etapa 13 do plano).
--
-- Não reescreve linhas existentes.
--
-- ponytail: a simulação compara contagens de faturas e cálculos antes e depois
-- da subtransação; não diffa linha a linha. Upgrade: devolver o diff de
-- `invoices`/`charge_calculations` por B/L se a revisão pedir mais detalhe.
--
-- Rollback: reaplicar `_run_import_effect_vehicle_followup` da 128,
-- `_run_import_effect_local_charges` da 056, `process_import_effect` da 031,
-- `claim_import_effects` da 017, `enqueue_import_effect` da 017,
-- `import_bl_freight_with_metadata` da 174 e `cancel_voyage` da 089; DROP dos
-- gatilhos `trg_guard_voyage_cancelled_*` novos, das funções novas e do job
-- `import-effects-queue-health`.

-- Viagem do efeito (B/L, Viagem ou B/L de Granito).
CREATE OR REPLACE FUNCTION public._import_effect_voyage_id(p_effect_kind text, p_entity_id text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_effect_kind = 'granite_billing'
         AND p_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      (SELECT m.voyage_id FROM public.granite_bls AS g JOIN public.granite_manifests AS m ON m.id = g.manifest_id
       WHERE g.id = p_entity_id::uuid)
    WHEN p_entity_id ~ '^[0-9]+$' AND NOT EXISTS (SELECT 1 FROM public.bls WHERE id = p_entity_id) THEN
      p_entity_id::bigint
    ELSE (SELECT b.voyage_id FROM public.bls AS b WHERE b.id = p_entity_id)
  END;
$function$;

REVOKE ALL ON FUNCTION public._import_effect_voyage_id(text, text) FROM PUBLIC, anon, authenticated;

-- 1. Veículos: revalida o B/L antes de agir.
CREATE OR REPLACE FUNCTION public._run_import_effect_vehicle_followup(p_entity_id text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text := NULLIF(btrim(COALESCE(p_entity_id, '')), '');
  v_live bigint[];
  v_quote jsonb;
  v_invoice_id bigint;
  v_cancelled_ids bigint[] := ARRAY[]::bigint[];
  v_cancel_results jsonb := '[]'::jsonb;
BEGIN
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L inválido no efeito de veículos.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado para efeito de veículos.', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  v_live := public._live_local_invoice_ids_for_bl(v_bl_id);
  v_quote := public._quote_bl_local_charges(v_bl_id, NULL);

  -- Fatura viva de B/L que continua cobrado: o valor e o Cliente já foram
  -- tratados no commit da importação de veículos (ADR 0077). Nada é cancelado.
  IF cardinality(v_live) > 0 AND COALESCE(v_quote->>'status', '') <> 'exempt' THEN
    RETURN jsonb_build_object(
      'entity_id', v_bl_id,
      'status', 'skipped',
      'reason', 'live_invoice_follows_adr_0077',
      'live_invoice_ids', to_jsonb(v_live)
    );
  END IF;

  IF cardinality(v_live) > 0 THEN
    -- Isenção confirmada agora (veículo com desova LCL/CFS): a fatura sai.
    PERFORM set_config('import_effects.consumer', 'vehicle_followup', true);

    -- A consolidada que cobra este B/L sai junto: não pode voltar com os mesmos
    -- B/Ls, então é encerrada sem reemissão (decisão de 2026-10-02).
    FOR v_invoice_id IN
      SELECT DISTINCT inv.id
      FROM public.invoice_receivable_links AS l
      JOIN public.invoices AS inv ON inv.id = l.invoice_id
      WHERE l.bl_id = v_bl_id
        AND l.status IN ('active', 'settled_by_this_invoice')
        AND inv.invoice_type = 'consolidated'
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
      ORDER BY inv.id
    LOOP
      v_cancel_results := v_cancel_results || jsonb_build_array(
        public._cancel_invoice_core(v_invoice_id, 'Carga de veiculos: BL ' || v_bl_id || ' isento de taxas locais.', p_actor));
      UPDATE public.invoices
      SET reissue_requested_at = now(), reissue_closed_at = now(),
          reissue_closed_reason = 'Nao reemitida: B/L ' || v_bl_id || ' isento por carga de veiculos.'
      WHERE id = v_invoice_id;
      v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
    END LOOP;

    FOR v_invoice_id IN
      SELECT DISTINCT inv.id
      FROM public.invoice_bls AS link
      JOIN public.invoices AS inv ON inv.id = link.invoice_id
      WHERE link.bl_id = v_bl_id
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
      ORDER BY inv.id
    LOOP
      v_cancel_results := v_cancel_results || jsonb_build_array(
        public.cancel_invoice(v_invoice_id, 'Carga de veiculos: BL isento de taxas locais.', p_actor));
      v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'entity_id', v_bl_id,
    'status', CASE WHEN cardinality(v_cancelled_ids) > 0 THEN 'exempt_invoices_cancelled' ELSE 'recalculated' END,
    'cancelled_invoice_ids', v_cancelled_ids,
    'cancel_results', v_cancel_results,
    'charge_result', public.calculate_bl_local_charges(v_bl_id, p_actor, true)
  );
END;
$function$;

-- 2. Taxas locais: B/L de origem com trava, cálculo do dia do CE, sem varredura.
CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges(p_entity_id text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_origin public.bls%ROWTYPE;
  v_voyage_id bigint;
  v_container_numbers text[];
  v_bl_ids text[] := ARRAY[]::text[];
  v_current_bl_id text;
  v_result jsonb := '[]'::jsonb;
  v_calculated integer := 0;
  v_one jsonb;
  v_sqlstate text;
BEGIN
  SELECT * INTO v_origin FROM public.bls WHERE id = NULLIF(btrim(p_entity_id), '') FOR UPDATE;

  IF FOUND THEN
    v_voyage_id := v_origin.voyage_id;
    IF COALESCE(v_origin.financial_status, 'pending') <> 'pending'
       OR cardinality(public._live_local_invoice_ids_for_bl(v_origin.id)) > 0 THEN
      RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', 0,
        'results', jsonb_build_array(jsonb_build_object('status', 'already_invoiced', 'idempotent', true,
          'bl_id', v_origin.id, 'financial_status', v_origin.financial_status)));
    END IF;

    IF NULLIF(btrim(COALESCE(v_origin.ce_mercante, '')), '') IS NOT NULL THEN
      -- CE gravado: o cálculo do dia do CE vale (ADR 0070, nota 2026-09-24 b).
      v_one := public._auto_bill_bl_core(v_origin.id, p_actor, true);
    ELSE
      v_one := public.calculate_bl_local_charges(v_origin.id, p_actor, true);
    END IF;
    v_result := jsonb_build_array(v_one);
    v_calculated := 1;

    -- Irmãos de container (o rateio muda): só os provisórios, sem CE e sem
    -- retenção. Carga solta não tem container e não toca a Viagem.
    SELECT COALESCE(array_agg(DISTINCT upper(btrim(c.container_number))), ARRAY[]::text[])
      INTO v_container_numbers
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_origin.id AND NULLIF(btrim(c.container_number), '') IS NOT NULL;

    IF cardinality(v_container_numbers) > 0 THEN
      SELECT COALESCE(array_agg(DISTINCT b.id ORDER BY b.id), ARRAY[]::text[]) INTO v_bl_ids
      FROM public.bls AS b
      JOIN public.bl_containers AS c ON c.bl_id = b.id
      WHERE b.voyage_id = v_voyage_id
        AND b.id <> v_origin.id
        AND b.cancelled_at IS NULL
        AND COALESCE(b.financial_status, 'pending') = 'pending'
        AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL
        AND NULLIF(btrim(COALESCE(b.billing_hold_reason, '')), '') IS NULL
        AND upper(btrim(c.container_number)) = ANY(v_container_numbers);
    END IF;
  ELSE
    IF NULLIF(btrim(p_entity_id), '') IS NULL OR p_entity_id !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Entidade de efeito local desconhecida: %.', p_entity_id USING ERRCODE = 'P0002';
    END IF;
    SELECT v.id INTO v_voyage_id FROM public.voyages AS v WHERE v.id = p_entity_id::bigint;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem de efeito local nao encontrada: %.', p_entity_id USING ERRCODE = 'P0002';
    END IF;
    -- Efeito da Viagem: só B/Ls provisórios (sem CE, sem retenção).
    SELECT COALESCE(array_agg(b.id ORDER BY b.id), ARRAY[]::text[]) INTO v_bl_ids
    FROM public.bls AS b
    WHERE b.voyage_id = v_voyage_id
      AND b.cancelled_at IS NULL
      AND COALESCE(b.cargo_mode, 'container') IN ('container', 'carga_solta', 'misto')
      AND COALESCE(b.financial_status, 'pending') = 'pending'
      AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL
      AND NULLIF(btrim(COALESCE(b.billing_hold_reason, '')), '') IS NULL;
  END IF;

  FOREACH v_current_bl_id IN ARRAY v_bl_ids LOOP
    v_result := v_result || jsonb_build_array(public.calculate_bl_local_charges(v_current_bl_id, p_actor, true));
    v_calculated := v_calculated + 1;
  END LOOP;

  IF v_one IS NOT NULL AND v_one->>'status' = 'blocked' AND v_one->>'reason' = 'auto_billing_failed' THEN
    -- O SQLSTATE original decide entre nova tentativa e bloqueio.
    v_sqlstate := COALESCE(NULLIF(v_one->>'sqlstate', ''), 'P0001');
    IF v_sqlstate !~ '^[0-9A-Z]{5}$' THEN v_sqlstate := 'P0001'; END IF;
    RAISE EXCEPTION 'Faturamento automatico do B/L % bloqueado: %', v_origin.id,
      COALESCE(v_one->>'message', 'falha desconhecida')
      USING ERRCODE = v_sqlstate;
  END IF;

  RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', v_calculated, 'results', v_result);
END;
$function$;

-- 3. Classificação de erros e Viagem Cancelada no executor.
CREATE OR REPLACE FUNCTION public.process_import_effect(p_effect_id bigint, p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_effect public.import_pending_effects%ROWTYPE;
  v_actor uuid;
  v_result jsonb;
  v_status text;
  v_error_code text;
  v_error_message text;
  v_retry_at timestamptz;
  v_sqlstate text;
  v_voyage_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_effect_id IS NULL
     OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
     OR char_length(p_worker_id) > 128 THEN
    RAISE EXCEPTION 'Identidade de processamento incompleta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_effect FROM public.import_pending_effects WHERE id = p_effect_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;

  IF v_effect.status IN ('succeeded', 'blocked', 'superseded') THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_effect), 'idempotent', true);
  END IF;
  IF v_effect.status IS DISTINCT FROM 'running' OR v_effect.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito nao pertence ao worker.' USING ERRCODE = '42501';
  END IF;
  IF v_effect.lease_until IS NULL OR v_effect.lease_until <= now() THEN
    RAISE EXCEPTION 'Lease do efeito expirou.' USING ERRCODE = '40001';
  END IF;
  IF v_effect.created_by IS NULL THEN
    RAISE EXCEPTION 'Efeito sem iniciador validado.' USING ERRCODE = '42501';
  END IF;

  v_actor := v_effect.created_by;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  -- Viagem Cancelada: a operação está selada; o efeito sai sem agir.
  v_voyage_id := public._import_effect_voyage_id(v_effect.effect_kind, v_effect.entity_id);
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'superseded',
      jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', v_voyage_id,
        'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_actor),
      NULL, NULL, NULL);
  END IF;

  CASE v_effect.effect_kind
    WHEN 'physical_flags' THEN
      IF v_effect.entity_id !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Viagem invalida no efeito de flags: %.', v_effect.entity_id USING ERRCODE = '22023';
      END IF;
      v_result := public.apply_baplie_physical_flags_atomic(v_effect.entity_id::bigint, NULL, v_actor);
    WHEN 'provisional_charges', 'local_billing' THEN
      v_result := public._run_import_effect_local_charges(v_effect.entity_id, v_actor);
    WHEN 'granite_billing' THEN
      v_result := public._run_import_effect_granite_billing(v_effect.entity_id, v_actor);
    WHEN 'demurrage_billing' THEN
      v_result := public._run_import_effect_demurrage(v_effect.id, v_effect.entity_id, v_actor);
    WHEN 'vehicle_followup' THEN
      v_result := public._run_import_effect_vehicle_followup(v_effect.entity_id, v_actor);
    ELSE
      RAISE EXCEPTION 'effect_kind nao suportado: %.', v_effect.effect_kind USING ERRCODE = '0A000';
  END CASE;

  v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_actor);
  RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'succeeded', v_result, NULL, NULL, NULL);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_error_message = MESSAGE_TEXT;

    v_status := CASE WHEN v_sqlstate IN ('40001', '40P01', '55P03') THEN 'retry_wait' ELSE 'blocked' END;
    v_error_code := CASE
      WHEN v_status = 'retry_wait' THEN 'transient_sql_error'
      WHEN v_sqlstate = '42501' THEN 'authorization_invalid'
      WHEN v_sqlstate = '22023' THEN 'invalid_effect_payload'
      WHEN v_sqlstate = 'P0002' THEN 'effect_domain_missing'
      WHEN v_sqlstate = '0A000' THEN 'unsupported_effect_kind'
      WHEN v_sqlstate LIKE 'P0%' THEN 'effect_domain_refused'
      ELSE 'effect_failed'
    END;
    IF v_status = 'retry_wait' AND v_effect.attempts >= 5 THEN
      v_status := 'blocked';
      v_error_code := 'retry_exhausted';
      v_error_message := 'Numero maximo de tentativas atingido.';
    ELSIF v_status = 'retry_wait' THEN
      v_retry_at := now() + CASE v_effect.attempts
        WHEN 1 THEN interval '1 minute'
        WHEN 2 THEN interval '5 minutes'
        WHEN 3 THEN interval '15 minutes'
        ELSE interval '60 minutes'
      END;
    END IF;

    IF v_effect.id IS NULL THEN RAISE; END IF;

    IF v_status = 'blocked' THEN
      PERFORM public._record_import_effect_blocked_alert(
        v_effect.id, v_effect.effect_kind, v_effect.entity_id, v_error_code, v_error_message);
    END IF;

    RETURN public.complete_import_effect(
      v_effect.id, p_worker_id, v_status,
      jsonb_build_object('executor', 'import-effects-runner', 'worker_id', p_worker_id,
        'initiator_id', v_effect.created_by, 'sqlstate', v_sqlstate),
      v_error_code, v_error_message, v_retry_at);
END;
$function$;

-- 4. Lease esgotado e dependência bloqueada abrem o Alerta.
CREATE OR REPLACE FUNCTION public.claim_import_effects(p_worker_id text, p_limit integer DEFAULT 20, p_lease_seconds integer DEFAULT 300)
 RETURNS SETOF import_pending_effects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_worker text := NULLIF(btrim(COALESCE(p_worker_id, '')), '');
  -- Opcionalmente restringe uma execução interna a um prefixo de entidade.
  -- O runner normal não define o GUC; ele existe para replay/diagnóstico
  -- controlado sem permitir que um teste capture efeitos de outra unidade.
  v_entity_prefix text := NULLIF(current_setting('import_effects.entity_prefix', true), '');
  v_row record;
  v_next_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF v_worker IS NULL OR char_length(v_worker) > 128 THEN
    RAISE EXCEPTION 'Worker invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Limite de claim invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'Lease invalido.' USING ERRCODE = '22023';
  END IF;

  -- Recupera workers que morreram. A transicao e registrada sem editar o
  -- historico anterior; somente o estado corrente da fila e mutavel.
  FOR v_row IN
    SELECT id, attempts, entity_id, effect_kind
    FROM public.import_pending_effects
    WHERE status = 'running'
      AND (v_entity_prefix IS NULL OR entity_id LIKE v_entity_prefix)
      AND lease_until IS NOT NULL
      AND lease_until <= now()
    ORDER BY lease_until, id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_next_status := CASE WHEN v_row.attempts >= 5 THEN 'blocked' ELSE 'retry_wait' END;
    UPDATE public.import_pending_effects
       SET status = v_next_status,
           next_attempt_at = CASE WHEN v_next_status = 'retry_wait' THEN now() ELSE next_attempt_at END,
           lease_until = NULL,
           leased_by = NULL,
           last_error_code = 'lease_expired',
           last_error_message = 'Lease expirada antes da confirmacao do worker.',
           updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(
      effect_id, attempt_no, event_kind, worker_id, status, error_code, error_message
    ) VALUES (
      v_row.id, GREATEST(v_row.attempts, 1), 'lease_expired', 'lease-recovery',
      v_next_status, 'lease_expired', 'Lease expirada antes da confirmacao do worker.'
    );
    IF v_next_status = 'blocked' THEN
      PERFORM public._record_import_effect_blocked_alert(
        v_row.id, v_row.effect_kind, v_row.entity_id, 'lease_expired',
        'Lease expirada antes da confirmacao do worker; tentativas esgotadas.');
    END IF;
  END LOOP;

  -- Uma dependencia bloqueada bloqueia seus descendentes, evitando uma fila
  -- que parece pendente indefinidamente depois de uma falha permanente.
  FOR v_row IN
    SELECT e.id, e.attempts, e.entity_id, e.effect_kind
    FROM public.import_pending_effects AS e
    JOIN public.import_pending_effects AS dependency
      ON dependency.id = e.depends_on_effect_id
    WHERE e.status IN ('pending', 'retry_wait')
      AND (v_entity_prefix IS NULL OR e.entity_id LIKE v_entity_prefix)
      AND dependency.status IN ('blocked', 'superseded')
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    UPDATE public.import_pending_effects
       SET status = 'blocked',
           lease_until = NULL,
           leased_by = NULL,
           last_error_code = 'dependency_blocked',
           last_error_message = 'Efeito dependente bloqueado ou superado.',
           updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(
      effect_id, attempt_no, event_kind, worker_id, status, error_code, error_message
    ) VALUES (
      v_row.id, GREATEST(v_row.attempts, 1), 'dependency_blocked', 'dependency-guard',
      'blocked', 'dependency_blocked', 'Efeito dependente bloqueado ou superado.'
    );
    PERFORM public._record_import_effect_blocked_alert(
      v_row.id, v_row.effect_kind, v_row.entity_id, 'dependency_blocked',
      'Efeito dependente bloqueado ou superado.');
  END LOOP;

  RETURN QUERY
  WITH eligible_ranked AS (
    SELECT DISTINCT ON (e.entity_id)
      e.id,
      e.entity_id,
      public._import_effect_priority(e.effect_kind) AS priority
    FROM public.import_pending_effects AS e
    WHERE e.status IN ('pending', 'retry_wait')
      AND (v_entity_prefix IS NULL OR e.entity_id LIKE v_entity_prefix)
      AND e.attempts < 5
      AND e.next_attempt_at <= now()
      AND (e.depends_on_effect_id IS NULL OR EXISTS (
        SELECT 1 FROM public.import_pending_effects AS dependency
        WHERE dependency.id = e.depends_on_effect_id
          AND dependency.status = 'succeeded'
      ))
      AND NOT EXISTS (
        SELECT 1 FROM public.import_pending_effects AS prior
        WHERE prior.entity_id = e.entity_id
          AND public._import_effect_priority(prior.effect_kind)
              < public._import_effect_priority(e.effect_kind)
          AND prior.status IN ('pending', 'running', 'retry_wait')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.import_pending_effects AS running
        WHERE running.entity_id = e.entity_id
          AND running.status = 'running'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.import_pending_effects AS newer
        WHERE newer.entity_id = e.entity_id
          AND newer.effect_kind = e.effect_kind
          AND newer.source_revision > e.source_revision
          AND newer.status <> 'superseded'
      )
    ORDER BY e.entity_id, public._import_effect_priority(e.effect_kind), e.next_attempt_at, e.id
  ),
  claimable AS (
    SELECT e.id
    FROM public.import_pending_effects AS e
    JOIN eligible_ranked AS ranked ON ranked.id = e.id
    WHERE pg_try_advisory_xact_lock(hashtextextended(e.entity_id, 174017))
    ORDER BY ranked.priority, e.next_attempt_at, e.id
    FOR UPDATE OF e SKIP LOCKED
    LIMIT p_limit
  ),
  claimed AS (
    UPDATE public.import_pending_effects AS e
       SET status = 'running',
           attempts = e.attempts + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           leased_by = v_worker,
           updated_at = now(),
           last_error_code = NULL,
           last_error_message = NULL
      FROM claimable AS c
     WHERE e.id = c.id
     RETURNING e.*
  ),
  recorded AS (
    INSERT INTO public.import_effect_attempts(
      effect_id, attempt_no, event_kind, worker_id, status
    )
    SELECT id, attempts, 'claimed', v_worker, 'running'
    FROM claimed
    RETURNING effect_id
  )
  SELECT claimed.*
  FROM claimed
  JOIN recorded ON recorded.effect_id = claimed.id;
END;
$function$;

-- 5b. A importação de B/L não enfileira physical_flags redundante.
CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id bigint := NULL;
  v_filename text;
  v_voyage_id bigint;
  v_cargo_mode text := 'container';
  v_total_bls integer;
  v_bl_id text;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_action_id uuid := gen_random_uuid();
  v_item jsonb;
  v_physical_effect jsonb;
  v_physical_effect_id bigint;
  v_calc_errors jsonb := '[]'::jsonb;
  v_batch_containers jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  -- O batch e opcional (ADR 0017): mesmo no B/L avulso o calculo inicial
  -- deve acontecer nesta mesma operacao, sem depender de worker offline.
  IF p_batch IS NOT NULL THEN
    v_filename := NULLIF(btrim(COALESCE(p_batch->>'filename', '')), '');
    v_voyage_id := NULLIF(btrim(COALESCE(p_batch->>'voyage_id', '')), '')::bigint;
    v_cargo_mode := COALESCE(NULLIF(btrim(COALESCE(p_batch->>'cargo_mode', '')), ''), 'container');
    IF v_filename IS NULL OR v_voyage_id IS NULL THEN
      RAISE EXCEPTION 'Batch invalido: filename e voyage_id obrigatorios.' USING ERRCODE = '22023';
    END IF;
    IF v_cargo_mode NOT IN ('container', 'carga_solta') THEN
      RAISE EXCEPTION 'cargo_mode de batch invalido.' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.voyages WHERE id = v_voyage_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem % nao encontrada', v_voyage_id USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*) INTO v_mismatch
    FROM jsonb_array_elements(p_bls) AS item
    WHERE (item->>'voyage_id')::bigint IS DISTINCT FROM v_voyage_id;
    IF v_mismatch > 0 THEN
      RAISE EXCEPTION 'Batch da viagem % com B/L de outra viagem.', v_voyage_id USING ERRCODE = '22023';
    END IF;

    v_total_bls := jsonb_array_length(p_bls);

    INSERT INTO public.import_batches(
      filename, voyage_id, cargo_mode, uploaded_by, status, total_bls, total_containers
    ) VALUES (
      v_filename, v_voyage_id, v_cargo_mode, v_actor, 'completed', v_total_bls, NULL
    ) RETURNING id INTO v_batch_id;

    UPDATE public.bls AS b
      SET batch_id = v_batch_id
      FROM jsonb_array_elements(p_bls) AS item
      WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> v_total_bls THEN
      RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
    END IF;

    -- Migration 177: sem efeito `physical_flags`; as flags do lote são
    -- aplicadas logo abaixo, na mesma transação.

    -- Baplie soberano em qualquer ordem (migration 118): se o Baplie da
    -- viagem ja existe, as flags fisicas valem antes do calculo inicial
    -- abaixo; o runner do efeito acima nao e pre-requisito.
    -- Migration 150: só os contêineres deste lote (sem filtro a função varre
    -- a viagem inteira, ~3 s numa viagem de ~500 B/Ls).
    SELECT jsonb_agg(DISTINCT upper(btrim(container->>'container_number')))
      INTO v_batch_containers
      FROM jsonb_array_elements(p_bls) AS item,
           jsonb_array_elements(COALESCE(item->'containers', '[]'::jsonb)) AS container
      WHERE NULLIF(btrim(COALESCE(container->>'container_number', '')), '') IS NOT NULL;
    IF v_batch_containers IS NOT NULL THEN
      PERFORM public.apply_baplie_physical_flags_atomic(v_voyage_id, v_batch_containers, v_actor);
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    -- Preserva o ID exato que foi persistido em public.bls
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL OR btrim(v_bl_id) = '';
    -- B/L faturado não é recalculado aqui (migration 174, M02): a fatura
    -- emitida segue a ADR 0077 pela base capturada na própria importação.
    -- Recalcular só devolvia "recalculo bloqueado" e enfileirava
    -- provisional_charges em toda reimportação idêntica.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.bls
      WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') IN ('invoiced', 'paid')
    ) OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;

    -- Disparo imediato do calculo inicial das taxas locais com base nas tabelas cadastradas
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      -- Registra rastro detalhado do erro em audit_logs e acumula no retorno do batch.
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
      ) VALUES (
        'bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no calculo automatico de taxas locais na importacao do B/L'
      );
      -- A fila e somente recuperacao: um calculo bem-sucedido nao e repetido pelo worker.
      IF p_batch IS NOT NULL THEN
        PERFORM public.enqueue_import_effect(
          v_action_id,
          'provisional_charges',
          v_bl_id,
          v_actor,
          1,
          v_physical_effect_id,
          jsonb_build_object(
            'filename', v_filename,
            'voyage_id', v_voyage_id,
            'cargo_mode', v_cargo_mode
          )
        );
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id, 'calculation_errors', v_calc_errors);
END;
$function$;

-- 5. Efeito novo da mesma entidade e tipo substitui o pendente.
CREATE OR REPLACE FUNCTION public.enqueue_import_effect(p_source_action_id uuid, p_effect_kind text, p_entity_id text, p_created_by uuid, p_source_revision bigint DEFAULT 1, p_depends_on_effect_id bigint DEFAULT NULL::bigint, p_source_snapshot jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.import_pending_effects%ROWTYPE;
  v_new public.import_pending_effects%ROWTYPE;
  v_entity text := NULLIF(btrim(COALESCE(p_entity_id, '')), '');
  v_snapshot jsonb := COALESCE(p_source_snapshot, '{}'::jsonb);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR p_created_by IS DISTINCT FROM auth.uid() OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_source_action_id IS NULL OR p_effect_kind IS NULL OR v_entity IS NULL THEN
    RAISE EXCEPTION 'Identidade do efeito incompleta.' USING ERRCODE = '22023';
  END IF;
  IF p_source_revision IS NULL OR p_source_revision < 1 THEN
    RAISE EXCEPTION 'Revisao de origem invalida.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Snapshot de origem invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_depends_on_effect_id IS NOT NULL THEN
    PERFORM 1 FROM public.import_pending_effects WHERE id = p_depends_on_effect_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dependencia de efeito inexistente.' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.import_pending_effects
  WHERE source_action_id = p_source_action_id
    AND effect_kind = p_effect_kind
    AND entity_id = v_entity
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_existing), 'idempotent', true);
  END IF;

  INSERT INTO public.import_pending_effects(
    source_action_id, effect_kind, entity_id, status, attempts, created_by,
    source_revision, source_snapshot, depends_on_effect_id, next_attempt_at, updated_at
  ) VALUES (
    p_source_action_id, p_effect_kind, v_entity, 'pending', 0, p_created_by,
    p_source_revision, v_snapshot, p_depends_on_effect_id, now(), now()
  ) RETURNING * INTO v_new;

  UPDATE public.import_pending_effects AS old
     SET status = 'superseded',
         superseded_by_effect_id = v_new.id,
         lease_until = NULL,
         leased_by = NULL,
         result = COALESCE(old.result, '{}'::jsonb)
           || jsonb_build_object('superseded_by_effect_id', v_new.id),
         updated_at = now()
   WHERE old.id <> v_new.id
     AND old.entity_id = v_entity
     AND old.effect_kind = p_effect_kind
     AND (
       -- O efeito novo substitui o que ainda não rodou, qualquer revisão.
       (old.status IN ('pending', 'retry_wait') AND old.source_revision <= p_source_revision)
       OR (old.status = 'running' AND old.source_revision < p_source_revision)
     );

  RETURN jsonb_build_object('effect', to_jsonb(v_new), 'idempotent', false);
END;
$function$;

-- 6. Viagem Cancelada: guardas pelas tabelas que não têm voyage_id próprio.
CREATE OR REPLACE FUNCTION public.guard_voyage_cancelled_via_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_voyage_id bigint;
BEGIN
  v_voyage_id := CASE TG_TABLE_NAME
    WHEN 'bl_containers' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    WHEN 'invoice_bls' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    WHEN 'customer_communication_bls' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    WHEN 'invoices' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    WHEN 'granite_bls' THEN (SELECT voyage_id FROM public.granite_manifests WHERE id = (v_row->>'manifest_id')::uuid)
    WHEN 'customer_communications' THEN NULLIF(v_row->>'anchor_voyage_id', '')::bigint
  END;
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_bl_containers ON public.bl_containers;
CREATE TRIGGER trg_guard_voyage_cancelled_bl_containers
  BEFORE INSERT OR UPDATE OR DELETE ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_via_parent();

DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_granite_bls ON public.granite_bls;
CREATE TRIGGER trg_guard_voyage_cancelled_granite_bls
  BEFORE INSERT OR UPDATE OR DELETE ON public.granite_bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_via_parent();

-- Faturas e comunicados: nada novo nasce em Viagem Cancelada; cancelar uma
-- fatura existente continua possível (UPDATE não é barrado aqui).
DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_invoices ON public.invoices;
CREATE TRIGGER trg_guard_voyage_cancelled_invoices
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_via_parent();

DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_invoice_bls ON public.invoice_bls;
CREATE TRIGGER trg_guard_voyage_cancelled_invoice_bls
  BEFORE INSERT ON public.invoice_bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_via_parent();

DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_customer_communications ON public.customer_communications;
CREATE TRIGGER trg_guard_voyage_cancelled_customer_communications
  BEFORE INSERT ON public.customer_communications
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_via_parent();

DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_customer_communication_bls ON public.customer_communication_bls;
CREATE TRIGGER trg_guard_voyage_cancelled_customer_communication_bls
  BEFORE INSERT ON public.customer_communication_bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_via_parent();

-- cancel_voyage encerra os efeitos pendentes da Viagem.
CREATE OR REPLACE FUNCTION public.cancel_voyage(p_voyage_id bigint, p_reason text, p_changed_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old_status text; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), ''); v_closed integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() OR p_changed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o Administrativo cancela viagem.' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_old_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Viagem % nao encontrada.', p_voyage_id USING ERRCODE = 'P0002'; END IF;
  IF v_old_status = 'cancelled' THEN RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', false); END IF;
  PERFORM set_config('vela.allow_voyage_cancel', 'on', true);
  UPDATE public.voyages SET status = 'cancelled' WHERE id = p_voyage_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyages', p_voyage_id::text, 'status', v_old_status, 'cancelled', p_changed_by, 'Cancelamento de viagem: ' || v_reason);

  UPDATE public.import_pending_effects AS e
     SET status = 'superseded', lease_until = NULL, leased_by = NULL,
         result = COALESCE(e.result, '{}'::jsonb) || jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', p_voyage_id),
         updated_at = now()
   WHERE e.status IN ('pending', 'retry_wait')
     AND public._import_effect_voyage_id(e.effect_kind, e.entity_id) = p_voyage_id;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', true, 'closed_effects', v_closed);
END;
$function$;

-- 7. Simulação do acumulado (server-only).
CREATE OR REPLACE FUNCTION public.simulate_import_effects(p_entity_prefix text DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_effect public.import_pending_effects%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_detail text;
  v_voyage_id bigint;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Simulacao server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Limite de simulacao invalido.' USING ERRCODE = '22023';
  END IF;

  FOR v_effect IN
    SELECT * FROM public.import_pending_effects
    WHERE status IN ('pending', 'retry_wait')
      AND (p_entity_prefix IS NULL OR entity_id LIKE p_entity_prefix)
    ORDER BY created_at, id
    LIMIT p_limit
  LOOP
    v_voyage_id := public._import_effect_voyage_id(v_effect.effect_kind, v_effect.entity_id);
    BEGIN
      DECLARE
        v_invoices_before bigint; v_cancelled_before bigint; v_calcs_before bigint;
        v_result jsonb;
      BEGIN
        SELECT count(*) FILTER (WHERE status NOT IN ('cancelled', 'obsolete')), count(*) FILTER (WHERE status IN ('cancelled', 'obsolete'))
          INTO v_invoices_before, v_cancelled_before FROM public.invoices;
        SELECT count(*) INTO v_calcs_before FROM public.charge_calculations;
        PERFORM set_config('request.jwt.claim.sub', v_effect.created_by::text, true);
        IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
          v_result := jsonb_build_object('status', 'skipped', 'reason', 'voyage_cancelled');
        ELSE
          v_result := CASE v_effect.effect_kind
            WHEN 'physical_flags' THEN public.apply_baplie_physical_flags_atomic(v_effect.entity_id::bigint, NULL, v_effect.created_by)
            WHEN 'provisional_charges' THEN public._run_import_effect_local_charges(v_effect.entity_id, v_effect.created_by)
            WHEN 'local_billing' THEN public._run_import_effect_local_charges(v_effect.entity_id, v_effect.created_by)
            WHEN 'granite_billing' THEN public._run_import_effect_granite_billing(v_effect.entity_id, v_effect.created_by)
            WHEN 'demurrage_billing' THEN public._run_import_effect_demurrage(v_effect.id, v_effect.entity_id, v_effect.created_by)
            WHEN 'vehicle_followup' THEN public._run_import_effect_vehicle_followup(v_effect.entity_id, v_effect.created_by)
          END;
        END IF;
        v_result := jsonb_build_object(
          'outcome', 'would_succeed',
          'result', v_result,
          'invoices_issued', (SELECT count(*) FILTER (WHERE status NOT IN ('cancelled', 'obsolete')) FROM public.invoices) - v_invoices_before,
          'invoices_cancelled', (SELECT count(*) FILTER (WHERE status IN ('cancelled', 'obsolete')) FROM public.invoices) - v_cancelled_before,
          'recalculations', (SELECT count(*) FROM public.charge_calculations) - v_calcs_before
        );
        -- Desfaz tudo o que o efeito fez: só o relato sai da subtransação.
        RAISE EXCEPTION USING ERRCODE = 'VS177', MESSAGE = 'simulacao', DETAIL = v_result::text;
      END;
    EXCEPTION
      WHEN SQLSTATE 'VS177' THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'effect_id', v_effect.id, 'effect_kind', v_effect.effect_kind, 'entity_id', v_effect.entity_id,
          'created_at', v_effect.created_at, 'voyage_id', v_voyage_id) || v_detail::jsonb);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_detail = MESSAGE_TEXT;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'effect_id', v_effect.id, 'effect_kind', v_effect.effect_kind, 'entity_id', v_effect.entity_id,
          'created_at', v_effect.created_at, 'voyage_id', v_voyage_id,
          'outcome', 'would_fail', 'sqlstate', SQLSTATE, 'message', left(v_detail, 1000)));
    END;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_sub, ''), true);
  RETURN jsonb_build_object('simulated', jsonb_array_length(v_items), 'items', v_items);
END;
$function$;

REVOKE ALL ON FUNCTION public.simulate_import_effects(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_import_effects(text, integer) TO service_role;

-- Aprovar processa os selecionados; os demais pendentes do recorte são
-- descartados com registro.
CREATE OR REPLACE FUNCTION public.apply_import_effects_review(
  p_process_ids bigint[],
  p_discard_ids bigint[],
  p_reason text,
  p_reviewed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_id bigint;
  v_processed jsonb := '[]'::jsonb;
  v_discarded integer := 0;
  v_worker text := 'effects-review';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Revisao server-only.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR p_reviewed_by IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo e quem revisou.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_process_ids, '{}') && COALESCE(p_discard_ids, '{}') THEN
    RAISE EXCEPTION 'Um efeito nao pode ser aprovado e descartado ao mesmo tempo.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY COALESCE(p_discard_ids, '{}') LOOP
    UPDATE public.import_pending_effects
       SET status = 'superseded', lease_until = NULL, leased_by = NULL,
           result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('reason', 'discarded_by_review', 'review_reason', v_reason, 'reviewed_by', p_reviewed_by),
           updated_at = now()
     WHERE id = v_id AND status IN ('pending', 'retry_wait');
    IF FOUND THEN
      v_discarded := v_discarded + 1;
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('import_effect', v_id::text, 'discarded', 'pending', 'superseded', p_reviewed_by, 'Revisao do acumulado: ' || v_reason);
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY COALESCE(p_process_ids, '{}') LOOP
    UPDATE public.import_pending_effects
       SET status = 'running', attempts = attempts + 1, lease_until = now() + interval '5 minutes',
           leased_by = v_worker, last_error_code = NULL, last_error_message = NULL, updated_at = now()
     WHERE id = v_id AND status IN ('pending', 'retry_wait');
    IF FOUND THEN
      INSERT INTO public.import_effect_attempts(effect_id, attempt_no, event_kind, worker_id, status)
      SELECT id, attempts, 'claimed', v_worker, 'running' FROM public.import_pending_effects WHERE id = v_id;
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('import_effect', v_id::text, 'approved', 'pending', 'running', p_reviewed_by, 'Revisao do acumulado: ' || v_reason);
      v_processed := v_processed || jsonb_build_array(public.process_import_effect(v_id, v_worker)->'effect');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'discarded', v_discarded);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_import_effects_review(bigint[], bigint[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_import_effects_review(bigint[], bigint[], text, uuid) TO service_role;

-- 8. Métrica e Alerta de fila parada.
CREATE OR REPLACE FUNCTION public.import_effects_queue_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE status IN ('pending', 'retry_wait')),
    'running', count(*) FILTER (WHERE status = 'running'),
    'blocked', count(*) FILTER (WHERE status = 'blocked'),
    'oldest_pending_at', min(created_at) FILTER (WHERE status IN ('pending', 'retry_wait')),
    'oldest_pending_minutes', floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('pending', 'retry_wait'))) / 60),
    'last_completed_at', (SELECT max(a.occurred_at) FROM public.import_effect_attempts AS a WHERE a.event_kind = 'completed')
  )
  FROM public.import_pending_effects;
$function$;

REVOKE ALL ON FUNCTION public.import_effects_queue_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_effects_queue_health() TO authenticated, service_role;

INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('import_effects_queue_stalled', 'critical', 'administrativo', ARRAY['administrativo'], '/alertas')
ON CONFLICT (type) DO NOTHING;

-- Fila parada: efeito pendente há mais de 60 minutos. O Alerta fecha sozinho
-- quando a fila anda (derivado).
CREATE OR REPLACE FUNCTION public.reconcile_import_effects_queue_alert()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_health jsonb := public.import_effects_queue_health();
  v_minutes numeric := NULLIF(v_health->>'oldest_pending_minutes', '')::numeric;
BEGIN
  IF v_minutes IS NOT NULL AND v_minutes >= 60 THEN
    PERFORM public.upsert_alert_item(
      'import_effects_queue_stalled', 'import_effect_queue', 'import_pending_effects',
      format('A fila de efeitos de importação está parada: %s efeito(s) pendente(s), o mais antigo há %s minutos.',
        v_health->>'pending', v_health->>'oldest_pending_minutes'),
      'import-effects-queue-health', v_health, '/alertas');
  ELSE
    PERFORM public.resolve_alert_item('import_effects_queue_stalled', 'import_effect_queue', 'import_pending_effects',
      'import-effects-queue-health', v_health);
  END IF;
  RETURN v_health;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_import_effects_queue_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_import_effects_queue_alert() TO service_role;

DO $cron_177$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'import-effects-queue-health') THEN
      PERFORM cron.unschedule('import-effects-queue-health');
    END IF;
    PERFORM cron.schedule('import-effects-queue-health', '7 * * * *', $cmd_177$SELECT public.reconcile_import_effects_queue_alert();$cmd_177$);
  ELSE
    RAISE WARNING '177: pg_cron ausente; agende public.reconcile_import_effects_queue_alert() de hora em hora neste ambiente.';
  END IF;
END;
$cron_177$;
