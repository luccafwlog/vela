-- 150: cobranças Pix dinâmicas do Itaú (Fase 2 do plano 2026-10-06-integracao-itau-pix).
--
-- Chave `app_settings.pix_provider`: 'static' (padrão) mantém o QR estático
-- exatamente como na 130; 'itau' faz os pontos únicos onde o QR nasce
-- (gatilho das faturas locais/avulsas e novo gatilho da Demurrage) abrirem ou
-- cancelarem cobranças numa fila (`itau_pix_charges`). A função `itau-pix`
-- processa a fila fora da transação e devolve o resultado por
-- `itau_pix_record`, que grava o copia e cola em `pix_payload` — Vela e Portal
-- continuam lendo o mesmo campo. Enquanto a cobrança não está ativa,
-- `pix_payload` fica NULL ("QR em preparação").
--
-- Toda mudança do valor pagável (emissão, baixa parcial, correção, PTAX,
-- reemissão automática, troca de Cliente, cancelamento) passa por esses
-- gatilhos, então nenhum chamador precisa conhecer o Itaú.
-- ponytail: valor novo = cancela a COB e cria outra; a Fase 4 troca isso por
-- PATCH no mesmo TXID para a PTAX da Demurrage e pelo corte das 14h30.
--
-- Aditiva: não reescreve nem apaga linhas existentes; nenhum cron é criado.
BEGIN;

ALTER TABLE public.app_settings
  ADD COLUMN pix_provider text NOT NULL DEFAULT 'static' CHECK (pix_provider IN ('static', 'itau')),
  -- ponytail: validade única até a Fase 4 (renovação de Taxas Locais e corte da Demurrage).
  ADD COLUMN itau_pix_expiration_seconds integer NOT NULL DEFAULT 2592000
    CHECK (itau_pix_expiration_seconds BETWEEN 3600 AND 31536000);

CREATE TABLE public.itau_pix_charges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- FKs adiadas: a cobrança nasce no gatilho BEFORE INSERT da própria fatura.
  invoice_id bigint REFERENCES public.invoices(id) DEFERRABLE INITIALLY DEFERRED,
  demurrage_invoice_id bigint REFERENCES public.demurrage_invoices(id) DEFERRABLE INITIALLY DEFERRED,
  txid text NOT NULL UNIQUE CHECK (txid ~ '^VELA[A-Z0-9]{22,31}$'),
  amount_brl numeric(14,2) NOT NULL CHECK (amount_brl > 0),
  expiration_seconds integer NOT NULL CHECK (expiration_seconds > 0),
  -- pending_create/pending_cancel: aguardam o Itaú. concluded: paga no banco
  -- (encontrada ao cancelar ou consultar); a baixa é da Fase 3.
  status text NOT NULL DEFAULT 'pending_create'
    CHECK (status IN ('pending_create', 'active', 'pending_cancel', 'cancelled', 'concluded')),
  -- Última escrita sem resposta: o próximo passo consulta antes de repetir.
  uncertain boolean NOT NULL DEFAULT false,
  revision integer,
  pix_copia_e_cola text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(invoice_id, demurrage_invoice_id) = 1)
);
-- No máximo uma cobrança aberta por fatura.
CREATE UNIQUE INDEX itau_pix_charges_open_invoice ON public.itau_pix_charges(invoice_id)
  WHERE status IN ('pending_create', 'active');
CREATE UNIQUE INDEX itau_pix_charges_open_demurrage ON public.itau_pix_charges(demurrage_invoice_id)
  WHERE status IN ('pending_create', 'active');
CREATE INDEX itau_pix_charges_work ON public.itau_pix_charges(next_attempt_at)
  WHERE status IN ('pending_create', 'pending_cancel');
ALTER TABLE public.itau_pix_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.itau_pix_charges FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._itau_pix_provider() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT pix_provider FROM public.app_settings WHERE id = 1), 'static')
$$;
REVOKE ALL ON FUNCTION public._itau_pix_provider() FROM PUBLIC, anon, authenticated;

