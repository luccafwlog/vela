-- Roteiro de reprodução da auditoria de segurança run-3 (verificadores, dados
-- fictícios), usado por portalAntigoDonoDoBl.local-pg.test.ts. A suíte roda
-- este arquivo inteiro numa transação desfeita no fim; não rode solto, porque
-- ele grava com ids fixos.
\pset pager off
\set ON_ERROR_STOP 0
-- v10 independent reproduction. Dummy fixture (namespace 9951xxxx, example.test e-mails).
-- Staff: V10 Ops (operacoes) moves the B/L; V10 Fin (administrativo) registers B's payment.
-- Portal: PA (customer A, former owner) and PB (customer B, new owner).
SET request.jwt.claim.role = 'service_role';
SET request.jwt.claim.sub = '00000000-0000-0000-0510-000000000001';
INSERT INTO auth.users (id, email) VALUES
 ('00000000-0000-0000-0510-000000000001','v10-fin@example.test'),
 ('00000000-0000-0000-0510-000000000002','v10-ops@example.test'),
 ('00000000-0000-0000-0510-0000000000a1','v10-portal-a@example.test'),
 ('00000000-0000-0000-0510-0000000000b1','v10-portal-b@example.test');
INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
 ('00000000-0000-0000-0510-000000000001','V10 Fin','administrativo',true),
 ('00000000-0000-0000-0510-000000000002','V10 Ops','operacoes',true)
 ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, active=true;
INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (99510001,'99000005100135','V10 Cliente Antigo A'),(99510002,'99000005100216','V10 Cliente Novo B');
INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary) VALUES
 (99510001,'Fin A','v10-fin-a@example.test','financeiro',true),(99510002,'Fin B','v10-fin-b@example.test','financeiro',true);
INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at) VALUES
 (99510001,'Fixture v10','00000000-0000-0000-0510-000000000001', now()+interval '1 day'),
 (99510002,'Fixture v10','00000000-0000-0000-0510-000000000001', now()+interval '1 day');
INSERT INTO public.customer_portal_accounts (customer_id, active, auth_user_id, provisioning_decision, account_situation, recovery_email, portal_email, login_cnpj) VALUES
 (99510001,true,'00000000-0000-0000-0510-0000000000a1','aprovado_para_provisionar','ativo','v10pa@example.test','v10pa@example.test','99000005100135'),
 (99510002,true,'00000000-0000-0000-0510-0000000000b1','aprovado_para_provisionar','ativo','v10pb@example.test','v10pb@example.test','99000005100216')
 ON CONFLICT (customer_id) DO UPDATE SET active=true, auth_user_id=EXCLUDED.auth_user_id, provisioning_decision=EXCLUDED.provisioning_decision, account_situation='ativo';
INSERT INTO public.carriers (id, name) VALUES (99510003,'Carrier V10');
INSERT INTO public.vessels (id, name, carrier_id) VALUES (99510004,'Vessel V10',99510003);
INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99510005,99510004,'V10','active');
INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES (99510010,'Tabela V10','V10POD',CURRENT_DATE-30,true,'container');
INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc) VALUES
 (99510040,99510010,'Taxa por container V10','container',700,700,'container_distinct_voyage','base','any','BRL',true),
 (99510041,99510010,'Drop Off V10','container',300,300,'container_distinct_voyage','base','any','BRL',false);
INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
 VALUES ('V10-BL-1',99510005,99510001,'V10POD','container','pending','not_calculated','reconciled',NULL);
INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('V10-BL-1','VVCU1000001','22G1');
RESET request.jwt.claim.role; RESET request.jwt.claim.sub;

-- 1. CE recorded (server maintenance path): issues A's individual invoice (R$ 1000).
BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0510-000000000001';
DO $$ BEGIN PERFORM public.apply_ce_mercante_update('V10-BL-1','839000000510001','00000000-0000-0000-0510-000000000001'::uuid); END $$;
COMMIT;
SELECT id AS inv_a FROM public.invoices WHERE customer_id=99510001 AND invoice_type='individual' \gset
SELECT 'S1_db' AS step, id, customer_id, invoice_number, status, total_brl, balance_brl FROM public.invoices WHERE customer_id IN (99510001,99510002) ORDER BY id;

