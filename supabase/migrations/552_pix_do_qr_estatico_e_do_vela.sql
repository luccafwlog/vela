-- 552: o Pix pago no QR estático do Vela é do Vela, não da ZPT, e dá baixa
-- automática no ambiente que emitiu o QR (ADR 0115, decisões 1 a 3).
--
-- Problema (staging, 2026-10-30):
--   Com `app_settings.pix_provider = 'static'`, a fatura mostra o QR estático,
--   cujo identificador é o número da fatura sem pontuação (`INV20260005`), da
--   Invoice de Demurrage (`DEM20260001`) ou de uma versão de cobrança
--   (`VP` + 23 hexadecimais). A consulta de recebimentos do Itaú traz esse Pix
--   com o identificador, mas `_itau_pix_origin` (442) só reconhecia `VELA…`:
--   o Pix de R$ 1,50 da consolidada INV-2026-0005, pago pelo Portal, ficou
--   como "other" (rótulo "ZPT"), sem baixa, e precisou de baixa manual. Staging
--   e produção consultam a mesma conta Itaú, então a produção também gravou esse
--   Pix como "ZPT".
--
-- Mudança:
--   1. `_itau_pix_origin` ganha a origem `static` ("QR estático do Vela") pelo
--      formato do identificador que o banco monta (`build_transshipping_pix_payload`:
--      `INV`/`DEM` + dígitos, `VP` + 23 hexadecimais). Continua IMMUTABLE; só
--      o que era "other" com esse formato muda de origem.
--   2. `itau_pix_receive` manda o Pix `static` para `_itau_pix_settle_static`,
--      que tenta a baixa automática só quando ESTE ambiente cobra pelo QR
--      estático (`_itau_pix_provider() = 'static'`). Usa os mesmos donos do
--      extrato e da baixa automática: `_pix_txid_open_candidates` acha uma
--      única fatura aberta; Taxas Locais por `reconcile_invoice_payment_by_txid`
--      (valor exato da versão do QR, sucessora e restituição), avulsa por
--      `register_verified_invoice_payment` (valor igual ao saldo) e Invoice de
--      Demurrage por `register_demurrage_payment` (janela das duas PTAX). A
--      baixa fica em nome da conta `itau_pix_settlement_actor`, com o
--      endToEndId na referência bancária e a origem `itau_pix` no ledger, como
--      a do `VELA…`. Sem baixa segura, o Pix fica "recebido" com o motivo
--      gravado, sem Alerta: o QR estático pode ser pago mais de uma vez e pode
--      ser de outro ambiente na mesma conta.
--   3. Com a cobrança Itaú ligada (produção), o Pix `static` nunca dá baixa
--      sozinho: staging e produção numeram as faturas do mesmo jeito e dividem
--      a conta, então um Pix de teste do staging (`INV20260001`, R$ 2.470,00)
--      acharia a fatura de mesmo número e valor na produção. Fica "recebido",
--      com o motivo dizendo isso.
--   4. `list_itau_pix_receipts` aceita o filtro de origem `static`.
--
-- ponytail: a origem é pelo formato do identificador, sem consultar faturas;
-- um terceiro que use `INV` + dígitos na mesma chave apareceria como QR
-- estático do Vela, mas só ganha baixa se casar uma única fatura aberta deste
-- ambiente, com o valor exato, e só com o QR estático ligado. Separar de vez
-- exige identificador por ambiente no QR estático ou contas Itaú distintas.
--
-- Só redefine e cria funções; não reescreve nem apaga linhas. Os Pix já
-- gravados com esse formato passam a aparecer como "QR estático do Vela" porque
-- a origem é calculada na leitura.
-- Rollback: reaplicar `_itau_pix_origin` e `itau_pix_receive` da migration 442
-- e `list_itau_pix_receipts` da 445; `DROP FUNCTION
-- public._itau_pix_settle_static(text, text, numeric, timestamptz)`.

