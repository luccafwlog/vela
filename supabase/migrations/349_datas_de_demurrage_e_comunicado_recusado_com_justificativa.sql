-- 349: "Datas mudaram em Invoice de Demurrage" fecha quando a reemissão cobre
-- as caixas, e ela e "Comunicado automático recusado" aceitam "Resolver com
-- justificativa" (revisão dos alertas de 2026-10-21,
-- docs/revisao-alertas-2026-10.md; decisões P1 e P2 do dono, que fecham L9 e
-- L11 do estudo docs/archive/audits/2026-10-20-auto-resolucao-de-alertas.md).
--
-- Problemas:
--   1. (L9, P1) No ramo sem pagamento, desconto nem disputa,
--      `_reconcile_demurrage_after_dates` (317) cancela a Invoice, reemite com
--      as datas novas e abre `demurrage_invoice_dates_changed` na Invoice
--      cancelada. Nada fechava esse item: `resolve_dates_changed_alert_on_restore`
--      (208) só olha a suspensão de Invoice viva, e a justificativa recusava o
--      tipo. O alerta ficava aberto para sempre, mesmo com tudo cobrado.
--   2. (L11, P2) O catálogo promete "também pode ser encerrado com
--      justificativa" em `comunicado_recusado`, e a conferência das datas manda
--      "registre a conferência ao resolver o alerta"; a RPC
--      `resolve_alert_item_with_justification` recusava os dois tipos.
--
-- Mudança (decisões do dono, 2026-10-21):
--   1. Ramo sem pagamento: se a reemissão cobriu todas as caixas da Invoice
--      cancelada (`v_unbilled` vazio), o alerta não fica aberto (item anterior
--      da mesma Invoice é resolvido). Com caixa sem cobrança, abre como antes,
--      com a lista em `metadata.unbilled_containers`, e fecha sozinho quando
--      todas essas caixas passam a estar numa Invoice viva da mesma Viagem e do
--      mesmo Cliente (gatilho de restrição adiado em `demurrage_invoices`, na
--      emissão: os itens já existem no COMMIT). Ponto para o dono conferir: os
--      ramos "B/L cancelado" e "Viagem cancelada" só cancelam (nada a cobrar
--      pela regra da 211) e contam como "cobriu tudo": o alerta não abre.
--      Ramos com pagamento ou com desconto/disputa ficam como estão (fecham
--      quando as datas voltam, 208, ou com justificativa).
--   2. `comunicado_recusado` e `demurrage_invoice_dates_changed` entram em
--      `_alert_types_resolved_with_justification()` (espelho em
--      src/services/alerts.ts).
--   3. Comunicado recusado justificado: coluna `refusal_acknowledged_at` nas
--      claims. Quando o item é resolvido, as claims que estavam nele ficam
--      reconhecidas; o refresh lista só as não reconhecidas. A próxima falha
--      da mesma claim não reabre o alerta; a falha de outro Comunicado reabre,
--      com nova ocorrência e só ele na mensagem. A claim que sai do alerta
--      (envio, alvo que deixou de estar devido) perde o reconhecimento; se
--      entrar de novo, é episódio novo.
--   4. Acerto dos já abertos: itens `demurrage_invoice_dates_changed` ativos em
--      Invoice cancelada pelo ramo automático (metadata sem pagamento nem
--      negociação) sem caixa pendente, ou com todas já cobradas, são
--      resolvidos (origem `migration_349`).
--
-- Reescreve linhas existentes (item 4: `alert_items` resolvidos e seus
-- eventos). Depende da afirmação "Data status" do AGENTS.md (seção Gotchas): o
-- banco de produção só tem dados de teste. Conferência: alertas ativos desse
-- tipo em Invoice cancelada antes e depois.
-- Rollback: reaplicar as definições das migrations 317
-- (_reconcile_demurrage_after_dates), 316 (_alert_types_resolved_with_justification)
-- e 318 (refresh_customer_communication_refusal_alert); DROP TRIGGER
-- resolve_demurrage_dates_changed_on_billing ON public.demurrage_invoices e
-- acknowledge_communication_refusal_on_alert_resolved ON public.alert_items;
-- DROP FUNCTION public.resolve_demurrage_dates_changed_on_billing(),
-- public._resolve_demurrage_dates_changed_billed(bigint, bigint) e
-- public.acknowledge_communication_refusal_on_alert_resolved(); ALTER TABLE
-- public.customer_communication_automation_claims DROP COLUMN
-- refusal_acknowledged_at. O acerto do item 4 não tem volta automática; os
-- eventos `resolved` com origem `migration_349` dizem o que foi fechado.

