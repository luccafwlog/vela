-- Seed dos catálogos-base usados por branches automáticas e por `supabase db reset`.
--
-- Fonte: projeto Supabase de produção `fgmkhbzhaeebrsizwccx` (main),
-- conferida em 2026-08-27.
--
-- Este arquivo é executado depois das migrations em bancos descartáveis. A
-- integração Supabase/GitHub usa-o ao criar a branch Preview; o deploy de
-- migrations em produção não executa este seed. Portanto, este snapshot não
-- altera nem sobrescreve os dados corretos já existentes em main.
--
-- Rollback: remova/recrie a branch ou rode `supabase db reset`; não execute
-- este arquivo diretamente no projeto de produção.

BEGIN;

-- A migration 016 deixou um catálogo didático antigo nas branches novas.
-- Removemos todo o catálogo de taxas locais somente se não houver dados
-- operacionais que dependam dele. Isso torna o seed idempotente em reset e
-- impede uma execução acidental em banco com faturamento real.
DO $catalog_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.charge_calculations)
     OR EXISTS (SELECT 1 FROM public.customer_rate_overrides)
     OR EXISTS (SELECT 1 FROM public.invoice_items WHERE charge_table_id IS NOT NULL OR charge_item_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.pricing_rule_versions WHERE charge_table_id IS NOT NULL OR charge_item_id IS NOT NULL)
  THEN
    RAISE EXCEPTION
      'Seed de catálogo abortado: existem registros operacionais ligados às taxas locais.';
  END IF;

  DELETE FROM public.charge_table_items;
  DELETE FROM public.charge_tables;
END;
$catalog_guard$;

-- Estado correto de public.charge_tables em main.
WITH desired(name, pod, cargo_mode, valid_from, valid_to, active, notes, sort_key) AS (
  VALUES
    ('Vitoria CNTR 2026', 'BRVIT', 'container', DATE '2026-01-01', DATE '2026-12-31', TRUE, NULL, 1),
    ('Salvador CNTR 2026', 'BRSSA', 'container', DATE '2026-01-01', DATE '2026-12-31', TRUE, NULL, 2),
    ('Vitoria BB 2026', 'BRVIX', 'carga_solta', DATE '2026-01-01', DATE '2026-12-31', TRUE, NULL, 3)
)
INSERT INTO public.charge_tables (name, pod, cargo_mode, valid_from, valid_to, active, notes)
SELECT name, pod, cargo_mode, valid_from, valid_to, active, notes
FROM desired
ORDER BY sort_key;

