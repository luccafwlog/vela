-- 128: a correção do B/L é sempre automática (ADR 0077, decisões do dono em
-- 2026-10-02). Não reescreve nem apaga linhas existentes.
--
-- 1. Não há mais Cancelar e reemitir manual nem Correção após pagamento com
--    valor digitado: as RPCs `cancel_invoice_for_reissue` e
--    `register_invoice_correction` saem; o sistema usa os núcleos abaixo.
-- 2. Qualquer mudança efetiva na base faturada de um B/L com fatura de Taxas
--    Locais viva — reimportação, Baplie ou alteração direta no B/L, nos
--    containers ou nos veículos — é tratada no fim da transação:
--    - sem pagamento: cancela a individual e a consolidada e reemite as duas
--      (ROE do dia); a consolidada é recriada uma única vez, mesmo quando
--      vários B/Ls dela mudam juntos, e só se continuar com os mesmos B/Ls;
--    - com pagamento e valor menor: abate o saldo aberto e, se passar dele,
--      registra a restituição e abre o alerta Restituição pendente, que fecha
--      quando a restituição é confirmada;
--    - com pagamento e valor maior: alerta Fatura desatualizada (avulsa).
--    A comparação usa só o que o motor de taxas lê (inclui SOC/COC, peso de
--    carga solta e movimentação), e a reemissão só acontece se o valor do B/L
--    mudar com o ROE em que foi faturado ou se o Cliente mudar.
-- 3. A consolidada que já não pode sair com os mesmos B/Ls (B/L cancelado,
--    isento, quitado pela individual ou de outro Cliente) é encerrada sem
--    reemissão e sai da Reemissão pendente. A individual de B/L cancelado ou
--    isento também. Fatura cancelada não mantém Fatura desatualizada aberta.
-- 4. O efeito de veículos cancela a consolidada do B/L isento junto com a
--    individual (a `126` recusava e o efeito ficava bloqueado).
-- 5. Portal: sem filtro, a lista de faturas não mostra canceladas.
-- 6. Os gatilhos da `124` que comparavam a linha inteira do container (e
--    alertavam a cada data de Demurrage) saem; o novo mecanismo os substitui.

-- ---------------------------------------------------------------------------
-- 0. Fim do caminho manual
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_invoice_for_reissue(bigint, text, text[]);
DROP FUNCTION IF EXISTS public.register_invoice_correction(bigint, bigint, numeric, text);

DROP TRIGGER IF EXISTS track_stale_invoice_on_bl_change ON public.bls;
DROP TRIGGER IF EXISTS track_stale_invoice_on_container_change ON public.bl_containers;
DROP TRIGGER IF EXISTS track_stale_invoice_on_vehicle_change ON public.vehicles;
DROP FUNCTION IF EXISTS public.track_stale_invoice_on_bl_change();
DROP FUNCTION IF EXISTS public.track_stale_invoice_on_cargo_change();

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS reissue_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reissue_closed_reason text;
COMMENT ON COLUMN public.invoices.reissue_closed_at IS
  'Fatura cancelada para reemissão que não será reemitida (B/L cancelado, isento ou consolidada com outros B/Ls).';

INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('restituicao_pendente', 'normal', 'administrativo', ARRAY['administrativo'], '/taxas-locais');

-- ---------------------------------------------------------------------------
-- 1. Base faturada do B/L: o que o motor de taxas lê
-- ---------------------------------------------------------------------------
-- ponytail: o rateio de container compartilhado entre B/Ls da mesma viagem
-- não entra; mudar o container de um B/L não reavalia o vizinho. Se isso virar
-- caso real, capturar também os B/Ls que compartilham o container.
CREATE OR REPLACE FUNCTION public.bl_invoice_basis_snapshot(p_bl_id text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'voyage_id', b.voyage_id, 'pod', b.pod, 'cargo_mode', b.cargo_mode, 'customer_id', b.customer_id,
    'bb_weight_ton', b.bb_weight_ton, 'total_weight_kg', b.total_weight_kg, 'movement_to', b.movement_to,
    'cancelled', b.cancelled_at IS NOT NULL,
    'containers', (SELECT coalesce(jsonb_agg(x.c ORDER BY x.c::text), '[]'::jsonb) FROM (
      SELECT jsonb_build_array(upper(btrim(c.container_number)), coalesce(c.is_imo, false), coalesce(c.is_oog, false),
        coalesce(c.ownership, 'COC')) AS c
      FROM public.bl_containers c WHERE c.bl_id = b.id) x),
    'vehicles', (SELECT coalesce(jsonb_agg(v.chassis ORDER BY v.chassis), '[]'::jsonb) FROM public.vehicles v WHERE v.bl_id = b.id))
  FROM public.bls b WHERE b.id = p_bl_id;
$$;
REVOKE ALL ON FUNCTION public.bl_invoice_basis_snapshot(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._live_local_invoice_ids_for_bl(p_bl_id text) RETURNS bigint[]
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT inv.id ORDER BY inv.id), ARRAY[]::bigint[])
  FROM public.invoices inv
  WHERE inv.invoice_type IN ('individual', 'consolidated')
    AND coalesce(inv.status, 'issued') IN ('draft', 'issued', 'overdue', 'partially_paid', 'paid')
    AND (EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = inv.id AND ib.bl_id = p_bl_id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id AND l.bl_id = p_bl_id
        AND l.status IN ('active', 'settled_by_this_invoice')));
$$;
REVOKE ALL ON FUNCTION public._live_local_invoice_ids_for_bl(text) FROM PUBLIC, anon, authenticated;

