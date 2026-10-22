-- 415: o resultado do Itaú só ativa a cobrança na versão que foi enviada
-- (auditoria de segurança run-3, achado C7).
--
-- Problema: itau_pix_record (153) marcava 'active' qualquer cobrança em
-- pending_create ou pending_update ao fim da chamada ao Itaú, mesmo quando o
-- valor ou a validade mudaram durante a chamada (_itau_pix_sync, 370, altera a
-- MESMA linha e mantém a reserva). O valor novo nunca chegava ao banco: o QR
-- cobrava o valor antigo, a fatura e o Portal mostravam o novo, e o monitor das
-- 14h não acusava.
--
-- Mudança: itau_pix_charges.change_version, somado por gatilho a cada mudança
-- de amount_brl ou expiration_seconds; o runner devolve a versão que reservou
-- (p_claimed_version) e, se ela mudou, a linha fica pending_update com
-- next_attempt_at = now(), para a versão nova seguir na mesma execução.
-- Publicação: migration antes das Edge Functions (o parâmetro novo é opcional;
-- sem ele, o comportamento é o de antes).
-- Não reescreve nem apaga linhas (coluna nova com default).
-- Rollback: recriar itau_pix_record da 153 e remover gatilho e coluna.

ALTER TABLE public.itau_pix_charges ADD COLUMN change_version bigint NOT NULL DEFAULT 0;

CREATE FUNCTION public._itau_pix_charge_bump_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.amount_brl IS DISTINCT FROM OLD.amount_brl
     OR NEW.expiration_seconds IS DISTINCT FROM OLD.expiration_seconds THEN
    NEW.change_version := OLD.change_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._itau_pix_charge_bump_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER itau_pix_charge_bump_version BEFORE UPDATE OF amount_brl, expiration_seconds
  ON public.itau_pix_charges FOR EACH ROW EXECUTE FUNCTION public._itau_pix_charge_bump_version();
-- itau_pix_claim (219) devolve c.*: a linha reservada já traz change_version.
-- Corpo da itau_pix_record igual ao da 153, salvo o CASE do status.

DROP FUNCTION public.itau_pix_record(bigint, text, integer, text, text, timestamptz);
CREATE FUNCTION public.itau_pix_record(p_id bigint, p_outcome text, p_revision integer DEFAULT NULL,
  p_pix_copia_e_cola text DEFAULT NULL, p_error text DEFAULT NULL, p_bank_created_at timestamptz DEFAULT NULL,
  p_claimed_version bigint DEFAULT NULL)
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
      status = CASE
        -- 415: valor ou validade mudaram durante a chamada: enviar a versão nova
        -- (depois da criação, como alteração da cobrança já criada).
        WHEN status IN ('pending_create', 'pending_update') AND p_claimed_version IS NOT NULL
          AND change_version <> p_claimed_version THEN 'pending_update'
        WHEN status IN ('pending_create', 'pending_update', 'pending_expire_check') THEN 'active'
        ELSE status END
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
REVOKE ALL ON FUNCTION public.itau_pix_record(bigint, text, integer, text, text, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_record(bigint, text, integer, text, text, timestamptz, bigint) TO service_role;
