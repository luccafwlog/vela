-- 445: o pagador do Pix recebido aparece para todo usuário interno ativo
-- (ADR 0100, item 4, revisto pelo responsável em 2026-10-23, antes da
-- publicação). A 442 e a 444 mostravam nome, CPF/CNPJ e mensagem do pagador e
-- o retorno do Itaú só para o Financeiro e o Administrativo; agora quem lê a
-- Conciliação PIX vê tudo, e a busca por pagador vale para todos. O campo
-- `payer_visible` sai da resposta.
--
-- Continuam só do Financeiro e do Administrativo: conciliar o Pix
-- (`itau_pix_settle_received`), as faturas sugeridas para a baixa
-- (`list_itau_pix_receipt_candidates`) e as falhas da consulta (migration 385).
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da 444.

CREATE OR REPLACE FUNCTION public.list_itau_pix_receipts(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_situation text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_amount_brl numeric DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_doc_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao para consultar os Pix recebidos.' USING ERRCODE = '42501';
  END IF;
  IF p_situation IS NOT NULL AND p_situation NOT IN ('settled', 'received', 'review', 'handled') THEN
    RAISE EXCEPTION 'Situação desconhecida: %.', p_situation USING ERRCODE = '22023';
  END IF;
  IF p_origin IS NOT NULL AND p_origin NOT IN ('vela', 'none', 'other', 'test') THEN
    RAISE EXCEPTION 'Origem desconhecida: %.', p_origin USING ERRCODE = '22023';
  END IF;
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_doc_like := nullif(upper(regexp_replace(v_search, '[^0-9A-Za-z]', '', 'g')), '');
    v_doc_like := CASE WHEN v_doc_like IS NULL THEN NULL ELSE '%' || v_doc_like || '%' END;
  END IF;

  WITH base AS (
    SELECT r.end_to_end_id, r.txid, r.amount_brl, r.paid_at, r.status, r.reason, r.handled_note, r.created_at, r.raw,
      coalesce((r.result ->> 'already_settled')::boolean, false) AS already_settled,
      public._itau_pix_origin(r.txid) AS origin,
      s.source AS settled_source, s.invoice_id AS settled_invoice_id, s.doc_number AS settled_doc_number,
      CASE WHEN c.invoice_id IS NOT NULL THEN 'local' WHEN c.demurrage_invoice_id IS NOT NULL THEN 'demurrage' END AS charge_source,
      coalesce(c.invoice_id, c.demurrage_invoice_id) AS charge_invoice_id,
      coalesce(ci.invoice_number, cd.doc_number) AS charge_doc_number
    FROM public.itau_pix_receipts r
    LEFT JOIN public.itau_pix_charges c ON c.id = r.charge_id
    LEFT JOIN public.invoices ci ON ci.id = c.invoice_id
    LEFT JOIN public.demurrage_invoices cd ON cd.id = c.demurrage_invoice_id
    LEFT JOIN LATERAL public._itau_pix_receipt_settlement(r.end_to_end_id, r.txid) s ON true
    WHERE (p_from IS NULL OR r.paid_at >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (p_to IS NULL OR r.paid_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (p_amount_brl IS NULL OR abs(r.amount_brl - p_amount_brl) < 0.005)
  ), classified AS (
    SELECT b.*,
      -- Só a baixa que existe conta: cancelada, o Pix volta a "Sem baixa"
      -- mesmo com o status 'settled' gravado pela baixa automática.
      CASE
        WHEN b.settled_invoice_id IS NOT NULL THEN 'settled'
        WHEN b.status IN ('review', 'handled') THEN b.status
        ELSE 'received'
      END AS situation
    FROM base b
  ), filtered AS (
    SELECT k.* FROM classified k
    WHERE (p_situation IS NULL OR k.situation = p_situation)
      AND (p_origin IS NULL OR k.origin = p_origin)
      AND (v_search IS NULL
        OR k.end_to_end_id ILIKE v_like OR k.txid ILIKE v_like
        OR coalesce(k.settled_doc_number, k.charge_doc_number, '') ILIKE v_like
        OR coalesce(public._itau_pix_payer_name(k.raw), '') ILIKE v_like
        OR coalesce(k.raw ->> 'infoPagador', '') ILIKE v_like
        OR (v_doc_like IS NOT NULL AND coalesce(public._itau_pix_payer_document(k.raw), '') LIKE v_doc_like))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'total_amount_brl', (SELECT coalesce(sum(amount_brl), 0) FROM filtered),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'end_to_end_id', f.end_to_end_id,
        'txid', f.txid,
        'origin', f.origin,
        'amount_brl', f.amount_brl,
        'paid_at', f.paid_at,
        'recorded_at', f.created_at,
        'situation', f.situation,
        'settled_by', CASE WHEN f.situation <> 'settled' THEN NULL
          WHEN f.status = 'settled' AND f.already_settled THEN 'extract'
          WHEN f.status = 'settled' THEN 'itau' ELSE 'manual' END,
        'settled_source', f.settled_source,
        'settled_invoice_id', f.settled_invoice_id,
        'settled_doc_number', f.settled_doc_number,
        'charge_source', f.charge_source,
        'charge_invoice_id', f.charge_invoice_id,
        'charge_doc_number', f.charge_doc_number,
        'reason', f.reason,
        'handled_note', f.handled_note,
        'pix_key', nullif(btrim(f.raw ->> 'chave'), ''),
        'payer_name', public._itau_pix_payer_name(f.raw),
        'payer_document', public._itau_pix_payer_document(f.raw),
        'payer_message', nullif(btrim(f.raw ->> 'infoPagador'), ''),
        'raw', f.raw
      ) ORDER BY f.paid_at DESC, f.end_to_end_id)
      FROM (SELECT * FROM filtered ORDER BY paid_at DESC, end_to_end_id LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_itau_pix_receipts(date, date, text, text, numeric, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_itau_pix_receipts(date, date, text, text, numeric, text, integer, integer) TO authenticated;
