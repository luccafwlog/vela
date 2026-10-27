import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

// Migration 467 (lote 2 do plano de correções, decisões do dono de 2026-10-27).
// Cada caso roda numa transação desfeita no fim, com POD próprio para não
// esbarrar nas tabelas de outros testes.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}
const last = (out: string) => out.split('\n').at(-1)

const POD = 'BRQ67'
const fixture = (cargoMode: string, extra = '') => `
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.carriers (id, name) VALUES (4670001, 'Carrier 467');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (4670002, 'Navio 467', 4670001);
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (4670003, 4670002, 'V467', 'active');
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (4670010, '46700000000110', 'Cliente 467');
  INSERT INTO public.bls (id, voyage_id, pol, pod, consignee, cargo_mode, customer_id, financial_status, charge_status, review_status, bb_weight_ton)
    VALUES ('B467A', 4670003, 'CNSHA', '${POD}', 'Cliente 467', '${cargoMode}', 4670010, 'pending', 'not_calculated', 'ok', ${extra || 'NULL'});
  INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES
    (4670100, 'Container 467', '${POD}', CURRENT_DATE - 30, true, 'container'),
    (4670200, 'Carga solta 467', '${POD}', CURRENT_DATE - 30, true, 'carga_solta');
  SET LOCAL session_replication_role = origin;
`
const asAdmin = `
  INSERT INTO auth.users (id, email) VALUES ('46700000-0000-4000-8000-000000000001', 'adm467@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('46700000-0000-4000-8000-000000000001', 'Adm 467', 'administrativo', true);
  SELECT set_config('request.jwt.claims', '{"sub":"46700000-0000-4000-8000-000000000001","role":"authenticated"}', true);
`
const item = (id: number, table: number, name: string, basis: string, sort: number) =>
  `(${id}, ${table}, '${name}', 'bl', 100, 100, '${basis}', 'base', 'any', 'BRL', ${sort})`
const items = (rows: string[]) => `
  INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, sort_order)
  VALUES ${rows.join(', ')};`
const chargedItems = `SELECT coalesce(string_agg(charge_item_id::text, ',' ORDER BY charge_item_id), '-')
  FROM public.resolve_bl_local_charge_items('B467A', '${POD}') WHERE status <> 'review_required';`

