-- 550: aba Canceladas da Demurrage com o motivo e o destino certos, e textos
-- de recusa da Disputa e do Embarque de Vazios (revisão da release
-- luccafwlog/vela#1117; ADR 0112, D10, D20 e D22).
--
-- 1. Motivo pela causa. A reconciliação depois da emissão
--    (`_reconcile_demurrage_after_dates`) gravava "Datas de container
--    alteradas: cancelada para reemissão automática." também quando a causa
--    era o container que passou a SOC (D20) ou a divisão da caixa entre
--    Clientes (D22). Agora grava a causa da suspensão (`_demurrage_stale_cause`,
--    524) com o mesmo sufixo: "Container passou a SOC: …", "Divisão da caixa
--    entre Clientes alterada: …" ou "Datas de container alteradas: …".
--    `_demurrage_auto_reissue_reason` reconhece as três; quem lia o texto antigo
--    passa a usá-la: `_demurrage_cancelled_by_hand` (a cancelada automática não
--    espera Gerar Invoice, 530), `_demurrage_invoice_cites_replaced` (a Invoice
--    nova cita a cancelada, 481) e `_demurrage_cancel_dispute_with_invoice` (o
--    texto próprio do Cliente no Portal, 530). As linhas antigas continuam
--    reconhecidas.
-- 2. Destino das caixas (`list_demurrage_invoice_details`, 519):
--    - a reemissão pela troca de CNPJ do B/L sai para o Cliente novo e não cita
--      a cancelada (484); a caixa aparecia "aguardando nova Invoice". Agora a
--      Invoice viva com item do mesmo container conta, sem exigir o mesmo
--      Cliente, e aparece como "reemitida na DEM-…";
--    - a caixa que passou a SOC aparecia "aguardando nova Invoice", mas não
--      volta a ser cobrada; sai do destino (o motivo diz a causa).
-- 3. "Apenas Equipamentos ou Administrativo pode reabrir a Disputa." em
--    `reopen_demurrage_dispute` (081) e no corpo da reabertura (548): a tela
--    dizia "Dispute".
-- 4. "ADR de Saída fechado: …" com acento em `delete_catalog_row` (linha de
--    serviço de vazios, 514) e `delete_manual_vazios_booking` (unidade, 509).
--
-- Redefine funções com a mesma assinatura e cria uma auxiliar; não reescreve
-- nem apaga linhas (o motivo novo vale para os cancelamentos daqui em diante).
--
-- Rollback: apagar `_demurrage_auto_reissue_reason`; recriar
-- `_reconcile_demurrage_after_dates` (546), `_demurrage_cancelled_by_hand` e
-- `_demurrage_cancel_dispute_with_invoice` (530), `_demurrage_invoice_cites_replaced`
-- (481), `list_demurrage_invoice_details` (519), `reopen_demurrage_dispute`
-- (081), `_reopen_demurrage_dispute_impl_20260920` (548), `delete_catalog_row`
-- (514) e `delete_manual_vazios_booking` (509).

-- ─── 1. Motivo do cancelamento automático pela causa ─────────────────────

-- O cancelamento da reconciliação depois da emissão, por qualquer causa.
-- Reconhece o texto antigo (só datas) e os três de hoje.
CREATE OR REPLACE FUNCTION public._demurrage_auto_reissue_reason(p_justification text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_justification, '') LIKE ANY (ARRAY[
    'Datas de container alteradas: cancelada para reemissão%',
    'Container passou a SOC: cancelada para reemissão%',
    'Divisão da caixa entre Clientes alterada: cancelada para reemissão%']);
$function$;
REVOKE ALL ON FUNCTION public._demurrage_auto_reissue_reason(text) FROM PUBLIC, anon, authenticated;

-- Corpo da 546; o motivo gravado diz a causa.
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
    -- 550 (ADR 0112, D10): o motivo diz a causa, a mesma da suspensão
    -- (`_demurrage_stale_cause`, 524): datas, container que passou a SOC ou
    -- divisão da caixa entre Clientes. O sufixo é o que
    -- `_demurrage_auto_reissue_reason` reconhece como cancelamento automático.
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('demurrage_invoice', v_invoice.id::text, 'status', v_invoice.status, 'cancelled', p_actor, now(),
      public._demurrage_stale_cause(v_invoice.id) || ': cancelada para reemissão automática.');
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
        -- 546 (D10): pelo executor da fila, que não emite o grupo que espera o
        -- Gerar Invoice de uma Invoice cancelada à mão (a varredura da 529
        -- passa por aqui também).
        -- ponytail: o executor reconhece a espera só com o grupo em A emitir;
        -- com o Gate do Portal fechado (Travado), a reemissão, que passa pelo
        -- gate (484), ainda cobra a caixa da cancelada à mão. Calcular
        -- `cancelled_doc` também em Travado se o caso aparecer.
        v_attempt := public._run_import_effect_demurrage(NULL, v_next_bl, p_actor);
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
        v_tried := array_append(v_tried, COALESCE(v_attempt->>'anchor_bl_id', public.demurrage_group_anchor(v_next_bl), v_next_bl));
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
            -- 546 (D10)
            WHEN v_reissue->>'status' = 'awaiting_manual_issue'
            THEN format('a Invoice %s foi cancelada à mão e o grupo espera o Gerar Invoice na Demurrage.', v_reissue->>'cancelled_doc')
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

-- Corpo da 530; reconhece as três causas.
CREATE OR REPLACE FUNCTION public._demurrage_cancelled_by_hand(p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    -- 550: a reemissão automática diz a causa (datas, SOC ou divisão da caixa).
    SELECT NOT (public._demurrage_auto_reissue_reason(a.justification)
             OR COALESCE(a.justification, '') LIKE 'Troca de CNPJ do B/L %')
      FROM public.audit_logs AS a
     WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = p_invoice_id::text
       AND a.field_name = 'status' AND a.new_value = 'cancelled'
     ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), true);
