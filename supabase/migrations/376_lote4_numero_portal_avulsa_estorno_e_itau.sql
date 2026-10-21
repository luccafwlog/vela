-- 376: Lote 4 do plano da frente financeira (F-43, F-45 a F-48, F-51, F-53 e
-- F-55; ADR 0093, decisão 21).
--
-- Problema e mudança:
--   F-43. O ano do número da fatura seguia o UTC: fatura emitida às 22h de
--     31/12 em Brasília saía com o ano seguinte. Passa a seguir Brasília. A
--     partir de 10.000 no ano, `lpad(…, 4)` truncava o número e colidia: o
--     número passa a usar todos os dígitos. O deadlock entre o lote e o Emitir
--     (lock de `invoice_counters`) é tratado como erro passageiro no
--     navegador (`src/services/billing.ts`).
--   F-45. A lista de faturas do Portal lia navio, Viagem e POD de hoje: lê da
--     foto da emissão (`invoice_document_snapshots`), com o atual de reserva.
--   F-46. Avulsa: Cliente desativado era aceito (ADR 0073, item 6); a linha
--     USD não fechava quantidade × unitário = total; paga, paga em parte e
--     cancelada não geravam evento do ciclo de vida.
--   F-47. Cancelar a baixa apagava em cascata a restituição do excedente e
--     deixava o recibo Itaú como baixado. Agora: restituição já devolvida
--     impede o cancelamento; a pendente é cancelada e fica no histórico (a
--     chave estrangeira deixa de apagar); o Pix da baixa automática volta
--     para análise com Alerta.
--   F-48. A baixa automática Itaú era gravada como extrato (`pix_extract`):
--     ganha a origem `itau_pix`, que as guardas do TXID tratam como a do
--     extrato. Textos com ações que não existem mais foram corrigidos.
--   F-51. Consolidada com pagamento ou Pix recebido pelo Itaú não pode ser
--     marcada obsoleta (Vela) nem desfeita (Portal).
--   F-53. `upsert_billing_alert` só abre Alerta para B/L ainda a faturar;
--     `resolve_stale_invoice` exige justificativa de 15 caracteres.
--   F-55. Container IMO e OOG sem item THD standard na tabela não ficava sem
--     cobrança em silêncio: o cálculo vai para revisão.
--
-- Não altera nem apaga linhas existentes.

ALTER TABLE public.ledger_settlements DROP CONSTRAINT ledger_settlements_source_check;
ALTER TABLE public.ledger_settlements ADD CONSTRAINT ledger_settlements_source_check
  CHECK (source IN ('manual', 'pix_extract', 'itau_pix', 'backfill'));

ALTER TABLE public.invoice_refunds DROP CONSTRAINT invoice_refunds_payment_id_fkey;
ALTER TABLE public.invoice_refunds ADD CONSTRAINT invoice_refunds_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
ALTER TABLE public.invoice_refunds DROP CONSTRAINT invoice_refunds_origin_check;
ALTER TABLE public.invoice_refunds ADD CONSTRAINT invoice_refunds_origin_check CHECK (
  origin = 'existing' AND ((payment_id IS NULL) <> (cod_adjustment_id IS NULL)
    OR status = 'cancelled' AND payment_id IS NULL AND cod_adjustment_id IS NULL)
  OR origin = 'correction' AND payment_id IS NULL AND cod_adjustment_id IS NULL AND NULLIF(btrim(notes), '') IS NOT NULL
  OR origin = 'pix_duplicate' AND payment_id IS NULL AND cod_adjustment_id IS NULL AND itau_end_to_end_id IS NOT NULL);

