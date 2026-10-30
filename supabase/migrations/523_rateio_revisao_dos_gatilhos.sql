-- 523: revisão dos gatilhos do rateio e do SOC (migrations 521 e 522) e do
-- cancelamento da Disputa (520), pela revisão independente da PR
-- luccafwlog/vela#1113.
--
-- 1. Excluir um B/L (cascata nos containers) passa a refazer a divisão da
--    caixa nas Invoices dos outros Clientes: o gatilho de `bl_containers` não
--    acha mais o B/L apagado, então `bls` guarda as caixas antes de apagar e
--    reconcilia depois.
-- 2. O UPDATE em `bl_containers` reconcilia só quando muda número, B/L ou
--    SOC/COC, num gatilho só (antes, dois gatilhos rodavam em todo UPDATE,
--    inclusive na rotina de status).
-- 3. Invoice paga, com desconto ou em disputa cuja diferença já foi avisada
--    (Alerta `demurrage_invoice_dates_changed` aberto ou resolvido) não volta
--    a ser reconciliada pelo gatilho da caixa: o Alerta resolvido não reabre a
--    cada gravação.
-- 4. Falha da reconciliação disparada pelo gatilho não desfaz a gravação do
--    B/L ou do container: fica um aviso no log e a Invoice segue para a
--    reconciliação seguinte.
-- 5. O cancelamento da Disputa com a Invoice (520) restaura o valor anterior
--    de `alerts.foundation_trigger`.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: recriar `_demurrage_reconcile_box_share_keys` como na 522,
-- `_demurrage_cancel_dispute_with_invoice` como na 520, os gatilhos
-- `trg_bl_containers_box_share_upd_new` e `_upd_old` da 521; apagar
-- `trg_bl_containers_box_share_upd`, `_bl_containers_box_share_upd`,
-- `trg_bls_box_share_before_delete`, `trg_bls_box_share_after_delete` e as
-- funções `_bls_box_share_before_delete` e `_bls_box_share_after_delete`.

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
         OR EXISTS (SELECT 1 FROM public.bl_containers AS c WHERE c.id = item.container_id AND c.ownership = 'SOC'))
       -- 523: a diferença da paga ou negociada já avisada não reabre o Alerta.
       AND NOT (
         (di.status = 'paid' OR di.paid_at IS NOT NULL OR COALESCE(di.discount_value, 0) > 0 OR COALESCE(di.dispute_open, false))
         AND EXISTS (
           SELECT 1 FROM public.alert_items AS i JOIN public.alerts AS a ON a.id = i.alert_id
            WHERE i.item_type = 'demurrage_invoice_dates_changed'
              AND a.entity_type = 'demurrage_invoice' AND a.entity_id = di.id::text))
  LOOP
    BEGIN
      PERFORM public._reconcile_demurrage_after_dates(ARRAY[v_bl], v_actor);
    EXCEPTION WHEN OTHERS THEN
      -- 523: a gravação do B/L ou do container não cai por causa da Invoice
      -- de outro Cliente; a próxima reconciliação tenta de novo.
      RAISE WARNING 'Reconciliação da Demurrage do B/L % falhou: %', v_bl, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_previous_claims, ''), true);
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_reconcile_box_share_keys(jsonb) FROM PUBLIC, anon, authenticated;

-- UPDATE: só as linhas em que número, B/L ou SOC/COC mudaram, antes e depois.
CREATE OR REPLACE FUNCTION public._bl_containers_box_share_upd()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_keys jsonb;
BEGIN
  WITH changed AS (
    SELECT o.bl_id, o.container_number FROM old_rows AS o JOIN new_rows AS n ON n.id = o.id
     WHERE o.container_number IS DISTINCT FROM n.container_number OR o.bl_id IS DISTINCT FROM n.bl_id
        OR o.ownership IS DISTINCT FROM n.ownership
    UNION ALL
    SELECT n.bl_id, n.container_number FROM old_rows AS o JOIN new_rows AS n ON n.id = o.id
     WHERE o.container_number IS DISTINCT FROM n.container_number OR o.bl_id IS DISTINCT FROM n.bl_id
        OR o.ownership IS DISTINCT FROM n.ownership
  )
  SELECT jsonb_agg(DISTINCT jsonb_build_object('voyage_id', b.voyage_id, 'container_key', upper(btrim(changed.container_number))))
    INTO v_keys
    FROM changed JOIN public.bls AS b ON b.id = changed.bl_id
   WHERE b.voyage_id IS NOT NULL AND NULLIF(btrim(changed.container_number), '') IS NOT NULL;
  IF v_keys IS NOT NULL THEN
    PERFORM public._demurrage_reconcile_box_share_keys(v_keys);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._bl_containers_box_share_upd() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bl_containers_box_share_upd_new ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_containers_box_share_upd_old ON public.bl_containers;
DROP TRIGGER IF EXISTS trg_bl_containers_box_share_upd ON public.bl_containers;
CREATE TRIGGER trg_bl_containers_box_share_upd
  AFTER UPDATE ON public.bl_containers REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._bl_containers_box_share_upd();

-- B/L excluído: as caixas dele (Viagem, número) antes da cascata, reconciliadas
-- depois da exclusão.
CREATE OR REPLACE FUNCTION public._bls_box_share_before_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_keys jsonb;
BEGIN
  IF OLD.voyage_id IS NULL THEN RETURN OLD; END IF;
  SELECT jsonb_agg(DISTINCT jsonb_build_object('voyage_id', OLD.voyage_id, 'container_key', upper(btrim(c.container_number))))
    INTO v_keys
    FROM public.bl_containers AS c
   WHERE c.bl_id = OLD.id AND NULLIF(btrim(c.container_number), '') IS NOT NULL;
  IF v_keys IS NOT NULL THEN
    PERFORM set_config('vela.box_share_deleted',
      (COALESCE(NULLIF(current_setting('vela.box_share_deleted', true), ''), '[]')::jsonb || v_keys)::text, true);
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public._bls_box_share_before_delete() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bls_box_share_after_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_keys jsonb := NULLIF(NULLIF(current_setting('vela.box_share_deleted', true), ''), '[]')::jsonb;
BEGIN
  PERFORM set_config('vela.box_share_deleted', '', true);
  IF v_keys IS NOT NULL THEN
    PERFORM public._demurrage_reconcile_box_share_keys(v_keys);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._bls_box_share_after_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bls_box_share_before_delete ON public.bls;
DROP TRIGGER IF EXISTS trg_bls_box_share_after_delete ON public.bls;
CREATE TRIGGER trg_bls_box_share_before_delete
  BEFORE DELETE ON public.bls FOR EACH ROW EXECUTE FUNCTION public._bls_box_share_before_delete();
CREATE TRIGGER trg_bls_box_share_after_delete
  AFTER DELETE ON public.bls FOR EACH STATEMENT EXECUTE FUNCTION public._bls_box_share_after_delete();

-- 520 com o valor anterior de `alerts.foundation_trigger` restaurado.
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