$function$;

-- Corpo da 481; reconhece as três causas.
CREATE OR REPLACE FUNCTION public._demurrage_invoice_cites_replaced()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.demurrage_invoices cur
     SET replaces_invoice_id = (
       SELECT prev.id
       FROM public.demurrage_invoices prev
       JOIN public.demurrage_invoice_items prev_item ON prev_item.invoice_id = prev.id
       WHERE prev.id <> cur.id
         AND prev.status = 'cancelled'
         AND prev.customer_id = cur.customer_id
         -- Mesma Viagem: a caixa de outra Viagem é outra cobrança.
         AND (SELECT voyage_id FROM public.bls WHERE id = prev.bl_id)
             = (SELECT voyage_id FROM public.bls WHERE id = cur.bl_id)
         AND upper(btrim(prev_item.container_number)) = upper(btrim(NEW.container_number))
         AND EXISTS (
           SELECT 1 FROM public.audit_logs log
           WHERE log.entity_type = 'demurrage_invoice' AND log.entity_id = prev.id::text
             AND log.field_name = 'status' AND log.new_value = 'cancelled'
             -- 550: qualquer causa da reemissão automática (datas, SOC ou divisão).
             AND public._demurrage_auto_reissue_reason(log.justification))
         AND NOT EXISTS (
           SELECT 1 FROM public.demurrage_invoices other WHERE other.replaces_invoice_id = prev.id)
       ORDER BY prev.updated_at DESC, prev.id DESC
       LIMIT 1)
   WHERE cur.id = NEW.invoice_id AND cur.replaces_invoice_id IS NULL;
  RETURN NULL;
END;
$function$;

-- Corpo da 530; o texto do Portal vale para as três causas.
CREATE OR REPLACE FUNCTION public._demurrage_cancel_dispute_with_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_reason text;
  v_doc text;
  v_previous_flag text := current_setting('alerts.foundation_trigger', true);
