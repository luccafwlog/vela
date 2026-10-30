-- 529: rateio e Invoices diferentes, revisados (revisão final da PR
-- luccafwlog/vela#1113, ADR 0112 D19 a D22, e decisão do dono de 2026-10-30).
--
-- 1. Decisão do dono: quando o B/L de um Cliente que já pagou a parte dele
--    da caixa dividida é cancelado, o outro Cliente passa a pagar a caixa
--    inteira e a Invoice paga do cancelado fica fora da Régua com Alerta para
--    restituir. Antes, o Cliente cancelado continuava contando na própria
--    Invoice, e o Vela cobrava 150% da caixa sem avisar.
-- 2. A Invoice paga ou negociada que já tivera qualquer Alerta de datas não
--    era avisada de diferença nova (523). O Alerta guarda o estado avisado
--    (`stale_state`); só o mesmo estado, já tratado, não reabre. Vale também
--    para a gravação de data em outro container do grupo.
-- 3. A diferença que some (B/L do terceiro Cliente excluído, SOC que volta a
--    COC) deixava a Invoice fora da Régua com o Alerta aberto: a Invoice
--    suspensa pela diferença passa pela reconciliação, que tira a suspensão.
-- 4. A reconciliação que falha no gatilho (523) só deixava um aviso no log:
--    a rotina `demurrage-travado-alerts` (15 minutos) refaz a das Invoices
--    ainda diferentes (`reconcile_demurrage_stale_invoices`), no mesmo recorte
--    de Viagem que ela reconcilia.
-- 5. `_demurrage_is_stale_suspension`, chamada na condição de um gatilho da
--    524, ganha EXECUTE para `service_role`.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: recriar `_demurrage_box_share_count` (521),
-- `_reconcile_demurrage_after_dates` (524), `_demurrage_reconcile_box_share_keys`
-- (523) e `reconcile_demurrage_travado_alerts` (526); apagar
-- `_demurrage_stale_state` e `reconcile_demurrage_stale_invoices`.

CREATE OR REPLACE FUNCTION public._demurrage_box_share_count(p_voyage_id bigint, p_container_key text, p_customer_id bigint DEFAULT NULL::bigint)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(1, count(DISTINCT holders.customer_id))::integer
    FROM (
      SELECT b.customer_id
        FROM public.bl_containers AS c
        JOIN public.bls AS b ON b.id = c.bl_id
       WHERE b.voyage_id = p_voyage_id AND b.cancelled_at IS NULL AND b.customer_id IS NOT NULL
         AND c.ownership IS DISTINCT FROM 'SOC'
         AND upper(btrim(c.container_number)) = p_container_key
      UNION ALL
      -- 529 (decisão do dono de 2026-10-30): o Cliente cujos B/Ls com a caixa
      -- na Viagem foram todos cancelados deixa de dividi-la; a Invoice paga
      -- dele fica diferente e abre o Alerta para restituir.
      SELECT p_customer_id WHERE p_customer_id IS NOT NULL AND NOT (
        EXISTS (
          SELECT 1 FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
           WHERE b.voyage_id = p_voyage_id AND b.customer_id = p_customer_id AND b.cancelled_at IS NOT NULL
             AND upper(btrim(c.container_number)) = p_container_key)
        AND NOT EXISTS (
          SELECT 1 FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
           WHERE b.voyage_id = p_voyage_id AND b.customer_id = p_customer_id AND b.cancelled_at IS NULL
             AND upper(btrim(c.container_number)) = p_container_key))
    ) AS holders;
$function$;

CREATE OR REPLACE FUNCTION public._demurrage_stale_state(p_invoice_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- O que a Invoice tem de diferente hoje (datas, SOC, divisão da caixa),
  -- item a item: o Alerta guarda o que avisou, e o mesmo estado não reabre.
  SELECT md5(COALESCE(string_agg(concat_ws('|', item.id, c.discharge_date, c.return_date, c.ownership,
           public._demurrage_box_share_count(b.voyage_id, upper(btrim(item.container_number)), di.customer_id)),
           ',' ORDER BY item.id), ''))
    FROM public.demurrage_invoices AS di
    JOIN public.bls AS b ON b.id = di.bl_id
    JOIN public.demurrage_invoice_items AS item ON item.invoice_id = di.id
    JOIN public.bl_containers AS c ON c.id = item.container_id
   WHERE di.id = p_invoice_id AND public._demurrage_item_stale(item.id);
$function$;
REVOKE ALL ON FUNCTION public._demurrage_stale_state(bigint) FROM PUBLIC, anon, authenticated;

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
         WHERE i.item_type = 'demurrage_invoice_dates_changed' AND i.status <> 'active'
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
         AND (dunning_suspended_reason IS NULL OR dunning_suspended_reason NOT LIKE 'Cobrança recusada pelo provedor%');
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

CREATE OR REPLACE FUNCTION public._demurrage_reconcile_box_share_keys(p_keys jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text;
  v_actor uuid := auth.uid();
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_claims text := current_setting('request.jwt.claims', true);
BEGIN
  -- Efeito do sistema, como o Alerta de Travado (516); a auditoria guarda quem foi.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  FOR v_bl IN
    SELECT DISTINCT di.bl_id
      FROM jsonb_to_recordset(p_keys) AS k(voyage_id bigint, container_key text)
      JOIN public.bls AS holder ON holder.voyage_id = k.voyage_id
      JOIN public.demurrage_invoices AS di ON di.bl_id = holder.id
      JOIN public.demurrage_invoice_items AS item ON item.invoice_id = di.id
     WHERE di.status IN ('issued', 'overdue', 'paid')
       AND upper(btrim(item.container_number)) = k.container_key
       AND (
         (item.box_share_count IS NOT NULL
          AND item.box_share_count <> public._demurrage_box_share_count(k.voyage_id, k.container_key, di.customer_id))
         OR EXISTS (SELECT 1 FROM public.bl_containers AS c WHERE c.id = item.container_id AND c.ownership = 'SOC')
         -- 529: a Invoice suspensa pela diferença que sumiu (B/L excluído, SOC
         -- que volta a COC) passa pela reconciliação, que tira a suspensão.
         OR public._demurrage_is_stale_suspension(di.dunning_suspended_reason))
       -- 529: o Alerta já avisado com o mesmo estado é conferido na
       -- reconciliação (`_demurrage_stale_state`), não aqui.
  LOOP
    BEGIN
      PERFORM public._reconcile_demurrage_after_dates(ARRAY[v_bl], v_actor);
    EXCEPTION WHEN OTHERS THEN
      -- 523: a gravação do B/L ou do container não cai por causa da Invoice
      -- de outro Cliente; a varredura da rotina de 15 minutos tenta de novo
      -- (529, `reconcile_demurrage_stale_invoices`).
      RAISE WARNING 'Reconciliação da Demurrage do B/L % falhou: %', v_bl, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_previous_claims, ''), true);
END;
$function$;

-- 529: a reconciliação que falhou no gatilho (523) é refeita pela rotina.
CREATE OR REPLACE FUNCTION public.reconcile_demurrage_stale_invoices(p_voyage_id bigint DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text;
  v_done integer := 0;
BEGIN
  FOR v_bl IN
    SELECT DISTINCT di.bl_id
      FROM public.demurrage_invoices AS di
      JOIN public.demurrage_invoice_items AS item ON item.invoice_id = di.id
      JOIN public.bls AS b ON b.id = di.bl_id
     WHERE di.status IN ('issued', 'overdue', 'paid')
       AND (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
       AND public._demurrage_item_stale(item.id)
  LOOP
    BEGIN
      PERFORM public._reconcile_demurrage_after_dates(ARRAY[v_bl], public._import_effect_system_actor());
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Reconciliação da Demurrage do B/L % falhou de novo: %', v_bl, SQLERRM;
    END;
  END LOOP;
  RETURN v_done;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_demurrage_stale_invoices(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_demurrage_stale_invoices(bigint) TO service_role;

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

-- 524 deixou a função da condição do gatilho sem EXECUTE para quem grava a
-- coluna pelo servidor.
GRANT EXECUTE ON FUNCTION public._demurrage_is_stale_suspension(text) TO service_role;
