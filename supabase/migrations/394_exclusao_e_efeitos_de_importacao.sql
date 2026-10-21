-- 394 — Exclusão e efeitos de importação (Lote 4 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md; ADR 0095, decisões 7, 18 e
-- 25; achados F-13, F-14, F-33a, F-34, F-42 e F-43 da revisão
-- docs/archive/audits/2026-10-21-revisao-importacoes.md).
--
-- Problema e mudança:
--   Decisão 7 (F-14, F-33a). Excluir B/L ou Viagem deixava os efeitos
--     pendentes órfãos: o runner os levava a `blocked/effect_domain_missing`
--     com Alerta crítico permanente. Agora `delete_records` encerra os efeitos
--     pendentes, em espera, em execução ou bloqueados do registro como
--     `superseded` com o motivo "descartado: registro excluído", sem abrir
--     Alerta; o `import_effect_blocked` que existia fecha pelo gatilho da 348.
--     Excluir a Viagem apaga os vazios de importação dela (manifestos e
--     containers) e o manifesto de vazios que ficava sem Viagem, e a prévia
--     da exclusão (`voyage_delete_preview`) conta os vazios de importação.
--   Decisão 18 (F-13, INF-07). CE em B/L em Revisão ou sem tabela de
--     cobrança virava `blocked` com Alerta crítico falso. Agora é espera de
--     negócio: o efeito fica `retry_wait` com `last_error_code`
--     `awaiting_review` ou `awaiting_charge_table`, sem gastar tentativas e
--     sem Alerta, é tentado de novo a cada hora e logo depois de a Revisão
--     mudar o B/L ou de uma tabela de cobrança ser gravada, e conclui sozinho.
--     A espera não segura os outros efeitos do B/L em `claim_import_effects`.
--     O Alerta crítico fica só para falha técnica.
--   Decisão 25 (F-42). Efeito de usuário desativado virava
--     `blocked/authorization_invalid`: roda como a conta de sistema
--     (`app_settings.system_billing_actor`, a mesma da frente financeira, 375,
--     F-52 daquela frente; sem ela, o primeiro Administrativo ativo), e o
--     resultado grava quem iniciou (`initiator_id`) e como rodou
--     (`executed_as`). O Reprocessar do Alerta usa `retry_import_effect` (252),
--     que já exige justificativa; o texto do Alerta passa a dizer o B/L e o
--     motivo.
--   F-42 (INF-14). Produtores que inserem direto em `import_pending_effects`
--     (CE, Manifesto BB, veículos, datas, Granito) não substituíam o efeito
--     pendente do mesmo tipo: um gatilho faz o que `enqueue_import_effect` já
--     fazia.
--   F-34 (sem mudança aqui). Excluir ou mover veículo com o recálculo
--     falhando já não fica com a contagem antiga: desde a 379/381 o
--     `refresh_unbilled_calculations_at_commit` recusa a transação inteira
--     (ADR 0094, B3), e nada precisa ir para a fila. A suíte do lote prova a
--     recusa.
--   F-43. `import_effects_queue_health` não via o efeito `running` com lease
--     vencida: ele entra no atraso (`oldest_due_minutes`) e na contagem
--     `running_expired`; os bloqueados entram no texto do Alerta de fila
--     parada.
--
-- Fora daqui: o erro que escapa do runner (57014, rede) continua chegando ao
-- efeito como `lease_expired` depois de cinco leases; gravar a causa exige
-- mudar a Edge Function `import-effects-runner` (registrado no plano).
--
-- Reescreve linhas existentes (acerto no fim do arquivo): efeitos ativos de
-- B/L ou Viagem que não existem mais saem como descartados, e os bloqueados
-- que hoje são espera de negócio voltam para a espera. Depende da afirmação
-- "Data status" do AGENTS.md (seção Gotchas): o banco de produção só tem dados
-- de teste.
--
-- Rollback: reaplicar as definições anteriores (178 `claim_import_effects`,
-- 211 `process_import_effect`, 355 `_run_import_effect_local_charges`, 385
-- `delete_records`, 341 `delete_voyage_children` e `voyage_delete_preview`,
-- 088 `voyage_delete_children_spec`, 190
-- `import_effects_queue_health` e `reconcile_import_effects_queue_alert`, 025
-- `_record_import_effect_blocked_alert`); DROP dos gatilhos
-- `supersede_older_import_effect`, `nudge_waiting_import_effects_on_bl` e
-- `nudge_waiting_import_effects_on_charge_table` e das funções novas. O acerto
-- não tem volta automática: as tentativas com `worker_id` `migration-394`
-- dizem o que mudou.

