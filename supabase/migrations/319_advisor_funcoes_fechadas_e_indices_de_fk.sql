-- 319: achados do advisor do Supabase de 19/10/2026 (projeto fgmkhbzhaeebrsizwccx).
--
-- Problema:
--   1. Onze funções SECURITY DEFINER executáveis por `anon` via
--      /rest/v1/rpc/<nome>:
--      - `portal_ship_schedule()`, exceção pré-autenticação da ADR 0047. O
--        Portal só a chama com sessão: `usePortalScheduleVoyages` fica
--        desligado sem login, e a rota `/portal` fica atrás de
--        `PortalProtectedRoute`; a inspeção interna chama com a sessão
--        interna, e `/chegadas-saidas` passa a chamar com ela na mesma
--        mudança (antes ia pelo cliente do Portal, como `anon`). Nenhuma
--        Edge Function a chama.
--      - dez funções de trigger com `EXECUTE` para PUBLIC em produção. É
--        resíduo da cadeia arquivada: a varredura da migration `003` nunca
--        rodou em produção (ADR 0062, o histórico remoto já tinha `003`), e o
--        replay local já as cria fechadas.
--   2. 23 funções sem `search_path` fixo (lint 0011). Os corpos só usam
--      `pg_catalog` ou nomes já qualificados (`public._demurrage_roe_markup()`,
--      `public.agency_report_alert_entity_prefix(...)`), então basta fixar o
--      `search_path` vazio; nenhum corpo muda.
--   3. 131 chaves estrangeiras sem índice (lint 0001). Este arquivo cobre só
--      as 41 das tabelas de B/L (`bls`, `bl_*`), faturas (`invoices`,
--      `invoice_*`) e Demurrage (`demurrage_*`); as demais ficam listadas na
--      PR para decisão.
--
-- Mudança:
--   1. Revoga EXECUTE de PUBLIC e `anon` em `portal_ship_schedule()` (fica
--      `authenticated` e `service_role`) e de PUBLIC, `anon` e
--      `authenticated` nas dez funções de trigger. Reafirma o default fechado
--      de `postgres` (global e em `public`) e falha o deploy se sobrar função
--      do projeto executável por `anon` ou trigger executável por cliente
--      (ADR 0090).
--   2. `ALTER FUNCTION ... SET search_path = ''` em 19 das 23 funções. As
--      outras quatro ficam como estão por desempenho (decisão do responsável
--      em 19/10/2026, PR 975): ver o bloco 2 abaixo.
--   3. `CREATE INDEX IF NOT EXISTS` nas 41 FKs. As tabelas têm de 0 a 3.217
--      linhas; o bloqueio de escrita durante a criação é desprezível.
--
-- Não reescreve nem apaga linhas.
-- Rollback: `GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO anon`
-- (reabre a vitrine; exige revisar a ADR 0090), `ALTER FUNCTION ... RESET
-- search_path` nas 19 e `DROP INDEX` dos índices `idx_*` criados aqui. Não há
-- motivo para devolver EXECUTE a PUBLIC nas funções de trigger: elas rodam
-- pelo trigger com o privilégio do dono, nunca por chamada direta.


-- ===========================================================================
-- 1. Funções SECURITY DEFINER fora do alcance de anon
-- ===========================================================================

REVOKE EXECUTE ON FUNCTION public.portal_ship_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_portal_invoice_bl_gate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_portal_invoice_gate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_invoice_exception_on_invoice_bl() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_agency_report_alerts_on_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_agency_report_alerts_on_report_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.suppress_normal_portal_alert_events() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_reconcile_bl_review_alerts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_reconcile_bl_review_on_portal_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_reconcile_granite_bl_review_alerts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_depot_terminal_port() FROM PUBLIC, anon, authenticated;

-- Função nova nasce fechada (já vale em produção desde a cadeia arquivada e
-- nas migrations 001 e 006; reafirmado aqui porque esta migration passa a
-- depender disso). O default global é o que tira PUBLIC: o de schema só
-- acrescenta privilégios.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Falha fechado: se outra função do projeto ainda estiver aberta, o deploy
-- para aqui em vez de deixar o advisor descobrir depois. Funções de extensão
-- (pg_trgm, btree_gist em `public`) não são do projeto e ficam fora.
DO $fechadas$
DECLARE
  v_anon text;
  v_trigger text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1)
  INTO v_anon
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'ce_unlock_private', 'ops')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1)
  INTO v_trigger
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'ce_unlock_private', 'ops')
    AND p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype)
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
    )
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_anon IS NOT NULL THEN
    RAISE EXCEPTION 'Funções executáveis por anon: %', v_anon;
  END IF;
  IF v_trigger IS NOT NULL THEN
    RAISE EXCEPTION 'Funções de trigger executáveis por authenticated: %', v_trigger;
  END IF;