-- 1 -------------------------------------------------------------------------
-- Definição da migration 317 com o fecho do ramo sem pagamento.
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
          AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
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
        AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
    );
    v_paid := v_invoice.status = 'paid' OR v_invoice.paid_at IS NOT NULL;
    -- Desconto ou disputa aberta (ADR 0079, decisão 1): houve negociação que o
    -- cálculo não refaz. Como a paga, a Invoice não é reemitida sozinha.
    v_negotiated := NOT v_paid
      AND (COALESCE(v_invoice.discount_value, 0) > 0 OR COALESCE(v_invoice.dispute_open, false));
    v_message := format('As datas de container da Invoice de Demurrage %s mudaram depois da emissão%s.',
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
         SET dunning_suspended_reason = CASE WHEN v_paid
           THEN 'Datas de container alteradas depois do pagamento; conferir a diferença.'
           ELSE 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.' END
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
      WHERE item.invoice_id = v_invoice.id AND NULLIF(btrim(item.container_number), '') IS NOT NULL;
      v_tried := ARRAY[]::text[];
      v_waiting := ARRAY[]::text[];
      v_next_bl := v_invoice.bl_id;
      PERFORM set_config('vela.demurrage_internal', 'on', true);
      LOOP
        v_attempt := public.issue_demurrage_invoice_for_bl(v_next_bl, NULL);
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
          ' A reemissão automática não cobrou o(s) container(s) %s: confira o grupo e emita a Demurrage deles.',
          array_to_string(v_unbilled, ', ')),
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
     AND di.dunning_suspended_reason = 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.'
     AND NOT EXISTS (
       SELECT 1 FROM public.demurrage_invoice_items AS item
       JOIN public.bl_containers AS c ON c.id = item.container_id
       WHERE item.invoice_id = di.id
         AND (c.discharge_date IS DISTINCT FROM item.discharge_date OR c.return_date IS DISTINCT FROM item.return_date)
     );
  RETURN v_result;
END;
$function$;

-- Fecha o alerta da Invoice cancelada cujas caixas sem cobrança já estão todas
-- numa Invoice viva da Viagem e do Cliente. A Viagem e o Cliente vêm da
-- Invoice cancelada (a chave do alerta é comparada como texto: nada de cast
-- antes do filtro).
CREATE OR REPLACE FUNCTION public._resolve_demurrage_dates_changed_billed(p_voyage_id bigint, p_customer_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_billed text[];
  v_alert record;
  v_count integer := 0;
BEGIN
  IF p_voyage_id IS NULL OR p_customer_id IS NULL THEN
    RETURN 0;
  END IF;
  v_billed := ARRAY(SELECT billed.container_key FROM public._demurrage_billed_container_keys(p_voyage_id, p_customer_id) AS billed);

  FOR v_alert IN
    SELECT a.entity_id, i.metadata->'unbilled_containers' AS unbilled
    FROM public.alerts AS a
    JOIN public.alert_items AS i ON i.alert_id = a.id
    JOIN public.demurrage_invoices AS di ON di.id::text = a.entity_id
    JOIN public.bls AS b ON b.id = di.bl_id
    WHERE a.entity_type = 'demurrage_invoice'
      AND i.item_type = 'demurrage_invoice_dates_changed'
      AND i.status = 'active'
      AND jsonb_typeof(i.metadata->'unbilled_containers') = 'array'
      AND di.customer_id = p_customer_id
      AND b.voyage_id = p_voyage_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(i.metadata->'unbilled_containers') AS pending(container_key)
        WHERE NOT (upper(btrim(pending.container_key)) = ANY(v_billed)))
  LOOP
    PERFORM public.resolve_alert_item(
      'demurrage_invoice_dates_changed', 'demurrage_invoice', v_alert.entity_id, 'container-dates',
      jsonb_build_object('resolution', 'containers_billed', 'containers', v_alert.unbilled));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public._resolve_demurrage_dates_changed_billed(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- Na emissão de Invoice de Demurrage (inserida já emitida ou que sai do
-- rascunho), confere os alertas de caixas sem cobrança do mesmo Cliente e da
-- mesma Viagem. Gatilho de restrição adiado: os itens são gravados depois da
-- Invoice e já existem no COMMIT. Falha ao fechar o alerta não desfaz a
-- emissão: vira WARNING.
CREATE OR REPLACE FUNCTION public.resolve_demurrage_dates_changed_on_billing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint;
  v_previous text := current_setting('alerts.foundation_trigger', true);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'demurrage_invoice_dates_changed' AND i.status = 'active'
      AND a.entity_type = 'demurrage_invoice'
      AND jsonb_typeof(i.metadata->'unbilled_containers') = 'array'
  ) THEN
    RETURN NULL;
  END IF;
  SELECT voyage_id INTO v_voyage_id FROM public.bls WHERE id = NEW.bl_id;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    PERFORM public._resolve_demurrage_dates_changed_billed(v_voyage_id, NEW.customer_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Não foi possível fechar alertas de datas da Demurrage na emissão da Invoice %: %', NEW.id, SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_demurrage_dates_changed_on_billing() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_demurrage_dates_changed_on_billing ON public.demurrage_invoices;
CREATE CONSTRAINT TRIGGER resolve_demurrage_dates_changed_on_billing
  AFTER INSERT OR UPDATE OF status ON public.demurrage_invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status IN ('issued', 'overdue', 'paid'))
  EXECUTE FUNCTION public.resolve_demurrage_dates_changed_on_billing();

