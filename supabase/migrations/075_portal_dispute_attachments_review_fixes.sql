-- Migration 075: fecha os residuais da revisão final da PR #718.
--
-- 1. Anexos enviados pelo Portal passam a exigir Dispute aberta. A quota de
--    100 MB da 074 soma apenas Disputes abertas; sem esta checagem, anexar a
--    mensagens antigas de Disputes resolvidas ficava fora de qualquer teto.
-- 2. Usuários internos ativos podem remover pelo Storage API apenas objetos que
--    eles mesmos enviaram e que ainda não têm metadado registrado. Sem policy
--    DELETE, a limpeza imediata do fluxo interno era recusada em silêncio pelo
--    RLS e o arquivo ficava órfão. Um anexo já registrado continua imutável.
-- 3. cleanup_orphaned_dispute_attachments apagava a linha de storage.objects
--    por SQL, o que não remove o arquivo físico (e o Supabase recusa DELETE
--    direto nas tabelas de storage). Ela é substituída por uma listagem somente
--    leitura; a remoção dos caminhos listados é feita pelo Storage API.

CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_attachment(
  p_message_id bigint,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.portal_check_dispute_attachment_eligibility(
  p_dispute_id bigint,
  p_size_bytes bigint
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_customer_id bigint;
  v_total_stored bigint;
  v_daily_count bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'Tamanho de anexo inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disputa não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF public.is_active_user() THEN
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

    -- Quota por cliente em disputas abertas (100 MB)
    SELECT COALESCE(SUM(a.size_bytes), 0) INTO v_total_stored
      FROM public.demurrage_dispute_attachments a
      JOIN public.demurrage_disputes d ON d.id = a.dispute_id
     WHERE a.customer_id = v_customer_id
       AND d.state = 'aberta';

    IF (v_total_stored + p_size_bytes) > 104857600 THEN
      RAISE EXCEPTION 'Quota de armazenamento de anexos de 100 MB excedida.' USING ERRCODE = '22023';
    END IF;

    -- Rate limit diário (máx 20 uploads nas últimas 24h)
    SELECT COUNT(*) INTO v_daily_count
      FROM public.demurrage_dispute_attachments
     WHERE customer_id = v_customer_id
       AND created_at >= (now() - interval '1 day');

    IF v_daily_count >= 20 THEN
      RAISE EXCEPTION 'Limite diário de 20 anexos excedido.' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN true;
END;
$$;

-- Grants explícitos: CREATE OR REPLACE preserva o ACL de uma função existente,
-- mas num banco em que a 074 foi aplicada numa versão anterior (sem a RPC de
-- elegibilidade) a função nasce aqui e precisa do contrato completo.
REVOKE ALL ON FUNCTION public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_check_dispute_attachment_eligibility(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_check_dispute_attachment_eligibility(bigint, bigint) TO authenticated, service_role;

DO $storage_disputes_delete$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS demurrage_dispute_objects_delete ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY demurrage_dispute_objects_delete ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'demurrage-disputes'
        AND public.is_active_user()
        AND owner = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.demurrage_dispute_attachments a
           WHERE a.storage_path = objects.name
        )
      );
    $sql$;
  END IF;
END;
$storage_disputes_delete$;

DROP FUNCTION IF EXISTS public.cleanup_orphaned_dispute_attachments(interval);

CREATE OR REPLACE FUNCTION public.list_orphaned_dispute_attachments(p_older_than interval DEFAULT interval '1 day')
RETURNS TABLE(storage_path text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE $q$
    SELECT o.name::text, o.created_at
      FROM storage.objects o
     WHERE o.bucket_id = 'demurrage-disputes'
       AND o.created_at < (now() - $1)
       AND NOT EXISTS (
         SELECT 1 FROM public.demurrage_dispute_attachments a
          WHERE a.storage_path = o.name
       )
     ORDER BY o.created_at
  $q$ USING p_older_than;
END;
$$;

REVOKE ALL ON FUNCTION public.list_orphaned_dispute_attachments(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_orphaned_dispute_attachments(interval) TO service_role;

DO $verify_075$
BEGIN
  IF has_function_privilege('authenticated', 'public.list_orphaned_dispute_attachments(interval)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.list_orphaned_dispute_attachments(interval)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.portal_check_dispute_attachment_eligibility(bigint, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Contratos de EXECUTE de anexos fora do padrão de segurança (075)';
  END IF;
END;
$verify_075$;
