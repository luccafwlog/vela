-- 429: consistência na operação e no financeiro (auditoria de segurança
-- run-3, notas de endurecimento).
--
-- 1. `close_agency_departure_report` fechava alertas por `LIKE` montado com o
--    porto; '%' e '_' viravam curinga. Passa a comparar prefixo literal.
-- 2. `guard_pod_schedule_removal_mark` só tratava 'true' como retirada da
--    escala, mas os Comunicados também aceitavam 'sim', '1'...; a marca
--    `deleted` passa a aceitar só true/false (vazio continua valendo).
-- 3. `save_voyage_escala_terminal_state_v2` gravava Operações como setor do
--    Financeiro e do perfil legado operator; grava o setor do autor.
-- 4. `upsert_pix_reconciliation_exceptions` reescrevia TXID, valor e data de
--    exceção já resolvida; a resolvida não é mais reescrita.
-- 5. `register_ledger_invoice_payment` (9 argumentos) devolvia o resultado
--    guardado mesmo depois de a baixa ser cancelada; recusa como a baixa
--    verificada.
-- 6. `_itau_pix_sync` ignorava o valor novo de Demurrage com a cobrança em
--    conferência de vencimento; grava na mesma linha, e `itau_pix_record`
--    (definição da 424) estende a conferência de versão a esse estado.
-- 7. `delete_records` descartava os efeitos de importação de um id
--    inexistente (inclusive na prévia); a recusa "não encontrado" desfaz o
--    descarte.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições anteriores (002, 090, 049, 247, 370, 424,
-- 394 e seguintes).

