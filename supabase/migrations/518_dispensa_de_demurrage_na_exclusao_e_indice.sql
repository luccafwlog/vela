-- 518: a dispensa da cobrança de Demurrage (`demurrage_box_waivers`,
-- migration 517) ganha o índice da chave do Cliente e o nome em português
-- na recusa de exclusão. Ambos faltaram na 517: o Cliente com dispensa não se
-- exclui (FK sem cascata), e `delete_records` dizia "vinculado a
-- demurrage_box_waivers"; a chave sem índice deixava a varredura do Cliente
-- na tabela inteira. Os testes `deleteRecords.local-pg.test.ts` (505) e
-- `advisorFuncoesFechadas.local-pg.test.ts` (320) cobrem os dois.
--
-- Cria um índice e redefine função (mesma assinatura, `CREATE OR REPLACE`
-- preserva dono e grants); não reescreve nem apaga linhas.
-- Rollback: `DROP INDEX public.demurrage_box_waivers_customer_idx` e reaplicar
-- `delete_record_block_reason` como estava na 505.

CREATE INDEX IF NOT EXISTS demurrage_box_waivers_customer_idx
  ON public.demurrage_box_waivers (customer_id);

CREATE OR REPLACE FUNCTION public.delete_record_block_reason(p_state text, p_message text, p_constraint text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_state = '23503' THEN
      'vinculado a ' || COALESCE((
        SELECT CASE c.conrelid::regclass::text
          WHEN 'invoices' THEN 'fatura'
          WHEN 'invoice_items' THEN 'item de fatura'
          WHEN 'invoice_bls' THEN 'fatura consolidada'
          WHEN 'invoice_receivable_links' THEN 'recebível de fatura'
          WHEN 'invoice_customer_changes' THEN 'troca de Cliente da fatura'
          WHEN 'bl_receivables' THEN 'recebível'
          WHEN 'billing_batches' THEN 'lote de faturamento'
          WHEN 'demurrage_invoices' THEN 'fatura de Demurrage'
          WHEN 'demurrage_invoice_items' THEN 'item de fatura de Demurrage'
          WHEN 'demurrage_disputes' THEN 'disputa de Demurrage'
          WHEN 'demurrage_dispute_attachments' THEN 'anexo de disputa de Demurrage'
          WHEN 'demurrage_box_waivers' THEN 'dispensa de cobrança de Demurrage'
          WHEN 'cod_adjustments' THEN 'ajuste de COD'
          WHEN 'customer_communications' THEN 'comunicado ao cliente'
          WHEN 'customer_communication_bls' THEN 'comunicado ao cliente'
          WHEN 'customer_communication_dunning_groups' THEN 'grupo de cobrança'
          WHEN 'customer_communication_dunning_invoices' THEN 'cobrança ao cliente'
          WHEN 'charge_calculations' THEN 'cálculo de taxa'
          WHEN 'ce_unlock_requests' THEN 'pedido de Desbloqueio de CE'
          WHEN 'ce_unlock_request_bls' THEN 'pedido de Desbloqueio de CE'
          WHEN 'ce_unlock_bl_deliveries' THEN 'BL de Entrega do Desbloqueio de CE'
          WHEN 'ce_unlock_zpt_status' THEN 'conciliação com a ZPT do Desbloqueio de CE'
          WHEN 'ce_unlock_documents' THEN 'documento de Desbloqueio de CE'
          WHEN 'ce_unlock_email_outbox' THEN 'e-mail de Desbloqueio de CE'
          WHEN 'ce_unlock_vip_customers' THEN 'condição VIP do Desbloqueio de CE'
          WHEN 'portal_inspection_events' THEN 'registro do Modo Inspeção do Portal'
          WHEN 'import_batches' THEN 'lote de importação'
          WHEN 'bls' THEN 'B/L'
          ELSE c.conrelid::regclass::text
        END
        FROM pg_constraint c
        WHERE c.conname = p_constraint AND c.contype = 'f'
        LIMIT 1
      ), 'outro registro')
    ELSE p_message
  END;
$function$;
