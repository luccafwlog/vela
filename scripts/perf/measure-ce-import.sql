-- Medição local da importação de CE (etapa 8.1 e 8.9 do plano de correção das
-- importações). Cria, numa transação desfeita, 200 B/Ls faturáveis de um
-- Cliente com Liberação e mede `apply_ce_mercante_rows_atomic` com a base em
-- :base_bls B/Ls. Uso (banco local descartável, nunca produção):
--
--   psql -X -v ON_ERROR_STOP=1 -v base_bls=600 -v batch=200 -d vela_test -f scripts/perf/measure-ce-import.sql
--   psql -X -v ON_ERROR_STOP=1 -v base_bls=50000 -v batch=200 -d vela_test -f scripts/perf/measure-ce-import.sql
--
-- Aceite 8.1: o tempo com 50 mil fica em no máximo 1,3× o tempo com 600.
-- Com -v defer=true, mede o caminho da tela (etapa 8.9): gravação do CE e do
-- cálculo, depois emissão em lotes de 25 (`emit_ce_mercante_billing`).
-- Sem defer, passe -v defer=false.
-- Imprime `ce_import_ms` em NOTICE. Termina em ROLLBACK.
\set QUIET on
BEGIN;
SET LOCAL statement_timeout = 0;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-00000099b001';

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000099b001', 'perf-ce@example.test');
INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('00000000-0000-0000-0000-00000099b001', 'Perf CE', 'administrativo', true);
INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (99990001, '99990001000198', 'PERF CE CLIENTE');
INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
VALUES (99990001, 'Financeiro', 'perf-ce@example.test', 'financeiro', true);
INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
VALUES (99990001, 'Perf', '00000000-0000-0000-0000-00000099b001', now() + interval '1 day');
INSERT INTO public.carriers (id, name) VALUES (99990001, 'PERF CARRIER');
INSERT INTO public.vessels (id, name, carrier_id) VALUES (99990001, 'PERF NAVIO', 99990001);
INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
  (99990001, 99990001, 'PERFA', 'active'), (99990002, 99990001, 'PERFB', 'active');
INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
VALUES (99990001, 'Perf', 'PERFP', CURRENT_DATE - 30, true, 'container');
INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
VALUES (99990001, 99990001, 'Perf por B/L', 'bl', 100, 100, 'bl', 'base', 'any', 'BRL');

-- Base: B/Ls de outra Viagem, sem Cliente.
INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, review_status)
SELECT 'PERF-BASE-' || g, 99990002, 'PERFO', 'PERFQ', 'container', 'pending', 'not_calculated', 'missing_customer', 'ok'
FROM generate_series(1, :base_bls) AS g;

-- Lote: B/Ls faturáveis com container.
INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, review_status, consignee)
SELECT 'PERF-CE-' || g, 99990001, 99990001, 'PERFO', 'PERFP', 'container', 'pending', 'not_calculated', 'matched_document', 'ok', 'PERF CE CLIENTE'
FROM generate_series(1, :batch) AS g;
INSERT INTO public.bl_containers (bl_id, container_number, type)
SELECT 'PERF-CE-' || g, 'PRFU' || lpad(g::text, 7, '0'), '40HC' FROM generate_series(1, :batch) AS g;
ANALYZE public.bls;

SELECT set_config('perf.batch', :'batch', true);
SELECT set_config('perf.defer', COALESCE(NULLIF(:'defer', ''), 'false'), true);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role = 'authenticated';
DO $perf$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_batch_start timestamptz;
  v_result jsonb;
  v_defer boolean := current_setting('perf.defer', true) = 'true';
  v_ids text[];
  v_max_batch_ms numeric := 0;
  v_emit_ms numeric;
  v_offset integer := 0;
BEGIN
  v_result := public.apply_ce_mercante_rows_atomic(
    (SELECT jsonb_agg(jsonb_build_object('row', g + 1, 'bl_id', 'PERF-CE-' || g, 'ce', '999' || lpad(g::text, 12, '0')) ORDER BY g)
     FROM generate_series(1, current_setting('perf.batch')::integer) AS g),
    '00000000-0000-0000-0000-00000099b001'::uuid, 'bls', 'PERF000000001', 99990001, false, NULL, v_defer);
  RAISE NOTICE 'ce_import_ms=% ok=% deferred=%',
    round(extract(epoch FROM clock_timestamp() - v_start) * 1000), v_result->>'ok', v_defer;
  IF v_defer THEN
    -- Lotes de 25, como a tela (CE_BILLING_BATCH_SIZE); cada lote é medido.
    v_ids := ARRAY(SELECT jsonb_array_elements_text(v_result->'billing_pending_bl_ids'));
    v_start := clock_timestamp();
    WHILE v_offset < cardinality(v_ids) LOOP
      v_batch_start := clock_timestamp();
      PERFORM public.emit_ce_mercante_billing(v_ids[v_offset + 1 : v_offset + 25]);
      v_max_batch_ms := GREATEST(v_max_batch_ms, extract(epoch FROM clock_timestamp() - v_batch_start) * 1000);
      v_offset := v_offset + 25;
    END LOOP;
    v_emit_ms := extract(epoch FROM clock_timestamp() - v_start) * 1000;
    RAISE NOTICE 'emit_total_ms=% emit_max_batch_ms=%', round(v_emit_ms), round(v_max_batch_ms);
  END IF;
  RAISE NOTICE 'invoiced=%', (SELECT count(*) FROM public.bls WHERE id LIKE 'PERF-CE-%' AND financial_status = 'invoiced');
END;
$perf$;
ROLLBACK;
