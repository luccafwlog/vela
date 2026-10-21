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
--      Para isso a rodada da produtora (`evaluate_and_dispatch_automatic_communications`,
--      definição da 314) confere também os Clientes com claim reconhecida:
--      depois da justificativa o item está resolvido, e a rodada só olhava
--      Clientes com o item ativo (achado do revisor na #1013). O envio
--      (`complete_customer_communication_automation_claim`, definição da 318)
--      zera também o reconhecimento. Só o desfecho da própria claim
--      (`defer_`/`reject_customer_communication_automation_claim`, definições
--      da 303, com a chave em `alerts.comunicado_recusado_entrada`) a põe no
--      alerta: a rodada e o desfecho de outra claim não a fazem reentrar pela
--      falha antiga.
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
-- 318 (refresh_customer_communication_refusal_alert e
-- complete_customer_communication_automation_claim), 303
-- (reject_ e defer_customer_communication_automation_claim) e 314
-- (evaluate_and_dispatch_automatic_communications); DROP TRIGGER
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
    -- 349: só entra a claim do desfecho que chamou (adiamento ou recusa, que
    -- põem a chave em `alerts.comunicado_recusado_entrada`). A rodada da
    -- produtora e o envio não marcam: a claim que saiu do alerta guarda a
    -- falha antiga (rejected_at segura a retomada por 24 horas) e, sem esta
    -- trava, reentrava por ela quando o alvo voltava a ser devido ou quando
    -- outra claim do Cliente tinha desfecho, reabrindo o item sem falha nova.
    UPDATE public.customer_communication_automation_claims cl
       SET refusal_alerted_at = now(), refusal_acknowledged_at = NULL
     WHERE cl.claim_key = NULLIF(current_setting('alerts.comunicado_recusado_entrada', true), '')
       AND split_part(cl.claim_key, ':', 2) = p_customer_id::text
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

-- 3b ------------------------------------------------------------------------
-- Definição da migration 314 com a rodada 1D cobrindo as claims reconhecidas.
-- ponytail: a saída só é vista numa rodada (15 min). Se a claim deixa de ser
-- devida e volta a ser entre duas rodadas, a falha seguinte conta como o mesmo
-- episódio e não reabre. Caminho de melhoria: limpar o reconhecimento onde o
-- alvo deixa de existir (desativação do Cliente, janela, escala).
CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_target record;
  v_customer record;
  v_candidates jsonb := '[]'::jsonb;
  v_unreachable jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  FOR v_target IN SELECT * FROM public.customer_communication_automation_targets(v_as_of) t ORDER BY t.claim_key
  LOOP
    IF COALESCE(cardinality(v_target.emails), 0) = 0 THEN
      -- 2.7: Cliente sem destinatário vira alerta, não candidato.
      v_unreachable := jsonb_set(v_unreachable, ARRAY[v_target.customer_id::text],
        COALESCE(v_unreachable -> (v_target.customer_id::text), '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'kind', v_target.kind, 'voyage_id', v_target.voyage_id, 'port', v_target.port,
          'voyage_number', v_target.voyage_number, 'atracacao_id', v_target.anchor_atracacao_id,
          'terminal_code', v_target.terminal_code, 'bl_ids', to_jsonb(v_target.bl_ids),
          'customer_name', v_target.customer_name, 'customer_cnpj', v_target.customer_cnpj)));
      CONTINUE;
    END IF;

    INSERT INTO public.customer_communication_automation_claims (claim_key)
    VALUES (v_target.claim_key)
    ON CONFLICT (claim_key) DO UPDATE
      SET claimed_at = now(), released_at = NULL, rejected_at = NULL, rejection_reason = NULL
      WHERE (customer_communication_automation_claims.released_at IS NOT NULL
         OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes')
        AND (customer_communication_automation_claims.rejected_at IS NULL
         OR customer_communication_automation_claims.rejected_at < v_as_of - interval '24 hours')
        -- 1D: recusa não definitiva só volta depois do intervalo (migration 303).
        AND (customer_communication_automation_claims.next_attempt_at IS NULL
         OR customer_communication_automation_claims.next_attempt_at <= v_as_of);
    IF FOUND THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'claim_key', v_target.claim_key, 'kind', v_target.kind, 'nature', v_target.nature,
        'customer_id', v_target.customer_id, 'customer_name', v_target.customer_name,
        'customer_cnpj', v_target.customer_cnpj, 'voyage_id', v_target.voyage_id,
        'vessel_name', v_target.vessel_name, 'voyage_number', v_target.voyage_number,
        'port', v_target.port, 'milestone_at', v_target.milestone_text,
        'anchor_atracacao_id', v_target.anchor_atracacao_id, 'terminal_id', v_target.terminal_id,
        'terminal_name', v_target.terminal_code,
        'bl_ids', to_jsonb(v_target.bl_ids), 'emails', to_jsonb(v_target.emails)
      )));
    END IF;
  END LOOP;

  -- 2.7: um alerta por Cliente sem destinatário, com todos os seus alvos. Falha
  -- no alerta não aborta a rodada dos outros Clientes.
  FOR v_customer IN SELECT key AS customer_id, value AS targets FROM jsonb_each(v_unreachable)
  LOOP
    BEGIN
      PERFORM public.upsert_alert_item(
        'nob_sem_destinatario',
        'customer',
        v_customer.customer_id,
        'Cliente ' || (v_customer.targets -> 0 ->> 'customer_name') || ': sem contato ativo para receber '
          || (SELECT string_agg(public.customer_communication_kind_short_label(t ->> 'kind')
                || ' da viagem ' || COALESCE(t ->> 'voyage_number', t ->> 'voyage_id')
                || CASE WHEN t ->> 'kind' = 'ce_mercante_taxas' THEN '' ELSE ' (' || COALESCE(t ->> 'port', '—')
                  || COALESCE(' · ' || (t ->> 'terminal_code'), '') || ')' END,
                '; ' ORDER BY t ->> 'kind', t ->> 'voyage_id')
              FROM jsonb_array_elements(v_customer.targets) t)
          || '. Cadastre um contato na caixa Documentação e Operação (ou Financeiro, para o CE e Taxas).',
        'comunicado_automacao',
        -- 314: customer_cnpj leva "Abrir Cliente" à ficha do Cliente, não à lista.
        jsonb_build_object('customer_id', v_customer.customer_id::bigint,
          'customer_cnpj', v_customer.targets -> 0 ->> 'customer_cnpj', 'targets', v_customer.targets),
        '/clientes'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta nob_sem_destinatario do Cliente % nao gravado: %', v_customer.customer_id, SQLERRM;
    END;
  END LOOP;

  -- Fecha o alerta de quem já tem destinatário ou não tem mais alvo (janela
  -- vencida, Comunicado registrado, Cliente desativado).
  FOR v_customer IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'nob_sem_destinatario' AND i.status = 'active'
      AND a.entity_type = 'customer'
      AND NOT (v_unreachable ? a.entity_id)
  LOOP
    BEGIN
      PERFORM public.resolve_alert_item('nob_sem_destinatario', 'customer', v_customer.entity_id, 'comunicado_automacao', '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta nob_sem_destinatario do Cliente % nao resolvido: %', v_customer.entity_id, SQLERRM;
    END;
  END LOOP;

  -- 1D: tira do alerta comunicado_recusado as claims cujo alvo deixou de existir.
  -- 349: confere também o Cliente com claim reconhecida na justificativa. O
  -- item dele está resolvido, e sem esta rodada a claim que deixa de ser devida
  -- nunca perderia o reconhecimento. A rodada não põe claim no alerta.
  FOR v_customer IN
    SELECT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'comunicado_recusado' AND i.status = 'active'
      AND a.entity_type = 'customer' AND a.entity_id ~ '^[0-9]+$'
    UNION
    SELECT split_part(cl.claim_key, ':', 2)
    FROM public.customer_communication_automation_claims cl
    WHERE cl.refusal_acknowledged_at IS NOT NULL
      AND split_part(cl.claim_key, ':', 2) ~ '^[0-9]+$'
  LOOP
    PERFORM public.refresh_customer_communication_refusal_alert(v_customer.entity_id::bigint);
  END LOOP;

  RETURN v_candidates;
END;
$function$;

-- 3c ------------------------------------------------------------------------
-- Definição da migration 318 com refusal_acknowledged_at zerada junto: a claim
-- que sai pelo envio perde o reconhecimento, e a rodada 1D deixa de conferir
-- o Cliente dela (achado do revisor na #1013).
CREATE OR REPLACE FUNCTION public.complete_customer_communication_automation_claim(p_claim_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_claim_key IS NULL OR btrim(p_claim_key) = '' THEN
    RAISE EXCEPTION 'Chave da claim e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_communication_automation_claims
  SET attempts = 0, provider_failures = 0, last_error = NULL, next_attempt_at = NULL,
      rejected_at = NULL, rejection_reason = NULL, refusal_alerted_at = NULL,
      refusal_acknowledged_at = NULL
  WHERE claim_key = p_claim_key;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM public.refresh_customer_communication_refusal_alert(public.customer_communication_claim_customer_id(p_claim_key));
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_customer_communication_automation_claim(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_customer_communication_automation_claim(text) TO service_role;

-- 3d ------------------------------------------------------------------------
-- Definições da migration 303 com a chave da claim em
-- `alerts.comunicado_recusado_entrada` durante o refresh: só o desfecho da
-- própria claim a põe no alerta.
CREATE OR REPLACE FUNCTION public.reject_customer_communication_automation_claim(p_claim_key text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'Recusa sem motivo informado.'), 500);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_claim_key IS NULL OR btrim(p_claim_key) = '' THEN
    RAISE EXCEPTION 'Chave da claim e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_communication_automation_claims
  SET rejected_at = now(), rejection_reason = v_reason, last_error = v_reason
  WHERE claim_key = p_claim_key;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM set_config('alerts.comunicado_recusado_entrada', p_claim_key, true);
  PERFORM public.refresh_customer_communication_refusal_alert(public.customer_communication_claim_customer_id(p_claim_key));
  PERFORM set_config('alerts.comunicado_recusado_entrada', '', true);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.defer_customer_communication_automation_claim(
  p_claim_key text,
  p_reason text,
  p_provider_failure boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'Recusa sem motivo informado.'), 500);
  v_row public.customer_communication_automation_claims%ROWTYPE;
  v_alerted boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_claim_key IS NULL OR btrim(p_claim_key) = '' THEN
    RAISE EXCEPTION 'Chave da claim e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  -- A liberação (released_at preenchido) passa pelo trigger de prontidão do CE
  -- sem revalidar; a retomada só acontece pela produtora, depois do intervalo.
  UPDATE public.customer_communication_automation_claims
  SET attempts = attempts + 1,
      provider_failures = CASE WHEN COALESCE(p_provider_failure, false) THEN provider_failures + 1 ELSE 0 END,
      last_error = v_reason,
      next_attempt_at = now() + public.customer_communication_retry_interval(attempts + 1),
      released_at = COALESCE(released_at, now())
  WHERE claim_key = p_claim_key
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.comunicado_recusado_entrada', p_claim_key, true);
  v_alerted := public.refresh_customer_communication_refusal_alert(public.customer_communication_claim_customer_id(p_claim_key));
  PERFORM set_config('alerts.comunicado_recusado_entrada', '', true);
  RETURN jsonb_build_object(
    'attempts', v_row.attempts,
    'provider_failures', v_row.provider_failures,
    'next_attempt_at', v_row.next_attempt_at,
    'alerted', v_alerted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_customer_communication_automation_claim(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_customer_communication_automation_claim(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_customer_communication_automation_claim(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_customer_communication_automation_claim(text, text, boolean) TO service_role;

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