-- 2. Active internal user with role 'operacoes' changes the B/L customer A -> B via the 366 column grant.
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0510-000000000002';
SELECT 'S2_mover_role' AS step, public.is_active_user() AS active_user, public.is_admin() AS is_admin;
UPDATE public.bls SET customer_id = 99510002 WHERE id='V10-BL-1';
COMMIT;
SELECT id AS inv_b FROM public.invoices WHERE customer_id=99510002 AND invoice_type='individual' \gset
SELECT 'S2_db_invoices' AS step, id, customer_id, invoice_number, status, total_brl, balance_brl, replaces_invoice_id FROM public.invoices WHERE customer_id IN (99510001,99510002) ORDER BY id;
SELECT 'S2_db_receivables' AS step, id AS receivable_id, customer_id, source, status, original_amount_brl, balance_brl FROM public.bl_receivables WHERE bl_id='V10-BL-1';
SELECT 'S2_db_links' AS step, invoice_id, receivable_id, status FROM public.invoice_receivable_links WHERE bl_id='V10-BL-1' ORDER BY id;

-- 3. B's invoice receives a partial payment of R$ 730 (registered by staff).
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0510-000000000001';
SELECT 'S3_B_payment' AS step, public.register_ledger_invoice_payment(:inv_b, 730)->>'status' AS result;
COMMIT;
SELECT 'S3_db_receivables' AS step, id AS receivable_id, customer_id, status, settled_amount_brl, balance_brl FROM public.bl_receivables WHERE bl_id='V10-BL-1';
SELECT 'S3_db_invoices' AS step, id, customer_id, status, total_paid_brl, balance_brl FROM public.invoices WHERE customer_id IN (99510001,99510002) ORDER BY id;

-- Portal A (former owner) lists its own cancelled invoice.
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0510-0000000000a1';
SELECT 'S3_A_scope' AS step, public.current_portal_customer_id();
SELECT 'S3_A_list_cancelled' AS step, r->>'id' AS id, r->>'invoice_number' AS inv, r->>'status' AS status, r->>'total_brl' AS total, r->>'balance_brl' AS balance FROM jsonb_array_elements(public.portal_list_invoices_page(25,0,'cancelled',NULL,NULL,NULL,NULL,NULL)->'rows') r;
COMMIT;
-- Portal B (new owner) for contrast.
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0510-0000000000b1';
SELECT 'S3_B_list' AS step, r->>'id' AS id, r->>'invoice_number' AS inv, r->>'status' AS status, r->>'balance_brl' AS balance FROM jsonb_array_elements(public.portal_list_invoices_page(25,0,NULL,NULL,NULL,NULL,NULL,NULL)->'rows') r;
COMMIT;

-- 4. Post-move B/L correction (container becomes SOC: drop-off R$ 300 removed); B gets offset/refund.
SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '00000000-0000-0000-0510-000000000001';
UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='V10-BL-1';
RESET request.jwt.claim.role; RESET request.jwt.claim.sub;
SELECT 'S4_db_corrections' AS step, c.id, c.invoice_id, i.customer_id AS correction_invoice_customer, c.receivable_id, c.amount_brl, c.offset_brl, c.refund_brl FROM public.invoice_corrections c JOIN public.invoices i ON i.id=c.invoice_id WHERE c.receivable_id IN (SELECT id FROM public.bl_receivables WHERE bl_id='V10-BL-1') ORDER BY c.id;
SELECT 'S4_db_refunds' AS step, r.id, r.invoice_id, r.amount_brl, r.status FROM public.invoice_refunds r WHERE r.invoice_id IN (:inv_a, :inv_b) ORDER BY r.id;
SELECT 'S4_db_links' AS step, invoice_id, receivable_id, status FROM public.invoice_receivable_links WHERE bl_id='V10-BL-1' ORDER BY id;

-- 5. Portal A opens its own cancelled invoice; then (contrast) tries B's invoice directly.
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0510-0000000000a1';
SELECT 'S5_A_details_own_cancelled' AS step, d#>>'{invoice,id}' AS id, d#>>'{invoice,customer_name}' AS customer, d#>>'{invoice,status}' AS status, d->'corrections' AS corrections, d#>'{financial_summary,offset_brl}' AS summary_offset FROM (SELECT public.portal_invoice_details(:inv_a) d) x;
SAVEPOINT s;
SELECT 'S5_A_reads_B_directly' AS step, public.portal_invoice_details(:inv_b);
ROLLBACK TO SAVEPOINT s;
COMMIT;
-- Portal B sees the same correction on its own invoice.
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0510-0000000000b1';
SELECT 'S5_B_details_own' AS step, d#>>'{invoice,id}' AS id, d#>>'{invoice,customer_name}' AS customer, d#>>'{invoice,status}' AS status, d->'corrections' AS corrections, d#>'{financial_summary,offset_brl}' AS summary_offset FROM (SELECT public.portal_invoice_details(:inv_b) d) x;
COMMIT;