BEGIN
  SELECT * INTO v_dispute FROM public.demurrage_disputes
   WHERE demurrage_invoice_id = NEW.id AND state = 'aberta'
   ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = NEW.id AND status = 'cancelled') THEN
    RETURN NULL;
  END IF;
  -- O motivo é o do cancelamento, gravado na mesma transação pelo caminho
  -- que cancelou (à mão, reemissão por datas ou troca de CNPJ).
  SELECT NULLIF(btrim(a.justification), '') INTO v_reason
    FROM public.audit_logs AS a
   WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = NEW.id::text
     AND a.field_name = 'status' AND a.new_value = 'cancelled'
   ORDER BY a.changed_at DESC, a.id DESC LIMIT 1;
  v_reason := COALESCE(v_reason, 'Invoice cancelada.');
  -- 530: o motivo do cancelamento automático é texto interno (cita o Portal
  -- de outro Cliente na troca de CNPJ); o Cliente lê um texto próprio. O
  -- motivo do cancelamento à mão vai como escrito (D16), e a tela avisa.
  v_reason := CASE
    -- 550: qualquer causa da reemissão automática (datas, SOC ou divisão).
    WHEN public._demurrage_auto_reissue_reason(v_reason)
      THEN 'a Invoice foi recalculada e substituída por uma nova.'
    WHEN v_reason LIKE 'Troca de CNPJ do B/L %'
      THEN 'o B/L passou a outro Cliente.'
    ELSE v_reason END;
  SELECT doc_number INTO v_doc FROM public.demurrage_invoices WHERE id = NEW.id;

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (v_dispute.id, NULL, 'sistema',
    format('A Invoice %s foi cancelada e esta disputa foi encerrada junto. Motivo: %s', v_doc, v_reason),
    'ninguem', jsonb_build_object('action', 'invoice_cancelled', 'reason', v_reason));
  -- Pelo gatilho da Invoice, a Disputa fica `cancelada` e o Alerta da
  -- Disputa (`portal_dispute_opened`) fecha.
  UPDATE public.demurrage_invoices SET dispute_open = false, dispute_status = 'cancelado' WHERE id = NEW.id;
  UPDATE public.demurrage_disputes SET state = 'cancelada', next_responder = 'ninguem', cancelled_at = COALESCE(cancelled_at, now())
   WHERE id = v_dispute.id AND state <> 'cancelada';
  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  VALUES (v_dispute.customer_id, NULL, 'dispute_cancelled', 'Disputa encerrada',
    format('A Invoice de Demurrage %s foi cancelada e a disputa foi encerrada. Motivo: %s', v_doc, v_reason),
    '/portal/billing?tab=demurrage&disputas=1&disputa=' || v_dispute.id);
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.resolve_alert_item('portal_dispute_opened', 'demurrage_invoice', NEW.id::text, 'demurrage_invoice_cancelled', '{}'::jsonb);
  PERFORM public.resolve_alert_item('demurrage_disputa_prazo', 'demurrage_invoice', NEW.id::text, 'demurrage_invoice_cancelled', '{}'::jsonb);
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous_flag, ''), true);
  RETURN NULL;
END;
$function$;

-- ─── 2. Destino das caixas da Invoice cancelada ──────────────────────────

