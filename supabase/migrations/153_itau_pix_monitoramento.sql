-- 153: leitura de monitoramento das cobranças Itaú para a Conciliação PIX
-- (Fase 5 do plano 2026-10-06-integracao-itau-pix). Só Admin; as tabelas
-- continuam fechadas para `authenticated`. Mostra o que pede atenção:
-- cobranças aguardando o banco (inclusive cancelamento pendente), com resposta
-- incerta ou erro, e recebimentos que não deram baixa automática.
-- Aditiva: só cria uma função de leitura.
BEGIN;

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
      WHERE ch.status IN ('pending_create', 'pending_update', 'pending_expire_check', 'pending_cancel')
         OR ch.uncertain OR ch.last_error IS NOT NULL
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
