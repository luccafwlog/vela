-- 066: remediações dos achados das auditorias de sistemas críticos marítimos.
-- Esta migration depende da afirmação "Data status" do AGENTS.md: a base de
-- produção ainda contém apenas fixtures e as linhas existentes podem ser
-- normalizadas pelos UPDATEs de saneamento abaixo.
--
-- A migration coloca as invariantes na fronteira transacional: a UI pode
-- continuar evoluindo, mas não consegue emitir um documento incompleto,
-- duplicar uma baixa, cobrar uma tarifa inexistente ou mutar uma viagem selada.

-- ---------------------------------------------------------------------------
-- 1. Documento do B/L: Laden on Board é fato próprio e alimenta o ATD na mesma
--    transação do import. Não reutilizar bl_emission_date para este dado.
-- ---------------------------------------------------------------------------
ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS laden_on_board date;

COMMENT ON COLUMN public.bls.laden_on_board IS
  'Data documental Laden on Board. Fonte canônica do ATD do POL (ADR 0025), independente da data de emissão do B/L.';

-- O wrapper atual delega a validação/efeitos à cadeia legacy. A extensão abaixo
-- persiste o fato documental e recalcula o menor ATD de cada Viagem+POL antes
-- de devolver o resultado ao chamador, portanto não existe janela pós-commit.
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_item jsonb;
  v_bl_id text;
  v_next text[];
  v_current text[];
  v_voyage_ids bigint[] := ARRAY[]::bigint[];
  v_voyage_id bigint;
  v_pol text;
  v_canonical_atd date;
  v_current_atd text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  v_result := public.import_bl_freight_transactional_legacy_357(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    -- Preserva o fato já cadastrado quando um payload antigo não possui a chave.
    IF v_item ? 'laden_on_board' THEN
      UPDATE public.bls
      SET laden_on_board = NULLIF(v_item->>'laden_on_board', '')::date,
          updated_at = now()
      WHERE id = v_bl_id;
    END IF;

    v_next := public.normalize_ncm_codes(v_item->'ncm_codes');
    CONTINUE WHEN cardinality(v_next) = 0;
    SELECT ncm_codes INTO v_current FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND OR v_current = v_next;
    UPDATE public.bls SET ncm_codes = v_next WHERE id = v_bl_id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_bl_id, 'ncm_codes', array_to_string(COALESCE(v_current, ARRAY[]::text[]), ', '), array_to_string(v_next, ', '), p_changed_by, 'NCM declarado no documento reimportado');
  END LOOP;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);

  SELECT v_voyage_ids || COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  FOR v_voyage_id IN
    SELECT DISTINCT ids.voyage_id FROM unnest(v_voyage_ids) AS ids(voyage_id)
    WHERE ids.voyage_id IS NOT NULL ORDER BY ids.voyage_id
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_import');

    FOR v_pol IN
      SELECT DISTINCT upper(btrim(b.pol))
      FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id AND NULLIF(btrim(b.pol), '') IS NOT NULL
    LOOP
      SELECT min(b.laden_on_board) INTO v_canonical_atd
      FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id AND upper(btrim(b.pol)) = v_pol;

      SELECT al.new_value INTO v_current_atd
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pol_schedule'
        AND al.entity_id = v_voyage_id::text || '::' || v_pol
        AND al.field_name = 'atd'
      ORDER BY al.changed_at DESC, al.id DESC
      LIMIT 1;

      IF v_current_atd IS DISTINCT FROM v_canonical_atd::text THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (
          'voyage_pol_schedule', v_voyage_id::text || '::' || v_pol, 'atd',
          v_current_atd, v_canonical_atd::text, p_changed_by,
          'ATD derivado do menor Laden on Board persistido na mesma transação do import (ADR 0025)'
        );
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Demurrage: uma invoice emitida só existe quando o conjunto inteiro do
--    B/L está devolvido e cada container aparece exatamente uma vez.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_complete(p_invoice_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text;
  v_expected integer;
  v_items integer;
BEGIN
  SELECT bl_id INTO v_bl_id FROM public.demurrage_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.demurrage_invoices WHERE id = p_invoice_id AND status IN ('issued', 'paid')) THEN
    SELECT count(*) INTO v_expected FROM public.bl_containers WHERE bl_id = v_bl_id;
    IF v_expected = 0 OR EXISTS (
      SELECT 1 FROM public.bl_containers WHERE bl_id = v_bl_id AND return_date IS NULL
    ) THEN
      RAISE EXCEPTION 'Demurrage só pode ser emitida após a devolução de todos os containers do B/L %.' , v_bl_id USING ERRCODE = '23514';
    END IF;

    SELECT count(DISTINCT item.container_id) INTO v_items
    FROM public.demurrage_invoice_items AS item WHERE item.invoice_id = p_invoice_id;
    IF v_items <> v_expected OR EXISTS (
      SELECT 1
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
      GROUP BY item.container_id
      HAVING count(*) > 1
    ) OR EXISTS (
      SELECT 1
      FROM public.demurrage_invoice_items AS item
      WHERE item.invoice_id = p_invoice_id
        AND NOT EXISTS (SELECT 1 FROM public.bl_containers AS bc WHERE bc.id = item.container_id AND bc.bl_id = v_bl_id)
    ) OR EXISTS (
      SELECT 1 FROM public.bl_containers AS bc
      WHERE bc.bl_id = v_bl_id
        AND NOT EXISTS (SELECT 1 FROM public.demurrage_invoice_items AS item WHERE item.invoice_id = p_invoice_id AND item.container_id = bc.id)
    ) THEN
      RAISE EXCEPTION 'Demurrage do B/L % não contém o conjunto completo e exclusivo de containers.', v_bl_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$function$;