CREATE OR REPLACE FUNCTION public._itau_pix_origin(p_txid text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_txid), '') = '' THEN 'none'
    WHEN p_txid ~ '^VELAT[A-Z0-9]{21,30}$' THEN 'test'
    WHEN p_txid ~ '^VELA[A-Z0-9]{22,31}$' THEN 'vela'
    -- QR estático: número da fatura (INV-AAAA-NNNN) ou da Invoice de Demurrage
    -- (DEM-AAAA-NNNN) sem pontuação, ou versão de cobrança da fatura (VP…).
    WHEN p_txid ~ '^(INV|DEM)[0-9]{8,22}$' OR p_txid ~ '^VP[0-9A-F]{23}$' THEN 'static'
    ELSE 'other'
  END
$$;
REVOKE ALL ON FUNCTION public._itau_pix_origin(text) FROM PUBLIC, anon, authenticated;

-- Motivo legível das recusas de `reconcile_invoice_payment_by_txid`.
CREATE OR REPLACE FUNCTION public._itau_pix_static_reason(p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_reason
    WHEN 'charge_amount_mismatch' THEN 'Valor recebido difere do valor do QR da fatura.'
    WHEN 'historical_charge_requires_review' THEN 'QR de uma cobrança anterior da fatura, sem sucessora aberta: confira antes de baixar.'
    WHEN 'ambiguous' THEN 'Mais de uma fatura aberta usa este identificador.'
    WHEN 'already_reconciled' THEN 'Este identificador já tem baixa (pelo extrato ou por outro Pix): pode ser Pix em duplicidade.'
    WHEN 'no_match' THEN 'Nenhuma fatura aberta com este identificador.'
    ELSE coalesce(p_reason, 'sem motivo')
  END
$$;
REVOKE ALL ON FUNCTION public._itau_pix_static_reason(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._itau_pix_settle_static(p_end_to_end_id text, p_txid text, p_amount_brl numeric,
  p_paid_at timestamptz)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing text;
  v_amount numeric := round(p_amount_brl, 2);
  v_count integer;
  v_candidate record;
  v_invoice_type text;
  v_actor uuid;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
  v_reason text;
  v_status text := 'settled';
  v_payment_id bigint;
  v_request uuid := md5('itau-pix:' || p_end_to_end_id)::uuid;
BEGIN
  -- Mesmo lock da baixa automática e do recebimento do mesmo Pix.
  PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
  SELECT status INTO v_existing FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN RETURN v_existing; END IF;

  IF public._itau_pix_provider() <> 'static' THEN
    v_reason := 'Pix de QR estático, mas aqui a cobrança é pela API do Itaú: não há baixa automática. '
      || 'O QR pode ser do staging, que usa a mesma conta; confira a fatura antes de baixar à mão.';
  ELSIF EXISTS (SELECT 1 FROM public.payments p
                WHERE upper(btrim(coalesce(p.bank_reference, ''))) = upper(btrim(p_end_to_end_id))) THEN
    -- Já baixado à mão com o identificador do Pix: a leitura mostra essa baixa.
    v_status := 'received';
  ELSE
    SELECT count(*) INTO v_count FROM public._pix_txid_open_candidates(p_txid);
    IF v_count = 0 THEN
      v_reason := 'Nenhuma fatura aberta com este identificador: a fatura pode já estar paga (Pix em duplicidade) '
        || 'ou o QR é de outro ambiente na mesma conta.';
    ELSIF v_count > 1 THEN
      v_reason := 'Mais de uma fatura aberta usa este identificador.';
    ELSE
      SELECT * INTO v_candidate FROM public._pix_txid_open_candidates(p_txid);
      BEGIN
        IF v_candidate.source = 'demurrage' THEN
          -- O meio da baixa (519) é o Pix do Itaú: o recebimento ainda não está gravado.
          PERFORM set_config('vela.demurrage_payment_method', 'pix_itau', true);
          v_result := public.register_demurrage_payment(v_request, v_candidate.invoice_id,
            (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date, p_end_to_end_id, v_amount, NULL);
          PERFORM set_config('vela.demurrage_payment_method', '', true);
        ELSE
          SELECT itau_pix_settlement_actor INTO v_actor FROM public.app_settings WHERE id = 1;
          IF v_actor IS NULL THEN
            RAISE EXCEPTION 'Usuário de baixa automática Itaú não configurado.';
          END IF;
          PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
          SELECT invoice_type INTO v_invoice_type FROM public.invoices WHERE id = v_candidate.invoice_id;
          IF v_invoice_type = 'manual' THEN
            IF v_amount <> round(v_candidate.amount_brl, 2) THEN
              RAISE EXCEPTION 'Valor recebido difere do saldo da fatura avulsa.';
            END IF;
            v_result := public.register_verified_invoice_payment(v_candidate.invoice_id, v_amount, 'pix', p_paid_at,
              'Baixa automática Itaú Pix (QR estático)', v_request, p_end_to_end_id);
          ELSE
            v_result := public.reconcile_invoice_payment_by_txid(p_txid, v_amount, p_paid_at);
            IF coalesce((v_result->>'settled')::boolean, false) IS NOT TRUE THEN
              RAISE EXCEPTION '%', public._itau_pix_static_reason(v_result->>'reason');
            END IF;
            v_payment_id := (v_result->'payment'->>'payment_id')::bigint;
            UPDATE public.payments SET bank_reference = p_end_to_end_id,
              notes = coalesce(notes || ' · ', '') || 'Baixa automática Itaú Pix (QR estático)'
            WHERE id = v_payment_id;
            -- F-48 (376): a baixa automática tem origem própria no ledger.
            UPDATE public.ledger_settlements SET source = 'itau_pix'
            WHERE payment_id = v_payment_id AND source = 'pix_extract';
          END IF;
          PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Erro passageiro falha a chamada para a consulta tentar de novo.
        IF left(SQLSTATE, 2) IN ('08', '40', '53', '55', '57', 'XX') THEN RAISE; END IF;
        PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
        PERFORM set_config('vela.demurrage_payment_method', '', true);
        v_reason := left(SQLERRM, 300);
      END;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    v_status := 'received';
    v_reason := 'Sem baixa automática: ' || v_reason;
  END IF;
  INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status, reason, result)
  VALUES (p_end_to_end_id, p_txid, v_amount, p_paid_at, v_status, v_reason, v_result);
  -- Gravado agora, a falha de consulta anterior do mesmo Pix (358) fecha.
  UPDATE public.itau_pix_receipt_failures SET status = 'handled', updated_at = now()
  WHERE end_to_end_id = p_end_to_end_id AND status <> 'handled';
  IF FOUND THEN
    PERFORM public.resolve_alert_item('pix_unreconciled', 'itau_pix_receipt_failure', p_end_to_end_id, 'itau_pix',
      jsonb_build_object('end_to_end_id', p_end_to_end_id, 'resolved_by', 'itau_pix_receive'));
  END IF;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public._itau_pix_settle_static(text, text, numeric, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.itau_pix_receive(p_end_to_end_id text, p_txid text, p_amount_brl numeric,
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
  v_origin text := public._itau_pix_origin(v_txid);
  v_status text;
BEGIN
  PERFORM public._assert_service_caller();
  IF p_end_to_end_id IS NULL OR p_amount_brl IS NULL OR p_amount_brl <= 0 OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  IF v_origin = 'vela' THEN
    v_status := public.itau_pix_settle_core_425(p_end_to_end_id, v_txid, p_amount_brl, p_paid_at);
  ELSIF v_origin = 'static' THEN
    v_status := public._itau_pix_settle_static(p_end_to_end_id, v_txid, p_amount_brl, p_paid_at);
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
  IF p_origin IS NOT NULL AND p_origin NOT IN ('vela', 'static', 'none', 'other', 'test') THEN
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