-- Concilia a fila com o valor pagável e devolve o copia e cola a exibir
-- (NULL enquanto não houver cobrança ativa com esse valor).
CREATE FUNCTION public._itau_pix_sync(p_invoice_id bigint, p_demurrage_invoice_id bigint, p_amount_brl numeric, p_payable boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_open public.itau_pix_charges%ROWTYPE;
BEGIN
  SELECT * INTO v_open FROM public.itau_pix_charges
  WHERE status IN ('pending_create', 'active')
    AND (invoice_id = p_invoice_id OR demurrage_invoice_id = p_demurrage_invoice_id)
  FOR UPDATE;
  IF FOUND AND p_payable AND v_open.amount_brl = round(p_amount_brl, 2) THEN
    RETURN v_open.pix_copia_e_cola;
  END IF;
  IF FOUND THEN
    -- Nunca enviada (nem reservada pelo processador): basta descartar.
    UPDATE public.itau_pix_charges SET
      status = CASE WHEN status = 'pending_create' AND attempts = 0 AND NOT uncertain THEN 'cancelled' ELSE 'pending_cancel' END,
      -- Não encurta a reserva de uma chamada em andamento: cancelar antes de a
      -- criação terminar deixaria a cobrança ativa no Itaú e cancelada aqui.
      -- ponytail: também adia o cancelamento de uma cobrança em backoff (até 60 min).
      next_attempt_at = greatest(next_attempt_at, now()), updated_at = now()
    WHERE id = v_open.id;
  END IF;
  IF p_payable AND round(p_amount_brl, 2) > 0 THEN
    INSERT INTO public.itau_pix_charges(invoice_id, demurrage_invoice_id, txid, amount_brl, expiration_seconds)
    VALUES (p_invoice_id, p_demurrage_invoice_id,
      -- 'VELA' + 28 hex maiúsculos = 32 caracteres; prefixo separa do sistema de terceiro.
      'VELA' || upper(left(replace(gen_random_uuid()::text, '-', ''), 28)),
      round(p_amount_brl, 2),
      (SELECT itau_pix_expiration_seconds FROM public.app_settings WHERE id = 1));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._itau_pix_sync(bigint, bigint, numeric, boolean) FROM PUBLIC, anon, authenticated;

-- Faturas locais e avulsas: corpo da 130 preservado para 'static'.
CREATE OR REPLACE FUNCTION public.populate_local_invoice_pix_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_txid text;
BEGIN
  IF coalesce(NEW.invoice_type, 'individual') IN ('individual', 'consolidated', 'manual')
     AND public._itau_pix_provider() = 'itau' THEN
    NEW.pix_payload := public._itau_pix_sync(NEW.id, NULL, coalesce(NEW.balance_brl, NEW.total_brl, 0),
      coalesce(NEW.status, 'issued') IN ('issued', 'partially_paid', 'overdue') AND coalesce(NEW.balance_brl, NEW.total_brl, 0) > 0);
    RETURN NEW;
  END IF;
  IF NEW.invoice_type = 'manual' THEN
    IF NEW.pix_payload IS NULL AND NEW.total_brl > 0 THEN
      NEW.pix_payload := public.build_transshipping_pix_payload(NEW.total_brl, NEW.invoice_number);
    END IF;
    RETURN NEW;
  END IF;
  IF coalesce(NEW.invoice_type, 'individual') NOT IN ('individual', 'consolidated') THEN RETURN NEW; END IF;
  IF coalesce(NEW.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') OR coalesce(NEW.balance_brl, NEW.total_brl, 0) <= 0 THEN
    NEW.pix_payload := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.pix_payload := coalesce(NEW.pix_payload, public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), NEW.invoice_number));
  ELSIF NEW.balance_brl IS DISTINCT FROM OLD.balance_brl OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.pix_payload IS NULL OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    -- Cada apresentação tem identidade própria; pix_txid continua sendo o TXID recebido.
    v_txid := CASE WHEN NOT EXISTS (SELECT 1 FROM public.local_pix_charge_versions WHERE invoice_id = NEW.id)
      THEN left(upper(regexp_replace(NEW.invoice_number, '[^A-Za-z0-9]', '', 'g')), 25)
      ELSE 'VP' || upper(substr(md5(NEW.id::text || clock_timestamp()::text || random()::text), 1, 23)) END;
    NEW.pix_payload := public.build_transshipping_pix_payload(coalesce(NEW.balance_brl, NEW.total_brl), v_txid);
    INSERT INTO public.local_pix_charge_versions(invoice_id, txid, amount_brl, payload)
      VALUES (NEW.id, v_txid, coalesce(NEW.balance_brl, NEW.total_brl), NEW.pix_payload);
  END IF;
  RETURN NEW;
