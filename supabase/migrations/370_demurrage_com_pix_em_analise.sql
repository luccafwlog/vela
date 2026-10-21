-- 370: Demurrage com Pix em análise não é cobrada de novo (ADR 0093,
-- decisão 17; plano da frente financeira, F-21).
--
-- Problema: o Pix de Demurrage que ia para análise concluía a cobrança, e a
-- sincronização (`_itau_pix_sync`, 153) criava outra; a Régua de Cobrança
-- (`_demurrage_dunning_block_reason`, 313) seguia mandando e-mail.
--
-- Mudança: com recebimento em análise ligado à Invoice, nenhuma cobrança nova
-- é criada e a Régua pausa com o motivo "Pix em análise". Quando o Financeiro
-- trata o recebimento, tudo volta.
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public._demurrage_dunning_block_reason(p_invoice_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT di.id, di.customer_id, di.bl_id, di.status, di.paid_at, di.first_billed_at,
    di.dunning_suspended_reason, di.dispute_open, di.total_usd, di.discount_mode, di.discount_value,
    di.current_roe, c.deactivated_at AS customer_deactivated_at,
    voy.voyage_number, vessel.name AS vessel_name
    INTO r
  FROM public.demurrage_invoices AS di
  JOIN public.customers AS c ON c.id = di.customer_id
  LEFT JOIN public.bls AS b ON b.id = di.bl_id
  LEFT JOIN public.voyages AS voy ON voy.id = b.voyage_id
  LEFT JOIN public.vessels AS vessel ON vessel.id = voy.vessel_id
  WHERE di.id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN 'Invoice não encontrada';
  END IF;

  -- Os textos aparecem na coluna Régua como "Pausada: <motivo>".
  IF r.status = 'cancelled' THEN RETURN 'cancelada'; END IF;
  IF r.paid_at IS NOT NULL OR r.status = 'paid' THEN RETURN 'liquidada'; END IF;
  IF COALESCE(r.status, 'issued') NOT IN ('issued', 'overdue') OR r.first_billed_at IS NULL THEN
    RETURN 'não emitida';
  END IF;
  IF r.dunning_suspended_reason IS NOT NULL THEN RETURN 'suspensa, aguarda tratamento'; END IF;
  IF COALESCE(r.dispute_open, false) THEN RETURN 'disputa aberta'; END IF;
  -- ADR 0093, decisão 17 (370): Pix em análise pausa a Régua até a decisão
  -- do Financeiro.
  IF EXISTS (SELECT 1 FROM public.itau_pix_receipts AS rec JOIN public.itau_pix_charges AS ch ON ch.id = rec.charge_id
             WHERE ch.demurrage_invoice_id = p_invoice_id AND rec.status = 'review') THEN
    RETURN 'Pix em análise';
  END IF;
  -- 1E.3: fatura com 100% de desconto não tem o que cobrar.
  IF public._demurrage_invoice_net_usd(r.total_usd, r.discount_mode, r.discount_value) <= 0 THEN
    RETURN 'valor líquido zero';
  END IF;
  -- 4.4 (D10): só fatura que o Cliente vê no Portal e de Cliente ativo.
  IF r.customer_deactivated_at IS NOT NULL THEN RETURN 'Cliente desativado'; END IF;
  IF NOT public.bl_has_portal_release(r.bl_id) THEN
    RETURN 'B/L sem CE Mercante, a Invoice não aparece no Portal';
  END IF;
  -- O e-mail mostra ROE, navio e viagem por Invoice; sem eles não se compõe.
  IF r.current_roe IS NULL OR r.current_roe <= 0 THEN RETURN 'Invoice sem ROE vigente'; END IF;
  IF NULLIF(btrim(COALESCE(r.voyage_number, '')), '') IS NULL OR NULLIF(btrim(COALESCE(r.vessel_name, '')), '') IS NULL THEN
    RETURN 'B/L sem navio ou viagem';
  END IF;
  -- 1E.6: o mesmo critério de destinatário do envio.
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_contacts AS cc
    WHERE cc.customer_id = r.customer_id
      AND cc.deactivated_at IS NULL
      AND public.customer_communication_recipient_allowed(r.customer_id, cc.id, 'cobranca_demurrage', 'caixa', NULL)
  ) THEN
    RETURN 'Cliente sem contato autorizado para a cobrança';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._itau_pix_sync(p_invoice_id bigint, p_demurrage_invoice_id bigint, p_amount_brl numeric, p_payable boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_open public.itau_pix_charges%ROWTYPE; v_cutoff timestamptz;
BEGIN
  -- ADR 0093, decisão 17 (370): com Pix em análise ligado à Invoice de
  -- Demurrage, não se cria QR novo; o valor fica no saldo até a decisão.
  IF p_demurrage_invoice_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.itau_pix_receipts AS rec JOIN public.itau_pix_charges AS ch ON ch.id = rec.charge_id
    WHERE ch.demurrage_invoice_id = p_demurrage_invoice_id AND rec.status = 'review') THEN
    RETURN NULL;
  END IF;
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
          -- Mesma regra da 151: não encurta a reserva de uma chamada em andamento.
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
$function$;
