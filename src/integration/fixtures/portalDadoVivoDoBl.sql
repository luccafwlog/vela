-- Roteiro de reprodução da auditoria de segurança run-3 (verificadores, dados
-- fictícios), usado por portalAntigoDonoDoBl.local-pg.test.ts. A suíte roda
-- este arquivo inteiro numa transação desfeita no fim; não rode solto, porque
-- ele grava com ids fixos.
-- v06: independent reproduction of "Portal invoice details keep showing a
-- B/L's live container and billing data to its former customer".
-- Unlike the hunter's fixture, the business flow runs with triggers ON:
-- invoice issued by the CE trigger, customer change by UPDATE bls.customer_id
-- (same path as invoicePostBillingSafety.local-pg.test.ts), refund confirmed by
-- the real RPC, payments by register_ledger_invoice_payment. Dummy data only.
\pset pager off
\set ON_ERROR_STOP 0
\set actor '00000000-0000-0000-0000-000000060601'
\set spare '00000000-0000-0000-0000-000000060602'
\set pa '00000000-0000-0000-0000-0000000a0606'
\set pb '00000000-0000-0000-0000-0000000b0606'

\echo '=== seed (superuser; only the Portal account activation runs with triggers off) ==='
INSERT INTO auth.users (id, email) VALUES
  (:'actor', 'v06-admin@example.test'), (:'spare', 'v06-admin2@example.test'),
  (:'pa', 'v06-portal-a@example.test'), (:'pb', 'v06-portal-b@example.test');
INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
  (:'actor', 'V06 Administrativo', 'administrativo', true),
  (:'spare', 'V06 Administrativo reserva', 'administrativo', true)
  ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
  (99060601, '99000060060158', 'Cliente V06 A'),
  (99060602, '99000060060239', 'Cliente V06 B');
INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary) VALUES
  (99060601, 'Financeiro A', 'fin-a@example.test', 'financeiro', true),
  (99060602, 'Financeiro B', 'fin-b@example.test', 'financeiro', true);
INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at) VALUES
  (99060601, 'Fixture: gate aberto', :'actor', now() + interval '1 day'),
  (99060602, 'Fixture: gate aberto', :'actor', now() + interval '1 day');
SET session_replication_role = replica;
-- A trigger on customers already created each account row; activate it.
UPDATE public.customer_portal_accounts SET active = true, auth_user_id = :'pa', provisioning_decision = 'aprovado_para_provisionar',
  account_situation = 'ativo', recovery_email = 'pa@example.test', portal_email = 'pa@example.test', login_cnpj = '99000060060158'
  WHERE customer_id = 99060601;
UPDATE public.customer_portal_accounts SET active = true, auth_user_id = :'pb', provisioning_decision = 'aprovado_para_provisionar',
  account_situation = 'ativo', recovery_email = 'pb@example.test', portal_email = 'pb@example.test', login_cnpj = '99000060060239'
  WHERE customer_id = 99060602;
SELECT customer_id, active, auth_user_id, account_situation, credentials_revoked_at FROM public.customer_portal_accounts WHERE customer_id IN (99060601, 99060602) ORDER BY customer_id;
SET session_replication_role = origin;
INSERT INTO public.carriers (id, name) VALUES (99060601, 'Carrier V06');
INSERT INTO public.vessels (id, name, carrier_id) VALUES (99060601, 'Vessel V06', 99060601);
INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99060601, 99060601, 'V06-001', 'active');
INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
  VALUES (99060601, 'Tabela V06', 'V06POD', CURRENT_DATE - 30, true, 'container');
INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc)
  VALUES (99060602, 99060601, 'Taxa por container V06', 'container', 500, 500, 'container_distinct_voyage', 'base', 'any', 'BRL', true),
         (99060603, 99060601, 'Drop Off V06', 'container', 100, 100, 'container_distinct_voyage', 'base', 'any', 'BRL', false);
INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante) VALUES
  ('V06-BL-X', 99060601, 99060601, 'V06POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL),
  ('V06-BL-Y', 99060601, 99060601, 'V06POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL);
INSERT INTO public.bl_containers (bl_id, container_number, type, seal_number, gross_weight_kg) VALUES
  ('V06-BL-X', 'AAAU0606001', '22G1', 'SEAL-A-ORIG-X', 10000),
  ('V06-BL-Y', 'AAAU0606002', '22G1', 'SEAL-A-ORIG-Y', 11000);

\echo '=== issue A invoices through the CE trigger (service role, as issueByCe) ==='
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claim.sub = :'actor';
SELECT public.apply_ce_mercante_update('V06-BL-X', '060600000000001', :'actor'::uuid) IS NOT NULL AS ce_x;
SELECT public.apply_ce_mercante_update('V06-BL-Y', '060600000000002', :'actor'::uuid) IS NOT NULL AS ce_y;
COMMIT;
SELECT id AS inv_x FROM public.invoices WHERE bl_id = 'V06-BL-X' AND customer_id = 99060601 AND invoice_type = 'individual' ORDER BY id LIMIT 1 \gset
SELECT id AS inv_y FROM public.invoices WHERE bl_id = 'V06-BL-Y' AND customer_id = 99060601 AND invoice_type = 'individual' ORDER BY id LIMIT 1 \gset
SELECT i.id, i.customer_id, i.bl_id, i.status, i.total_brl, (SELECT count(*) FROM public.invoice_bls ib WHERE ib.invoice_id = i.id) AS invoice_bls_rows,
  (SELECT count(*) FROM public.invoice_document_snapshots s WHERE s.invoice_id = i.id) AS snapshot_rows
FROM public.invoices i WHERE i.id IN (:inv_x, :inv_y) ORDER BY i.id;

\echo '=== A pays invoice Y in full (paid path) ==='
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub = :'actor';
SELECT public.register_ledger_invoice_payment(:inv_y, 600) IS NOT NULL AS paid_y;
COMMIT;

\echo '=== baseline: Portal user A (owner of both B/Ls) ==='
BEGIN;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claim.role = 'authenticated';
SELECT set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true) IS NOT NULL AS session_a;
SET LOCAL ROLE authenticated;
SELECT 'A operation list (baseline)' AS check, jsonb_path_query_array(public.portal_list_operation_bls(), '$[*].bl_id') AS bls;
SELECT 'A detail X (baseline)' AS check, d->'invoice'->>'status' AS inv_status, d->'bls'->0->>'financial_status' AS bl_fin, d->'containers' AS containers FROM (SELECT public.portal_invoice_details(:inv_x) d) s;
SELECT 'A detail Y (baseline)' AS check, d->'invoice'->>'status' AS inv_status, d->'bls'->0->>'financial_status' AS bl_fin, d->'containers' AS containers FROM (SELECT public.portal_invoice_details(:inv_y) d) s;
COMMIT;

\echo '=== Trocar Cliente: staff moves both B/Ls to customer B (triggers ON) ==='
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claim.sub = :'actor';
UPDATE public.bls SET customer_id = 99060602 WHERE id = 'V06-BL-X';
UPDATE public.bls SET customer_id = 99060602 WHERE id = 'V06-BL-Y';
COMMIT;
SELECT 'after move' AS check, b.id, b.customer_id, b.financial_status FROM public.bls b WHERE b.id IN ('V06-BL-X','V06-BL-Y') ORDER BY b.id;
SELECT 'invoices after move' AS check, i.id, i.customer_id, i.bl_id, i.status, i.replaces_invoice_id, i.total_paid_brl,
  (SELECT string_agg(ib.bl_id, ',') FROM public.invoice_bls ib WHERE ib.invoice_id = i.id) AS invoice_bls
FROM public.invoices i WHERE i.bl_id IN ('V06-BL-X','V06-BL-Y') OR i.id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN ('V06-BL-X','V06-BL-Y')) ORDER BY i.id;
SELECT 'customer changes' AS check, c.bl_id, c.status, c.original_invoice_ids FROM public.invoice_customer_changes c WHERE c.bl_id IN ('V06-BL-X','V06-BL-Y') ORDER BY c.bl_id;

