-- 493: Alterar, excluir e isentar Taxas Locais de B/L faturado (lote 3 do plano
-- `2026-10-28-alterar-taxa-calculada-do-bl`; ADR 0111, decisões D8 e D9).
--
-- As ações dos lotes 1 e 2 passam a valer para B/L faturado, parcialmente pago
-- ou pago. A fatura emitida nunca é editada: depois de gravar a decisão, a ação
-- passa pela correção automática que já existe (`apply_invoice_basis_changes`,
-- origem `charge_adjustment`), que reemite a fatura sem pagamento, abate e
-- restitui na paga com valor menor, abre Fatura desatualizada na paga com valor
-- maior ou deixa a correção pendente quando a reemissão não sai. O que a
-- correção fez fica no evento do Histórico das taxas (`invoice_effect`).
--
-- O Recalcular continua recusando B/L faturado; só a ação do operador, marcada
-- na transação por `_lock_bl_for_charge_change_491` (`vela.bl_charge_change`),
-- atualiza as linhas gravadas do B/L faturado. `preview_bl_charge_change_effect`
-- roda a mesma ação numa subtransação desfeita e devolve o efeito, para a
-- confirmação dizer o que vai acontecer antes de gravar.
--
-- O item de fatura emitido de linha alterada à mão guarda a marca em
-- `snapshot_payload.charge_adjustment` (detalhe da fatura no Vela);
-- `portal_invoice_details` tira essa chave antes de devolver o item ao Cliente.
--
-- Não apaga nem reescreve linha existente fora do que as ações e a correção já
-- fazem.
--
-- Rollback: recriar `_lock_bl_for_charge_change_491` com a recusa "B/L
-- faturado" (491), `_calculate_bl_local_charges_impl_106` (492) e
-- `delete_manual_bl_charge` (491); renomear `_record_bl_charge_event_491` de
-- volta; recriar `portal_invoice_details` (chamada direta ao núcleo); remover o
-- gatilho `mark_adjusted_invoice_item` e as funções novas.

-- 1. A ação do operador aceita B/L faturado ---------------------------------

CREATE OR REPLACE FUNCTION public._lock_bl_for_charge_change_491(p_bl_id text, p_justification text, p_actor uuid)
 RETURNS public.bls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
  v_voyage text;
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo altera as taxas do B/L.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_justification, ''))) < 10 THEN
    RAISE EXCEPTION 'Justificativa obrigatória: escreva ao menos 10 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl FROM public.bls b WHERE b.id = upper(btrim(COALESCE(p_bl_id, ''))) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado e somente leitura; reative o B/L para alterar as taxas.', v_bl.id USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(btrim(v.voyage_number), ''), v.id::text) INTO v_voyage
    FROM public.voyages v WHERE v.id = v_bl.voyage_id AND v.status = 'cancelled';
  IF FOUND THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage USING ERRCODE = '42501';
  END IF;
  -- 493 (D8): B/L faturado passa pela correção automática da fatura. A marca
  -- diz ao cálculo e ao registro do evento que esta transação é a ação do
  -- operador sobre este B/L.
  PERFORM set_config('vela.bl_charge_change', v_bl.id, true);
  RETURN v_bl;
END;
$function$;
REVOKE ALL ON FUNCTION public._lock_bl_for_charge_change_491(text, text, uuid) FROM PUBLIC, anon, authenticated;

