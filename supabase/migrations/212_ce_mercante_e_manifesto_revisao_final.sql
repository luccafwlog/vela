-- 212 — Revisão final da PR 929 (CE Mercante e Manifesto Mercante).
--
-- 1. Manifesto Mercante só muda pelas RPCs (ADR 0078, item 7). O papel
--    `authenticated` tinha INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES
--    em `manifestos_mercante` (a política só pedia usuário ativo) e qualquer
--    usuário ativo podia trocar `bls.manifesto_mercante_id` direto pela API,
--    sem mesma rota nem motivo. Agora a API só lê o cadastro, e o gatilho
--    `guard_bl_manifesto_port` recusa (42501) a mudança do vínculo feita por
--    sessão de usuário (`authenticated`/`anon`). As RPCs, a planilha de CE, o
--    COD e as importações rodam como dono (SECURITY DEFINER) e passam. O nome
--    do gatilho ordena antes de `trg_unlink_manifesto_on_route_change`: ele vê
--    só o que a sessão mandou; o desvínculo por troca de POL/POD/Viagem vem
--    depois e continua valendo para a ficha do B/L.
-- 2. `emit_ce_mercante_billing`: o B/L que sai como `skipped` (nada a faturar,
--    isento, sem CE, cancelado) deixa o Alerta de tabela faltando e fecha a
--    falha de emissão anterior, como o B/L faturado.
-- 3. `apply_ce_mercante_rows_atomic_legacy_189`: a mesma planilha de novo
--    devolve em `billing_pending_bl_ids` o B/L ativo, com CE, financeiro
--    pendente e sem fatura local viva — o que a emissão interrompida deixou.
-- 4. `apply_granite_ce_mercante_update` deixa de ser da API (era executável
--    por `authenticated` desde a 002 e apagava o CE com ''); só a planilha de
--    CE (SECURITY DEFINER) a chama. O CE novo tem a regra do B/L: sem espaços,
--    15 dígitos, senão 22023.
--
-- Redefine a partir das definições efetivas (`emit_ce_mercante_billing` da
-- 209, `apply_ce_mercante_rows_atomic_legacy_189` da 209,
-- `apply_granite_ce_mercante_update` da 002/281). Não reescreve nem apaga
-- linhas existentes. Rollback: reaplicar as definições anteriores, DROP do
-- gatilho/função `guard_bl_manifesto_port` e GRANT dos privilégios revogados.

-- 1. Manifesto Mercante -------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.manifestos_mercante FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.guard_bl_manifesto_port()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- SECURITY INVOKER de propósito: `current_user` é o da sessão; dentro das
  -- RPCs (SECURITY DEFINER) é o dono e a gravação passa.
  IF current_user IN ('authenticated', 'anon')
     AND (CASE WHEN TG_OP = 'INSERT' THEN NEW.manifesto_mercante_id IS NOT NULL
               ELSE NEW.manifesto_mercante_id IS DISTINCT FROM OLD.manifesto_mercante_id END) THEN
    RAISE EXCEPTION 'O Manifesto Mercante do B/L % muda só por Mover ou Desvincular (Viagem › Rotas e Manifestos ou ficha do B/L) ou pela planilha de CE Mercante.', NEW.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_bl_manifesto_port() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_bl_manifesto_port ON public.bls;
CREATE TRIGGER guard_bl_manifesto_port
  BEFORE INSERT OR UPDATE OF manifesto_mercante_id ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_bl_manifesto_port();

-- 2. Emissão: "Nada a faturar" fecha os Alertas do B/L ------------------------