-- Corpo da 519; troca de CNPJ e caixa SOC.
CREATE OR REPLACE FUNCTION public.list_demurrage_invoice_details(p_invoice_ids bigint[])
 RETURNS TABLE(
   invoice_id bigint,
   payment_roe numeric,
   cancel_reason text,
   cancelled_by uuid,
   cancelled_at timestamptz,
   box_destinations jsonb
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para ler as Invoices de Demurrage.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH inv AS (
    SELECT d.id, d.status, d.customer_id, b.voyage_id
      FROM public.demurrage_invoices AS d
      LEFT JOIN public.bls AS b ON b.id = d.bl_id
     WHERE d.id = ANY(COALESCE(p_invoice_ids, ARRAY[]::bigint[]))
  ),
  boxes AS (
    SELECT inv.id AS invoice_id, inv.customer_id, inv.voyage_id,
           upper(btrim(item.container_number)) AS box,
           array_agg(DISTINCT item.container_id) AS container_ids
      FROM inv
      JOIN public.demurrage_invoice_items AS item ON item.invoice_id = inv.id
     WHERE inv.status = 'cancelled' AND NULLIF(btrim(item.container_number), '') IS NOT NULL
       -- 550 (D20): a caixa que passou a SOC sai da cobrança; não aguarda
       -- Invoice nova (o motivo do cancelamento diz a causa).
       AND NOT EXISTS (
         SELECT 1 FROM public.bl_containers AS soc WHERE soc.id = item.container_id AND soc.ownership = 'SOC')
     GROUP BY inv.id, inv.customer_id, inv.voyage_id, upper(btrim(item.container_number))
  ),
  box_dest AS (
    SELECT bx.invoice_id, bx.box, dest.kind, dest.target_id, dest.target_doc
      FROM boxes AS bx
      CROSS JOIN LATERAL (
        SELECT opt.kind, opt.target_id, opt.target_doc
          FROM (
            -- 550: a reemissão pela troca de CNPJ é do Cliente novo e não cita
            -- a cancelada (484); acha-se pelo mesmo container do B/L.
            SELECT CASE WHEN live.replaces_invoice_id = bx.invoice_id
                          OR (li.container_id = ANY(bx.container_ids) AND live.customer_id IS DISTINCT FROM bx.customer_id)
                        THEN 'reemitida' ELSE 'cobrada' END AS kind,
                   live.id AS target_id, live.doc_number AS target_doc
              FROM public.demurrage_invoices AS live
              JOIN public.demurrage_invoice_items AS li ON li.invoice_id = live.id
              LEFT JOIN public.bls AS lb ON lb.id = live.bl_id
             WHERE live.status IN ('issued', 'overdue', 'paid')
               AND upper(btrim(li.container_number)) = bx.box
               AND (live.replaces_invoice_id = bx.invoice_id
                    OR (live.customer_id = bx.customer_id AND lb.voyage_id = bx.voyage_id)
                    OR li.container_id = ANY(bx.container_ids))
            UNION ALL
            SELECT 'dispensada', NULL::bigint, NULL::text
              FROM public.demurrage_box_waivers AS w
             WHERE w.voyage_id = bx.voyage_id AND w.customer_id = bx.customer_id
               AND w.container_key = bx.box AND w.revoked_at IS NULL
            UNION ALL
            SELECT 'aguardando', NULL::bigint, NULL::text
          ) AS opt
         ORDER BY public._demurrage_box_destination_rank(opt.kind), opt.target_id DESC NULLS LAST
         LIMIT 1
      ) AS dest
  ),
  dest_by_invoice AS (
    SELECT g.invoice_id,
           jsonb_agg(jsonb_build_object('kind', g.kind, 'invoice_id', g.target_id, 'doc_number', g.target_doc, 'containers', g.containers)
                     ORDER BY public._demurrage_box_destination_rank(g.kind), g.target_doc) AS destinations
      FROM (
        SELECT invoice_id, kind, target_id, target_doc, array_agg(box ORDER BY box) AS containers
          FROM box_dest
         GROUP BY invoice_id, kind, target_id, target_doc
      ) AS g
     GROUP BY g.invoice_id
  )
  SELECT inv.id,
         (SELECT h.roe_used FROM public.demurrage_invoice_history AS h
           WHERE h.invoice_id = inv.id AND h.source = 'payment'
           ORDER BY h.event_date DESC, h.id DESC LIMIT 1),
         cancel_log.justification,
         cancel_log.changed_by,
         cancel_log.changed_at,
         COALESCE(dbi.destinations, '[]'::jsonb)
    FROM inv
    LEFT JOIN LATERAL (
      SELECT a.justification, a.changed_by, a.changed_at
        FROM public.audit_logs AS a
       WHERE inv.status = 'cancelled'
         AND a.entity_type = 'demurrage_invoice' AND a.entity_id = inv.id::text
         AND a.field_name = 'status' AND a.new_value = 'cancelled'
       ORDER BY a.changed_at DESC, a.id DESC
       LIMIT 1
    ) AS cancel_log ON true
    LEFT JOIN dest_by_invoice AS dbi ON dbi.invoice_id = inv.id;
END;
$function$;

-- ─── 3. Reabrir a Disputa ────────────────────────────────────────────────

-- Corpo da 081; só o texto.
CREATE OR REPLACE FUNCTION public.reopen_demurrage_dispute(p_dispute_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public._portal_actor_role() IS NULL OR public._portal_actor_role() NOT IN ('equipamentos', 'administrativo') THEN
    RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode reabrir a Disputa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._reopen_demurrage_dispute_impl_20260920(p_dispute_id, p_reason);
END;
$function$;

-- Corpo da 548; só o texto de permissão, igual ao da entrada.
CREATE OR REPLACE FUNCTION public._reopen_demurrage_dispute_impl_20260920(p_dispute_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_dispute public.demurrage_disputes%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('equipamentos', 'administrativo') THEN RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo pode reabrir a Disputa.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Disputa não encontrada.' USING ERRCODE = 'P0002'; END IF;
  -- Reabertura só da resolvida (docs/modules/demurrage.md).
  IF v_dispute.state <> 'resolvida' THEN RAISE EXCEPTION 'Só a Disputa resolvida pode ser reaberta.' USING ERRCODE = '22023'; END IF;
  -- 520 (ADR 0112, D17): reabre só em Invoice emitida ou paga.
  IF NOT EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = v_dispute.demurrage_invoice_id AND status IN ('issued', 'overdue', 'paid')) THEN
    RAISE EXCEPTION 'A Invoice desta disputa está cancelada: a disputa não reabre.' USING ERRCODE = '22023';
  END IF;
  -- 548 (D18): a mensagem da reabertura vem antes do estado. O gatilho do
  -- prazo (`trg_demurrage_dispute_deadline_alert`, 520) roda no UPDATE e conta
  -- a espera pela primeira mensagem que passou a vez a Equipamentos; sem ela,
  -- contava desde a abertura original e abria o Alerta já vencido.
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), v_role, btrim(p_reason), 'equipamentos', jsonb_build_object('action', 'reopen'));
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = p_dispute_id;
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Disputa reaberta; análise de Equipamentos pendente.', 'portal_dispute_reopened', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

