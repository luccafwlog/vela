import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

// Migration 574 (decisões 11 e 13 do dono de 2026-11-03): "Disputa" nas recusas
// da Disputa de Demurrage e acento nos textos do servidor que a pessoa ou o
// Cliente leem. Um caso de cada família: motivo de revisão das Taxas Locais,
// Pode consolidar, aviso ao Cliente no sino do Portal, recusa da Disputa, e o
// comparador que precisa reconhecer o texto antigo e o novo.
// Cada caso roda numa transação desfeita no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}
const last = (out: string) => out.split('\n').at(-1)

const POD = 'BRQ74'
const USER = '57400000-0000-4000-8000-000000000001'
const asUser = (role: string) => `
  INSERT INTO auth.users (id, email) VALUES ('${USER}', 'u574@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER}', 'Usuário 574', '${role}', true);
  SELECT set_config('request.jwt.claims', '{"sub":"${USER}","role":"authenticated"}', true);
`
const base = (cargoMode: string, extra = '') => `
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.carriers (id, name) VALUES (5740001, 'Carrier 574');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (5740002, 'Navio 574', 5740001);
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (5740003, 5740002, 'V574', 'active');
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (5740010, '57400000000110', 'Cliente 574');
  INSERT INTO public.bls (id, voyage_id, pol, pod, consignee, cargo_mode, customer_id, ce_mercante, financial_status, charge_status, review_status)
    VALUES ('B574A', 5740003, 'CNSHA', '${POD}', 'Cliente 574', '${cargoMode}', 5740010, '574000000000001', 'pending', 'calculated', 'ok');
  ${extra}
  SET LOCAL session_replication_role = origin;
`

describeLocal('migration 574 — textos do servidor com acento', () => {
  it('motivo de revisão das Taxas Locais sai com acento (Taxas Locais)', () => {
    const out = psql(`BEGIN; ${base('carga_solta', `
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES (5740200, 'Carga solta 574', '${POD}', CURRENT_DATE - 30, true, 'carga_solta');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, sort_order)
        VALUES (5740201, 5740200, 'Movimentação 574', 'bl', 100, 100, 'weight_ton', 'base', 'any', 'BRL', 1);`)}
      SELECT status || '|' || review_reason || '|' || notes
        FROM public.resolve_bl_local_charge_items('B574A', '${POD}') WHERE charge_item_id = 5740201;
      ROLLBACK;`)
    expect(last(out)).toBe('review_required|Peso de carga solta ausente; o peso conteinerizado não substitui o peso solto|Revisão manual obrigatória')
  })

  it('Pode consolidar explica com acento (Faturamento)', () => {
    const out = psql(`BEGIN; ${base('container', `
      INSERT INTO public.bls (id, voyage_id, pol, pod, consignee, cargo_mode, customer_id, ce_mercante, financial_status, charge_status, review_status)
        VALUES ('B574B', 5740003, 'CNSHA', '${POD}', 'Cliente 574', 'container', 5740010, '574000000000002', 'paid', 'calculated', 'ok');
      INSERT INTO public.bl_receivables (bl_id, customer_id, voyage_id, original_amount_brl, balance_brl, status) VALUES
        ('B574A', 5740010, 5740003, 100, 100, 'open'), ('B574B', 5740010, 5740003, 100, 0, 'settled');`)}
      ${asUser('administrativo')}
      SELECT string_agg(bl_id || ':' || eligibility_reason, ',' ORDER BY bl_id)
        FROM public.list_consolidatable_receivables(5740010);
      ROLLBACK;`)
    expect(last(out)).toBe('B574A:Elegível para consolidação.,B574B:B/L já liquidado.')
  })

  it('aviso de transbordo no sino do Portal sai com acento e o Histórico guarda "Omissão de escala" (Portal)', () => {
    const out = psql(`BEGIN; ${base('container', `UPDATE public.bls SET pod = 'BRVIX' WHERE id = 'B574A';`)}
      ${asUser('operacoes')}
      SELECT public.omit_voyage_escala(5740003, 'BRVIX', 'BRSSA', NULL, '${USER}') IS NOT NULL;
      SELECT (SELECT message FROM public.portal_notifications WHERE bl_id = 'B574A' AND type = 'transshipment')
        || '|' || (SELECT justification FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '5740003' AND field_name = 'escala_omitida');
      ROLLBACK;`)
    expect(last(out)).toBe('A escala de BRVIX foi omitida. A carga do B/L B574A foi descarregada em BRSSA e seguirá em transbordo para BRVIX.|Omissão de escala')
  })

  it('recusa da Disputa diz "Disputa" (Demurrage)', () => {
    const out = psql(`BEGIN; ${asUser('financeiro')}
      DO $t$ BEGIN
        PERFORM public.add_demurrage_dispute_message(1, 'resposta', 'cliente');
        RAISE EXCEPTION 'não recusou';
      EXCEPTION WHEN insufficient_privilege THEN
        PERFORM set_config('t574.msg', SQLERRM, true);
      END $t$;
      SELECT current_setting('t574.msg');
      ROLLBACK;`)
    expect(last(out)).toBe('Apenas Equipamentos ou Administrativo pode responder a Disputa.')
  })

  it('a espera de negócio do efeito de importação reconhece o texto antigo e o novo', () => {
    const out = psql(`SELECT string_agg(public._import_effect_was_business_wait('effect_domain_refused', m)::text, ',' ORDER BY n)
      FROM (VALUES
        (1, 'B/L exige reconciliacao manual antes do faturamento.'),
        (2, 'B/L exige reconciliação manual antes do faturamento.'),
        (3, 'Pendencia de revisao nas taxas locais.'),
        (4, 'Pendência de revisão nas taxas locais.'),
        (5, 'Falha qualquer.')) AS v(n, m);`)
    expect(out).toBe('true,true,true,true,false')
  })
})
