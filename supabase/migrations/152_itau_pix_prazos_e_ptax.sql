-- 152: prazos das cobranças Itaú (Fase 4 do plano 2026-10-06-integracao-itau-pix).
-- Regras aprovadas em 2026-09-30:
--   - Demurrage: uma cobrança por fatura; nova PTAX altera a MESMA cobrança
--     (mesmo TXID, nova revisão); vale até 14h30 do próximo dia útil em
--     Vitória/ES. Vencida, a fatura recebe nova cobrança (novo TXID) depois de
--     confirmar no banco que a anterior não foi paga. Alerta às 14h se a PTAX
--     do dia não estiver refletida.
--   - Taxas Locais: cobrança pagável enquanto a fatura estiver aberta,
--     renovando a validade da mesma cobrança antes de vencer.
-- `itau_pix_maintain` roda a cada execução da função `itau-pix`, antes da fila.
-- Aditiva: não reescreve nem apaga linhas existentes; nenhum cron é criado.
BEGIN;

-- Calendário de Vitória/ES enviado pelo dono em 2026-09-30 (nacionais e
-- municipais, que já cobrem os estaduais; pontos facultativos não suspendem
-- o prazo). 2027 derivado das mesmas leis, autorizado pelo dono; conferir com
-- a publicação oficial da Prefeitura. Outro ano exige cadastro: sem ele o
-- corte falha alto (e o Alerta avisa 60 dias antes).
CREATE TABLE public.business_holidays (day date PRIMARY KEY);
ALTER TABLE public.business_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_holidays FROM PUBLIC, anon, authenticated;
INSERT INTO public.business_holidays(day) SELECT unnest(ARRAY[
  '2026-01-01','2026-04-03','2026-04-13','2026-04-21','2026-05-01','2026-06-04','2026-09-07',
  '2026-09-08','2026-10-12','2026-11-02','2026-11-15','2026-11-20','2026-12-25',
  '2027-01-01','2027-03-26','2027-04-05','2027-04-21','2027-05-01','2027-05-27','2027-09-07',
  '2027-09-08','2027-10-12','2027-11-02','2027-11-15','2027-11-20','2027-12-25']::date[]);

CREATE FUNCTION public.itau_pix_business_day(p_day date) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.business_holidays WHERE extract(year FROM day) = extract(year FROM p_day)) THEN
    RAISE EXCEPTION 'Calendário de feriados de % não cadastrado (business_holidays).', extract(year FROM p_day)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN extract(isodow FROM p_day) < 6 AND NOT EXISTS (SELECT 1 FROM public.business_holidays WHERE day = p_day);
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_business_day(date) FROM PUBLIC, anon, authenticated;

-- 14h30 (America/Sao_Paulo) do primeiro dia útil depois da data local de p_at.
CREATE FUNCTION public.itau_pix_cutoff(p_at timestamptz) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_day date := (p_at AT TIME ZONE 'America/Sao_Paulo')::date + 1;
BEGIN
  WHILE NOT public.itau_pix_business_day(v_day) LOOP v_day := v_day + 1; END LOOP;
  RETURN (v_day + time '14:30') AT TIME ZONE 'America/Sao_Paulo';
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_cutoff(timestamptz) FROM PUBLIC, anon, authenticated;

-- Novos estados: pending_update (PATCH no mesmo TXID: valor e/ou validade),
-- pending_expire_check (passou da validade; confirmar no banco antes de
-- substituir) e expired (confirmada vencida e não paga).
ALTER TABLE public.itau_pix_charges
  ADD COLUMN bank_created_at timestamptz,
  ADD COLUMN expires_at timestamptz,
  DROP CONSTRAINT itau_pix_charges_status_check,
  ADD CONSTRAINT itau_pix_charges_status_check CHECK (status IN ('pending_create', 'active', 'pending_update',
    'pending_expire_check', 'pending_cancel', 'cancelled', 'concluded', 'expired'));
DROP INDEX public.itau_pix_charges_open_invoice;
DROP INDEX public.itau_pix_charges_open_demurrage;
DROP INDEX public.itau_pix_charges_work;
CREATE UNIQUE INDEX itau_pix_charges_open_invoice ON public.itau_pix_charges(invoice_id)
  WHERE status IN ('pending_create', 'active', 'pending_update', 'pending_expire_check');
CREATE UNIQUE INDEX itau_pix_charges_open_demurrage ON public.itau_pix_charges(demurrage_invoice_id)
  WHERE status IN ('pending_create', 'active', 'pending_update', 'pending_expire_check');