-- F-43.
CREATE OR REPLACE FUNCTION public.assign_invoice_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  invoice_year INTEGER;
  next_number INTEGER;
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    RETURN NEW;
  END IF;

  -- F-43 (375/376): ano de Brasília (decisão 21).
  invoice_year := EXTRACT(YEAR FROM COALESCE(NEW.issued_at, now()) AT TIME ZONE 'America/Sao_Paulo')::INTEGER;

  INSERT INTO public.invoice_counters(year, last_number)
  VALUES (invoice_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_number = public.invoice_counters.last_number + 1
  RETURNING last_number INTO next_number;

  NEW.invoice_number := format('INV-%s-%s', invoice_year, CASE WHEN next_number < 10000 THEN lpad(next_number::TEXT, 4, '0') ELSE next_number::TEXT END);
  RETURN NEW;
END;
$function$;

-- F-45.
CREATE OR REPLACE FUNCTION public._portal_list_invoices_core(p_customer_id bigint)
 RETURNS TABLE(id bigint, invoice_number text, issued_at timestamp with time zone, total_brl numeric, total_paid_brl numeric, balance_brl numeric, status text, invoice_type text, vessels text[], voyages text[], vessel_voyages text[], bls text[], pods text[])
AS $function$
BEGIN
  RETURN QUERY
  WITH linked_invoice_bls AS (
    SELECT ib.invoice_id, ib.bl_id
    FROM public.invoice_bls AS ib
    UNION
    SELECT irl.invoice_id, irl.bl_id
    FROM public.invoice_receivable_links AS irl
    JOIN public.invoices AS own ON own.id = irl.invoice_id
    WHERE irl.status IN ('active', 'settled_by_this_invoice')
      -- 361: a consolidada substituída continua visível (decisão 8).
      OR (irl.status = 'obsolete' AND own.status = 'obsolete')
  ),
  manual_context AS (
    SELECT
      i.id AS invoice_id,
      i.bl_id,
      coalesce(sn.snapshot->'bls'->i.bl_id->>'pod', b.pod) AS pod,
      coalesce(sn.snapshot->'bls'->i.bl_id->>'voyage_number', sn.snapshot->>'voyage_number', v.voyage_number) AS voyage_number,
      coalesce(sn.snapshot->'bls'->i.bl_id->>'vessel_name', sn.snapshot->>'vessel_name', vs.name) AS vessel_name
    FROM public.invoices AS i
    LEFT JOIN public.invoice_document_snapshots AS sn ON sn.invoice_id = i.id
    LEFT JOIN public.bls AS b ON b.id = i.bl_id
    LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE i.customer_id = p_customer_id
      AND i.invoice_type = 'manual'
  ),
  eligible_invoices AS (
    SELECT i.id AS invoice_id
    FROM public.invoices AS i
    WHERE i.customer_id = p_customer_id
      -- 298: rascunho não é fatura emitida; o Portal só vê o que foi emitido.
      AND i.status <> 'draft'
      AND (
        i.invoice_type = 'manual'
        OR (
          EXISTS (
            SELECT 1 FROM linked_invoice_bls AS linked
            WHERE linked.invoice_id = i.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM linked_invoice_bls AS linked
            WHERE linked.invoice_id = i.id
              AND NOT public.bl_has_portal_release(linked.bl_id)
          )
        )
      )
  ),
  bl_info AS (
    -- F-45 (376): navio, Viagem e POD da emissão (snapshot), não os de hoje.
    SELECT ib.invoice_id, ib.bl_id,
      coalesce(sn.snapshot->'bls'->ib.bl_id->>'pod', b.pod) AS pod,
      coalesce(sn.snapshot->'bls'->ib.bl_id->>'voyage_number', v.voyage_number) AS voyage_number,
      coalesce(sn.snapshot->'bls'->ib.bl_id->>'vessel_name', vs.name) AS vessel_name
    FROM public.invoice_bls AS ib
    JOIN public.bls AS b ON b.id = ib.bl_id
    LEFT JOIN public.invoice_document_snapshots AS sn ON sn.invoice_id = ib.invoice_id
    LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    UNION ALL
    SELECT irl.invoice_id, irl.bl_id, irl.bl_snapshot->>'pod',
      coalesce(sn.snapshot->'bls'->irl.bl_id->>'voyage_number', v.voyage_number),
      coalesce(sn.snapshot->'bls'->irl.bl_id->>'vessel_name', vs.name)
    FROM public.invoice_receivable_links AS irl
    JOIN public.invoices AS own ON own.id = irl.invoice_id
    LEFT JOIN public.invoice_document_snapshots AS sn ON sn.invoice_id = irl.invoice_id
    LEFT JOIN public.voyages AS v ON v.id = (irl.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE irl.status IN ('active', 'settled_by_this_invoice')
      OR (irl.status = 'obsolete' AND own.status = 'obsolete')
    UNION ALL
    SELECT invoice_id, bl_id, pod, voyage_number, vessel_name
    FROM manual_context
  ),
  agg AS (
    SELECT
      bl_info.invoice_id,
      array_agg(DISTINCT bl_info.vessel_name) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessels,
      array_agg(DISTINCT bl_info.voyage_number) FILTER (WHERE bl_info.voyage_number IS NOT NULL) AS voyages,
      array_agg(DISTINCT CASE
        WHEN bl_info.voyage_number IS NOT NULL AND bl_info.vessel_name IS NOT NULL
          THEN bl_info.vessel_name || ' / ' || bl_info.voyage_number
        ELSE bl_info.vessel_name
      END) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessel_voyages,
      array_agg(DISTINCT bl_info.bl_id) FILTER (WHERE bl_info.bl_id IS NOT NULL) AS bls,
      array_agg(DISTINCT bl_info.pod) FILTER (WHERE bl_info.pod IS NOT NULL) AS pods
    FROM bl_info
    GROUP BY bl_info.invoice_id
  )
  SELECT
    i.id,
    i.invoice_number,
    i.issued_at,
    i.total_brl,
    i.total_paid_brl,
    CASE
      WHEN i.status IN ('covered', 'obsolete') THEN 0::numeric
      WHEN i.invoice_type IN ('individual', 'consolidated') AND ledger.link_count > 0
        THEN ledger.balance_brl
      ELSE i.balance_brl
    END AS balance_brl,
    i.status,
    i.invoice_type,
    COALESCE(agg.vessels, '{}'::text[]),
    COALESCE(agg.voyages, '{}'::text[]),
    COALESCE(agg.vessel_voyages, '{}'::text[]),
    COALESCE(agg.bls, '{}'::text[]),
    COALESCE(agg.pods, '{}'::text[])
  FROM public.invoices AS i
  JOIN eligible_invoices AS eligible ON eligible.invoice_id = i.id
  LEFT JOIN agg ON agg.invoice_id = i.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS link_count,
      COALESCE(SUM(COALESCE(br.balance_brl, 0)), 0) AS balance_brl
    FROM public.invoice_receivable_links AS irl
    JOIN public.bl_receivables AS br ON br.id = irl.receivable_id
    WHERE irl.invoice_id = i.id AND irl.status = 'active'
  ) AS ledger ON true
  WHERE i.customer_id = p_customer_id
  ORDER BY i.created_at DESC;
END;
$function$
LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp';

-- F-46.
CREATE OR REPLACE FUNCTION public.create_manual_invoice(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL::text, p_bl_id text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_actor uuid DEFAULT NULL::uuid, p_charge_item_id bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_result jsonb;
  v_invoice bigint;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da fatura avulsa.' USING ERRCODE = '22023';
  END IF;
  -- F-46 (376): Cliente desativado não recebe fatura nova (ADR 0073, item 6).
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cliente desativado não recebe fatura avulsa. Reative o Cliente antes.' USING ERRCODE = '22023';
  END IF;

  v_result := public._create_manual_invoice_core_272(p_customer_id, p_item_name, p_quantity, p_unit_value_brl,
    p_description, p_bl_id, p_voyage_id, p_actor, p_charge_item_id);
  v_invoice := (v_result->>'invoice_id')::bigint;

  UPDATE public.invoice_lifecycle_events
  SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('reason', v_reason)
  WHERE invoice_id = v_invoice AND event_type = 'issued';

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('invoice', v_invoice::text, 'manual_invoice_reason', NULL, v_reason, auth.uid(), v_reason);

  RETURN v_result;
END;
$function$
LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp';

-- F-47.
CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_invoice_id bigint; bl_id text; refund record; result jsonb; v_e2e text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
 IF auth.uid() IS NULL OR NOT public.is_admin() OR p_actor IS NOT NULL AND p_actor<>auth.uid() THEN RAISE EXCEPTION 'Sem permissão para cancelar baixa.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento da baixa.' USING ERRCODE='22023'; END IF;
 SELECT p.invoice_id INTO v_invoice_id FROM public.payments p WHERE p.id=p_payment_id;
 FOR bl_id IN SELECT l.bl_id FROM public.invoice_receivable_links l WHERE l.invoice_id=v_invoice_id
 UNION SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id=v_invoice_id ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('bl:'||bl_id,0)); END LOOP;
 PERFORM 1 FROM public.invoices i WHERE i.id=v_invoice_id FOR UPDATE;
 PERFORM 1 FROM public.payments WHERE id=p_payment_id FOR UPDATE;
 -- Só excedente automático que nunca foi devolvido pode acompanhar baixa falsa.
 -- Restituição por correção/COD/autorizações independentes permanece protegida.
 FOR refund IN SELECT * FROM public.invoice_refunds WHERE payment_id=p_payment_id AND status='pending'
   AND origin='existing' AND cod_adjustment_id IS NULL AND correction_receivable_id IS NULL FOR UPDATE LOOP
   UPDATE public.invoice_refunds SET status='cancelled',notes=concat_ws(E'\n',notes,'Baixa sem recebimento cancelada: '||btrim(p_reason)) WHERE id=refund.id;
   INSERT INTO public.audit_logs(entity_type,entity_id,field_name,old_value,new_value,changed_by,justification)
    VALUES('invoice_refund',refund.id::text,'pending_excess_cancelled',to_jsonb(refund)::text,'cancelled',auth.uid(),btrim(p_reason));
 END LOOP;
 -- F-47 (376): excedente já devolvido impede o estorno; o pendente de outra
 -- origem é cancelado (não apagado em cascata com a baixa).
 IF EXISTS(SELECT 1 FROM public.invoice_refunds WHERE payment_id=p_payment_id AND status='settled') THEN
   RAISE EXCEPTION 'O excedente desta baixa já foi devolvido ao Cliente: a baixa não pode ser cancelada.' USING ERRCODE='22023';
 END IF;
 UPDATE public.invoice_refunds SET status='cancelled',notes=concat_ws(E'\n',notes,'Baixa cancelada: '||btrim(p_reason))
 WHERE payment_id=p_payment_id AND status='pending';
 -- Baixa automática Itaú cancelada: o Pix volta para análise do Financeiro.
 SELECT upper(btrim(bank_reference)) INTO v_e2e FROM public.payments WHERE id=p_payment_id;
 result := public.reverse_invoice_payment_legacy_134(p_payment_id,p_reason,auth.uid());
 IF v_e2e IS NOT NULL AND EXISTS(SELECT 1 FROM public.itau_pix_receipts WHERE end_to_end_id=v_e2e AND status IN ('settled','handled')) THEN
   UPDATE public.itau_pix_receipts SET status='review',reason='Baixa cancelada: '||btrim(p_reason),handled_at=NULL,handled_by=NULL,handled_note=NULL
   WHERE end_to_end_id=v_e2e;
   PERFORM set_config('request.jwt.claim.role','service_role',true);
   PERFORM public.upsert_alert_item('pix_unreconciled','itau_pix_receipt',v_e2e,
     'A baixa automática do Pix '||v_e2e||' foi cancelada ('||btrim(p_reason)||'): dê a baixa na fatura certa ou registre a devolução.',
     'itau_pix','administrativo',jsonb_build_object('end_to_end_id',v_e2e,'payment_id',p_payment_id),'/reconciliacao');
   PERFORM set_config('request.jwt.claim.role','authenticated',true);
 END IF;
 -- Avulsa não tem recebível de B/L; sua dívida é o total emitido menos baixas.
 UPDATE public.invoices SET balance_brl=greatest(total_brl-total_paid_brl,0),
   status=CASE WHEN total_paid_brl=0 THEN 'issued' WHEN total_brl-total_paid_brl<=0 THEN 'paid' ELSE 'partially_paid' END
 WHERE id=v_invoice_id AND invoice_type='manual' AND status<>'cancelled';
 RETURN result || jsonb_build_object('new_status',(SELECT status FROM public.invoices WHERE id=v_invoice_id));
END $function$;

-- F-48 (texto do alerta).
CREATE OR REPLACE FUNCTION public.alert_stale_invoice_for_bl(p_bl_id text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_invoice record; v_path text;
BEGIN
  FOR v_invoice IN SELECT DISTINCT i.id, i.invoice_number, i.status, i.total_paid_brl FROM public.invoices i
    WHERE i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid')
    AND (EXISTS (SELECT 1 FROM public.invoice_bls b WHERE b.invoice_id = i.id AND b.bl_id = p_bl_id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = i.id AND l.bl_id = p_bl_id
        AND l.status IN ('active', 'settled_by_this_invoice')))
  LOOP
    v_path := CASE WHEN coalesce(v_invoice.total_paid_brl, 0) > 0
      THEN 'Valor maior: emita Fatura Avulsa com a diferença e resolva este alerta com a justificativa. Valor menor é abatido automaticamente.'
      ELSE 'Conclua a revisão do cálculo e use Emitir fatura na ficha do B/L.' END;
    PERFORM public.upsert_alert_item('fatura_desatualizada', 'invoice', v_invoice.id::text,
      'Fatura ' || v_invoice.invoice_number || ' desatualizada pela correcao do B/L ' || p_bl_id || '. ' || v_path,
      p_source, 'administrativo', jsonb_build_object('bl_id', p_bl_id, 'invoice_id', v_invoice.id, 'guidance', v_path),
      '/taxas-locais?invoice=' || v_invoice.id);
  END LOOP;
END;
$function$;

-- F-51.
CREATE OR REPLACE FUNCTION public.obsolete_consolidated_invoice(p_invoice_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_reason TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
  v_reason := COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Marcada obsoleta manualmente');

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') <> 'consolidated' THEN
    RAISE EXCEPTION 'Apenas consolidadas podem ser marcadas obsoletas por esta rotina.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice % nao esta em estado obsoletavel (status=%).', p_invoice_id, v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  -- F-51 (376): consolidada com baixa ou Pix recebido não vira obsoleta à mão.
  IF coalesce(v_invoice.total_paid_brl, 0) > 0
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id)
     OR EXISTS (SELECT 1 FROM public.itau_pix_receipts r JOIN public.itau_pix_charges c ON c.id = r.charge_id WHERE c.invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Consolidada com pagamento ou Pix recebido não pode ser marcada obsoleta. Cancele a baixa ou trate o Pix antes.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices SET status = 'obsolete', obsolete_reason = v_reason WHERE id = p_invoice_id;

  UPDATE public.invoice_receivable_links SET status = 'obsolete'
  WHERE invoice_id = p_invoice_id AND status = 'active';

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', v_actor, jsonb_build_object('reason', v_reason));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', p_invoice_id::TEXT, 'obsolete_consolidated', COALESCE(v_invoice.status, 'issued'), 'obsolete', auth.uid(), now(), v_reason);

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'obsolete', 'reason', v_reason);
END;
$function$;

-- F-53.
CREATE OR REPLACE FUNCTION public.upsert_billing_alert(p_type text, p_bl_id text, p_message text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF p_type NOT IN ('billing_calculation_blocked', 'billing_auto_issue_failed') THEN
    RAISE EXCEPTION 'Tipo de faturamento inválido.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id) THEN
    RAISE EXCEPTION 'B/L não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  -- F-53 (376): o navegador só abre Alerta de faturamento de B/L ainda a
  -- faturar; faturado ou cancelado não tem o que bloquear (347 fecha os dele).
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id
             AND (cancelled_at IS NOT NULL OR coalesce(financial_status, 'pending') <> 'pending')) THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'bl_not_pending');
  END IF;
  RETURN public.upsert_alert_item(
    p_type, 'bl', p_bl_id, p_message, 'billing_client_compatibility',
    'documentacao', COALESCE(p_metadata, '{}'::jsonb), '/taxas-locais'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_stale_invoice(p_invoice_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_customer bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao para resolver alerta.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 15 THEN
    RAISE EXCEPTION 'Informe a justificativa da resolução (mínimo de 15 caracteres): qual avulsa foi emitida ou por que a diferença não é cobrada.' USING ERRCODE = '22023';
  END IF;
  SELECT customer_id INTO v_customer FROM public.invoices WHERE id = p_invoice_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Fatura nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text, 'manual_correction_resolution',
    jsonb_build_object('reason', btrim(p_reason), 'actor', auth.uid()));
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'stale_invoice_resolved', 'resolved', auth.uid(), btrim(p_reason));
END;
$function$;

