-- 154: leitura de monitoramento das cobranças Itaú para a Conciliação PIX
-- (Fase 5 do plano 2026-10-06-integracao-itau-pix). Só Admin; as tabelas
-- continuam fechadas para `authenticated`. Mostra o que pede atenção:
-- cobranças aguardando o banco (inclusive cancelamento pendente), com resposta
-- incerta ou erro, e recebimentos que não deram baixa automática.
-- Encerramento de Pix em análise (decisão do dono em 2026-10-06): fecha sozinho
-- quando a fatura da cobrança fica paga (baixa manual de exceção); nos demais
-- casos (fatura cancelada a restituir, TXID sem fatura) Admin marca como tratado
-- com motivo. Nos dois casos o Alerta `pix_unreconciled` do recebimento fecha.
-- Aditiva: não reescreve nem apaga linhas existentes.
BEGIN;

ALTER TABLE public.itau_pix_receipts
  DROP CONSTRAINT itau_pix_receipts_status_check,
  ADD CONSTRAINT itau_pix_receipts_status_check CHECK (status IN ('settled', 'review', 'handled')),
  ADD COLUMN handled_at timestamptz,
  ADD COLUMN handled_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN handled_note text;

CREATE FUNCTION public._itau_pix_close_receipt(p_end_to_end_id text, p_note text, p_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.itau_pix_receipts SET status = 'handled', handled_at = now(), handled_by = p_by, handled_note = p_note
  WHERE end_to_end_id = p_end_to_end_id AND status = 'review';
  IF FOUND THEN
    PERFORM public.resolve_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
      'itau_pix', jsonb_build_object('note', p_note));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._itau_pix_close_receipt(text, text, uuid) FROM PUBLIC, anon, authenticated;

-- Fatura paga (por qualquer caminho): os Pix dela em análise ficam tratados.
CREATE FUNCTION public.itau_pix_close_receipts_on_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e2e text;
BEGIN
  FOR v_e2e IN
    SELECT r.end_to_end_id FROM public.itau_pix_receipts r
    JOIN public.itau_pix_charges c ON c.id = r.charge_id
    WHERE r.status = 'review'
      AND CASE WHEN TG_TABLE_NAME = 'invoices' THEN c.invoice_id = NEW.id ELSE c.demurrage_invoice_id = NEW.id END
  LOOP
    PERFORM public._itau_pix_close_receipt(v_e2e, 'Fatura paga por baixa manual.', auth.uid());
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_close_receipts_on_paid() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER itau_pix_close_receipts_on_paid AFTER UPDATE OF status ON public.invoices
FOR EACH ROW WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
EXECUTE FUNCTION public.itau_pix_close_receipts_on_paid();
CREATE TRIGGER itau_pix_close_receipts_on_paid AFTER UPDATE OF status ON public.demurrage_invoices
FOR EACH ROW WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
EXECUTE FUNCTION public.itau_pix_close_receipts_on_paid();

-- Admin encerra um Pix em análise que não se resolve por baixa (ex.: restituição).
CREATE FUNCTION public.itau_pix_mark_receipt_handled(p_end_to_end_id text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao para tratar o Pix Itau.' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_note, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo (mínimo de 5 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id AND status = 'review') THEN
    RAISE EXCEPTION 'Pix Itaú não está em análise.' USING ERRCODE = '22023';
  END IF;
  PERFORM public._itau_pix_close_receipt(p_end_to_end_id, left(btrim(p_note), 500), auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_mark_receipt_handled(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itau_pix_mark_receipt_handled(text, text) TO authenticated;

CREATE FUNCTION public.itau_pix_monitor() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao para monitorar o Pix Itau.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'provider', public._itau_pix_provider(),
    'polled_until', (SELECT itau_pix_polled_until FROM public.app_settings WHERE id = 1),
    'counts', coalesce((SELECT jsonb_object_agg(status, n) FROM (
      SELECT status, count(*) AS n FROM public.itau_pix_charges GROUP BY status) s), '{}'::jsonb),
    -- ponytail: até 200 linhas por lista; paginar se o volume pedir.
    'charges', coalesce((SELECT jsonb_agg(row_to_json(c) ORDER BY c.updated_at) FROM (
      SELECT ch.id, ch.txid, ch.status, ch.uncertain, ch.attempts, ch.last_error, ch.amount_brl,
             ch.next_attempt_at, ch.updated_at,
             CASE WHEN ch.invoice_id IS NOT NULL THEN 'local' ELSE 'demurrage' END AS source,
             coalesce(i.id, d.id) AS invoice_id, coalesce(i.invoice_number, d.doc_number) AS doc_number
      FROM public.itau_pix_charges ch
      LEFT JOIN public.invoices i ON i.id = ch.invoice_id
      LEFT JOIN public.demurrage_invoices d ON d.id = ch.demurrage_invoice_id
      -- Só o que ainda aguarda o banco: cobrança encerrada com erro antigo não pede atenção.
      WHERE ch.status IN ('pending_create', 'pending_update', 'pending_expire_check', 'pending_cancel')
      ORDER BY ch.updated_at LIMIT 200) c), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(row_to_json(r) ORDER BY r.paid_at DESC) FROM (
      SELECT end_to_end_id, txid, amount_brl, paid_at, reason
      FROM public.itau_pix_receipts WHERE status = 'review'
      ORDER BY paid_at DESC LIMIT 200) r), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_monitor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itau_pix_monitor() TO authenticated;

COMMIT;