-- Linhas gravadas do B/L faturado: o valor cobrado, a situação e a alteração
-- vêm do resolvedor; a isenção à mão vale por cima. Só atualiza linha que já
-- existe (a fatura emitida aponta para ela).
CREATE OR REPLACE FUNCTION public._refresh_billed_bl_charge_lines(p_bl_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pod text;
  v_exemption public.bl_local_charge_exemptions;
BEGIN
  SELECT b.pod INTO v_pod FROM public.bls b WHERE b.id = p_bl_id;
  UPDATE public.charge_calculations cc
     SET unit_value_brl = r.unit_value_brl,
         unit_value_usd = r.unit_value_usd,
         total_value_brl = r.total_value_brl,
         total_value_usd = r.total_value_usd,
         status = CASE WHEN r.status = 'excluded' THEN 'excluded'
                       WHEN cc.status IN ('excluded', 'exempt') THEN 'ready_for_billing'
                       ELSE cc.status END,
         adjustment_id = r.adjustment_id,
         table_unit_value_brl = r.table_unit_value_brl,
         table_unit_value_usd = r.table_unit_value_usd,
         table_total_value_brl = r.table_total_value_brl,
         table_total_value_usd = r.table_total_value_usd,
         calculated_at = now()
    FROM public._resolve_bl_local_charge_items_charged(p_bl_id, v_pod) r
   WHERE cc.bl_id = p_bl_id AND COALESCE(cc.source, 'auto') = 'auto'
     AND cc.calculation_key = r.calculation_key AND r.status <> 'review_required';

  SELECT * INTO v_exemption FROM public.bl_local_charge_exemptions e WHERE e.bl_id = p_bl_id;
  IF v_exemption.bl_id IS NOT NULL THEN
    UPDATE public.charge_calculations cc
       SET status = 'exempt',
           total_value_brl = CASE WHEN cc.total_value_brl IS NULL THEN NULL ELSE 0 END,
           total_value_usd = CASE WHEN cc.total_value_usd IS NULL THEN NULL ELSE 0 END
     WHERE cc.bl_id = p_bl_id AND COALESCE(cc.status, 'calculated') <> 'excluded';
    UPDATE public.bls
       SET charge_status = 'exempt', charge_exemption_reason = 'Isenção manual: ' || btrim(v_exemption.justification)
     WHERE id = p_bl_id;
  ELSE
    UPDATE public.bls
       SET charge_status = 'ready_for_billing', charge_exemption_reason = NULL
     WHERE id = p_bl_id AND charge_status = 'exempt' AND charge_exemption_reason LIKE 'Isenção manual:%';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._refresh_billed_bl_charge_lines(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._calculate_bl_local_charges_impl_106(p_bl_id text, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_exemption public.bl_local_charge_exemptions;
  v_reason text;
  v_status text;
BEGIN
  -- 493 (D8): na ação do operador sobre B/L faturado, as linhas gravadas
  -- recebem a decisão e a fatura segue pela correção automática (registro do
  -- evento). Fora dela, o cálculo da 491 recusa o B/L faturado, como sempre.
  IF current_setting('vela.bl_charge_change', true) = p_bl_id
     AND EXISTS (SELECT 1 FROM public.bls b WHERE b.id = p_bl_id
       AND COALESCE(b.financial_status, 'pending') IN ('invoiced', 'partially_paid', 'paid')) THEN
    PERFORM public._refresh_billed_bl_charge_lines(p_bl_id);
    SELECT b.charge_status INTO v_status FROM public.bls b WHERE b.id = p_bl_id;
    RETURN jsonb_build_object('bl_id', p_bl_id, 'status', v_status, 'billed', true);
  END IF;

  v_result := public._calculate_bl_local_charges_impl_491(p_bl_id, p_actor, p_recalculate);
  SELECT * INTO v_exemption FROM public.bl_local_charge_exemptions e WHERE e.bl_id = p_bl_id;
  IF v_exemption.bl_id IS NULL OR v_result->>'status' = 'exempt' THEN
    RETURN v_result;
  END IF;

  v_reason := 'Isenção manual: ' || btrim(v_exemption.justification);
  UPDATE public.charge_calculations cc
     SET status = 'exempt',
         total_value_brl = CASE WHEN cc.total_value_brl IS NULL THEN NULL ELSE 0 END,
         total_value_usd = CASE WHEN cc.total_value_usd IS NULL THEN NULL ELSE 0 END
   WHERE cc.bl_id = p_bl_id AND COALESCE(cc.status, 'calculated') <> 'excluded';

  UPDATE public.bls
     SET charge_status = 'exempt',
         charges_calculated_at = now(),
         charge_exemption_reason = v_reason,
         billing_hold_reason = NULL
   WHERE id = p_bl_id;
  PERFORM public.sync_local_charge_receivable(p_bl_id);

  RETURN v_result || jsonb_build_object('status', 'exempt', 'total_brl', 0, 'total_usd', 0,
    'review_required', false, 'exempt', true, 'reason', v_reason, 'manual_exemption', true);
END;
$function$;
REVOKE ALL ON FUNCTION public._calculate_bl_local_charges_impl_106(text, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- 2. Correção da fatura e o efeito no Histórico das taxas --------------------

CREATE OR REPLACE FUNCTION public._brl_text(p_value numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'R$ ' || translate(to_char(round(COALESCE(p_value, 0), 2), 'FM999,999,999,990.00'), ',.', '.,');
$function$;
REVOKE ALL ON FUNCTION public._brl_text(numeric) FROM PUBLIC, anon, authenticated;

-- Situação da fatura do B/L para a correção: fatura viva, valor atual, valor
-- novo (cotação), pago e o que a correção vai fazer. A prévia e o efeito real
-- usam a mesma leitura.
CREATE OR REPLACE FUNCTION public._bl_charge_change_invoice_state(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoices bigint[] := public._live_local_invoice_ids_for_bl(p_bl_id);
  v_invoice public.invoices;
  v_receivable public.bl_receivables;
  v_quote jsonb;
  v_current numeric;
  v_new numeric;
  v_paid numeric;
  v_open numeric;
  v_offset numeric;
  v_refund numeric;
  v_has_payment boolean;
  v_terminals text[];
BEGIN
  IF cardinality(v_invoices) = 0 THEN
    RETURN jsonb_build_object('situation', 'none');
  END IF;
  SELECT * INTO v_invoice FROM public.invoices i WHERE i.id = ANY(v_invoices) ORDER BY i.id DESC LIMIT 1;
  SELECT * INTO v_receivable FROM public.bl_receivables r WHERE r.bl_id = p_bl_id AND r.source = 'local_charges';
  v_quote := public._quote_bl_local_charges(p_bl_id, v_receivable.roe_frozen);
  v_current := COALESCE(v_receivable.original_amount_brl - v_receivable.correction_amount_brl, v_invoice.total_brl, 0);
  v_paid := COALESCE((SELECT sum(i.total_paid_brl) FROM public.invoices i WHERE i.id = ANY(v_invoices)), 0);
  v_has_payment := v_paid > 0
    OR EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = ANY(v_invoices))
    OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = ANY(v_invoices) AND i.status IN ('partially_paid', 'paid'));

  IF COALESCE(v_quote->>'status', '') NOT IN ('ok', 'exempt') THEN
    RETURN jsonb_build_object('situation', 'blocked', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'current_brl', v_current, 'reason', COALESCE(v_quote->>'reason', 'valor novo a revisar'));
  END IF;
  v_new := CASE WHEN v_quote->>'status' = 'exempt' THEN 0 ELSE (v_quote->>'total_brl')::numeric END;

  IF v_new = v_current THEN
    RETURN jsonb_build_object('situation', 'unchanged', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'current_brl', v_current, 'new_brl', v_new);
  END IF;
  IF v_has_payment THEN
    IF v_new > v_current THEN
      RETURN jsonb_build_object('situation', 'stale', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
        'current_brl', v_current, 'new_brl', v_new, 'paid_brl', v_paid, 'diff_brl', v_new - v_current);
    END IF;
    v_open := greatest(v_current - v_paid, 0);
    v_offset := least(v_current - v_new, v_open);
    v_refund := (v_current - v_new) - v_offset;
    RETURN jsonb_build_object('situation', 'refund', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'current_brl', v_current, 'new_brl', v_new, 'paid_brl', v_paid, 'offset_brl', v_offset, 'refund_brl', v_refund);
  END IF;
  v_terminals := public.check_bl_terminal_pendencies(p_bl_id);
  IF cardinality(v_terminals) > 0 THEN
    RETURN jsonb_build_object('situation', 'blocked', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'current_brl', v_current, 'new_brl', v_new, 'reason', 'B/L misto com terminais em conflito');
  END IF;
  RETURN jsonb_build_object('situation', CASE WHEN v_quote->>'status' = 'exempt' THEN 'cancel' ELSE 'reissue' END,
    'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number, 'current_brl', v_current, 'new_brl', v_new);
END;
$function$;
REVOKE ALL ON FUNCTION public._bl_charge_change_invoice_state(text) FROM PUBLIC, anon, authenticated;

-- Frase da confirmação (spec, "Mensagens") para a situação acima.
CREATE OR REPLACE FUNCTION public._bl_charge_change_effect_message(p_state jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_state->>'situation'
    WHEN 'reissue' THEN format('A fatura %s (%s) será cancelada e reemitida com número novo, no valor de %s. O Cliente recebe o aviso no Portal e um Pix novo.',
      p_state->>'invoice_number', public._brl_text((p_state->>'current_brl')::numeric), public._brl_text((p_state->>'new_brl')::numeric))
    WHEN 'cancel' THEN format('A fatura %s será cancelada, sem nova fatura. O Cliente vê a fatura em Canceladas no Portal.', p_state->>'invoice_number')
    WHEN 'refund' THEN format('O Cliente já pagou %s da fatura %s. A cobrança deste B/L passa a %s: %s saem do saldo em aberto e %s viram Restituição, a confirmar pelo Financeiro com comprovante.',
      public._brl_text((p_state->>'paid_brl')::numeric), p_state->>'invoice_number', public._brl_text((p_state->>'new_brl')::numeric),
      public._brl_text((p_state->>'offset_brl')::numeric), public._brl_text((p_state->>'refund_brl')::numeric))
    WHEN 'stale' THEN format('O Cliente já pagou a fatura %s. A cobrança deste B/L passa a %s: abre Fatura desatualizada, e a diferença de %s se cobra por Fatura avulsa.',
      p_state->>'invoice_number', public._brl_text((p_state->>'new_brl')::numeric), public._brl_text((p_state->>'diff_brl')::numeric))
    WHEN 'blocked' THEN format('A fatura %s não pode ser reemitida agora (%s). Ela continua valendo com Fatura desatualizada; resolva o motivo e use Tentar aplicar correção.',
      p_state->>'invoice_number', p_state->>'reason')
    WHEN 'unchanged' THEN format('A fatura %s não muda de valor.', p_state->>'invoice_number')
    ELSE NULL END;
$function$;
REVOKE ALL ON FUNCTION public._bl_charge_change_effect_message(jsonb) FROM PUBLIC, anon, authenticated;

-- Aplica a correção automática ao B/L faturado e devolve o que ela fez, na
-- frase da coluna Efeito na fatura.
CREATE OR REPLACE FUNCTION public._apply_bl_charge_change_to_invoice(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_state jsonb := public._bl_charge_change_invoice_state(p_bl_id);
  v_result jsonb;
  v_row jsonb;
  v_summary text;
  v_old text;
  v_new text;
BEGIN
  IF v_state->>'situation' = 'none' THEN
    RETURN NULL;
  END IF;
  v_old := v_state->>'invoice_number';
  PERFORM set_config('vela.invoice_basis_running', 'on', true);
  v_result := public.apply_invoice_basis_changes(ARRAY[p_bl_id], 'charge_adjustment');
  PERFORM set_config('vela.invoice_basis_running', 'off', true);
  SELECT r INTO v_row FROM jsonb_array_elements(COALESCE(v_result, '[]'::jsonb)) r WHERE r->>'bl_id' = p_bl_id LIMIT 1;

  IF v_row IS NULL THEN
    v_summary := 'Sem mudança na fatura';
  ELSIF v_row->>'status' = 'reissued' THEN
    SELECT s.invoice_number INTO v_new FROM public.invoices s
     WHERE s.replaces_invoice_id = (v_state->>'invoice_id')::bigint ORDER BY s.id DESC LIMIT 1;
    v_summary := CASE WHEN v_new IS NULL THEN v_old || ' cancelada sem nova fatura (B/L isento)'
                      ELSE v_old || ' cancelada e reemitida como ' || v_new END;
  ELSIF v_row->>'status' = 'corrected' THEN
    v_summary := concat_ws('; ',
      CASE WHEN COALESCE((v_row->>'offset_brl')::numeric, 0) > 0 THEN 'Abatido ' || public._brl_text((v_row->>'offset_brl')::numeric) || ' do saldo' END,
      CASE WHEN COALESCE((v_row->>'refund_brl')::numeric, 0) > 0 THEN 'Restituição de ' || public._brl_text((v_row->>'refund_brl')::numeric) END);
  ELSIF v_row->>'status' = 'has_payment' AND v_row->>'reason' = 'increase' THEN
    v_summary := 'Fatura desatualizada: diferença de ' || public._brl_text((v_state->>'new_brl')::numeric - (v_state->>'current_brl')::numeric) || ' a cobrar por avulsa';
  ELSE
    v_summary := 'Correção pendente: ' || COALESCE(v_row->>'pending_reason', v_row->>'reason', v_row->>'status');
  END IF;
  RETURN jsonb_build_object('summary', NULLIF(v_summary, ''), 'situation', v_state->>'situation',
    'invoice_id', v_state->'invoice_id', 'result', v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public._apply_bl_charge_change_to_invoice(text) FROM PUBLIC, anon, authenticated;

-- O evento da ação do operador sobre B/L faturado aplica a correção e guarda o
-- efeito. Eventos do Sistema (descarte, quantidade, remapeamento) e a prévia
-- não aplicam.
ALTER FUNCTION public._record_bl_charge_event(text, bigint, text, text, text, jsonb, jsonb, text, uuid, jsonb)
  RENAME TO _record_bl_charge_event_491;
REVOKE ALL ON FUNCTION public._record_bl_charge_event_491(text, bigint, text, text, text, jsonb, jsonb, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._record_bl_charge_event(
  p_bl_id text, p_adjustment_id bigint, p_event text, p_line_key text, p_charge_name text,
  p_before jsonb, p_after jsonb, p_justification text, p_actor uuid, p_invoice_effect jsonb DEFAULT NULL)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_effect jsonb := p_invoice_effect;
BEGIN
  IF v_effect IS NULL AND p_actor IS NOT NULL
     AND current_setting('vela.bl_charge_change', true) = p_bl_id
     AND current_setting('vela.bl_charge_preview', true) IS DISTINCT FROM 'on'
     AND p_event IN ('altered', 'excluded', 'restored', 'reincluded', 'manual_deleted', 'exempted', 'exemption_removed') THEN
    v_effect := public._apply_bl_charge_change_to_invoice(p_bl_id);
  END IF;
  RETURN public._record_bl_charge_event_491(p_bl_id, p_adjustment_id, p_event, p_line_key, p_charge_name,
    p_before, p_after, p_justification, p_actor, v_effect);
END;
$function$;
REVOKE ALL ON FUNCTION public._record_bl_charge_event(text, bigint, text, text, text, jsonb, jsonb, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Excluir cobrança manual: a linha sai da cobrança antes do registro (a
-- correção da fatura cota sem ela) e só é apagada se nenhuma fatura viva aponta
-- para ela; senão fica na ficha como Excluída.
CREATE OR REPLACE FUNCTION public.delete_manual_bl_charge(
  p_charge_calculation_id bigint, p_justification text, p_actor uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_bl public.bls;
  v_line record;
  v_key text;
  v_justification text := btrim(COALESCE(p_justification, ''));
  v_deleted boolean := false;
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo altera as taxas do B/L.' USING ERRCODE = '42501';
  END IF;
  SELECT cc.bl_id, cc.calculation_key INTO v_bl_id, v_key FROM public.charge_calculations cc WHERE cc.id = p_charge_calculation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta taxa não está mais no cálculo do B/L; atualize a página.' USING ERRCODE = 'P0002';
  END IF;
  v_bl := public._lock_bl_for_charge_change(v_bl_id, p_justification, p_actor);

  SELECT l.* INTO v_line FROM public._bl_charge_line_for_change(v_bl.id, v_key) l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta taxa não está mais no cálculo do B/L; atualize a página.' USING ERRCODE = 'P0002';
  END IF;
  IF v_line.source IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'Somente cobrança manual se exclui assim; para a taxa calculada use Excluir taxa.' USING ERRCODE = '22023';
  END IF;
  IF v_line.status = 'excluded' THEN
    RAISE EXCEPTION 'A cobrança manual já saiu da cobrança.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.charge_calculations cc WHERE cc.bl_id = v_bl.id AND cc.status = 'excluded') THEN
    PERFORM public._assert_bl_keeps_a_charge(v_bl.id, v_line.id);
  END IF;

  UPDATE public.bl_charge_adjustments
     SET ended_at = now(), ended_by = auth.uid(), end_reason = 'line_deleted', end_justification = v_justification
   WHERE bl_id = v_bl.id AND line_key = v_key AND ended_at IS NULL;
  UPDATE public.charge_calculations cc
     SET status = 'excluded',
         table_unit_value_brl = COALESCE(cc.table_unit_value_brl, cc.unit_value_brl),
         table_unit_value_usd = COALESCE(cc.table_unit_value_usd, cc.unit_value_usd),
         table_total_value_brl = COALESCE(cc.table_total_value_brl, cc.total_value_brl),
         table_total_value_usd = COALESCE(cc.table_total_value_usd, cc.total_value_usd),
         total_value_brl = CASE WHEN cc.total_value_brl IS NULL THEN NULL ELSE 0 END,
         total_value_usd = CASE WHEN cc.total_value_usd IS NULL THEN NULL ELSE 0 END,
         adjustment_id = NULL
   WHERE cc.id = p_charge_calculation_id;

  PERFORM public._record_bl_charge_event(v_bl.id, v_line.adjustment_id, 'manual_deleted', v_key, v_line.charge_name,
    public._bl_charge_value_snapshot(CASE WHEN v_line.adjustment_id IS NULL THEN 'table' ELSE 'adjusted' END,
      v_line.unit_value, v_line.total_value, v_line.quantity, v_line.currency, v_line.application_basis),
    NULL, v_justification, auth.uid());

  IF NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.charge_calculation_id = p_charge_calculation_id) THEN
    DELETE FROM public.charge_calculations WHERE id = p_charge_calculation_id;
    v_deleted := true;
  END IF;
  RETURN jsonb_build_object('deleted', v_deleted, 'id', p_charge_calculation_id, 'bl_id', v_bl.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_manual_bl_charge(bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_manual_bl_charge(bigint, text, uuid) TO authenticated;

-- 3. Prévia do efeito ---------------------------------------------------------

-- Roda a ação de verdade numa subtransação desfeita, sem a correção da fatura,
-- e lê a situação da fatura com o valor novo. As recusas da ação aparecem aqui
-- também. `p_action`: alter, exclude, restore, delete_manual, exempt, unexempt.
CREATE OR REPLACE FUNCTION public.preview_bl_charge_change_effect(
  p_bl_id text, p_action text, p_line_key text DEFAULT NULL, p_kind text DEFAULT NULL,
  p_value numeric DEFAULT NULL, p_justification text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text := upper(btrim(COALESCE(p_bl_id, '')));
  v_justification text := COALESCE(NULLIF(btrim(COALESCE(p_justification, '')), ''), 'Prévia do efeito na fatura');
  v_state jsonb;
  v_text text;
  v_line_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo altera as taxas do B/L.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('vela.bl_charge_preview', 'on', true);
  BEGIN
    CASE p_action
      WHEN 'alter' THEN PERFORM public.alter_bl_charge_value(v_bl_id, p_line_key, p_kind, p_value, v_justification, auth.uid());
      WHEN 'exclude' THEN PERFORM public.exclude_bl_charge(v_bl_id, p_line_key, v_justification, auth.uid());
      WHEN 'restore' THEN PERFORM public.restore_bl_charge(v_bl_id, p_line_key, v_justification, auth.uid());
      WHEN 'delete_manual' THEN
        SELECT cc.id INTO v_line_id FROM public.charge_calculations cc WHERE cc.bl_id = v_bl_id AND cc.calculation_key = p_line_key;
        PERFORM public.delete_manual_bl_charge(v_line_id, v_justification, auth.uid());
      WHEN 'exempt' THEN PERFORM public.exempt_bl_local_charges(v_bl_id, v_justification, auth.uid());
      WHEN 'unexempt' THEN PERFORM public.remove_bl_local_charge_exemption(v_bl_id, v_justification, auth.uid());
      ELSE RAISE EXCEPTION 'Ação desconhecida para a prévia: %.', p_action USING ERRCODE = '22023';
    END CASE;
    v_state := public._bl_charge_change_invoice_state(v_bl_id);
    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = v_state::text;
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    v_state := v_text::jsonb;
  END;
  PERFORM set_config('vela.bl_charge_preview', 'off', true);
  PERFORM set_config('vela.bl_charge_change', '', true);
  RETURN v_state || jsonb_build_object('message', public._bl_charge_change_effect_message(v_state));
END;
$function$;
REVOKE ALL ON FUNCTION public.preview_bl_charge_change_effect(text, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_bl_charge_change_effect(text, text, text, text, numeric, text) TO authenticated;

-- 4. Marca no item da fatura (D9: só no Vela) ---------------------------------

CREATE OR REPLACE FUNCTION public.mark_adjusted_invoice_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mark jsonb;
BEGIN
  IF NEW.charge_calculation_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT jsonb_build_object('kind', a.kind, 'value', a.value,
           'table_unit_brl', cc.table_unit_value_brl, 'table_unit_usd', cc.table_unit_value_usd,
           'table_total_brl', cc.table_total_value_brl, 'table_total_usd', cc.table_total_value_usd)
    INTO v_mark
    FROM public.charge_calculations cc
    JOIN public.bl_charge_adjustments a ON a.id = cc.adjustment_id
   WHERE cc.id = NEW.charge_calculation_id AND a.kind <> 'excluded';
  IF v_mark IS NOT NULL THEN
    NEW.snapshot_payload := COALESCE(NEW.snapshot_payload, '{}'::jsonb) || jsonb_build_object('charge_adjustment', v_mark);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_adjusted_invoice_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mark_adjusted_invoice_item ON public.invoice_items;
CREATE TRIGGER mark_adjusted_invoice_item BEFORE INSERT ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.mark_adjusted_invoice_item();

-- O Cliente vê o valor cobrado, nunca o de tabela nem a alteração (D9).
CREATE OR REPLACE FUNCTION public.portal_invoice_details(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb := public._portal_invoice_details_core(public.current_portal_customer_id(), p_invoice_id);
BEGIN
  IF jsonb_typeof(v_result->'items') = 'array' THEN
    v_result := jsonb_set(v_result, '{items}', COALESCE((
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(i->'snapshot_payload') = 'object'
        THEN jsonb_set(i, '{snapshot_payload}', (i->'snapshot_payload') - 'charge_adjustment') ELSE i END ORDER BY n)
      FROM jsonb_array_elements(v_result->'items') WITH ORDINALITY AS t(i, n)), '[]'::jsonb));
  END IF;
  RETURN v_result;
END;
$function$;
