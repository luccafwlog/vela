-- 190 — Correções da revisão da PR 929: segurança, fila de efeitos, Viagem
-- Cancelada, planilha de datas e modalidade de carga.
--
-- 1. Quatro funções SECURITY DEFINER das migrations 176, 178 e 179 ficaram
--    executáveis por `authenticated` sem guarda: um usuário do Portal lia os
--    containers e o rateio de B/L de outro Cliente
--    (`bl_container_share_signature`), os B/Ls do grupo de Demurrage dele
--    (`demurrage_group_bl_ids`/`demurrage_group_anchor`) e as métricas da fila
--    (`import_effects_queue_health`). Só funções internas as chamam: o acesso
--    fica com o dono e com `service_role`.
-- 2. A conferência do Baplie (TDT e escalas, ADR 0078 item 21) chamava
--    `get_voyage_eligible_pods`, sem GRANT para usuários: a regra nunca rodava.
--    `list_voyage_eligible_pods` é a porta guardada para a tela.
-- 3. Contexto do Histórico (189): uma importação que chama outra (B/L chama a
--    aplicação das marcas do Baplie) trocava o contexto do resto da transação.
--    O primeiro contexto vale até o fim.
-- 4. Fila parada (178): o job do pg_cron roda sem JWT e a reconciliação de
--    Alertas recusava ("Sem permissão."); o Alerta nunca abria nem fechava. E a
--    idade da fila passa a contar do vencimento da tentativa (`next_attempt_at`),
--    não da criação, para o backoff legítimo não acender o Alerta crítico.
-- 5. Planilha de datas (179): o segundo B/L que divide o container era recusado
--    como "Preview obsoleto", porque o primeiro já tinha propagado a mesma data.
--    Container que já está no valor pedido não é escrito nem conferido contra a
--    prévia.
-- 6. Modalidade de carga (179): a função do gatilho de statement é a mesma em
--    `bl_breakbulk_items`, que não tem `container_number`; todo UPDATE em itens
--    de carga solta falhava.
-- 7. Viagem Cancelada (178): cancelar a fatura de B/L ou de Granito da Viagem
--    Cancelada esbarrava na guarda (o cancelamento atualiza o status financeiro
--    do B/L). Mudança só do status financeiro passa. Fatura consolidada (vínculo
--    por recebível) e avulsa com a Viagem no cabeçalho também não nascem em
--    Viagem Cancelada. Os Comunicados automáticos ignoram Viagem Cancelada em
--    vez de falhar a cada ciclo.
-- 8. Executor da fila (178/184): efeito de B/L Cancelado sai como `superseded`
--    em vez de virar bloqueio crítico; `vehicle_followup` não tenta cancelar
--    fatura com pagamento (a ADR 0077 item 4 já tratou no commit);
--    `_import_effect_voyage_id` não estoura bigint com id numérico longo.
-- 9. Descarga só informada (ADR 0078 item 19): o gatilho legado que copiava a
--    ATA da Viagem para a descarga dos containers sai (a 179 tirou o da
--    inserção de container; este, da 002, ainda reagia a `voyages.ata`).
--
-- Não reescreve nem apaga linhas existentes.
-- Rollback: redefinir cada função pela migration de origem (176, 178, 179, 184,
-- 189, 062) e restaurar os GRANTs revogados no item 1.