-- Valor do B/L como o cálculo daria agora, sem gravar nada. USD converte pelo
-- ROE informado (o congelado no recebível), para isolar a mudança do B/L.
-- ponytail: repete as checagens de isenção e revisão de
-- _calculate_bl_local_charges_impl_106; ao mexer lá, mexer aqui.
CREATE OR REPLACE FUNCTION public._quote_bl_local_charges(p_bl_id text, p_roe numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_bl record;
  v_total numeric(14,2) := 0;
  v_review text;
  v_usd boolean := false;
  v_manual numeric(14,2);
  v_manual_usd boolean;
  item record;
BEGIN
  SELECT b.id, coalesce(b.cargo_mode, 'container') AS cargo_mode, b.pod, b.movement_to INTO v_bl
  FROM public.bls b WHERE b.id = p_bl_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'review', 'reason', 'B/L nao encontrado');
  END IF;

  IF v_bl.cargo_mode = 'container' AND EXISTS (SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
     AND (upper(btrim(coalesce(v_bl.movement_to, ''))) LIKE '%LCL%' OR upper(btrim(coalesce(v_bl.movement_to, ''))) LIKE '%CFS%') THEN
    RETURN jsonb_build_object('status', 'exempt', 'total_brl', 0);
  END IF;
  IF v_bl.cargo_mode IN ('container', 'misto') AND EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = p_bl_id AND coalesce(is_imo, false) AND coalesce(is_oog, false)) THEN
    v_review := 'Container com IMO e OOG ao mesmo tempo exige revisao manual de THD';
  ELSIF v_bl.cargo_mode = 'container' AND NOT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = p_bl_id AND btrim(coalesce(container_number, '')) <> '') THEN
    v_review := 'B/L de container sem containers cadastrados';
  END IF;

  FOR item IN SELECT * FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) LOOP
    IF item.status = 'review_required' THEN
      v_review := coalesce(v_review, item.review_reason, 'Linha que precisa de revisao');
      CONTINUE;
    END IF;
    IF item.total_value_brl IS NULL AND coalesce(item.total_value_usd, 0) > 0 THEN v_usd := true; END IF;
    v_total := v_total + coalesce(item.total_value_brl, round(coalesce(item.total_value_usd, 0) * coalesce(p_roe, 0), 2));
  END LOOP;

  -- Linhas manuais do B/L sobrevivem ao recálculo.
  SELECT coalesce(sum(coalesce(cc.total_value_brl, round(coalesce(cc.total_value_usd, 0) * coalesce(p_roe, 0), 2))), 0),
    coalesce(bool_or(cc.total_value_brl IS NULL AND coalesce(cc.total_value_usd, 0) > 0), false)
  INTO v_manual, v_manual_usd
  FROM public.charge_calculations cc
  WHERE cc.bl_id = p_bl_id AND cc.source = 'manual'
    AND coalesce(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');
  v_total := v_total + v_manual;
  v_usd := v_usd OR v_manual_usd;

  IF v_review IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'review', 'reason', v_review);
  END IF;
  IF v_usd AND coalesce(p_roe, 0) <= 0 THEN
    RETURN jsonb_build_object('status', 'review', 'reason', 'Cambio (ROE) nao configurado');
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'total_brl', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public._quote_bl_local_charges(text, numeric) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Correção com pagamento: núcleo do sistema (sem papel do chamador)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._register_invoice_correction_core(
  p_invoice_id bigint, p_receivable_id bigint, p_corrected_total_brl numeric, p_reason text, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_invoice record; v_receivable record; v_difference numeric; v_offset numeric;
  v_refund numeric; v_refund_id bigint; v_id bigint; v_link record; v_balance numeric; v_available numeric;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  SELECT * INTO v_receivable FROM public.bl_receivables WHERE id = p_receivable_id FOR UPDATE;
  v_difference := round(v_receivable.original_amount_brl - v_receivable.correction_amount_brl - p_corrected_total_brl, 2);
  IF v_difference <= 0 THEN
    RAISE EXCEPTION 'Correcao exige valor menor que a cobranca vigente.' USING ERRCODE = '22023';
  END IF;
  v_offset := least(v_difference, v_receivable.balance_brl);
  v_refund := v_difference - v_offset;
  IF v_refund > 0 THEN
    SELECT coalesce(v_invoice.total_paid_brl, 0) - coalesce(sum(amount_brl), 0) INTO v_available
    FROM public.invoice_refunds WHERE invoice_id = p_invoice_id AND status <> 'cancelled';
    IF v_refund > v_available THEN
      RAISE EXCEPTION 'Restituicao excede o total pago disponivel (%).', v_available USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.invoice_refunds(invoice_id, amount_brl, origin, notes, registered_by)
      VALUES (p_invoice_id, v_refund, 'correction', btrim(p_reason), p_actor) RETURNING id INTO v_refund_id;
  END IF;
  INSERT INTO public.invoice_corrections(invoice_id, receivable_id, amount_brl, offset_brl, refund_brl,
    corrected_total_brl, reason, created_by) VALUES (p_invoice_id, p_receivable_id, v_difference, v_offset,
    v_refund, round(p_corrected_total_brl, 2), btrim(p_reason), p_actor) RETURNING id INTO v_id;
  UPDATE public.bl_receivables SET correction_amount_brl = correction_amount_brl + v_difference,
    updated_at = now() WHERE id = p_receivable_id;
  -- Fatura que zera sem ter recebido nada fica coberta pela que recebeu.
  FOR v_link IN SELECT DISTINCT i.id FROM public.invoices i JOIN public.invoice_receivable_links l ON l.invoice_id = i.id
    WHERE l.receivable_id = p_receivable_id AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid') ORDER BY i.id
  LOOP
    SELECT coalesce(sum(br.balance_brl), 0) INTO v_balance FROM public.invoice_receivable_links l
      JOIN public.bl_receivables br ON br.id = l.receivable_id WHERE l.invoice_id = v_link.id
      AND l.status IN ('active', 'settled_by_this_invoice');
    UPDATE public.invoices SET balance_brl = v_balance,
      status = CASE WHEN v_balance = 0 AND coalesce(total_paid_brl, 0) = 0 AND id <> p_invoice_id THEN 'covered'
        WHEN v_balance = 0 THEN 'paid' WHEN total_paid_brl > 0 THEN 'partially_paid' ELSE status END,
      covered_by_invoice_id = CASE WHEN v_balance = 0 AND coalesce(total_paid_brl, 0) = 0 AND id <> p_invoice_id
        THEN p_invoice_id ELSE covered_by_invoice_id END
      WHERE id = v_link.id;
  END LOOP;
  UPDATE public.invoice_receivable_links SET status = 'settled_by_this_invoice'
    WHERE invoice_id = p_invoice_id AND receivable_id = p_receivable_id AND v_receivable.balance_brl - v_offset = 0;
  UPDATE public.invoice_receivable_links SET status = 'settled_elsewhere'
    WHERE invoice_id <> p_invoice_id AND receivable_id = p_receivable_id AND status = 'active' AND v_receivable.balance_brl - v_offset = 0;
  UPDATE public.bls SET financial_status = 'paid'
    WHERE id = v_receivable.bl_id AND v_receivable.balance_brl - v_offset = 0;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'correction', jsonb_build_object('correction_id', v_id,
      'offset_brl', v_offset, 'refund_brl', v_refund, 'refund_id', v_refund_id)::text, p_actor, btrim(p_reason));
  RETURN jsonb_build_object('correction_id', v_id, 'offset_brl', v_offset, 'refund_brl', v_refund,
    'refund_id', v_refund_id, 'balance_brl', greatest(v_receivable.balance_brl - v_offset, 0));
