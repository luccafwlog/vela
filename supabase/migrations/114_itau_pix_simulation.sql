-- Preparação Pix: somente simulação explícita em faturas de teste.
-- Nenhum job, segredo, chamada bancária ou backfill é ativado por esta migration.
BEGIN;

CREATE TABLE public.pix_simulation_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  calendar_years integer[] NOT NULL DEFAULT '{}',
  holidays date[] NOT NULL DEFAULT '{}',
  local_expiration_seconds integer NOT NULL DEFAULT 86400 CHECK (local_expiration_seconds BETWEEN 60 AND 31536000),
  extend_expired boolean NOT NULL DEFAULT true
);
-- Calendário de Vitória/ES 2026 enviado pelo dono em 2026-09-30: feriados
-- nacionais e municipais; pontos facultativos (Carnaval, Cinzas, 30/10, 24/12,
-- 31/12) não suspendem o prazo. Outro ano exige calendário validado.
INSERT INTO public.pix_simulation_settings(singleton, calendar_years, holidays) VALUES (true, ARRAY[2026],
  ARRAY['2026-01-01','2026-04-03','2026-04-13','2026-04-21','2026-05-01','2026-06-04','2026-09-07',
    '2026-09-08','2026-10-12','2026-11-02','2026-11-15','2026-11-20','2026-12-25']::date[]);
-- pix_review segue pix_unreconciled: Administrativo trata na Conciliação PIX;
-- Documentação e Equipamentos são notificados porque pode ser Demurrage.
INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('pix_review', 'critical', 'administrativo', ARRAY['administrativo','documentacao','equipamentos'], '/reconciliacao'),
  ('pix_ptax_pending', 'critical', 'equipamentos', ARRAY['equipamentos'], '/demurrage');

CREATE TABLE public.pix_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id bigint REFERENCES public.invoices(id),
  demurrage_invoice_id bigint REFERENCES public.demurrage_invoices(id),
  process_key text NOT NULL,
  mode text NOT NULL DEFAULT 'simulation' CHECK (mode = 'simulation'),
  txid text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  amount_brl numeric(14,2) NOT NULL CHECK (amount_brl > 0),
  roe numeric(10,4),
  desired_version integer NOT NULL DEFAULT 1,
  confirmed_version integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT -1,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','expired','cancel_pending','cancelled','paid','review')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  fail_next boolean NOT NULL DEFAULT false,
  predecessor_id uuid REFERENCES public.pix_charges(id),
  CHECK (num_nonnulls(invoice_id, demurrage_invoice_id) = 1)
);
CREATE UNIQUE INDEX pix_one_open_process ON public.pix_charges(process_key)
  WHERE state IN ('pending','active','cancel_pending','review');
