-- Migration 106: remediação da auditoria de segurança run-2 (Fase 2 do plano
-- docs/plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md).
--
-- Cada bloco corresponde a um item do plano e tem um caso em
-- src/integration/auditoriaRun2.local-pg.test.ts. Os corpos substituídos são
-- as definições vigentes com só a trava descrita no comentário do bloco.
-- Não reescreve nem apaga linhas existentes.

-- 2.1 (#1): a Dispute só muda de estado pelas RPCs com regra de papel
-- (add_demurrage_dispute_message / reopen_demurrage_dispute), que rodam como
-- dono e não dependem deste grant. Assunto, motivo e notas continuam editáveis.
REVOKE UPDATE (dispute_open, dispute_status) ON public.demurrage_invoices FROM authenticated;

-- 2.2 (#2): no ramo interno, anexo só de Equipamentos ou Administrativo, na
-- própria mensagem e em Dispute aberta. Reforço: nome do arquivo limitado.
CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_attachment(p_message_id bigint, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_message public.demurrage_dispute_messages%ROWTYPE;
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_customer_id bigint;
  v_id bigint;
  v_total_stored bigint;
  v_daily_count bigint;
  v_obj_size bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_storage_path), '') IS NULL OR NULLIF(btrim(p_file_name), '') IS NULL
     OR char_length(p_file_name) > 255
     OR NULLIF(btrim(p_mime_type), '') IS NULL OR p_size_bytes IS NULL
     OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'Anexo inválido.' USING ERRCODE = '22023';
  END IF;

  IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'text/plain') THEN
    RAISE EXCEPTION 'Tipo de anexo não permitido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_message FROM public.demurrage_dispute_messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mensagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = v_message.dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disputa não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF public.is_active_user() THEN
    IF public._portal_actor_role() NOT IN ('equipamentos', 'administrativo')
       OR v_message.author_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo, na própria mensagem, pode anexar.' USING ERRCODE = '42501';
    END IF;
    IF v_dispute.state <> 'aberta' THEN
      RAISE EXCEPTION 'Anexos só podem ser enviados em disputas abertas.' USING ERRCODE = '22023';
    END IF;
    v_customer_id := v_dispute.customer_id;
  ELSE
    v_customer_id := public.current_portal_customer_id();
    IF v_dispute.customer_id <> v_customer_id THEN
      RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
    END IF;

    -- Anexo do Portal só entra em Dispute aberta: a quota soma apenas Disputes
    -- abertas, então aceitar anexo em Dispute resolvida/cancelada deixaria o
    -- upload fora de qualquer teto acumulado.
    IF v_dispute.state <> 'aberta' THEN
      RAISE EXCEPTION 'Anexos só podem ser enviados em disputas abertas.' USING ERRCODE = '22023';
    END IF;

    -- B5: Serialização de quota/taxa por cliente para eliminar TOCTOU
    PERFORM pg_advisory_xact_lock(hashtext('customer_dispute_quota_' || v_customer_id::text));

    -- PAF-03: para o Portal, a mensagem deve ser de cliente e pertencer ao usuário autenticado
    IF v_message.author_type <> 'cliente' OR v_message.author_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Apenas o autor da mensagem pode anexar arquivos.' USING ERRCODE = '42501';
    END IF;

    -- Quota por cliente em disputas abertas (100 MB = 104857600 bytes)
    SELECT COALESCE(SUM(a.size_bytes), 0) INTO v_total_stored
      FROM public.demurrage_dispute_attachments a
      JOIN public.demurrage_disputes d ON d.id = a.dispute_id
     WHERE a.customer_id = v_customer_id
       AND d.state = 'aberta';

    IF (v_total_stored + p_size_bytes) > 104857600 THEN
      RAISE EXCEPTION 'Quota de armazenamento de anexos de 100 MB excedida.' USING ERRCODE = '22023';
    END IF;

    -- Rate limit de 20 anexos por dia
    SELECT COUNT(*) INTO v_daily_count
      FROM public.demurrage_dispute_attachments
     WHERE customer_id = v_customer_id
       AND created_at >= (now() - interval '1 day');

    IF v_daily_count >= 20 THEN
      RAISE EXCEPTION 'Limite diário de 20 anexos excedido.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Prefixo estruturado: customer_id/disputes/dispute_id/message_id/...
  IF p_storage_path NOT LIKE (v_customer_id::text || '/disputes/' || v_dispute.id::text || '/' || v_message.id::text || '/%') THEN
    RAISE EXCEPTION 'Caminho de anexo inválido.' USING ERRCODE = '22023';
  END IF;

  -- PAF-03: se storage.objects existir, validar presença física do objeto
  IF to_regclass('storage.objects') IS NOT NULL THEN
    SELECT (metadata->>'size')::bigint
      INTO v_obj_size
      FROM storage.objects
     WHERE bucket_id = 'demurrage-disputes'
       AND name = p_storage_path;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Objeto de anexo não encontrado no storage.' USING ERRCODE = 'P0002';
    END IF;

    IF v_obj_size IS NOT NULL AND v_obj_size <> p_size_bytes THEN
      RAISE EXCEPTION 'Tamanho do arquivo divergente do objeto armazenado.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.demurrage_dispute_attachments(
    message_id, dispute_id, customer_id, storage_path, file_name, mime_type, size_bytes, uploaded_by
  ) VALUES (
    v_message.id, v_dispute.id, v_customer_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- Mesma regra no upload direto do app interno ao Storage. O Portal envia pela
-- Edge Function com service_role e não passa por esta política.
DO $storage_disputes$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS demurrage_dispute_objects_insert ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY demurrage_dispute_objects_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'demurrage-disputes'
        AND public.current_actor_role() IN ('equipamentos', 'administrativo')
        AND EXISTS (
          SELECT 1
          FROM public.demurrage_dispute_messages m
          JOIN public.demurrage_disputes d ON d.id = m.dispute_id
          WHERE d.state = 'aberta'
            AND m.author_id = auth.uid()
            AND objects.name LIKE d.customer_id::text || '/disputes/' || d.id::text || '/' || m.id::text || '/%'
        )
      );
    $sql$;
  END IF;
