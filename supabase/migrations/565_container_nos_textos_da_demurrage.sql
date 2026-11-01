-- 565: "container" no lugar de "caixa" nos textos que o banco grava ou devolve
-- sobre a Demurrage.
--
-- Decisão do dono de 2026-11-01: a equipe só fala em container. A PR #1165
-- trocou os textos das telas; esta troca os do banco:
--   1. `_demurrage_stale_cause` (524): a causa "Divisão da caixa entre Clientes
--      alterada" passa a "Divisão do container entre Clientes alterada". Ela
--      começa o motivo da pausa da Régua (`_demurrage_stale_reason`) e o motivo
--      do cancelamento para reemissão automática (`_reconcile_demurrage_after_dates`).
--   2. `_demurrage_auto_reissue_reason` (550) e `_demurrage_replaced_cause` (555)
--      reconhecem o texto novo e continuam reconhecendo o antigo: os
--      cancelamentos já gravados seguem automáticos e com a causa `divisao` no
--      Portal, sem reescrever `audit_logs`.
--   3. `_reconcile_demurrage_after_dates` (corpo da 550): os alertas "A divisão
--      dos containers entre Clientes…" e "…o container passou a ser cobrado só
--      dos outros Clientes".
--   4. `_calculate_demurrage_invoice_authoritative` (corpo da 546): a recusa
--      "A Invoice de Demurrage cobra cada container uma vez: há container
--      repetido no grupo."
--   5. `_demurrage_waivers_follow_customer` (corpo da 531): "A dispensa da
--      cobrança do container … acompanhou a troca de Cliente do B/L."
--
-- Fora: "caixa" de Comunicados e contatos (caixa de e-mail) é outro conceito.
--
-- Só recria funções; não grava nem reescreve linhas existentes. O motivo de
-- pausa já gravado passa ao texto novo na próxima varredura da própria
-- reconciliação (ela regrava quando o motivo calculado difere, 531), sem
-- reabrir Alerta (a comparação é pelo `stale_state`, não pelo texto). Alertas
-- abertos mantêm o texto com que nasceram.
--
-- Rollback: recriar as cinco funções pelos corpos das migrations citadas.

CREATE OR REPLACE FUNCTION public._demurrage_stale_cause(p_invoice_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = p_invoice_id
        AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date))
      THEN 'Datas de container alteradas'
    WHEN EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = p_invoice_id AND c.ownership = 'SOC')
      THEN 'Container passou a SOC'
    ELSE 'Divisão do container entre Clientes alterada'
  END;
$function$;

