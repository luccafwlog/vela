-- 524: o motivo de a Invoice estar fora da Régua diz a causa da diferença
-- (decisão do dono de 2026-10-30, na PR luccafwlog/vela#1113, sobre a ADR
-- 0112). Desde as migrations 521 e 522, a Invoice paga, com desconto ou em
-- disputa sai da Régua também quando muda a divisão da caixa entre Clientes ou
-- quando o container passa a SOC, mas o motivo dizia sempre "Datas de
-- container alteradas…". Passa a ser:
--   "<causa> depois do pagamento; conferir a diferença."
--   "<causa> em Invoice com desconto ou disputa; reemitir à mão."
-- com a causa "Datas de container alteradas", "Container passou a SOC" ou
-- "Divisão da caixa entre Clientes alterada" (as datas primeiro, quando há
-- mais de uma). As comparações que reconheciam o motivo pelo começo do texto
-- passam a reconhecê-lo pelo fim (`_demurrage_is_stale_suspension`).
--
-- Não reescreve linhas: a Invoice já suspensa por datas guarda o texto de
-- antes, que continua reconhecido.
--
-- Rollback: recriar `_reconcile_demurrage_after_dates` (522),
-- `reconcile_demurrage_invoice_after_payment_reversal` e
-- `resume_demurrage_dunning_on_alert_resolved` (521) e o gatilho
-- `resolve_dates_changed_alert_on_restore` com `LIKE 'Datas de container
-- alteradas%'`; apagar `_demurrage_stale_cause`, `_demurrage_stale_reason` e
-- `_demurrage_is_stale_suspension`.

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
    ELSE 'Divisão da caixa entre Clientes alterada'
  END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_stale_cause(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._demurrage_stale_reason(p_invoice_id bigint, p_paid boolean)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public._demurrage_stale_cause(p_invoice_id) || CASE WHEN p_paid
    THEN ' depois do pagamento; conferir a diferença.'
    ELSE ' em Invoice com desconto ou disputa; reemitir à mão.' END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_stale_reason(bigint, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._demurrage_is_stale_suspension(p_reason text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_reason LIKE '% depois do pagamento; conferir a diferença.'
    OR p_reason LIKE '% em Invoice com desconto ou disputa; reemitir à mão.', false);
$function$;
REVOKE ALL ON FUNCTION public._demurrage_is_stale_suspension(text) FROM PUBLIC, anon, authenticated;


-- Corpo da 522.
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
      ELSE 'A divisão das caixas entre Clientes da Invoice de Demurrage %s mudou depois da emissão%s.' END,
        v_invoice.doc_number, CASE
          WHEN v_paid THEN ' e ela já tem pagamento: a Régua suspendeu a cobrança'
          WHEN v_negotiated THEN ' e ela tem desconto ou disputa aberta: a Régua suspendeu a cobrança; cancele, gere de novo e refaça o desconto ou responda a disputa'
          ELSE '' END);

    IF v_paid OR v_negotiated THEN
      PERFORM public.upsert_alert_item(
        'demurrage_invoice_dates_changed', 'demurrage_invoice', v_invoice.id::text, v_message,
        'container-dates',
        jsonb_build_object('invoice_id', v_invoice.id, 'bl_id', v_invoice.bl_id, 'paid', v_paid, 'negotiated', v_negotiated),
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

-- Corpo da 521.
CREATE OR REPLACE FUNCTION public.reconcile_demurrage_invoice_after_payment_reversal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoice_items AS item
    JOIN public.bl_containers AS c ON c.id = item.container_id
    WHERE item.invoice_id = NEW.id
      AND public._demurrage_item_stale(item.id)
  ) THEN
    PERFORM public._reconcile_demurrage_after_dates(ARRAY[NEW.bl_id], auth.uid());
  ELSE
    -- 317 (R5): só tira a suspensão por datas; a recusa do provedor (D6) fica
    -- até a pessoa resolver o alerta.
    UPDATE public.demurrage_invoices SET dunning_suspended_reason = NULL
    WHERE id = NEW.id AND public._demurrage_is_stale_suspension(dunning_suspended_reason);
  END IF;
  RETURN NULL;
END;
$function$;

-- Corpo da 521.
CREATE OR REPLACE FUNCTION public.resume_demurrage_dunning_on_alert_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_entity_type text;
  v_entity_id text;
  v_invoice_id bigint;
BEGIN
  IF NEW.item_type IS DISTINCT FROM 'cobranca_demurrage_recusada'
     OR NEW.status IS DISTINCT FROM 'resolved'
     OR OLD.status IS NOT DISTINCT FROM 'resolved' THEN
    RETURN NEW;
  END IF;

  SELECT a.entity_type, a.entity_id INTO v_entity_type, v_entity_id
  FROM public.alerts AS a WHERE a.id = NEW.alert_id;
  IF v_entity_type IS DISTINCT FROM 'demurrage_invoice' OR v_entity_id !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  v_invoice_id := v_entity_id::bigint;

  -- 317 (R5): as datas de container que mudam com a Invoice suspensa pela
  -- recusa não sobrescrevem o motivo (_reconcile_demurrage_after_dates). Ao
  -- retomar, a Invoice paga ou negociada com datas divergentes fica com a
  -- suspensão por datas, como a reconciliação teria gravado.
  UPDATE public.demurrage_invoices AS di
  SET dunning_suspended_reason = CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.demurrage_invoice_items AS item
      JOIN public.bl_containers AS c ON c.id = item.container_id
      WHERE item.invoice_id = di.id
        AND public._demurrage_item_stale(item.id)
    ) THEN NULL
    WHEN di.status = 'paid' OR di.paid_at IS NOT NULL
      THEN public._demurrage_stale_reason(di.id, true)
    WHEN COALESCE(di.discount_value, 0) > 0 OR COALESCE(di.dispute_open, false)
      THEN public._demurrage_stale_reason(di.id, false)
    ELSE NULL
  END
  WHERE di.id = v_invoice_id
    AND di.dunning_suspended_reason LIKE 'Cobrança recusada pelo provedor%';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Retoma no mesmo discriminador; a nova geração muda a chave de
  -- idempotência do e-mail e o Comunicado (317), para a tentativa recusada não
  -- ser reaproveitada. A contagem de falhas recomeça (317, R5): a recusa
  -- contou uma, e o alerta de falhas seguidas abria na 2ª falha da retomada.
  UPDATE public.demurrage_dunning_claims AS claim
  SET released_at = COALESCE(claim.released_at, now()),
      resume_generation = claim.resume_generation + 1,
      failure_count = 0
  WHERE claim.demurrage_invoice_id = v_invoice_id
    AND claim.attempt_discriminator = (
      SELECT max(latest.attempt_discriminator) FROM public.demurrage_dunning_claims AS latest
      WHERE latest.demurrage_invoice_id = v_invoice_id
    );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS resolve_dates_changed_alert_on_restore ON public.demurrage_invoices;
CREATE TRIGGER resolve_dates_changed_alert_on_restore
  AFTER UPDATE OF dunning_suspended_reason ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (public._demurrage_is_stale_suspension(OLD.dunning_suspended_reason) AND NEW.dunning_suspended_reason IS NULL)
  EXECUTE FUNCTION public.resolve_dates_changed_alert_on_restore();
