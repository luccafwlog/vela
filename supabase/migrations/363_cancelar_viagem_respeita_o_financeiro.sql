-- 363: cancelar a Viagem é recusado com fatura viva ou baixa; os recebíveis
-- sem fatura são anulados (ADR 0093, decisão 14; plano da frente
-- financeira, F-13).
--
-- Problema: `cancel_voyage` (178) selava a Viagem sem olhar o financeiro. A
-- fatura emitida seguia cobrável no Portal, com Pix ativo, mas a baixa era
-- recusada ("operação selada"), e os recebíveis sem fatura continuavam no
-- saldo.
--
-- Não altera nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.cancel_voyage(p_voyage_id bigint, p_reason text, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old_status text; v_blocking text; v_bl text; v_voided integer := 0; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), ''); v_closed integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() OR p_changed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o Administrativo cancela viagem.' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_old_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Viagem % nao encontrada.', p_voyage_id USING ERRCODE = 'P0002'; END IF;
  IF v_old_status = 'cancelled' THEN RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', false); END IF;
  -- ADR 0093, decisão 14 (363): com fatura viva ou baixa em algum B/L, o
  -- Administrativo resolve cada B/L antes.
  SELECT string_agg(DISTINCT x.bl_id || ' (' || x.what || ')', ', ' ORDER BY x.bl_id || ' (' || x.what || ')') INTO v_blocking FROM (
    SELECT b.id AS bl_id, 'fatura ' || coalesce(i.invoice_number, i.id::text) AS what
    FROM public.bls b
    JOIN public.invoices i ON i.bl_id = b.id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = b.id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = i.id AND l.bl_id = b.id AND l.status <> 'obsolete')
    WHERE b.voyage_id = p_voyage_id AND coalesce(i.status, 'issued') NOT IN ('cancelled', 'obsolete')
    UNION ALL
    SELECT b.id, 'Invoice de Demurrage ' || coalesce(d.doc_number, d.id::text)
    FROM public.bls b JOIN public.demurrage_invoices d ON d.bl_id = b.id
    WHERE b.voyage_id = p_voyage_id AND coalesce(d.status, 'issued') NOT IN ('cancelled')
    UNION ALL
    SELECT r.bl_id, 'baixa no recebível'
    FROM public.bl_receivables r JOIN public.bls b ON b.id = r.bl_id
    WHERE b.voyage_id = p_voyage_id AND (r.settled_amount_brl > 0 OR EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id))
  ) x;
  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'A Viagem tem fatura viva ou baixa: %. Resolva cada B/L antes de cancelar a Viagem.', v_blocking
      USING ERRCODE = '22023';
  END IF;

  -- Recebíveis sem fatura saem do saldo.
  FOR v_bl IN SELECT b.id FROM public.bls b WHERE b.voyage_id = p_voyage_id ORDER BY b.id LOOP
    v_voided := v_voided + public._void_unbilled_bl_receivables(v_bl, p_changed_by, 'Cancelamento da Viagem: ' || v_reason);
  END LOOP;

  PERFORM set_config('vela.allow_voyage_cancel', 'on', true);
  UPDATE public.voyages SET status = 'cancelled' WHERE id = p_voyage_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyages', p_voyage_id::text, 'status', v_old_status, 'cancelled', p_changed_by, 'Cancelamento de viagem: ' || v_reason);

  UPDATE public.import_pending_effects AS e
     SET status = 'superseded', lease_until = NULL, leased_by = NULL,
         result = COALESCE(e.result, '{}'::jsonb) || jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', p_voyage_id),
         updated_at = now()
   WHERE e.status IN ('pending', 'retry_wait')
     AND public._import_effect_voyage_id(e.effect_kind, e.entity_id) = p_voyage_id;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', true, 'closed_effects', v_closed, 'voided_receivables', v_voided);
END;
$function$;
