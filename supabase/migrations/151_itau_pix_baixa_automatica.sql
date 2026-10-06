-- 151: baixa automática dos Pix recebidos pelo Itaú (Fase 3 do plano
-- 2026-10-06-integracao-itau-pix).
--
-- A função `itau-pix` consulta os recebimentos (GET /pix por janela com
-- checkpoint) e chama `itau_pix_settle` para cada Pix com TXID do Vela.
-- A baixa reaproveita os donos existentes, com as mesmas validações:
--   - Taxas Locais individual/consolidada: `reconcile_invoice_payment_by_txid`
--     (valor exato da cobrança, cadeia de reemissão, excedente vira restituição);
--   - avulsa: `register_verified_invoice_payment` (referência bancária e
--     idempotência da 136);
--   - Demurrage: `register_demurrage_payment` (janela das duas últimas fotos
--     de PTAX: quita pela revisão efetivamente paga).
-- O endToEndId é a referência bancária e a chave de idempotência. Qualquer
-- recusa vira recebimento "review" com o Alerta `pix_unreconciled` para o
-- Administrativo; nada é baixado por aproximação.
--
-- As baixas locais exigem um usuário Admin ativo (auth.uid()). Não há
-- iniciador numa rotina automática, então o dono designa a conta em
-- `app_settings.itau_pix_settlement_actor`; sem ela, todo Pix vai para análise.
--
-- Aditiva: não reescreve nem apaga linhas existentes; nenhum cron é criado.
BEGIN;

ALTER TABLE public.app_settings
  ADD COLUMN itau_pix_settlement_actor uuid REFERENCES public.user_profiles(id),
  -- Fim da última janela de GET /pix processada por completo.
  ADD COLUMN itau_pix_polled_until timestamptz;

CREATE TABLE public.itau_pix_receipts (
  end_to_end_id text PRIMARY KEY CHECK (end_to_end_id ~ '^[A-Za-z0-9]{1,64}$'),
  txid text NOT NULL,
  charge_id bigint REFERENCES public.itau_pix_charges(id),
  amount_brl numeric(14,2) NOT NULL CHECK (amount_brl > 0),
  paid_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('settled', 'review')),
  reason text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX itau_pix_receipts_txid ON public.itau_pix_receipts(txid);
ALTER TABLE public.itau_pix_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.itau_pix_receipts FROM PUBLIC, anon, authenticated;

