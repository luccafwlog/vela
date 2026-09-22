-- Migration 074: Restringe inserção direta de anexos de Dispute no Storage
-- e adiciona validação de autoria, quota (100 MB), rate limit (20/dia) e objeto real.

DO $storage_disputes$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS demurrage_dispute_objects_insert ON storage.objects';
    -- Apenas usuários internos podem inserir diretamente pelo cliente Supabase.
    -- O Portal utiliza a Edge Function com service role após validação estrita.
    EXECUTE $sql$
      CREATE POLICY demurrage_dispute_objects_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'demurrage-disputes' AND public.is_active_user());
    $sql$;
  END IF;
END;
$storage_disputes$;

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
  IF auth.uid() IS NULL OR (NOT public.is_active_user() AND public.current_portal_customer_id() IS NULL) THEN
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

    -- PAF-03: para o Portal, a mensagem deve ser de cliente e pertencer ao usuário autenticado
    IF v_message.author_type <> 'cliente' OR v_message.author_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Apenas o autor da mensagem pode anexar arquivos.' USING ERRCODE = '42501';
    END IF;

    -- Quota por cliente (100 MB = 104857600 bytes)
    SELECT COALESCE(SUM(size_bytes), 0) INTO v_total_stored
      FROM public.demurrage_dispute_attachments
     WHERE customer_id = v_customer_id;

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

REVOKE ALL ON FUNCTION public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint) TO authenticated, service_role;

DO $verify_add_demurrage_dispute_attachment_security$
BEGIN
  IF has_function_privilege('anon', 'public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.add_demurrage_dispute_attachment(bigint, text, text, text, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'add_demurrage_dispute_attachment fora do contrato de EXECUTE';
  END IF;
END;
$verify_add_demurrage_dispute_attachment_security$;
