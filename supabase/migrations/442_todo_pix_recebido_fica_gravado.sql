-- 442: todo Pix recebido pelo Itaú fica gravado (decisão do dono de
-- 2026-10-23, ADR 0100).
--
-- Antes, a consulta de recebimentos (`GET /pix`, Edge `itau-pix`) gravava só o
-- Pix de cobrança do Vela (TXID `VELA…`, baixa automática) e o Pix sem TXID
-- nenhum (em análise, com o Alerta `pix_unreconciled`). O Pix com TXID de
-- outro sistema na mesma chave e o de teste eram descartados, e nada do que o
-- banco devolve além de valor e horário era guardado.
--
-- Agora:
--   1. `itau_pix_receive` é a entrada única da Edge para cada Pix da consulta.
--      O Pix de cobrança do Vela segue para a baixa automática
--      (`itau_pix_settle_core_425`, sem mudança). Todo o resto (sem TXID, TXID
--      de outro sistema, teste `VELAT…`) é gravado como `received`: recebido,
--      sem baixa e sem Alerta.
--   2. Todo Pix guarda o retorno do Itaú em `raw` (chave, mensagem do
--      pagador, `pagador`/`devedor` quando o banco mandar, devoluções).
--   3. `list_itau_pix_receipts` lista os Pix para a aba Pix recebidos. Ler é de
--      todo usuário interno ativo; nome, documento e mensagem do pagador e o
--      retorno do banco só para Financeiro e Administrativo (mesma regra da
--      leitura de `itau_pix_receipt_failures`, migration 385, item 14). A
--      situação da baixa é lida da própria baixa (referência bancária em
--      `payments` ou `pix_txid` da Invoice de Demurrage): cancelar a baixa
--      devolve o Pix a "Sem baixa" sem Alerta.
--   4. Baixa opcional pelo operador: `list_itau_pix_receipt_candidates` sugere
--      faturas abertas (mesmo valor, mesmo documento do pagador ou o número
--      digitado) e `itau_pix_settle_received` dá a baixa com o valor e o
--      horário do Pix e o endToEndId na referência, pelos donos de sempre
--      (`register_verified_invoice_payment`, `register_demurrage_payment`).
--   5. `itau_pix_record_untracked` (chamada pela Edge publicada antes desta
--      mudança) passa a gravar `received`, sem Alerta.
--
-- Reescreve linhas existentes: os Pix sem TXID em análise ou tratados viram
-- `received` e os Alertas abertos deles fecham. Apoia-se na afirmação
-- "Data status" do AGENTS.md (seção Gotchas): os dados de produção são de
-- teste.
-- Rollback: recriar o CHECK de status sem `received` depois de devolver essas
-- linhas a `review`; remover `raw`, os índices e as funções novas; reaplicar
-- `itau_pix_record_untracked_core_425` da migration 385 (item 13, então
-- renomeada pela 425).

ALTER TABLE public.itau_pix_receipts
  DROP CONSTRAINT itau_pix_receipts_status_check,
  ADD CONSTRAINT itau_pix_receipts_status_check CHECK (status IN ('settled', 'review', 'handled', 'received')),
  ADD COLUMN raw jsonb;
COMMENT ON COLUMN public.itau_pix_receipts.raw IS
  'Pix como o Itaú devolveu no GET /pix, inclusive dados do pagador. Leitura só por list_itau_pix_receipts.';
CREATE INDEX itau_pix_receipts_paid_at ON public.itau_pix_receipts (paid_at DESC);
-- A situação da aba Pix recebidos procura a baixa pela referência bancária.
CREATE INDEX payments_bank_reference_upper ON public.payments (upper(btrim(bank_reference)))
  WHERE bank_reference IS NOT NULL;