-- 1. Exclusão da Viagem: os vazios de importação e o manifesto de vazios saem
--    junto (antes ficavam sem Viagem).
CREATE OR REPLACE FUNCTION public.voyage_delete_children_spec()
RETURNS TABLE(ord integer, table_name text, column_name text, action text, label text)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  VALUES
    (1, 'vehicles', 'voyage_id', 'delete', 'veículo(s)'),
    (2, 'bls', 'voyage_id', 'delete', 'B/L(s), com containers e taxas'),
    (3, 'import_batches', 'voyage_id', 'delete', 'importação(ões) de manifesto'),
    (4, 'manifestos_mercante', 'voyage_id', 'delete', 'Manifesto(s) Mercante'),
    (5, 'voyage_route_ce_master', 'voyage_id', 'delete', 'CE Master por rota'),
    (6, 'baplie_reconciliation_resolutions', 'voyage_id', 'delete', 'resolução(ões) de BAPLIE'),
    (7, 'baplie_containers', 'voyage_id', 'delete', 'container(es) do BAPLIE'),
    (8, 'agency_departure_reports', 'voyage_id', 'delete', 'ADR(s) de Saída em aberto'),
    (9, 'vazios_bookings', 'voyage_id', 'delete', 'unidade(s) de vazios'),
    (10, 'vazios_export_operations', 'voyage_id', 'delete', 'operação(ões) de embarque de vazios'),
    (11, 'voyage_omissions', 'voyage_id', 'delete', 'omissão(ões) de escala e transbordo'),
    (12, 'voyage_escala_terminal_state', 'voyage_id', 'delete', 'atracação(ões)'),
    (13, 'voyage_escala_operation_fronts', 'voyage_id', 'delete', 'frente(s) de operação'),
    (14, 'voyage_escala_revision_state', 'voyage_id', 'delete', 'revisão(ões) de escala'),
    (15, 'voyage_export_schedules', 'voyage_id', 'delete', 'escala(s) de exportação'),
    (16, 'granite_manifests', 'voyage_id', 'detach', 'manifesto(s) de Granito ficam sem viagem'),
    (17, 'vazios_manifests', 'voyage_id', 'delete', 'manifesto(s) de vazios'),
    (18, 'vazios_importacao_manifests', 'voyage_id', 'delete', 'manifesto(s) de vazios de importação');
$function$;
REVOKE ALL ON FUNCTION public.voyage_delete_children_spec() FROM PUBLIC, anon, authenticated;

-- 2. Conta de sistema "Vela (automático)": a mesma regra da 375 (conta
--    configurada em `app_settings.system_billing_actor`; sem ela, o primeiro
--    Administrativo ativo).
-- ponytail: a regra está repetida em `_reprocess_customer_held_billing_as_system`
-- (375); passar aquela função a chamar esta quando ela for redefinida.
CREATE OR REPLACE FUNCTION public._import_effect_system_actor()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT s.system_billing_actor FROM public.app_settings AS s
     JOIN public.user_profiles AS p ON p.id = s.system_billing_actor AND p.active
     WHERE s.id = 1),
    (SELECT p.id FROM public.user_profiles AS p
     WHERE p.active AND p.role IN ('admin', 'administrativo') ORDER BY p.created_at, p.id LIMIT 1));
$function$;
REVOKE ALL ON FUNCTION public._import_effect_system_actor() FROM PUBLIC, anon, authenticated;

