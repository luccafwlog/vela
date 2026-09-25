-- Migration 086: documento fiscal e trilha de auditoria não se apagam pela API;
-- exclusão de viagem deixa rastro (ADR 0071, itens 13 e 14; plano
-- docs/plans/2026-09-24-politica-de-exclusao.md, Fase 1; achados A3, A4 e A5
-- da revisão de 2026-09-24).
--
-- - invoices, invoice_items, payments, bl_receivables e ledger_settlements
--   perdem o DELETE de authenticated e a policy de DELETE. Fatura se cancela;
--   baixa se cancela. Mesmo padrão de demurrage_invoices, que já não tem
--   DELETE para authenticated. Os dois caminhos controlados que apagam linhas
--   continuam: reverse_invoice_payment (Cancelar baixa) já é SECURITY
--   DEFINER; delete_manual_invoice_charge (Excluir cobrança manual) passa a
--   ser, porque rodava com o DELETE de quem chama. Ela já confere
--   Administrativo ativo, item manual e fatura em aberto sem pagamento, e já
--   fixa search_path; o grant continua só para authenticated.
-- - audit_logs perde UPDATE e DELETE de authenticated e as policies
--   audit_logs_update_admin e audit_logs_delete_admin. Nenhuma parte do
--   sistema altera ou apaga auditoria (verificado em 2026-09-24); inserções
--   continuam. A rotina de retenção da ADR 0074 rodará como dono.
-- - TRUNCATE sai de anon, authenticated e service_role nessas seis tabelas.
--   O PostgREST não expõe TRUNCATE; a revogação fecha o privilégio padrão.
-- - voyages ganha o trigger audit_row_changes, como as demais tabelas
--   operacionais: a exclusão de viagem passa a gravar a linha em audit_logs.
--
-- Não reescreve nem apaga linhas existentes.

REVOKE DELETE ON TABLE
  public.invoices,
  public.invoice_items,
  public.payments,
  public.bl_receivables,
  public.ledger_settlements
FROM authenticated;

DROP POLICY IF EXISTS invoices_delete_admin ON public.invoices;
DROP POLICY IF EXISTS invoice_items_delete_admin ON public.invoice_items;
DROP POLICY IF EXISTS payments_delete_admin ON public.payments;
DROP POLICY IF EXISTS bl_receivables_delete_admin ON public.bl_receivables;
DROP POLICY IF EXISTS ledger_settlements_delete_admin ON public.ledger_settlements;

REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM authenticated;

DROP POLICY IF EXISTS audit_logs_update_admin ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete_admin ON public.audit_logs;

REVOKE TRUNCATE ON TABLE
  public.invoices,
  public.invoice_items,
  public.payments,
  public.bl_receivables,
  public.ledger_settlements,
  public.audit_logs
FROM anon, authenticated, service_role;

ALTER FUNCTION public.delete_manual_invoice_charge(bigint, uuid) SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_voyages ON public.voyages;
CREATE TRIGGER audit_voyages
  AFTER INSERT OR DELETE OR UPDATE ON public.voyages
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('id');
