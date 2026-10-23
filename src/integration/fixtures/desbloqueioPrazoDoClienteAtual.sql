-- Roteiro de reprodução da auditoria de segurança run-3 (verificadores, dados
-- fictícios), usado por portalAntigoDonoDoBl.local-pg.test.ts. A suíte roda
-- este arquivo inteiro numa transação desfeita no fim; não rode solto, porque
-- ele grava com ids fixos.
\pset pager off
\set ON_ERROR_STOP 0
-- v11 independent replay. Dummy fixture (namespace 9911xxxx). Staff admin S, Portal users PA (customer A) and PB (customer B).
-- Every step runs in its own transaction, separated by pg_sleep, so each now() is distinguishable.
SET request.jwt.claim.role = 'service_role';
SET request.jwt.claim.sub = '00000000-0000-0000-0011-000000000001';
INSERT INTO auth.users (id, email) VALUES
 ('00000000-0000-0000-0011-000000000001','v11-admin@example.test'),
 ('00000000-0000-0000-0011-0000000000a1','v11-portal-a@example.test'),
 ('00000000-0000-0000-0011-0000000000b1','v11-portal-b@example.test');
INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
 ('00000000-0000-0000-0011-000000000001','V11 Admin','administrativo',true)
 ON CONFLICT (id) DO UPDATE SET role='administrativo', active=true;
INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (99110001,'99000001100157','V11 Cliente A'),(99110002,'99000001100238','V11 Cliente B');
INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary) VALUES
 (99110001,'Fin A','v11-fin-a@example.test','financeiro',true),(99110002,'Fin B','v11-fin-b@example.test','financeiro',true);
INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at) VALUES
 (99110001,'Fixture v11','00000000-0000-0000-0011-000000000001', now()+interval '1 day'),
 (99110002,'Fixture v11','00000000-0000-0000-0011-000000000001', now()+interval '1 day');
INSERT INTO public.customer_portal_accounts (customer_id, active, auth_user_id, provisioning_decision, account_situation, recovery_email, portal_email, login_cnpj) VALUES
 (99110001,true,'00000000-0000-0000-0011-0000000000a1','aprovado_para_provisionar','ativo','v11-pa@example.test','v11-pa@example.test','99000001100157'),
 (99110002,true,'00000000-0000-0000-0011-0000000000b1','aprovado_para_provisionar','ativo','v11-pb@example.test','v11-pb@example.test','99000001100238')
 ON CONFLICT (customer_id) DO UPDATE SET active=true, auth_user_id=EXCLUDED.auth_user_id, provisioning_decision=EXCLUDED.provisioning_decision, account_situation='ativo';
INSERT INTO public.carriers (id, name) VALUES (99110003,'V11 Carrier');
INSERT INTO public.vessels (id, name, carrier_id) VALUES (99110004,'V11 Vessel',99110003);
INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99110005,99110004,'V11','active');
INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES (99110010,'V11 Tabela','V11POD',CURRENT_DATE-30,true,'container');
INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc) VALUES
 (99110040,99110010,'V11 Taxa container','container',500,500,'container_distinct_voyage','base','any','BRL',true),
 (99110041,99110010,'V11 Drop Off','container',100,100,'container_distinct_voyage','base','any','BRL',false);
INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
 VALUES ('V11-BL-1',99110005,99110001,'V11POD','container','pending','not_calculated','reconciled',NULL);
INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('V11-BL-1','VVCU1100001','22G1');

\echo '== S1: CE recorded by server maintenance issues the individual invoice of A'
BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-000000000001';
DO $$ BEGIN PERFORM public.apply_ce_mercante_update('V11-BL-1','839000000011001','00000000-0000-0000-0011-000000000001'::uuid); END $$;
COMMIT;
SELECT id AS inv_a FROM public.invoices WHERE customer_id=99110001 AND invoice_type='individual' \gset
SELECT 'S1_invoice_A' AS step, id, customer_id, status, total_brl FROM public.invoices WHERE id=:inv_a;

