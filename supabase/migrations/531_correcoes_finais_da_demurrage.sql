-- 531: correções finais da Demurrage (revisão independente da PR
-- luccafwlog/vela#1113, ADR 0112 D7, D10, D22 e D24).
--
-- 1. Caixa dispensada ainda fora (517): a classificação punha o grupo em A
--    emitir, mas a conferência adiada da emissão
--    (`assert_demurrage_invoice_complete`) e a gravação de datas
--    (`_after_container_dates`) ainda exigiam todas as caixas devolvidas.
--    Gerar Invoice falhava no COMMIT e a rotina da 526 enfileirava uma
--    tentativa por dia que falhava. As duas passam a ignorar a caixa dispensada.
-- 2. A varredura da 529 regravava a cada 15 minutos a Invoice paga ou
--    negociada com o Alerta de diferença ainda aberto (`updated_at` e uma linha
--    no histórico por passada). Pula também com o Alerta aberto no mesmo
--    estado, e o motivo igual não regrava a linha.
-- 3. A dispensa do B/L sem Cliente passava ao Cliente vinculado e dispensava
--    a caixa do B/L verdadeiro dele. Só a troca de Cliente (correção de CNPJ)
--    leva a dispensa, e não quando o Cliente novo já tem a caixa em outro B/L
--    ativo.
-- 4. B/L cancelado cuja caixa um B/L ativo de outro Cliente da Viagem tem
--    (D22) aparecia em Travado, com Alerta e US$ em dobro. A caixa fica só no
--    B/L ativo, de qualquer Cliente.
-- 5. Sem conta de sistema, a rotina avisa no log ao não enfileirar A emitir.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: recriar `assert_demurrage_invoice_complete` e
-- `_after_container_dates` (214), `_reconcile_demurrage_after_dates` e
-- `reconcile_demurrage_travado_alerts` (529), `_demurrage_waivers_follow_customer`
-- e `_demurrage_billing_board_core` (530).

CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_complete(p_invoice_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_customer_id bigint;
  v_voyage_id bigint;
  v_group text[];
  v_expected integer;
  v_items integer;
BEGIN
  SELECT di.bl_id, di.customer_id, b.voyage_id INTO v_bl_id, v_customer_id, v_voyage_id
  FROM public.demurrage_invoices AS di
  LEFT JOIN public.bls AS b ON b.id = di.bl_id
  WHERE di.id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = p_invoice_id AND status IN ('issued', 'paid')) THEN
    -- Mesma trava da emissão (214): duas transações não cobram a mesma caixa.
    PERFORM public._lock_demurrage_box_billing(v_voyage_id, v_customer_id);
    v_group := public.demurrage_group_bl_ids(v_bl_id);
    -- Caixas que esta Invoice deve trazer: as não-SOC do grupo que nenhuma
    -- outra Invoice viva da Viagem e do Cliente cobre (complementar, 214).
    SELECT count(DISTINCT upper(btrim(c.container_number))) INTO v_expected
    FROM public.bl_containers AS c
    WHERE c.bl_id = ANY(v_group) AND c.ownership IS DISTINCT FROM 'SOC'
      AND NOT EXISTS (
        SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_customer_id, p_invoice_id) AS billed
        WHERE billed.container_key = upper(btrim(c.container_number))
      );
    IF v_expected = 0 THEN
      IF EXISTS (SELECT 1 FROM public.demurrage_invoice_items WHERE invoice_id = p_invoice_id) THEN
        RAISE EXCEPTION 'Demurrage do B/L % possui itens sem containers físicos correspondentes ou já cobrados em outra Invoice.', v_bl_id USING ERRCODE = '23514';
      END IF;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.bl_containers AS c
      WHERE c.bl_id = ANY(v_group) AND c.return_date IS NULL AND c.ownership IS DISTINCT FROM 'SOC'
        -- 531: a caixa dispensada ainda fora não segura o grupo (517).
        AND NOT EXISTS (SELECT 1 FROM public._demurrage_waived_container_keys(v_voyage_id, v_customer_id) AS waived
                         WHERE waived.container_key = upper(btrim(c.container_number)))
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id AND item.return_date IS NULL
    ) THEN
      RAISE EXCEPTION 'Demurrage só pode ser emitida após a devolução de todos os containers do B/L %.', v_bl_id USING ERRCODE = '23514';
    END IF;

    SELECT count(DISTINCT upper(btrim(item.container_number))) INTO v_items
    FROM public.demurrage_invoice_items AS item WHERE item.invoice_id = p_invoice_id;
    IF v_items <> v_expected OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
      GROUP BY upper(btrim(item.container_number))
      HAVING count(*) > 1
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
        AND NOT EXISTS (
          SELECT 1 FROM public.bl_containers AS bc
          WHERE bc.id = item.container_id AND bc.bl_id = ANY(v_group) AND bc.ownership IS DISTINCT FROM 'SOC'
        )
    ) OR EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public._demurrage_billed_container_keys(v_voyage_id, v_customer_id, p_invoice_id) AS billed
        ON billed.container_key = upper(btrim(item.container_number))
      WHERE item.invoice_id = p_invoice_id
    ) THEN
      RAISE EXCEPTION 'Demurrage do B/L % não contém o conjunto completo e exclusivo de containers.', v_bl_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._after_container_dates(p_request_id uuid, p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text;
  v_anchor text;
  v_enqueued text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_bl IN ARRAY COALESCE(p_bl_ids, ARRAY[]::text[]) LOOP
    v_anchor := public.demurrage_group_anchor(v_bl);
    CONTINUE WHEN v_anchor IS NULL OR v_anchor = ANY(v_enqueued);
    IF NOT EXISTS (
      SELECT 1 FROM public.bls AS anchor
      JOIN public.bl_containers AS c ON c.bl_id = ANY(public.demurrage_group_bl_ids(v_anchor))
      WHERE anchor.id = v_anchor
        AND c.ownership IS DISTINCT FROM 'SOC' AND c.return_date IS NULL
        -- 531: a caixa dispensada ainda fora não segura o grupo (517).
        AND NOT EXISTS (SELECT 1 FROM public._demurrage_waived_container_keys(anchor.voyage_id, anchor.customer_id) AS waived
                         WHERE waived.container_key = upper(btrim(c.container_number)))
    ) AND EXISTS (
      -- Caixa não-SOC do grupo ainda sem Invoice viva da Viagem e do Cliente
      -- (214): o irmão que chega depois com caixa nova também é cobrado.
      SELECT 1
      FROM public.bls AS anchor
      JOIN public.bl_containers AS c ON c.bl_id = ANY(public.demurrage_group_bl_ids(v_anchor))
      WHERE anchor.id = v_anchor
        AND c.ownership IS DISTINCT FROM 'SOC'
        AND NULLIF(btrim(c.container_number), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public._demurrage_billed_container_keys(anchor.voyage_id, anchor.customer_id) AS billed
          WHERE billed.container_key = upper(btrim(c.container_number))
        )
    ) THEN
      INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
      VALUES (p_request_id, 'demurrage_billing', v_anchor, p_actor)
      ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
      v_enqueued := array_append(v_enqueued, v_anchor);
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'demurrage_effects', to_jsonb(v_enqueued),
    'demurrage_invoices', public._reconcile_demurrage_after_dates(p_bl_ids, p_actor)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._reconcile_demurrage_after_dates(p_bl_ids text[], p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_invoice_id bigint;
  v_result jsonb := '[]'::jsonb;
  v_reissue jsonb;
  v_previous text := current_setting('vela.demurrage_internal', true);
  v_paid boolean;
  v_negotiated boolean;
  v_voyage_id bigint;
  v_keys text[];
  v_tried text[];
  v_waiting text[];
  v_extra jsonb;
  v_next_bl text;
  v_attempt jsonb;
  v_unbilled text[];
  v_message text;
  v_state text;
BEGIN
  FOR v_invoice_id IN
    SELECT DISTINCT di.id
    FROM unnest(p_bl_ids) AS changed(bl_id)
    JOIN public.demurrage_invoices AS di
      ON di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
      -- A Invoice que cobra caixa deste B/L, mesmo ancorada fora do grupo de
      -- hoje (grupo que se dividiu depois da emissão, 214).
      OR EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS own_item
        JOIN public.bl_containers AS own ON own.id = own_item.container_id
        WHERE own_item.invoice_id = di.id AND own.bl_id = changed.bl_id
      )
    WHERE di.status IN ('issued', 'overdue', 'paid')
      AND EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = di.id
          AND public._demurrage_item_stale(item.id)
      )
    ORDER BY di.id
  LOOP
    -- A decisão vale para a linha travada (211): uma baixa que confirmou
    -- depois da leitura acima não tem a Invoice paga cancelada e reemitida.
    SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = v_invoice_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND OR v_invoice.status NOT IN ('issued', 'overdue', 'paid');
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = v_invoice.id
        AND public._demurrage_item_stale(item.id)
    );
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    -- 521 (D22): sem data diferente, o que mudou foi a divisão da caixa.
    v_message := format(CASE WHEN EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = v_invoice.id
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date))
      THEN 'As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.'
      -- 522 (D20): a caixa que virou SOC sai da cobrança, não é cobrança perdida.
      WHEN EXISTS (
        SELECT 1 FROM public.demurrage_invoice_items AS item
        JOIN public.bl_containers AS c ON c.id = item.container_id
        WHERE item.invoice_id = v_invoice.id AND c.ownership = 'SOC')
      THEN 'Container da Invoice de Demurrage %s passou a SOC depois da emissão e sai da cobrança%s.'
      -- 529: o B/L da Invoice foi cancelado e a caixa ficou só com os outros Clientes.
      WHEN EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = v_invoice.bl_id AND b.cancelled_at IS NOT NULL)
      THEN 'O B/L da Invoice de Demurrage %s foi cancelado depois da emissão e a caixa passou a ser cobrada só dos outros Clientes%s.'
      ELSE 'A divisão das caixas entre Clientes da Invoice de Demurrage %s mudou depois da emissão%s.' END,
        v_invoice.doc_number, CASE
          WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança'
          WHEN v_negotiated THEN ' e ela tem desconto ou disputa aberta: a Régua suspendeu a cobrança; cancele, gere de novo e refaça o desconto ou responda a disputa'
          ELSE '' END);

    IF v_paid OR v_negotiated THEN
      -- 529: a diferença já avisada e tratada (Alerta resolvido com o mesmo
      -- estado) não reabre o Alerta nem suspende de novo; diferença nova sim.
      v_state := public._demurrage_stale_state(v_invoice.id);
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.alert_items AS i JOIN public.alerts AS a ON a.id = i.alert_id
         WHERE i.item_type = 'demurrage_invoice_dates_changed'
           -- 531: também o Alerta ainda aberto com o mesmo estado: a varredura
           -- não regrava a Invoice a cada passada.
           AND a.entity_type = 'demurrage_invoice' AND a.entity_id = v_invoice.id::text
           AND i.metadata->>'stale_state' = v_state);
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, v_message,
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated,
          'stale_state', v_state),
        '/demurrage');
      UPDATE public.demurrage_invoices
         -- 524: o motivo diz a causa (datas, SOC ou divisão da caixa).
         SET dunning_suspended_reason = public._demurrage_stale_reason(v_invoice.id, v_paid)
       WHERE id = v_invoice.id
         -- 317 (R5): a suspensão pela recusa do provedor (D6) fica; ao
         -- resolver o alerta, a retomada aplica a suspensão por datas.
         AND (dunning_suspended_reason IS NULL OR dunning_suspended_reason NOT LIKE 'Cobrança recusada pelo provedor%')
         -- 531: o mesmo motivo não regrava a linha (updated_at e histórico).
         AND dunning_suspended_reason IS DISTINCT FROM public._demurrage_stale_reason(v_invoice.id, v_paid);
      v_result := v_result || jsonb_build_array(jsonb_build_object('invoice_id', v_invoice.id, 'status', 'suspended'));
      CONTINUE;
    END IF;

    -- Sem pagamento: cancela e reemite com as datas atuais (ou só cancela).
    UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now()
     WHERE id = v_invoice.id AND status IN ('issued', 'overdue') AND paid_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      'Datas de container alteradas: cancelada para reemissão automática.');
    v_extra := '[]'::jsonb;
    v_unbilled := ARRAY[]::text[];
    v_voyage_id := NULL;
    IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_invoice.bl_id AND cancelled_at IS NOT NULL) THEN
      v_reissue := jsonb_build_object('status', 'bl_cancelled', 'bl_id', v_invoice.bl_id);
    -- Viagem Cancelada não recebe Invoice de Demurrage (211): só cancela.
    ELSIF EXISTS (
      SELECT 1 FROM public.bls AS b JOIN public.voyages AS v ON v.id = b.voyage_id
      WHERE b.id = v_invoice.bl_id AND v.status = 'cancelled'
    ) THEN
      v_reissue := jsonb_build_object('status', 'voyage_cancelled', 'bl_id', v_invoice.bl_id);
    ELSE
      -- Cada caixa uma vez (214): a reemissão cobra as caixas da Invoice
      -- cancelada que nenhuma outra Invoice viva cobre. Primeiro pelo grupo do
      -- B/L dela; a caixa que saiu desse grupo, pelo âncora do B/L ativo que
      -- ainda a tem. Cada âncora é tentado uma vez.
      SELECT voyage_id INTO v_voyage_id FROM public.bls WHERE id = v_invoice.bl_id;
      SELECT COALESCE(array_agg(DISTINCT upper(btrim(item.container_number))), ARRAY[]::text[]) INTO v_keys
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = v_invoice.id AND NULLIF(btrim(item.container_number), '') IS NOT NULL
        -- 522 (D20): a caixa que virou SOC não é cobrada de novo nem conta
        -- como caixa que a reemissão deixou de cobrar.
        AND NOT EXISTS (SELECT 1 FROM public.bl_containers AS c WHERE c.id = item.container_id AND c.ownership = 'SOC');
      v_tried := ARRAY[]::text[];
      v_waiting := ARRAY[]::text[];
      v_next_bl := v_invoice.bl_id;
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      -- 484 (decisão do dono, P7): o Cliente já via a Invoice cancelada; a
      -- substituta sai mesmo com o gate fechado.
      PERFORM set_config('vela.demurrage_reissue_visible', 'on', true);
      LOOP
        v_attempt := public.issue_demurrage_invoice_for_bl(v_next_bl, NULL);
        -- 472 (DEM-D08): a Invoice reemitida guarda qual cancelada ela substitui.
        IF v_attempt->>'status' = 'issued' AND (v_attempt->>'invoice_id') IS NOT NULL THEN
          UPDATE public.demurrage_invoices SET replaces_invoice_id = v_invoice.id
           WHERE id = (v_attempt->>'invoice_id')::bigint;
        END IF;
        IF cardinality(v_tried) = 0 THEN
          v_reissue := v_attempt;
        ELSE
          v_extra := v_extra || jsonb_build_array(v_attempt || jsonb_build_object('bl_id', v_next_bl));
        END IF;
        v_tried := array_append(v_tried, COALESCE(v_attempt->>'anchor_bl_id', v_next_bl));
        -- Sem sobreestadia ou aguardando devolução: as caixas do grupo ficam
        -- sem Invoice por regra, não por perda (a devolução enfileira de novo).
        IF v_attempt->>'status' IN ('no_overstay', 'waiting_return') THEN
          v_waiting := v_waiting || ARRAY(
            SELECT DISTINCT upper(btrim(c.container_number)) FROM public.bl_containers AS c
            WHERE c.bl_id = ANY(public.demurrage_group_bl_ids(COALESCE(v_attempt->>'anchor_bl_id', v_next_bl))));
        END IF;
        SELECT holder.id INTO v_next_bl
        FROM unnest(v_keys) AS k(container_key)
        JOIN public.bl_containers AS c ON upper(btrim(c.container_number)) = k.container_key
        JOIN public.bls AS holder ON holder.id = c.bl_id
        WHERE holder.voyage_id = v_voyage_id AND holder.customer_id = v_invoice.customer_id
          AND holder.cancelled_at IS NULL
          AND c.ownership IS DISTINCT FROM 'SOC'
          AND k.container_key <> ALL(v_waiting)
          AND NOT EXISTS (
            SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
            WHERE billed.container_key = k.container_key)
          AND public.demurrage_group_anchor(holder.id) <> ALL(v_tried)
        ORDER BY k.container_key, holder.id
        LIMIT 1;
        EXIT WHEN NOT FOUND;
      END LOOP;
      PERFORM set_config('vela.demurrage_internal', COALESCE(v_previous, ''), true);
      PERFORM set_config('vela.demurrage_reissue_visible', '', true);
      SELECT COALESCE(array_agg(k.container_key ORDER BY k.container_key), ARRAY[]::text[]) INTO v_unbilled
      FROM unnest(v_keys) AS k(container_key)
      WHERE k.container_key <> ALL(v_waiting)
        AND NOT EXISTS (
          SELECT 1 FROM public._demurrage_billed_container_keys(v_voyage_id, v_invoice.customer_id) AS billed
          WHERE billed.container_key = k.container_key);
    END IF;
    IF cardinality(v_unbilled) > 0 THEN
      -- Caixa da Invoice cancelada que ficou sem cobrança não é sucesso: o
      -- Alerta diz quais caixas conferir e fecha quando todas estiverem numa
      -- Invoice viva (349, resolve_demurrage_dates_changed_on_billing).
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text,
        v_message || format(
          ' A reemissão automática não cobrou o(s) container(s) %s: %s',
          array_to_string(v_unbilled, ', '),
          CASE WHEN v_reissue->>'status' = 'blocked'
            THEN 'a emissão aguarda: ' || (v_reissue->>'reason') || ' A nova Invoice sai sozinha quando o motivo for resolvido.'
            ELSE 'confira o grupo e emita a Demurrage deles.' END),
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated,
          'voyage_id', v_voyage_id, 'customer_id', v_invoice.customer_id,
          'unbilled_containers', to_jsonb(v_unbilled), 'reissue_status', v_reissue->>'status'),
        '/demurrage');
    ELSE
      -- 349 (P1): a reemissão cobriu todas as caixas, ou não havia o que
      -- cobrar (B/L ou Viagem cancelados, sem sobreestadia, aguardando
      -- devolução). Nada a conferir: o alerta não fica aberto.
      PERFORM public.resolve_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, 'container-dates',
        jsonb_build_object('resolution', 'reissue_complete', 'invoice_id', v_invoice.id,
          'reissue_status', v_reissue->>'status'));
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'invoice_id', v_invoice.id, 'status', 'cancelled', 'reissue', v_reissue,
      'reissue_extra', v_extra, 'unbilled_containers', to_jsonb(v_unbilled),
      'reissue_complete', cardinality(v_unbilled) = 0));
  END LOOP;

  -- Com as datas de volta às faturadas, a Invoice com desconto ou disputa sai
  -- da suspensão (a paga sai pelo estorno, como na 191).
  UPDATE public.demurrage_invoices AS di
     SET dunning_suspended_reason = NULL
    FROM unnest(p_bl_ids) AS changed(bl_id)
   WHERE di.bl_id = ANY(public.demurrage_group_bl_ids(changed.bl_id) || changed.bl_id)
     AND di.status IN ('issued', 'overdue')
     AND di.paid_at IS NULL
     AND di.dunning_suspended_reason LIKE '% em Invoice com desconto ou disputa; reemitir à mão.'
     AND NOT EXISTS (
       SELECT 1 FROM public.demurrage_invoice_items AS item
       JOIN public.bl_containers AS c ON c.id = item.container_id
       WHERE item.invoice_id = di.id
         AND public._demurrage_item_stale(item.id)
     );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._demurrage_waivers_follow_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_waiver record;