-- F-51 (Portal).
CREATE OR REPLACE FUNCTION public.portal_obsolete_consolidation(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
BEGIN
  PERFORM public.check_portal_rate_limit('obsolete_consolidation', 3, 15);
  SELECT i.id, i.status, i.invoice_type, i.customer_id, i.invoice_number INTO v_invoice
  FROM public.invoices i WHERE i.id = p_invoice_id AND i.customer_id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.invoice_type != 'consolidated' THEN RAISE EXCEPTION 'Esta fatura nao e uma consolidada.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status IN ('paid', 'covered', 'cancelled', 'obsolete') THEN RAISE EXCEPTION 'Esta fatura ja foi paga ou cancelada e nao pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN RAISE EXCEPTION 'Fatura com pagamento registrado nao pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.invoice_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pix_reconciliation_exceptions e
    WHERE e.status = 'active'
      AND e.normalized_txid = public.normalize_pix_txid(v_invoice.invoice_number)
  ) THEN
    RAISE EXCEPTION 'Há um PIX desta fatura em conciliação; aguarde antes de desfazer.' USING ERRCODE = '55000';
  END IF;
  -- F-51 (376): Pix recebido pelo Itaú na cobrança desta consolidada também segura.
  IF EXISTS (SELECT 1 FROM public.itau_pix_receipts r JOIN public.itau_pix_charges c ON c.id = r.charge_id WHERE c.invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Há um PIX desta fatura recebido pelo banco; aguarde a baixa antes de desfazer.' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', NULL, jsonb_build_object('reason', 'obsoleted_by_customer', 'origin', 'portal', 'customer_id', v_customer_id));
  UPDATE public.invoices SET status = 'obsolete', obsolete_reason = 'Desfeita pelo cliente pelo portal.', updated_at = now() WHERE id = p_invoice_id;
  UPDATE public.invoice_receivable_links SET status = 'obsolete' WHERE invoice_id = p_invoice_id AND status = 'active';
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Consolidacao desfeita',
    'A fatura ' || COALESCE(v_invoice.invoice_number, '#' || p_invoice_id) || ' foi desfeita. Os B/Ls estao disponiveis para nova consolidacao.', '/portal/billing');
  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$function$;