describeLocal('migration 467 — Taxas Locais e faturamento', () => {
  it('B/L misto sem taxa por B/L no container cobra todas as da carga solta (TAX-D14)', () => {
    const out = psql(`BEGIN; ${fixture('misto')}
      ${items([item(4670201, 4670200, 'Documental 467', 'bl', 1), item(4670202, 4670200, 'Liberação 467', 'bl', 2)])}
      ${chargedItems} ROLLBACK;`)
    expect(last(out)).toBe('4670201,4670202')
  })

  it('B/L misto com taxa por B/L no container não cobra as da carga solta (TAX-D14)', () => {
    const out = psql(`BEGIN; ${fixture('misto')}
      ${items([item(4670101, 4670100, 'Documental container 467', 'bl', 1), item(4670201, 4670200, 'Documental 467', 'bl', 1), item(4670202, 4670200, 'Liberação 467', 'bl', 2)])}
      ${chargedItems} ROLLBACK;`)
    expect(last(out)).toBe('4670101')
  })

  it('troca de modalidade recalcula no fim da gravação o B/L já calculado (TAX-D17)', () => {
    const out = psql(`BEGIN; ${fixture('container')}
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('B467A', 'TCNU4670001', '40HC');
      SET LOCAL session_replication_role = origin;
      ${items([item(4670101, 4670100, 'Documental container 467', 'bl', 1), item(4670203, 4670200, 'Movimentação 467', 'weight_ton', 1)])}
      SELECT public._calculate_bl_local_charges_impl_106('B467A', NULL, true);
      UPDATE public.bls SET bb_weight_ton = 10 WHERE id = 'B467A';
      SET CONSTRAINTS ALL IMMEDIATE;
      SELECT charge_status || '|' || cargo_mode || '|' || (SELECT string_agg(charge_item_id::text, ',' ORDER BY charge_item_id) FROM public.charge_calculations WHERE bl_id = 'B467A')
        FROM public.bls WHERE id = 'B467A';
      ROLLBACK;`)
    expect(last(out)).toBe('calculated|misto|4670101,4670203')
  })

  it('linha em revisão guarda o motivo do cálculo, não o da guarda de preço (TAX-D16)', () => {
    const out = psql(`BEGIN; ${fixture('carga_solta')}
      ${items([item(4670203, 4670200, 'Movimentação 467', 'weight_ton', 1)])}
      INSERT INTO public.charge_calculations (bl_id, charge_table_id, charge_item_id, quantity, unit_value_brl, total_value_brl, source, status, calculation_key, review_reason, notes)
        SELECT 'B467A', r.charge_table_id, r.charge_item_id, r.quantity, r.unit_value_brl, r.total_value_brl, r.source, r.status, r.calculation_key, r.review_reason, r.notes
        FROM public.resolve_bl_local_charge_items('B467A', '${POD}') r WHERE r.charge_item_id = 4670203;
      SELECT status || '|' || review_reason FROM public.charge_calculations WHERE bl_id = 'B467A';
      ROLLBACK;`)
    expect(last(out)).toMatch(/^review_required\|Peso de carga solta ausente/)
  })

  it('tabela já usada não muda POD nem modo de carga; tabela sem uso muda (TAX-D13)', () => {
    const out = psql(`BEGIN; ${fixture('container')}
      UPDATE public.charge_tables SET pod = 'BRQ68' WHERE id = 4670200;
      INSERT INTO public.bl_charge_table_links (bl_id, scope, charge_table_id) VALUES ('B467A', 'container', 4670100);
      UPDATE public.charge_tables SET name = 'Container 467 renomeada' WHERE id = 4670100;
      DO $t$ BEGIN
        UPDATE public.charge_tables SET cargo_mode = 'carga_solta' WHERE id = 4670100;
        RAISE EXCEPTION 'não travou';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'Tabela já usada por B/L%' THEN RAISE; END IF;
      END $t$;
      SELECT (SELECT pod FROM public.charge_tables WHERE id = 4670200) || '|' || (SELECT cargo_mode || ':' || name FROM public.charge_tables WHERE id = 4670100);
      ROLLBACK;`)
    expect(last(out)).toBe('BRQ68|container:Container 467 renomeada')
  })

  it('consolidada mostra B/L com saldo e sem CE Mercante como não elegível (FAT-D12)', () => {
    const out = psql(`BEGIN; ${fixture('container')}
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id, pol, pod, consignee, cargo_mode, customer_id, ce_mercante, financial_status, charge_status, review_status)
        VALUES ('B467B', 4670003, 'CNSHA', '${POD}', 'Cliente 467', 'container', 4670010, '467000000000002', 'pending', 'calculated', 'ok');
      INSERT INTO public.bl_receivables (bl_id, customer_id, voyage_id, original_amount_brl, balance_brl, status) VALUES
        ('B467A', 4670010, 4670003, 100, 100, 'open'), ('B467B', 4670010, 4670003, 100, 100, 'open');
      SET LOCAL session_replication_role = origin;
      ${asAdmin}
      SELECT string_agg(bl_id || ':' || eligibility_status || ':' || eligibility_reason, ',' ORDER BY bl_id)
        FROM public.list_consolidatable_receivables(4670010);
      ROLLBACK;`)
    expect(last(out)).toBe('B467A:no_ce_mercante:sem CE Mercante.,B467B:eligible:Elegivel para consolidacao.')
  })

  it('Histórico do B/L mantém a exclusão de taxa manual e põe o refixar em Taxas (TAX-D08)', () => {
    const out = psql(`BEGIN; ${fixture('container')}
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.charge_calculations (id, bl_id, charge_table_id, quantity, total_value_brl, source, status)
        VALUES (4670901, 'B467A', 4670100, 1, 50, 'manual', 'calculated');
      SET LOCAL session_replication_role = origin;
      DELETE FROM public.charge_calculations WHERE id = 4670901;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, changed_at, justification)
        VALUES ('charge_calculation', '4670901', 'manual_delete', 'charge_item_id=- | qty=1', now(), 'Remocao manual de other charge');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at, justification)
        VALUES ('bl', 'B467A', 'local_charge_prices_refixed', '{}', '{}', now() + interval '1 second', 'Reimportação');
      ${asAdmin}
      SELECT string_agg(family || ':' || field_name, ',' ORDER BY id)
        FROM public.bl_timeline('B467A', 50, 0) WHERE field_name IN ('manual_delete', 'local_charge_prices_refixed');
      ROLLBACK;`)
    expect(last(out)).toBe('taxas:manual_delete,taxas:local_charge_prices_refixed')
  })
})