-- O trigger roda em toda alteração de fatura; sem índice seria varredura.
CREATE INDEX pix_charges_invoice_idx ON public.pix_charges(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX pix_charges_demurrage_invoice_idx ON public.pix_charges(demurrage_invoice_id) WHERE demurrage_invoice_id IS NOT NULL;
CREATE TABLE public.pix_charge_revisions (
  charge_id uuid NOT NULL REFERENCES public.pix_charges(id),
  revision integer NOT NULL,
  amount_brl numeric(14,2) NOT NULL CHECK (amount_brl > 0),
  roe numeric(10,4),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL,
  PRIMARY KEY (charge_id, revision)
);
CREATE TABLE public.pix_receipts (
  end_to_end_id text PRIMARY KEY CHECK (length(end_to_end_id) BETWEEN 1 AND 140),
  charge_id uuid NOT NULL REFERENCES public.pix_charges(id),
  revision integer NOT NULL,
  amount_brl numeric(14,2) NOT NULL CHECK (amount_brl > 0),
  paid_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','settled','review')),
  result jsonb,
  FOREIGN KEY (charge_id, revision) REFERENCES public.pix_charge_revisions(charge_id, revision)
);
ALTER TABLE public.invoices ADD COLUMN pix_integration_state text;
ALTER TABLE public.demurrage_invoices ADD COLUMN pix_integration_state text;

ALTER TABLE public.pix_simulation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pix_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pix_charge_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pix_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pix_simulation_settings, public.pix_charges, public.pix_charge_revisions, public.pix_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pix_simulation_settings, public.pix_charges, public.pix_charge_revisions, public.pix_receipts TO service_role;

-- Nenhum chamador do navegador pode habilitar simulação ou inserir recebimentos.
CREATE FUNCTION public._assert_pix_simulation() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Operação Pix reservada ao backend.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE((SELECT enabled FROM public.pix_simulation_settings WHERE singleton),false) THEN
    RAISE EXCEPTION 'Simulação Pix desativada.' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE FUNCTION public.pix_simulation_cutoff(p_at timestamptz) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_day date := (p_at AT TIME ZONE 'America/Sao_Paulo')::date + 1; v_settings public.pix_simulation_settings%ROWTYPE;
BEGIN
  IF p_at IS NULL THEN RAISE EXCEPTION 'Relógio da simulação é obrigatório.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO STRICT v_settings FROM public.pix_simulation_settings WHERE singleton;
  LOOP
    IF NOT (extract(year FROM v_day)::integer = ANY(v_settings.calendar_years)) THEN
      RAISE EXCEPTION 'Calendário de feriados Vitória/ES não validado para %.', extract(year FROM v_day) USING ERRCODE = '22023';
    END IF;
    EXIT WHEN extract(isodow FROM v_day) < 6 AND NOT (v_day = ANY(v_settings.holidays));
    v_day := v_day + 1;
  END LOOP;
  RETURN (v_day + time '14:30') AT TIME ZONE 'America/Sao_Paulo';
END;
$$;

CREATE FUNCTION public.enroll_pix_simulation(p_source text, p_invoice_id bigint, p_actor_id uuid, p_at timestamptz DEFAULT now()) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_amount numeric; v_roe numeric; v_process text; v_status text;
BEGIN
  PERFORM public._assert_pix_simulation();
  IF p_at IS NULL THEN RAISE EXCEPTION 'Relógio da simulação é obrigatório.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_actor_id AND active AND role = 'administrativo') THEN
    RAISE EXCEPTION 'Responsável pela simulação deve ser administrador ativo.' USING ERRCODE = '42501';
  END IF;
  IF p_source = 'local' THEN
    SELECT balance_brl, status INTO v_amount, v_status FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
    v_process := 'local:' || p_invoice_id;
  ELSIF p_source = 'demurrage' THEN
    SELECT current_total_brl, current_roe, status, 'demurrage:' || bl_id INTO v_amount, v_roe, v_status, v_process
      FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
    PERFORM public.pix_simulation_cutoff(p_at);
  ELSE RAISE EXCEPTION 'Origem de fatura inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('issued','overdue','partially_paid') OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Fatura não está aberta com saldo pagável.' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_id FROM public.pix_charges WHERE process_key = v_process AND state IN ('pending','active','cancel_pending','review');
  IF v_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.pix_charges WHERE id=v_id
      AND (p_source='local' AND invoice_id=p_invoice_id OR p_source='demurrage' AND demurrage_invoice_id=p_invoice_id)) THEN
      RAISE EXCEPTION 'O processo já tem cobrança vinculada a outra fatura.' USING ERRCODE='23505';
    END IF;
    RETURN v_id;
  END IF;
  INSERT INTO public.pix_charges(invoice_id, demurrage_invoice_id, process_key, actor_id, amount_brl, roe, created_at)
    VALUES (CASE WHEN p_source = 'local' THEN p_invoice_id END, CASE WHEN p_source = 'demurrage' THEN p_invoice_id END,
      v_process, p_actor_id, v_amount, v_roe, p_at) RETURNING id INTO v_id;
  IF p_source = 'local' THEN
    UPDATE public.invoices SET pix_payload = NULL, pix_txid = NULL, pix_integration_state = 'simulation:pending' WHERE id = p_invoice_id;
  ELSE
    UPDATE public.demurrage_invoices SET pix_payload = NULL, pix_txid = NULL, pix_integration_state = 'simulation:pending' WHERE id = p_invoice_id;
  END IF;
  RETURN v_id;
END;
$$;

-- A alteração da fatura e a intenção bancária ficam na mesma transação.
-- O simulador nunca grava payload pagável e não interfere em faturas não habilitadas.
CREATE FUNCTION public.track_pix_invoice_change() RETURNS trigger
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
CREATE TRIGGER zz_track_pix_local BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.track_pix_invoice_change();
CREATE TRIGGER zz_track_pix_demurrage BEFORE UPDATE ON public.demurrage_invoices FOR EACH ROW EXECUTE FUNCTION public.track_pix_invoice_change();

