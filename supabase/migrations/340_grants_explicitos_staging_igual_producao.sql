-- Migration 340: GRANTs explícitos das tabelas do schema public, para a branch
-- staging e qualquer replay limpo (scripts/setup-local-pg.sh --reset)
-- chegarem ao estado funcional de produção, com menor privilégio.
--
-- Incidente de 2026-10-20 (Sentry VELA-21, VELA-22 e VELA-23, ambiente
-- staging): "permission denied for table customer_portal_accounts" na tela
-- Comunicações com Clientes e "agency_departure_report_signoffs" no Relatório
-- Próprio de Agência. A branch staging (criada em 2026-10-19) nasceu só das
-- migrations; produção tem privilégios que vieram dos default privileges do
-- projeto, fora da cadeia. Comparação de has_table_privilege feita em
-- 2026-10-20, somente leitura, nos dois ambientes; o replay local tem os
-- mesmos SELECT/INSERT/UPDATE/DELETE da staging.
--
-- 1. service_role: SELECT/INSERT/UPDATE/DELETE como em produção nas 96
--    tabelas que só os tinham lá. É a chave server-only (BYPASSRLS) das Edge
--    Functions e dos crons; além das consultas diretas das Edges, gatilhos e
--    funções SECURITY INVOKER que elas acionam rodam com estes privilégios, e
--    sem eles a staging recusava, por exemplo, SELECT em bls e itau_pix_charges.
--    As tabelas que produção mantém sem DELETE continuam sem ele: invoices,
--    invoice_items, payments, ledger_settlements e bl_receivables
--    (INSERT/SELECT/UPDATE) e audit_logs (INSERT/SELECT).
-- 2. authenticated: só o SELECT que as telas usam e as migrations não davam,
--    sempre atrás da RLS que já existe:
--    - agency_departure_report_signoffs, _department_signoffs e _occurrences:
--      embeds do Relatório Próprio de Agência (src/services/agencyDepartureReport.ts);
--      policy *_select (is_active_read_user);
--    - customer_portal_accounts: lida pela policy de SELECT de
--      customer_communication_box_kinds e customer_communication_boxes (a
--      permissão da tabela citada na policy é conferida mesmo quando o
--      primeiro ramo, is_active_read_user, já basta); policy cpa_admin_select.
--    O resto que produção dá a authenticated e a staging não (escrita nas
--    tabelas de ADR, Comunicados, câmbio, Correção de fatura etc.; SELECT em
--    billing_runs, portal_* e afins) não tem uso pela Data API: o app lê ou
--    grava essas tabelas por RPC SECURITY DEFINER ou não as usa. Fica de fora.
-- 3. anon: sai SELECT/INSERT/UPDATE/DELETE de financial_payment_attempts,
--    demurrage_refunds, invoice_corrections e invoice_customer_changes, que
--    produção dá (staging não). As quatro têm RLS sem policy para anon, e
--    nenhum app nem Edge as usa como anon: o privilégio não abria linha
--    alguma, então revogar não muda comportamento.
-- 4. anon e authenticated: sai TRUNCATE, TRIGGER e REFERENCES de todas as
--    tabelas do public (a migration 312 tirou só das de e-mail; produção e
--    staging ainda os têm em ~90 tabelas). TRUNCATE não passa pela RLS nem
--    pelos gatilhos de DELETE: em produção, anon (chave pública) podia esvaziar
--    as quatro tabelas do item 3. Nenhuma tela nem Edge usa esses privilégios
--    (a Data API não expõe TRUNCATE, TRIGGER nem REFERENCES). O default
--    privilege do papel que aplica as migrations também deixa de concedê-los
--    a tabelas novas.
--
-- Tabela ausente no ambiente é ignorada (to_regclass), como na 312. Idempotente.
-- Não altera nem apaga linhas. A suíte local-pg grantsDoReplay confere o
-- resultado depois do replay. Rollback: GRANT/REVOKE inversos.

DO $grants_340$
DECLARE
  v_table text;
BEGIN
  -- 1 -----------------------------------------------------------------------
  FOREACH v_table IN ARRAY ARRAY[
    'agency_departure_report_department_signoffs', 'agency_departure_report_occurrences',
    'agency_departure_report_signoffs', 'agency_report_pending_baselines',
    'alert_item_dismissals', 'alert_item_events', 'alert_items', 'alert_notification_failures',
    'alert_type_catalog', 'alerts', 'billing_run_logs', 'billing_runs',
    'bl_breakbulk_items', 'bl_containers', 'bl_freight_lines', 'bls', 'business_holidays',
    'carriers', 'charge_calculations', 'charge_table_items', 'charge_tables', 'cod_adjustments',
    'customer_communication_box_kinds', 'customer_communication_boxes', 'customer_contact_box_links',
    'customer_contact_change_events', 'customer_contacts', 'customer_portal_accounts',
    'customer_rate_overrides', 'customer_reconciliation_queue', 'customers',
    'demurrage_calculation_snapshots', 'demurrage_dispute_attachments', 'demurrage_dispute_messages',
    'demurrage_disputes', 'demurrage_doc_counters', 'demurrage_refunds', 'depot_services', 'depots',
    'ended_vessels', 'exchange_rate_reference', 'financial_payment_attempts',
    'granite_bl_charges', 'granite_bls', 'granite_manifests', 'import_batches', 'import_errors',
    'internal_notifications', 'invoice_basis_pending_changes', 'invoice_bls', 'invoice_corrections',
    'invoice_counters', 'invoice_customer_changes', 'invoice_document_snapshots', 'invoice_granite_bls',
    'invoice_lifecycle_events', 'invoice_receivable_links', 'invoice_refunds',
    'itau_pix_charges', 'itau_pix_receipts', 'ledger_payment_requests', 'local_pix_charge_versions',
    'pix_reconciliation_exceptions', 'portal_email_attempts', 'portal_email_event_attempts',
    'portal_email_events', 'portal_inspection_events', 'portal_invites', 'portal_login_attempts',
    'portal_login_resolution_attempts', 'portal_notifications', 'portal_rate_limits', 'ports',
    'pricing_rule_versions', 'provision_rate_limit_log', 'user_profiles',
    'vazios_bookings', 'vazios_export_service_lines', 'vazios_importacao_containers',
    'vazios_importacao_manifests', 'vazios_manifests', 'vehicles', 'vessel_schedules', 'vessels',
    'voyage_documental_pending', 'voyage_documental_state', 'voyage_escala_operation_fronts',
    'voyage_escala_revision_state', 'voyage_escala_terminal_state', 'voyages'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', v_table);
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['bl_receivables', 'invoice_items', 'invoices', 'ledger_settlements', 'payments']
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', v_table);
    END IF;
  END LOOP;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    GRANT SELECT, INSERT ON TABLE public.audit_logs TO service_role;
  END IF;

  -- 2 -----------------------------------------------------------------------
  FOREACH v_table IN ARRAY ARRAY[
    'agency_departure_report_signoffs',
    'agency_departure_report_department_signoffs',
    'agency_departure_report_occurrences',
    'customer_portal_accounts'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    END IF;
  END LOOP;

  -- 3 -----------------------------------------------------------------------
  FOREACH v_table IN ARRAY ARRAY[
    'financial_payment_attempts', 'demurrage_refunds', 'invoice_corrections', 'invoice_customer_changes'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon', v_table);
    END IF;
  END LOOP;

  -- 4 -----------------------------------------------------------------------
  FOR v_table IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated', v_table);
  END LOOP;
END;
$grants_340$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