CREATE INDEX itau_pix_charges_work ON public.itau_pix_charges(next_attempt_at)
  WHERE status IN ('pending_create', 'pending_update', 'pending_expire_check', 'pending_cancel');

CREATE OR REPLACE FUNCTION public._itau_pix_sync(p_invoice_id bigint, p_demurrage_invoice_id bigint, p_amount_brl numeric, p_payable boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_open public.itau_pix_charges%ROWTYPE; v_cutoff timestamptz;
BEGIN
  SELECT * INTO v_open FROM public.itau_pix_charges
  WHERE status IN ('pending_create', 'active', 'pending_update', 'pending_expire_check')
    AND (invoice_id = p_invoice_id OR demurrage_invoice_id = p_demurrage_invoice_id)
  FOR UPDATE;
  -- Vencida em confirmação: nada a mostrar nem a criar até o banco responder.
  IF FOUND AND v_open.status = 'pending_expire_check' THEN RETURN NULL; END IF;
  IF p_demurrage_invoice_id IS NOT NULL AND p_payable AND round(p_amount_brl, 2) > 0 THEN
    v_cutoff := public.itau_pix_cutoff(now());
    -- Demurrage já no banco: PTAX nova ou prazo novo alteram a MESMA cobrança.
    IF FOUND AND v_open.status IN ('active', 'pending_update') THEN
      IF v_open.amount_brl <> round(p_amount_brl, 2) OR v_open.expires_at IS NULL OR v_open.expires_at < v_cutoff THEN
        UPDATE public.itau_pix_charges SET amount_brl = round(p_amount_brl, 2), status = 'pending_update',
          expiration_seconds = ceil(extract(epoch FROM v_cutoff - v_open.bank_created_at))::integer,
          -- Mesma regra da 150: não encurta a reserva de uma chamada em andamento.
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
$$;

-- Resultado agora traz a criação no banco (base da validade, em segundos
-- desde calendario.criacao) e o desfecho 'expired'.
DROP FUNCTION public.itau_pix_record(bigint, text, integer, text, text);
CREATE FUNCTION public.itau_pix_record(p_id bigint, p_outcome text, p_revision integer DEFAULT NULL,
  p_pix_copia_e_cola text DEFAULT NULL, p_error text DEFAULT NULL, p_bank_created_at timestamptz DEFAULT NULL)
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
      status = CASE WHEN status IN ('pending_create', 'pending_update', 'pending_expire_check') THEN 'active' ELSE status END
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
REVOKE ALL ON FUNCTION public.itau_pix_record(bigint, text, integer, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_record(bigint, text, integer, text, text, timestamptz) TO service_role;

-- Baixa (151) com uma mudança: valor exato só para faturas locais.
CREATE OR REPLACE FUNCTION public.itau_pix_settle(p_end_to_end_id text, p_txid text, p_amount_brl numeric, p_paid_at timestamptz)
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
  -- Demurrage: a cobrança guarda a revisão mais nova; o pagamento da revisão
  -- anterior é válido e register_demurrage_payment confere a janela de PTAX.
  ELSIF v_charge.invoice_id IS NOT NULL AND round(p_amount_brl, 2) <> v_charge.amount_brl THEN
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
      -- Mesma regra da 151: erro passageiro falha a chamada para nova tentativa.
      IF left(SQLSTATE, 2) IN ('08', '40', '53', '55', '57', 'XX') THEN RAISE; END IF;
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

-- Prazos dirigidos pelo relógio, não por mudança na fatura.
CREATE FUNCTION public.itau_pix_maintain(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expired integer; v_renewed integer; v_extended integer; v_pending integer;
  v_local_day date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ref public.exchange_rate_reference%ROWTYPE;
  v_cutoff timestamptz;
BEGIN
  IF (SELECT pix_provider FROM public.app_settings WHERE id = 1) IS DISTINCT FROM 'itau' THEN
    RETURN jsonb_build_object('skipped', 'provider_static');
  END IF;
  -- 1. Passou da validade: confirmar no banco antes de substituir.
  UPDATE public.itau_pix_charges SET status = 'pending_expire_check', next_attempt_at = p_now, updated_at = p_now
  WHERE status = 'active' AND expires_at <= p_now;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- 2. Taxas Locais abertas: renovar a mesma cobrança com 7 dias de folga.
  -- ponytail: folga fixa; ajustar se o Itaú limitar a validade máxima.
  UPDATE public.itau_pix_charges c SET status = 'pending_update', next_attempt_at = p_now, updated_at = p_now,
    expiration_seconds = ceil(extract(epoch FROM p_now + make_interval(secs => s.itau_pix_expiration_seconds) - c.bank_created_at))::integer
  FROM public.app_settings s, public.invoices i
  WHERE s.id = 1 AND i.id = c.invoice_id AND c.status = 'active' AND c.expires_at < p_now + interval '7 days'
    AND i.status IN ('issued', 'partially_paid', 'overdue');
  GET DIAGNOSTICS v_renewed = ROW_COUNT;

  -- 3. Demurrage que já reflete a PTAX de hoje e não mudou de valor (ROE
  -- igual ao de ontem não dispara o gatilho): estender até o próximo corte.
  SELECT * INTO v_ref FROM public.exchange_rate_reference WHERE id = 1;
  IF v_ref.quote_date = v_local_day THEN
    v_cutoff := public.itau_pix_cutoff(p_now);
    UPDATE public.itau_pix_charges c SET status = 'pending_update', next_attempt_at = p_now, updated_at = p_now,
      expiration_seconds = ceil(extract(epoch FROM v_cutoff - c.bank_created_at))::integer
    FROM public.demurrage_invoices d
    WHERE d.id = c.demurrage_invoice_id AND c.status = 'active' AND c.expires_at < v_cutoff
      AND d.status IN ('issued', 'overdue') AND d.current_roe = v_ref.roe;
    GET DIAGNOSTICS v_extended = ROW_COUNT;
  END IF;

  -- 4. Às 14h de dia útil, Demurrage aberta sem a PTAX do dia confirmada na cobrança.
  IF public.itau_pix_business_day(v_local_day) AND (p_now AT TIME ZONE 'America/Sao_Paulo')::time >= time '14:00' THEN
    SELECT count(*) INTO v_pending FROM public.demurrage_invoices d
    LEFT JOIN public.itau_pix_charges c ON c.demurrage_invoice_id = d.id AND c.status = 'active'
    WHERE d.status IN ('issued', 'overdue') AND coalesce(d.current_total_brl, 0) > 0
      AND (v_ref.quote_date IS DISTINCT FROM v_local_day OR d.current_roe IS DISTINCT FROM v_ref.roe
        OR c.id IS NULL OR c.amount_brl <> d.current_total_brl OR c.expires_at < public.itau_pix_cutoff(p_now));
    IF v_pending > 0 THEN
      PERFORM public.upsert_alert_item('demurrage_ptax_recalc_failed', 'exchange_rate_reference', 'itau-pix-14h',
        v_pending || ' fatura(s) de Demurrage sem a PTAX de hoje refletida na cobrança Pix às 14h. Confira a atualização da PTAX; '
          || 'o corte das 14h30 encerra as cobranças atuais e as novas saem com o último valor disponível.',
        'itau_pix', 'documentacao', jsonb_build_object('pending', v_pending, 'day', v_local_day), '/demurrage');
    ELSE
      PERFORM public.resolve_alert_item('demurrage_ptax_recalc_failed', 'exchange_rate_reference', 'itau-pix-14h',
        'itau_pix', jsonb_build_object('day', v_local_day));
    END IF;
  END IF;

  -- 5. Calendário do ano seguinte, 60 dias antes da virada.
  IF v_local_day >= make_date(extract(year FROM v_local_day)::int, 11, 1)
     AND NOT EXISTS (SELECT 1 FROM public.business_holidays WHERE extract(year FROM day) = extract(year FROM v_local_day) + 1) THEN
    PERFORM public.upsert_alert_item('demurrage_ptax_recalc_failed', 'exchange_rate_reference', 'itau-pix-calendar',
      'Cadastre os feriados de Vitória/ES de ' || (extract(year FROM v_local_day) + 1) || ' em business_holidays: '
        || 'sem eles o prazo das cobranças Pix da Demurrage não pode ser calculado.',
      'itau_pix', 'documentacao', jsonb_build_object('year', extract(year FROM v_local_day) + 1), '/demurrage');
  END IF;

  RETURN jsonb_build_object('expired', v_expired, 'renewed', v_renewed, 'extended', coalesce(v_extended, 0), 'ptax_pending', v_pending);
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_maintain(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_maintain(timestamptz) TO service_role;

COMMIT;