-- F-48: a baixa Itaú (origem própria) conta como a do extrato.
CREATE OR REPLACE FUNCTION public.keep_single_pix_txid_settlement_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.source IN ('pix_extract', 'itau_pix')
     AND NULLIF(TRIM(COALESCE(NEW.pix_txid, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.ledger_settlements
       WHERE invoice_id = NEW.invoice_id
         AND source IN ('pix_extract', 'itau_pix')
         AND pix_txid IS NOT NULL
     ) THEN
    NEW.pix_txid := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- F-48: a baixa Itaú (origem própria) conta como a do extrato.
CREATE OR REPLACE FUNCTION public.pix_reconciliation_authority_holds(p_exception_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_paid_date DATE;
BEGIN
  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id;

  IF NOT FOUND OR v_exception.status <> 'resolved' THEN
    RETURN false;
  END IF;

  IF v_exception.resolution_source = 'local' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.ledger_settlements first_settlement
        ON first_settlement.invoice_id = i.id
       AND first_settlement.source IN ('pix_extract', 'itau_pix')
       AND public.normalize_pix_txid(first_settlement.pix_txid) = v_exception.normalized_txid
      WHERE i.id = v_exception.resolved_invoice_id
        AND i.invoice_type IN ('individual', 'consolidated')
        AND ABS((
          SELECT COALESCE(SUM(all_settlements.amount_brl), 0)
          FROM public.ledger_settlements all_settlements
          WHERE all_settlements.payment_id = first_settlement.payment_id
        ) - v_exception.amount_brl) <= 0.01
        AND (
          public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
          OR v_exception.normalized_txid <> ''
        )
    );
  END IF;

  IF v_exception.resolution_source = 'demurrage' THEN
    IF v_exception.paid_at IS NULL THEN
      RETURN false;
    END IF;
    v_paid_date := (v_exception.paid_at AT TIME ZONE 'UTC')::DATE;
    RETURN EXISTS (
      SELECT 1
      FROM public.demurrage_invoices d
      WHERE d.id = v_exception.resolved_demurrage_invoice_id
        AND d.status = 'paid'
        AND d.conciliated_by_extract = true
        AND d.paid_at = v_paid_date
        AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid
        AND EXISTS (
          SELECT 1
          FROM public.get_demurrage_recent_values(d.id, v_paid_date) w
          WHERE ABS(w.total_brl - v_exception.amount_brl) <= 0.01
        )
    );
  END IF;

  RETURN false;
END;
$function$;

-- F-48.
CREATE OR REPLACE FUNCTION public.itau_pix_settle(p_end_to_end_id text, p_txid text, p_amount_brl numeric, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing text;
  v_charge public.itau_pix_charges%ROWTYPE;
  v_invoice_type text;
  v_duplicate boolean := false;
  v_successor bigint;
  v_actor uuid;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
  v_reason text;
  v_request uuid := md5('itau-pix:' || p_end_to_end_id)::uuid;
BEGIN
  IF p_end_to_end_id IS NULL OR p_txid IS NULL OR p_amount_brl IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  -- Mesma ordem de lock para o mesmo Pix: execuções concorrentes esperam.
  PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
  SELECT status INTO v_existing FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN RETURN v_existing; END IF;

  SELECT * INTO v_charge FROM public.itau_pix_charges WHERE txid = p_txid FOR UPDATE;
  IF FOUND THEN
    -- O Pix existe no banco: a cobrança está paga, haja baixa ou análise.
    -- Marcar antes da baixa evita que o gatilho do QR a veja como aberta e
    -- tente cancelá-la no Itaú.
    UPDATE public.itau_pix_charges SET status = 'concluded', updated_at = now() WHERE id = v_charge.id;
  END IF;
  IF v_charge.id IS NULL THEN
    v_reason := 'TXID do Vela sem cobrança registrada.';
  -- ADR 0093, decisão 18 (375): Pix em duplicidade em fatura de Taxas Locais
  -- já paga, coberta ou cancelada vira recebimento sem fatura aberta, ligado à
  -- fatura de origem, com restituição pendente.
  ELSIF v_charge.invoice_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id
      AND i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('paid', 'covered', 'cancelled')) THEN
    v_reason := 'Pix em duplicidade: a fatura de origem já estava paga, coberta ou cancelada. Restituição pendente registrada; o Pix sai da análise quando a devolução for confirmada.';
    v_duplicate := true;
  -- Demurrage: a cobrança guarda a revisão mais nova; o pagamento da revisão
  -- anterior é válido e register_demurrage_payment confere a janela de PTAX.
  ELSIF v_charge.invoice_id IS NOT NULL AND round(p_amount_brl, 2) <> v_charge.amount_brl THEN
    v_reason := 'Valor recebido difere do valor da cobrança.';
  ELSE
    BEGIN
      -- F-05: o mesmo Pix não é baixado duas vezes (extrato ou baixa manual
      -- com o endToEndId na referência).
      IF v_charge.invoice_id IS NOT NULL AND (
           EXISTS (SELECT 1 FROM public.payments p
                   WHERE upper(btrim(coalesce(p.bank_reference, ''))) = upper(btrim(p_end_to_end_id)))
           OR EXISTS (SELECT 1 FROM public.invoices i
                      WHERE i.id = v_charge.invoice_id AND i.invoice_type = 'manual'
                        AND public.normalize_pix_txid(i.pix_txid) = public.normalize_pix_txid(p_txid))) THEN
        RAISE EXCEPTION 'Pix ja baixado nesta fatura (mesmo TXID ou endToEndId): confira antes de baixar de novo.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_charge.demurrage_invoice_id IS NOT NULL THEN
        v_result := public.register_demurrage_payment(v_request, v_charge.demurrage_invoice_id,
          (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date, p_txid, round(p_amount_brl, 2), NULL);
      ELSE
        SELECT itau_pix_settlement_actor INTO v_actor FROM public.app_settings WHERE id = 1;
        IF v_actor IS NULL THEN
          RAISE EXCEPTION 'Usuário de baixa automática Itaú não configurado.';
        END IF;
        PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
        SELECT invoice_type INTO v_invoice_type FROM public.invoices WHERE id = v_charge.invoice_id;
        IF v_invoice_type = 'manual' THEN
          v_result := public.register_verified_invoice_payment(v_charge.invoice_id, round(p_amount_brl, 2), 'pix',
            p_paid_at, 'Baixa automática Itaú Pix', v_request, p_end_to_end_id);
        ELSIF EXISTS (SELECT 1 FROM public.invoices WHERE id = v_charge.invoice_id AND status = 'obsolete') THEN
          -- 361 (decisão 8): QR da consolidada substituída quita a sucessora
          -- aberta; o excedente vira restituição pendente.
          WITH RECURSIVE chain AS (
            SELECT s.id, s.status, 1 AS depth FROM public.invoices s WHERE s.replaces_invoice_id = v_charge.invoice_id
            UNION ALL
            SELECT s.id, s.status, c.depth + 1 FROM chain c JOIN public.invoices s ON s.replaces_invoice_id = c.id
            WHERE c.depth < 50
          )
          SELECT id INTO v_successor FROM chain WHERE status IN ('issued', 'partially_paid') ORDER BY depth DESC LIMIT 1;
          IF v_successor IS NULL THEN
            RAISE EXCEPTION 'Consolidada substituída sem sucessora aberta para receber o Pix.';
          END IF;
          v_result := public.register_ledger_invoice_payment(v_successor, round(p_amount_brl, 2), 'pix', p_paid_at, NULL,
            'manual', 'Pix do QR da consolidada substituída ' || v_charge.invoice_id || ' (baixa automática Itaú Pix)', v_actor);
          UPDATE public.payments SET bank_reference = p_end_to_end_id WHERE id = (v_result->>'payment_id')::bigint;
        ELSE
          v_result := public.reconcile_invoice_payment_by_txid(p_txid, round(p_amount_brl, 2), p_paid_at);
          IF coalesce((v_result->>'settled')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'Conciliação recusou: %', coalesce(v_result->>'reason', 'sem motivo');
          END IF;
          UPDATE public.payments SET bank_reference = p_end_to_end_id,
            notes = coalesce(notes || ' · ', '') || 'Baixa automática Itaú Pix'
          WHERE id = (v_result->'payment'->>'payment_id')::bigint;
        END IF;
        -- F-48 (376): a baixa automática Itaú tem origem própria.
        UPDATE public.ledger_settlements SET source = 'itau_pix'
        WHERE source = 'pix_extract' AND payment_id IN (SELECT id FROM public.payments WHERE upper(btrim(coalesce(bank_reference, ''))) = upper(p_end_to_end_id));
        PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Mesma regra da 152: erro passageiro falha a chamada para nova tentativa.
      IF left(SQLSTATE, 2) IN ('08', '40', '53', '55', '57', 'XX') THEN RAISE; END IF;
      -- Desfaz só a baixa; a cobrança continua 'concluded' (paga no banco).
      PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      v_reason := left(SQLERRM, 300);
    END;
  END IF;

  INSERT INTO public.itau_pix_receipts(end_to_end_id, txid, charge_id, amount_brl, paid_at, status, reason, result)
  VALUES (p_end_to_end_id, p_txid, v_charge.id, round(p_amount_brl, 2), p_paid_at,
    CASE WHEN v_reason IS NULL THEN 'settled' ELSE 'review' END, v_reason, v_result);
  IF v_duplicate THEN
    INSERT INTO public.invoice_refunds (invoice_id, amount_brl, origin, notes, purpose, itau_end_to_end_id)
    VALUES (v_charge.invoice_id, round(p_amount_brl, 2), 'pix_duplicate',
      'Pix em duplicidade recebido pelo Itaú (endToEndId ' || p_end_to_end_id || ') depois de a fatura estar paga, coberta ou cancelada.',
      'correction', p_end_to_end_id);
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
      'Pix de R$ ' || to_char(round(p_amount_brl, 2), 'FM999G999G990D00') || ' recebido pelo Itaú (TXID ' || p_txid
        || ') não foi baixado automaticamente: ' || v_reason,
      'itau_pix', 'administrativo',
      jsonb_build_object('end_to_end_id', p_end_to_end_id, 'txid', p_txid, 'amount_brl', round(p_amount_brl, 2),
        'invoice_id', v_charge.invoice_id, 'demurrage_invoice_id', v_charge.demurrage_invoice_id),
      '/reconciliacao');
    RETURN 'review';
  END IF;
  RETURN 'settled';
END;
$function$;

-- F-48 (texto).
CREATE OR REPLACE FUNCTION public._calculate_bl_local_charges_impl_106(p_bl_id text, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
AS $function$
DECLARE
  v_bl record;
  v_actor uuid;
  v_has_vehicles boolean := false;
  v_is_exempt boolean := false;
  v_is_lcl_movement boolean := false;
  v_auto_review boolean := false;
  v_line_count integer := 0;
  v_total_brl numeric(14,2) := 0;
  v_total_usd numeric(14,2) := 0;
  v_status text := 'calculated';
  v_reason text := NULL;
  v_no_containers boolean := false;
  v_qty_dual numeric(12,6) := 0;
  item record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    b.id,
    b.voyage_id,
    b.batch_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    b.pod,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::numeric AS bb_weight_ton,
    b.total_weight_kg,
    b.movement_to,
    b.financial_status,
    b.cancelled_at
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- F-28 (372): B/L cancelado é somente leitura também para o cálculo.
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado e somente leitura; reative o B/L para calcular.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%): o recálculo manual não altera a fatura. Corrija os dados do B/L, que a fatura é corrigida automaticamente.', p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  -- ADR 0093, decisão 1: o cálculo usa e grava a tabela vinculada ao B/L.
  PERFORM public.bind_bl_local_charge_tables(p_bl_id);
  -- ADR 0093, decisão 3: a base deste cálculo, para a emissão saber se ainda vale.
  INSERT INTO public.bl_charge_calculation_basis (bl_id, basis, calculated_at)
  VALUES (p_bl_id, public.bl_invoice_basis_snapshot(p_bl_id), now())
  ON CONFLICT (bl_id) DO UPDATE SET basis = EXCLUDED.basis, calculated_at = EXCLUDED.calculated_at;

  IF p_recalculate THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND COALESCE(source, 'auto') = 'auto';
  END IF;

  -- Checar isencao LCL de veiculos
  SELECT EXISTS(SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
  INTO v_has_vehicles;

  v_is_lcl_movement := v_bl.movement_to IS NOT NULL AND (
    UPPER(TRIM(v_bl.movement_to)) LIKE '%LCL%' OR UPPER(TRIM(v_bl.movement_to)) LIKE '%CFS%'
  );

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement THEN
    v_is_exempt := true;
    v_reason := 'Carga de veiculos / LCL no destino (movement_to=' || v_bl.movement_to || ') com taxas pagas na origem';

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity,
      unit_value_brl, total_value_brl, notes, review_reason, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'exempt', 'exempt:lcl_vehicle', 1,
      0, 0, 'Linha sintetica de isencao', v_reason, v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          unit_value_brl = EXCLUDED.unit_value_brl,
          total_value_brl = EXCLUDED.total_value_brl,
          notes = EXCLUDED.notes,
          review_reason = EXCLUDED.review_reason,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET charge_status = 'exempt',
        charges_calculated_at = NOW(),
        charge_exemption_reason = v_reason,
        billing_hold_reason = NULL
    WHERE id = p_bl_id;

    -- F-26 (372): o B/L que ficou isento anula o recebível em aberto.
    PERFORM public.sync_local_charge_receivable(p_bl_id);

    RETURN jsonb_build_object(
      'bl_id', p_bl_id, 'status', 'exempt', 'table_id', NULL,
      'line_count', 1, 'total_brl', 0, 'total_usd', 0,
      'review_required', false, 'exempt', true, 'reason', v_reason
    );
  END IF;

  -- Checagem de B/L de container sem containers
  IF v_bl.cargo_mode IN ('container', 'misto') THEN
    SELECT COUNT(*)
    INTO v_qty_dual
    FROM (
      SELECT 1 FROM public.bl_containers bc
      WHERE bc.bl_id = p_bl_id AND COALESCE(bc.is_imo, false) AND COALESCE(bc.is_oog, false)
    ) s;

    -- IMO e OOG ao mesmo tempo é cobrado pelo motor (THD normal + 150%, migration 129).

    IF v_bl.cargo_mode = 'container' THEN
      SELECT NOT EXISTS(
        SELECT 1 FROM public.bl_containers AS bc
        WHERE bc.bl_id = p_bl_id AND TRIM(COALESCE(bc.container_number, '')) <> ''
      ) INTO v_no_containers;

      IF v_no_containers THEN
        v_auto_review := true;
        INSERT INTO public.charge_calculations (
          bl_id, source, status, calculation_key, quantity,
          total_value_brl, review_reason, notes, created_by, calculated_at
        )
        VALUES (
          p_bl_id, 'auto', 'review_required', 'review:no_containers', 1,
          0, 'B/L de container sem containers cadastrados', 'Revisao manual obrigatoria', v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET status = EXCLUDED.status, quantity = EXCLUDED.quantity,
              total_value_brl = EXCLUDED.total_value_brl, review_reason = EXCLUDED.review_reason,
              notes = EXCLUDED.notes, created_by = EXCLUDED.created_by, calculated_at = NOW();
      END IF;
    END IF;
  END IF;

  -- Iterar linhas resolvidas por resolve_bl_local_charge_items (ADR 0069)
  FOR item IN SELECT * FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) LOOP
    IF item.status = 'review_required' THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.source, item.status, item.calculation_key,
        item.quantity, item.total_value_brl, item.review_reason, item.notes, v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl,
            review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
    ELSE
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, charge_item_id, quantity,
        unit_value_brl, unit_value_usd, total_value_brl, total_value_usd,
        override_applied, source, status, calculation_key,
        created_by, calculated_at
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.quantity,
        item.unit_value_brl, item.unit_value_usd, item.total_value_brl, item.total_value_usd,
        item.override_applied, item.source, item.status, item.calculation_key,
        v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET charge_table_id = EXCLUDED.charge_table_id,
            charge_item_id = EXCLUDED.charge_item_id,
            quantity = EXCLUDED.quantity,
            unit_value_brl = EXCLUDED.unit_value_brl,
            unit_value_usd = EXCLUDED.unit_value_usd,
            total_value_brl = EXCLUDED.total_value_brl,
            total_value_usd = EXCLUDED.total_value_usd,
            override_applied = EXCLUDED.override_applied,
            source = EXCLUDED.source,
            status = EXCLUDED.status,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
    END IF;
  END LOOP;

  SELECT COUNT(*),
         COALESCE(SUM(COALESCE(total_value_brl, 0)), 0),
         COALESCE(SUM(COALESCE(total_value_usd, 0)), 0)
  INTO v_line_count, v_total_brl, v_total_usd
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id;

  IF v_is_exempt THEN
    v_status := 'exempt';
  ELSIF v_auto_review THEN
    v_status := 'review_required';
  ELSIF v_line_count > 0 THEN
    v_status := 'calculated';
  ELSE
    v_status := 'not_calculated';
  END IF;

  UPDATE public.bls
  SET charge_status = v_status,
      charges_calculated_at = NOW(),
      charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END,
      billing_hold_reason = CASE
        WHEN v_status = 'review_required' THEN 'Pendencia de revisao nas taxas locais.'
        WHEN v_status = 'not_calculated' THEN 'Nenhuma tabela de preco ou tarifa encontrada. Adicione os precos e recalcule.'
        ELSE NULL
      END
  WHERE id = p_bl_id;

  PERFORM public.sync_local_charge_receivable(p_bl_id);

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'status', v_status,
    'line_count', v_line_count,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd,
    'review_required', v_auto_review,
    'exempt', (v_status = 'exempt'),
    'reason', COALESCE(v_reason, '')
  );
END;
$function$
LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp';

-- F-55.
CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_items(p_bl_id text, p_pod text)
 RETURNS TABLE(charge_table_id bigint, charge_item_id bigint, quantity numeric, unit_value_brl numeric, unit_value_usd numeric, total_value_brl numeric, total_value_usd numeric, override_applied boolean, source text, status text, calculation_key text, review_reason text, notes text)
AS $function$
DECLARE
  v_bl record;
  v_ref_date date;
  v_tbl record;
  v_table_count integer := 0;
  v_has_container_table boolean := false;
  v_has_bb_table boolean := false;
  v_qty_total numeric(12,6) := 0;
  v_qty_std numeric(12,6) := 0;
  v_qty_imo numeric(12,6) := 0;
  v_qty_oog numeric(12,6) := 0;
  v_qty_dual numeric(12,6) := 0;
  v_dual_thd_seen boolean := false;
  v_dual_qty numeric(12,6);
  v_container_shares jsonb;
  v_weight_ton numeric(12,3);
  v_qty numeric(12,6);
  v_unit_brl numeric(12,2);
  v_unit_usd numeric(12,2);
  v_total_line_brl numeric(14,2);
  v_total_line_usd numeric(14,2);
  v_is_thd boolean;
  v_override boolean;
  v_has_bl_basis_item boolean := false;
  item record;
BEGIN
  SELECT
    b.id,
    b.voyage_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::numeric AS bb_weight_ton,
    b.total_weight_kg
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Regra única com o lançamento manual e a avulsa (migration 248).
  -- ADR 0093, decisão 3: depois do CE vale a data e o preço congelados.
  v_ref_date := coalesce((SELECT f.reference_date FROM public.bl_price_freezes f WHERE f.bl_id = p_bl_id),
    public.bl_local_charge_reference_date(p_bl_id, p_pod));

  -- 1. Contêineres e rateios se container ou misto
  IF v_bl.cargo_mode IN ('container', 'misto') THEN
    WITH current_containers AS (
      SELECT
        UPPER(TRIM(bc.container_number)) AS cn,
        BOOL_OR(COALESCE(bc.is_imo, false)) AS has_imo,
        BOOL_OR(COALESCE(bc.is_oog, false)) AS has_oog,
        BOOL_OR(COALESCE(bc.ownership, 'COC') = 'SOC') AS is_soc
      FROM public.bl_containers AS bc
      WHERE bc.bl_id = p_bl_id
        AND TRIM(COALESCE(bc.container_number, '')) <> ''
      GROUP BY UPPER(TRIM(bc.container_number))
    ),
    shares AS (
      SELECT
        cc.cn,
        cc.has_imo,
        cc.has_oog,
        cc.is_soc,
        sh.share_count,
        sh.last_bl_id
      FROM current_containers AS cc
      JOIN LATERAL (
        SELECT
          COUNT(DISTINCT b2.id)::numeric AS share_count,
          MAX(b2.id) AS last_bl_id
        FROM public.bls AS b2
        JOIN public.bl_containers AS bc2 ON bc2.bl_id = b2.id
        WHERE b2.voyage_id = v_bl.voyage_id
          AND b2.cancelled_at IS NULL
          AND COALESCE(b2.cargo_mode, 'container') IN ('container', 'misto')
          AND UPPER(TRIM(COALESCE(bc2.container_number, ''))) = cc.cn
      ) AS sh ON TRUE
    )
    SELECT
      COALESCE(SUM(CASE WHEN share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN NOT has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_oog AND NOT has_imo AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      jsonb_agg(jsonb_build_object(
        'has_imo', has_imo,
        'has_oog', has_oog,
        'is_soc', is_soc,
        'share_count', share_count,
        'is_last', (p_bl_id = last_bl_id)
      )) FILTER (WHERE share_count > 0)
    INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual, v_container_shares
    FROM shares;
  END IF;

  -- 2. Resolver tabelas (ADR 0069)
  FOR v_tbl IN SELECT table_id, cargo_mode FROM public.resolve_bl_local_charge_table_ids(p_bl_id, v_ref_date) LOOP
    v_table_count := v_table_count + 1;
    IF v_tbl.cargo_mode = 'container' THEN v_has_container_table := true; END IF;
    IF v_tbl.cargo_mode = 'carga_solta' THEN v_has_bb_table := true; END IF;

    -- Iterar itens da tabela ativa
    FOR item IN
      SELECT
        cti.id,
        cti.name,
        cti.application_basis,
        COALESCE(cti.cargo_profile, 'any') AS cargo_profile,
        COALESCE(cti.currency, 'BRL') AS currency,
        CASE WHEN fz.bl_id IS NULL THEN cti.unit_value_brl ELSE fz.unit_value_brl END AS unit_value_brl,
        CASE WHEN fz.bl_id IS NULL THEN cti.unit_value_usd ELSE fz.unit_value_usd END AS unit_value_usd,
        COALESCE(cti.applies_to_soc, true) AS applies_to_soc,
        CASE WHEN fz.bl_id IS NULL THEN ov.override_value ELSE fz.override_value END AS override_value
      FROM public.charge_table_items AS cti
      LEFT JOIN public.bl_price_freeze_items AS fz ON fz.bl_id = p_bl_id AND fz.charge_item_id = cti.id
      LEFT JOIN LATERAL (
        SELECT cro.override_value
        FROM public.customer_rate_overrides AS cro
        WHERE cro.active
          AND cro.customer_id = v_bl.customer_id
          AND cro.charge_item_id = cti.id
          AND (cro.valid_from IS NULL OR cro.valid_from <= v_ref_date)
          AND (cro.valid_to IS NULL OR cro.valid_to >= v_ref_date)
        LIMIT 1
      ) AS ov ON TRUE
      WHERE cti.charge_table_id = v_tbl.table_id
        AND COALESCE(cti.active, true)
        AND NOT COALESCE(cti.manual_only, false)
      ORDER BY COALESCE(cti.sort_order, 100), cti.id
    LOOP
      -- Regra ADR 0069: em BL misto, suprimir itens de base 'bl' da tabela de carga solta
      -- se a tabela de container já forneceu taxa de base 'bl'. Se não forneceu, a taxa
      -- da tabela de carga solta é preservada para evitar perda de receita.
      IF v_bl.cargo_mode = 'misto' AND v_tbl.cargo_mode = 'carga_solta' AND item.application_basis = 'bl' THEN
        IF v_has_bl_basis_item THEN
          CONTINUE;
        END IF;
      END IF;

      charge_table_id := v_tbl.table_id;
      charge_item_id := item.id;
      quantity := 0;
      unit_value_brl := NULL;
      unit_value_usd := NULL;
      total_value_brl := 0;
      total_value_usd := NULL;
      override_applied := false;
      source := 'auto';
      status := 'review_required';
      calculation_key := NULL;
      review_reason := NULL;
      notes := 'Revisao manual obrigatoria';

      v_qty := 0;
      v_is_thd := UPPER(COALESCE(item.name, '')) LIKE 'THD%';

      IF item.application_basis = 'bl' THEN
        v_qty := 1;
        v_has_bl_basis_item := true;
      ELSIF item.application_basis = 'weight_ton' THEN
        -- P0: Para carga solta e misto, usar estritamente bb_weight_ton.
        -- O peso conteinerizado (total_weight_kg) NÃO substitui o peso solto.
        v_weight_ton := CASE
          WHEN v_bl.cargo_mode IN ('carga_solta', 'misto') THEN v_bl.bb_weight_ton
          ELSE COALESCE(v_bl.bb_weight_ton, CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END, 0)
        END;
        IF COALESCE(v_weight_ton, 0) <= 0 THEN
          calculation_key := CONCAT('review:weight_missing:', item.id);
          review_reason := 'Peso de carga solta ausente; o peso conteinerizado nao substitui o peso solto';
          status := 'review_required';
          notes := 'Revisao manual obrigatoria';
          RETURN NEXT;
          CONTINUE;
        END IF;
        v_qty := v_weight_ton;
      ELSIF item.application_basis = 'container_distinct_voyage' THEN
        IF v_bl.cargo_mode IN ('container', 'misto') THEN
          IF v_is_thd THEN
            IF item.cargo_profile = 'standard' THEN
              v_qty := v_qty_std;
            ELSIF item.cargo_profile = 'imo' THEN
              v_qty := v_qty_imo;
            ELSIF item.cargo_profile = 'oog' THEN
              v_qty := v_qty_oog;
            ELSE
              calculation_key := CONCAT('review:thd_any_profile:', item.id);
              review_reason := 'Item THD cadastrado com perfil de carga ''any''; motor so calcula standard/imo/oog';
              notes := 'Revisao manual obrigatoria';
              RETURN NEXT;
              CONTINUE;
            END IF;
          ELSE
            v_qty := v_qty_total;
          END IF;
        END IF;
      ELSE
        calculation_key := CONCAT('review:unsupported_basis:', item.id);
        review_reason := CONCAT('Base de aplicacao nao suportada pelo motor: ', COALESCE(item.application_basis, '(vazia)'));
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- 121: item que nao cobra de SOC (Drop Off, Damage Protection) conta
      -- so os containers COC, com o mesmo rateio e o mesmo filtro de perfil.
      IF item.application_basis = 'container_distinct_voyage'
         AND v_bl.cargo_mode IN ('container', 'misto')
         AND NOT item.applies_to_soc THEN
        SELECT COALESCE(SUM(1 / (elem->>'share_count')::numeric), 0)
        INTO v_qty
        FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
        WHERE NOT (elem->>'is_soc')::boolean
          AND (
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::boolean AND NOT (elem->>'has_imo')::boolean)
          );
      END IF;

      -- ADR 0077 (decisão de 2026-10-02): container IMO e OOG ao mesmo tempo
      -- paga o THD normal com 150% de majoração (50% IMO + 100% OOG). Deriva
      -- do item standard, respeitando Condição do Cliente, rateio e SOC.
      IF v_is_thd AND item.cargo_profile = 'standard' AND item.application_basis = 'container_distinct_voyage'
         AND v_bl.cargo_mode IN ('container', 'misto') AND COALESCE(v_qty_dual, 0) > 0 THEN
        v_dual_thd_seen := true;
        SELECT COALESCE(SUM(1 / (elem->>'share_count')::numeric), 0)
        INTO v_dual_qty
        FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
        WHERE (elem->>'has_imo')::boolean AND (elem->>'has_oog')::boolean
          AND (item.applies_to_soc OR NOT (elem->>'is_soc')::boolean);
        IF v_dual_qty > 0 THEN
          -- 171: a condição vale na moeda do item.
          v_unit_brl := ROUND(COALESCE(CASE WHEN item.currency = 'USD' THEN NULL ELSE item.override_value END, item.unit_value_brl, 0) * 2.5, 2);
          v_unit_usd := ROUND(COALESCE(CASE WHEN item.currency = 'USD' THEN item.override_value END, item.unit_value_usd, 0) * 2.5, 2);
          status := 'calculated';
          review_reason := NULL;
          notes := 'THD IMO e OOG: THD normal com 150% de majoracao';
          calculation_key := CONCAT('auto:item:', item.id, ':imo_oog');
          override_applied := item.override_value IS NOT NULL;
          quantity := v_dual_qty;
          unit_value_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE v_unit_brl END;
          unit_value_usd := CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE NULL END;
          SELECT COALESCE(SUM(
            CASE WHEN (elem->>'is_last')::boolean
              THEN u.unit - ((elem->>'share_count')::numeric - 1) * ROUND(u.unit / (elem->>'share_count')::numeric, 2)
              ELSE ROUND(u.unit / (elem->>'share_count')::numeric, 2)
            END
          ), 0)
          INTO v_total_line_brl
          FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
          CROSS JOIN LATERAL (SELECT CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE v_unit_brl END AS unit) AS u
          WHERE (elem->>'has_imo')::boolean AND (elem->>'has_oog')::boolean
            AND (item.applies_to_soc OR NOT (elem->>'is_soc')::boolean);
          total_value_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE v_total_line_brl END;
          total_value_usd := CASE WHEN item.currency = 'USD' THEN v_total_line_brl ELSE NULL END;
          RETURN NEXT;
        END IF;
      END IF;

      IF COALESCE(v_qty, 0) <= 0 THEN
        CONTINUE;
      END IF;

      status := 'calculated';
      notes := NULL;
      calculation_key := CONCAT('auto:item:', item.id);
      v_override := item.override_value IS NOT NULL;
      override_applied := v_override;
      -- 171: a condição vale na moeda do item.
      v_unit_brl := COALESCE(CASE WHEN item.currency = 'USD' THEN NULL ELSE item.override_value END, item.unit_value_brl, 0);
      v_unit_usd := CASE WHEN item.currency = 'USD' THEN COALESCE(item.override_value, item.unit_value_usd) ELSE item.unit_value_usd END;
      quantity := v_qty;
      unit_value_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE v_unit_brl END;
      unit_value_usd := CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE NULL END;

      IF item.application_basis = 'container_distinct_voyage' AND v_bl.cargo_mode IN ('container', 'misto') THEN
        IF item.currency = 'USD' THEN
          SELECT COALESCE(SUM(
            CASE WHEN (elem->>'is_last')::boolean
              THEN COALESCE(v_unit_usd, 0) - ((elem->>'share_count')::numeric - 1) * ROUND(COALESCE(v_unit_usd, 0) / (elem->>'share_count')::numeric, 2)
              ELSE ROUND(COALESCE(v_unit_usd, 0) / (elem->>'share_count')::numeric, 2)
            END
          ), 0)
          INTO v_total_line_usd
          FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
          WHERE (
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::boolean AND NOT (elem->>'has_imo')::boolean)
          )
            AND (item.applies_to_soc OR NOT (elem->>'is_soc')::boolean);
          v_total_line_brl := NULL;
        ELSE
          SELECT COALESCE(SUM(
            CASE WHEN (elem->>'is_last')::boolean
              THEN COALESCE(v_unit_brl, 0) - ((elem->>'share_count')::numeric - 1) * ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::numeric, 2)
              ELSE ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::numeric, 2)
            END
          ), 0)
          INTO v_total_line_brl
          FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
          WHERE (
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::boolean AND NOT (elem->>'has_oog')::boolean)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::boolean AND NOT (elem->>'has_imo')::boolean)
          )
            AND (item.applies_to_soc OR NOT (elem->>'is_soc')::boolean);
          v_total_line_usd := NULL;
        END IF;
      ELSE
        v_total_line_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE ROUND(v_qty * COALESCE(v_unit_brl, 0), 2) END;
        v_total_line_usd := CASE WHEN item.currency = 'USD' THEN ROUND(v_qty * COALESCE(v_unit_usd, 0), 2) ELSE NULL END;
      END IF;

      total_value_brl := v_total_line_brl;
      total_value_usd := v_total_line_usd;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  -- F-55 (376): container IMO e OOG sem item THD standard na tabela não fica
  -- sem cobrança em silêncio: o cálculo vai para revisão.
  IF v_table_count > 0 AND COALESCE(v_qty_dual, 0) > 0 AND v_bl.cargo_mode IN ('container', 'misto') AND NOT v_dual_thd_seen THEN
    charge_table_id := NULL;
    charge_item_id := NULL;
    quantity := v_qty_dual;
    unit_value_brl := NULL;
    unit_value_usd := NULL;
    total_value_brl := 0;
    total_value_usd := NULL;
    override_applied := false;
    source := 'auto';
    status := 'review_required';
    calculation_key := 'review:thd_imo_oog_without_standard';
    review_reason := 'Container IMO e OOG sem item THD standard na tabela: cadastre o THD standard ou cobre por Fatura Avulsa';
    notes := 'Revisao manual obrigatoria';
    RETURN NEXT;
  END IF;

  -- 3. Tratar ausencias de tabelas conforme ADR 0069 (eliminando retorno silencioso)
  IF v_table_count = 0 THEN
    charge_table_id := NULL;
    charge_item_id := NULL;
    quantity := 1;
    unit_value_brl := NULL;
    unit_value_usd := NULL;
    total_value_brl := 0;
    total_value_usd := NULL;
    override_applied := false;
    source := 'auto';
    status := 'review_required';
    calculation_key := 'review:no_table';
    review_reason := 'Nenhuma tabela de taxas ativa encontrada para o porto de descarga';
    notes := 'Revisao manual obrigatoria';
    RETURN NEXT;

  ELSIF v_bl.cargo_mode = 'misto' AND v_table_count = 1 THEN
    charge_table_id := NULL;
    charge_item_id := NULL;
    quantity := 1;
    unit_value_brl := NULL;
    unit_value_usd := NULL;
    total_value_brl := 0;
    total_value_usd := NULL;
    override_applied := false;
    source := 'auto';
    status := 'review_required';
    calculation_key := CASE WHEN NOT v_has_container_table THEN 'review:missing_charge_table:container' ELSE 'review:missing_charge_table:carga_solta' END;
    review_reason := 'Tabela de taxas parcial em B/L misto: falta tabela complementar';
    notes := 'Revisao manual obrigatoria';
    RETURN NEXT;
  END IF;

  RETURN;