END;
$$;
REVOKE ALL ON FUNCTION public._register_invoice_correction_core(bigint, bigint, numeric, text, uuid) FROM PUBLIC, anon, authenticated;

-- Restituição pendente: um alerta por fatura, com o total ainda a devolver.
CREATE OR REPLACE FUNCTION public._sync_refund_alert(p_invoice_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pending numeric; v_number text; v_bls text;
BEGIN
  SELECT coalesce(sum(r.amount_brl), 0) INTO v_pending FROM public.invoice_refunds r
  WHERE r.invoice_id = p_invoice_id AND r.origin = 'correction' AND r.status = 'pending';
  IF v_pending > 0 THEN
    SELECT invoice_number INTO v_number FROM public.invoices WHERE id = p_invoice_id;
    SELECT string_agg(DISTINCT br.bl_id, ', ') INTO v_bls FROM public.invoice_corrections c
      JOIN public.bl_receivables br ON br.id = c.receivable_id WHERE c.invoice_id = p_invoice_id;
    PERFORM public.upsert_alert_item('restituicao_pendente', 'invoice', p_invoice_id::text,
      'Restitua R$ ' || to_char(v_pending, 'FM999G999G990D00') || ' ao Cliente: a correcao do B/L ' || coalesce(v_bls, '')
        || ' reduziu a fatura ' || coalesce(v_number, p_invoice_id::text) || ' depois do pagamento. Confirme a restituicao quando o dinheiro for devolvido.',
      'invoice_correction', 'administrativo',
      jsonb_build_object('invoice_id', p_invoice_id, 'bl_id', v_bls, 'pending_brl', v_pending),
      '/taxas-locais?invoice=' || p_invoice_id);
  ELSE
    PERFORM public.resolve_alert_item('restituicao_pendente', 'invoice', p_invoice_id::text, 'refund_settled', '{}'::jsonb);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._sync_refund_alert(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_refund_alert_on_refund_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.origin = 'correction' THEN PERFORM public._sync_refund_alert(NEW.invoice_id); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_refund_alert_on_refund_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sync_refund_alert_on_refund_change ON public.invoice_refunds;
CREATE TRIGGER sync_refund_alert_on_refund_change AFTER INSERT OR UPDATE OF status ON public.invoice_refunds
  FOR EACH ROW EXECUTE FUNCTION public.sync_refund_alert_on_refund_change();

-- ---------------------------------------------------------------------------
-- 3. Reemissão pendente: encerramento e consolidada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._close_pending_reissue(p_invoice_id bigint, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.invoices SET reissue_closed_at = now(), reissue_closed_reason = p_reason
  WHERE id = p_invoice_id AND status = 'cancelled' AND reissue_requested_at IS NOT NULL AND reissue_closed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = p_invoice_id);
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text, 'reissue_closed',
    jsonb_build_object('reason', p_reason));
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'reissue_closed', 'closed', auth.uid(), p_reason);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._close_pending_reissue(bigint, text) FROM PUBLIC, anon, authenticated;

-- A consolidada só volta com os mesmos B/Ls. Espera enquanto a individual de
-- algum deles está em Reemissão pendente; encerra se algum já não cabe.
CREATE OR REPLACE FUNCTION public._try_recreate_consolidated(p_invoice_id bigint, p_actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_inv record; v_ids bigint[]; v_mismatch text; v_waiting text;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_inv.invoice_type IS DISTINCT FROM 'consolidated' OR v_inv.status IS DISTINCT FROM 'cancelled'
     OR v_inv.reissue_requested_at IS NULL OR v_inv.reissue_closed_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = p_invoice_id) THEN
    RETURN 'not_pending';
  END IF;

  SELECT array_agg(l.receivable_id ORDER BY l.receivable_id) INTO v_ids
  FROM public.invoice_receivable_links l WHERE l.invoice_id = p_invoice_id;

  SELECT string_agg(x.bl_id || ': ' || x.reason, '; ' ORDER BY x.bl_id) INTO v_mismatch FROM (
    SELECT br.bl_id, CASE
      WHEN b.cancelled_at IS NOT NULL THEN 'B/L cancelado'
      WHEN br.customer_id IS DISTINCT FROM v_inv.customer_id THEN 'B/L passou para outro Cliente'
      WHEN br.status NOT IN ('open', 'partially_settled') OR br.balance_brl <= 0 THEN 'sem saldo a cobrar (quitado ou isento)'
    END AS reason
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables br ON br.id = l.receivable_id
    JOIN public.bls b ON b.id = br.bl_id
    WHERE l.invoice_id = p_invoice_id) x
  WHERE x.reason IS NOT NULL;
  IF v_mismatch IS NOT NULL THEN
    PERFORM public._close_pending_reissue(p_invoice_id, 'Consolidada nao reemitida: os B/Ls ja nao sao os mesmos (' || v_mismatch || ').');
    RETURN 'closed';
  END IF;

  SELECT string_agg(DISTINCT ib.bl_id, ', ') INTO v_waiting
  FROM public.invoice_receivable_links l
  JOIN public.invoice_bls ib ON ib.bl_id = l.bl_id
  JOIN public.invoices i ON i.id = ib.invoice_id
  WHERE l.invoice_id = p_invoice_id AND i.invoice_type = 'individual' AND i.status = 'cancelled'
    AND i.reissue_requested_at IS NOT NULL AND i.reissue_closed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.invoice_bls ib2 JOIN public.invoices i2 ON i2.id = ib2.invoice_id
      WHERE ib2.bl_id = ib.bl_id AND i2.invoice_type = 'individual'
        AND coalesce(i2.status, 'issued') IN ('draft', 'issued', 'overdue', 'partially_paid', 'paid', 'covered'));
  IF v_waiting IS NOT NULL THEN
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text,
      'Consolidada ' || v_inv.invoice_number || ' cancelada para correcao; volta sozinha quando sair a fatura individual do B/L ' || v_waiting || '.',
      'invoice_reissue', 'administrativo', jsonb_build_object('invoice_id', p_invoice_id, 'bl_id', v_waiting, 'auto_reissue', 'waiting'),
      '/taxas-locais?invoice=' || p_invoice_id);
    RETURN 'waiting';
  END IF;

  IF p_actor IS NULL THEN RETURN 'pending'; END IF;
  BEGIN
    PERFORM public.create_local_consolidated_invoice_core(v_inv.customer_id, v_ids, p_actor, 'internal');
    RETURN 'reissued';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text,
      'Consolidada ' || v_inv.invoice_number || ' cancelada para correcao, mas a nova emissao nao saiu (' || SQLERRM
        || '). Resolva o motivo e use Tentar reemitir em Reemissao pendente.',
      'invoice_reissue', 'administrativo', jsonb_build_object('invoice_id', p_invoice_id, 'auto_reissue', 'pending', 'reason', SQLERRM),
      '/taxas-locais?invoice=' || p_invoice_id);
    RETURN 'pending';
  END;
