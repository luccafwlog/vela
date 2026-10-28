-- 481: a Invoice de Demurrage só cita como substituída a cancelada da mesma
-- Viagem (corrige a migration `480`).
--
-- Problema: a `480` procurava a cancelada pelo Cliente e pelo número da
-- caixa. Uma Invoice cancelada sem reemissão (sem sobreestadia) passava a
-- ser "substituída" pela cobrança da mesma caixa em outra Viagem do Cliente.
--
-- Mudança: a busca exige que as duas Invoices sejam de B/Ls da mesma Viagem,
-- como a identidade da cobrança por caixa (migration `214`).
--
-- Só redefine função; não reescreve nem apaga linhas.
--
-- Rollback: reaplicar `_demurrage_invoice_cites_replaced` da `480`.

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