END;
$fechadas$;


-- ===========================================================================
-- 2. search_path fixo (vazio) nas funções sem SET
-- ===========================================================================
-- Corpos inalterados: só usam pg_catalog (sempre pesquisado) ou nomes com
-- schema. ALTER FUNCTION preserva corpo, dono e ACL.
--
-- ponytail: quatro funções `LANGUAGE sql` ficam SEM `SET search_path`, de
-- propósito, porque rodam linha a linha em volume e função SQL com `SET` deixa
-- de ser expandida inline pelo planejador. Medido no Postgres 16 local, 200
-- mil linhas, sem `SET` -> com `SET`:
--   - bl_cargo_mode_matches_filter (filtro de modalidade das listas de B/L e
--     containers): ~90 ms -> ~990 ms;
--   - normalize_port_code (portos nas importações e conferências de POD, 27
--     funções): ~340 ms -> ~2.850 ms;
--   - bl_operation_front_modalidade (modalidade por B/L nos comunicados
--     automáticos e na Atracação): ~110 ms -> ~570 ms;
--   - _import_effect_priority (ordem da fila de efeitos de importação):
--     ~40 ms -> ~690 ms.
-- O risco que fica é pequeno: nenhuma é SECURITY DEFINER e o corpo só chama
-- pg_catalog, que o PostgreSQL pesquisa antes do search_path do chamador. O
-- advisor continua listando as quatro (lint 0011). A suíte local-pg
-- advisorFuncoesFechadas as aceita só enquanto continuarem SQL sem DEFINER;
-- se uma delas passar a chamar outra função do projeto, qualifique o nome
-- (`public.`) ou dê a ela o `SET`.

ALTER FUNCTION ce_unlock_private.sla_deadline(timestamp with time zone) SET search_path = '';
ALTER FUNCTION ce_unlock_private.today() SET search_path = '';
ALTER FUNCTION public._demurrage_ptax_from_roe(numeric) SET search_path = '';
ALTER FUNCTION public._demurrage_roe_from_ptax(numeric) SET search_path = '';
ALTER FUNCTION public._demurrage_roe_markup() SET search_path = '';
ALTER FUNCTION public._demurrage_spread_version() SET search_path = '';
ALTER FUNCTION public.agency_report_alert_entity_id(bigint, text, text, text) SET search_path = '';
ALTER FUNCTION public.agency_report_alert_entity_key(bigint, text, text) SET search_path = '';
ALTER FUNCTION public.agency_report_alert_entity_prefix(bigint, text, text) SET search_path = '';
ALTER FUNCTION public.agency_report_deadline_date(date) SET search_path = '';
ALTER FUNCTION public.agency_report_department_label(text) SET search_path = '';
ALTER FUNCTION public.agency_report_section_label(text) SET search_path = '';
ALTER FUNCTION public.agency_report_section_owner(text) SET search_path = '';
ALTER FUNCTION public.customer_rate_overrides_validate_range() SET search_path = '';
ALTER FUNCTION public.demurrage_dispute_messages_immutable() SET search_path = '';
ALTER FUNCTION public.extract_ncm_codes(text) SET search_path = '';
ALTER FUNCTION public.normalize_ncm_codes(jsonb) SET search_path = '';
ALTER FUNCTION public.prevent_import_effect_attempt_mutation() SET search_path = '';
ALTER FUNCTION public.trg_manifestos_mercante_updated_at() SET search_path = '';


-- ===========================================================================
-- 3. Índices das FKs de B/L, faturas e Demurrage
-- ===========================================================================
-- Sem índice, apagar ou trocar a chave da linha referenciada (B/L, fatura,
-- usuário, lote de importação) varre a tabela filha inteira, e o JOIN pela FK
-- também. Nome `idx_<tabela>_<coluna>`, como os índices já existentes.