END;
$$;
REVOKE ALL ON FUNCTION public._try_recreate_consolidated(bigint, uuid) FROM PUBLIC, anon, authenticated;

-- Tentar reemitir (Administrativo): consolidada pendente cuja trava foi resolvida.
CREATE OR REPLACE FUNCTION public.retry_pending_consolidated_reissue(p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  v_status := public._try_recreate_consolidated(p_invoice_id, auth.uid());
  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', v_status,
    'replaced_by', (SELECT id FROM public.invoices WHERE replaces_invoice_id = p_invoice_id));
END;
$$;
REVOKE ALL ON FUNCTION public.retry_pending_consolidated_reissue(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_pending_consolidated_reissue(bigint) TO authenticated;

-- A individual reemitida (automática ou por Emitir fatura) puxa a consolidada.
CREATE OR REPLACE FUNCTION public.recreate_consolidated_after_individual() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = NEW.invoice_id AND invoice_type = 'individual'
      AND coalesce(status, 'issued') <> 'cancelled') THEN
    RETURN NEW;
  END IF;
  FOR v_id IN
    SELECT DISTINCT inv.id FROM public.invoice_receivable_links l JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = NEW.receivable_id AND inv.invoice_type = 'consolidated' AND inv.status = 'cancelled'
      AND inv.reissue_requested_at IS NOT NULL AND inv.reissue_closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
    ORDER BY inv.id
  LOOP
    PERFORM public._try_recreate_consolidated(v_id, auth.uid());
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.recreate_consolidated_after_individual() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS recreate_consolidated_after_individual ON public.invoice_receivable_links;
CREATE TRIGGER recreate_consolidated_after_individual AFTER INSERT ON public.invoice_receivable_links
  FOR EACH ROW EXECUTE FUNCTION public.recreate_consolidated_after_individual();

-- B/L cancelado ou isento: nada a reemitir para ele.
CREATE OR REPLACE FUNCTION public.close_pending_reissue_on_bl_end() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; v_reason text;
BEGIN
  IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN
    v_reason := 'Nao reemitida: B/L ' || NEW.id || ' cancelado.';
  ELSIF NEW.charge_status = 'exempt' AND OLD.charge_status IS DISTINCT FROM 'exempt' THEN
    v_reason := 'Nao reemitida: B/L ' || NEW.id || ' isento de Taxas Locais.';
  ELSE
    RETURN NEW;
  END IF;
  FOR v_id IN SELECT DISTINCT i.id FROM public.invoice_bls ib JOIN public.invoices i ON i.id = ib.invoice_id
    WHERE ib.bl_id = NEW.id AND i.invoice_type = 'individual' LOOP
    PERFORM public._close_pending_reissue(v_id, v_reason);
  END LOOP;
  FOR v_id IN SELECT DISTINCT i.id FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
    WHERE l.bl_id = NEW.id AND i.invoice_type = 'consolidated' AND i.status = 'cancelled' AND i.reissue_closed_at IS NULL LOOP
    PERFORM public._try_recreate_consolidated(v_id, auth.uid());
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.close_pending_reissue_on_bl_end() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS close_pending_reissue_on_bl_end ON public.bls;
CREATE TRIGGER close_pending_reissue_on_bl_end AFTER UPDATE OF cancelled_at, charge_status ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.close_pending_reissue_on_bl_end();

-- Fatura cancelada não fica com Fatura desatualizada aberta. A reemissão
-- automática travada reabre o alerta depois do cancelamento, com o motivo.
CREATE OR REPLACE FUNCTION public.resolve_stale_invoice_on_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', NEW.id::text, 'invoice_cancelled', '{}'::jsonb);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_stale_invoice_on_cancel() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS resolve_stale_invoice_on_cancel ON public.invoices;
CREATE TRIGGER resolve_stale_invoice_on_cancel AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.resolve_stale_invoice_on_cancel();

-- A sucessora não aponta para fatura encerrada sem reemissão.
CREATE OR REPLACE FUNCTION public.link_reissued_invoice() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new record;
  v_previous bigint;
BEGIN
  SELECT id, invoice_type, status, replaces_invoice_id INTO v_new
  FROM public.invoices WHERE id = NEW.invoice_id;

  IF NOT FOUND OR v_new.replaces_invoice_id IS NOT NULL
     OR COALESCE(v_new.status, 'issued') = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'invoice_bls' THEN
    IF COALESCE(v_new.invoice_type, 'individual') <> 'individual' THEN
      RETURN NEW;
    END IF;
    SELECT inv.id INTO v_previous
    FROM public.invoice_bls ib
    JOIN public.invoices inv ON inv.id = ib.invoice_id
    WHERE ib.bl_id = NEW.bl_id
      AND inv.id <> NEW.invoice_id
      AND inv.invoice_type = 'individual'
      AND inv.status = 'cancelled'
      AND inv.reissue_requested_at IS NOT NULL
      AND inv.reissue_closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
    ORDER BY inv.reissue_requested_at DESC, inv.id DESC
    LIMIT 1;
  ELSE
    IF v_new.invoice_type IS DISTINCT FROM 'consolidated' THEN
      RETURN NEW;
    END IF;
    SELECT inv.id INTO v_previous
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = NEW.receivable_id
      AND inv.id <> NEW.invoice_id
      AND inv.invoice_type = 'consolidated'
      AND inv.status = 'cancelled'
      AND inv.reissue_requested_at IS NOT NULL
      AND inv.reissue_closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
    ORDER BY inv.reissue_requested_at DESC, inv.id DESC
    LIMIT 1;
  END IF;

  IF v_previous IS NOT NULL THEN
    UPDATE public.invoices SET replaces_invoice_id = v_previous WHERE id = NEW.invoice_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.link_reissued_invoice() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_pending_reissues()