CREATE OR REPLACE FUNCTION public.emit_ce_mercante_billing(p_bl_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_bl_id text;
  v_bl public.bls%ROWTYPE;
  v_one jsonb;
  v_wait jsonb;
  v_gate_refusal boolean;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_state text;
  v_message text;
  v_pod text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_bl_ids, ARRAY[]::text[])) > 50 THEN
    RAISE EXCEPTION 'No máximo 50 B/Ls por lote de emissão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_bl_id IN ARRAY COALESCE(p_bl_ids, ARRAY[]::text[]) LOOP
    BEGIN
      PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
      IF NOT FOUND THEN
        v_one := jsonb_build_object('status', 'blocked', 'reason', 'not_found', 'message', 'B/L não encontrado.');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND (cancelled_at IS NOT NULL OR NULLIF(btrim(COALESCE(ce_mercante, '')), '') IS NULL)) THEN
        v_one := jsonb_build_object('status', 'skipped', 'reason', 'no_ce_or_cancelled');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') <> 'pending')
            OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0 THEN
        v_one := jsonb_build_object('status', 'already_invoiced');
      ELSE
        -- Tabela cadastrada depois da espera (decisão 4): o cálculo cuja única
        -- revisão era "nenhuma tabela ativa" é refeito antes da emissão. Outra
        -- linha em revisão é revisão de pessoa e fica.
        IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND charge_status = 'review_required')
           AND EXISTS (
             SELECT 1 FROM public.charge_calculations AS c
             WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
               AND COALESCE(c.review_reason, '') LIKE 'Nenhuma tabela de taxas ativa%')
           AND NOT EXISTS (
             SELECT 1 FROM public.charge_calculations AS c
             WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
               AND COALESCE(c.review_reason, '') NOT LIKE 'Nenhuma tabela de taxas ativa%')
           AND EXISTS (SELECT 1 FROM public.resolve_bl_local_charge_table_ids(v_bl_id)) THEN
          PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
        END IF;
        v_one := public._auto_bill_bl_core(v_bl_id, v_actor, true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_one := jsonb_build_object('status', 'blocked', 'reason', 'auto_billing_failed',
        'message', public._ce_row_error_message(v_state, v_message), 'sqlstate', v_state);
    END;

    -- Esperas de negócio (K1): Cliente não conciliado e Revisão pendente não
    -- são falha. A recusa das travas de faturamento chega como 22023/P0003
    -- (`mark_bl_ready_for_billing`, `prevent_pending_review_invoice`); o
    -- estado do B/L diz qual espera é.
    v_wait := NULL;
    IF v_one->>'status' = 'blocked' THEN
      SELECT * INTO v_bl FROM public.bls WHERE id = v_bl_id;
      IF FOUND THEN
        v_gate_refusal := v_one->>'reason' = 'auto_billing_failed'
          AND COALESCE(v_one->>'sqlstate', '') IN ('22023', 'P0003');
        IF v_one->>'reason' = 'customer_reconciliation_pending'
           OR (v_gate_refusal AND (v_bl.customer_id IS NULL
             OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))) THEN
          v_wait := jsonb_build_object('reason', 'customer_reconciliation_pending', 'waiting', true,
            'message', 'Aguardando conciliação do Cliente: a fatura sai quando o Cliente do B/L for conciliado.');
        -- Tabela de cobrança faltando para o POD e a modalidade (ADR 0079,
        -- decisão 4): espera de cadastro, não falha técnica nem Revisão. Vem da
        -- recusa da emissão (P0004) ou do cálculo que ficou em revisão por não
        -- achar tabela ativa. Um Alerta por POD e modalidade lista os B/Ls e
        -- fecha quando as faturas saem.
        ELSIF (v_one->>'reason' = 'auto_billing_failed'
               AND COALESCE(v_one->>'sqlstate', '') = 'P0004'
               AND COALESCE(v_one->>'message', '') ~* 'tabela de cobran')
           OR (v_gate_refusal
               AND EXISTS (
                 SELECT 1 FROM public.charge_calculations AS c
                 WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
                   AND COALESCE(c.review_reason, '') LIKE 'Nenhuma tabela de taxas ativa%')
               AND NOT EXISTS (SELECT 1 FROM public.resolve_bl_local_charge_table_ids(v_bl_id))) THEN
          v_pod := COALESCE(public.normalize_port_code(v_bl.pod), NULLIF(upper(btrim(COALESCE(v_bl.pod, ''))), ''), '—');
          v_wait := jsonb_build_object('reason', 'charge_table_missing', 'waiting', true,
            'message', format('Aguardando tabela de cobrança: cadastre a tabela do POD %s (%s) em Taxas Locais › Tabelas; a fatura sai na próxima emissão.',
              v_pod, public._cargo_mode_label(v_bl.cargo_mode)));
          PERFORM public._note_charge_table_gap(v_pod, v_bl.cargo_mode, v_bl_id);
        ELSIF v_gate_refusal AND (
          v_bl.review_status = 'pending_review'
          OR v_bl.charge_status = 'review_required'
          OR EXISTS (SELECT 1 FROM public.charge_calculations AS c WHERE c.bl_id = v_bl_id AND c.status = 'review_required')
          OR COALESCE(cardinality(public.compute_bl_review_pendencies(v_bl_id)), 0) > 0
          OR COALESCE(cardinality(public.check_bl_terminal_pendencies(v_bl_id)), 0) > 0
          OR COALESCE(v_one->>'message', '') ~* '(revis|terminal)'
        ) THEN
          v_wait := jsonb_build_object('reason', 'review_pending', 'waiting', true,
            'message', 'Aguardando Revisão do B/L: a fatura sai quando a Revisão terminar.');
        -- Cálculo feito e nenhuma taxa com valor (decisão 4): nada a faturar,
        -- sem Alerta. Sem cálculo, continua falha.
        ELSIF v_one->>'reason' = 'auto_billing_failed'
              AND COALESCE(v_one->>'message', '') ~* 'sem linhas fatur'
              AND EXISTS (
                SELECT 1 FROM public.charge_calculations AS c
                WHERE c.bl_id = v_bl_id AND COALESCE(c.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
              ) THEN
          v_one := jsonb_build_object('status', 'skipped', 'reason', 'nothing_to_bill',
            'message', 'Nada a faturar: o cálculo do B/L não tem taxa com valor.');
        END IF;
      END IF;
      IF v_wait IS NOT NULL THEN
        v_one := v_one || v_wait;
      END IF;
    END IF;

    v_status := CASE
      WHEN v_one->>'status' IN ('invoiced', 'already_invoiced') THEN 'invoiced'
      WHEN v_one->>'status' = 'held' THEN 'held'
      WHEN v_one->>'status' = 'skipped' THEN 'skipped'
      ELSE 'blocked'
    END;
    IF v_status = 'blocked' AND v_wait IS NULL THEN
      -- Alerta por B/L (ADR 0041): a falha técnica não fica escondida no lote.
      BEGIN
        PERFORM public.upsert_billing_alert('billing_auto_issue_failed', v_bl_id,
          format('A emissão automática do B/L %s pelo CE Mercante falhou: %s', v_bl_id,
            COALESCE(NULLIF(btrim(v_one->>'message'), ''), 'erro sem mensagem (' || COALESCE(v_one->>'reason', 'desconhecido') || ')')),
          jsonb_build_object('bl_id', v_bl_id, 'reason', v_one->>'reason', 'sqlstate', v_one->>'sqlstate', 'source', 'ce_mercante_planilha'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não registrado: %', v_bl_id, SQLERRM;
      END;
    ELSIF v_status = 'invoiced' THEN
      -- A fatura saiu: a falha anterior deixa de valer.
      BEGIN
        PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', v_bl_id, 'ce_mercante_planilha',
          jsonb_build_object('resolution', 'invoiced'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não resolvido: %', v_bl_id, SQLERRM;
      END;
    ELSIF v_status = 'skipped' THEN
      -- Nada a faturar, isento, sem CE ou cancelado (212): o B/L não espera
      -- mais fatura. Sai da lista de tabela faltando e a falha anterior fecha,
      -- como quando a fatura sai.
      BEGIN
        PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', v_bl_id, 'ce_mercante_planilha',
          jsonb_build_object('resolution', 'no_longer_billable', 'reason', v_one->>'reason'));
        PERFORM public._drop_bls_from_charge_table_gaps(ARRAY[v_bl_id],
          'bl_' || COALESCE(NULLIF(v_one->>'reason', ''), 'skipped'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alertas do B/L % sem fatura a emitir não atualizados: %', v_bl_id, SQLERRM;
      END;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl_id,
      'status', v_status,
      'reason', COALESCE(v_one->>'reason', v_one->>'status'),
      'message', v_one->>'message',
      'waiting', v_wait IS NOT NULL,
      'invoice_number', (SELECT i.invoice_number FROM public.invoices AS i
        WHERE i.id = ANY(public._live_local_invoice_ids_for_bl(v_bl_id)) ORDER BY i.id DESC LIMIT 1)
    ));
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$function$

;

-- 3. Planilha repetida devolve à emissão o B/L sem fatura ---------------------

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic_legacy_189(p_rows jsonb, p_changed_by uuid, p_target text DEFAULT 'bls'::text, p_manifesto_numero text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_confirm_changes boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_defer_billing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_row jsonb;
  v_result text;
  v_errors jsonb := '[]'::jsonb;
  v_analysis jsonb;
  v_inserted integer := 0;
  v_overwritten integer := 0;
  v_unchanged integer := 0;
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_bl_ids text[];
  v_active text[];
  v_voyage bigint;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_pending text[] := ARRAY[]::text[];
  v_previous_deferred text := current_setting('vela.ce_billing_deferred', true);
  v_message text;
  v_state text;
  v_justification text;
  v_route_pol text;
  v_route_pod text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_target NOT IN ('bls', 'granite') THEN
    RAISE EXCEPTION 'Destino de CE Mercante inválido: %', p_target USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')));
  END IF;

  IF p_target = 'granite' THEN
    BEGIN
      FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
        BEGIN
          v_result := public.apply_granite_ce_mercante_update((v_row->>'bl_id')::uuid, v_row->>'ce', p_changed_by);
          CASE v_result
            WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
            WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
            ELSE v_inserted := v_inserted + 1;
          END CASE;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
            'message', public._ce_row_error_message(v_state, v_message)));
        END;
      END LOOP;
      IF jsonb_array_length(v_errors) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0099' THEN
      RETURN jsonb_build_object('ok', false, 'errors', v_errors);
    END;
    RETURN jsonb_build_object('ok', true, 'processed', jsonb_array_length(p_rows),
      'inserted', v_inserted, 'overwritten', v_overwritten, 'unchanged', v_unchanged);
  END IF;

  -- Trava a Viagem antes dos B/Ls: duas planilhas da mesma Viagem não se
  -- cruzam travando os B/Ls em ordens diferentes (deadlock, ADR 0078 item 9).
  SELECT array_agg(DISTINCT btrim(value->>'bl_id')) INTO v_bl_ids FROM jsonb_array_elements(p_rows);
  SELECT COALESCE(p_voyage_id, (SELECT b.voyage_id FROM public.bls AS b WHERE b.id = ANY(v_bl_ids) ORDER BY b.id LIMIT 1)) INTO v_voyage;
  IF v_voyage IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ce_mercante_voyage:' || v_voyage, 180));
  END IF;
  PERFORM 1 FROM public.bls WHERE id = ANY(v_bl_ids) ORDER BY id FOR UPDATE;

  v_analysis := public._analyze_ce_mercante_rows(p_rows, p_manifesto_numero, p_voyage_id);
  IF jsonb_array_length(v_analysis->'errors') > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_analysis->'errors', 'warnings', v_analysis->'warnings');
  END IF;
  IF (v_analysis->>'needs_confirmation')::boolean AND (NOT p_confirm_changes OR v_reason IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'needs_confirmation', true, 'warnings', v_analysis->'warnings',
      'errors', jsonb_build_array(jsonb_build_object('message', format(
        'A planilha troca o CE de %s B/L(s) e muda o Manifesto de %s B/L(s): confirme na prévia, com motivo.',
        v_analysis->>'changes', v_analysis->>'moves'))));
  END IF;
  v_active := ARRAY(SELECT jsonb_array_elements_text(v_analysis->'active_bl_ids'));

  -- Rastro (ADR 0078, item 9; K8): o invólucro da 189 define o contexto com a
  -- Viagem informada; sem Viagem na tela, vale a dos B/Ls. O Histórico do CE,
  -- do Manifesto criado e do vínculo leva o contexto, a rota e o motivo. A
  -- planilha de CE refina o contexto que o próprio invólucro gravou (a 190 faz
  -- o primeiro contexto da transação valer até o fim; aqui ele é o mesmo, só
  -- mais completo).
  PERFORM set_config('vela.import_context', '', true);
  PERFORM public._set_import_context('CE Mercante',
    COALESCE((v_analysis->'manifesto'->>'voyage_id')::bigint, v_voyage), COALESCE(v_numero, p_manifesto_numero));
  v_route_pol := NULLIF(v_analysis->'manifesto'->>'pol', '');
  v_route_pod := NULLIF(v_analysis->'manifesto'->>'pod', '');
  v_justification := concat_ws(' · ',
    COALESCE(NULLIF(btrim(current_setting('vela.import_context', true)), ''), 'Importação de CE Mercante'),
    CASE WHEN v_route_pol IS NOT NULL AND v_route_pod IS NOT NULL THEN
      'Rota ' || COALESCE(public.normalize_port_code(v_route_pol), upper(v_route_pol))
        || ' → ' || COALESCE(public.normalize_port_code(v_route_pod), upper(v_route_pod)) END,
    CASE WHEN v_reason IS NOT NULL THEN 'Motivo: ' || v_reason END);

  IF cardinality(v_active) > 0 THEN
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_created := NOT FOUND;
  END IF;

  IF p_defer_billing THEN
    PERFORM set_config('vela.ce_billing_deferred', 'on', true);
  END IF;

  BEGIN
    FOR v_row IN
      SELECT value FROM jsonb_array_elements(v_analysis->'rows')
      WHERE value->>'status' IN ('new', 'same', 'change')
    LOOP
      BEGIN
        -- A troca com Desbloqueio conferido abre o alerta na porta única
        -- (`_set_bl_ce_mercante`, migration 195).
        v_result := public._set_bl_ce_mercante(v_row->>'bl_id', v_row->>'new_ce', v_actor, v_justification, 'ce_mercante_planilha');
        CASE v_result
          WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
          WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
          ELSE v_inserted := v_inserted + 1;
        END CASE;
        IF v_result <> 'unchanged' THEN
          -- Rede da emissão: o efeito revalida e não refatura (migration 178).
          INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
          VALUES (gen_random_uuid(), 'local_billing', v_row->>'bl_id', v_actor)
          ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
          v_pending := array_append(v_pending, v_row->>'bl_id');
        -- Mesma planilha de novo (212): o B/L que a emissão interrompida
        -- deixou sem fatura volta ao lote; o faturado não.
        ELSIF EXISTS (
          SELECT 1 FROM public.bls AS b
          WHERE b.id = v_row->>'bl_id' AND b.cancelled_at IS NULL
            AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NOT NULL
            AND COALESCE(b.financial_status, 'pending') = 'pending')
          AND cardinality(public._live_local_invoice_ids_for_bl(v_row->>'bl_id')) = 0 THEN
          v_pending := array_append(v_pending, v_row->>'bl_id');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
          'message', public._ce_row_error_message(v_state, v_message)));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
    END IF;

    IF cardinality(v_active) > 0 THEN
      PERFORM public._upsert_route_manifesto((v_analysis->'manifesto'->>'voyage_id')::bigint,
        v_analysis->'manifesto'->>'pol', v_analysis->'manifesto'->>'pod', 'carga', v_numero);
      SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
      IF v_created THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES ('voyage', v_manifesto.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_justification);
      END IF;
      PERFORM public._link_bls_to_manifesto(v_active, v_manifesto.id, v_actor, v_justification);
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);
    RETURN jsonb_build_object('ok', false, 'errors', v_errors, 'warnings', v_analysis->'warnings');
  END;
  PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);

  RETURN jsonb_build_object(
    'ok', true,
    'processed', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'overwritten', v_overwritten,
    'unchanged', v_unchanged,
    'ignored', (SELECT count(*) FROM jsonb_array_elements(v_analysis->'rows') WHERE value->>'status' = 'cancelled'),
    'warnings', v_analysis->'warnings',
    'manifesto_mercante_id', v_manifesto.id,
    'manifesto_created', v_created,
    'billing_pending_bl_ids', CASE WHEN p_defer_billing THEN to_jsonb(v_pending) ELSE '[]'::jsonb END
  );