-- 3. Espera de negócio do faturamento pelo CE (ADR 0095, decisão 18): B/L em
--    Revisão (Cliente, reconciliação, pendência do gate ou linhas a revisar)
--    ou sem tabela de cobrança para o POD. NULL quando a falha é técnica.
CREATE OR REPLACE FUNCTION public._import_effect_business_wait(p_bl_id text, p_reason text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_tables integer;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND OR v_bl.cancelled_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF p_reason = 'customer_reconciliation_pending'
     OR v_bl.customer_id IS NULL
     OR COALESCE(v_bl.review_status, '') = 'pending_review'
     OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled')
     OR v_bl.charge_status = 'review_required'
     OR EXISTS (SELECT 1 FROM public.charge_calculations AS cc WHERE cc.bl_id = v_bl.id AND cc.status = 'review_required')
     OR COALESCE(cardinality(public.compute_bl_review_pendencies(v_bl.id)), 0) > 0 THEN
    RETURN 'awaiting_review';
  END IF;
  SELECT count(*) INTO v_tables FROM public.resolve_bl_local_charge_table_ids(v_bl.id);
  IF (v_bl.cargo_mode = 'misto' AND v_tables < 2) OR (COALESCE(v_bl.cargo_mode, 'container') <> 'misto' AND v_tables = 0) THEN
    RETURN 'awaiting_charge_table';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._import_effect_business_wait(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._import_effect_wait_message(p_wait text, p_bl_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_wait
    WHEN 'awaiting_review' THEN
      format('Aguardando a Revisão do B/L %s; o faturamento sai sozinho quando ela for concluída.', p_bl_id)
    WHEN 'awaiting_charge_table' THEN
      format('Aguardando a tabela de cobrança do POD %s para o B/L %s; o faturamento sai sozinho quando a tabela for cadastrada.',
        COALESCE((SELECT b.pod FROM public.bls AS b WHERE b.id = p_bl_id), 'sem POD'), p_bl_id)
    ELSE format('Aguardando (%s) o B/L %s.', p_wait, p_bl_id)
  END;
$function$;
REVOKE ALL ON FUNCTION public._import_effect_wait_message(text, text) FROM PUBLIC, anon, authenticated;

-- Estaciona o efeito em espera: `retry_wait` sem gastar tentativas, nova
-- tentativa em 1 hora (antes, se a Revisão mudar o B/L ou uma tabela for
-- gravada). Chamada só por `process_import_effect`, que já conferiu a lease.
-- ponytail: a espera é por consulta de hora em hora; o atalho cobre a Revisão
-- e a tabela de cobrança. Outra espera de negócio pede o seu atalho.
CREATE OR REPLACE FUNCTION public._park_import_effect_waiting(p_effect_id bigint, p_worker_id text, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_code text := left(p_result->>'business_wait', 200);
  v_message text := left(COALESCE(p_result->>'wait_message', p_result->>'business_wait'), 2000);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id FOR UPDATE;
  IF v_row.status IS DISTINCT FROM 'running' OR v_row.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito nao pertence ao worker.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.import_effect_attempts(
    effect_id, attempt_no, event_kind, worker_id, status, result, error_code, error_message
  ) VALUES (
    v_row.id, GREATEST(v_row.attempts, 1), 'completed', p_worker_id, 'retry_wait', p_result, v_code, v_message
  );
  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         lease_until = NULL,
         leased_by = NULL,
         next_attempt_at = now() + interval '1 hour',
         result = p_result,
         last_error_code = v_code,
         last_error_message = v_message,
         updated_at = now()
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false, 'business_wait', v_code);
END;
$function$;
REVOKE ALL ON FUNCTION public._park_import_effect_waiting(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Exclusão (ADR 0095, decisão 7): os efeitos ativos das entidades
--    excluídas saem como descartados, sem Alerta. O bloqueado que tinha
--    `import_effect_blocked` fecha pelo gatilho da 348.
CREATE OR REPLACE FUNCTION public._discard_import_effects_of_deleted(p_entity_ids text[], p_source text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
  v_result jsonb;
BEGIN
  IF cardinality(COALESCE(p_entity_ids, ARRAY[]::text[])) = 0 THEN
    RETURN 0;
  END IF;
  FOR v_row IN
    SELECT e.id, e.attempts, e.status
    FROM public.import_pending_effects AS e
    WHERE e.entity_id = ANY(p_entity_ids)
      AND e.status IN ('pending', 'retry_wait', 'running', 'blocked')
    ORDER BY e.id
    FOR UPDATE
  LOOP
    v_result := jsonb_build_object('reason', 'descartado: registro excluído', 'deleted_kind', p_source,
      'deleted_by', auth.uid(), 'previous_status', v_row.status);
    UPDATE public.import_pending_effects
       SET status = 'superseded',
           lease_until = NULL,
           leased_by = NULL,
           result = COALESCE(result, '{}'::jsonb) || v_result,
           last_error_code = 'record_deleted',
           last_error_message = 'descartado: registro excluído',
           updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(
      effect_id, attempt_no, event_kind, worker_id, status, result, error_code, error_message
    ) VALUES (
      v_row.id, GREATEST(v_row.attempts, 1), 'completed', 'record-deletion', 'superseded', v_result,
      'record_deleted', 'descartado: registro excluído'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public._discard_import_effects_of_deleted(text[], text) FROM PUBLIC, anon, authenticated;

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
          -- 394: o efeito em espera de negócio não segura os demais da entidade.
          AND NOT (prior.status = 'retry_wait' AND COALESCE(prior.last_error_code, '') LIKE 'awaiting\_%')
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
  v_wait text;
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

    -- Irmãos de container (o rateio muda): todos os não faturados, inclusive
    -- com CE ou retidos (ADR 0093, decisão 3: o preço do CE fica congelado, a
    -- base não). Carga solta não tem container e não toca a Viagem.
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
        AND cardinality(public._live_local_invoice_ids_for_bl(b.id)) = 0
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

  -- 394 (ADR 0095, decisão 18): B/L em Revisão ou sem tabela é espera de
  -- negócio. O efeito fica aguardando, sem Alerta crítico, e conclui sozinho.
  IF v_one IS NOT NULL AND v_one->>'status' = 'blocked' THEN
    v_wait := public._import_effect_business_wait(v_origin.id, v_one->>'reason');
    IF v_wait IS NOT NULL THEN
      RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', v_calculated, 'results', v_result,
        'bl_id', v_origin.id, 'business_wait', v_wait,
        'wait_message', public._import_effect_wait_message(v_wait, v_origin.id));
    END IF;
  END IF;

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
  v_anchor text;
  v_requeued text[] := ARRAY[]::text[];
  v_initiator uuid;
  v_as_system boolean := false;
  v_executor jsonb;
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

  v_initiator := v_effect.created_by;
  v_actor := v_initiator;
  -- 394 (ADR 0095, decisão 25): iniciador desativado não bloqueia o efeito;
  -- ele roda como a conta de sistema "Vela (automático)", e o resultado
  -- registra quem o iniciou.
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_initiator AND active) THEN
    v_actor := public._import_effect_system_actor();
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'Iniciador desativado e nenhuma conta de sistema ativa.' USING ERRCODE = '42501';
    END IF;
    v_as_system := true;
  END IF;
  v_executor := jsonb_build_object('executor', 'import-effects-runner', 'worker_id', p_worker_id,
    'initiator_id', v_initiator)
    || CASE WHEN v_as_system THEN jsonb_build_object('executed_as', v_actor, 'executed_as_system', true,
         'executed_as_reason', 'iniciador desativado') ELSE '{}'::jsonb END;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  -- Viagem Cancelada: a operação está selada; o efeito sai sem agir.
  v_voyage_id := public._import_effect_voyage_id(v_effect.effect_kind, v_effect.entity_id);
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'superseded',
      jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', v_voyage_id,
        'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_initiator),
      NULL, NULL, NULL);
  END IF;

  -- B/L Cancelado é somente leitura: o efeito pendente dele sai sem agir, em
  -- vez de esbarrar na guarda do B/L e virar bloqueio com Alerta crítico.
  IF v_effect.effect_kind <> 'granite_billing'
     AND EXISTS (SELECT 1 FROM public.bls WHERE id = v_effect.entity_id AND cancelled_at IS NOT NULL) THEN
    -- Âncora de Demurrage cancelado (211): a emissão passa ao âncora que restou
    -- em cada grupo dos B/Ls ativos que dividiam container com ele.
    IF v_effect.effect_kind = 'demurrage_billing' THEN
      FOR v_anchor IN
        SELECT DISTINCT public.demurrage_group_anchor(other.id)
        FROM public.bls AS cancelled
        JOIN public.bl_containers AS mine ON mine.bl_id = cancelled.id
        JOIN public.bl_containers AS theirs
          ON upper(btrim(theirs.container_number)) = upper(btrim(mine.container_number))
         AND theirs.bl_id <> mine.bl_id
        JOIN public.bls AS other ON other.id = theirs.bl_id
        WHERE cancelled.id = v_effect.entity_id
          AND cancelled.customer_id IS NOT NULL
          AND other.voyage_id = cancelled.voyage_id
          AND other.customer_id = cancelled.customer_id
          AND other.cancelled_at IS NULL
      LOOP
        CONTINUE WHEN v_anchor IS NULL;
        PERFORM public.enqueue_import_effect(
          md5('demurrage_requeue:' || v_effect.id)::uuid, 'demurrage_billing', v_anchor, v_actor, 1, NULL,
          jsonb_build_object('source', 'demurrage_anchor_cancelled',
            'cancelled_bl_id', v_effect.entity_id, 'origin_effect_id', v_effect.id));
        v_requeued := array_append(v_requeued, v_anchor);
      END LOOP;
    END IF;
    RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'superseded',
      jsonb_build_object('reason', 'bl_cancelled', 'bl_id', v_effect.entity_id,
        'executor', 'import-effects-runner', 'worker_id', p_worker_id, 'initiator_id', v_initiator)
      || CASE WHEN cardinality(v_requeued) > 0
           THEN jsonb_build_object('requeued_anchor_bl_ids', to_jsonb(v_requeued)) ELSE '{}'::jsonb END,
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

  v_result := COALESCE(v_result, '{}'::jsonb) || v_executor;
  IF v_result ? 'business_wait' THEN
    RETURN public._park_import_effect_waiting(v_effect.id, p_worker_id, v_result);
  END IF;
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
      COALESCE(v_executor, jsonb_build_object('executor', 'import-effects-runner', 'worker_id', p_worker_id,
        'initiator_id', v_effect.created_by)) || jsonb_build_object('sqlstate', v_sqlstate),
      v_error_code, v_error_message, v_retry_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_records(p_kind text, p_ids text[], p_dry_run boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id text;
  v_count integer;
  v_deleted jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_state text;
  v_message text;
  v_constraint text;
  v_entity text;
  v_lock text[];
  v_status text;
  v_bl_id text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_bl_voyage bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;

  v_entity := CASE p_kind
    WHEN 'bl' THEN 'bl'
    WHEN 'container' THEN 'container'
    WHEN 'vehicle' THEN 'vehicle'
    WHEN 'customer' THEN 'customer'
    WHEN 'voyage' THEN 'voyages'
  END;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Tipo de exclusão desconhecido: %.', p_kind USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_dry_run, false) AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY ARRAY(
    SELECT u.id FROM unnest(COALESCE(p_ids, ARRAY[]::text[])) WITH ORDINALITY AS u(id, ord)
    GROUP BY u.id ORDER BY min(u.ord)
  ) LOOP
    BEGIN
      v_lock := ARRAY[]::text[];
      IF p_kind = 'voyage' THEN
        SELECT status INTO v_status FROM public.voyages WHERE id = v_id::bigint;
        IF FOUND AND v_status = 'cancelled' THEN
          v_lock := ARRAY['viagem cancelada fica retida'];
        ELSE
          v_lock := public.delete_lock_reasons(v_id::bigint);
        END IF;
      ELSIF p_kind = 'customer' THEN
        IF EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_id::bigint AND NULLIF(btrim(c.cnpj_cpf), '') IS NOT NULL) THEN
          v_lock := ARRAY['cliente com CNPJ: desative em vez de excluir'];
        END IF;
      ELSE
        v_bl_id := CASE p_kind
          WHEN 'bl' THEN v_id
          WHEN 'container' THEN (SELECT c.bl_id FROM public.bl_containers c WHERE c.id = v_id::bigint)
          ELSE (SELECT COALESCE(v.bl_id, c.bl_id) FROM public.vehicles v
                LEFT JOIN public.bl_containers c ON c.id = v.container_id WHERE v.id = v_id::bigint)
        END;
        v_lock := public.bl_delete_lock_reasons(v_bl_id);
      END IF;
      IF cardinality(v_lock) > 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', to_jsonb(v_lock));
        CONTINUE;
      END IF;

      -- 380: a exclusão do B/L (ou da Viagem) leva junto os containers e
      -- veículos, mesmo de B/L cancelado, que é somente leitura no resto.
      PERFORM set_config('vela.deleting_records', CASE WHEN p_kind IN ('voyage', 'bl') THEN 'on' ELSE 'off' END, true);
      -- 394 (ADR 0095, decisão 7): os efeitos pendentes do registro saem
      -- como "descartado: registro excluído", sem Alerta.
      IF p_kind = 'voyage' THEN
        PERFORM public._discard_import_effects_of_deleted(
          ARRAY(SELECT b.id FROM public.bls AS b WHERE b.voyage_id = v_id::bigint)
          || CASE WHEN EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = v_id AND b.voyage_id IS DISTINCT FROM v_id::bigint)
               THEN ARRAY[]::text[] ELSE ARRAY[v_id] END,
          'voyage');
      ELSIF p_kind = 'bl' THEN
        PERFORM public._discard_import_effects_of_deleted(ARRAY[v_id], 'bl');
      END IF;
      IF p_kind = 'voyage' THEN
        PERFORM public.delete_voyage_children(v_id::bigint);
        DELETE FROM public.voyages WHERE id = v_id::bigint;
      ELSIF p_kind = 'bl' THEN
        SELECT b.voyage_id INTO v_bl_voyage FROM public.bls AS b WHERE b.id = v_id;
        DELETE FROM public.vehicles WHERE bl_id = v_id;
        DELETE FROM public.bls WHERE id = v_id;
      ELSIF p_kind = 'container' THEN
        DELETE FROM public.vehicles WHERE container_id = v_id::bigint;
        DELETE FROM public.bl_containers WHERE id = v_id::bigint;
      ELSIF p_kind = 'vehicle' THEN
        DELETE FROM public.vehicles WHERE id = v_id::bigint;
      ELSE
        DELETE FROM public.customer_contacts WHERE customer_id = v_id::bigint;
        DELETE FROM public.customer_rate_overrides WHERE customer_id = v_id::bigint;
        DELETE FROM public.customers WHERE id = v_id::bigint;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      PERFORM set_config('vela.deleting_records', 'off', true);

      IF v_count = 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('não encontrado'));
      ELSIF p_dry_run THEN
        RAISE EXCEPTION USING ERRCODE = 'VL001';
      ELSE
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), v_reason);
        IF p_kind = 'bl' AND v_bl_voyage IS NOT NULL THEN
          INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
          VALUES ('voyages', v_bl_voyage::text, 'bl_deleted', v_id, 'excluído', auth.uid(), v_reason);
        END IF;
        v_deleted := v_deleted || to_jsonb(v_id);
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'VL001' THEN
        v_deleted := v_deleted || to_jsonb(v_id);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_state = RETURNED_SQLSTATE,
          v_message = MESSAGE_TEXT,
          v_constraint = CONSTRAINT_NAME;
        v_blocked := v_blocked || jsonb_build_object(
          'id', v_id,
          'reasons', jsonb_build_array(public.delete_record_block_reason(v_state, v_message, v_constraint))
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'blocked', v_blocked, 'dry_run', p_dry_run);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_voyage_children(p_voyage_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_spec record;
  v_pass integer;
  v_left boolean;
BEGIN
  -- 394: o manifesto de vazios que ainda tem unidade de outra Viagem só se
  -- desliga; o resto sai com a Viagem (antes ficava órfão).
  UPDATE public.vazios_manifests AS m SET voyage_id = NULL
  WHERE m.voyage_id = p_voyage_id
    AND EXISTS (SELECT 1 FROM public.vazios_bookings AS vb WHERE vb.manifest_id = m.id AND vb.voyage_id <> p_voyage_id);
  FOR v_pass IN 1..3 LOOP
    v_left := false;
    FOR v_spec IN SELECT * FROM public.voyage_delete_children_spec() ORDER BY ord LOOP
      BEGIN
        IF v_spec.action = 'detach' THEN
          EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I = $1', v_spec.table_name, v_spec.column_name, v_spec.column_name) USING p_voyage_id;
        ELSE
          EXECUTE format('DELETE FROM public.%I WHERE %I = $1', v_spec.table_name, v_spec.column_name) USING p_voyage_id;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        v_left := true;
      END;
    END LOOP;
    EXIT WHEN NOT v_left;
  END LOOP;
  -- Alertas não têm FK para a viagem (chave em texto): saem por aqui (341).
  PERFORM public.delete_voyage_alerts(p_voyage_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.voyage_delete_preview(p_voyage_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_spec record;
  v_count bigint;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir viagem.' USING ERRCODE = '42501';
  END IF;
  FOR v_spec IN SELECT * FROM public.voyage_delete_children_spec() ORDER BY ord LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', v_spec.table_name, v_spec.column_name)
      INTO v_count USING p_voyage_id;
    IF v_count > 0 THEN
      v_items := v_items || jsonb_build_object('table', v_spec.table_name, 'action', v_spec.action, 'label', v_spec.label, 'count', v_count);
    END IF;
  END LOOP;
  IF v_items <> '[]'::jsonb THEN
    v_items := jsonb_build_array(jsonb_build_object(
      'table', 'bl_containers', 'action', 'delete', 'label', 'container(es) dos B/Ls',
      'count', (SELECT count(*) FROM public.bl_containers c JOIN public.bls b ON b.id = c.bl_id WHERE b.voyage_id = p_voyage_id)
    )) || v_items;
  END IF;
  -- 394: os vazios de importação vão junto; o diálogo mostra quantos.
  SELECT count(*) INTO v_count
  FROM public.vazios_importacao_containers AS c
  JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
  WHERE m.voyage_id = p_voyage_id;
  IF v_count > 0 THEN
    v_items := v_items || jsonb_build_object('table', 'vazios_importacao_containers', 'action', 'delete',
      'label', 'vazio(s) de importação', 'count', v_count);
  END IF;
  -- Alertas da viagem e itens que apontam para ela (mesmo escopo que a
  -- exclusão apaga, migration 341). Conta os ativos e os já resolvidos.
  SELECT count(*) INTO v_count FROM public.voyage_alert_scope(p_voyage_id);
  IF v_count > 0 THEN
    v_items := v_items || jsonb_build_object('table', 'alerts', 'action', 'delete', 'label', 'alerta(s) da viagem', 'count', v_count);
  END IF;
  RETURN jsonb_build_object('items', v_items);
END;
$function$;

-- 5. F-42 (INF-14): o efeito novo substitui o pendente do mesmo tipo e
--    entidade, também quando o produtor insere direto na tabela.
CREATE OR REPLACE FUNCTION public.supersede_older_import_effect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.import_pending_effects AS prev
     SET status = 'superseded',
         superseded_by_effect_id = NEW.id,
         lease_until = NULL,
         leased_by = NULL,
         result = COALESCE(prev.result, '{}'::jsonb) || jsonb_build_object('superseded_by_effect_id', NEW.id),
         updated_at = now()
   WHERE prev.id <> NEW.id
     AND prev.entity_id = NEW.entity_id
     AND prev.effect_kind = NEW.effect_kind
     AND prev.status IN ('pending', 'retry_wait')
     AND prev.source_revision <= NEW.source_revision;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.supersede_older_import_effect() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS supersede_older_import_effect ON public.import_pending_effects;
CREATE TRIGGER supersede_older_import_effect
  AFTER INSERT ON public.import_pending_effects
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.supersede_older_import_effect();

-- 6. Espera de negócio: a Revisão que muda o B/L e a tabela de cobrança
--    gravada antecipam a próxima tentativa.
CREATE OR REPLACE FUNCTION public.nudge_waiting_import_effects_on_bl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.import_pending_effects
     SET next_attempt_at = now(), updated_at = now()
   WHERE entity_id = NEW.id
     AND status = 'retry_wait'
     AND last_error_code LIKE 'awaiting\_%'
     AND next_attempt_at > now();
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.nudge_waiting_import_effects_on_bl() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nudge_waiting_import_effects_on_bl ON public.bls;
CREATE TRIGGER nudge_waiting_import_effects_on_bl
  AFTER UPDATE OF review_status, customer_id, customer_reconciliation_status, charge_status, pod, cargo_mode ON public.bls
  FOR EACH ROW
  WHEN (OLD.review_status IS DISTINCT FROM NEW.review_status
     OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
     OR OLD.customer_reconciliation_status IS DISTINCT FROM NEW.customer_reconciliation_status
     OR OLD.charge_status IS DISTINCT FROM NEW.charge_status
     OR OLD.pod IS DISTINCT FROM NEW.pod
     OR OLD.cargo_mode IS DISTINCT FROM NEW.cargo_mode)
  EXECUTE FUNCTION public.nudge_waiting_import_effects_on_bl();

CREATE OR REPLACE FUNCTION public.nudge_waiting_import_effects_on_charge_table()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.import_pending_effects
     SET next_attempt_at = now(), updated_at = now()
   WHERE status = 'retry_wait'
     AND last_error_code = 'awaiting_charge_table'
     AND next_attempt_at > now();
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.nudge_waiting_import_effects_on_charge_table() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nudge_waiting_import_effects_on_charge_table ON public.charge_tables;
CREATE TRIGGER nudge_waiting_import_effects_on_charge_table
  AFTER INSERT OR UPDATE ON public.charge_tables
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.nudge_waiting_import_effects_on_charge_table();

-- 7. Alerta do efeito bloqueado: o texto diz o efeito, o B/L (ou a Viagem) e
--    o motivo, para o Reprocessar do Alerta.
CREATE OR REPLACE FUNCTION public._record_import_effect_blocked_alert(
  p_effect_id bigint,
  p_effect_kind text,
  p_entity_id text,
  p_error_code text,
  p_error_message text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_kind text := CASE p_effect_kind
    WHEN 'physical_flags' THEN 'marcas físicas do Baplie'
    WHEN 'provisional_charges' THEN 'cálculo das Taxas Locais'
    WHEN 'local_billing' THEN 'faturamento pelo CE'
    WHEN 'granite_billing' THEN 'faturamento do Granito'
    WHEN 'demurrage_billing' THEN 'faturamento da Demurrage'
    WHEN 'vehicle_followup' THEN 'recálculo dos veículos'
    ELSE p_effect_kind
  END;
  v_entity text := CASE
    WHEN EXISTS (SELECT 1 FROM public.bls WHERE id = p_entity_id) THEN 'do B/L ' || p_entity_id
    WHEN p_entity_id ~ '^[0-9]{1,18}$' THEN 'da Viagem ' || COALESCE(
      (SELECT v.voyage_number FROM public.voyages AS v WHERE v.id = p_entity_id::bigint), p_entity_id)
    ELSE 'de ' || p_entity_id
  END;
  v_reason text := left(regexp_replace(COALESCE(NULLIF(btrim(p_error_message), ''), p_error_code, 'motivo não informado'), '[[:cntrl:]]', ' ', 'g'), 300);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  BEGIN
    PERFORM public.upsert_alert_item(
      'import_effect_blocked',
      'import_effect',
      p_effect_id::text,
      format('O %s %s está bloqueado: %s', v_kind, v_entity, v_reason),
      'import-effects-runner',
      jsonb_build_object(
        'effect_id', p_effect_id,
        'effect_kind', p_effect_kind,
        'entity_id', p_entity_id,
        'bl_id', CASE WHEN EXISTS (SELECT 1 FROM public.bls WHERE id = p_entity_id) THEN p_entity_id END,
        'error_code', p_error_code,
        'error_message', left(regexp_replace(COALESCE(p_error_message, ''), '[[:cntrl:]]', ' ', 'g'), 500)
      ),
      '/alertas'
    );
  EXCEPTION WHEN OTHERS THEN
    -- A fila continua concluível mesmo se a infraestrutura de notificação
    -- estiver degradada; a falha fica no histórico do próprio efeito.
    RAISE WARNING 'Não foi possível abrir alerta do efeito %: %', p_effect_id, SQLERRM;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public._record_import_effect_blocked_alert(bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- 8. F-43: saúde da fila com o `running` de lease vencida no atraso.
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
    'running_expired', count(*) FILTER (WHERE status = 'running' AND lease_until <= now()),
    'blocked', count(*) FILTER (WHERE status = 'blocked'),
    'waiting', count(*) FILTER (WHERE status = 'retry_wait' AND last_error_code LIKE 'awaiting\_%'),
    'oldest_pending_at', min(created_at) FILTER (WHERE status IN ('pending', 'retry_wait')),
    'oldest_pending_minutes', floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('pending', 'retry_wait'))) / 60),
    -- Atraso real: há quanto tempo a tentativa mais antiga já podia ter rodado.
    -- Efeito em backoff (retry_wait com next_attempt_at futuro) não conta; o
    -- `running` de lease vencida conta desde o vencimento (o runner parou).
    'oldest_due_minutes', floor(extract(epoch FROM now() - LEAST(
      min(next_attempt_at) FILTER (WHERE status IN ('pending', 'retry_wait') AND next_attempt_at <= now()),
      min(lease_until) FILTER (WHERE status = 'running' AND lease_until <= now()))) / 60),
    'oldest_blocked_minutes', floor(extract(epoch FROM now() - min(updated_at) FILTER (WHERE status = 'blocked')) / 60),
    'last_completed_at', (SELECT max(a.occurred_at) FROM public.import_effect_attempts AS a WHERE a.event_kind = 'completed')
  )
  FROM public.import_pending_effects;
$function$;
REVOKE ALL ON FUNCTION public.import_effects_queue_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_effects_queue_health() TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_import_effects_queue_alert()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_health jsonb := public.import_effects_queue_health();
  v_minutes numeric := NULLIF(v_health->>'oldest_due_minutes', '')::numeric;
BEGIN
  -- Chamada pelo pg_cron, sem JWT: a reconciliação de Alertas exige um ator
  -- autorizado; o papel de serviço vale só até o fim desta função (como a 168).
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF v_minutes IS NOT NULL AND v_minutes >= 60 THEN
    PERFORM public.upsert_alert_item(
      'import_effects_queue_stalled', 'import_effect_queue', 'import_pending_effects',
      format('A fila de efeitos de importação está parada: %s efeito(s) pendente(s), %s em execução com a lease vencida e %s bloqueado(s); o mais atrasado há %s minutos.',
        v_health->>'pending', v_health->>'running_expired', v_health->>'blocked', v_health->>'oldest_due_minutes'),
      'import-effects-queue-health', v_health, '/alertas');
  ELSE
    PERFORM public.resolve_alert_item('import_effects_queue_stalled', 'import_effect_queue', 'import_pending_effects',
      'import-effects-queue-health', v_health);
  END IF;
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  RETURN v_health;
END;
$function$;

-- 9. Acerto (depende do "Data status"): efeitos ativos de B/L ou Viagem que
--    não existem mais saem como descartados; os bloqueados que são espera de
--    negócio voltam para a espera (o Alerta fecha pelo gatilho da 348).
DO $$
DECLARE
  v_row record;
  v_wait text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_row IN
    SELECT e.id, e.attempts, e.status
    FROM public.import_pending_effects AS e
    WHERE e.status IN ('pending', 'retry_wait', 'blocked')
      AND e.effect_kind IN ('provisional_charges', 'local_billing', 'demurrage_billing', 'vehicle_followup', 'physical_flags')
      AND NOT EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = e.entity_id)
      AND NOT (e.entity_id ~ '^[0-9]{1,18}$' AND EXISTS (SELECT 1 FROM public.voyages AS v WHERE v.id = e.entity_id::bigint))
  LOOP
    UPDATE public.import_pending_effects
       SET status = 'superseded', lease_until = NULL, leased_by = NULL,
           result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('reason', 'descartado: registro excluído', 'deleted_kind', 'migration_394'),
           last_error_code = 'record_deleted', last_error_message = 'descartado: registro excluído', updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(effect_id, attempt_no, event_kind, worker_id, status, error_code, error_message)
    VALUES (v_row.id, GREATEST(v_row.attempts, 1), 'completed', 'migration-394', 'superseded', 'record_deleted', 'descartado: registro excluído');
  END LOOP;

  FOR v_row IN
    SELECT e.id, e.attempts, e.entity_id
    FROM public.import_pending_effects AS e
    JOIN public.bls AS b ON b.id = e.entity_id
    WHERE e.status = 'blocked'
      AND e.effect_kind IN ('provisional_charges', 'local_billing')
      AND COALESCE(e.last_error_code, '') NOT IN ('authorization_invalid', 'unsupported_effect_kind', 'invalid_effect_payload')
  LOOP
    v_wait := public._import_effect_business_wait(v_row.entity_id, NULL);
    CONTINUE WHEN v_wait IS NULL;
    UPDATE public.import_pending_effects
       SET status = 'retry_wait', attempts = 0, next_attempt_at = now(),
           last_error_code = v_wait, last_error_message = public._import_effect_wait_message(v_wait, v_row.entity_id),
           updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(effect_id, attempt_no, event_kind, worker_id, status, error_code, error_message)
    VALUES (v_row.id, GREATEST(v_row.attempts, 1), 'completed', 'migration-394', 'retry_wait', v_wait,
      public._import_effect_wait_message(v_wait, v_row.entity_id));
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', '', true);
END
$$;
