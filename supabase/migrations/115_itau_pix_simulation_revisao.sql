-- Correções da revisão da simulação Pix (migration 114), ainda sem cron,
-- segredo ou chamada bancária.
-- Data status: o único UPDATE reescreve a linha pix_review do catálogo de
-- Alertas criada pela 114; depende da afirmação "Data status" do AGENTS.md.
BEGIN;

-- Decisão de 2026-09-30: pix_review segue pix_unreconciled. Administrativo
-- trata na Conciliação PIX; Documentação e Equipamentos são notificados
-- porque a cobrança pode ser de Demurrage.
UPDATE public.alert_type_catalog SET responsible_department = 'administrativo', audience_departments = ARRAY['administrativo','documentacao','equipamentos'] WHERE type = 'pix_review';

-- O trigger roda em toda alteração de fatura; sem índice seria varredura.
CREATE INDEX pix_charges_invoice_idx ON public.pix_charges(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX pix_charges_demurrage_invoice_idx ON public.pix_charges(demurrage_invoice_id) WHERE demurrage_invoice_id IS NOT NULL;

-- Cobrança em análise não é revisada nem cancelada pelo trigger: o recebimento
-- preservado espera decisão humana. Valor ausente não é pagável e cancela.
CREATE OR REPLACE FUNCTION public.track_pix_invoice_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_charge public.pix_charges%ROWTYPE; v_amount numeric; v_roe numeric;
BEGIN
  SELECT * INTO v_charge FROM public.pix_charges
  WHERE (TG_TABLE_NAME = 'invoices' AND invoice_id = NEW.id OR TG_TABLE_NAME = 'demurrage_invoices' AND demurrage_invoice_id = NEW.id)
    AND state IN ('pending','active','cancel_pending','review') FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'invoices' THEN v_amount := NEW.balance_brl; v_roe := NULL;
  ELSE v_amount := NEW.current_total_brl; v_roe := NEW.current_roe; END IF;
  IF v_charge.state = 'review' THEN
    NULL;
  ELSIF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('cancelled','obsolete','covered','paid')) OR COALESCE(v_amount, 0) <= 0 THEN
    UPDATE public.pix_charges SET state = 'cancel_pending', desired_version = desired_version + 1 WHERE id = v_charge.id AND state <> 'cancel_pending';
    NEW.pix_integration_state := 'simulation:cancel_pending';
  ELSIF v_charge.amount_brl IS DISTINCT FROM v_amount OR v_charge.roe IS DISTINCT FROM v_roe THEN
    UPDATE public.pix_charges SET amount_brl = v_amount, roe = v_roe, desired_version = desired_version + 1 WHERE id = v_charge.id;
    NEW.pix_integration_state := 'simulation:pending';
  END IF;
  NEW.pix_payload := NULL;
  IF NEW.status <> 'paid' THEN NEW.pix_txid := NULL; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_pix_simulation(p_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_charge public.pix_charges%ROWTYPE; v_settings public.pix_simulation_settings%ROWTYPE;
  v_receipt public.pix_receipts%ROWTYPE; v_status text; v_result jsonb; v_expiry timestamptz;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_role text := current_setting('request.jwt.claim.role', true);
  v_count integer := 0; v_new_id uuid; v_loop_id uuid; v_amount numeric;
BEGIN
  PERFORM public._assert_pix_simulation();
  IF p_at IS NULL THEN RAISE EXCEPTION 'Relógio da simulação é obrigatório.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_settings FROM public.pix_simulation_settings WHERE singleton;
  -- ponytail: lote serial de até 100 cobranças; particionar por processo se houver volume.
  FOR v_charge IN SELECT * FROM public.pix_charges c WHERE (state IN ('pending','active','cancel_pending')
      OR EXISTS(SELECT 1 FROM public.pix_receipts r WHERE r.charge_id=c.id AND r.state='pending')) AND created_at <= p_at
    AND (state IN ('pending','cancel_pending') OR desired_version <> confirmed_version OR last_error IS NOT NULL
      OR expires_at <= CASE WHEN invoice_id IS NOT NULL THEN p_at + interval '5 minutes' ELSE p_at END
      OR EXISTS(SELECT 1 FROM public.pix_receipts r WHERE r.charge_id = c.id AND r.state='pending'))
    ORDER BY attempts, created_at, id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    v_loop_id := v_charge.id;
    -- O trigger trava fatura e depois cobrança; aqui a cobrança já está
    -- travada, então a fatura ocupada fica para a próxima execução em vez de
    -- esperar e formar deadlock com a edição (ou o recálculo da PTAX).
    BEGIN
      IF v_charge.invoice_id IS NOT NULL THEN PERFORM 1 FROM public.invoices WHERE id = v_charge.invoice_id FOR UPDATE NOWAIT;
      ELSE PERFORM 1 FROM public.demurrage_invoices WHERE id = v_charge.demurrage_invoice_id FOR UPDATE NOWAIT; END IF;
    EXCEPTION WHEN lock_not_available THEN CONTINUE;
    END;
    BEGIN
    IF v_charge.fail_next THEN
      -- Resposta incerta: não conclui nada e exige análise, como no transporte real.
      UPDATE public.pix_charges SET fail_next = false, attempts = attempts + 1, last_error = 'Falha simulada; confirmação pendente.' WHERE id = v_charge.id;
      PERFORM public.upsert_alert_item('pix_review','pix_charge',v_charge.id::text,
        'A confirmação da cobrança Pix simulada ficou incerta; verifique antes de repetir.','pix_simulation',
        jsonb_build_object('txid',v_charge.txid,'error','uncertain'),'/reconciliacao');
      CONTINUE;
    END IF;
    SELECT * INTO v_receipt FROM public.pix_receipts WHERE charge_id = v_charge.id AND state='pending' ORDER BY paid_at LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF v_charge.invoice_id IS NOT NULL THEN SELECT status INTO v_status FROM public.invoices WHERE id = v_charge.invoice_id;
      ELSE SELECT status INTO v_status FROM public.demurrage_invoices WHERE id = v_charge.demurrage_invoice_id; END IF;
      IF v_status NOT IN ('issued','overdue','partially_paid') THEN
        UPDATE public.pix_receipts SET state = 'review' WHERE end_to_end_id = v_receipt.end_to_end_id;
        UPDATE public.pix_charges SET state = 'review', last_error = 'Recebimento após fechamento da fatura; análise necessária.' WHERE id = v_charge.id;
      ELSE
        BEGIN
          -- Ator escolhido pelo backend e validado no cadastro. Os comandos
          -- financeiros existentes continuam executando as guardas de admin.
          PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_charge.actor_id, 'role','authenticated')::text, true);
          PERFORM set_config('request.jwt.claim.sub', v_charge.actor_id::text, true);
          PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
          IF v_charge.invoice_id IS NOT NULL THEN
            v_result := public.register_ledger_invoice_payment(v_charge.invoice_id, v_receipt.amount_brl, 'pix', v_receipt.paid_at,
              v_charge.txid, 'pix_extract', 'Recebimento simulado; sem transferência bancária.', v_charge.actor_id, v_charge.id);
          ELSE
            v_result := public.register_demurrage_payment(v_charge.id, v_charge.demurrage_invoice_id,
              (v_receipt.paid_at AT TIME ZONE 'America/Sao_Paulo')::date, v_charge.txid, v_receipt.amount_brl, NULL);
          END IF;
          PERFORM set_config('request.jwt.claims', COALESCE(v_claims,''), true);
          PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub,''), true);
          PERFORM set_config('request.jwt.claim.role', COALESCE(v_role,''), true);
          UPDATE public.pix_receipts SET state = 'settled', result = v_result WHERE end_to_end_id = v_receipt.end_to_end_id;
          UPDATE public.pix_charges SET state = 'paid', last_error = NULL WHERE id = v_charge.id;
        EXCEPTION WHEN OTHERS THEN
          -- O rollback do bloco devolve o contexto de autenticação. Conflito
          -- transitório repete; recusa da baixa (ex.: valor acima do saldo)
          -- não se resolve sozinha e o dinheiro recebido vai para análise.
          IF SQLSTATE LIKE '40%' OR SQLSTATE = '55P03' THEN RAISE; END IF;
          UPDATE public.pix_receipts SET state = 'review', result = jsonb_build_object('error_code', SQLSTATE)
            WHERE end_to_end_id = v_receipt.end_to_end_id;
          UPDATE public.pix_charges SET state = 'review',
            last_error = 'Recebimento não pôde ser baixado (' || SQLSTATE || '); análise necessária.' WHERE id = v_charge.id;
        END;
      END IF;
    ELSIF v_charge.state = 'cancel_pending' THEN
      UPDATE public.pix_charges SET state = 'cancelled', confirmed_version = desired_version, last_error = NULL WHERE id = v_charge.id;
    ELSIF v_charge.state <> 'review' THEN
      v_expiry := CASE WHEN v_charge.demurrage_invoice_id IS NOT NULL THEN public.pix_simulation_cutoff(v_charge.created_at)
        ELSE p_at + make_interval(secs => v_settings.local_expiration_seconds) END;
      IF v_charge.demurrage_invoice_id IS NOT NULL AND v_expiry <= p_at
         OR v_charge.invoice_id IS NOT NULL AND v_charge.expires_at <= p_at AND NOT v_settings.extend_expired THEN
        -- Mesmo banco simulado: confirmação atômica de ausência de recebimentos
        -- e expiração. Em transporte real, timeout não permite essa conclusão.
        UPDATE public.pix_charges SET state = 'expired' WHERE id = v_charge.id;
        IF v_charge.invoice_id IS NOT NULL THEN SELECT status, balance_brl INTO v_status, v_amount FROM public.invoices WHERE id = v_charge.invoice_id;
        ELSE SELECT status, current_total_brl INTO v_status, v_amount FROM public.demurrage_invoices WHERE id = v_charge.demurrage_invoice_id; END IF;
        -- Decisão de 2026-09-30: fatura aberta recebe nova cobrança (novo TXID)
        -- na mesma fatura e na mesma execução. Demurrage usa o valor vigente;
        -- PTAX aplicada depois vira revisão do novo TXID pelo trigger.
        IF v_status IN ('issued','overdue','partially_paid') AND v_amount > 0 THEN
          v_new_id := public.enroll_pix_simulation(CASE WHEN v_charge.invoice_id IS NOT NULL THEN 'local' ELSE 'demurrage' END,
            COALESCE(v_charge.invoice_id, v_charge.demurrage_invoice_id), v_charge.actor_id, p_at);
          UPDATE public.pix_charges SET predecessor_id = v_charge.id WHERE id = v_new_id;
          SELECT * INTO v_charge FROM public.pix_charges WHERE id = v_new_id;
          v_expiry := CASE WHEN v_charge.demurrage_invoice_id IS NOT NULL THEN public.pix_simulation_cutoff(v_charge.created_at)
            ELSE p_at + make_interval(secs => v_settings.local_expiration_seconds) END;
        END IF;
      END IF;
      IF v_charge.state IN ('pending','active') AND (v_charge.desired_version <> v_charge.confirmed_version
         OR (v_charge.invoice_id IS NOT NULL AND v_charge.expires_at <= p_at + interval '5 minutes')) THEN
        INSERT INTO public.pix_charge_revisions(charge_id, revision, amount_brl, roe, expires_at, confirmed_at)
          VALUES (v_charge.id, v_charge.revision + 1, v_charge.amount_brl, v_charge.roe, v_expiry, p_at);
        UPDATE public.pix_charges SET revision = revision + 1, expires_at = v_expiry, state = 'active',
          confirmed_version = desired_version, last_error = NULL WHERE id = v_charge.id;
      END IF;
    END IF;
    SELECT * INTO v_charge FROM public.pix_charges WHERE id = v_charge.id;
    IF v_charge.demurrage_invoice_id IS NOT NULL AND v_charge.confirmed_version = v_charge.desired_version AND v_charge.state = 'active' THEN
      PERFORM public.resolve_alert_item('pix_ptax_pending','demurrage_invoice',v_charge.demurrage_invoice_id::text,
        'pix_simulation',jsonb_build_object('confirmed_version',v_charge.confirmed_version));
    END IF;
    IF v_charge.state = 'review' THEN
      PERFORM public.upsert_alert_item('pix_review', 'pix_charge', v_charge.id::text,
        'A cobrança Pix simulada precisa de análise.', 'pix_simulation', jsonb_build_object('txid',v_charge.txid), '/reconciliacao');
    ELSE
      -- Processamento concluído: falha ou incerteza anterior deixa de valer.
      PERFORM public.resolve_alert_item('pix_review','pix_charge',v_loop_id::text,'pix_simulation',
        jsonb_build_object('state',v_charge.state));
    END IF;
    IF v_charge.invoice_id IS NOT NULL THEN
      UPDATE public.invoices SET pix_payload = NULL, pix_txid = CASE WHEN v_charge.state = 'paid' THEN v_charge.txid ELSE pix_txid END,
        pix_integration_state = CASE WHEN status='paid' THEN 'simulation:paid' ELSE 'simulation:' || v_charge.state END WHERE id = v_charge.invoice_id;
    ELSE
      UPDATE public.demurrage_invoices SET pix_payload = NULL, pix_txid = CASE WHEN v_charge.state = 'paid' THEN v_charge.txid ELSE pix_txid END,
        pix_integration_state = CASE WHEN status='paid' THEN 'simulation:paid' ELSE 'simulation:' || v_charge.state END WHERE id = v_charge.demurrage_invoice_id;
    END IF;
    v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.pix_charges SET attempts = attempts + 1, last_error = 'Processamento pendente (' || SQLSTATE || '); verificar dados e repetir.' WHERE id = v_loop_id;
      PERFORM public.upsert_alert_item('pix_review','pix_charge',v_loop_id::text,
        'O processamento da cobrança Pix simulada falhou; verifique e reprocesse.','pix_simulation',
        jsonb_build_object('error_code',SQLSTATE),'/reconciliacao');
    END;
  END LOOP;
  -- Falhas do lote não escondem a PTAX ainda pendente após as 14h.
  IF (p_at AT TIME ZONE 'America/Sao_Paulo')::time >= time '14:00' THEN
    FOR v_charge IN SELECT * FROM public.pix_charges WHERE demurrage_invoice_id IS NOT NULL AND state IN ('active','pending') AND desired_version <> confirmed_version LOOP
      PERFORM public.upsert_alert_item('pix_ptax_pending', 'demurrage_invoice', v_charge.demurrage_invoice_id::text,
        'A PTAX da Demurrage ainda não está refletida na cobrança Pix.', 'pix_simulation', jsonb_build_object('txid',v_charge.txid), '/demurrage');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('processed',v_count,'mode','simulation');
END;
$$;

REVOKE ALL ON FUNCTION public.track_pix_invoice_change(), public.run_pix_simulation(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_pix_simulation(timestamptz) TO service_role;
COMMIT;