CREATE OR REPLACE FUNCTION public.close_agency_departure_report(p_voyage_id bigint, p_port text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
  v_signed_departments INTEGER;
  v_unknown_sections TEXT[];
  v_unknown_top_level TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object'
     OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array'
     OR octet_length(p_snapshot::text) > 8388608 THEN
    RAISE EXCEPTION 'Snapshot invalido: esperado objeto com header, sections, occurrences e signoffs (maximo 8 MiB).' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_top_level
  FROM jsonb_object_keys(p_snapshot) AS key
  WHERE key NOT IN ('header', 'sections', 'occurrences', 'signoffs', 'departmentSignoffs');
  IF v_unknown_top_level IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui chaves de topo desconhecidas: %.', array_to_string(v_unknown_top_level, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_sections
  FROM jsonb_object_keys(p_snapshot->'sections') AS key
  WHERE key NOT IN (
    'cargaDescarregada', 'cargaSolta', 'vaziosDescarregados', 'veiculos',
    'vaziosEmbarcados', 'vaziosUnidades', 'vehicleLocations', 'vehicleBreakdown',
    'depots', 'directEmbarkCount', 'granito', 'storage', 'operation', 'costs'
  );
  IF v_unknown_sections IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui secoes desconhecidas: %.', array_to_string(v_unknown_sections, ', ')
      USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE id = v_report_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_signed_departments
  FROM public.agency_departure_report_department_signoffs
  WHERE report_id = v_report_id AND signed_at IS NOT NULL;
  IF v_signed_departments <> 3 THEN
    RAISE EXCEPTION 'Fechamento exige os 3 departamentos assinados (% pendentes).', 3 - v_signed_departments
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.agency_departure_reports
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot
  WHERE id = v_report_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADR ja fechado.' USING ERRCODE = '23505';
  END IF;

  -- 'agency_report_section_pending' e obsoleto (migration 225 introduz
  -- 'agency_report_department_pending', ja fechado por departamento no
  -- signoff); mantido aqui so para alertas legados pre-0029.
  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_section_pending'
    AND entity_type = 'agency_departure_report'
    -- Prefixo literal: '%' e '_' no porto não viram curinga.
    AND starts_with(entity_id, p_voyage_id::text || '::' || upper(btrim(p_port)) || '::')
    AND status <> 'closed';

  -- ADR 0039: fecha os alertas de vencimento do prazo junto com o Fechamento.
  -- Chegar aqui exige os 3 departamentos assinados, entao todo alerta de
  -- vencimento desta escala ja deveria estar sem motivo; este UPDATE e uma
  -- rede de seguranca (ex.: alerta detectado entre o ultimo sign-off e o
  -- clique de Fechar).
  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_deadline_missed'
    AND entity_type = 'agency_departure_report'
    -- Prefixo literal: '%' e '_' no porto não viram curinga.
    AND starts_with(entity_id, p_voyage_id::text || '::' || upper(btrim(p_port)) || '::')
    AND status <> 'closed';

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_pod_schedule_removal_mark()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint;
  v_port text;
  v_lock text[];
BEGIN
  -- A marca de retirada só aceita true/false: um 'sim' ou '1' era lido como
  -- retirada pelos Comunicados (customer_communication_flag) e não pela tela.
  IF NEW.entity_type = 'voyage_pod_schedule' AND NEW.field_name = 'deleted'
     AND lower(btrim(COALESCE(NEW.new_value, ''))) NOT IN ('true', 'false', '') THEN
    RAISE EXCEPTION 'Marca de retirada da escala inválida: use true ou false.' USING ERRCODE = '22023';
  END IF;
  IF NEW.entity_type IS DISTINCT FROM 'voyage_pod_schedule'
     OR NEW.field_name IS DISTINCT FROM 'deleted'
     -- A tela lê a marca normalizada (trim + minúsculas): 'TRUE' também retira.
     OR lower(btrim(COALESCE(NEW.new_value, ''))) <> 'true'
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo retira escala da viagem.' USING ERRCODE = '42501';
  END IF;

  v_voyage_id := NULLIF(split_part(NEW.entity_id, '::', 1), '')::bigint;
  v_port := NULLIF(split_part(NEW.entity_id, '::', 2), '');
  v_lock := public.delete_lock_reasons(v_voyage_id, v_port);
  IF cardinality(v_lock) > 0 THEN
    RAISE EXCEPTION 'Escala % travada: %.', v_port, array_to_string(v_lock, ', ') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state_v2(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_schedule JSONB;
  v_schedule_entity_id TEXT;
  v_schedule_field TEXT;
  v_schedule_old_value TEXT;
  v_schedule_new_value TEXT;
  v_role TEXT;
  v_department TEXT;
BEGIN
  -- A guarda permanece na fronteira pública mesmo quando o corpo histórico
  -- for substituído. Não ler payload nem delegar antes da autorização.
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN (
       'admin', 'administrativo', 'operacoes', 'operator',
       'documentacao', 'equipamentos', 'financeiro'
     ) THEN
    RAISE EXCEPTION 'Usuario ativo sem permissao para editar a escala.'
      USING ERRCODE = '42501';
  END IF;

  IF p_export_expectation IS NULL
     OR jsonb_typeof(p_export_expectation) <> 'object'
     OR (p_export_expectation ? 'schedule'
         AND jsonb_typeof(p_export_expectation->'schedule') <> 'object') THEN
    RAISE EXCEPTION 'Payload de escala invalido.' USING ERRCODE = '22023';
  END IF;

  -- O setor gravado é o do autor (ADR 0046): Financeiro não assina como
  -- Operações, e o perfil legado operator é Documentação, como no resto do Vela.
  v_department := CASE
    WHEN v_role IN ('admin', 'administrativo') THEN 'administrativo'
    WHEN v_role IN ('documentacao', 'operator') THEN 'documentacao'
    WHEN v_role = 'equipamentos' THEN 'equipamentos'
    WHEN v_role = 'financeiro' THEN 'financeiro'
    ELSE 'operacoes'
  END;

  -- O corpo anterior continua dono de revisão, lock, frentes, terminais,
  -- exportação, ADR e status. Como função e wrapper rodam na mesma transação,
  -- as auditorias abaixo ficam sob o mesmo lock da escala.
  v_result := public.save_voyage_escala_terminal_state_v2_legacy_049(
    p_voyage_id,
    p_port,
    p_expected_revision,
    p_fronts,
    p_terminals,
    p_export_expectation,
    p_justification
  );

  -- ADR fechado significa no-op completo. Não completar o payload físico
  -- depois que o corpo anterior devolveu um bloqueio.
  IF COALESCE((v_result->>'blocked')::BOOLEAN, FALSE) THEN
    RETURN v_result;
  END IF;

  v_schedule := p_export_expectation->'schedule';
  IF v_schedule IS NOT NULL THEN
    v_schedule_entity_id := p_voyage_id::TEXT || '::' || upper(btrim(COALESCE(p_port, '')));

    FOREACH v_schedule_field IN ARRAY ARRAY[
      'eta', 'etb', 'ata', 'atb', 'etd', 'atd', 'rtw', 'ces',
      'linked', 'escala_number', 'tem_importacao', 'deleted'
    ] LOOP
      IF v_schedule ? v_schedule_field THEN
        SELECT al.new_value
        INTO v_schedule_old_value
        FROM public.audit_logs AS al
        WHERE al.entity_type = 'voyage_pod_schedule'
          AND al.entity_id = v_schedule_entity_id
          AND al.field_name = v_schedule_field
        ORDER BY al.changed_at DESC, al.id DESC
        LIMIT 1;

        v_schedule_new_value := CASE
          WHEN v_schedule->v_schedule_field IS NULL
               OR v_schedule->v_schedule_field = 'null'::JSONB THEN NULL
          ELSE v_schedule->>v_schedule_field
        END;

        -- O editor sempre envia deleted=false para retirar um soft-delete,
        -- mas isso não deve gerar auditoria a cada salvamento.
        IF v_schedule_field = 'deleted'
           AND v_schedule_new_value = 'false'
           AND v_schedule_old_value IS DISTINCT FROM 'true' THEN
          CONTINUE;
        END IF;
        -- Aguardando é o estado inicial do editor, não uma alteração humana.
        IF v_schedule_field = 'ces'
           AND v_schedule_old_value IS NULL
           AND v_schedule_new_value IN ('waiting', 'missing') THEN
          CONTINUE;
        END IF;

        -- A função histórica pode já ter gravado o snapshot. Comparar com o
        -- último valor torna o reparo idempotente e evita auditorias duplicadas.
        IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN
          INSERT INTO public.audit_logs (
            entity_type,
            entity_id,
            field_name,
            old_value,
            new_value,
            changed_by,
            changed_at,
            justification,
            actor_role,
            actor_department
          )
          VALUES (
            'voyage_pod_schedule',
            v_schedule_entity_id,
            v_schedule_field,
            v_schedule_old_value,
            v_schedule_new_value,
            auth.uid(),
            clock_timestamp(),
            p_justification,
            v_role,
            v_department
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_pix_reconciliation_exceptions(p_import_key text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row RECORD;
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_alert JSONB;
  v_items JSONB := '[]'::jsonb;
  v_import_key TEXT := NULLIF(btrim(COALESCE(p_import_key, '')), '');
  v_normalized_txid TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;
  IF v_import_key IS NULL OR char_length(v_import_key) < 8 THEN
    RAISE EXCEPTION 'Identificador do import PIX invalido.' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS row(
      line_number INTEGER,
      txid TEXT,
      cnpj TEXT,
      paid_at TIMESTAMPTZ,
      amount_brl NUMERIC,
      reason TEXT,
      candidate_count INTEGER,
      metadata JSONB
    )
  LOOP
    IF v_row.line_number IS NULL OR v_row.line_number <= 0
       OR v_row.reason NOT IN ('unmatched', 'ambiguous')
       OR COALESCE(v_row.amount_brl, 0) < 0 THEN
      RAISE EXCEPTION 'Linha de excecao PIX invalida.' USING ERRCODE = '22023';
    END IF;

    v_normalized_txid := UPPER(REGEXP_REPLACE(COALESCE(v_row.txid, ''), '[^A-Za-z0-9]', '', 'g'));
    INSERT INTO public.pix_reconciliation_exceptions (
      import_key, line_number, txid, normalized_txid, cnpj, paid_at,
      amount_brl, reason, candidate_count, metadata, status, updated_at
    )
    VALUES (
      v_import_key, v_row.line_number, COALESCE(v_row.txid, ''), v_normalized_txid,
      COALESCE(v_row.cnpj, ''), v_row.paid_at, ROUND(COALESCE(v_row.amount_brl, 0), 2),
      v_row.reason, GREATEST(COALESCE(v_row.candidate_count, 0), 0),
      COALESCE(v_row.metadata, '{}'::jsonb), 'active', now()
    )
    ON CONFLICT (import_key, line_number) DO UPDATE
      SET txid = EXCLUDED.txid,
          normalized_txid = EXCLUDED.normalized_txid,
          cnpj = EXCLUDED.cnpj,
          paid_at = EXCLUDED.paid_at,
          amount_brl = EXCLUDED.amount_brl,
          reason = EXCLUDED.reason,
          candidate_count = EXCLUDED.candidate_count,
          metadata = EXCLUDED.metadata,
          status = CASE
            WHEN public.pix_reconciliation_exceptions.status = 'resolved' THEN 'resolved'
            ELSE 'active'
          END,
          updated_at = now()
      -- Exceção resolvida guarda a evidência da resolução: não é reescrita.
      WHERE public.pix_reconciliation_exceptions.status <> 'resolved'
    RETURNING * INTO v_exception;
    IF NOT FOUND THEN
      SELECT * INTO v_exception FROM public.pix_reconciliation_exceptions
       WHERE import_key = v_import_key AND line_number = v_row.line_number;
    END IF;

    v_alert := NULL;
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    IF v_exception.status = 'active' THEN
      v_alert := public.upsert_alert_item(
        'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
        CASE WHEN v_exception.reason = 'ambiguous'
          THEN format('PIX ambiguo na linha %s do import %s.', v_exception.line_number, v_exception.import_key)
          ELSE format('PIX sem conciliacao na linha %s do import %s.', v_exception.line_number, v_exception.import_key)
        END,
        'pix_extract_import',
        jsonb_build_object(
          'exception_id', v_exception.id,
          'import_key', v_exception.import_key,
          'line_number', v_exception.line_number,
          'normalized_txid', v_exception.normalized_txid,
          'reason', v_exception.reason,
          'candidate_count', v_exception.candidate_count
        ) || v_exception.metadata,
        '/reconciliacao'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
        'pix_exception_already_resolved', jsonb_build_object('exception_id', v_exception.id)
      );
    END IF;
    PERFORM set_config('alerts.foundation_trigger', 'off', true);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', v_exception.id, 'line_number', v_exception.line_number,
      'status', v_exception.status, 'alert_id', v_alert->>'alert_id'
    ));
  END LOOP;

  RETURN jsonb_build_object('items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_method text, p_paid_at timestamp with time zone, p_pix_txid text, p_source text, p_notes text, p_actor uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_request_id uuid := COALESCE(p_request_id, gen_random_uuid());
  v_hash text := md5(jsonb_build_object('invoice_id', p_invoice_id, 'amount_brl', round(p_amount_brl::numeric, 2), 'method', p_method, 'paid_at', p_paid_at, 'pix_txid', p_pix_txid, 'source', p_source, 'notes', p_notes, 'actor', p_actor)::text);
  v_existing public.ledger_payment_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  FOR v_bl_id IN
    SELECT DISTINCT links.bl_id
    FROM (
      SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = p_invoice_id
      UNION
      SELECT r.bl_id FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id WHERE l.invoice_id = p_invoice_id
    ) links ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('bl:' || v_bl_id, 0));
  END LOOP;

  INSERT INTO public.ledger_payment_requests(request_id, payload_hash, created_by)
  VALUES (v_request_id, v_hash, COALESCE(p_actor, auth.uid()))
  ON CONFLICT (request_id) DO NOTHING;
  SELECT * INTO v_existing FROM public.ledger_payment_requests WHERE request_id = v_request_id FOR UPDATE;
  IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Request de pagamento % já foi usado com outro payload.', v_request_id USING ERRCODE = '22023';
  END IF;
  IF v_existing.result IS NOT NULL THEN
    -- Mesma regra da baixa verificada: a baixa cancelada não volta como sucesso.
    IF (v_existing.result->>'payment_id') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = (v_existing.result->>'payment_id')::bigint) THEN
      RAISE EXCEPTION 'Esta baixa foi cancelada. Confira o extrato e inicie uma nova operação.' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.result;
  END IF;

  PERFORM public.assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl);
  v_result := public.register_ledger_invoice_payment_legacy_066(
    p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor
  );
  UPDATE public.ledger_payment_requests SET result = v_result WHERE request_id = v_request_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._itau_pix_sync(p_invoice_id bigint, p_demurrage_invoice_id bigint, p_amount_brl numeric, p_payable boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_open public.itau_pix_charges%ROWTYPE; v_cutoff timestamptz;
BEGIN
  -- ADR 0093, decisão 17 (370): com Pix em análise ligado à Invoice de
  -- Demurrage, não se cria QR novo; o valor fica no saldo até a decisão.
  IF p_demurrage_invoice_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.itau_pix_receipts AS rec JOIN public.itau_pix_charges AS ch ON ch.id = rec.charge_id
    WHERE ch.demurrage_invoice_id = p_demurrage_invoice_id AND rec.status = 'review') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_open FROM public.itau_pix_charges
  WHERE status IN ('pending_create', 'active', 'pending_update', 'pending_expire_check')
    AND (invoice_id = p_invoice_id OR demurrage_invoice_id = p_demurrage_invoice_id)
  FOR UPDATE;
  -- Vencida em confirmação: nada a mostrar nem a criar até o banco responder.
  -- Demurrage que muda de valor no meio grava o valor novo na mesma linha: se
  -- a conferência achar a cobrança viva, itau_pix_record vê a versão mudada e
  -- a manda como alteração (429), em vez de ativar o valor antigo.
  IF FOUND AND v_open.status = 'pending_expire_check' THEN
    IF p_demurrage_invoice_id IS NOT NULL AND p_payable AND round(p_amount_brl, 2) > 0
       AND v_open.amount_brl <> round(p_amount_brl, 2) THEN
      UPDATE public.itau_pix_charges SET amount_brl = round(p_amount_brl, 2), updated_at = now() WHERE id = v_open.id;
    END IF;
    RETURN NULL;
  END IF;
  IF p_demurrage_invoice_id IS NOT NULL AND p_payable AND round(p_amount_brl, 2) > 0 THEN
    v_cutoff := public.itau_pix_cutoff(now());
    -- Demurrage já no banco: PTAX nova ou prazo novo alteram a MESMA cobrança.
    IF FOUND AND v_open.status IN ('active', 'pending_update') THEN
      IF v_open.amount_brl <> round(p_amount_brl, 2) OR v_open.expires_at IS NULL OR v_open.expires_at < v_cutoff THEN
        UPDATE public.itau_pix_charges SET amount_brl = round(p_amount_brl, 2), status = 'pending_update',
          expiration_seconds = ceil(extract(epoch FROM v_cutoff - v_open.bank_created_at))::integer,
          -- Mesma regra da 151: não encurta a reserva de uma chamada em andamento.
          next_attempt_at = greatest(next_attempt_at, now()), updated_at = now()
        WHERE id = v_open.id;
      END IF;
      -- O QR (location) é o mesmo; o pagador vê o valor da revisão vigente no banco.
      RETURN v_open.pix_copia_e_cola;
    END IF;
  END IF;
  IF FOUND AND p_payable AND v_open.amount_brl = round(p_amount_brl, 2) THEN
    RETURN v_open.pix_copia_e_cola;
  END IF;
  IF FOUND THEN
    UPDATE public.itau_pix_charges SET
      status = CASE WHEN status = 'pending_create' AND attempts = 0 AND NOT uncertain THEN 'cancelled' ELSE 'pending_cancel' END,
      next_attempt_at = greatest(next_attempt_at, now()), updated_at = now()
    WHERE id = v_open.id;
  END IF;
  IF p_payable AND round(p_amount_brl, 2) > 0 THEN
    INSERT INTO public.itau_pix_charges(invoice_id, demurrage_invoice_id, txid, amount_brl, expiration_seconds)
    VALUES (p_invoice_id, p_demurrage_invoice_id,
      'VELA' || upper(left(replace(gen_random_uuid()::text, '-', ''), 28)),
      round(p_amount_brl, 2),
      CASE WHEN p_demurrage_invoice_id IS NOT NULL
        THEN greatest(ceil(extract(epoch FROM v_cutoff - now()))::integer, 3600)
        ELSE (SELECT itau_pix_expiration_seconds FROM public.app_settings WHERE id = 1) END);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.itau_pix_record(p_id bigint, p_outcome text, p_revision integer DEFAULT NULL,
  p_pix_copia_e_cola text DEFAULT NULL, p_error text DEFAULT NULL, p_bank_created_at timestamptz DEFAULT NULL,
  p_claimed_version bigint DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.itau_pix_charges%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.itau_pix_charges WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança Itaú inexistente.' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'active' THEN
    IF nullif(btrim(p_pix_copia_e_cola), '') IS NULL OR p_revision IS NULL OR coalesce(v.bank_created_at, p_bank_created_at) IS NULL THEN
      RAISE EXCEPTION 'Cobrança ativa exige copia e cola, revisão e criação no banco.' USING ERRCODE = '22023';
    END IF;
    -- A chamada terminou: libera a reserva para um cancelamento ou alteração pendente seguir já.
    UPDATE public.itau_pix_charges SET revision = p_revision, pix_copia_e_cola = p_pix_copia_e_cola, next_attempt_at = now(),
      bank_created_at = coalesce(bank_created_at, p_bank_created_at),
      expires_at = coalesce(bank_created_at, p_bank_created_at) + make_interval(secs => expiration_seconds),
      uncertain = false, last_error = NULL, updated_at = now(),
      status = CASE
        -- 424: valor ou validade mudaram durante a chamada: enviar a versão nova
        -- (depois da criação, como alteração da cobrança já criada).
        -- 429: também na conferência de vencimento (Demurrage que mudou de valor).
        WHEN status IN ('pending_create', 'pending_update', 'pending_expire_check') AND p_claimed_version IS NOT NULL
          AND change_version <> p_claimed_version THEN 'pending_update'
        WHEN status IN ('pending_create', 'pending_update', 'pending_expire_check') THEN 'active'
        ELSE status END
    WHERE id = p_id RETURNING * INTO v;
    IF v.status = 'active' THEN
      IF v.invoice_id IS NOT NULL THEN
        UPDATE public.invoices SET pix_payload = v.pix_copia_e_cola WHERE id = v.invoice_id;
        INSERT INTO public.local_pix_charge_versions(invoice_id, txid, amount_brl, payload)
        SELECT v.invoice_id, v.txid, v.amount_brl, v.pix_copia_e_cola
        FROM public.invoices WHERE id = v.invoice_id AND invoice_type IN ('individual', 'consolidated')
        ON CONFLICT (invoice_id, txid) DO NOTHING;
      ELSE
        UPDATE public.demurrage_invoices SET pix_payload = v.pix_copia_e_cola WHERE id = v.demurrage_invoice_id;
      END IF;
    END IF;
  ELSIF p_outcome IN ('cancelled', 'concluded', 'expired') THEN
    UPDATE public.itau_pix_charges SET status = p_outcome, uncertain = false, last_error = p_error, updated_at = now()
    WHERE id = p_id RETURNING * INTO v;
    IF p_outcome = 'expired' THEN
      -- Sem cobrança aberta, o gatilho do QR cria a substituta (novo TXID) se a fatura seguir pagável.
      IF v.invoice_id IS NOT NULL THEN
        UPDATE public.invoices SET pix_payload = NULL WHERE id = v.invoice_id;
      ELSE
        UPDATE public.demurrage_invoices SET pix_payload = NULL WHERE id = v.demurrage_invoice_id;
      END IF;
    END IF;
  ELSIF p_outcome IN ('uncertain', 'error') THEN
    UPDATE public.itau_pix_charges SET uncertain = uncertain OR p_outcome = 'uncertain',
      last_error = left(coalesce(p_error, p_outcome), 500), updated_at = now()
    WHERE id = p_id RETURNING * INTO v;
  ELSE
    RAISE EXCEPTION 'Resultado inválido: %', p_outcome USING ERRCODE = '22023';
  END IF;
  RETURN v.status;
END;
$$;

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
  v_bl_pol text;
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
        SELECT b.voyage_id, b.pol INTO v_bl_voyage, v_bl_pol FROM public.bls AS b WHERE b.id = v_id;
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
        -- Desfaz o descarte de efeitos feito acima: id que não existe (ou não é
        -- do tipo pedido) não descarta nada, nem na prévia.
        RAISE EXCEPTION USING ERRCODE = 'VL002';
      ELSIF p_dry_run THEN
        RAISE EXCEPTION USING ERRCODE = 'VL001';
      ELSE
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), v_reason);
        IF p_kind = 'bl' AND v_bl_voyage IS NOT NULL THEN
          INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
          VALUES ('voyages', v_bl_voyage::text, 'bl_deleted', v_id, 'excluído', auth.uid(), v_reason);
          -- 408 (R-09; ADR 0095, decisão 23): o B/L excluído deixa de contar no
          -- ATD do POL, como o cancelado (salvo correção manual).
          IF NULLIF(btrim(COALESCE(v_bl_pol, '')), '') IS NOT NULL THEN
            PERFORM public._recompute_voyage_pol_atd(
              v_bl_voyage, v_bl_pol, auth.uid(),
              'ATD recalculado: B/L ' || v_id || ' excluído; só B/Ls ativos contam (ADR 0095, decisão 23)');
          END IF;
        END IF;
        v_deleted := v_deleted || to_jsonb(v_id);
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'VL001' THEN
        v_deleted := v_deleted || to_jsonb(v_id);
      WHEN SQLSTATE 'VL002' THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('não encontrado'));
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