REVOKE ALL ON FUNCTION public._demurrage_stale_cause(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._demurrage_auto_reissue_reason(p_justification text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_justification, '') LIKE ANY (ARRAY[
    'Datas de container alteradas: cancelada para reemissão%',
    'Container passou a SOC: cancelada para reemissão%',
    'Divisão do container entre Clientes alterada: cancelada para reemissão%',
    -- Texto gravado até a 565; os cancelamentos antigos continuam automáticos.
    'Divisão da caixa entre Clientes alterada: cancelada para reemissão%']);
$function$;

REVOKE ALL ON FUNCTION public._demurrage_auto_reissue_reason(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._demurrage_replaced_cause(p_cancelled_invoice_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN reason LIKE 'Datas de container alteradas: cancelada para reemissão%' THEN 'datas'
    WHEN reason LIKE 'Container passou a SOC: cancelada para reemissão%' THEN 'soc'
    WHEN reason LIKE 'Divisão do container entre Clientes alterada: cancelada para reemissão%' THEN 'divisao'
    -- Texto gravado até a 565.
    WHEN reason LIKE 'Divisão da caixa entre Clientes alterada: cancelada para reemissão%' THEN 'divisao'
  END
  FROM (
    SELECT btrim(a.justification) AS reason
      FROM public.audit_logs AS a
     WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = p_cancelled_invoice_id::text
       AND a.field_name = 'status' AND a.new_value = 'cancelled'
     ORDER BY a.changed_at DESC, a.id DESC
     LIMIT 1
  ) AS last_cancel;
$function$;

REVOKE ALL ON FUNCTION public._demurrage_replaced_cause(bigint) FROM PUBLIC, anon, authenticated;

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
      THEN 'O B/L da Invoice de Demurrage %s foi cancelado depois da emissão e o container passou a ser cobrado só dos outros Clientes%s.'
      ELSE 'A divisão dos containers entre Clientes da Invoice de Demurrage %s mudou depois da emissão%s.' END,
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

CREATE OR REPLACE FUNCTION public._calculate_demurrage_invoice_authoritative(p_bl_id text, p_container_ids bigint[], p_calculation_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_requested_count integer := COALESCE(array_length(p_container_ids, 1), 0);
  v_distinct_count integer;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(p_bl_id), '') IS NULL
     OR v_requested_count = 0
     OR p_calculation_date IS NULL THEN
    RAISE EXCEPTION 'B/L, containers e data de cálculo são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.id)::integer
    INTO v_distinct_count
  FROM unnest(p_container_ids) AS requested(id);
  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'A emissão de Demurrage não aceita container duplicado.' USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT requested.id
    FROM unnest(p_container_ids) AS requested(id)
  ), base AS (
    SELECT
      container.id,
      container.bl_id,
      container.container_number,
      container.type,
      container.discharge_date,
      container.return_date,
      container.demurrage_status,
      bl.customer_id,
      bl.free_time_override,
      bl.demurrage_rate_override_p1_usd,
      bl.demurrage_rate_override_p2_usd,
      public._demurrage_canonical_type(container.type) AS canonical_type,
      -- 521 (ADR 0112, D19 e D23): Clientes com a caixa na Viagem.
      public._demurrage_box_share_count(bl.voyage_id, upper(btrim(container.container_number)), bl.customer_id) AS share_count
    FROM requested
    LEFT JOIN public.bl_containers AS container
      ON container.id = requested.id
     AND container.bl_id = ANY(public.demurrage_group_bl_ids(p_bl_id))
    LEFT JOIN public.bls AS bl ON bl.id = container.bl_id
  ), resolved AS (
    SELECT
      base.*,
      rate.free_days AS table_free_days,
      rate.p1_day_to,
      rate.p1_usd AS table_p1_usd,
      rate.p2_day_from,
      rate.p2_usd AS table_p2_usd,
      agreement.free_days AS agreement_free_days,
      agreement.p1_usd AS agreement_p1_usd,
      agreement.p2_usd AS agreement_p2_usd
    FROM base
    LEFT JOIN LATERAL (
      SELECT r.free_days, r.p1_day_to, r.p1_usd, r.p2_day_from, r.p2_usd
      FROM public._active_demurrage_rates(p_calculation_date) AS r
      WHERE r.active = true
        AND r.valid_from <= p_calculation_date
        AND (r.valid_to IS NULL OR r.valid_to >= p_calculation_date)
        -- 546: a tarifa guarda o código do grupo; o do container vem do cadastro ativo.
        AND r.container_type = base.canonical_type
      ORDER BY r.valid_from DESC, r.id DESC
      LIMIT 1
    ) AS rate ON true
    LEFT JOIN LATERAL (
      SELECT a.free_days, a.p1_usd, a.p2_usd
      FROM public.customer_demurrage_agreements AS a
      WHERE a.customer_id = base.customer_id
        AND a.active = true
        AND base.discharge_date >= a.valid_from
        AND (a.valid_to IS NULL OR base.discharge_date <= a.valid_to)
      ORDER BY a.valid_from DESC, a.id DESC
      LIMIT 1
    ) AS agreement ON true
  ), calculated AS (
    SELECT
      resolved.*,
      (resolved.return_date - resolved.discharge_date)::integer AS total_days,
      COALESCE(resolved.free_time_override, resolved.agreement_free_days, resolved.table_free_days) AS free_days,
      COALESCE(resolved.demurrage_rate_override_p1_usd, resolved.agreement_p1_usd, resolved.table_p1_usd) AS rate_p1_usd,
      COALESCE(resolved.demurrage_rate_override_p2_usd, resolved.agreement_p2_usd, resolved.table_p2_usd) AS rate_p2_usd
    FROM resolved
  ), valued AS (
    SELECT
      calculated.*,
      GREATEST(0, LEAST(calculated.total_days, calculated.p1_day_to) - calculated.free_days)::integer AS days_p1,
      GREATEST(
        0,
        calculated.total_days - GREATEST(calculated.p2_day_from, calculated.free_days + 1) + 1
      )::integer AS days_p2
    FROM calculated
  ), totals AS (
    SELECT
      valued.*,
      -- Cada Cliente paga a parte igual do valor pela própria condição (D23).
      round((valued.days_p1 * valued.rate_p1_usd + valued.days_p2 * valued.rate_p2_usd) / GREATEST(1, valued.share_count), 2) AS subtotal_usd,
      (
        valued.id IS NULL
        OR valued.bl_id IS NULL
        -- A devolução preenchida é o que vale; linha antiga pode ter
        -- `within_free_time` com devolução gravada (C11, migration 191).
        OR valued.discharge_date IS NULL
        OR valued.return_date IS NULL
        OR valued.return_date < valued.discharge_date
        OR valued.total_days < 0
        OR valued.free_days IS NULL
        OR valued.free_days < 0
        OR valued.p1_day_to IS NULL
        OR valued.p2_day_from IS NULL
        OR valued.rate_p1_usd IS NULL
        OR valued.rate_p2_usd IS NULL
        OR valued.rate_p1_usd < 0
        OR valued.rate_p2_usd < 0
      ) AS invalid
    FROM valued
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'container_id', totals.id,
          'container_number', totals.container_number,
          'container_type', totals.type,
          'discharge_date', totals.discharge_date,
          'return_date', totals.return_date,
          'total_days', totals.total_days,
          'free_days', totals.free_days,
          'days_p1', totals.days_p1,
          'rate_p1_usd', totals.rate_p1_usd,
          'days_p2', totals.days_p2,
          'rate_p2_usd', totals.rate_p2_usd,
          'subtotal_usd', totals.subtotal_usd,
          'box_share_count', GREATEST(1, totals.share_count)
        ) ORDER BY totals.id
      ) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0),
      '[]'::jsonb
    ),
    'total_usd', COALESCE(sum(totals.subtotal_usd) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0), 0),
    'ready_at', CASE WHEN bool_and(totals.return_date IS NOT NULL) THEN max(totals.return_date) ELSE NULL END,
    'requested_count', count(*)::integer,
    'distinct_numbers', count(DISTINCT upper(btrim(totals.container_number)))::integer,
    'calculated_count', count(*) FILTER (WHERE NOT totals.invalid AND totals.subtotal_usd >= 0)::integer,
    'invalid_count', count(*) FILTER (WHERE totals.invalid)::integer
  )
    INTO v_result
  FROM totals;

  IF COALESCE((v_result->>'requested_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Um ou mais containers não pertencem ao B/L informado.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'invalid_count')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'Dados insuficientes ou tarifa inválida para calcular a Demurrage.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'distinct_numbers')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'A Invoice de Demurrage cobra cada container uma vez: há container repetido no grupo.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v_result->>'calculated_count')::integer, 0) <> v_requested_count THEN
    RAISE EXCEPTION 'Nenhum container faturável ou conjunto de containers desatualizado.' USING ERRCODE = '22023';
  END IF;

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
      format('A dispensa da cobrança do container %s acompanhou a troca de Cliente do B/L.', v_waiver.container_key));
  END LOOP;
  RETURN NEW;
END;
$function$;