\echo '== S2: staff registers A payment; Portal A drafts and submits a CE-unlock request'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-000000000001';
SELECT 'S2_A_pays' AS step, public.register_ledger_invoice_payment(:inv_a, 600)->>'status' AS result;
COMMIT;
SELECT pg_sleep(1.2);
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000a1';
SELECT (public.portal_ce_unlock_command('draft', '{"bl_ids":["V11-BL-1"],"request_key":"00000000-0000-0000-0011-00000000d0a1"}'::jsonb))->>'id' AS req_a \gset
COMMIT;
-- Termo/procuracao upload rows (the real upload goes through Storage + Edge Function; same fixture style as ceUnlock.local-pg.test.ts).
INSERT INTO public.ce_unlock_documents (customer_id, request_id, type, source, status, storage_path, file_name, size_bytes, hash, uploaded_by) VALUES
 (99110001, :'req_a', 'termo', 'request', 'uploaded', 'v11/termo.pdf', 'termo.pdf', 10, repeat('c',64), '00000000-0000-0000-0011-0000000000a1'),
 (99110001, :'req_a', 'procuracao', 'request', 'uploaded', 'v11/proc.pdf', 'proc.pdf', 10, repeat('d',64), '00000000-0000-0000-0011-0000000000a1');
SELECT version AS req_a_version FROM public.ce_unlock_requests WHERE id = :'req_a' \gset
SELECT pg_sleep(1.2);
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000a1';
SELECT 'S2_A_submit' AS step, (public.portal_ce_unlock_command('submit', jsonb_build_object('request_id', :'req_a', 'expected_version', :req_a_version, 'request_key', '00000000-0000-0000-0011-00000000d0a2')))->>'state' AS state;
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000a1';
SELECT 'S2_A_list_before_move' AS step, i->>'state' AS state, i->'bl_ids' AS bl_ids, i->>'sla_started_at' AS sla_started_at FROM jsonb_array_elements(public.portal_list_ce_unlock_requests('{}',1)->'items') i;
COMMIT;
SELECT max(created_at) AS a_submit_at FROM public.ce_unlock_events WHERE request_id = :'req_a' AND action = 'submit' \gset
SELECT 'S2_A_submit_event' AS step, :'a_submit_at'::timestamptz AS a_submit_at;

SELECT pg_sleep(1.5);
\echo '== S3: internal user changes the B/L customer A -> B (366 column grant); refund to A confirmed; invoice reissued to B'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-000000000001';
UPDATE public.bls SET customer_id = 99110002 WHERE id='V11-BL-1';
COMMIT;
SELECT pg_sleep(1.2);
SELECT id AS refund_a FROM public.invoice_refunds WHERE invoice_id = :inv_a AND status = 'pending' \gset
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-000000000001';
SELECT 'S3_refund_to_A' AS step, public.confirm_invoice_refund(:refund_a, 'V11-REF-A', 'V11 Cliente A', now() - interval '1 minute')->>'status' AS status;
COMMIT;
SELECT id AS inv_b FROM public.invoices WHERE customer_id=99110002 AND invoice_type='individual' AND status='issued' \gset
SELECT 'S3_state_after_move' AS step,
  (SELECT customer_id FROM public.bls WHERE id='V11-BL-1') AS bl_customer,
  (SELECT active FROM public.ce_unlock_request_bls WHERE request_id = :'req_a' AND bl_id='V11-BL-1') AS a_row_active,
  (SELECT state FROM public.ce_unlock_requests WHERE id = :'req_a') AS a_request_state,
  (SELECT count(*) FROM public.ce_unlock_events WHERE request_id = :'req_a' AND action='bl_moved') AS bl_moved_events,
  :inv_b AS inv_b;