-- Origem do Pix pelo TXID: cobrança do Vela, teste do Vela, sem TXID (chave
-- digitada ou dados da conta) ou outro sistema que cobra na mesma chave.
CREATE FUNCTION public._itau_pix_origin(p_txid text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_txid), '') = '' THEN 'none'
    WHEN p_txid ~ '^VELAT[A-Z0-9]{21,30}$' THEN 'test'
    WHEN p_txid ~ '^VELA[A-Z0-9]{22,31}$' THEN 'vela'
    ELSE 'other'
  END
$$;
REVOKE ALL ON FUNCTION public._itau_pix_origin(text) FROM PUBLIC, anon, authenticated;

-- ponytail: o padrão do Banco Central não traz o pagador; a especificação do
-- Itaú declara `pagador` (nome, cpf, cnpj) opcional, e a cobrança usa
-- `devedor`. Sem um retorno de produção conferido, lê os dois. Se o Itaú
-- mandar outro nome de campo, ajustar só estas duas funções: o retorno inteiro
-- está em `raw`.
CREATE FUNCTION public._itau_pix_payer_name(p_raw jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(btrim(coalesce(p_raw #>> '{pagador,nome}', p_raw #>> '{devedor,nome}')), '')
$$;
REVOKE ALL ON FUNCTION public._itau_pix_payer_name(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._itau_pix_payer_document(p_raw jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(upper(regexp_replace(coalesce(
    p_raw #>> '{pagador,cnpj}', p_raw #>> '{pagador,cpf}', p_raw #>> '{devedor,cnpj}', p_raw #>> '{devedor,cpf}'),
    '[^0-9A-Za-z]', '', 'g')), '')
$$;
REVOKE ALL ON FUNCTION public._itau_pix_payer_document(jsonb) FROM PUBLIC, anon, authenticated;

-- 1 e 2. Entrada única da Edge: cada Pix da consulta passa por aqui uma vez
-- por janela (a sobreposição de 10 min repete alguns; a chamada é idempotente
-- pelo endToEndId).
CREATE FUNCTION public.itau_pix_receive(p_end_to_end_id text, p_txid text, p_amount_brl numeric,
  p_paid_at timestamptz, p_raw jsonb DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_txid text := coalesce(btrim(p_txid), '');
  -- ponytail: teto de 32 KB por retorno; um Pix tem menos de 1 KB.
  v_raw jsonb := CASE
    WHEN p_raw IS NULL OR jsonb_typeof(p_raw) <> 'object' THEN NULL
    WHEN pg_column_size(p_raw) > 32768 THEN jsonb_build_object('descartado', 'Retorno do Itaú acima de 32 KB.')
    ELSE p_raw END;
  v_status text;
BEGIN
  PERFORM public._assert_service_caller();
  IF p_end_to_end_id IS NULL OR p_amount_brl IS NULL OR p_amount_brl <= 0 OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  IF public._itau_pix_origin(v_txid) = 'vela' THEN
    v_status := public.itau_pix_settle_core_425(p_end_to_end_id, v_txid, p_amount_brl, p_paid_at);
  ELSE
    -- Mesmo lock da baixa automática: execuções concorrentes do mesmo Pix esperam.
    PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
    INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status)
    VALUES (p_end_to_end_id, v_txid, round(p_amount_brl, 2), p_paid_at, 'received')
    ON CONFLICT (end_to_end_id) DO NOTHING;
    SELECT status INTO v_status FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
    -- Gravado agora, a falha de consulta anterior do mesmo Pix (358) fecha.
    UPDATE public.itau_pix_receipt_failures SET status = 'handled', updated_at = now()
    WHERE end_to_end_id = p_end_to_end_id AND status <> 'handled';
    IF FOUND THEN
      PERFORM public.resolve_alert_item('pix_unreconciled', 'itau_pix_receipt_failure', p_end_to_end_id, 'itau_pix',
        jsonb_build_object('end_to_end_id', p_end_to_end_id, 'resolved_by', 'itau_pix_receive'));
    END IF;
  END IF;
  -- O primeiro retorno fica: a consulta seguinte não o troca.
  UPDATE public.itau_pix_receipts SET raw = v_raw
  WHERE end_to_end_id = p_end_to_end_id AND raw IS NULL AND v_raw IS NOT NULL;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_receive(text, text, numeric, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_receive(text, text, numeric, timestamptz, jsonb) TO service_role;

-- 5. A Edge publicada antes desta mudança ainda chama o registro do Pix sem
-- TXID: passa a gravar `received`, sem Alerta. O envelope da 425 continua.
CREATE OR REPLACE FUNCTION public.itau_pix_record_untracked_core_425(p_end_to_end_id text, p_amount_brl numeric,
  p_paid_at timestamp with time zone)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.itau_pix_receive(p_end_to_end_id, '', p_amount_brl, p_paid_at, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_record_untracked_core_425(text, numeric, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Pix sem TXID já gravados: em análise ou tratados viram `received` (o motivo
-- e o tratamento continuam na linha) e o Alerta aberto fecha.
DO $received_442$
DECLARE
  v_e2e text;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_e2e IN
    SELECT end_to_end_id FROM public.itau_pix_receipts
    WHERE charge_id IS NULL AND txid = '' AND status IN ('review', 'handled')
  LOOP
    UPDATE public.itau_pix_receipts SET status = 'received' WHERE end_to_end_id = v_e2e;
    PERFORM public.resolve_alert_item('pix_unreconciled', 'itau_pix_receipt', v_e2e, 'migration_442',
      jsonb_build_object('note', 'Pix sem TXID não pede mais conciliação: fica em Pix recebidos (ADR 0100).'));
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
END;
$received_442$;

-- Baixa que usa este Pix: referência bancária de um pagamento de fatura local
-- ou avulsa, ou o identificador gravado na Invoice de Demurrage paga (a baixa
-- automática grava o TXID `VELA…`; a manual desta tela, o endToEndId).
CREATE FUNCTION public._itau_pix_receipt_settlement(p_end_to_end_id text, p_txid text)
RETURNS TABLE (source text, invoice_id bigint, doc_number text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT x.source, x.invoice_id, x.doc_number FROM (
    SELECT 'local'::text AS source, i.id AS invoice_id, i.invoice_number AS doc_number, p.paid_at AS at
    FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id
    WHERE p.bank_reference IS NOT NULL AND upper(btrim(p.bank_reference)) = upper(p_end_to_end_id)
    UNION ALL
    SELECT 'demurrage'::text, d.id, d.doc_number, d.paid_at::timestamptz
    FROM public.demurrage_invoices d
    WHERE d.status = 'paid' AND d.pix_txid IS NOT NULL AND btrim(d.pix_txid) <> ''
      AND btrim(d.pix_txid) IN (p_end_to_end_id, CASE WHEN public._itau_pix_origin(p_txid) = 'vela' THEN p_txid END)
  ) x
  ORDER BY x.at DESC NULLS LAST
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._itau_pix_receipt_settlement(text, text) FROM PUBLIC, anon, authenticated;

-- 3. Aba Pix recebidos.
CREATE FUNCTION public.list_itau_pix_receipts(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_situation text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_amount_brl numeric DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payer boolean;
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
  v_payer := public.is_financeiro_user();
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_doc_like := nullif(upper(regexp_replace(v_search, '[^0-9A-Za-z]', '', 'g')), '');
    v_doc_like := CASE WHEN v_doc_like IS NULL THEN NULL ELSE '%' || v_doc_like || '%' END;
  END IF;

  WITH base AS (
    SELECT r.end_to_end_id, r.txid, r.amount_brl, r.paid_at, r.status, r.reason, r.handled_note, r.created_at, r.raw,
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
      CASE
        WHEN b.settled_invoice_id IS NOT NULL OR b.status = 'settled' THEN 'settled'
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
        OR (v_payer AND (
          coalesce(public._itau_pix_payer_name(k.raw), '') ILIKE v_like
          OR coalesce(k.raw ->> 'infoPagador', '') ILIKE v_like
          OR (v_doc_like IS NOT NULL AND coalesce(public._itau_pix_payer_document(k.raw), '') LIKE v_doc_like))))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'total_amount_brl', (SELECT coalesce(sum(amount_brl), 0) FROM filtered),
    'payer_visible', v_payer,
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'end_to_end_id', f.end_to_end_id,
        'txid', f.txid,
        'origin', f.origin,
        'amount_brl', f.amount_brl,
        'paid_at', f.paid_at,
        'recorded_at', f.created_at,
        'situation', f.situation,
        'settled_by', CASE WHEN f.situation <> 'settled' THEN NULL WHEN f.status = 'settled' THEN 'itau' ELSE 'manual' END,
        'settled_source', coalesce(f.settled_source, CASE WHEN f.status = 'settled' THEN f.charge_source END),
        'settled_invoice_id', coalesce(f.settled_invoice_id, CASE WHEN f.status = 'settled' THEN f.charge_invoice_id END),
        'settled_doc_number', coalesce(f.settled_doc_number, CASE WHEN f.status = 'settled' THEN f.charge_doc_number END),
        'charge_source', f.charge_source,
        'charge_invoice_id', f.charge_invoice_id,
        'charge_doc_number', f.charge_doc_number,
        'reason', f.reason,
        'handled_note', f.handled_note,
        'pix_key', nullif(btrim(f.raw ->> 'chave'), ''),
        'payer_name', CASE WHEN v_payer THEN public._itau_pix_payer_name(f.raw) END,
        'payer_document', CASE WHEN v_payer THEN public._itau_pix_payer_document(f.raw) END,
        'payer_message', CASE WHEN v_payer THEN nullif(btrim(f.raw ->> 'infoPagador'), '') END,
        'raw', CASE WHEN v_payer THEN f.raw END
      ) ORDER BY f.paid_at DESC, f.end_to_end_id)
      FROM (SELECT * FROM filtered ORDER BY paid_at DESC, end_to_end_id LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_itau_pix_receipts(date, date, text, text, numeric, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_itau_pix_receipts(date, date, text, text, numeric, text, integer, integer) TO authenticated;

-- 4. Faturas abertas que podem receber um Pix recebido: as do número digitado
-- ou, sem número, as de mesmo valor em aberto e as do Cliente com o documento
-- do pagador (quando o Itaú o informa).
CREATE FUNCTION public.list_itau_pix_receipt_candidates(p_end_to_end_id text, p_doc_number text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_receipt public.itau_pix_receipts%ROWTYPE;
  v_doc text := upper(nullif(btrim(coalesce(p_doc_number, '')), ''));
  v_payer_doc text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissão para conciliar Pix recebidos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_receipt FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pix recebido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  v_payer_doc := public._itau_pix_payer_document(v_receipt.raw);
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.same_customer DESC, c.same_amount DESC, c.doc_number)
    FROM (
      SELECT * FROM (
        SELECT 'local'::text AS source, i.id AS invoice_id, i.invoice_number AS doc_number, i.invoice_type,
          i.balance_brl AS open_amount_brl, cu.name AS customer_name, cu.cnpj_cpf AS customer_document,
          abs(i.balance_brl - v_receipt.amount_brl) < 0.005 AS same_amount,
          coalesce(upper(regexp_replace(cu.cnpj_cpf, '[^0-9A-Za-z]', '', 'g')) = v_payer_doc, false) AS same_customer
        FROM public.invoices i
        LEFT JOIN public.customers cu ON cu.id = i.customer_id
        WHERE i.status IN ('issued', 'partially_paid') AND i.balance_brl > 0
          AND i.invoice_type IN ('individual', 'consolidated', 'manual')
        UNION ALL
        SELECT 'demurrage'::text, d.id, d.doc_number, NULL::text,
          d.current_total_brl, cu.name, cu.cnpj_cpf,
          coalesce(abs(d.current_total_brl - v_receipt.amount_brl) < 0.005, false),
          coalesce(upper(regexp_replace(cu.cnpj_cpf, '[^0-9A-Za-z]', '', 'g')) = v_payer_doc, false)
        FROM public.demurrage_invoices d
        LEFT JOIN public.customers cu ON cu.id = d.customer_id
        WHERE d.status IN ('issued', 'overdue') AND d.paid_at IS NULL
      ) open_invoice
      WHERE CASE WHEN v_doc IS NOT NULL THEN upper(open_invoice.doc_number) = v_doc
                 ELSE open_invoice.same_amount OR open_invoice.same_customer END
      ORDER BY open_invoice.same_customer DESC, open_invoice.same_amount DESC, open_invoice.doc_number
      LIMIT 50
    ) c
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.list_itau_pix_receipt_candidates(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_itau_pix_receipt_candidates(text, text) TO authenticated;

-- 4. Baixa opcional de um Pix recebido numa fatura aberta: valor e horário do
-- Pix, endToEndId na referência. Só o Pix `received`: o de cobrança do Vela
-- tem a baixa automática e, em análise, os caminhos de Pendências.
CREATE FUNCTION public.itau_pix_settle_received(p_end_to_end_id text, p_source text, p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_receipt public.itau_pix_receipts%ROWTYPE;
  v_existing record;
  v_doc text;
  v_result jsonb;
  v_request uuid := md5('itau-pix-received:' || coalesce(p_end_to_end_id, '') || ':' || coalesce(auth.uid()::text, ''))::uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissão para conciliar Pix recebidos.' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('local', 'demurrage') OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Escolha a fatura que recebe o Pix.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
  SELECT * INTO v_receipt FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pix recebido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_receipt.status <> 'received' THEN
    RAISE EXCEPTION 'Este Pix é de cobrança do Vela: a baixa é automática ou segue em Pendências.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public._itau_pix_receipt_settlement(v_receipt.end_to_end_id, v_receipt.txid);
  IF v_existing.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este Pix já tem baixa na fatura %.', v_existing.doc_number USING ERRCODE = '22023';
  END IF;

  IF p_source = 'local' THEN
    -- Sem FOR UPDATE: a baixa trava os B/Ls antes da fatura, na ordem de sempre.
    SELECT invoice_number INTO v_doc FROM public.invoices
    WHERE id = p_invoice_id AND status IN ('issued', 'partially_paid') AND balance_brl > 0
      AND invoice_type IN ('individual', 'consolidated', 'manual');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A fatura não está aberta para receber este Pix.' USING ERRCODE = '22023';
    END IF;
    v_result := public.register_verified_invoice_payment(p_invoice_id, v_receipt.amount_brl, 'pix', v_receipt.paid_at,
      'Baixa manual do Pix recebido ' || v_receipt.end_to_end_id || ' (Conciliação PIX)', v_request, v_receipt.end_to_end_id);
  ELSE
    SELECT doc_number INTO v_doc FROM public.demurrage_invoices
    WHERE id = p_invoice_id AND status IN ('issued', 'overdue') AND paid_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A Invoice de Demurrage não está aberta para receber este Pix.' USING ERRCODE = '22023';
    END IF;
    -- O valor do Pix tem de bater com uma das duas últimas fotos de PTAX (ADR 0015).
    v_result := public.register_demurrage_payment(v_request, p_invoice_id,
      (v_receipt.paid_at AT TIME ZONE 'America/Sao_Paulo')::date, v_receipt.end_to_end_id, v_receipt.amount_brl, NULL);
  END IF;
  RETURN jsonb_build_object('source', p_source, 'invoice_id', p_invoice_id, 'doc_number', v_doc,
    'end_to_end_id', v_receipt.end_to_end_id, 'amount_brl', v_receipt.amount_brl, 'result', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_settle_received(text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itau_pix_settle_received(text, text, bigint) TO authenticated;
