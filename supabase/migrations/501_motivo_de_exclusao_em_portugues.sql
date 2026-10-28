-- 501: a exclusão (`delete_records`) recusada por chave estrangeira diz em
-- português a que o registro está vinculado. Conferência do Manual do Operador
-- (2026-10-28): excluir um B/L com pedido de Desbloqueio de CE mostrava
-- "vinculado a ce_unlock_request_bls", porque `delete_record_block_reason`
-- (migration 087) não traduzia as tabelas do Desbloqueio de CE nem a troca de
-- Cliente da fatura; o Comunicado ao Cliente já saía "vinculado a comunicado
-- ao cliente".
--
-- Acrescenta os nomes de todas as tabelas que hoje seguram, por chave
-- estrangeira sem cascata, um B/L, container, Cliente ou Viagem que
-- `delete_records` exclui: Desbloqueio de CE (pedido, B/Ls do pedido, BL de
-- Entrega, conciliação com a ZPT, documentos, e-mails, condição VIP), troca de
-- Cliente da fatura, Modo Inspeção do Portal e lote de importação. Ficam de
-- fora `vehicles`, `customer_contacts` e `customer_rate_overrides`, que
-- `delete_records` apaga antes do pai. O teste
-- `src/integration/deleteRecords.local-pg.test.ts` falha quando uma tabela nova
-- passar a segurar esses registros sem nome em português.
--
-- Só redefine função (mesma assinatura, `CREATE OR REPLACE` preserva dono e
-- grants); não reescreve nem apaga linhas.
-- Rollback: reaplicar a função como estava na 087.

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
