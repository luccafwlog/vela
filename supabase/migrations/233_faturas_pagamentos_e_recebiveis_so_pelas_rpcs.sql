-- 233: faturas, pagamentos e recebíveis só pelas RPCs (item P15 do plano de
-- correções; ADR 0077; ADR 0085, falha 5).
--
-- Problema (Postgres local, 2026-10-14): as policies `is_admin()` de escrita
-- da migration 002 deixavam o Administrativo, pela API, lançar pagamento sem
-- referência bancária, dar a fatura como paga, cancelar sem motivo, mudar o
-- valor de item de fatura emitida, quitar o recebível, reescrever a numeração
-- (`invoice_counters`) e apagar o histórico da fatura e os vínculos com B/Ls.
--
-- Mudança: `authenticated` (e `anon`, que em produção pode ter o privilégio
-- padrão da plataforma) perde INSERT, UPDATE e DELETE nas onze tabelas, e as
-- policies de escrita saem (lista conferida por `pg_policies` no Postgres
-- local montado pelas migrations). O navegador só lê essas tabelas
-- (`src/services/`); a escrita fica com as RPCs `SECURITY DEFINER` de
-- emissão, baixa, cancelamento e correção. As funções `SECURITY INVOKER` que
-- escrevem nelas são gatilhos dessas mesmas tabelas (rodam como o dono da
-- RPC que fez a escrita), `add_manual_invoice_charge` (sem EXECUTE para
-- `authenticated`) e `register_invoice_payment`, que passou a `SECURITY
-- DEFINER` na migration 232. A leitura (`*_select_*`) não muda; a policy
-- `invoice_counters_admin_all` (ALL) sai inteira: o navegador não lê a
-- numeração.
--
-- Só muda privilégios e policies; não reescreve nem apaga linhas.
-- Rollback: GRANT das escritas a `authenticated` e recriar as policies
-- `*_insert_admin`, `*_update_admin`, `*_delete_admin` e
-- `invoice_counters_admin_all` da migration 002.

REVOKE INSERT, UPDATE, DELETE ON
  public.invoices,
  public.invoice_items,
  public.payments,
  public.ledger_settlements,
  public.bl_receivables,
  public.invoice_counters,
  public.invoice_bls,
  public.invoice_granite_bls,
  public.invoice_receivable_links,
  public.invoice_lifecycle_events,
  public.billing_batches
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS invoices_insert_admin ON public.invoices;
DROP POLICY IF EXISTS invoices_update_admin ON public.invoices;
DROP POLICY IF EXISTS invoice_items_insert_admin ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_update_admin ON public.invoice_items;
DROP POLICY IF EXISTS payments_insert_admin ON public.payments;
DROP POLICY IF EXISTS payments_update_admin ON public.payments;
DROP POLICY IF EXISTS ledger_settlements_insert_admin ON public.ledger_settlements;
DROP POLICY IF EXISTS ledger_settlements_update_admin ON public.ledger_settlements;
DROP POLICY IF EXISTS bl_receivables_insert_admin ON public.bl_receivables;
DROP POLICY IF EXISTS bl_receivables_update_admin ON public.bl_receivables;
DROP POLICY IF EXISTS invoice_counters_admin_all ON public.invoice_counters;
DROP POLICY IF EXISTS invoice_bls_insert_admin ON public.invoice_bls;
DROP POLICY IF EXISTS invoice_bls_update_admin ON public.invoice_bls;
DROP POLICY IF EXISTS invoice_bls_delete_admin ON public.invoice_bls;
DROP POLICY IF EXISTS invoice_granite_bls_insert_admin ON public.invoice_granite_bls;
DROP POLICY IF EXISTS invoice_granite_bls_update_admin ON public.invoice_granite_bls;
DROP POLICY IF EXISTS invoice_granite_bls_delete_admin ON public.invoice_granite_bls;
DROP POLICY IF EXISTS invoice_receivable_links_insert_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_receivable_links_update_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_receivable_links_delete_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_lifecycle_events_insert_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS invoice_lifecycle_events_update_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS invoice_lifecycle_events_delete_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS billing_batches_insert_admin ON public.billing_batches;
DROP POLICY IF EXISTS billing_batches_update_admin ON public.billing_batches;
DROP POLICY IF EXISTS billing_batches_delete_admin ON public.billing_batches;