\echo '=== paid path: Administrativo confirms the refund to A, which completes the change for Y ==='
SELECT id AS ref_y FROM public.invoice_refunds WHERE invoice_id = :inv_y ORDER BY id LIMIT 1 \gset
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub = :'actor';
SELECT public.confirm_invoice_refund(:ref_y, 'V06-REF-Y', 'Cliente original', now()) AS refund_y;
COMMIT;
SELECT 'customer changes after refund' AS check, c.bl_id, c.status, c.new_invoice_id FROM public.invoice_customer_changes c WHERE c.bl_id IN ('V06-BL-X','V06-BL-Y') ORDER BY c.bl_id;

\echo '=== operation for B: seal and weight corrected on the B/Ls now owned by B ==='
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claim.sub = :'actor';
UPDATE public.bl_containers SET seal_number = 'SEAL-B-NEW-X', gross_weight_kg = 23456 WHERE bl_id = 'V06-BL-X';
UPDATE public.bl_containers SET seal_number = 'SEAL-B-NEW-Y', gross_weight_kg = 24567 WHERE bl_id = 'V06-BL-Y';
COMMIT;

\echo '=== B pays its current invoice for X ==='
SELECT id AS inv_bx FROM public.invoices WHERE customer_id = 99060602 AND status IN ('issued','overdue','partially_paid')
  AND (bl_id = 'V06-BL-X' OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id = 'V06-BL-X')) ORDER BY id DESC LIMIT 1 \gset
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub = :'actor';
SELECT public.register_ledger_invoice_payment(:inv_bx, (SELECT balance_brl FROM public.invoices WHERE id = :inv_bx)) IS NOT NULL AS paid_bx;
COMMIT;
SELECT 'final B/L state' AS check, b.id, b.customer_id, b.financial_status, b.charge_status FROM public.bls b WHERE b.id IN ('V06-BL-X','V06-BL-Y') ORDER BY b.id;
SELECT 'final invoices' AS check, i.id, i.customer_id, i.status, i.total_paid_brl FROM public.invoices i
WHERE i.id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN ('V06-BL-X','V06-BL-Y')) OR i.bl_id IN ('V06-BL-X','V06-BL-Y') ORDER BY i.id;

\echo '=== former owner: Portal user A ==='
BEGIN;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claim.role = 'authenticated';
SELECT set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true) IS NOT NULL AS session_a;
SET LOCAL ROLE authenticated;
SELECT 'A operation list (after move)' AS check, jsonb_path_query_array(public.portal_list_operation_bls(), '$[*].bl_id') AS bls;
SELECT 'A invoice list (after move)' AS check, id, status, bls FROM public.portal_list_invoices() ORDER BY id;
SELECT 'A detail X (after move)' AS check, d->'invoice'->>'status' AS inv_status, d->'bls'->0->>'bl_id' AS bl, d->'bls'->0->>'financial_status' AS bl_fin_live, d->'bls'->0->>'financial_status_snapshot' AS bl_fin_snapshot, d->'containers' AS containers_live FROM (SELECT public.portal_invoice_details(:inv_x) d) s;
SELECT 'A detail Y (after move)' AS check, d->'invoice'->>'status' AS inv_status, d->'bls'->0->>'bl_id' AS bl, d->'bls'->0->>'financial_status' AS bl_fin_live, d->'bls'->0->>'financial_status_snapshot' AS bl_fin_snapshot, d->'containers' AS containers_live FROM (SELECT public.portal_invoice_details(:inv_y) d) s;
COMMIT;

\echo '=== new owner: Portal user B (comparison) ==='
BEGIN;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claim.role = 'authenticated';
SELECT set_config('request.jwt.claims', json_build_object('sub', :'pb', 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true) IS NOT NULL AS session_b;
SET LOCAL ROLE authenticated;
SELECT 'B operation list' AS check, jsonb_path_query_array(public.portal_list_operation_bls(), '$[*].bl_id') AS bls,
  jsonb_path_query_array(public.portal_list_operation_bls(), '$[*].containers[*].container_number') AS containers;
SELECT 'B invoice list' AS check, id, status, bls FROM public.portal_list_invoices() ORDER BY id;
SELECT 'B own detail X' AS check, d->'invoice'->>'status' AS inv_status, d->'bls'->0->>'financial_status' AS bl_fin_live, d->'containers' AS containers FROM (SELECT public.portal_invoice_details(:inv_bx) d) s;
COMMIT;