-- ─── 4. ADR de Saída fechado, com acento ─────────────────────────────────

-- Corpo da 514; só o texto do ADR de Saída fechado.
CREATE OR REPLACE FUNCTION public.delete_catalog_row(p_table text, p_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;
  -- Linha de serviço de vazios é custo interno: qualquer usuário ativo exclui
  -- (ADR 0071, política da migration 087). O resto é do Administrativo.
  IF p_table <> 'vazios_export_service_lines' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN (
    'depots', 'depot_services', 'vazios_export_service_lines',
    'demurrage_rates', 'customer_demurrage_agreements', 'customer_rate_overrides',
    'charge_table_items', 'container_types'
  ) THEN
    RAISE EXCEPTION 'Tabela fora da exclusão de cadastro: %.', p_table USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  -- B14 (ADR 0071, item 4): linha de serviço de vazios trava com o ADR de
  -- Saída fechado da escala; reabrir o ADR solta a trava.
  IF p_table = 'vazios_export_service_lines' AND EXISTS (
    SELECT 1 FROM public.vazios_export_service_lines AS line
    JOIN public.vazios_export_operations AS op ON op.id = line.operation_id
    WHERE line.id::text = p_id AND public._vazios_export_locked_by_adr(op.voyage_id, op.embark_port)
  ) THEN
    RAISE EXCEPTION 'ADR de Saída fechado: reabra o ADR para excluir a linha de serviço de vazios.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('vela.delete_reason', btrim(p_reason), true);
  -- ponytail: id::text evita um ramo por tipo de chave (uuid/bigint); perde o
  -- índice, aceitável em cadastros pequenos. Se uma tabela crescer, comparar
  -- no tipo da coluna.
  EXECUTE format('DELETE FROM public.%I WHERE id::text = $1', p_table) USING p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('vela.delete_reason', '', true);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nada foi excluído: o registro já não existe.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

-- Corpo da 509; só o texto do ADR de Saída fechado.
CREATE OR REPLACE FUNCTION public.delete_manual_vazios_booking(p_booking_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking RECORD;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para excluir unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusao.' USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.manifest_id, b.voyage_id, COALESCE(op.embark_port, b.pol) AS port
    INTO v_booking
  FROM public.vazios_bookings AS b
  LEFT JOIN public.vazios_export_operations AS op ON op.id = b.operation_id
  WHERE b.id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Unidade embarcada nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF public._vazios_export_locked_by_adr(v_booking.voyage_id, v_booking.port) THEN
    RAISE EXCEPTION 'ADR de Saída fechado: reabra o ADR para excluir a unidade.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('vela.delete_reason', v_reason, true);
  DELETE FROM public.vazios_bookings WHERE id = p_booking_id;
  PERFORM set_config('vela.delete_reason', '', true);

  DELETE FROM public.vazios_manifests manifest
  WHERE manifest.id = v_booking.manifest_id
    AND manifest.description = 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_bookings booking
      WHERE booking.manifest_id = manifest.id
    );
END;
$function$;