-- Estado correto de public.charge_table_items em main. O vínculo com a tabela
-- é resolvido pela chave natural, nunca por IDs de sequence de produção.
WITH desired(
  table_name, table_pod, table_mode, item_name, applies_to, container_type,
  cargo_profile, value_brl, currency, category, application_basis,
  unit_value_brl, unit_value_usd, manual_only, active, sort_order
) AS (
  VALUES
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'THD', 'container', NULL, 'standard', 1420, 'BRL', 'base', 'container_distinct_voyage', 1420, NULL, FALSE, TRUE, 10),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'THD', 'container', NULL, 'imo',      2130, 'BRL', 'base', 'container_distinct_voyage', 2130, NULL, FALSE, TRUE, 11),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'THD', 'container', NULL, 'oog',      2840, 'BRL', 'base', 'container_distinct_voyage', 2840, NULL, FALSE, TRUE, 12),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'ISPS', 'container', NULL, 'any',      115, 'BRL', 'base', 'container_distinct_voyage', 115, NULL, FALSE, TRUE, 20),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'B/L Fee', 'bl', NULL, 'any',          600, 'BRL', 'base', 'bl',                       600, NULL, FALSE, TRUE, 30),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Drop Off Fee', 'container', NULL, 'any', 150, 'BRL', 'base', 'container_distinct_voyage', 150, NULL, FALSE, TRUE, 40),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Damage Protection Fee', 'container', NULL, 'any', 185, 'BRL', 'base', 'container_distinct_voyage', 185, NULL, FALSE, TRUE, 50),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'B/L Reissuing', 'bl', NULL, 'any', 600, 'BRL', 'other_charge', 'bl', 600, NULL, TRUE, TRUE, 60),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Correction Letter', 'bl', NULL, 'any', 600, 'BRL', 'other_charge', 'bl', 600, NULL, TRUE, TRUE, 70),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Late Correction Request', 'bl', NULL, 'any', 850, 'BRL', 'other_charge', 'bl', 850, NULL, TRUE, TRUE, 80),
    ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Booking Cancelation Fee', 'teu', NULL, 'any', 0, 'USD', 'other_charge', 'teu', 0, 150, TRUE, TRUE, 90),

    ('Salvador CNTR 2026', 'BRSSA', 'container', 'THD', 'container', NULL, 'standard', 1717, 'BRL', 'base', 'container_distinct_voyage', 1717, NULL, FALSE, TRUE, 10),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'THD', 'container', NULL, 'imo', 2575.5, 'BRL', 'base', 'container_distinct_voyage', 2575.5, NULL, FALSE, TRUE, 11),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'THD', 'container', NULL, 'oog', 3434, 'BRL', 'base', 'container_distinct_voyage', 3434, NULL, FALSE, TRUE, 12),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'ISPS', 'container', NULL, 'any', 50, 'BRL', 'base', 'container_distinct_voyage', 50, NULL, FALSE, TRUE, 20),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'B/L Fee', 'bl', NULL, 'any', 600, 'BRL', 'base', 'bl', 600, NULL, FALSE, TRUE, 30),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'Drop Off Fee', 'container', NULL, 'any', 150, 'BRL', 'base', 'container_distinct_voyage', 150, NULL, FALSE, TRUE, 40),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'Damage Protection Fee', 'container', NULL, 'any', 185, 'BRL', 'base', 'container_distinct_voyage', 185, NULL, FALSE, TRUE, 50),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'B/L Reissuing', 'bl', NULL, 'any', 600, 'BRL', 'other_charge', 'bl', 600, NULL, TRUE, TRUE, 60),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'Correction Letter', 'bl', NULL, 'any', 600, 'BRL', 'other_charge', 'bl', 600, NULL, TRUE, TRUE, 70),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'Late Correction Request', 'bl', NULL, 'any', 850, 'BRL', 'other_charge', 'bl', 850, NULL, TRUE, TRUE, 80),
    ('Salvador CNTR 2026', 'BRSSA', 'container', 'Booking Cancelation Fee', 'teu', NULL, 'any', 0, 'USD', 'other_charge', 'teu', 0, 150, TRUE, TRUE, 90),

    ('Vitoria BB 2026', 'BRVIX', 'carga_solta', 'THD', 'bl', NULL, 'any', 62.5, 'BRL', 'base', 'weight_ton', 62.5, NULL, FALSE, TRUE, 100),
    ('Vitoria BB 2026', 'BRVIX', 'carga_solta', 'BL Fee', 'bl', NULL, 'any', 600, 'BRL', 'base', 'bl', 600, NULL, FALSE, TRUE, 100)
)
INSERT INTO public.charge_table_items (
  charge_table_id, name, applies_to, container_type, cargo_profile, value_brl,
  currency, category, application_basis, unit_value_brl, unit_value_usd,
  manual_only, active, sort_order
)
SELECT ct.id, d.item_name, d.applies_to, d.container_type, d.cargo_profile,
  d.value_brl, d.currency, d.category, d.application_basis, d.unit_value_brl,
  d.unit_value_usd, d.manual_only, d.active, d.sort_order
FROM desired d
JOIN public.charge_tables ct
  ON ct.name = d.table_name
 AND ct.pod = d.table_pod
 AND ct.cargo_mode = d.table_mode
 AND ct.valid_from = DATE '2026-01-01';

DO $charge_assert$
DECLARE
  v_tables INTEGER;
  v_items INTEGER;
BEGIN
  SELECT count(*) INTO v_tables FROM public.charge_tables;
  SELECT count(*) INTO v_items FROM public.charge_table_items;
  IF v_tables <> 3 OR v_items <> 24 THEN
    RAISE EXCEPTION 'Catálogo de taxas locais incompleto: % tabelas e % itens.', v_tables, v_items;
  END IF;
