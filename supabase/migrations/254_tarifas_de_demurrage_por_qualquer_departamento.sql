-- Item 27 (P9) do plano 2026-10-14: qualquer Departamento ativo cria e edita
-- tarifa de Demurrage e acordo de Cliente (ADR 0085, D6). Desativar e reativar
-- seguem só com o Administrativo pelo gatilho guard_tariff_active_change
-- (migration 091); excluir segue por delete_catalog_row, sem DELETE direto.
-- Só troca policies; não reescreve nem apaga linhas.

DROP POLICY IF EXISTS demurrage_rates_admin_insert_global ON public.demurrage_rates;
DROP POLICY IF EXISTS demurrage_rates_admin_update_global ON public.demurrage_rates;
CREATE POLICY demurrage_rates_insert_active_global ON public.demurrage_rates
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user());
CREATE POLICY demurrage_rates_update_active_global ON public.demurrage_rates
  FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS admin_gerencia_customer_demurrage_agreements ON public.customer_demurrage_agreements;
CREATE POLICY customer_demurrage_agreements_insert_active_global ON public.customer_demurrage_agreements
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user());
CREATE POLICY customer_demurrage_agreements_update_active_global ON public.customer_demurrage_agreements
  FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());