END;
$storage_disputes$;

-- 2.3 (#3): só as RPCs do Portal (donas) chamam o limitador, e janela ou
-- limite não positivos são recusados em vez de apagar o histórico.
CREATE OR REPLACE FUNCTION public.check_portal_rate_limit(p_action_name text, p_max_attempts integer DEFAULT 5, p_window_minutes integer DEFAULT 5)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_cutoff TIMESTAMPTZ;
  v_count INT;
BEGIN
  IF p_max_attempts IS NULL OR p_max_attempts <= 0 OR p_window_minutes IS NULL OR p_window_minutes <= 0 THEN
    RAISE EXCEPTION 'Limite de tentativas inválido.' USING ERRCODE = '22023';
  END IF;
  v_cutoff := now() - (p_window_minutes * INTERVAL '1 minute');

  -- Limpa entradas antigas
  DELETE FROM public.portal_rate_limits
  WHERE customer_id = v_customer_id
    AND action_name = p_action_name
    AND attempted_at < v_cutoff;

  -- Conta tentativas na janela
  SELECT COUNT(*) INTO v_count
  FROM public.portal_rate_limits
  WHERE customer_id = v_customer_id
    AND action_name = p_action_name
    AND attempted_at >= v_cutoff;

  IF v_count >= p_max_attempts THEN
    RAISE EXCEPTION 'Limite de tentativas excedido para esta acao. Aguarde % minuto(s) antes de tentar novamente.', p_window_minutes
      USING ERRCODE = 'P0429';
  END IF;

  -- Registra tentativa
  INSERT INTO public.portal_rate_limits (customer_id, action_name)
  VALUES (v_customer_id, p_action_name);

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.check_portal_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;

-- 2.4 (#4): quem não é admin só registra a si mesmo como autor. As quatro RPCs
-- viram envelopes da definição vigente, renomeada e fechada, como a 068 fez.
CREATE OR REPLACE FUNCTION public._assert_actor_is_caller(p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_actor IS NOT NULL AND auth.uid() IS NOT NULL
     AND p_actor IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Autor informado difere do usuário da sessão.' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._assert_actor_is_caller(uuid) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.reject_customer_reconciliation(bigint, text, uuid) RENAME TO _reject_customer_reconciliation_impl_106;
ALTER FUNCTION public.add_manual_bl_charge(text, bigint, numeric, text, uuid) RENAME TO _add_manual_bl_charge_impl_106;
ALTER FUNCTION public.calculate_bl_local_charges(text, uuid, boolean) RENAME TO _calculate_bl_local_charges_impl_106;
ALTER FUNCTION public.run_billing_for_import_batch(bigint, uuid, boolean) RENAME TO _run_billing_for_import_batch_impl_106;
REVOKE ALL ON FUNCTION public._reject_customer_reconciliation_impl_106(bigint, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._add_manual_bl_charge_impl_106(text, bigint, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._calculate_bl_local_charges_impl_106(text, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._run_billing_for_import_batch_impl_106(bigint, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reject_customer_reconciliation(p_queue_id bigint, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  RETURN public._reject_customer_reconciliation_impl_106(p_queue_id, p_notes, p_actor);
END;
$function$;

CREATE FUNCTION public.add_manual_bl_charge(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  RETURN public._add_manual_bl_charge_impl_106(p_bl_id, p_charge_item_id, p_quantity, p_notes, p_actor);
END;
$function$;

CREATE FUNCTION public.calculate_bl_local_charges(p_bl_id text, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  RETURN public._calculate_bl_local_charges_impl_106(p_bl_id, p_actor, p_recalculate);
END;
$function$;

CREATE FUNCTION public.run_billing_for_import_batch(p_batch_id bigint, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  RETURN public._run_billing_for_import_batch_impl_106(p_batch_id, p_actor, p_recalculate);
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_customer_reconciliation(bigint, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_manual_bl_charge(text, bigint, numeric, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calculate_bl_local_charges(text, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.run_billing_for_import_batch(bigint, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_customer_reconciliation(bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_manual_bl_charge(text, bigint, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges(text, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_billing_for_import_batch(bigint, uuid, boolean) TO authenticated;

-- 2.5 (#5): INSERT direto de sessão autenticada não escolhe departamento nem
-- data. current_user = 'authenticated' só vale fora de funções SECURITY
-- DEFINER, que continuam gravando os valores que calculam.
CREATE OR REPLACE FUNCTION public.audit_logs_force_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user = 'authenticated' THEN
    NEW.actor_role := public.current_actor_role();
    NEW.actor_department := NEW.actor_role;
    NEW.changed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_audit_logs_force_actor ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_force_actor BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_force_actor();

-- 2.6 (#6): permissão antes de qualquer leitura do B/L, para o Portal não
-- distinguir B/L alheio de inexistente.
CREATE OR REPLACE FUNCTION public.save_bl_review(p_bl_id text, p_expected_updated_at timestamp with time zone, p_update_payload jsonb, p_audit_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_updated_at timestamptz;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'updated_at obrigatorio; recarregue o B/L antes de salvar'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT updated_at INTO v_current_updated_at
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  -- A cubagem breakbulk faltava na funcao legada. Persistimos primeiro sob o
  -- mesmo lock e repassamos a nova versao. Audit rows do navegador sao
  -- deliberadamente descartadas: os triggers registram os valores reais.
  IF p_update_payload ? 'bb_cbm' THEN
    UPDATE public.bls
    SET bb_cbm = NULLIF(p_update_payload->>'bb_cbm', '')::numeric
    WHERE id = p_bl_id
    RETURNING updated_at INTO v_current_updated_at;
  END IF;

  SELECT public.save_bl_review_legacy_070(
    p_bl_id,
    v_current_updated_at,
    p_update_payload - 'bb_cbm',
    '[]'::jsonb,
    p_changed_by
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- 2.7 (#11): Cliente e contato saem só por delete_records, como B/L na 088.
DROP POLICY IF EXISTS customers_delete_admin ON public.customers;
DROP POLICY IF EXISTS customer_contacts_delete_admin ON public.customer_contacts;
REVOKE DELETE ON TABLE public.customers, public.customer_contacts FROM authenticated;

-- 2.8 (#13b, D2 = c): o gatilho trg_seed_customer_contact_box_links (008) já
-- vincula o contato novo às caixas; o INSERT próprio duplicava a chave e
-- derrubava a importação inteira. O contato segue ativo e principal quando o
-- Cliente não tem outro, como antes.
CREATE OR REPLACE FUNCTION public.ensure_customer_contact_email(p_customer_id bigint, p_email text, p_contact_name text DEFAULT 'Contato manifesto'::text, p_purpose text DEFAULT 'financeiro'::text, p_related_bl_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text;
  v_has_primary boolean := false;
  v_existing record;
  v_contact_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Acesso negado para cadastrar contato.' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  v_email := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;

  SELECT id, is_primary, deactivated_at
  INTO v_existing
  FROM public.customer_contacts
  WHERE customer_id = p_customer_id
    AND email_normalized = v_email
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.customer_contacts
    WHERE customer_id = p_customer_id
      AND is_primary = true
      AND deactivated_at IS NULL
  )
  INTO v_has_primary;

  IF v_existing.id IS NOT NULL THEN
    -- Ativo ou inativo: nao duplica, nao reativa, nao altera caixas
    IF v_existing.deactivated_at IS NOT NULL AND NOT v_has_primary THEN
      PERFORM public.upsert_alert_item(
        'cliente_sem_contato_principal',
        'customer',
        p_customer_id::text,
        'Endereço reapareceu no B/L mas cadastro permanece inativo',
        'bl_automatico',
        jsonb_build_object('customer_id', p_customer_id, 'email', v_email),
        '/clientes'
      );
    END IF;
    RETURN false;
  END IF;

  -- As caixas vêm do gatilho trg_seed_customer_contact_box_links.
  INSERT INTO public.customer_contacts (
    customer_id, name, email, origin, is_primary, purpose
  )
  VALUES (
    p_customer_id,
    COALESCE(NULLIF(btrim(p_contact_name), ''), 'Contato manifesto'),
    v_email,
    'bl_automatico',
    NOT v_has_primary,
    COALESCE(NULLIF(btrim(p_purpose), ''), 'financeiro')
  )
  RETURNING id INTO v_contact_id;

  INSERT INTO public.customer_contact_change_events (
    customer_id, source, related_bl_id, after_snapshot, change_summary
  )
  VALUES (
    p_customer_id,
    'bl_automatico',
    p_related_bl_id,
    jsonb_build_array(jsonb_build_object(
      'id', v_contact_id,
      'email', v_email,
      'is_primary', NOT v_has_primary,
      'origin', 'bl_automatico',
      'box_codes', (SELECT COALESCE(jsonb_agg(l.box_code ORDER BY l.box_code), '[]'::jsonb)
                    FROM public.customer_contact_box_links l WHERE l.contact_id = v_contact_id)
    )),
    jsonb_build_object('action', 'bl_contact_captured', 'contact_id', v_contact_id, 'email', v_email, 'is_primary', NOT v_has_primary)
  );

  RETURN true;
END;
$function$;

-- 2.9 (#9): admin-users revoga sessões do usuário interno por aqui, já que
-- admin.signOut(userId) não encerra sessões. Só a service_role executa.
CREATE OR REPLACE FUNCTION public.internal_revoke_sessions(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuário interno não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.internal_revoke_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_revoke_sessions(uuid) TO service_role;

-- Reforço: retry_import_effect compara com os papéis atuais de
-- current_actor_role() (os antigos bloqueavam Administrativo e Operações).
CREATE OR REPLACE FUNCTION public.retry_import_effect(p_effect_id bigint, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_actor uuid := auth.uid();
  v_role text := public.current_actor_role();
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR NOT public.is_active_user()
          OR v_role NOT IN ('administrativo', 'financeiro', 'operacoes', 'documentacao')) THEN
    RAISE EXCEPTION 'Usuario sem permissao para reabrir efeito.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL OR char_length(v_justification) > 500 THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para retry.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Somente efeitos bloqueados podem ser reabertos.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         result = COALESCE(result, '{}'::jsonb)
           || jsonb_build_object('manual_retry_justification', v_justification),
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'import_effect', v_row.id::text, 'retry',
    jsonb_build_object('status', 'blocked', 'attempts', v_row.attempts)::text,
    jsonb_build_object('status', 'retry_wait', 'attempts', 0)::text,
    v_actor, v_justification, COALESCE(v_role, 'sistema'), COALESCE(v_role, 'sistema')
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$function$;

-- Reforço: estas políticas chamavam _portal_actor_role(), que authenticated
-- não executa, e fechavam o acesso para todos. Em app_settings não há grant
-- de UPDATE para authenticated (a escrita é por RPC), então a política sai.
DROP POLICY IF EXISTS app_settings_administrativo_update ON public.app_settings;
DROP POLICY IF EXISTS exchange_rate_reference_internal_read ON public.exchange_rate_reference;
CREATE POLICY exchange_rate_reference_internal_read ON public.exchange_rate_reference FOR SELECT TO authenticated
  USING (public.is_active_user());

-- Reforços: função legada sem uso direto e negação explícita para anon (a RLS
-- já bloqueava).
REVOKE ALL ON FUNCTION public.import_breakbulk_manifest_transactional_031(text, bigint, uuid, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