RETURNS TABLE(
  invoice_id bigint,
  invoice_number text,
  invoice_type text,
  customer_id bigint,
  customer_name text,
  cancelled_at timestamptz,
  cancel_reason text,
  bl_ids text[],
  receivable_ids bigint[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    inv.id,
    inv.invoice_number,
    inv.invoice_type,
    inv.customer_id,
    c.name,
    inv.cancelled_at,
    inv.cancel_reason,
    CASE WHEN inv.invoice_type = 'consolidated'
      THEN (SELECT COALESCE(ARRAY_AGG(DISTINCT l.bl_id ORDER BY l.bl_id), ARRAY[]::text[]) FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id)
      ELSE (SELECT COALESCE(ARRAY_AGG(DISTINCT ib.bl_id ORDER BY ib.bl_id), ARRAY[]::text[]) FROM public.invoice_bls ib WHERE ib.invoice_id = inv.id)
    END,
    (SELECT COALESCE(ARRAY_AGG(DISTINCT l.receivable_id ORDER BY l.receivable_id), ARRAY[]::bigint[]) FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id)
  FROM public.invoices inv
  LEFT JOIN public.customers c ON c.id = inv.customer_id
  WHERE inv.status = 'cancelled'
    AND inv.reissue_requested_at IS NOT NULL
    AND inv.reissue_closed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
  ORDER BY inv.cancelled_at DESC NULLS LAST, inv.id DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_pending_reissues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_reissues() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_invoice_reissue_links(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice record;
  v_replaces jsonb;
  v_replaced_by jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT id, status, replaces_invoice_id, reissue_requested_at, reissue_closed_at, reissue_closed_reason INTO v_invoice
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object('id', p.id, 'invoice_number', p.invoice_number) INTO v_replaces
  FROM public.invoices p WHERE p.id = v_invoice.replaces_invoice_id;

  SELECT jsonb_build_object('id', s.id, 'invoice_number', s.invoice_number) INTO v_replaced_by
  FROM public.invoices s WHERE s.replaces_invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'replaces', v_replaces,
    'replaced_by', v_replaced_by,
    'reissue_pending', v_invoice.reissue_requested_at IS NOT NULL AND v_invoice.reissue_closed_at IS NULL AND v_replaced_by IS NULL,
    'reissue_closed_reason', v_invoice.reissue_closed_reason
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_invoice_reissue_links(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_reissue_links(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Aplicar as mudanças de base: reemissão, correção ou alerta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clear_post_billing_hold(p_bl_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- A mutação de carga em B/L faturado (062) marca "revisar e refaturar"; a
  -- reemissão ou a correção é esse refaturamento.
  -- ponytail: reconhece a marca pelo texto gravado pela 062.
  UPDATE public.bls SET review_status = 'ok', billing_hold_reason = NULL
  WHERE id = p_bl_id AND review_status = 'pending_review'
    AND billing_hold_reason LIKE 'Carga % após faturamento;%'
    AND coalesce(cardinality(public.compute_bl_review_pendencies(p_bl_id)), 0) = 0;
END;
$$;
REVOKE ALL ON FUNCTION public._clear_post_billing_hold(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._apply_paid_basis_change(
  p_bl_id text, p_receivable_id bigint, p_quote jsonb, p_customer_changed boolean, p_source text, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_receivable record; v_current numeric; v_new numeric; v_invoice bigint; v_result jsonb; v_guidance text;
BEGIN
  SELECT * INTO v_receivable FROM public.bl_receivables WHERE id = p_receivable_id;
  v_current := v_receivable.original_amount_brl - v_receivable.correction_amount_brl;
  IF p_customer_changed THEN
    v_guidance := 'customer_changed';
  ELSIF p_quote->>'status' = 'review' THEN
    v_guidance := 'review: ' || coalesce(p_quote->>'reason', '');
  ELSE
    v_new := (p_quote->>'total_brl')::numeric;
    IF v_new > v_current THEN v_guidance := 'increase'; END IF;
  END IF;

  IF v_guidance IS NULL THEN
    SELECT i.id INTO v_invoice FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
    WHERE l.receivable_id = p_receivable_id AND l.status IN ('active', 'settled_by_this_invoice')
      AND i.status IN ('paid', 'partially_paid') AND coalesce(i.total_paid_brl, 0) > 0
    ORDER BY i.total_paid_brl DESC, i.id LIMIT 1;
    IF v_invoice IS NULL OR p_actor IS NULL THEN v_guidance := 'no_paid_invoice'; END IF;
  END IF;

  IF v_guidance IS NOT NULL THEN
    PERFORM public.alert_stale_invoice_for_bl(p_bl_id, p_source);
    RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'has_payment', 'reason', v_guidance, 'pending_reason', NULL);
  END IF;

  v_result := public._register_invoice_correction_core(v_invoice, p_receivable_id, v_new,
    'Correcao do B/L ' || p_bl_id || ': cobranca de R$ ' || to_char(v_current, 'FM999G999G990D00')
      || ' para R$ ' || to_char(v_new, 'FM999G999G990D00'), p_actor);
  PERFORM public._clear_post_billing_hold(p_bl_id);
  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'corrected', 'invoice_id', v_invoice,
    'offset_brl', v_result->'offset_brl', 'refund_brl', v_result->'refund_brl', 'pending_reason', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public._apply_paid_basis_change(text, bigint, jsonb, boolean, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_invoice_basis_changes(p_bl_ids text[], p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_bl_id text;
  v_invoices bigint[];
  v_receivable record;
  v_quote jsonb;
  v_customer_changed boolean;
  v_reissue text[] := ARRAY[]::text[];
  v_cancelled bigint[] := ARRAY[]::bigint[];
  v_consolidated bigint[] := ARRAY[]::bigint[];
  v_results jsonb := '[]'::jsonb;
  v_reason text;
  v_bill jsonb;
  v_pending text;
  v_id bigint;
  v_reissued jsonb;
BEGIN
  v_reason := CASE p_source
    WHEN 'baplie_correction' THEN 'Reemissao automatica: flags do Baplie alteraram a base faturada'
    WHEN 'bl_reimport_correction' THEN 'Reemissao automatica: reimportacao alterou a base faturada'
    ELSE 'Reemissao automatica: alteracao do B/L mudou a base faturada' END;

  FOREACH v_bl_id IN ARRAY p_bl_ids LOOP
    v_invoices := public._live_local_invoice_ids_for_bl(v_bl_id);
    IF cardinality(v_invoices) = 0 THEN CONTINUE; END IF;
    v_receivable := NULL;
    SELECT * INTO v_receivable FROM public.bl_receivables WHERE bl_id = v_bl_id AND source = 'local_charges';
    v_quote := public._quote_bl_local_charges(v_bl_id, v_receivable.roe_frozen);
    v_customer_changed := EXISTS (SELECT 1 FROM public.invoices i JOIN public.bls b ON b.id = v_bl_id
      WHERE i.id = ANY(v_invoices) AND i.customer_id IS DISTINCT FROM b.customer_id);

    IF v_receivable.id IS NOT NULL AND NOT v_customer_changed AND v_quote->>'status' IN ('ok', 'exempt')
       AND (v_quote->>'total_brl')::numeric = v_receivable.original_amount_brl - v_receivable.correction_amount_brl THEN
      PERFORM public._clear_post_billing_hold(v_bl_id);
      CONTINUE;  -- a mudança não altera o valor nem o Cliente
    END IF;

    IF EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = ANY(v_invoices))
       OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = ANY(v_invoices) AND i.status IN ('partially_paid', 'paid'))
       OR EXISTS (SELECT 1 FROM public.invoice_corrections c WHERE c.receivable_id = v_receivable.id) THEN
      IF v_receivable.id IS NULL THEN
        PERFORM public.alert_stale_invoice_for_bl(v_bl_id, p_source);
        v_results := v_results || jsonb_build_object('bl_id', v_bl_id, 'status', 'has_payment', 'pending_reason', NULL);
      ELSE
        v_results := v_results || public._apply_paid_basis_change(v_bl_id, v_receivable.id, v_quote, v_customer_changed, p_source, v_actor);
      END IF;
    ELSIF v_actor IS NULL THEN
      PERFORM public.alert_stale_invoice_for_bl(v_bl_id, p_source);
      v_results := v_results || jsonb_build_object('bl_id', v_bl_id, 'status', 'pending', 'pending_reason', 'sem usuario para reemitir');
    ELSE
      v_reissue := v_reissue || v_bl_id;
    END IF;
  END LOOP;

  IF cardinality(v_reissue) = 0 THEN RETURN v_results; END IF;

  -- Cancela tudo antes de emitir: a consolidada volta uma vez só.
  FOR v_id IN
    SELECT DISTINCT inv.id FROM public.invoices inv JOIN public.invoice_receivable_links l ON l.invoice_id = inv.id
    WHERE l.bl_id = ANY(v_reissue) AND l.status IN ('active', 'settled_by_this_invoice')
      AND inv.invoice_type = 'consolidated' AND coalesce(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
    ORDER BY inv.id
  LOOP
    PERFORM public._cancel_invoice_core(v_id, v_reason || ' (B/L ' || array_to_string(v_reissue, ', ') || ').', v_actor);
    UPDATE public.invoices SET reissue_requested_at = now() WHERE id = v_id;
    v_cancelled := v_cancelled || v_id;
    v_consolidated := v_consolidated || v_id;
  END LOOP;
  FOR v_id IN
    SELECT DISTINCT inv.id FROM public.invoices inv JOIN public.invoice_bls ib ON ib.invoice_id = inv.id
    WHERE ib.bl_id = ANY(v_reissue) AND inv.invoice_type = 'individual'
      AND coalesce(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
    ORDER BY inv.id
  LOOP
    PERFORM public._cancel_invoice_core(v_id, v_reason || '.', v_actor);
    UPDATE public.invoices SET reissue_requested_at = now() WHERE id = v_id;
    v_cancelled := v_cancelled || v_id;
  END LOOP;

  FOREACH v_bl_id IN ARRAY v_reissue LOOP
    PERFORM public._clear_post_billing_hold(v_bl_id);
    v_bill := public._auto_bill_bl_core(v_bl_id, v_actor, false);
    v_pending := NULL;
    IF v_bill->>'status' <> 'invoiced' AND coalesce(v_bill->>'reason', '') <> 'exempt' THEN
      -- Isento: o gatilho do B/L encerra a pendência. Demais travas: alerta.
      v_pending := coalesce(v_bill->>'reason', v_bill->>'status') || coalesce(': ' || nullif(v_bill->>'message', ''), '');
      FOR v_id IN SELECT i.id FROM public.invoices i JOIN public.invoice_bls ib ON ib.invoice_id = i.id
        WHERE ib.bl_id = v_bl_id AND i.id = ANY(v_cancelled)
          AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = i.id) LOOP
        PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_id::text,
          'Fatura cancelada para reemissao automatica do B/L ' || v_bl_id || ', mas a nova emissao nao saiu (' || v_pending
            || '). Resolva o motivo e use Emitir fatura na ficha do B/L; ela segue em Reemissao pendente.',
          p_source, 'administrativo',
          jsonb_build_object('bl_id', v_bl_id, 'invoice_id', v_id, 'auto_reissue', 'pending', 'reason', v_pending),
          '/taxas-locais?invoice=' || v_id);
      END LOOP;
    END IF;
    v_results := v_results || jsonb_build_object('bl_id', v_bl_id,
      'status', CASE WHEN v_pending IS NULL THEN 'reissued' ELSE 'pending' END, 'pending_reason', v_pending);
  END LOOP;

  -- Quem não foi puxado pela individual (B/L isento, cancelado ou travado)
  -- é encerrado ou fica aguardando com o motivo.
  FOREACH v_id IN ARRAY v_consolidated LOOP
    PERFORM public._try_recreate_consolidated(v_id, v_actor);
  END LOOP;

  -- Sucessoras de cada fatura cancelada, para o retorno.
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', s.invoice_type, 'invoice_id', s.id, 'replaces', s.replaces_invoice_id) ORDER BY s.id), '[]'::jsonb)
  INTO v_reissued FROM public.invoices s WHERE s.replaces_invoice_id = ANY(v_cancelled);
  SELECT coalesce(jsonb_agg(CASE WHEN r->>'status' IN ('reissued', 'pending') AND NOT (r ? 'cancelled_invoice_ids') THEN r || jsonb_build_object(
      'cancelled_invoice_ids', to_jsonb(v_cancelled), 'reissued', v_reissued) ELSE r END), '[]'::jsonb)
  INTO v_results FROM jsonb_array_elements(v_results) r;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
  VALUES ('bl', array_to_string(v_reissue, ','), 'auto_reissue_invoices',
    jsonb_build_object('cancelled', to_jsonb(v_cancelled), 'reissued', v_reissued)::text, v_actor, v_reason);
  RETURN v_results;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_invoice_basis_changes(text[], text) FROM PUBLIC, anon, authenticated;

-- Compatibilidade com a 126: um B/L só.
CREATE OR REPLACE FUNCTION public.auto_reissue_invoices_for_bl(p_bl_id text, p_source text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(public.apply_invoice_basis_changes(ARRAY[upper(btrim(p_bl_id))], p_source)->0,
    jsonb_build_object('bl_id', upper(btrim(p_bl_id)), 'status', 'unchanged'));
$$;
REVOKE ALL ON FUNCTION public.auto_reissue_invoices_for_bl(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Captura no começo da mudança e processamento no fim da transação
-- ---------------------------------------------------------------------------
-- O mapa "antes" vive num GUC local da transação: o primeiro toque em cada
-- B/L com fatura viva grava a base anterior; o processamento compara com a
-- base final uma vez e reemite em lote.
CREATE OR REPLACE FUNCTION public._capture_invoice_basis(p_bl_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_map jsonb;
BEGIN
  IF p_bl_id IS NULL OR current_setting('vela.invoice_basis_running', true) = 'on' THEN RETURN; END IF;
  v_map := coalesce(nullif(current_setting('vela.invoice_basis_before', true), ''), '{}')::jsonb;
  IF v_map ? p_bl_id THEN RETURN; END IF;
  IF cardinality(public._live_local_invoice_ids_for_bl(p_bl_id)) = 0 THEN RETURN; END IF;
  PERFORM set_config('vela.invoice_basis_before',
    (v_map || jsonb_build_object(p_bl_id, public.bl_invoice_basis_snapshot(p_bl_id)))::text, true);
END;
$$;
REVOKE ALL ON FUNCTION public._capture_invoice_basis(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_invoice_basis() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'bls' THEN
    PERFORM public._capture_invoice_basis(OLD.id);
  ELSE
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM public._capture_invoice_basis(OLD.bl_id); END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN PERFORM public._capture_invoice_basis(NEW.bl_id); END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_invoice_basis() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_invoice_basis_changes() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_map jsonb; v_changed text[] := ARRAY[]::text[]; v_id text; v_result jsonb := '[]'::jsonb; v_source text;
BEGIN
  IF current_setting('vela.invoice_basis_running', true) = 'on' THEN RETURN '[]'::jsonb; END IF;
  v_map := coalesce(nullif(current_setting('vela.invoice_basis_before', true), ''), '{}')::jsonb;
  IF v_map = '{}'::jsonb THEN RETURN '[]'::jsonb; END IF;
  PERFORM set_config('vela.invoice_basis_before', '{}', true);
  v_source := coalesce(nullif(current_setting('vela.invoice_basis_source', true), ''), 'bl_correction');
  FOR v_id IN SELECT jsonb_object_keys(v_map) ORDER BY 1 LOOP
    IF v_map->v_id IS DISTINCT FROM public.bl_invoice_basis_snapshot(v_id) THEN v_changed := v_changed || v_id; END IF;
  END LOOP;
  IF cardinality(v_changed) = 0 THEN RETURN '[]'::jsonb; END IF;

  PERFORM set_config('vela.invoice_basis_running', 'on', true);
  BEGIN
    v_result := public.apply_invoice_basis_changes(v_changed, v_source);
  EXCEPTION WHEN OTHERS THEN
    -- A correção do B/L não é desfeita por falha financeira: o alerta explica.
    FOREACH v_id IN ARRAY v_changed LOOP
      PERFORM public.alert_stale_invoice_for_bl(v_id, v_source);
    END LOOP;
    v_result := jsonb_build_array(jsonb_build_object('status', 'error', 'bl_ids', to_jsonb(v_changed), 'message', SQLERRM));
  END;
  PERFORM set_config('vela.invoice_basis_running', 'off', true);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.process_invoice_basis_changes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_invoice_basis_changes_at_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.process_invoice_basis_changes();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.process_invoice_basis_changes_at_commit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_invoice_basis ON public.bls;
CREATE TRIGGER capture_invoice_basis
  BEFORE UPDATE OF voyage_id, pod, cargo_mode, customer_id, bb_weight_ton, total_weight_kg, movement_to, cancelled_at ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_basis();
DROP TRIGGER IF EXISTS capture_invoice_basis ON public.bl_containers;
CREATE TRIGGER capture_invoice_basis
  BEFORE INSERT OR DELETE OR UPDATE OF bl_id, container_number, is_imo, is_oog, ownership ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_basis();
DROP TRIGGER IF EXISTS capture_invoice_basis ON public.vehicles;
CREATE TRIGGER capture_invoice_basis
  BEFORE INSERT OR DELETE OR UPDATE OF bl_id, chassis ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_basis();

DROP TRIGGER IF EXISTS process_invoice_basis_changes ON public.bls;
CREATE CONSTRAINT TRIGGER process_invoice_basis_changes
  AFTER UPDATE OF voyage_id, pod, cargo_mode, customer_id, bb_weight_ton, total_weight_kg, movement_to, cancelled_at ON public.bls
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.process_invoice_basis_changes_at_commit();
DROP TRIGGER IF EXISTS process_invoice_basis_changes ON public.bl_containers;
CREATE CONSTRAINT TRIGGER process_invoice_basis_changes
  AFTER INSERT OR DELETE OR UPDATE OF bl_id, container_number, is_imo, is_oog, ownership ON public.bl_containers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.process_invoice_basis_changes_at_commit();
DROP TRIGGER IF EXISTS process_invoice_basis_changes ON public.vehicles;
CREATE CONSTRAINT TRIGGER process_invoice_basis_changes
  AFTER INSERT OR DELETE OR UPDATE OF bl_id, chassis ON public.vehicles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.process_invoice_basis_changes_at_commit();

-- Reimportação e Baplie processam na hora para devolver o resultado.
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_reissues jsonb;
  v_previous text := current_setting('vela.invoice_basis_source', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_bls) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload de B/L invalido.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.invoice_basis_source', 'bl_reimport_correction', true);
  v_result := public._import_bl_freight_before_invoice_alert_123(p_bls, p_changed_by);
  v_reissues := public.process_invoice_basis_changes();
  PERFORM set_config('vela.invoice_basis_source', coalesce(v_previous, ''), true);
  IF jsonb_typeof(v_result) = 'object' THEN
    RETURN v_result || jsonb_build_object('invoice_reissues', v_reissues);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_baplie_physical_flags_atomic(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_reissues jsonb;
  v_previous text := current_setting('vela.invoice_basis_source', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('vela.invoice_basis_source', 'baplie_correction', true);
  v_result := public._apply_baplie_physical_flags_before_reissue_126(p_voyage_id, p_changes, p_changed_by);
  v_reissues := public.process_invoice_basis_changes();
  PERFORM set_config('vela.invoice_basis_source', coalesce(v_previous, ''), true);
  IF jsonb_typeof(v_result) = 'object' THEN
    RETURN v_result || jsonb_build_object('invoice_reissues', v_reissues);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Efeito de veículos: a consolidada do B/L isento sai junto
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._run_import_effect_vehicle_followup(
  p_entity_id text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl_id text := NULLIF(btrim(COALESCE(p_entity_id, '')), '');
  v_invoice_id bigint;
  v_cancelled_ids bigint[] := ARRAY[]::bigint[];
  v_cancel_results jsonb := '[]'::jsonb;
  v_charge_result jsonb;
BEGIN
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L inválido no efeito de veículos.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.bls
  WHERE id = v_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado para efeito de veículos.', v_bl_id
      USING ERRCODE = 'P0002';
  END IF;

  -- A permissão especial só existe dentro deste consumidor server-only.
  PERFORM set_config('import_effects.consumer', 'vehicle_followup', true);

  -- A consolidada que cobra este B/L sai junto: não pode voltar com os mesmos
  -- B/Ls, então é encerrada sem reemissão (decisão de 2026-10-02).
  FOR v_invoice_id IN
    SELECT DISTINCT inv.id
    FROM public.invoice_receivable_links AS l
    JOIN public.invoices AS inv ON inv.id = l.invoice_id
    WHERE l.bl_id = v_bl_id
      AND l.status IN ('active', 'settled_by_this_invoice')
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'overdue')
    ORDER BY inv.id
  LOOP
    v_cancel_results := v_cancel_results || jsonb_build_array(
      public._cancel_invoice_core(v_invoice_id, 'Carga de veiculos: BL ' || v_bl_id || ' isento de taxas locais.', p_actor)
    );
    UPDATE public.invoices
    SET reissue_requested_at = now(), reissue_closed_at = now(),
        reissue_closed_reason = 'Nao reemitida: B/L ' || v_bl_id || ' isento por carga de veiculos.'
    WHERE id = v_invoice_id;
    v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
  END LOOP;

  FOR v_invoice_id IN
    SELECT DISTINCT inv.id
    FROM public.invoice_bls AS link
    JOIN public.invoices AS inv ON inv.id = link.invoice_id
    WHERE link.bl_id = v_bl_id
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
    ORDER BY inv.id
  LOOP
    v_cancel_results := v_cancel_results || jsonb_build_array(
      public.cancel_invoice(
        v_invoice_id,
        'Carga de veiculos: BL isento de taxas locais.',
        p_actor
      )
    );
    v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
  END LOOP;

  v_charge_result := public.calculate_bl_local_charges(v_bl_id, p_actor, true);

  RETURN jsonb_build_object(
    'entity_id', v_bl_id,
    'cancelled_invoice_ids', v_cancelled_ids,
    'cancel_results', v_cancel_results,
    'charge_result', v_charge_result
  );
END;
$$;
REVOKE ALL ON FUNCTION public._run_import_effect_vehicle_followup(text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Portal: canceladas só pelo filtro
-- ---------------------------------------------------------------------------
-- Sem filtro, o Cliente vê as faturas em vigor; as canceladas e as desfeitas
-- continuam acessíveis pelo filtro Cancelada (decisão de 2026-10-02).
CREATE OR REPLACE FUNCTION public._portal_list_invoices_page_core(p_customer_id bigint, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_status text DEFAULT NULL::text, p_vessel text DEFAULT NULL::text, p_bl text DEFAULT NULL::text, p_pod text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN (
    WITH all_rows AS MATERIALIZED (
      SELECT r.*
      FROM public._portal_list_invoices_core(p_customer_id) AS r
    ),
    filtered AS MATERIALIZED (
      SELECT r.*
      FROM all_rows AS r
      WHERE (
        (NULLIF(BTRIM(p_status), '') IS NULL AND r.status NOT IN ('cancelled', 'obsolete'))
        OR (p_status = 'issued' AND r.status IN ('issued', 'partially_paid', 'draft'))
        OR (p_status = 'paid' AND r.status IN ('paid', 'covered'))
        OR (p_status = 'cancelled' AND r.status IN ('cancelled', 'obsolete'))
      )
      AND (
        NULLIF(BTRIM(p_vessel), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(r.vessel_voyages, '{}'::TEXT[])) AS value
          WHERE POSITION(LOWER(BTRIM(p_vessel)) IN LOWER(value)) > 0
        )
      )
      AND (
        NULLIF(BTRIM(p_bl), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(r.bls, '{}'::TEXT[])) AS value
          WHERE POSITION(LOWER(BTRIM(p_bl)) IN LOWER(value)) > 0
        )
      )
      AND (NULLIF(BTRIM(p_pod), '') IS NULL OR BTRIM(p_pod) = ANY(COALESCE(r.pods, '{}'::TEXT[])))
      AND (p_date_from IS NULL OR r.issued_at::DATE >= p_date_from)
      AND (p_date_to IS NULL OR r.issued_at::DATE <= p_date_to)
    ),
    page_rows AS (
      SELECT f.*
      FROM filtered AS f
      ORDER BY f.issued_at DESC NULLS LAST, f.id DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.issued_at DESC NULLS LAST, page_rows.id DESC) FROM page_rows), '[]'::JSONB),
      'total_count', (SELECT COUNT(*) FROM filtered),
      'vessel_options', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT value
          FROM all_rows AS r, unnest(COALESCE(r.vessel_voyages, '{}'::TEXT[])) AS value
          WHERE value IS NOT NULL AND value <> ''
        ) AS options
      ), '[]'::JSONB),
      'pods', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT value
          FROM all_rows AS r, unnest(COALESCE(r.pods, '{}'::TEXT[])) AS value
          WHERE value IS NOT NULL AND value <> ''
        ) AS options
      ), '[]'::JSONB)
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._portal_list_invoices_page_core(bigint, integer, integer, text, text, text, text, date, date) FROM PUBLIC, anon, authenticated;