END;
$charge_assert$;

-- O catálogo de demurrage é uma tabela única. Em uma branch nova ela pode
-- conter as 37 linhas legadas das migrations 048/279; elas são substituídas
-- integralmente pelo estado atual de main.
-- Tarifa vigente conta como usada (migration 091); o seed liga a marca de
-- catálogo para poder substituí-las num banco novo.
SET vela.seed_catalog = 'on';
DELETE FROM public.demurrage_rates;
RESET vela.seed_catalog;

INSERT INTO public.demurrage_rates (
  container_type, free_days, p1_day_from, p1_day_to, p1_usd,
  p2_day_from, p2_usd, valid_from, valid_to, active, notes
)
VALUES
  ('40FR', 21, 22, 30, 100, 31, 140, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('20RQ', 10, 11, 19, 95, 20, 110, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('20GP', 21, 22, 30, 30, 31, 50, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('20RF', 10, 11, 19, 95, 20, 110, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('40RQ', 10, 11, 19, 190, 20, 220, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('20OT', 21, 22, 30, 50, 31, 80, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('40HC', 21, 22, 30, 60, 31, 80, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('40GP', 21, 22, 30, 60, 31, 80, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('40OT', 21, 22, 30, 100, 31, 140, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('40RF', 10, 11, 19, 190, 20, 220, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('20HC', 21, 22, 30, 30, 31, 50, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
  ('20FR', 21, 22, 30, 50, 31, 80, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos');

DO $demurrage_assert$
DECLARE
  v_rows INTEGER;
BEGIN
  SELECT count(*) INTO v_rows FROM public.demurrage_rates;
  IF v_rows <> 12 THEN
    RAISE EXCEPTION 'Catálogo de demurrage incompleto: % linhas.', v_rows;
  END IF;
END;
$demurrage_assert$;

-- No schema atual terminais e depots vivem na mesma tabela: terminais são
-- depots.tipo = 'terminal_portuario'. Os IDs de ports não são fixados; são
-- resolvidos pelo LOCODE para manter o seed correto mesmo com sequences em
-- ordem diferente da produção.
DO $depot_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.agency_departure_reports)
     OR EXISTS (SELECT 1 FROM public.vazios_bookings)
     OR EXISTS (SELECT 1 FROM public.vazios_export_service_lines)
     OR EXISTS (SELECT 1 FROM public.voyage_escala_operation_fronts)
     OR EXISTS (SELECT 1 FROM public.voyage_escala_terminal_state)
  THEN
    RAISE EXCEPTION
      'Seed de depots abortado: existem registros operacionais ligados ao catálogo.';
  END IF;

  DELETE FROM public.depot_services;
  DELETE FROM public.depots;
END;
$depot_guard$;

WITH desired(code, name, active, tipo, free_time_vazio_days, free_time_material_days, port_locode) AS (
  VALUES
    ('CAPIXABA TERMINAIS', 'CAPIXABA TERMINAIS', TRUE, 'depot', 60, 60, NULL),
    ('J&W', 'J&W', TRUE, 'depot', 25, 25, NULL),
    ('PENEDO', 'PENEDO', TRUE, 'terminal_portuario', 0, 0, 'BRVIX'),
    ('PONTUAL', 'PONTUAL', TRUE, 'depot', 21, 21, NULL),
    ('PORTMAC', 'PORTMAC', TRUE, 'terminal_portuario', 0, 0, 'BRVIX'),
    ('TCVV', 'TCVV', TRUE, 'depot', 60, 60, NULL),
    ('TECON SSA', 'TECON SSA', TRUE, 'terminal_portuario', 0, 0, 'BRSSA'),
    ('TVV', 'TVV', TRUE, 'terminal_portuario', 0, 0, 'BRVIX'),
    ('ZIRAN', 'ZIRAN', TRUE, 'depot', 30, 30, NULL)
)
INSERT INTO public.depots (
  code, name, active, tipo, free_time_vazio_days, free_time_material_days, port_id
)
SELECT d.code, d.name, d.active, d.tipo, d.free_time_vazio_days,
  d.free_time_material_days, p.id
FROM desired d
LEFT JOIN public.ports p ON p.locode = d.port_locode;

WITH desired(
  depot_code, name, natureza, rate_brl, active, container_type, condition,
  route_destino_code
) AS (
  VALUES
    ('CAPIXABA TERMINAIS', 'HANDLING IN FULL', 'geral', 207.4, TRUE, NULL, NULL, NULL),
    ('CAPIXABA TERMINAIS', 'TRANSPORTATION FLAT EM BUNDLE', 'transporte', 211.75, TRUE, NULL, NULL, 'TVV'),
    ('CAPIXABA TERMINAIS', 'BUNDLE WOODEN PROTECTION', 'geral', 400, TRUE, NULL, NULL, NULL),
    ('CAPIXABA TERMINAIS', 'VISUAL CHECK', 'geral', 91.5, TRUE, NULL, NULL, NULL),
    ('CAPIXABA TERMINAIS', 'BUNDLE REORGANIZATION', 'geral', 54.9, TRUE, NULL, NULL, NULL),
    ('CAPIXABA TERMINAIS', 'CNTR W/ MATERIAL REORGANIZATION ', 'geral', 701.5, TRUE, NULL, NULL, NULL),
    ('CAPIXABA TERMINAIS', 'HANDLING OUT EMPTY', 'geral', 67.1, TRUE, NULL, NULL, NULL),
    ('CAPIXABA TERMINAIS', 'TRANSPORTATION FR/20 PARCIAL', 'transporte', 423.5, TRUE, NULL, NULL, 'PORTMAC'),
    ('CAPIXABA TERMINAIS', 'HANDLING IN EMPTY', 'geral', 67.1, TRUE, NULL, NULL, NULL),
    ('CAPIXABA TERMINAIS', 'TRANSPORTATION FR/20 PARCIAL', 'transporte', 423.5, TRUE, NULL, NULL, 'TVV'),
    ('CAPIXABA TERMINAIS', 'TRANSPORTATION 40HC/40GP/2*20GP', 'transporte', 423.5, TRUE, NULL, NULL, 'TVV'),
    ('CAPIXABA TERMINAIS', 'HANDLING OUT FULL', 'geral', 207.4, TRUE, NULL, NULL, NULL),
    ('CAPIXABA TERMINAIS', 'ARMAZENAGEM FULL', 'armazenagem', 6.71, TRUE, NULL, 'material', NULL),
    ('CAPIXABA TERMINAIS', 'ARMAZENAGEM EMPTY', 'armazenagem', 2.81, TRUE, NULL, 'vazio', NULL),

    ('J&W', 'ARMAZENAGEM', 'armazenagem', 4, TRUE, NULL, 'vazio', NULL),
    ('J&W', 'OVERTIME HANDLING OUT 50%', 'geral', 45, TRUE, NULL, NULL, NULL),
    ('J&W', $$TRANSPORTE 1X40''$$, 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
    ('J&W', $$TRANSPORTE 1X20''$$, 'geral', 366.3, TRUE, NULL, NULL, NULL),
    ('J&W', 'HANDLING OUT', 'geral', 90, TRUE, NULL, NULL, NULL),
    ('J&W', $$TRANSPORTE 2X20''$$, 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
    ('J&W', 'HANDLING IN', 'geral', 90, TRUE, NULL, NULL, NULL),
    ('J&W', 'OVERTIME HANDLING OUT 80%', 'geral', 90, TRUE, NULL, NULL, NULL),

    ('PENEDO', 'TRANSPORTE PACIFICO', 'transporte', 353.1, TRUE, NULL, NULL, 'PORTMAC'),

    ('PONTUAL', 'HANDLING OUT', 'geral', 90, TRUE, NULL, NULL, NULL),
    ('PONTUAL', 'OVERTIME HANDLING OUT 50%', 'geral', 45, TRUE, NULL, NULL, NULL),
    ('PONTUAL', 'OVERTIME TRANSPORTE 50%', 'transporte', 366.3, TRUE, NULL, NULL, 'TECON SSA'),
    ('PONTUAL', $$TRANSPORTE 1X40''$$, 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
    ('PONTUAL', $$TRANSPORTE 1X20''$$, 'geral', 732.6, TRUE, NULL, NULL, NULL),
    ('PONTUAL', 'ARMAZENAGEM ', 'armazenagem', 4, TRUE, NULL, 'vazio', NULL),
    ('PONTUAL', $$TRANSPORTE 2X20''$$, 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
    ('PONTUAL', 'HANDLING IN', 'geral', 90, TRUE, NULL, NULL, NULL),
    ('PONTUAL', 'OVERTIME TRANSPORTE 100%', 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
    ('PONTUAL', 'OVERTIME HANDLING OUT 100%', 'geral', 90, TRUE, NULL, NULL, NULL),

    ('TCVV', $$TRANSPORTE 2X20''$$, 'transporte', 465.18, TRUE, NULL, NULL, 'TVV'),
    ('TCVV', 'HANDLING IN', 'geral', 72, TRUE, NULL, NULL, NULL),
    ('TCVV', $$TRANSPORTE 1X40''$$, 'transporte', 465.18, TRUE, NULL, NULL, 'TVV'),
    ('TCVV', 'HANDLING OUT', 'geral', 72, TRUE, NULL, NULL, NULL),
    ('TCVV', 'OVERTIME HANDLING OUT 50%', 'geral', 45, TRUE, NULL, NULL, NULL),
    ('TCVV', 'OVERTIME HANDLING OUT 100%', 'geral', 90, TRUE, NULL, NULL, NULL),
    ('TCVV', 'ARMAZENAGEM', 'armazenagem', 2.15, TRUE, NULL, 'vazio', NULL),

    ('ZIRAN', $$TRANSPORTE 2X20''$$, 'transporte', 890, TRUE, NULL, NULL, 'TECON SSA'),
    ('ZIRAN', $$TRANSPORTE 1X40''$$, 'transporte', 890, TRUE, NULL, NULL, 'TECON SSA'),
    ('ZIRAN', 'OVERTIME TRANSPORTE 50%', 'transporte', 445, TRUE, NULL, NULL, 'TECON SSA'),
    ('ZIRAN', $$ARMAZENAGEM 40''$$, 'armazenagem', 3.14, TRUE, NULL, 'vazio', NULL),
    ('ZIRAN', 'OVERTIME HANDLING OUT 100%', 'geral', 75.15, TRUE, NULL, NULL, NULL),
    ('ZIRAN', 'HANDLING OUT', 'geral', 75.15, TRUE, NULL, NULL, NULL),
    ('ZIRAN', $$ARMAZENAGEM 20''$$, 'armazenagem', 1.58, TRUE, NULL, 'vazio', NULL),
    ('ZIRAN', 'HANDLING IN', 'geral', 75.15, TRUE, NULL, NULL, NULL),
    ('ZIRAN', 'OVERTIME HANDLING OUT 50%', 'geral', 37.58, TRUE, NULL, NULL, NULL),
    ('ZIRAN', 'OVERTIME TRANSPORTE 100%', 'transporte', 890, TRUE, NULL, NULL, 'TECON SSA')
)
INSERT INTO public.depot_services (
  depot_id, name, natureza, rate_brl, active, container_type, condition, route_destino_id
)
SELECT d.id, s.name, s.natureza, s.rate_brl, s.active, s.container_type,
  s.condition, rd.id
FROM desired s
JOIN public.depots d ON d.code = s.depot_code
LEFT JOIN public.depots rd ON rd.code = s.route_destino_code;

DO $depot_assert$
DECLARE
  v_depots INTEGER;
  v_terminals INTEGER;
  v_services INTEGER;
BEGIN
  SELECT count(*) INTO v_depots FROM public.depots;
  SELECT count(*) INTO v_terminals FROM public.depots WHERE tipo = 'terminal_portuario';
  SELECT count(*) INTO v_services FROM public.depot_services;
  IF v_depots <> 9 OR v_terminals <> 4 OR v_services <> 50 THEN
    RAISE EXCEPTION
      'Catálogo de depots/terminais incompleto: % depots, % terminais e % serviços.',
      v_depots, v_terminals, v_services;
  END IF;
END;
$depot_assert$;

COMMIT;