-- 2 -------------------------------------------------------------------------
-- Definição da migration 316 com os dois tipos (decisão P2). Espelho em
-- src/services/alerts.ts (ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION), na mesma
-- ordem.
CREATE OR REPLACE FUNCTION public._alert_types_resolved_with_justification()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['portal_abuso_login', 'bl_vehicles_changed_on_reimport', 'ce_trocado_com_desbloqueio',
    'cobranca_demurrage_recusada', 'desbloqueio_ce_aviso_nao_enviado',
    'demurrage_invoice_dates_changed', 'comunicado_recusado']::text[];
$function$;

-- 3 -------------------------------------------------------------------------
ALTER TABLE public.customer_communication_automation_claims
  ADD COLUMN IF NOT EXISTS refusal_acknowledged_at timestamptz;

COMMENT ON COLUMN public.customer_communication_automation_claims.refusal_acknowledged_at IS
  'Quando o alerta comunicado_recusado em que a claim estava foi resolvido (com justificativa). '
  'A claim reconhecida sai da mensagem e a próxima falha dela não reabre o alerta; a de outra claim reabre. '
  'Vale enquanto refusal_alerted_at estiver preenchida: o refresh limpa as duas juntas (migration 349).';

-- Definição da migration 318 com as claims reconhecidas fora do alerta.
-- ponytail: calcula todos os alvos da régua (customer_communication_automation_targets)
-- a cada chamada, que acontece por Cliente com alerta ativo em cada rodada da
-- produtora e a cada desfecho de claim. Com muitos Clientes, aceitar o
-- Cliente como parâmetro nos alvos.
CREATE OR REPLACE FUNCTION public.refresh_customer_communication_refusal_alert(p_customer_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_name text;
  v_claims jsonb;
  v_summary text;
  v_count integer;
  v_due text[];
  v_alerted boolean := false;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_due := ARRAY(
      SELECT t.claim_key
      FROM public.customer_communication_automation_targets(now()) t
      WHERE t.customer_id = p_customer_id);

    -- Entrada: recusa definitiva, 1ª recusa por dado ou 3ª falha seguida do
    -- provedor, com o alvo ainda devido. Episódio novo: sem reconhecimento.
    UPDATE public.customer_communication_automation_claims cl
       SET refusal_alerted_at = now(), refusal_acknowledged_at = NULL
     WHERE split_part(cl.claim_key, ':', 2) = p_customer_id::text
       AND cl.refusal_alerted_at IS NULL
       AND cl.claim_key = ANY(v_due)
       AND (cl.rejected_at IS NOT NULL
         OR (cl.attempts > 0 AND (cl.provider_failures = 0 OR cl.provider_failures >= 3)));

    -- Saída sem envio: o alvo deixou de estar devido (envio por outro caminho,
    -- janela vencida, Cliente desativado). O envio da régua sai pelo complete.
    UPDATE public.customer_communication_automation_claims cl
       SET refusal_alerted_at = NULL, refusal_acknowledged_at = NULL
     WHERE split_part(cl.claim_key, ':', 2) = p_customer_id::text
       AND cl.refusal_alerted_at IS NOT NULL
       AND NOT (cl.claim_key = ANY(v_due));

    -- 349 (P2): a claim reconhecida na justificativa fica fora do alerta.
    SELECT jsonb_agg(jsonb_build_object(
        'claim_key', cl.claim_key,
        'kind', split_part(cl.claim_key, ':', 1),
        'reason', COALESCE(cl.rejection_reason, cl.last_error),
        'permanent', cl.rejected_at IS NOT NULL,
        'attempts', cl.attempts,
        'next_attempt_at', cl.next_attempt_at
      ) ORDER BY cl.claim_key),
      string_agg(cl.claim_key || ' (' || COALESCE(cl.rejection_reason, cl.last_error, 'sem motivo')
        || CASE WHEN cl.rejected_at IS NULL AND cl.attempts > 0 THEN '; ' || cl.attempts || 'ª tentativa' ELSE '' END
        || ')', '; ' ORDER BY cl.claim_key),
      count(*)
    INTO v_claims, v_summary, v_count
    FROM public.customer_communication_automation_claims cl
    WHERE split_part(cl.claim_key, ':', 2) = p_customer_id::text
      AND cl.refusal_alerted_at IS NOT NULL
      AND cl.refusal_acknowledged_at IS NULL;

    IF COALESCE(v_count, 0) = 0 THEN
      PERFORM public.resolve_alert_item('comunicado_recusado', 'customer', p_customer_id::text, 'comunicado_automacao', '{}'::jsonb);
    ELSE
      v_alerted := true;
      SELECT c.name INTO v_customer_name FROM public.customers c WHERE c.id = p_customer_id;
      PERFORM public.upsert_alert_item(
        'comunicado_recusado',
        'customer',
        p_customer_id::text,
        'Cliente ' || COALESCE(v_customer_name, p_customer_id::text) || ': ' || v_count
          || ' Comunicado(s) automático(s) sem envio: ' || v_summary,
        'comunicado_automacao',
        jsonb_build_object('customer_id', p_customer_id, 'claims', v_claims),
        '/clientes/comunicacao'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Falha no alerta (inclusive no cálculo dos alvos) não desfaz o estado da
    -- claim gravado por quem chamou: parar de ciclar vem antes.
    RAISE WARNING 'Alerta comunicado_recusado do Cliente % nao atualizado: %', p_customer_id, SQLERRM;
  END;
  RETURN v_alerted;
END;
$function$;

-- Item resolvido: as claims que estavam nele ficam reconhecidas. O refresh só
-- resolve sozinho quando não há claim não reconhecida, então na prática quem
-- reconhece é a justificativa. Compara o Cliente como texto.
CREATE OR REPLACE FUNCTION public.acknowledge_communication_refusal_on_alert_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer text;
BEGIN
  SELECT a.entity_id INTO v_customer
  FROM public.alerts AS a
  WHERE a.id = NEW.alert_id AND a.entity_type = 'customer';
  IF v_customer IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.customer_communication_automation_claims
     SET refusal_acknowledged_at = now()
   WHERE split_part(claim_key, ':', 2) = v_customer
     AND refusal_alerted_at IS NOT NULL
     AND refusal_acknowledged_at IS NULL;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.acknowledge_communication_refusal_on_alert_resolved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS acknowledge_communication_refusal_on_alert_resolved ON public.alert_items;
CREATE TRIGGER acknowledge_communication_refusal_on_alert_resolved
  AFTER UPDATE OF status ON public.alert_items
  FOR EACH ROW
  WHEN (NEW.item_type = 'comunicado_recusado' AND NEW.status = 'resolved' AND OLD.status = 'active')
  EXECUTE FUNCTION public.acknowledge_communication_refusal_on_alert_resolved();

-- 4 -------------------------------------------------------------------------
-- Acerto dos itens já abertos em Invoice cancelada pelo ramo automático.
DO $$
DECLARE
  v_alert record;
  v_billed text[];
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_alert IN
    SELECT a.entity_id, i.metadata, di.customer_id, b.voyage_id
    FROM public.alerts AS a
    JOIN public.alert_items AS i ON i.alert_id = a.id
    JOIN public.demurrage_invoices AS di ON di.id::text = a.entity_id
    LEFT JOIN public.bls AS b ON b.id = di.bl_id
    WHERE a.entity_type = 'demurrage_invoice'
      AND i.item_type = 'demurrage_invoice_dates_changed'
      AND i.status = 'active'
      AND di.status = 'cancelled'
      AND i.metadata->>'paid' IS DISTINCT FROM 'true'
      AND i.metadata->>'negotiated' IS DISTINCT FROM 'true'
  LOOP
    IF jsonb_typeof(v_alert.metadata->'unbilled_containers') = 'array' THEN
      v_billed := ARRAY(SELECT billed.container_key
        FROM public._demurrage_billed_container_keys(v_alert.voyage_id, v_alert.customer_id) AS billed);
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_alert.metadata->'unbilled_containers') AS pending(container_key)
        WHERE NOT (upper(btrim(pending.container_key)) = ANY(v_billed)));
    END IF;
    PERFORM public.resolve_alert_item(
      'demurrage_invoice_dates_changed', 'demurrage_invoice', v_alert.entity_id, 'migration_349',
      jsonb_build_object('resolution', 'reissue_complete'));
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;