END;
$function$

;

-- 4. CE do Granito: só pela planilha, com 15 dígitos --------------------------

CREATE OR REPLACE FUNCTION public.apply_granite_ce_mercante_update(p_bl_id uuid, p_new_ce text, p_changed_by uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_ce TEXT;
  v_bl_number TEXT;
  -- Mesma normalização e regra do CE do B/L (`_set_bl_ce_mercante`): sem
  -- espaços, 15 dígitos; vazio não apaga o CE do Granito (212).
  v_ce TEXT := NULLIF(regexp_replace(COALESCE(p_new_ce, ''), '\s', '', 'g'), '');
BEGIN
  SELECT ce_mercante, bl_number INTO v_old_ce, v_bl_number
  FROM public.granite_bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L Granito % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_ce IS NULL OR v_ce !~ '^[0-9]{15}$' THEN
    RAISE EXCEPTION 'CE Mercante invalido para o B/L Granito %: o CE tem 15 digitos (recebido "%").', v_bl_number, COALESCE(p_new_ce, '')
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(v_old_ce, '')), '') IS NOT DISTINCT FROM v_ce THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public.granite_bls SET ce_mercante = v_ce WHERE id = p_bl_id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  ) VALUES (
    'granite_bl', p_bl_id::text, 'ce_mercante',
    COALESCE(v_old_ce, ''), v_ce, p_changed_by,
    'Importacao CE Mercante'
  );

  IF v_old_ce IS NOT NULL AND v_old_ce <> '' THEN
    RETURN 'overwritten';
  END IF;
  RETURN 'inserted';
END;
$function$
;
REVOKE ALL ON FUNCTION public.apply_granite_ce_mercante_update(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