-- Cobranças de avulsa não entram em local_pix_charge_versions: o resolvedor
-- da 130 leva ao ledger, que não serve à avulsa. Corpo da 150, só esse filtro.
CREATE OR REPLACE FUNCTION public.itau_pix_record(p_id bigint, p_outcome text, p_revision integer DEFAULT NULL,
  p_pix_copia_e_cola text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.itau_pix_charges%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.itau_pix_charges WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança Itaú inexistente.' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'active' THEN
    IF nullif(btrim(p_pix_copia_e_cola), '') IS NULL OR p_revision IS NULL THEN
      RAISE EXCEPTION 'Cobrança ativa exige copia e cola e revisão.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.itau_pix_charges SET revision = p_revision, pix_copia_e_cola = p_pix_copia_e_cola,
      uncertain = false, last_error = NULL, updated_at = now(),
      status = CASE WHEN status = 'pending_create' THEN 'active' ELSE status END
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
  ELSIF p_outcome IN ('cancelled', 'concluded') THEN
    UPDATE public.itau_pix_charges SET status = p_outcome, uncertain = false, last_error = p_error, updated_at = now()
    WHERE id = p_id RETURNING * INTO v;
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

CREATE FUNCTION public.itau_pix_settle(p_end_to_end_id text, p_txid text, p_amount_brl numeric, p_paid_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing text;
  v_charge public.itau_pix_charges%ROWTYPE;
  v_invoice_type text;
  v_actor uuid;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
  v_reason text;
  v_request uuid := md5('itau-pix:' || p_end_to_end_id)::uuid;
BEGIN
  IF p_end_to_end_id IS NULL OR p_txid IS NULL OR p_amount_brl IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  -- Mesma ordem de lock para o mesmo Pix: execuções concorrentes esperam.
  PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
  SELECT status INTO v_existing FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN RETURN v_existing; END IF;

  SELECT * INTO v_charge FROM public.itau_pix_charges WHERE txid = p_txid FOR UPDATE;
  IF FOUND THEN
    -- O Pix existe no banco: a cobrança está paga, haja baixa ou análise.
    -- Marcar antes da baixa evita que o gatilho do QR a veja como aberta e
    -- tente cancelá-la no Itaú.
    UPDATE public.itau_pix_charges SET status = 'concluded', updated_at = now() WHERE id = v_charge.id;
  END IF;
  IF v_charge.id IS NULL THEN
    v_reason := 'TXID do Vela sem cobrança registrada.';
  ELSIF round(p_amount_brl, 2) <> v_charge.amount_brl THEN
    v_reason := 'Valor recebido difere do valor da cobrança.';
  ELSE
    BEGIN
      IF v_charge.demurrage_invoice_id IS NOT NULL THEN
        v_result := public.register_demurrage_payment(v_request, v_charge.demurrage_invoice_id,
          (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date, p_txid, round(p_amount_brl, 2), NULL);
      ELSE
        SELECT itau_pix_settlement_actor INTO v_actor FROM public.app_settings WHERE id = 1;
        IF v_actor IS NULL THEN
          RAISE EXCEPTION 'Usuário de baixa automática Itaú não configurado.';
        END IF;
        PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
        SELECT invoice_type INTO v_invoice_type FROM public.invoices WHERE id = v_charge.invoice_id;
        IF v_invoice_type = 'manual' THEN
          v_result := public.register_verified_invoice_payment(v_charge.invoice_id, round(p_amount_brl, 2), 'pix',
            p_paid_at, 'Baixa automática Itaú Pix', v_request, p_end_to_end_id);
        ELSE
          v_result := public.reconcile_invoice_payment_by_txid(p_txid, round(p_amount_brl, 2), p_paid_at);
          IF coalesce((v_result->>'settled')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'Conciliação recusou: %', coalesce(v_result->>'reason', 'sem motivo');
          END IF;
          UPDATE public.payments SET bank_reference = p_end_to_end_id,
            notes = coalesce(notes || ' · ', '') || 'Baixa automática Itaú Pix'
          WHERE id = (v_result->'payment'->>'payment_id')::bigint;
        END IF;
        PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Desfaz só a baixa; a cobrança continua 'concluded' (paga no banco).
      PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      v_reason := left(SQLERRM, 300);
    END;
  END IF;

  INSERT INTO public.itau_pix_receipts(end_to_end_id, txid, charge_id, amount_brl, paid_at, status, reason, result)
  VALUES (p_end_to_end_id, p_txid, v_charge.id, round(p_amount_brl, 2), p_paid_at,
    CASE WHEN v_reason IS NULL THEN 'settled' ELSE 'review' END, v_reason, v_result);
  IF v_reason IS NOT NULL THEN
    PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
      'Pix de R$ ' || to_char(round(p_amount_brl, 2), 'FM999G999G990D00') || ' recebido pelo Itaú (TXID ' || p_txid
        || ') não foi baixado automaticamente: ' || v_reason,
      'itau_pix', 'administrativo',
      jsonb_build_object('end_to_end_id', p_end_to_end_id, 'txid', p_txid, 'amount_brl', round(p_amount_brl, 2),
        'invoice_id', v_charge.invoice_id, 'demurrage_invoice_id', v_charge.demurrage_invoice_id),
      '/reconciliacao');
    RETURN 'review';
  END IF;
  RETURN 'settled';
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_settle(text, text, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_settle(text, text, numeric, timestamptz) TO service_role;

-- Checkpoint da consulta: só avança depois que a janela inteira foi baixada.
CREATE FUNCTION public.itau_pix_checkpoint(p_polled_until timestamptz DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v timestamptz;
BEGIN
  IF p_polled_until IS NOT NULL THEN
    UPDATE public.app_settings SET itau_pix_polled_until = greatest(coalesce(itau_pix_polled_until, p_polled_until), p_polled_until)
    WHERE id = 1;
  END IF;
  SELECT itau_pix_polled_until INTO v FROM public.app_settings WHERE id = 1;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_checkpoint(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_checkpoint(timestamptz) TO service_role;

COMMIT;