-- 1. Funções internas sem guarda.
REVOKE ALL ON FUNCTION public.bl_container_share_signature(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demurrage_group_bl_ids(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demurrage_group_anchor(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_effects_queue_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bl_container_share_signature(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.demurrage_group_bl_ids(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.demurrage_group_anchor(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.import_effects_queue_health() TO service_role;

-- 2. Escalas da Viagem para a conferência do Baplie.
CREATE OR REPLACE FUNCTION public.list_voyage_eligible_pods(p_voyage_id bigint)
RETURNS TABLE(pod text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT e.pod FROM public.get_voyage_eligible_pods(p_voyage_id) AS e;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_voyage_eligible_pods(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_voyage_eligible_pods(bigint) TO authenticated;

-- 3. O primeiro contexto de importação da transação vale até o fim.
CREATE OR REPLACE FUNCTION public._set_import_context(p_kind text, p_voyage_id bigint, p_manifesto text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_voyage text;
BEGIN
  IF NULLIF(btrim(current_setting('vela.import_context', true)), '') IS NOT NULL THEN
    RETURN;
  END IF;
  IF p_voyage_id IS NOT NULL THEN
    SELECT btrim(concat_ws(' ', vs.name, v.voyage_number)) INTO v_voyage
    FROM public.voyages v LEFT JOIN public.vessels vs ON vs.id = v.vessel_id WHERE v.id = p_voyage_id;
  END IF;
  PERFORM set_config('vela.import_context', concat_ws(' · ',
    'Importação de ' || p_kind,
    CASE WHEN v_voyage IS NOT NULL THEN 'Viagem ' || v_voyage END,
    CASE WHEN NULLIF(btrim(COALESCE(p_manifesto, '')), '') IS NOT NULL THEN 'Manifesto ' || btrim(p_manifesto) END), true);
END $$;
REVOKE ALL ON FUNCTION public._set_import_context(text, bigint, text) FROM PUBLIC, anon, authenticated;

-- 4. Fila parada: idade pelo vencimento da tentativa; reconciliação no cron.
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
    -- Atraso real: há quanto tempo a tentativa mais antiga já podia ter rodado.
    -- Efeito em backoff (retry_wait com next_attempt_at futuro) não conta.
    'oldest_due_minutes', floor(extract(epoch FROM now() - min(next_attempt_at)
      FILTER (WHERE status IN ('pending', 'retry_wait') AND next_attempt_at <= now())) / 60),
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
      format('A fila de efeitos de importação está parada: %s efeito(s) pendente(s), o mais atrasado há %s minutos.',
        v_health->>'pending', v_health->>'oldest_due_minutes'),
      'import-effects-queue-health', v_health, '/alertas');
  ELSE
    PERFORM public.resolve_alert_item('import_effects_queue_stalled', 'import_effect_queue', 'import_pending_effects',
      'import-effects-queue-health', v_health);
  END IF;
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  RETURN v_health;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_import_effects_queue_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_import_effects_queue_alert() TO service_role;

-- 5. Planilha de datas: container no valor pedido não é conferido contra a prévia.

CREATE OR REPLACE FUNCTION public.apply_container_dates_atomic_legacy_189(p_request_id uuid, p_bl_id text, p_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_count integer := 0;
  v_item jsonb;
  v_num text;
  v_discharge text;
  v_return text;
  v_exp_discharge text;
  v_exp_return text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_unchanged bigint[] := ARRAY[]::bigint[];
  v_touched text[] := ARRAY[]::text[];
  v_billing_state text := 'pending';
  v_after jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 OR v_count > 500 THEN
    RAISE EXCEPTION 'Lote deve ter entre 1 e 500 linhas.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linha de datas invalida.' USING ERRCODE = '22023';
    END IF;
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    IF v_num = '' THEN
      RAISE EXCEPTION 'Container obrigatorio no B/L %.', v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_discharge IS NULL OR v_discharge !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_discharge::date IS NULL THEN
      RAISE EXCEPTION 'Data de descarga invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND (v_return !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_return::date IS NULL) THEN
      RAISE EXCEPTION 'Data de devolucao invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND v_return::date < v_discharge::date THEN
      RAISE EXCEPTION 'Devolucao anterior a descarga para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS t(container_number text, discharge_date text, return_date text)
      WHERE upper(btrim(COALESCE(t.container_number, ''))) = v_num
        AND (btrim(COALESCE(t.discharge_date, '')) IS DISTINCT FROM v_discharge
             OR NULLIF(btrim(COALESCE(t.return_date, '')), '') IS DISTINCT FROM v_return)
    ) THEN
      RAISE EXCEPTION 'Container % duplicado com datas conflitantes no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    v_exp_discharge := NULLIF(btrim(COALESCE(v_item->>'expected_discharge_date', '')), '');
    v_exp_return := NULLIF(btrim(COALESCE(v_item->>'expected_return_date', '')), '');

    SELECT c.id, c.discharge_date::text, c.return_date::text INTO r
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND upper(btrim(c.container_number)) = v_num
    ORDER BY c.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Container % nao pertence ao B/L %.', v_num, v_bl_id USING ERRCODE = 'P0002';
    END IF;

    -- Devolução vazia na planilha não mexe na data gravada (ADR 0078, item 19).
    -- Vem antes da checagem de prévia obsoleta: o container que já está no
    -- valor pedido não é escrito, e a data que outro B/L do mesmo arquivo
    -- acabou de propagar a este (container compartilhado) não é conflito.
    IF r.discharge_date IS NOT DISTINCT FROM v_discharge
       AND (v_return IS NULL OR r.return_date IS NOT DISTINCT FROM v_return) THEN
      v_unchanged := array_append(v_unchanged, r.id);
      CONTINUE;
    END IF;

    IF v_exp_discharge IS NOT NULL AND (r.discharge_date IS DISTINCT FROM v_exp_discharge) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'expected_return_date') AND (r.return_date IS DISTINCT FROM v_exp_return) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;

    v_touched := v_touched || public._apply_container_dates_core(r.id, v_discharge::date, v_return::date, v_return IS NULL);
    v_updated := array_append(v_updated, r.id);
  END LOOP;

  -- SOC não tem devolução a esperar (ADR 0014; migration 121).
  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND c.return_date IS NULL AND c.ownership IS DISTINCT FROM 'SOC'
  ) THEN
    v_billing_state := 'ready_for_billing';
  END IF;

  v_role := public.current_actor_role();

  IF cardinality(v_updated) > 0 THEN
    v_touched := ARRAY(SELECT DISTINCT unnest(v_touched || ARRAY[v_bl_id]));
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, justification, actor_role, actor_department
    ) VALUES (
      'bl', v_bl_id, 'container_dates_import',
      jsonb_build_object('request_id', p_request_id, 'bl_id', v_bl_id)::text,
      jsonb_build_object(
        'request_id', p_request_id, 'bl_id', v_bl_id,
        'updated_ids', v_updated, 'unchanged_ids', v_unchanged,
        'billing_state', v_billing_state, 'propagated_bl_ids', v_touched
      )::text,
      v_actor, 'Importacao de datas por B/L (atomica)', v_role, v_role
    );
    v_after := public._after_container_dates(p_request_id, v_touched, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'bl_id', v_bl_id,
    'updated_ids', v_updated,
    'unchanged_ids', v_unchanged,
    'billing_state', v_billing_state,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', v_after
  );
END;
$function$;

-- 6. Modalidade de carga: a 179 passou a comparar `container_number`, coluna que
-- `bl_breakbulk_items` (mesma função, gatilho da 060) não tem. Todo UPDATE em
-- itens de carga solta falhava, até o de zero linhas. Para carga solta, só a
-- troca de B/L muda a modalidade.
CREATE OR REPLACE FUNCTION public.trg_sync_bl_cargo_mode_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_sql text;
  v_number_changed text := CASE WHEN TG_TABLE_NAME = 'bl_containers'
    THEN ' OR upper(btrim(n.container_number)) IS DISTINCT FROM upper(btrim(o.container_number))'
    ELSE '' END;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Datas, desova, lacre ou status de Demurrage não mudam a modalidade e
    -- não reabrem a Revisão do B/L faturado (migration 179, ADR 0077).
    v_sql := format(
      'SELECT DISTINCT ids.bl_id FROM ('
      || ' SELECT n.bl_id FROM %1$I AS n JOIN %2$I AS o ON o.id = n.id'
      || '  WHERE n.bl_id IS DISTINCT FROM o.bl_id' || v_number_changed
      || ' UNION ALL'
      || ' SELECT o.bl_id FROM %1$I AS n JOIN %2$I AS o ON o.id = n.id'
      || '  WHERE n.bl_id IS DISTINCT FROM o.bl_id'
      || ') AS ids WHERE ids.bl_id IS NOT NULL',
      TG_ARGV[0], TG_ARGV[1]
    );
  ELSE
    v_sql := format('SELECT DISTINCT bl_id FROM %I WHERE bl_id IS NOT NULL', TG_ARGV[0]);
  END IF;

  FOR v_row IN EXECUTE v_sql LOOP
    PERFORM public._recalculate_bl_cargo_mode(v_row.bl_id, lower(TG_OP));
  END LOOP;
  RETURN NULL;
END;
$function$;

-- 7. Viagem Cancelada: o cancelamento de fatura atualiza só o status
--    financeiro do B/L (`financial_status`) ou do B/L de Granito
--    (`charge_status`); essa mudança passa pela guarda.
CREATE OR REPLACE FUNCTION public._voyage_cancelled_financial_only(p_table text, p_old jsonb, p_new jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_each(p_new) AS n
    WHERE n.value IS DISTINCT FROM p_old -> n.key
      AND NOT (n.key = ANY (CASE p_table
        WHEN 'bls' THEN ARRAY['financial_status', 'updated_at']
        WHEN 'granite_bls' THEN ARRAY['charge_status']
        ELSE ARRAY[]::text[]
      END))
  );
$function$;
REVOKE ALL ON FUNCTION public._voyage_cancelled_financial_only(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_voyage_cancelled_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_voyage_id bigint;
BEGIN
  v_voyage_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.voyage_id ELSE NEW.voyage_id END;
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    IF TG_OP = 'UPDATE' THEN
      IF public._voyage_cancelled_financial_only(TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW)) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

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
    WHEN 'invoice_receivable_links' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    WHEN 'customer_communication_bls' THEN (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id')
    -- Avulsa traz a Viagem no cabeçalho; individual, pelo B/L.
    WHEN 'invoices' THEN COALESCE(NULLIF(v_row->>'voyage_id', '')::bigint,
      (SELECT voyage_id FROM public.bls WHERE id = v_row->>'bl_id'))
    WHEN 'granite_bls' THEN (SELECT voyage_id FROM public.granite_manifests WHERE id = (v_row->>'manifest_id')::uuid)
    WHEN 'customer_communications' THEN NULLIF(v_row->>'anchor_voyage_id', '')::bigint
  END;
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'granite_bls' THEN
      IF public._voyage_cancelled_financial_only(TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW)) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- Consolidada liga o B/L pelo recebível, sem `invoices.bl_id`.
DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_invoice_receivable_links ON public.invoice_receivable_links;
CREATE TRIGGER trg_guard_voyage_cancelled_invoice_receivable_links
  BEFORE INSERT ON public.invoice_receivable_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_via_parent();

-- Comunicados automáticos: Viagem Cancelada não gera candidato.
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
          SELECT 1 FROM public.customer_contact_preferences cp
          WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
        )
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
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
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
      AND NOT EXISTS (SELECT 1 FROM public.customer_contact_preferences cp WHERE cp.contact_id = cc.id AND cp.nature = 'documentacao' AND cp.enabled = false)
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
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
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
         SELECT 1 FROM public.customer_contact_preferences cp
         WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
       )
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
        AND public.resolve_bl_terminal_id(b.id) = v_atracacao.terminal_id
        AND (
          -- A exceção auditada já identifica o terminal escolhido. Ela não
          -- pode ser invalidada pela ausência de uma frente nesse terminal;
          -- sem exceção, a frente continua obrigatória.
          b.terminal_id IS NOT NULL
          OR (
            b.cargo_mode = 'misto'
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao' AND f.modalidade = 'carga_cheia'
            )
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao' AND f.modalidade = 'carga_solta'
            )
          )
          OR (
            b.cargo_mode <> 'misto'
            AND EXISTS (
              SELECT 1 FROM public.voyage_escala_operation_fronts f
              WHERE f.voyage_id = b.voyage_id
                AND public.normalize_port_code(f.port) = public.normalize_port_code(v_atracacao.port)
                AND f.terminal_id = v_atracacao.terminal_id
                AND f.sentido = 'importacao'
                AND f.modalidade = public.bl_operation_front_modalidade(b.cargo_mode)
            )
          )
        )
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
        PERFORM public.upsert_alert_item(
          'nob_sem_destinatario',
          'customer',
          v_customer_bl.customer_id::text,
          'Cliente ' || v_customer_bl.customer_name || ': possui carga na atracação mas sem contato ativo na caixa documentacao_operacao para envio do NOB.',
          'nob_automacao',
          jsonb_build_object('customer_id', v_customer_bl.customer_id, 'bl_ids', v_customer_bl.bl_ids, 'atracacao_id', v_atracacao.state_id),
          '/clientes'
        );
        CONTINUE;
      ELSE
        PERFORM public.resolve_alert_item('nob_sem_destinatario', 'customer', v_customer_bl.customer_id::text, 'nob_automacao', '{}'::jsonb);
      END IF;

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
$function$;

-- 8. Executor da fila: B/L Cancelado, fatura com pagamento e id longo.
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

  -- B/L Cancelado é somente leitura: o efeito pendente dele sai sem agir, em
  -- vez de esbarrar na guarda do B/L e virar bloqueio com Alerta crítico.
  IF v_effect.effect_kind <> 'granite_billing'
     AND EXISTS (SELECT 1 FROM public.bls WHERE id = v_effect.entity_id AND cancelled_at IS NOT NULL) THEN
    RETURN public.complete_import_effect(v_effect.id, p_worker_id, 'superseded',
      jsonb_build_object('reason', 'bl_cancelled', 'bl_id', v_effect.entity_id,
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
  v_charge jsonb;
  v_voided integer := 0;
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
        AND NOT EXISTS (SELECT 1 FROM public.payments AS p WHERE p.invoice_id = inv.id)
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
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
        AND NOT EXISTS (SELECT 1 FROM public.payments AS p WHERE p.invoice_id = inv.id)
      ORDER BY inv.id
    LOOP
      v_cancel_results := v_cancel_results || jsonb_build_array(
        public.cancel_invoice(v_invoice_id, 'Carga de veiculos: BL isento de taxas locais.', p_actor));
      v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
    END LOOP;

    -- Fatura com pagamento não é cancelada: a diferença já foi tratada no
    -- commit da importação pelo item 4 da ADR 0077 (abatimento e restituição).
    -- cancel_invoice recusaria e o efeito viraria bloqueio com Alerta.
    v_live := public._live_local_invoice_ids_for_bl(v_bl_id);
    IF cardinality(v_live) > 0 THEN
      RETURN jsonb_build_object(
        'entity_id', v_bl_id,
        'status', 'skipped',
        'reason', 'paid_invoice_follows_adr_0077',
        'cancelled_invoice_ids', v_cancelled_ids,
        'cancel_results', v_cancel_results,
        'live_invoice_ids', to_jsonb(v_live)
      );
    END IF;
  END IF;

  v_charge := public.calculate_bl_local_charges(v_bl_id, p_actor, true);
  -- B/L isento sem fatura: o Recebível aberto é anulado (M15).
  IF COALESCE(public._quote_bl_local_charges(v_bl_id, NULL)->>'status', '') = 'exempt' THEN
    v_voided := public._void_unbilled_bl_receivables(v_bl_id, p_actor, 'B/L isento de taxas locais (carga de veículos)');
  END IF;
  RETURN jsonb_build_object(
    'entity_id', v_bl_id,
    'status', CASE WHEN cardinality(v_cancelled_ids) > 0 THEN 'exempt_invoices_cancelled' ELSE 'recalculated' END,
    'cancelled_invoice_ids', v_cancelled_ids,
    'cancel_results', v_cancel_results,
    'voided_receivables', v_voided,
    'charge_result', v_charge
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._import_effect_voyage_id(p_effect_kind text, p_entity_id text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_effect_kind = 'granite_billing'
         AND p_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      (SELECT m.voyage_id FROM public.granite_bls AS g JOIN public.granite_manifests AS m ON m.id = g.manifest_id
       WHERE g.id = p_entity_id::uuid)
    WHEN p_entity_id ~ '^[0-9]{1,18}$' AND NOT EXISTS (SELECT 1 FROM public.bls WHERE id = p_entity_id) THEN
      p_entity_id::bigint
    ELSE (SELECT b.voyage_id FROM public.bls AS b WHERE b.id = p_entity_id)
  END;
$function$;

-- 9. A ATA da Viagem não preenche a descarga.
DROP TRIGGER IF EXISTS trg_propagate_voyage_ata_to_containers ON public.voyages;
