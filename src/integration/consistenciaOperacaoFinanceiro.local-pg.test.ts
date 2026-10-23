import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 429 (auditoria run-3, notas de endurecimento): consistência na
// operação e no financeiro. Tudo roda numa transação descartada no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '41700000-0000-4000-8000-000000000001'
const FIN = '41700000-0000-4000-8000-000000000002'
const CUSTOMER = 417001
const VOYAGE = 417012
const BL = 'C417-BL'
const INVOICE = 417020
const DEM_INVOICE = 417021
const REQUEST = '41700000-0000-4000-8000-0000000000a1'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function migration417Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('VL002' in prosrc) > 0 FROM pg_proc WHERE proname = 'delete_records';`) === 't'
  } catch {
    return false
  }
}

const FIXTURES = `
  SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '${ADM}';
  INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'c417-adm@example.test'), ('${FIN}', 'c417-fin@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
    ('${ADM}', 'Administrativo C417', 'administrativo', true), ('${FIN}', 'Financeiro C417', 'financeiro', true);
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${syntheticCnpj(41701)}', 'Cliente C417');
  INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
    VALUES (${CUSTOMER}, 'Fixture C417', '${ADM}', now() + interval '1 day');
  INSERT INTO public.carriers (id, name) VALUES (417010, 'Carrier C417');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (417011, 'Vessel C417', 417010);
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, 417011, 'V417', 'active');
  INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('${BL}', ${VOYAGE}, ${CUSTOMER}, 'CE417');
  CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN EXECUTE q; RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $f$;
  GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated, service_role;
`

const as = (sub: string) => `RESET ROLE; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${sub}';`
const asOwner = `RESET ROLE; SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '${ADM}';`
const try_ = (sql: string) => `SELECT pg_temp.try($q$${sql}$q$);`

function scenario(sql: string): string[] {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`], { encoding: 'utf8' }).trim().split(/\r?\n/)
}

const describeLocal = describeWithProbe(migration417Applied, 'migration417Applied (consistência na operação e no financeiro)')

describeLocal('429 — consistência na operação e no financeiro', () => {
  it('marca de retirada da escala só aceita true ou false', () => {
    // A API não insere em audit_logs; o caminho real é o payload da escala
    // gravado por save_voyage_escala_terminal_state_v2, que dispara o mesmo gatilho.
    const insert = (value: string) => try_(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES ('voyage_pod_schedule', '${VOYAGE}::C417PORT', 'deleted', NULL, '${value}', '${ADM}')`)
    expect(scenario(`${asOwner} ${insert('sim')} ${insert('1')} ${insert('false')}`)).toEqual(['22023', '22023', 'ok'])
  })

  it('a escala gravada pelo Financeiro assina como Financeiro (429 e 432)', () => {
    expect(scenario(`
      ${as(FIN)}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRSSZ', 0, '[]', '[]',
        '{"tem_exportacao":false,"granito":false,"vazios":false,"has_empty":false,"discharge_ports":[],"linked":false,"schedule":{"eta":"2026-11-01T12:00:00Z","tem_importacao":true}}', NULL) IS NOT NULL;
      ${asOwner}
      SELECT string_agg(DISTINCT actor_department, ',') FROM public.audit_logs WHERE entity_id = '${VOYAGE}::BRSSZ' AND changed_by = '${FIN}';
    `).at(-1)).toBe('financeiro')
  })

  it('exceção PIX resolvida não tem TXID, valor e data reescritos', () => {
    const row = (txid: string, amount: number) => `'[{"line_number":1,"txid":"${txid}","cnpj":"","paid_at":"2026-10-22T12:00:00Z","amount_brl":${amount},"reason":"unmatched","candidate_count":0}]'::jsonb`
    expect(scenario(`
      ${as(FIN)}
      SELECT public.upsert_pix_reconciliation_exceptions('C417-IMPORT', ${row('ORIGINAL417', 10)}) IS NOT NULL;
      ${asOwner}
      UPDATE public.pix_reconciliation_exceptions SET status = 'resolved' WHERE import_key = 'C417-IMPORT';
      ${as(FIN)}
      SELECT public.upsert_pix_reconciliation_exceptions('C417-IMPORT', ${row('OUTRO417', 99)})->'items'->0->>'status';
      ${asOwner}
      SELECT txid || '|' || amount_brl FROM public.pix_reconciliation_exceptions WHERE import_key = 'C417-IMPORT';
    `).slice(-2)).toEqual(['resolved', 'ORIGINAL417|10.00'])
  })

  it('pedido de baixa repetido depois do cancelamento da baixa é recusado', () => {
    // O resultado guardado aponta um pagamento que não existe mais (cancelado).
    expect(scenario(`
      INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, status, pix_payload)
        VALUES (${INVOICE}, 'C417-INV', ${CUSTOMER}, 50.00, 'issued', 'C417');
      INSERT INTO public.ledger_payment_requests (request_id, payload_hash, created_by, result)
      VALUES ('${REQUEST}', md5(jsonb_build_object('invoice_id', ${INVOICE}::bigint, 'amount_brl', round(10::numeric, 2), 'method', 'pix',
        'paid_at', '2026-10-22T12:00:00Z'::timestamptz, 'pix_txid', NULL::text, 'source', 'manual', 'notes', NULL::text, 'actor', '${FIN}'::uuid)::text),
        '${FIN}', '{"payment_id": 999417999}'::jsonb);
      ${as(FIN)}
      ${try_(`SELECT public.register_ledger_invoice_payment(${INVOICE}, 10, 'pix', '2026-10-22T12:00:00Z'::timestamptz, NULL, 'manual', NULL, '${FIN}'::uuid, '${REQUEST}'::uuid)`)}
    `).at(-1)).toBe('22023')
  })

  it('valor novo de Demurrage em conferência de vencimento não some quando a cobrança segue viva', () => {
    expect(scenario(`
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status)
        VALUES (${DEM_INVOICE}, 'DEM-C417', '${BL}', ${CUSTOMER}, 100, 'issued');
      INSERT INTO public.itau_pix_charges (demurrage_invoice_id, txid, amount_brl, expiration_seconds, status, bank_created_at, revision)
        VALUES (${DEM_INVOICE}, 'VELAC417000000000000000000000000', 100.00, 3600, 'pending_expire_check', now() - interval '1 hour', 1);
      SELECT public._itau_pix_sync(NULL, ${DEM_INVOICE}, 120.00, true);
      SELECT amount_brl || '|' || status || '|' || change_version FROM public.itau_pix_charges WHERE demurrage_invoice_id = ${DEM_INVOICE};
      SELECT public.itau_pix_record((SELECT id FROM public.itau_pix_charges WHERE demurrage_invoice_id = ${DEM_INVOICE}), 'active', 2, 'copia-e-cola-c417', NULL, NULL, 0);
    `).slice(-2)).toEqual(['120.00|pending_expire_check|1', 'pending_update'])
  })

  it('excluir id que não é B/L não descarta efeitos pendentes, nem na prévia', () => {
    expect(scenario(`
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by)
        VALUES (gen_random_uuid(), 'local_billing', 'C417-FANTASMA', '${ADM}');
      ${as(ADM)}
      SELECT public.delete_records('bl', ARRAY['C417-FANTASMA'], true)->'blocked'->0->'reasons'->>0;
      ${asOwner}
      SELECT status FROM public.import_pending_effects WHERE entity_id = 'C417-FANTASMA';
    `).slice(-2)).toEqual(['não encontrado', 'pending'])
  })
})