SELECT pg_sleep(2.0);
\echo '== S4: staff registers B payment of B invoice'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-000000000001';
SELECT 'S4_B_pays' AS step, public.register_ledger_invoice_payment(:inv_b, 600)->>'status' AS result;
COMMIT;
SELECT 'S4_all_settlements_of_bl' AS step, s.id, s.created_at, s.invoice_id, i.customer_id AS invoice_customer, r.customer_id AS receivable_customer, s.amount_brl
 FROM public.ledger_settlements s JOIN public.bl_receivables r ON r.id = s.receivable_id LEFT JOIN public.invoices i ON i.id = s.invoice_id
 WHERE r.bl_id='V11-BL-1' ORDER BY s.created_at;
SELECT max(s.created_at) AS b_settled_at FROM public.ledger_settlements s WHERE s.invoice_id = :inv_b \gset

\echo '== S5: Portal A (former owner) reads its own Minhas solicitacoes'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000a1';
SELECT 'S5_A_portal_customer' AS step, public.current_portal_customer_id();
CREATE TEMP TABLE v11_a_list ON COMMIT DROP AS SELECT public.portal_list_ce_unlock_requests('{}',1) AS j;
SELECT 'S5_A_list_after_B_pays' AS step, i->>'state' AS state, i->'bl_ids' AS bl_ids, i->>'sla_started_at' AS sla_started_at,
  (i->>'sla_started_at')::timestamptz = :'b_settled_at'::timestamptz AS equals_B_settlement_created_at,
  (i->>'sla_started_at')::timestamptz = :'a_submit_at'::timestamptz AS equals_A_submit
 FROM v11_a_list, jsonb_array_elements(j->'items') i;
SELECT 'S5_A_bls_total' AS step, public.portal_list_ce_unlock_bls('{}',1)->'total' AS total;
SELECT 'S5_A_request_detail_items' AS step, jsonb_array_length(public.portal_get_ce_unlock_request(:'req_a')->'items') AS items;
COMMIT;
\echo '-- S5b: direct read of the settlement table by Portal A (expected: denied or 0 rows)'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000a1';
SELECT 'S5b_A_direct_settlements' AS step, count(*) FROM public.ledger_settlements;
ROLLBACK;

\echo '== S6: Portal B (current owner) CE-unlock B/L list and draft'
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000b1';
SELECT 'S6_B_bl_item' AS step, i->>'bl_id' AS bl, i->>'paid' AS paid, i->>'can_submit' AS can_submit, i->>'request_id' AS request_id, i->>'sla_started_at' AS sla, i->'reasons' AS reasons FROM jsonb_array_elements(public.portal_list_ce_unlock_bls('{}',1)->'items') i;
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000b1';
SELECT 'S6_B_draft' AS step, public.portal_ce_unlock_command('draft', '{"bl_ids":["V11-BL-1"],"request_key":"00000000-0000-0000-0011-00000000d0b1"}'::jsonb)->>'state';
ROLLBACK;

\echo '== S7 (control, documented release in docs/modules/desbloqueio-ce.md): staff cancels the former request; then re-read A and B (rolled back)'
SELECT version AS req_a_v2 FROM public.ce_unlock_requests WHERE id = :'req_a' \gset
BEGIN;
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-000000000001';
SELECT 'S7_staff_cancel' AS step, public.ce_unlock_command('cancel', jsonb_build_object('request_id', :'req_a', 'expected_version', :req_a_v2, 'reason', 'Consignatario alterado (v11)', 'request_key', '00000000-0000-0000-0011-00000000c0c1'))->>'state' AS state;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000a1';
SELECT 'S7_A_list_after_cancel' AS step, i->>'state' AS state, i->>'sla_started_at' AS sla_started_at FROM jsonb_array_elements(public.portal_list_ce_unlock_requests('{}',1)->'items') i;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0011-0000000000b1';
SELECT 'S7_B_bl_item_after_cancel' AS step, i->>'can_submit' AS can_submit, i->'reasons' AS reasons FROM jsonb_array_elements(public.portal_list_ce_unlock_bls('{}',1)->'items') i;
SELECT 'S7_B_draft_after_cancel' AS step, public.portal_ce_unlock_command('draft', '{"bl_ids":["V11-BL-1"],"request_key":"00000000-0000-0000-0011-00000000d0b2"}'::jsonb)->>'state' AS state;
ROLLBACK;
