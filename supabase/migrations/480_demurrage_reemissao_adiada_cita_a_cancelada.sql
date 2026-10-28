-- 480: a Invoice de Demurrage reemitida depois do gate cita a cancelada
-- (DEM-D08, complemento da migration `472`).
--
-- Problema: a `472` grava `replaces_invoice_id` só quando a reemissão por
-- datas alteradas sai na hora. Com o gate do Portal fechado ou sem CE, a
-- antiga é cancelada, a emissão volta `blocked` e, ao reabrir, a fila
-- (`_run_import_effect_demurrage`) emite sem a referência: a nova Invoice não
-- diz que substitui a cancelada, no Vela nem no Portal.
--
-- Mudança: ao entrar a primeira caixa numa Invoice sem referência, ela passa
-- a citar a Invoice mais recente do mesmo Cliente cancelada para reemissão
-- automática (o registro de auditoria da `472`/`349`) que cobrava essa caixa
-- e que nenhuma outra Invoice ainda substitui. Vale para os dois caminhos.
--
-- Só cria função e gatilho; não reescreve nem apaga linhas.
--
-- Rollback: DROP TRIGGER trg_demurrage_invoice_cites_replaced ON
-- public.demurrage_invoice_items; DROP FUNCTION
-- public._demurrage_invoice_cites_replaced().

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
         AND upper(btrim(prev_item.container_number)) = upper(btrim(NEW.container_number))
         AND EXISTS (
           SELECT 1 FROM public.audit_logs log
           WHERE log.entity_type = 'demurrage_invoice' AND log.entity_id = prev.id::text
             AND log.field_name = 'status' AND log.new_value = 'cancelled'
             AND log.justification LIKE 'Datas de container alteradas: cancelada para reemissão%')
         AND NOT EXISTS (
           SELECT 1 FROM public.demurrage_invoices other WHERE other.replaces_invoice_id = prev.id)
       ORDER BY prev.updated_at DESC, prev.id DESC
       LIMIT 1)
   WHERE cur.id = NEW.invoice_id AND cur.replaces_invoice_id IS NULL;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_invoice_cites_replaced() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_demurrage_invoice_cites_replaced ON public.demurrage_invoice_items;
CREATE TRIGGER trg_demurrage_invoice_cites_replaced
  AFTER INSERT ON public.demurrage_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public._demurrage_invoice_cites_replaced();