-- PostgreSQL constraint triggers pass OLD/NEW through a trigger function.
CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  PERFORM public.assert_demurrage_invoice_complete(COALESCE(NEW.id, OLD.id));
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_demurrage_invoice_item_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  PERFORM public.assert_demurrage_invoice_complete(COALESCE(NEW.invoice_id, OLD.invoice_id));
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assert_demurrage_invoice_complete ON public.demurrage_invoices;
CREATE CONSTRAINT TRIGGER trg_assert_demurrage_invoice_complete
AFTER INSERT OR UPDATE OF status ON public.demurrage_invoices
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.assert_demurrage_invoice_row();

DROP TRIGGER IF EXISTS trg_assert_demurrage_invoice_items_complete ON public.demurrage_invoice_items;
CREATE CONSTRAINT TRIGGER trg_assert_demurrage_invoice_items_complete
AFTER INSERT OR UPDATE OR DELETE ON public.demurrage_invoice_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.assert_demurrage_invoice_item_row();

-- ---------------------------------------------------------------------------
-- 3. Baixa manual do ledger: request_id torna retry de rede idempotente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_payment_requests (
  request_id uuid PRIMARY KEY,
  payload_hash text NOT NULL,
  result jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ledger_payment_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ledger_payment_requests FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.register_ledger_invoice_payment(
  bigint, numeric, text, timestamptz, text, text, text, uuid
) RENAME TO register_ledger_invoice_payment_legacy_066;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(
  p_invoice_id bigint,
  p_amount_brl numeric,
  p_method text,
  p_paid_at timestamptz,
  p_pix_txid text,
  p_source text,
  p_notes text,
  p_actor uuid,
  p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid := COALESCE(p_request_id, gen_random_uuid());
  v_hash text := md5(jsonb_build_object('invoice_id', p_invoice_id, 'amount_brl', round(p_amount_brl::numeric, 2), 'method', p_method, 'paid_at', p_paid_at, 'pix_txid', p_pix_txid, 'source', p_source, 'notes', p_notes, 'actor', p_actor)::text);
  v_existing public.ledger_payment_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ledger_payment_requests(request_id, payload_hash, created_by)
  VALUES (v_request_id, v_hash, COALESCE(p_actor, auth.uid()))
  ON CONFLICT (request_id) DO NOTHING;
  SELECT * INTO v_existing FROM public.ledger_payment_requests WHERE request_id = v_request_id FOR UPDATE;
  IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Request de pagamento % já foi usado com outro payload.', v_request_id USING ERRCODE = '22023';
  END IF;
  IF v_existing.result IS NOT NULL THEN RETURN v_existing.result; END IF;

  PERFORM public.assert_ledger_invoice_payment_allocation(p_invoice_id, p_amount_brl);
  v_result := public.register_ledger_invoice_payment_legacy_066(
    p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor
  );
  UPDATE public.ledger_payment_requests SET result = v_result WHERE request_id = v_request_id;
  RETURN v_result;
END;
$function$;

-- Compatibilidade para callers antigos: eles também ganham uma chave nova,
-- enquanto o cliente atualizado envia a chave estável da tentativa.
CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(
  p_invoice_id bigint,
  p_amount_brl numeric,
  p_method text DEFAULT 'pix',
  p_paid_at timestamptz DEFAULT now(),
  p_pix_txid text DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_notes text DEFAULT NULL,
  p_actor uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.register_ledger_invoice_payment(p_invoice_id, p_amount_brl, p_method, p_paid_at, p_pix_txid, p_source, p_notes, p_actor, gen_random_uuid());
$function$;

REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment(bigint,numeric,text,timestamptz,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_ledger_invoice_payment(bigint,numeric,text,timestamptz,text,text,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment(bigint,numeric,text,timestamptz,text,text,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_ledger_invoice_payment(bigint,numeric,text,timestamptz,text,text,text,uuid,uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Tarifas: valor ausente vira revisão explícita, nunca zero silencioso.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_missing_charge_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_currency text;
BEGIN
  IF NEW.charge_item_id IS NULL THEN RETURN NEW; END IF;
  SELECT upper(coalesce(currency, 'BRL')) INTO v_currency FROM public.charge_table_items WHERE id = NEW.charge_item_id;
  IF v_currency = 'USD' AND NEW.unit_value_usd IS NULL THEN
    NEW.status := 'review_required'; NEW.total_value_usd := NULL; NEW.total_value_brl := NULL;
    NEW.review_reason := 'Tarifa USD sem valor unitário vigente.'; NEW.notes := 'Revisão manual obrigatória';
  ELSIF v_currency <> 'USD' AND NEW.unit_value_brl IS NULL THEN
    NEW.status := 'review_required'; NEW.total_value_usd := NULL; NEW.total_value_brl := NULL;
    NEW.review_reason := 'Tarifa BRL sem valor unitário vigente.'; NEW.notes := 'Revisão manual obrigatória';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_missing_charge_price ON public.charge_calculations;
CREATE TRIGGER trg_guard_missing_charge_price
BEFORE INSERT OR UPDATE OF charge_item_id, unit_value_brl, unit_value_usd, status
ON public.charge_calculations FOR EACH ROW EXECUTE FUNCTION public.guard_missing_charge_price();

UPDATE public.charge_calculations AS cc
SET status = 'review_required', total_value_brl = NULL, total_value_usd = NULL,
    review_reason = CASE WHEN upper(coalesce(cti.currency, 'BRL')) = 'USD' THEN 'Tarifa USD sem valor unitário vigente.' ELSE 'Tarifa BRL sem valor unitário vigente.' END,
    notes = 'Revisão manual obrigatória'
FROM public.charge_table_items AS cti
WHERE cti.id = cc.charge_item_id
  AND ((upper(coalesce(cti.currency, 'BRL')) = 'USD' AND cc.unit_value_usd IS NULL)
    OR (upper(coalesce(cti.currency, 'BRL')) <> 'USD' AND cc.unit_value_brl IS NULL))
  AND coalesce(cc.status, 'calculated') IN ('calculated', 'ready_for_billing');

-- ---------------------------------------------------------------------------
-- 5. Rateio de container compartilhado: recalcular/segurar antes de criar uma
--    invoice, evitando que uma segunda B/L carregue 150% do valor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_shared_container_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_bl_id text := NEW.bl_id;
  v_shared text;
BEGIN
  SELECT upper(btrim(bc.container_number)) INTO v_shared
  FROM public.bl_containers AS bc
  JOIN public.bls AS b ON b.id = bc.bl_id
  WHERE bc.bl_id = v_bl_id
    AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
    AND (SELECT count(DISTINCT b2.id) FROM public.bl_containers bc2 JOIN public.bls b2 ON b2.id = bc2.bl_id WHERE b2.voyage_id = b.voyage_id AND upper(btrim(bc2.container_number)) = upper(btrim(bc.container_number))) > 1
  LIMIT 1;
  IF v_shared IS NULL THEN RETURN NEW; END IF;

  -- Dois B/Ls ainda não faturados podem ser calculados juntos. O bloqueio só
  -- é necessário quando um irmão já tem snapshot financeiro em outra invoice;
  -- se os dois links pertencem à mesma invoice, o rateio permanece atômico.
  IF EXISTS (
    SELECT 1
    FROM public.bl_containers AS sibling_container
    JOIN public.bls AS sibling ON sibling.id = sibling_container.bl_id
    JOIN public.bls AS root ON root.id = v_bl_id
    WHERE sibling.id <> v_bl_id
      AND sibling.voyage_id = root.voyage_id
      AND upper(btrim(sibling_container.container_number)) = v_shared
      AND sibling.financial_status IN ('invoiced', 'paid')
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_bls AS same_invoice
        WHERE same_invoice.invoice_id = NEW.invoice_id AND same_invoice.bl_id = sibling.id
      )
  ) THEN
    RAISE EXCEPTION 'Container compartilhado % já possui snapshot financeiro em outra B/L; recalcule e cancele/reemita antes de faturar.', v_shared USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_shared_container_invoice ON public.invoice_bls;
CREATE TRIGGER trg_guard_shared_container_invoice
BEFORE INSERT OR UPDATE OF bl_id ON public.invoice_bls
FOR EACH ROW EXECUTE FUNCTION public.guard_shared_container_invoice();

CREATE OR REPLACE FUNCTION public.guard_shared_container_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_bl_id text := COALESCE(NEW.bl_id, OLD.bl_id);
  v_voyage_id bigint;
  v_number text;
BEGIN
  SELECT voyage_id INTO v_voyage_id FROM public.bls WHERE id = v_bl_id;
  SELECT upper(btrim(COALESCE(NEW.container_number, OLD.container_number))) INTO v_number;
  IF v_voyage_id IS NULL OR v_number IS NULL OR v_number = '' THEN IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.bl_containers bc JOIN public.bls b ON b.id = bc.bl_id
    WHERE b.voyage_id = v_voyage_id AND upper(btrim(bc.container_number)) = v_number
      AND b.id <> v_bl_id AND b.financial_status IN ('invoiced', 'paid')
  ) THEN
    RAISE EXCEPTION 'Container compartilhado % já está faturado em outra B/L; cancele/reemita antes de alterar o conjunto.', v_number USING ERRCODE = 'P0003';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_shared_container_mutation ON public.bl_containers;
CREATE TRIGGER trg_guard_shared_container_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.bl_containers
FOR EACH ROW EXECUTE FUNCTION public.guard_shared_container_mutation();

-- ---------------------------------------------------------------------------
-- 6. PTAX: disputa aberta não impede atualização cambial; a disputa só exige
--    decisão humana antes do dunning/fechamento, não congela o fato cambial.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(
  p_ptax numeric, p_quote_date date, p_source text DEFAULT 'bcb_live'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_roe numeric; v_updated integer := 0; v_inv record; v_total_brl numeric(14,2); v_pix_payload text; v_discount_usd numeric(12,2);
BEGIN
  IF p_ptax IS NULL OR p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN' OR p_quote_date IS NULL THEN
    RAISE EXCEPTION 'PTAX e data de cotacao sao obrigatorias.' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('bcb_live', 'cached', 'manual') THEN RAISE EXCEPTION 'Origem de PTAX invalida: %.', p_source USING ERRCODE = '22023'; END IF;
  v_roe := public._demurrage_roe_from_ptax(p_ptax);
  PERFORM public.save_exchange_rate_reference_v2(p_ptax, v_roe, p_quote_date, p_source, p_quote_date);
  FOR v_inv IN
    SELECT id, total_usd, coalesce(discount_value, 0) AS discount_value, discount_mode, doc_number, current_roe
    FROM public.demurrage_invoices WHERE status = 'issued' AND paid_at IS NULL FOR UPDATE
  LOOP
    CONTINUE WHEN v_inv.current_roe IS NOT NULL AND v_inv.current_roe = v_roe;
    v_discount_usd := 0;
    IF v_inv.discount_value > 0 THEN
      v_discount_usd := CASE WHEN v_inv.discount_mode = 'percent' THEN round(v_inv.total_usd * (v_inv.discount_value / 100), 2) ELSE v_inv.discount_value END;
    END IF;
    v_total_brl := round(greatest(v_inv.total_usd - v_discount_usd, 0) * v_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_inv.doc_number) ELSE NULL END;
    UPDATE public.demurrage_invoices SET current_roe = v_roe, current_total_brl = v_total_brl, roe_source = p_source, pix_payload = v_pix_payload, updated_at = now() WHERE id = v_inv.id;
    INSERT INTO public.demurrage_invoice_history(invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES (v_inv.id, p_quote_date, p_ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd, p_source);
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('updated', v_updated, 'roe', v_roe, 'quote_date', p_quote_date, 'source', p_source);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. COD: uma transição COD é idempotente e não pode criar dois ajustes
--    pendentes para a mesma omissão.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS cod_adjustments_one_pending_transition_idx
ON public.cod_adjustments(bl_id, omission_id) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.set_bl_cod(
  p_bl_id text, p_omission_id bigint, p_justification text, p_changed_by uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_discharge text; v_omitted text; v_old_pod text; v_customer bigint; v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501'; END IF;
  IF v_justification IS NULL THEN RAISE EXCEPTION 'Marcar COD exige justificativa.' USING ERRCODE = '22023'; END IF;
  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments t JOIN public.voyage_omissions o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002'; END IF;
  SELECT pod, customer_id INTO v_old_pod, v_customer FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002'; END IF;
  -- Retry do mesmo COD não repete efeito financeiro, auditoria ou notificação;
  -- inclusive quando a reprecificação concluiu que não havia diferença.
  IF EXISTS (
    SELECT 1
    FROM public.bl_transshipments
    WHERE bl_id = p_bl_id AND omission_id = p_omission_id AND disposition = 'cod'
  ) THEN
    RETURN;
  END IF;
  UPDATE public.bl_transshipments SET disposition = 'cod', updated_at = now() WHERE bl_id = p_bl_id AND omission_id = p_omission_id;
  UPDATE public.bls SET pod = v_discharge, manifesto_mercante_id = NULL, updated_at = now() WHERE id = p_bl_id;
  PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by, 'COD apos omissao da escala de ' || v_omitted || ': ' || v_justification);
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (v_customer, p_bl_id, 'transshipment', 'Destino alterado (COD)', 'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge || ' (COD), apos a omissao da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Exportação e viagem cancelada: a proteção é no banco, não só na UI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_export_schedule_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_voyage_id bigint := COALESCE(OLD.voyage_id, NEW.voyage_id); v_pol text := upper(btrim(COALESCE(OLD.pol, NEW.pol)));
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.tem_exportacao) OR (TG_OP = 'UPDATE' AND OLD.tem_exportacao AND NOT NEW.tem_exportacao) THEN
    IF EXISTS (SELECT 1 FROM public.granite_manifests WHERE voyage_id = v_voyage_id AND upper(btrim(loading_port)) = v_pol)
       OR EXISTS (SELECT 1 FROM public.vazios_export_operations WHERE voyage_id = v_voyage_id AND upper(btrim(embark_port)) = v_pol) THEN
      RAISE EXCEPTION 'Não é possível remover a declaração de exportação da escala %: existem operações de carga.', v_pol USING ERRCODE = 'P0003';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_export_schedule_removal ON public.voyage_export_schedules;
CREATE TRIGGER trg_guard_export_schedule_removal
BEFORE DELETE OR UPDATE OF tem_exportacao ON public.voyage_export_schedules
FOR EACH ROW EXECUTE FUNCTION public.guard_export_schedule_removal();

CREATE OR REPLACE FUNCTION public.guard_voyage_cancelled_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_voyage_id bigint;
BEGIN
  v_voyage_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.voyage_id ELSE NEW.voyage_id END;
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_voyage_row_cancelled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.status = 'cancelled'
     AND current_setting('vela.allow_voyage_cancel', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Use cancel_voyage para cancelar a viagem e registrar o motivo na mesma transação.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'cancelled' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_voyage_row_cancelled ON public.voyages;
CREATE TRIGGER trg_guard_voyage_row_cancelled BEFORE UPDATE ON public.voyages FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_row_cancelled();

-- Qualquer tabela operacional que carregue voyage_id participa do selo. A
-- lista é derivada do catálogo para que uma nova tabela de carga não abra uma
-- brecha silenciosa no próximo módulo.
DO $block$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns AS c
    JOIN information_schema.tables AS tab
      ON tab.table_schema = c.table_schema AND tab.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'voyage_id'
      AND tab.table_type = 'BASE TABLE'
      AND c.table_name <> 'voyages'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_guard_voyage_cancelled_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_mutation()', t, t);
  END LOOP;
END;
$block$;

-- Filhos do ADR guardam apenas report_id; resolvemos a viagem pelo pai para
-- impedir sign-off, ocorrência ou reabertura depois do cancelamento.
CREATE OR REPLACE FUNCTION public.guard_voyage_report_cancelled_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_report_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.report_id ELSE NEW.report_id END;
  v_voyage_id bigint;
BEGIN
  SELECT voyage_id INTO v_voyage_id FROM public.agency_departure_reports WHERE id = v_report_id;
  IF v_voyage_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Viagem % cancelada: ADR somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DO $block$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agency_departure_report_signoffs','agency_departure_report_department_signoffs','agency_departure_report_occurrences'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_voyage_report_cancelled_%I ON public.%I', t, t);
      EXECUTE format('CREATE TRIGGER trg_guard_voyage_report_cancelled_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_report_cancelled_mutation()', t, t);
    END IF;
  END LOOP;
END;
$block$;

-- Schedules persistem como audit_logs legados (voyage_id::port), portanto
-- também precisam ser rejeitados na fronteira transacional.
CREATE OR REPLACE FUNCTION public.guard_voyage_schedule_audit_cancelled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_voyage_id bigint;
BEGIN
  IF NEW.entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule') THEN
    v_voyage_id := NULLIF(split_part(NEW.entity_id, '::', 1), '')::bigint;
    IF v_voyage_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled'
    ) THEN
      RAISE EXCEPTION 'Viagem % cancelada: escala somente leitura.', v_voyage_id USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_voyage_schedule_audit_cancelled ON public.audit_logs;
CREATE TRIGGER trg_guard_voyage_schedule_audit_cancelled
BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_schedule_audit_cancelled();

CREATE OR REPLACE FUNCTION public.cancel_voyage(p_voyage_id bigint, p_reason text, p_changed_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_old_status text; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_old_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Viagem % nao encontrada.', p_voyage_id USING ERRCODE = 'P0002'; END IF;
  IF v_old_status = 'cancelled' THEN RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', false); END IF;
  PERFORM set_config('vela.allow_voyage_cancel', 'on', true);
  UPDATE public.voyages SET status = 'cancelled' WHERE id = p_voyage_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyages', p_voyage_id::text, 'status', v_old_status, 'cancelled', p_changed_by, 'Cancelamento de viagem: ' || v_reason);
  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_voyage(bigint,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_voyage(bigint,text,uuid) TO authenticated;