BEGIN
  -- 531: vincular Cliente a B/L sem Cliente não é correção de CNPJ; a dispensa
  -- do B/L sem Cliente (para cancelá-lo) fica nele.
  IF OLD.customer_id IS NULL THEN
    RETURN NEW;
  END IF;
  FOR v_waiver IN
    SELECT w.id, w.container_key
      FROM public.demurrage_box_waivers AS w
     WHERE w.revoked_at IS NULL AND w.voyage_id = NEW.voyage_id
       AND w.customer_id IS NOT DISTINCT FROM OLD.customer_id
       AND w.container_key IN (
         SELECT upper(btrim(c.container_number)) FROM public.bl_containers AS c WHERE c.bl_id = NEW.id)
       -- Outro B/L ativo do Cliente antigo com a caixa: a dispensa é dele.
       AND NOT EXISTS (
         SELECT 1 FROM public.bl_containers AS oc JOIN public.bls AS ob ON ob.id = oc.bl_id
          WHERE ob.id <> NEW.id AND ob.cancelled_at IS NULL AND ob.voyage_id = NEW.voyage_id
            AND ob.customer_id IS NOT DISTINCT FROM OLD.customer_id
            AND upper(btrim(oc.container_number)) = w.container_key)
       -- 531: o Cliente novo já tem a caixa em outro B/L ativo: a cobrança é dele.
       AND NOT EXISTS (
         SELECT 1 FROM public.bl_containers AS nc JOIN public.bls AS nb ON nb.id = nc.bl_id
          WHERE nb.id <> NEW.id AND nb.cancelled_at IS NULL AND nb.voyage_id = NEW.voyage_id
            AND nb.customer_id = NEW.customer_id AND nc.ownership IS DISTINCT FROM 'SOC'
            AND upper(btrim(nc.container_number)) = w.container_key)
       -- O Cliente novo já tem a caixa dispensada.
       AND NOT EXISTS (
         SELECT 1 FROM public.demurrage_box_waivers AS nw
          WHERE nw.revoked_at IS NULL AND nw.voyage_id = NEW.voyage_id
            AND nw.customer_id IS NOT DISTINCT FROM NEW.customer_id AND nw.container_key = w.container_key)
  LOOP
    UPDATE public.demurrage_box_waivers SET customer_id = NEW.customer_id WHERE id = v_waiver.id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', NEW.id, 'demurrage_dispensa', OLD.customer_id::text, NEW.customer_id::text, auth.uid(),
      format('A dispensa da cobrança da caixa %s acompanhou a troca de Cliente do B/L.', v_waiver.container_key));
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._demurrage_billing_board_core(p_customer_id bigint DEFAULT NULL::bigint, p_voyage_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_result jsonb;
BEGIN
  WITH candidate_bls AS (
    -- B/Ls com caixa não-SOC numa Viagem que não foi cancelada.
    SELECT DISTINCT b.id, b.voyage_id, b.customer_id, b.cancelled_at
      FROM public.bls AS b
      JOIN public.voyages AS v ON v.id = b.voyage_id
      JOIN public.bl_containers AS c ON c.bl_id = b.id
     WHERE v.status IS DISTINCT FROM 'cancelled'
       AND c.ownership IS DISTINCT FROM 'SOC'
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       AND (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
       AND (p_customer_id IS NULL OR b.customer_id = p_customer_id)
  ), grouped AS (
    -- B/L ativo: o grupo do banco (mesmo Cliente e Viagem, caixa dividida).
    -- B/L cancelado ou sem Cliente: ele sozinho.
    SELECT cb.id AS bl_id, cb.voyage_id, cb.customer_id, cb.cancelled_at,
           CASE
             WHEN cb.cancelled_at IS NOT NULL OR cb.customer_id IS NULL THEN ARRAY[cb.id]
             ELSE public.demurrage_group_bl_ids(cb.id)
           END AS group_ids
      FROM candidate_bls AS cb
  ), groups AS (
    SELECT DISTINCT ON (g.group_ids[1]) g.group_ids[1] AS anchor_bl_id, g.group_ids, g.voyage_id, g.customer_id,
           (g.cancelled_at IS NOT NULL) AS cancelled
      FROM grouped AS g
     ORDER BY g.group_ids[1], g.bl_id
  ), boxes AS (
    -- Uma linha por caixa (número) do grupo, a do âncora primeiro, como a emissão.
    SELECT DISTINCT ON (gr.anchor_bl_id, upper(btrim(c.container_number)))
           gr.anchor_bl_id, c.id AS container_id, c.bl_id, upper(btrim(c.container_number)) AS container_key,
           c.container_number, c.type, c.discharge_date, c.return_date,
           b.free_time_override, b.demurrage_rate_override_p1_usd, b.demurrage_rate_override_p2_usd,
           -- 521 (D19): o previsto é a parte do Cliente na caixa dividida.
           public._demurrage_box_share_count(gr.voyage_id, upper(btrim(c.container_number)), gr.customer_id) AS share_count
      FROM groups AS gr
      JOIN public.bl_containers AS c ON c.bl_id = ANY(gr.group_ids)
      JOIN public.bls AS b ON b.id = c.bl_id
     WHERE c.ownership IS DISTINCT FROM 'SOC'
       AND NULLIF(btrim(c.container_number), '') IS NOT NULL
       -- 526: a caixa do B/L cancelado que um B/L ativo do mesmo Cliente na
       -- Viagem segura é cobrada por ele (517 aceita esse cancelamento); não
       -- aparece também no cancelado.
       -- 531: de qualquer Cliente (D22: a caixa passa a ser cobrada só dos
       -- Clientes ativos).
       AND NOT (gr.cancelled AND EXISTS (
         SELECT 1 FROM public.bl_containers AS oc JOIN public.bls AS ob ON ob.id = oc.bl_id
          WHERE ob.voyage_id = gr.voyage_id AND ob.cancelled_at IS NULL
            AND oc.ownership IS DISTINCT FROM 'SOC'
            AND upper(btrim(oc.container_number)) = upper(btrim(c.container_number))))
     ORDER BY gr.anchor_bl_id, upper(btrim(c.container_number)), (c.bl_id = gr.anchor_bl_id) DESC, c.id
  ), resolved AS (
    SELECT bx.*, gr.customer_id, gr.voyage_id,
           public._demurrage_canonical_type(bx.type) AS rate_group,
           rate.free_days AS table_free_days, rate.p1_day_to, rate.p1_usd AS table_p1_usd,
           rate.p2_day_from, rate.p2_usd AS table_p2_usd,
           agreement.free_days AS agreement_free_days, agreement.p1_usd AS agreement_p1_usd,
           agreement.p2_usd AS agreement_p2_usd,
           covering.invoice_id AS covered_by,
           waiver.id AS waiver_id
      FROM boxes AS bx
      JOIN groups AS gr ON gr.anchor_bl_id = bx.anchor_bl_id
      LEFT JOIN LATERAL (
        SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
          FROM public._active_demurrage_rates(v_today) AS r
         WHERE public._demurrage_canonical_type(r.container_type) = public._demurrage_canonical_type(bx.type)
         ORDER BY r.valid_from DESC, r.id DESC
         LIMIT 1
      ) AS rate ON true
      LEFT JOIN LATERAL (
        SELECT a.free_days, a.p1_usd, a.p2_usd
          FROM public.customer_demurrage_agreements AS a
         WHERE a.customer_id = gr.customer_id AND a.active
           AND bx.discharge_date IS NOT NULL
           AND bx.discharge_date >= a.valid_from
           AND (a.valid_to IS NULL OR bx.discharge_date <= a.valid_to)
         ORDER BY a.valid_from DESC, a.id DESC
         LIMIT 1
      ) AS agreement ON true
      -- 517: dispensa da cobrança da caixa (Viagem, Cliente, número).
      LEFT JOIN LATERAL (
        SELECT w.id FROM public.demurrage_box_waivers AS w
         WHERE w.revoked_at IS NULL
           AND w.voyage_id = gr.voyage_id AND w.customer_id IS NOT DISTINCT FROM gr.customer_id
           AND w.container_key = bx.container_key
         LIMIT 1
      ) AS waiver ON true
      LEFT JOIN LATERAL (
        SELECT max(billed.invoice_id) AS invoice_id
          FROM public._demurrage_billed_container_keys(gr.voyage_id, gr.customer_id) AS billed
         WHERE gr.customer_id IS NOT NULL AND billed.container_key = bx.container_key
      ) AS covering ON true
  ), calculated AS (
    SELECT r.*,
           CASE WHEN r.discharge_date IS NULL THEN NULL
                ELSE (COALESCE(r.return_date, v_today) - r.discharge_date)::integer END AS total_days,
           COALESCE(r.free_time_override, r.agreement_free_days, r.table_free_days) AS free_days,
           CASE WHEN r.free_time_override IS NOT NULL THEN 'bl'
                WHEN r.agreement_free_days IS NOT NULL THEN 'acordo'
                WHEN r.table_free_days IS NOT NULL THEN 'tabela' END AS free_source,
           COALESCE(r.demurrage_rate_override_p1_usd, r.agreement_p1_usd, r.table_p1_usd) AS rate_p1_usd,
           COALESCE(r.demurrage_rate_override_p2_usd, r.agreement_p2_usd, r.table_p2_usd) AS rate_p2_usd
      FROM resolved AS r
  ), valued AS (
    SELECT c.*,
           (c.p1_day_to IS NULL OR c.p2_day_from IS NULL OR c.rate_p1_usd IS NULL OR c.rate_p2_usd IS NULL) AS no_rate,
           CASE WHEN c.total_days IS NULL OR c.free_days IS NULL OR c.p1_day_to IS NULL THEN NULL
                ELSE GREATEST(0, LEAST(c.total_days, c.p1_day_to) - c.free_days)::integer END AS days_p1,
           CASE WHEN c.total_days IS NULL OR c.free_days IS NULL OR c.p2_day_from IS NULL THEN NULL
                ELSE GREATEST(0, c.total_days - GREATEST(c.p2_day_from, c.free_days + 1) + 1)::integer END AS days_p2
      FROM calculated AS c
  ), boxed AS (
    SELECT v.*,
           CASE WHEN v.no_rate OR v.days_p1 IS NULL THEN NULL
                ELSE round((v.days_p1 * v.rate_p1_usd + v.days_p2 * v.rate_p2_usd) / GREATEST(1, v.share_count), 2) END AS usd,
           CASE
             WHEN v.covered_by IS NOT NULL THEN 'covered'
             WHEN v.waiver_id IS NOT NULL THEN 'waived'
             WHEN v.discharge_date IS NULL THEN 'no_discharge'
             -- D27: sem tarifa e sem free time de B/L ou acordo, desde a descarga;
             -- com free time, quando ele vence (não há diária para valorar).
             -- 526: devolvida dentro do free time também (D32): a emissão
             -- recusa o grupo com caixa sem tarifa.
             WHEN v.no_rate AND (v.free_days IS NULL OR v.total_days > v.free_days OR v.return_date IS NOT NULL) THEN 'no_rate'
             WHEN v.return_date IS NULL AND v.free_days IS NOT NULL AND v.total_days > v.free_days THEN 'running'
             WHEN v.return_date IS NULL THEN 'in_free_time'
             WHEN v.free_days IS NOT NULL AND v.total_days > v.free_days THEN 'returned_overstay'
             ELSE 'returned_free'
           END AS state
      FROM valued AS v
  ), group_flags AS (
    SELECT gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled,
           bool_or(bx.state = 'no_rate') AS has_no_rate,
           bool_or(bx.state = 'running') AS has_running,
           bool_or(bx.state IN ('returned_overstay', 'no_rate') AND bx.return_date IS NOT NULL) AS has_returned_overstay,
           bool_or(bx.state IN ('running', 'returned_overstay', 'no_rate')) AS has_overstay,
           bool_or(bx.return_date IS NULL AND bx.state <> 'waived') AS has_out,
           bool_or(bx.state = 'returned_overstay' AND COALESCE(bx.usd, 0) > 0) AS has_to_issue,
           bool_or(bx.state = 'no_rate' AND NOT EXISTS (
             SELECT 1 FROM public.container_types AS t WHERE t.code = upper(btrim(COALESCE(bx.type, ''))))) AS no_rate_new_type,
           bool_or(bx.state = 'no_rate' AND EXISTS (
             SELECT 1 FROM public.container_types AS t WHERE t.code = upper(btrim(COALESCE(bx.type, ''))) AND NOT t.active)) AS no_rate_inactive_type,
           string_agg(DISTINCT CASE WHEN bx.state = 'no_rate' THEN COALESCE(NULLIF(upper(btrim(bx.type)), ''), '(vazio)') END, ', ') AS no_rate_types,
           COALESCE(sum(bx.usd) FILTER (WHERE bx.state IN ('running', 'returned_overstay')), 0) AS usd
      FROM groups AS gr
      JOIN boxed AS bx ON bx.anchor_bl_id = gr.anchor_bl_id
     GROUP BY gr.anchor_bl_id, gr.group_ids, gr.voyage_id, gr.customer_id, gr.cancelled
  ), blocked AS (
    SELECT gf.*,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND gf.has_overstay
                THEN public._demurrage_issue_block_reason(gf.anchor_bl_id) END AS block_reason,
           CASE WHEN gf.customer_id IS NOT NULL AND NOT gf.cancelled AND gf.has_overstay
                THEN NOT public.bl_has_portal_release(gf.anchor_bl_id) END AS missing_ce
      FROM group_flags AS gf
  ), classified AS (
    SELECT bl.*,
           CASE
             WHEN bl.has_no_rate THEN 'travado'
             WHEN bl.cancelled AND bl.has_overstay THEN 'travado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'travado'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL THEN 'travado'
             WHEN bl.has_running THEN 'correndo'
             WHEN bl.has_out AND bl.has_returned_overstay THEN 'esperando'
             WHEN NOT bl.has_out AND bl.has_to_issue THEN 'a_emitir'
           END AS division,
           CASE
             WHEN bl.has_no_rate THEN 'sem_tarifa'
             WHEN bl.cancelled AND bl.has_overstay THEN 'bl_cancelado'
             WHEN bl.customer_id IS NULL AND bl.has_overstay THEN 'sem_cliente'
             WHEN NOT bl.has_out AND bl.has_to_issue AND bl.block_reason IS NOT NULL
               THEN CASE WHEN bl.missing_ce THEN 'sem_ce' ELSE 'portal' END
           END AS reason_code
      FROM blocked AS bl
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'anchor_bl_id', cl.anchor_bl_id,
           'bl_ids', to_jsonb(cl.group_ids),
           'voyage_id', cl.voyage_id,
           'voyage_label', (SELECT COALESCE(ve.name, '') || ' / ' || vo.voyage_number
                              FROM public.voyages AS vo LEFT JOIN public.vessels AS ve ON ve.id = vo.vessel_id
                             WHERE vo.id = cl.voyage_id),
           'customer_id', cl.customer_id,
           'customer_name', (SELECT cu.name FROM public.customers AS cu WHERE cu.id = cl.customer_id),
           'customer_cnpj', (SELECT cu.cnpj_cpf FROM public.customers AS cu WHERE cu.id = cl.customer_id),
           'division', cl.division,
           'reason_code', cl.reason_code,
           'reason', CASE cl.reason_code
             WHEN 'sem_tarifa' THEN format('Tipo %s sem tarifa de Demurrage.', cl.no_rate_types)
             WHEN 'bl_cancelado' THEN format('B/L %s cancelado com sobreestadia sem Invoice.', cl.anchor_bl_id)
             WHEN 'sem_cliente' THEN format('B/L %s sem Cliente vinculado.', cl.anchor_bl_id)
             ELSE cl.block_reason END,
           -- Em Correndo e Esperando, o que vai travar a emissão já aparece.
           'warning', CASE WHEN cl.division IN ('correndo', 'esperando') THEN cl.block_reason END,
           'no_rate_types', cl.no_rate_types,
           -- 526: o que destrava o "sem tarifa": tipo fora do cadastro, tipo
           -- desativado ou tarifa do grupo (D4, D27, D32).
           'no_rate_kind', CASE WHEN cl.reason_code = 'sem_tarifa' THEN
             CASE WHEN cl.no_rate_new_type THEN 'tipo_novo' WHEN cl.no_rate_inactive_type THEN 'tipo_inativo' ELSE 'tarifa' END END,
           -- 525: em A emitir, a Invoice cancelada à mão que as caixas esperam
           -- (D10: sem Invoice nova automática) e a emissão já na fila.
           'cancelled_doc', CASE WHEN cl.division = 'a_emitir' THEN (
             SELECT di.doc_number
               FROM public.demurrage_invoices AS di
               JOIN public.bls AS ib ON ib.id = di.bl_id
               JOIN public.demurrage_invoice_items AS it ON it.invoice_id = di.id
              WHERE di.status = 'cancelled' AND di.customer_id = cl.customer_id AND ib.voyage_id = cl.voyage_id
                -- 530: só a cancelada à mão; a automática tem reemissão própria.
                AND public._demurrage_cancelled_by_hand(di.id)
                AND upper(btrim(it.container_number)) IN (
                  SELECT bx.container_key FROM boxed AS bx
                   WHERE bx.anchor_bl_id = cl.anchor_bl_id AND bx.state = 'returned_overstay')
                AND NOT EXISTS (
                  SELECT 1 FROM public.demurrage_invoices AS live
                   WHERE live.replaces_invoice_id = di.id AND live.status IN ('issued', 'overdue', 'paid'))
              ORDER BY di.id DESC LIMIT 1) END,
           'issue_queued', CASE WHEN cl.division = 'a_emitir' THEN EXISTS (
             SELECT 1 FROM public.import_pending_effects AS e
              WHERE e.effect_kind = 'demurrage_billing'
                AND e.entity_id = ANY (cl.group_ids)
                AND e.status IN ('pending', 'running', 'retry_wait')) ELSE false END,
           'usd', cl.usd,
           'boxes', (SELECT jsonb_agg(jsonb_build_object(
                       'container_id', bx.container_id, 'bl_id', bx.bl_id,
                       'container_number', bx.container_number, 'type', bx.type, 'rate_group', bx.rate_group,
                       'discharge_date', bx.discharge_date, 'return_date', bx.return_date,
                       'total_days', bx.total_days, 'free_days', bx.free_days, 'free_source', bx.free_source,
                       'last_free_day', CASE WHEN bx.discharge_date IS NOT NULL AND bx.free_days IS NOT NULL THEN bx.discharge_date + bx.free_days END,
                       'days_p1', bx.days_p1, 'rate_p1_usd', bx.rate_p1_usd,
                       'days_p2', bx.days_p2, 'rate_p2_usd', bx.rate_p2_usd,
                       'usd', CASE WHEN bx.state IN ('running', 'returned_overstay') THEN bx.usd END,
                       'state', bx.state,
                       'covered_by', bx.covered_by,
                       'covered_doc', (SELECT di.doc_number FROM public.demurrage_invoices AS di WHERE di.id = bx.covered_by),
                       'waiver_id', bx.waiver_id,
                       'box_share_count', GREATEST(1, bx.share_count)
                     ) ORDER BY bx.container_key)
                       FROM boxed AS bx WHERE bx.anchor_bl_id = cl.anchor_bl_id)
         ) ORDER BY cl.anchor_bl_id), '[]'::jsonb)
    INTO v_result
    FROM classified AS cl
   WHERE cl.division IS NOT NULL;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_demurrage_travado_alerts(p_voyage_id bigint DEFAULT NULL::bigint, p_source text DEFAULT 'demurrage_travado'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_claims text := current_setting('request.jwt.claims', true);
  v_group jsonb;
  v_board jsonb;
  v_travado text[] := ARRAY[]::text[];
  v_department text;
  v_current text;
  v_item RECORD;
  v_open integer := 0;
  v_actor uuid := COALESCE(auth.uid(), public._import_effect_system_actor());
  v_fingerprint text;
BEGIN
  v_board := public._demurrage_billing_board_core(NULL, p_voyage_id);
  -- Chamada também pelo pg_cron e por gatilhos: o Alerta exige executor
  -- autorizado e é do sistema, não de quem gravou a data ou o CE.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- 525: o grupo em A emitir parado (a sobreestadia veio da mudança de free
  -- time, tarifa ou acordo, ou de dispensa desfeita, sem gravação de data) vai
  -- para a fila de emissão. Fica de fora o que espera Invoice cancelada à mão
  -- (D10) e o que já está na fila.
  -- Só na rotina: nos gatilhos (CE, Cliente, datas) a emissão já tem o
  -- caminho próprio, e enfileirar ali duplicaria o efeito.
  IF p_source = 'demurrage-travado-alerts' THEN
    -- 531: sem conta de sistema o executor recusaria o efeito; avisa e pula.
    IF v_actor IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_board) AS g
        WHERE g.value->>'division' = 'a_emitir' AND g.value->>'cancelled_doc' IS NULL) THEN
      RAISE WARNING 'Demurrage: sem conta de sistema ativa (app_settings.system_billing_actor ou Administrativo); A emitir não entra na fila.';
    END IF;
    FOR v_group IN SELECT value FROM jsonb_array_elements(v_board)
      WHERE value->>'division' = 'a_emitir' AND value->>'cancelled_doc' IS NULL
        AND NOT COALESCE((value->>'issue_queued')::boolean, false)
    LOOP
      -- 526: o efeito leva o iniciador do sistema (sem ele o executor recusa)
      -- e a assinatura das caixas do grupo: com as mesmas caixas, a emissão
      -- já foi tentada (emitiu, foi bloqueada ou recusada) e não volta à fila
      -- a cada passada. Caixa, data ou valor diferente é tentativa nova.
      v_fingerprint := md5(COALESCE(v_group->'boxes', '[]'::jsonb)::text);
      CONTINUE WHEN v_actor IS NULL OR EXISTS (
        SELECT 1 FROM public.import_pending_effects AS e
         WHERE e.effect_kind = 'demurrage_billing' AND e.entity_id = v_group->>'anchor_bl_id'
           AND e.source_snapshot->>'fingerprint' = v_fingerprint);
      INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by, source_snapshot)
      VALUES (md5('demurrage_a_emitir:' || (v_group->>'anchor_bl_id') || ':' || v_fingerprint)::uuid,
        'demurrage_billing', v_group->>'anchor_bl_id', v_actor,
        jsonb_build_object('source', 'demurrage_a_emitir', 'fingerprint', v_fingerprint));
    END LOOP;
  END IF;

  FOR v_group IN SELECT value FROM jsonb_array_elements(v_board) WHERE value->>'division' = 'travado' LOOP
    v_travado := v_travado || (v_group->>'anchor_bl_id');
    v_department := CASE WHEN v_group->>'reason_code' IN ('sem_tarifa', 'bl_cancelado') THEN 'administrativo' ELSE 'documentacao' END;
    SELECT i.department INTO v_current
      FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
     WHERE i.item_type = 'demurrage_travado' AND i.status = 'active'
       AND a.entity_type = 'bl' AND a.entity_id = v_group->>'anchor_bl_id'
     ORDER BY i.id DESC LIMIT 1;
    IF v_current IS NOT NULL AND v_current <> v_department THEN
      PERFORM public.resolve_alert_item('demurrage_travado', 'bl', v_group->>'anchor_bl_id', p_source,
        jsonb_build_object('reason', 'motivo_mudou'));
    END IF;
    PERFORM public.upsert_alert_item(
      'demurrage_travado', 'bl', v_group->>'anchor_bl_id',
      format('Demurrage do B/L %s travada: %s', v_group->>'anchor_bl_id', v_group->>'reason'),
      p_source, v_department,
      jsonb_build_object('bl_id', v_group->>'anchor_bl_id', 'bl_ids', v_group->'bl_ids',
        'reason_code', v_group->>'reason_code', 'no_rate_types', v_group->>'no_rate_types',
        'customer_id', v_group->'customer_id', 'voyage_id', v_group->'voyage_id', 'usd', v_group->'usd'),
      '/demurrage?divisao=travado&busca=' || (v_group->>'anchor_bl_id'));
    v_open := v_open + 1;
  END LOOP;

  -- 529: na passada da rotina, refaz a reconciliação das Invoices
  -- diferentes que o gatilho não conseguiu tratar, no mesmo recorte.
  IF p_source = 'demurrage-travado-alerts' THEN
    PERFORM public.reconcile_demurrage_stale_invoices(p_voyage_id);
  END IF;

  -- Fecha pela origem o que saiu de Travado no recorte reconciliado.
  FOR v_item IN
    SELECT DISTINCT a.entity_id
      FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id
      LEFT JOIN public.bls b ON b.id = a.entity_id
     WHERE i.item_type = 'demurrage_travado' AND i.status = 'active' AND a.entity_type = 'bl'
       AND (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id OR b.id IS NULL)
       AND NOT (a.entity_id = ANY (v_travado))
  LOOP
    PERFORM public.resolve_alert_item('demurrage_travado', 'bl', v_item.entity_id, p_source, '{}'::jsonb);
  END LOOP;

  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_previous_claims, ''), true);
  RETURN v_open;
END;
$function$;