END;
$$;

-- Demurrage: várias RPCs gravam o QR estático; este gatilho roda depois delas
-- (nome zz_ = último BEFORE) e só age com o provedor Itaú.
CREATE FUNCTION public.itau_pix_demurrage_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public._itau_pix_provider() = 'itau' THEN
    NEW.pix_payload := public._itau_pix_sync(NULL, NEW.id, coalesce(NEW.current_total_brl, 0),
      NEW.status IN ('issued', 'overdue') AND coalesce(NEW.current_total_brl, 0) > 0);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_demurrage_payload() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_itau_pix_demurrage_payload BEFORE INSERT OR UPDATE OF status, current_total_brl, pix_payload
ON public.demurrage_invoices FOR EACH ROW EXECUTE FUNCTION public.itau_pix_demurrage_payload();

-- Reserva trabalho para o processador. O prazo em next_attempt_at funciona
-- como lease: outra execução não pega a mesma cobrança enquanto a chamada
-- ao Itaú (timeout de 15 s) está em andamento.
CREATE FUNCTION public.itau_pix_claim(p_limit integer DEFAULT 20)
RETURNS SETOF public.itau_pix_charges LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  UPDATE public.itau_pix_charges c SET attempts = c.attempts + 1, updated_at = now(),
    -- 1, 2, 4… minutos, até 60.
    next_attempt_at = now() + least(power(2, c.attempts), 60) * interval '1 minute'
  WHERE c.id IN (
    SELECT id FROM public.itau_pix_charges
    WHERE status IN ('pending_create', 'pending_cancel') AND next_attempt_at <= now()
    ORDER BY next_attempt_at LIMIT greatest(least(p_limit, 100), 1)
    FOR UPDATE SKIP LOCKED)
  RETURNING c.*;
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_claim(integer) TO service_role;

-- Registra o resultado de uma chamada ao Itaú.
-- p_outcome: active | cancelled | concluded | uncertain | error.
CREATE FUNCTION public.itau_pix_record(p_id bigint, p_outcome text, p_revision integer DEFAULT NULL,
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
    -- Se a fatura mudou durante a chamada, a cobrança já está pending_cancel:
    -- guarda os dados e deixa o cancelamento seguir.
    UPDATE public.itau_pix_charges SET revision = p_revision, pix_copia_e_cola = p_pix_copia_e_cola,
      uncertain = false, last_error = NULL, updated_at = now(),
      status = CASE WHEN status = 'pending_create' THEN 'active' ELSE status END
    WHERE id = p_id RETURNING * INTO v;
    IF v.status = 'active' THEN
      -- O gatilho da fatura recalcula e encontra esta cobrança ativa.
      IF v.invoice_id IS NOT NULL THEN
        UPDATE public.invoices SET pix_payload = v.pix_copia_e_cola WHERE id = v.invoice_id;
        -- Mesmo contrato da 130: a conciliação por extrato resolve o TXID.
        INSERT INTO public.local_pix_charge_versions(invoice_id, txid, amount_brl, payload)
        VALUES (v.invoice_id, v.txid, v.amount_brl, v.pix_copia_e_cola) ON CONFLICT (invoice_id, txid) DO NOTHING;
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
REVOKE ALL ON FUNCTION public.itau_pix_record(bigint, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_record(bigint, text, integer, text, text) TO service_role;

COMMIT;
