-- 497: Correções da revisão da PR luccafwlog/vela#1080 (ADR 0111, taxa
-- alterada à mão; spec arquivada `2026-10-28-alterar-taxa-calculada-do-bl`).
--
-- 1. Guarda antes da leitura em `add_manual_bl_charge` e
--    `update_manual_bl_charge`. Os invólucros da 492 conferiam a isenção à mão
--    do B/L antes de a função interna conferir o usuário: um usuário do Portal
--    (ou sem perfil interno) recebia "B/L isento das Taxas Locais" para o B/L
--    de outro Cliente e ficava sabendo que ele existe e está isento. Agora a
--    recusa é sempre "Usuario sem permissao ativa".
-- 2. A prévia do efeito na fatura (`_bl_charge_change_invoice_state`, 493)
--    passa a seguir a mesma ordem de decisão da correção automática
--    (`apply_invoice_basis_changes`):
--    - sem Portal pronto e sem Liberação de faturamento vigente, a reemissão
--      não sai (a correção deixa a fatura valendo com Fatura desatualizada); a
--      prévia dizia "será cancelada e reemitida";
--    - com pagamento, o abatimento é o saldo em aberto do recebível deste B/L,
--      como em `_register_invoice_correction_core`; a prévia usava o total pago
--      das faturas, que na consolidada inclui o pagamento dos outros B/Ls
--      ("R$ 0,00 saem do saldo e R$ 250,00 viram Restituição" quando a
--      correção abatia R$ 200,00 e restituía R$ 50,00);
--    - a fatura nomeada é a individual do B/L, cujo valor é o da frase; a
--      consolidada viva entra na frase ("volta só com os mesmos B/Ls" ou "é
--      encerrada sem reemissão"). Antes a frase dava o número da consolidada
--      com o valor só deste B/L.
-- 3. A simulação da mudança de base (`_apply_bl_charge_simulation_change`, 495)
--    aceita SOC/COC: `container_flags[].ownership` vale para o container em
--    todos os B/Ls ativos da Viagem (como `set_bl_container_ownership`) e
--    `container_ownership` só no B/L, sem trocar o SOC/COC corrigido à mão
--    (como a reimportação do B/L). A troca muda a quantidade do item que não
--    cobra de SOC, e a correção de container e a reimportação não perguntavam.
-- 4. A prévia da mudança de base (`preview_bl_charge_adjustment_impact`, 495)
--    inclui o B/L da Viagem que já tem o container que a mudança acrescenta: o
--    rateio dele muda na gravação (quantidade de taxa com total alterado), e a
--    prévia não o listava.
--
-- Não muda dado.
--
-- Rollback: recriar `add_manual_bl_charge`, `update_manual_bl_charge` (492),
-- `_bl_charge_change_invoice_state`, `_bl_charge_change_effect_message` (493),
-- `_apply_bl_charge_simulation_change` e `preview_bl_charge_adjustment_impact`
-- (495).

-- 1. Guarda antes da leitura ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_manual_bl_charge(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_bl_not_manually_exempt(upper(btrim(COALESCE(p_bl_id, ''))));
  RETURN public._add_manual_bl_charge_impl_106(p_bl_id, p_charge_item_id, p_quantity, p_notes, p_actor);
END;
$function$;
REVOKE ALL ON FUNCTION public.add_manual_bl_charge(text, bigint, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_manual_bl_charge(text, bigint, numeric, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_manual_bl_charge(p_charge_calculation_id bigint, p_quantity numeric, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;
  SELECT cc.bl_id INTO v_bl_id FROM public.charge_calculations cc WHERE cc.id = p_charge_calculation_id;
  IF v_bl_id IS NOT NULL THEN
    PERFORM public._assert_bl_not_manually_exempt(v_bl_id);
  END IF;
  RETURN public._update_manual_bl_charge_impl_491(p_charge_calculation_id, p_quantity, p_notes, p_actor);
END;
$function$;
REVOKE ALL ON FUNCTION public.update_manual_bl_charge(bigint, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_manual_bl_charge(bigint, numeric, text, uuid) TO authenticated;

-- 2. Prévia do efeito na fatura igual à correção -------------------------------

-- Mesma ordem de `apply_invoice_basis_changes`: sem mudança de valor; com
-- pagamento (abate o saldo do recebível e restitui o resto, ou Fatura
-- desatualizada); terminais em conflito; Portal sem prontidão nem Liberação;
-- reemissão (ou cancelamento, no B/L isento).
CREATE OR REPLACE FUNCTION public._bl_charge_change_invoice_state(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoices bigint[] := public._live_local_invoice_ids_for_bl(p_bl_id);
  v_invoice public.invoices;
  v_paid_invoice public.invoices;
  v_consolidated text;
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
  -- A fatura deste B/L: a individual, quando há; a consolidada viva entra na
  -- frase à parte.
  SELECT * INTO v_invoice FROM public.invoices i WHERE i.id = ANY(v_invoices)
   ORDER BY (i.invoice_type = 'individual') DESC, i.id DESC LIMIT 1;
  SELECT i.invoice_number INTO v_consolidated FROM public.invoices i
   WHERE i.id = ANY(v_invoices) AND i.invoice_type = 'consolidated' AND i.id <> v_invoice.id
   ORDER BY i.id DESC LIMIT 1;
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
    -- A fatura que recebeu, como a que a correção usa.
    SELECT * INTO v_paid_invoice FROM public.invoices i WHERE i.id = ANY(v_invoices)
     ORDER BY COALESCE(i.total_paid_brl, 0) DESC, i.id LIMIT 1;
    IF v_new > v_current THEN
      RETURN jsonb_build_object('situation', 'stale', 'invoice_id', v_paid_invoice.id, 'invoice_number', v_paid_invoice.invoice_number,
        'current_brl', v_current, 'new_brl', v_new, 'paid_brl', v_paid, 'diff_brl', v_new - v_current);
    END IF;
    -- Como `_register_invoice_correction_core`: abate o saldo em aberto do
    -- recebível deste B/L; o resto vira Restituição.
    v_open := COALESCE(v_receivable.balance_brl, greatest(v_current - v_paid, 0));
    v_offset := least(v_current - v_new, greatest(v_open, 0));
    v_refund := (v_current - v_new) - v_offset;
    RETURN jsonb_build_object('situation', 'refund', 'invoice_id', v_paid_invoice.id, 'invoice_number', v_paid_invoice.invoice_number,
      'current_brl', v_current, 'new_brl', v_new, 'paid_brl', v_paid, 'offset_brl', v_offset, 'refund_brl', v_refund);
  END IF;
  v_terminals := public.check_bl_terminal_pendencies(p_bl_id);
  IF cardinality(v_terminals) > 0 THEN
    RETURN jsonb_build_object('situation', 'blocked', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'current_brl', v_current, 'new_brl', v_new, 'reason', 'B/L misto com terminais em conflito');
  END IF;
  IF NOT public.customer_billing_access_ready((SELECT b.customer_id FROM public.bls b WHERE b.id = p_bl_id)) THEN
    RETURN jsonb_build_object('situation', 'blocked', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'current_brl', v_current, 'new_brl', v_new,
      'reason', 'Portal do Cliente não está pronto e não há Liberação de faturamento vigente');
  END IF;
  RETURN jsonb_build_object('situation', CASE WHEN v_quote->>'status' = 'exempt' THEN 'cancel' ELSE 'reissue' END,
    'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number, 'current_brl', v_current, 'new_brl', v_new,
    'consolidated_number', v_consolidated);
END;
$function$;
REVOKE ALL ON FUNCTION public._bl_charge_change_invoice_state(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bl_charge_change_effect_message(p_state jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_state->>'situation'
    WHEN 'reissue' THEN format('A fatura %s (%s) será cancelada e reemitida com número novo, no valor de %s.%s O Cliente recebe o aviso no Portal e um Pix novo.',
      p_state->>'invoice_number', public._brl_text((p_state->>'current_brl')::numeric), public._brl_text((p_state->>'new_brl')::numeric),
      CASE WHEN p_state->>'consolidated_number' IS NOT NULL
        THEN format(' A consolidada %s volta só com os mesmos B/Ls.', p_state->>'consolidated_number') ELSE '' END)
    WHEN 'cancel' THEN format('A fatura %s será cancelada, sem nova fatura.%s O Cliente vê a fatura em Canceladas no Portal.',
      p_state->>'invoice_number',
      CASE WHEN p_state->>'consolidated_number' IS NOT NULL
        THEN format(' A consolidada %s é encerrada sem reemissão; os demais B/Ls seguem pelas individuais.', p_state->>'consolidated_number') ELSE '' END)
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

-- 3. Simulação com SOC/COC -----------------------------------------------------

-- Corpo da 495 com SOC/COC: o item que não cobra de SOC (Drop Off, Damage
-- Protection) conta só os containers COC, e a quantidade da taxa com total
-- alterado muda com a troca.
CREATE OR REPLACE FUNCTION public._apply_bl_charge_simulation_change(p_change jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text := NULLIF(btrim(p_change->>'bl_id'), '');
  v_fields jsonb := COALESCE(p_change->'bls', '{}'::jsonb);
  v_item jsonb;
BEGIN
  IF v_bl IS NULL THEN RETURN; END IF;
  IF v_fields <> '{}'::jsonb THEN
    PERFORM set_config('vela.bl_terminal_override', 'on', true);
    UPDATE public.bls b SET
      pod = CASE WHEN v_fields ? 'pod' THEN NULLIF(btrim(v_fields->>'pod'), '') ELSE b.pod END,
      terminal_id = CASE WHEN v_fields ? 'pod' AND NULLIF(btrim(v_fields->>'pod'), '') IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,
      cargo_mode = CASE WHEN v_fields ? 'cargo_mode' THEN NULLIF(btrim(v_fields->>'cargo_mode'), '') ELSE b.cargo_mode END,
      bb_weight_ton = CASE WHEN v_fields ? 'bb_weight_ton' THEN NULLIF(v_fields->>'bb_weight_ton', '')::numeric ELSE b.bb_weight_ton END,
      bb_cbm = CASE WHEN v_fields ? 'bb_cbm' THEN NULLIF(v_fields->>'bb_cbm', '')::numeric ELSE b.bb_cbm END,
      bb_packages_qty = CASE WHEN v_fields ? 'bb_packages_qty' THEN NULLIF(v_fields->>'bb_packages_qty', '')::numeric ELSE b.bb_packages_qty END,
      bb_machine_qty = CASE WHEN v_fields ? 'bb_machine_qty' THEN NULLIF(v_fields->>'bb_machine_qty', '')::numeric ELSE b.bb_machine_qty END,
      total_weight_kg = CASE WHEN v_fields ? 'total_weight_kg' THEN NULLIF(v_fields->>'total_weight_kg', '')::numeric ELSE b.total_weight_kg END
    WHERE b.id = v_bl;
  END IF;

  DELETE FROM public.bl_containers c
   WHERE c.bl_id = v_bl
     AND (c.id IN (SELECT (x)::bigint FROM jsonb_array_elements_text(COALESCE(p_change->'remove_container_ids', '[]'::jsonb)) x)
       OR upper(c.container_number) IN (SELECT upper(btrim(x)) FROM jsonb_array_elements_text(COALESCE(p_change->'remove_container_numbers', '[]'::jsonb)) x));
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_change->'add_containers', '[]'::jsonb)) LOOP
    INSERT INTO public.bl_containers (bl_id, container_number, type, is_imo, is_oog)
    VALUES (v_bl, upper(btrim(v_item->>'container_number')), NULLIF(btrim(v_item->>'type'), ''),
      COALESCE((v_item->>'is_imo')::boolean, false), COALESCE((v_item->>'is_oog')::boolean, false));
  END LOOP;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_change->'container_flags', '[]'::jsonb)) LOOP
    UPDATE public.bl_containers c SET
      is_imo = COALESCE((v_item->>'is_imo')::boolean, c.is_imo),
      is_oog = COALESCE((v_item->>'is_oog')::boolean, c.is_oog),
      -- 497: SOC/COC, como `set_bl_container_ownership` (Part Lot).
      ownership = COALESCE(NULLIF(upper(btrim(v_item->>'ownership')), ''), c.ownership),
      type = COALESCE(NULLIF(btrim(v_item->>'type'), ''), c.type)
     -- Como `set_bl_container_profile`: o perfil vale para o container em
     -- todos os B/Ls ativos da Viagem (Part Lot).
     WHERE upper(c.container_number) = upper(btrim(v_item->>'container_number'))
       AND c.bl_id IN (SELECT b2.id FROM public.bls b2 JOIN public.bls b1 ON b1.id = v_bl
                        WHERE b2.voyage_id = b1.voyage_id AND b2.cancelled_at IS NULL);
  END LOOP;

  -- 497: SOC/COC do arquivo do B/L, só neste B/L e sem trocar o corrigido à
  -- mão, como a reimportação (migration 392).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_change->'container_ownership', '[]'::jsonb)) LOOP
    UPDATE public.bl_containers c SET ownership = upper(btrim(v_item->>'ownership'))
     WHERE c.bl_id = v_bl
       AND upper(btrim(c.container_number)) = upper(btrim(v_item->>'container_number'))
       AND NULLIF(btrim(v_item->>'ownership'), '') IS NOT NULL
       AND c.ownership_source IS DISTINCT FROM 'manual';
  END LOOP;

  DELETE FROM public.vehicles v
   WHERE v.bl_id = v_bl
     AND v.id IN (SELECT (x)::bigint FROM jsonb_array_elements_text(COALESCE(p_change->'remove_vehicle_ids', '[]'::jsonb)) x);
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_change->'move_vehicles', '[]'::jsonb)) LOOP
    UPDATE public.vehicles v SET bl_id = btrim(v_item->>'to_bl_id')
     WHERE v.id = (v_item->>'id')::bigint AND v.bl_id = v_bl;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._apply_bl_charge_simulation_change(jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Prévia da mudança de base com o B/L que passa a dividir o container ------

-- Corpo da 495; só a lista de B/Ls afetados ganha o B/L da Viagem que já tem o
-- container acrescentado.
CREATE OR REPLACE FUNCTION public.preview_bl_charge_adjustment_impact(p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_changes jsonb := CASE WHEN jsonb_typeof(p_changes) = 'array' THEN p_changes ELSE '[]'::jsonb END;
  v_targets text[];
  v_candidates text[];
  v_before jsonb := '{}'::jsonb;
  v_after_lines jsonb := '{}'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_max_event bigint;
  v_change jsonb;
  v_bl text;
  v_bl_row record;
  v_out jsonb := '[]'::jsonb;
  v_items jsonb;
  v_adj jsonb;
  v_event jsonb;
  v_after_qty numeric;
  v_outcome text;
  v_error text;
BEGIN
  -- A simulação trava linhas até o rollback: só quem grava pode rodá-la.
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT btrim(c->>'bl_id')) INTO v_targets
    FROM jsonb_array_elements(v_changes) c WHERE NULLIF(btrim(c->>'bl_id'), '') IS NOT NULL;
  IF v_targets IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Irmãos de container: o rateio muda a quantidade deles também.
  SELECT array_agg(DISTINCT x.id) INTO v_candidates FROM (
    SELECT unnest(v_targets) AS id
    UNION
    SELECT c2.bl_id FROM public.bl_containers c1
      JOIN public.bls b1 ON b1.id = c1.bl_id
      JOIN public.bl_containers c2 ON upper(c2.container_number) = upper(c1.container_number) AND c2.bl_id <> c1.bl_id
      JOIN public.bls b2 ON b2.id = c2.bl_id AND b2.voyage_id = b1.voyage_id
     WHERE c1.bl_id = ANY(v_targets)
    UNION
    -- 497: o container acrescentado que já está em outro B/L da Viagem passa a
    -- ser dividido, e o rateio desse B/L muda na gravação.
    SELECT c2.bl_id FROM jsonb_array_elements(v_changes) c
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c->'add_containers', '[]'::jsonb)) n
      JOIN public.bls b1 ON b1.id = btrim(c->>'bl_id')
      JOIN public.bl_containers c2 ON upper(c2.container_number) = upper(btrim(n->>'container_number')) AND c2.bl_id <> b1.id
      JOIN public.bls b2 ON b2.id = c2.bl_id AND b2.voyage_id = b1.voyage_id
    UNION
    SELECT btrim(m->>'to_bl_id') FROM jsonb_array_elements(v_changes) c,
      jsonb_array_elements(COALESCE(c->'move_vehicles', '[]'::jsonb)) m
  ) x
  JOIN public.bls b ON b.id = x.id AND b.cancelled_at IS NULL
  WHERE EXISTS (SELECT 1 FROM public.bl_charge_adjustments a WHERE a.bl_id = x.id AND a.ended_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = x.id);
  IF v_candidates IS NULL THEN RETURN '[]'::jsonb; END IF;

  FOREACH v_bl IN ARRAY v_candidates LOOP
    v_before := v_before || jsonb_build_object(v_bl, public._bl_charge_adjustment_snapshot(v_bl));
  END LOOP;
  SELECT COALESCE(max(id), 0) INTO v_max_event FROM public.bl_charge_adjustment_events;

  BEGIN
    PERFORM set_config('vela.bl_charge_simulation', 'on', true);
    FOR v_change IN SELECT * FROM jsonb_array_elements(v_changes) LOOP
      PERFORM public._apply_bl_charge_simulation_change(v_change);
    END LOOP;
    FOREACH v_bl IN ARRAY v_candidates LOOP
      SELECT b.id, b.pod, COALESCE(b.financial_status, 'pending') AS financial_status INTO v_bl_row
        FROM public.bls b WHERE b.id = v_bl;
      IF v_bl_row.financial_status NOT IN ('invoiced', 'partially_paid', 'paid') THEN
        PERFORM public.bind_bl_local_charge_tables(v_bl);
        PERFORM public._reconcile_bl_charge_adjustments(v_bl);
      END IF;
      v_after_lines := v_after_lines || jsonb_build_object(v_bl, (
        SELECT COALESCE(jsonb_object_agg(r.calculation_key, r.quantity), '{}'::jsonb)
          FROM public._resolve_bl_local_charge_items_charged(v_bl, v_bl_row.pod) r
         WHERE r.calculation_key IS NOT NULL));
    END LOOP;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bl_id', e.bl_id, 'event', e.event, 'line_key', e.line_key,
             'after', e.after) ORDER BY e.id), '[]'::jsonb)
      INTO v_events
      FROM public.bl_charge_adjustment_events e
     WHERE e.id > v_max_event AND e.bl_id = ANY(v_candidates) AND e.event IN ('discarded', 'remapped');
    PERFORM set_config('vela.bl_charge_simulation', 'off', true);
    RAISE EXCEPTION 'simulação desfeita' USING ERRCODE = 'VB495';
  EXCEPTION
    WHEN SQLSTATE 'VB495' THEN NULL;
    WHEN OTHERS THEN
      v_error := SQLERRM;
  END;
  PERFORM set_config('vela.bl_charge_simulation', 'off', true);

  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_array(jsonb_build_object('error', v_error));
  END IF;

  FOREACH v_bl IN ARRAY v_candidates LOOP
    v_items := '[]'::jsonb;
    FOR v_adj IN SELECT * FROM jsonb_array_elements(v_before->v_bl) LOOP
      SELECT ev INTO v_event FROM jsonb_array_elements(v_events) ev
       WHERE ev->>'bl_id' = v_bl AND ev->>'line_key' = v_adj->>'line_key' LIMIT 1;
      v_after_qty := NULLIF(v_after_lines->v_bl->>(v_adj->>'line_key'), '')::numeric;
      IF v_event->>'event' = 'discarded' THEN
        v_outcome := 'discarded';
      ELSIF v_event->>'event' = 'remapped' THEN
        v_outcome := 'remapped';
      ELSIF v_adj->>'kind' IN ('unit', 'total') AND v_adj->>'source' = 'auto' AND v_after_qty IS NOT NULL
            AND v_after_qty IS DISTINCT FROM (v_adj->>'quantity')::numeric THEN
        v_outcome := CASE WHEN v_adj->>'kind' = 'total' THEN 'total_kept' ELSE 'quantity' END;
      ELSE
        v_outcome := 'kept';
      END IF;
      v_items := v_items || jsonb_build_array(v_adj || jsonb_build_object(
        'outcome', v_outcome,
        'after_quantity', COALESCE(v_after_qty, (v_adj->>'quantity')::numeric),
        'after_total', CASE
          WHEN v_outcome = 'quantity' THEN round((v_adj->>'value')::numeric * v_after_qty, 2)
          WHEN v_outcome = 'discarded' THEN NULL
          ELSE (v_adj->>'total')::numeric END,
        'reason', v_event->'after'->>'reason',
        'table_name', v_event->'after'->>'table_name',
        'pod', v_event->'after'->>'pod',
        'needs_confirmation', v_outcome IN ('discarded', 'total_kept')));
      v_event := NULL;
    END LOOP;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl,
      'manual_exempt', EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = v_bl),
      'items', v_items));
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.preview_bl_charge_adjustment_impact(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_bl_charge_adjustment_impact(jsonb) TO authenticated;
