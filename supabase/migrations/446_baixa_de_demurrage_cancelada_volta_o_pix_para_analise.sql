-- 446: cancelar a baixa de uma Invoice de Demurrage feita pelo Pix do Itaú
-- devolve o Pix para análise, como já acontecia com a fatura de Taxas Locais e
-- a avulsa (`reverse_invoice_payment`, migrations 376 e 385). Achado na revisão
-- da PR luccafwlog/vela#1052 (ADR 0100), antes da publicação.
--
-- Antes, `reverse_demurrage_payment` voltava a Invoice a emitida e limpava o
-- `pix_txid`, mas o recebimento do Itaú seguia "baixado": não aparecia em Pix
-- em análise, a consulta não o baixava de novo e a aba Pix recebidos (444) o
-- mostrava "Sem baixa" sem oferecer a baixa, que é só para Pix que não é de
-- cobrança do Vela. Agora o recebimento baixado (pelo TXID da cobrança, como a
-- baixa automática grava) ou tratado com o identificador do Pix vira 'review'
-- com o motivo do cancelamento, e o Alerta `pix_unreconciled` abre, com o mesmo
-- texto da fatura local. O Pix recebido baixado pela aba (status 'received')
-- volta a "Sem baixa", sem Alerta (ADR 0100, item 5).
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 241.

CREATE OR REPLACE FUNCTION public.reverse_demurrage_payment(p_invoice_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
  v_old_status TEXT;
  v_pix_txid TEXT;
  v_e2e TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT status, NULLIF(btrim(pix_txid), '') INTO v_old_status, v_pix_txid
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_status, '') <> 'paid' THEN
    RAISE EXCEPTION 'Demurrage invoice % nao esta paga (status=%).', p_invoice_id, COALESCE(v_old_status, '?')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.demurrage_invoices
  SET
    status = 'issued',
    paid_at = NULL,
    pix_txid = NULL,
    conciliated_by_extract = false
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'demurrage_invoice',
    p_invoice_id::TEXT,
    'payment_reversed',
    v_old_status,
    'issued',
    v_actor,
    now(),
    TRIM(p_reason)
  );

  -- Baixa automática Itaú cancelada: o Pix volta para análise do Financeiro.
  -- A baixa automática grava o TXID da cobrança; a manual, o identificador do Pix.
  IF v_pix_txid IS NOT NULL THEN
    SELECT r.end_to_end_id INTO v_e2e
    FROM public.itau_pix_receipts r
    WHERE (upper(r.end_to_end_id) = upper(v_pix_txid) AND r.status IN ('settled', 'handled'))
       OR (r.status = 'settled' AND public._itau_pix_origin(v_pix_txid) = 'vela'
           AND public.normalize_pix_txid(r.txid) = public.normalize_pix_txid(v_pix_txid))
    ORDER BY r.created_at DESC
    LIMIT 1;
    IF v_e2e IS NOT NULL THEN
      UPDATE public.itau_pix_receipts
      SET status = 'review', reason = 'Baixa cancelada: ' || btrim(p_reason),
          handled_at = NULL, handled_by = NULL, handled_note = NULL
      WHERE end_to_end_id = v_e2e;
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', v_e2e,
        'A baixa automática do Pix ' || v_e2e || ' foi cancelada (' || btrim(p_reason) || '): dê a baixa na fatura certa ou registre a devolução.',
        'itau_pix', 'administrativo', jsonb_build_object('end_to_end_id', v_e2e, 'demurrage_invoice_id', p_invoice_id), '/reconciliacao');
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'new_status', 'issued'
  );
END;
$function$;