CREATE INDEX IF NOT EXISTS idx_bl_transshipments_created_by ON public.bl_transshipments (created_by);
CREATE INDEX IF NOT EXISTS idx_bls_batch_id ON public.bls (batch_id);
CREATE INDEX IF NOT EXISTS idx_bls_cancelled_by ON public.bls (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_bls_last_billing_run_id ON public.bls (last_billing_run_id);
CREATE INDEX IF NOT EXISTS idx_bls_pod_port_id ON public.bls (pod_port_id);
CREATE INDEX IF NOT EXISTS idx_demurrage_dispute_attachments_customer_id ON public.demurrage_dispute_attachments (customer_id);
CREATE INDEX IF NOT EXISTS idx_demurrage_dispute_attachments_dispute_id ON public.demurrage_dispute_attachments (dispute_id);
CREATE INDEX IF NOT EXISTS idx_demurrage_dispute_attachments_uploaded_by ON public.demurrage_dispute_attachments (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_demurrage_dispute_messages_author_id ON public.demurrage_dispute_messages (author_id);
CREATE INDEX IF NOT EXISTS idx_demurrage_invoices_bl_id ON public.demurrage_invoices (bl_id);
CREATE INDEX IF NOT EXISTS idx_demurrage_mutation_requests_invoice_id ON public.demurrage_mutation_requests (invoice_id);
CREATE INDEX IF NOT EXISTS idx_demurrage_refunds_invoice_id ON public.demurrage_refunds (invoice_id);
CREATE INDEX IF NOT EXISTS idx_demurrage_refunds_registered_by ON public.demurrage_refunds (registered_by);
CREATE INDEX IF NOT EXISTS idx_demurrage_refunds_settled_by ON public.demurrage_refunds (settled_by);
CREATE INDEX IF NOT EXISTS idx_invoice_basis_pending_changes_cod_adjustment_id ON public.invoice_basis_pending_changes (cod_adjustment_id);
CREATE INDEX IF NOT EXISTS idx_invoice_corrections_created_by ON public.invoice_corrections (created_by);
CREATE INDEX IF NOT EXISTS idx_invoice_corrections_invoice_id ON public.invoice_corrections (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_corrections_receivable_id ON public.invoice_corrections (receivable_id);
CREATE INDEX IF NOT EXISTS idx_invoice_customer_changes_bl_id ON public.invoice_customer_changes (bl_id);
CREATE INDEX IF NOT EXISTS idx_invoice_customer_changes_created_by ON public.invoice_customer_changes (created_by);
CREATE INDEX IF NOT EXISTS idx_invoice_customer_changes_new_invoice_id ON public.invoice_customer_changes (new_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_customer_changes_original_customer_id ON public.invoice_customer_changes (original_customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_customer_changes_target_customer_id ON public.invoice_customer_changes (target_customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_billing_run_id ON public.invoice_items (billing_run_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_charge_calculation_id ON public.invoice_items (charge_calculation_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_charge_item_id ON public.invoice_items (charge_item_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_charge_table_id ON public.invoice_items (charge_table_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_manifest_id ON public.invoice_items (manifest_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_pricing_rule_version_id ON public.invoice_items (pricing_rule_version_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lifecycle_events_actor ON public.invoice_lifecycle_events (actor);
CREATE INDEX IF NOT EXISTS idx_invoice_lifecycle_events_receivable_id ON public.invoice_lifecycle_events (receivable_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lifecycle_events_related_invoice_id ON public.invoice_lifecycle_events (related_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_receivable_links_bl_id ON public.invoice_receivable_links (bl_id);
CREATE INDEX IF NOT EXISTS idx_invoice_refunds_payment_id ON public.invoice_refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_invoice_refunds_registered_by ON public.invoice_refunds (registered_by);
CREATE INDEX IF NOT EXISTS idx_invoice_refunds_settled_by ON public.invoice_refunds (settled_by);
CREATE INDEX IF NOT EXISTS idx_invoices_bl_id ON public.invoices (bl_id);
CREATE INDEX IF NOT EXISTS idx_invoices_cancelled_by ON public.invoices (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_invoices_covered_by_invoice_id ON public.invoices (covered_by_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issued_by ON public.invoices (issued_by);
CREATE INDEX IF NOT EXISTS idx_invoices_replaced_by_invoice_id ON public.invoices (replaced_by_invoice_id);