CREATE FUNCTION public.import_pix_simulated_receipt(p_txid text, p_revision integer, p_end_to_end_id text, p_paid_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_charge public.pix_charges%ROWTYPE; v_revision public.pix_charge_revisions%ROWTYPE; v_receipt public.pix_receipts%ROWTYPE;
BEGIN
  PERFORM public._assert_pix_simulation();
  SELECT * INTO v_charge FROM public.pix_charges WHERE txid=p_txid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TXID não reconhecido.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_revision FROM public.pix_charge_revisions WHERE charge_id=v_charge.id AND revision=p_revision;
  IF NOT FOUND OR p_paid_at IS NULL OR p_paid_at < v_revision.confirmed_at OR p_paid_at >= v_revision.expires_at THEN
    RAISE EXCEPTION 'Recebimento não corresponde a revisão pagável.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.pix_receipts(end_to_end_id,charge_id,revision,amount_brl,paid_at)
    VALUES(p_end_to_end_id,v_charge.id,p_revision,v_revision.amount_brl,p_paid_at) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT v_receipt FROM public.pix_receipts WHERE end_to_end_id=p_end_to_end_id;
  IF v_receipt.charge_id <> v_charge.id OR v_receipt.revision <> p_revision OR v_receipt.paid_at <> p_paid_at THEN
    RAISE EXCEPTION 'Identificador já recebido com outros dados.' USING ERRCODE='23505';
  END IF;
  RETURN to_jsonb(v_receipt);
END;
$$;

CREATE FUNCTION public.pay_pix_simulation(p_txid text, p_end_to_end_id text, p_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_charge public.pix_charges%ROWTYPE; v_revision public.pix_charge_revisions%ROWTYPE; v_receipt public.pix_receipts%ROWTYPE;
BEGIN
  PERFORM public._assert_pix_simulation();
  IF p_at IS NULL THEN RAISE EXCEPTION 'Relógio da simulação é obrigatório.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_charge FROM public.pix_charges WHERE txid = p_txid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança inexistente.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_receipt FROM public.pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN
    IF v_receipt.charge_id <> v_charge.id THEN RAISE EXCEPTION 'Identificador já usado em outra cobrança.' USING ERRCODE = '23505'; END IF;
    RETURN to_jsonb(v_receipt);
  END IF;
  SELECT * INTO v_revision FROM public.pix_charge_revisions WHERE charge_id = v_charge.id AND revision = v_charge.revision;
  IF v_charge.state NOT IN ('active','cancel_pending') OR v_revision.expires_at <= p_at OR v_revision.confirmed_at > p_at THEN
    RAISE EXCEPTION 'Cobrança não está pagável.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pix_receipts WHERE charge_id = v_charge.id) THEN
    RAISE EXCEPTION 'Cobrança já recebeu pagamento.' USING ERRCODE = '22023';
  END IF;
  RETURN public.import_pix_simulated_receipt(p_txid,v_revision.revision,p_end_to_end_id,p_at);
END;
$$;

CREATE FUNCTION public.run_pix_simulation(p_at timestamptz DEFAULT now()) RETURNS jsonb
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

REVOKE ALL ON FUNCTION public._assert_pix_simulation(), public.pix_simulation_cutoff(timestamptz),
  public.enroll_pix_simulation(text,bigint,uuid,timestamptz), public.track_pix_invoice_change(),
  public.import_pix_simulated_receipt(text,integer,text,timestamptz),
  public.pay_pix_simulation(text,text,timestamptz), public.run_pix_simulation(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_pix_simulation(text,bigint,uuid,timestamptz),
  public.import_pix_simulated_receipt(text,integer,text,timestamptz),
  public.pay_pix_simulation(text,text,timestamptz), public.run_pix_simulation(timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.register_demurrage_payment(
  p_request_id uuid,
  p_invoice_id bigint,
  p_paid_at date,
  p_pix_txid text DEFAULT NULL,
  p_total_brl numeric DEFAULT NULL,
  p_ptax_used numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_payload jsonb;
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_match record;
  v_has_history boolean;
  v_total_brl numeric(14,2);
  v_ptax numeric(10,4);
  v_roe numeric(10,4);
  v_discount numeric(12,2);
  v_result jsonb;
  v_txid text := NULLIF(btrim(p_pix_txid), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_financeiro_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para registrar baixa de Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Fatura e data de pagamento sao obrigatorias.' USING ERRCODE = '22023';
  END IF;
  IF v_txid IS NOT NULL AND char_length(v_txid) > 140 THEN
    RAISE EXCEPTION 'Identificador PIX invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_total_brl IS NOT NULL AND p_total_brl < 0 THEN
    RAISE EXCEPTION 'Valor pago nao pode ser negativo.' USING ERRCODE = '22003';
  END IF;

  v_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'paid_at', p_paid_at,
    'pix_txid', v_txid,
    'total_brl', CASE WHEN p_total_brl IS NULL THEN NULL ELSE round(p_total_brl, 2) END
  );
  v_previous := public._demurrage_mutation_request(p_request_id, 'payment', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN
    RETURN v_previous;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status = 'paid' THEN
    IF v_txid IS NOT NULL AND v_invoice.pix_txid = v_txid THEN
      RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'paid', 'idempotent', true);
    END IF;
    RAISE EXCEPTION 'Demurrage invoice % ja esta paga.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status NOT IN ('issued', 'overdue') OR v_invoice.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Demurrage invoice % nao pode ser baixada no status atual.', p_invoice_id USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.demurrage_invoice_history AS h
    WHERE h.invoice_id = p_invoice_id AND h.event_date <= p_paid_at
  ) INTO v_has_history;

  -- Revisão confirmada no simulador e recebimento persistido pelo backend.
  -- Não ampliar a janela dos extratos manuais sem essa prova vinculada.
  SELECT r.amount_brl AS total_brl, s.roe AS roe_used INTO v_match
  FROM public.pix_receipts r
  JOIN public.pix_charges c ON c.id = r.charge_id
  JOIN public.pix_charge_revisions s ON s.charge_id = c.id AND s.revision = r.revision
  WHERE c.demurrage_invoice_id = p_invoice_id AND c.txid = v_txid
    AND r.state = 'pending' AND r.amount_brl = round(p_total_brl, 2)
    AND (r.paid_at AT TIME ZONE 'America/Sao_Paulo')::date = p_paid_at
    AND (SELECT enabled FROM public.pix_simulation_settings WHERE singleton)
  LIMIT 1;
  IF FOUND THEN
    v_total_brl := v_match.total_brl;
    v_roe := v_match.roe_used;
    v_ptax := NULL;
  ELSIF v_has_history THEN
    -- A prova financeira vem da foto persistida, e a janela e a mesma do
    -- reconciliador: as DUAS fotos mais recentes ate a data do extrato.
    -- Uma cotacao mais antiga que isso e divergencia, nao quitacao.
    SELECT w.total_brl, w.ptax_used
      INTO v_match
    FROM public.get_demurrage_recent_values(p_invoice_id, p_paid_at) AS w
    WHERE p_total_brl IS NULL OR abs(w.total_brl - round(p_total_brl, 2)) <= 0.01
    ORDER BY w.event_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Valor divergente das duas ultimas fotos financeiras da Demurrage %.', p_invoice_id
        USING ERRCODE = '22003';
    END IF;

    v_total_brl := round(COALESCE(p_total_brl, v_match.total_brl), 2);
    v_ptax := v_match.ptax_used;
    -- O ROE da foto casada; get_demurrage_recent_values nao o projeta, entao
    -- ele vem da mesma linha pela chave (invoice, data, total).
    SELECT h.roe_used INTO v_roe
    FROM public.demurrage_invoice_history AS h
    WHERE h.invoice_id = p_invoice_id
      AND h.event_date <= p_paid_at
      AND h.total_brl = v_total_brl
    ORDER BY h.event_date DESC, h.id DESC
    LIMIT 1;
    v_roe := COALESCE(v_roe, v_invoice.current_roe);
  ELSE
    -- Legado sem foto: a propria fatura e a unica referencia disponivel. O ROE
    -- aplicado e conhecido; a PTAX que o originou, nao. Registrar NULL em vez
    -- de deduzir mantem o historico honesto (#658 F9).
    v_total_brl := round(COALESCE(p_total_brl, v_invoice.current_total_brl), 2);
    v_roe := v_invoice.current_roe;
    v_ptax := NULL;
    IF v_invoice.current_total_brl IS NULL
       OR p_total_brl IS NULL
       OR abs(v_invoice.current_total_brl - p_total_brl) > 0.01 THEN
      RAISE EXCEPTION 'Valor divergente da foto financeira da Demurrage %.', p_invoice_id USING ERRCODE = '22003';
    END IF;
  END IF;

  -- ptax_used e procedencia e pode faltar; o par (total_brl, roe_used) e que
  -- precisa ser pagavel. Uma PTAX presente, porem, tem de ser positiva.
  IF v_total_brl IS NULL OR v_total_brl <= 0 OR v_roe IS NULL OR v_roe <= 0 THEN
    RAISE EXCEPTION 'Fatura % nao possui uma foto financeira pagavel.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_ptax IS NOT NULL AND v_ptax <= 0 THEN
    RAISE EXCEPTION 'Fatura % tem cotacao invalida na foto financeira.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_txid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.demurrage_invoices d
    WHERE btrim(d.pix_txid) = v_txid AND d.id <> p_invoice_id
  ) THEN
    RAISE EXCEPTION 'PIX % ja esta associado a outra fatura.', v_txid USING ERRCODE = '23505';
  END IF;

  v_discount := greatest(0, round(v_invoice.total_usd - v_total_brl / v_roe, 2));

  UPDATE public.demurrage_invoices
  SET status = 'paid',
      paid_at = p_paid_at,
      pix_txid = v_txid,
      conciliated_by_extract = (v_txid IS NOT NULL),
      current_total_brl = v_total_brl,
      current_roe = v_roe,
      updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (p_invoice_id, p_paid_at, v_ptax, v_roe, v_invoice.total_usd, v_total_brl, v_discount, 'payment');

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'payment_registered',
    v_invoice.status,
    jsonb_build_object('status', 'paid', 'paid_at', p_paid_at, 'pix_txid', v_txid)::text,
    auth.uid(), now(), 'Baixa de Demurrage por contrato financeiro.'
  );

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', 'paid',
    'paid_at', p_paid_at,
    'total_brl', v_total_brl,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'payment', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION public._portal_get_demurrage_invoice_detail_core(p_customer_id bigint, p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_raw jsonb;
  v_invoice jsonb;
  v_items jsonb;
BEGIN
  v_raw := public._portal_get_demurrage_invoice_detail_core_unfiltered_20260920(p_customer_id, p_invoice_id);

  v_invoice := jsonb_build_object(
    'id', v_raw #> '{invoice,id}',
    'doc_number', v_raw #> '{invoice,doc_number}',
    'bl_id', v_raw #> '{invoice,bl_id}',
    'doc_date', v_raw #> '{invoice,doc_date}',
    'due_date', v_raw #> '{invoice,due_date}',
    'billed_at', v_raw #> '{invoice,billed_at}',
    'paid_at', v_raw #> '{invoice,paid_at}',
    'total_usd', v_raw #> '{invoice,total_usd}',
    'current_roe', v_raw #> '{invoice,current_roe}',
    'current_total_brl', v_raw #> '{invoice,current_total_brl}',
    'discount_type', v_raw #> '{invoice,discount_type}',
    'discount_value', v_raw #> '{invoice,discount_value}',
    'discount_mode', v_raw #> '{invoice,discount_mode}',
    'dispute_open', v_raw #> '{invoice,dispute_open}',
    'pix_payload', v_raw #> '{invoice,pix_payload}',
    'pix_integration_state', (SELECT to_jsonb(d.pix_integration_state) FROM public.demurrage_invoices d WHERE d.id=p_invoice_id AND d.customer_id=p_customer_id),
    'status', v_raw #> '{invoice,status}',
    'updated_at', v_raw #> '{invoice,updated_at}',
    'roe_source', v_raw #> '{invoice,roe_source}',
    'customer_name', v_raw #> '{invoice,customer_name}',
    'customer_cnpj_cpf', v_raw #> '{invoice,customer_cnpj_cpf}',
    'pol', v_raw #> '{invoice,pol}',
    'pod', v_raw #> '{invoice,pod}',
    'voyage_number', v_raw #> '{invoice,voyage_number}',
    'vessel_name', v_raw #> '{invoice,vessel_name}'
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', row->'id',
    'invoice_id', row->'invoice_id',
    'container_id', row->'container_id',
    'container_number', row->'container_number',
    'container_type', row->'container_type',
    'discharge_date', row->'discharge_date',
    'return_date', row->'return_date',
    'total_days', row->'total_days',
    'free_days', row->'free_days',
    'days_p1', row->'days_p1',
    'rate_p1_usd', row->'rate_p1_usd',
    'days_p2', row->'days_p2',
    'rate_p2_usd', row->'rate_p2_usd',
    'subtotal_usd', row->'subtotal_usd',
    'created_at', row->'created_at'
  )), '[]'::jsonb)
  INTO v_items
  FROM jsonb_array_elements(COALESCE(v_raw->'items', '[]'::jsonb)) AS row;

  RETURN jsonb_build_object('invoice', v_invoice, 'items', v_items);
END;
$$;
CREATE OR REPLACE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public._portal_invoice_visible(p_customer_id, p_invoice_id) THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  v_result := public._portal_invoice_details_core_20260927(p_customer_id, p_invoice_id);

  IF v_result #>> '{invoice,invoice_type}' IS DISTINCT FROM 'manual' THEN
    v_result := jsonb_set(
      v_result,
      '{invoice}',
      (v_result->'invoice') - 'notes',
      true
    );
  END IF;

  RETURN jsonb_set(v_result,'{invoice,pix_integration_state}', COALESCE((SELECT to_jsonb(i.pix_integration_state) FROM public.invoices i WHERE i.id=p_invoice_id AND i.customer_id=p_customer_id),'null'::jsonb),true);
END;
$function$;
COMMIT;