END;
$function$
LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp';

-- F-46 (linha USD).
CREATE OR REPLACE FUNCTION public.quote_manual_invoice_charge(p_bl_id text, p_charge_item_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item record;
  v_basis text;
  v_quantity numeric := 1;
  v_unit numeric;
  v_roe numeric;
  v_roe_date date;
  v_override bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.list_manual_charge_items_for_bl(p_bl_id)
    WHERE charge_item_id = p_charge_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual nao elegivel para este B/L.' USING ERRCODE = '22023';
  END IF;
  SELECT application_basis INTO v_basis FROM public.charge_table_items WHERE id = p_charge_item_id;
  IF v_basis = 'teu' THEN
    SELECT sum(CASE WHEN normalized ~ '^45' THEN 2.25 WHEN normalized ~ '^(40|42)' THEN 2
      WHEN normalized ~ '^(20|22)' THEN 1 ELSE NULL END)
    INTO v_quantity FROM (SELECT regexp_replace(upper(coalesce(type, '')), '[[:space:]-]', '', 'g') normalized
      FROM public.bl_containers WHERE bl_id = upper(btrim(p_bl_id))) c;
    IF EXISTS (SELECT 1 FROM public.bl_containers WHERE bl_id = upper(btrim(p_bl_id))
      AND regexp_replace(upper(coalesce(type, '')), '[[:space:]-]', '', 'g') !~ '^(45|40|42|20|22)') THEN
      RAISE EXCEPTION 'Tipo de container desconhecido; confira os TEUs do B/L.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_basis IS DISTINCT FROM 'bl' THEN
    RAISE EXCEPTION 'Base de cobranca nao suportada na avulsa: %.', v_basis USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'B/L sem quantidade faturavel.' USING ERRCODE = '22023';
  END IF;
  SELECT cro.id INTO v_override FROM public.customer_rate_overrides cro
    JOIN public.bls b ON b.customer_id = cro.customer_id
    WHERE b.id = upper(btrim(p_bl_id)) AND cro.charge_item_id = p_charge_item_id AND cro.active
      AND (cro.valid_from IS NULL OR cro.valid_from <= public.bl_local_charge_reference_date(b.id))
      AND (cro.valid_to IS NULL OR cro.valid_to >= public.bl_local_charge_reference_date(b.id))
    ORDER BY cro.created_at DESC LIMIT 1;
  IF v_item.currency = 'USD' THEN
    SELECT roe, effective_date INTO v_roe, v_roe_date FROM public.exchange_rate_reference WHERE id = 1;
    IF v_roe IS NULL OR v_roe <= 0 THEN
      RAISE EXCEPTION 'Cambio (ROE) nao configurado.' USING ERRCODE = '22023';
    END IF;
    v_unit := round(v_item.effective_unit_value_usd * v_roe, 2);
  ELSE
    v_unit := v_item.effective_unit_value_brl;
  END IF;
  RETURN to_jsonb(v_item) || jsonb_build_object('quantity', v_quantity, 'application_basis', v_basis,
    'unit_value_brl', v_unit, -- F-46 (376): a linha da avulsa fecha (quantidade × unitário = total) também em USD.
    'total_brl', round(v_quantity * v_unit, 2),
    'total_usd', CASE WHEN v_item.currency = 'USD' THEN round(v_quantity * v_item.effective_unit_value_usd, 2) END,
    'roe', v_roe, 'roe_effective_date', v_roe_date, 'override_id', v_override);
END;
$function$;

-- F-46: avulsa paga, paga em parte ou cancelada registra o evento do ciclo de vida.
CREATE OR REPLACE FUNCTION public.record_manual_invoice_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.invoice_type = 'manual' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('paid', 'partially_paid', 'cancelled') THEN
    INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
    VALUES (NEW.id, NEW.status, auth.uid(), jsonb_build_object('from', OLD.status, 'total_paid_brl', NEW.total_paid_brl,
      'balance_brl', NEW.balance_brl, 'reason', NEW.cancel_reason));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_manual_invoice_lifecycle() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER record_manual_invoice_lifecycle
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.record_manual_invoice_lifecycle();

-- F-47: a restituição cancelada perde o vínculo com a baixa apagada (SET NULL);
-- o resto continua imutável.
CREATE OR REPLACE FUNCTION public.guard_financial_refund_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_free text[] := ARRAY['status','settled_at','settled_by','bank_reference','beneficiary','notes'];
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.status='settled' THEN RAISE EXCEPTION 'Devolução confirmada é histórico financeiro e não pode ser apagada.' USING ERRCODE='22023'; END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='INSERT' AND NEW.status='settled' THEN RAISE EXCEPTION 'Registre a autorização pendente e confirme a devolução com comprovante.' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.status='settled' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN RAISE EXCEPTION 'Devolução confirmada não pode ser alterada.' USING ERRCODE='22023'; END IF;
   IF OLD.status='cancelled' AND to_jsonb(NEW)->'payment_id' = 'null'::jsonb THEN v_free := array_append(v_free, 'payment_id'); END IF;
   IF (to_jsonb(OLD)-v_free) IS DISTINCT FROM (to_jsonb(NEW)-v_free) THEN
     RAISE EXCEPTION 'Valor, origem e autorização da restituição são imutáveis.' USING ERRCODE='22023'; END IF;
   IF NEW.status='settled' AND OLD.status IS DISTINCT FROM 'settled' THEN
     IF auth.uid() IS NULL OR NOT public.is_financeiro_user() OR NEW.settled_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Sem permissão para confirmar devolução.' USING ERRCODE='42501'; END IF;
     IF length(btrim(coalesce(NEW.bank_reference,'')))<3 OR length(btrim(coalesce(NEW.beneficiary,'')))<3 OR NEW.settled_at IS NULL OR NEW.settled_at>now() THEN
       RAISE EXCEPTION 'Devolução exige referência bancária, favorecido e data efetiva.' USING ERRCODE='22023'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $function$;
