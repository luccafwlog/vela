import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migrations 424 a 428 (auditoria run-3, decisões do dono de 2026-10-22):
// dispensa de alerta até 30 dias, Demurrage reemitida sem o desconto, Dispute
// nova só em fatura não paga, ROE manual do B/L e CNPJ do Cliente só por
// função, limites do bucket do Desbloqueio de CE. Tudo roda numa transação
// descartada no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '42400000-0000-4000-8000-000000000001'
const EQUIP = '42400000-0000-4000-8000-000000000002'
const OPS = '42400000-0000-4000-8000-000000000003'
const PORTAL_A = '42400000-0000-4000-8000-000000000004'
const CUSTOMER_A = 424001
const CUSTOMER_B = 424002
const CUSTOMER_C = 424003
const VOYAGE = 424012
const BL_DESCONTO = 'C424-BL-DESC'
const BL_PAGA = 'C424-BL-PAGA'
const BL_ROE = 'C424-BL-ROE'
const INVOICE_DESCONTO = 424020
const INVOICE_PAGA = 424021
const ALERT_ITEM = 424040
const CNPJ_NOVO = syntheticCnpj(42409)

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function decisionsApplied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.set_bl_manual_roe(text,numeric,text)') IS NOT NULL
      AND to_regprocedure('public.dismiss_alert_item_core_424(bigint,text,timestamp with time zone)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const FIXTURES = `
  SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '${ADM}';
  INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'c424-adm@example.test'), ('${EQUIP}', 'c424-equip@example.test'),
    ('${OPS}', 'c424-ops@example.test'), ('${PORTAL_A}', 'c424-a@example.test');
  INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
    ('${ADM}', 'Administrativo C424', 'administrativo', true),
    ('${EQUIP}', 'Equipamentos C424', 'equipamentos', true),
    ('${OPS}', 'Operações C424', 'operacoes', true);
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
    (${CUSTOMER_A}, '${syntheticCnpj(42401)}', 'Cliente C424 A'),
    (${CUSTOMER_B}, '${syntheticCnpj(42402)}', 'Cliente C424 B'),
    (${CUSTOMER_C}, '${syntheticCnpj(42403)}', 'Cliente C424 C');
  UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL_A}', active = true, account_situation = 'ativo'
    WHERE customer_id = ${CUSTOMER_A};
  INSERT INTO public.carriers (id, name) VALUES (424010, 'Carrier C424');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (424011, 'Vessel C424', 424010);
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, 424011, 'V424', 'active');
  INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES
    ('${BL_DESCONTO}', ${VOYAGE}, ${CUSTOMER_A}, 'CE424D'),
    ('${BL_PAGA}', ${VOYAGE}, ${CUSTOMER_A}, 'CE424P'),
    ('${BL_ROE}', ${VOYAGE}, ${CUSTOMER_C}, 'CE424R');
  INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl,
      discount_mode, discount_value, discount_type, discount_justification, discount_approver, status)
    VALUES (${INVOICE_DESCONTO}, 'DEM-C424-D', '${BL_DESCONTO}', ${CUSTOMER_A}, 100, 5.5, 495,
      'percent', 10, 'comercial', 'Negociado com o Cliente A', 'Gerente C424', 'issued');
  INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status, paid_at)
    VALUES (${INVOICE_PAGA}, 'DEM-C424-P', '${BL_PAGA}', ${CUSTOMER_A}, 100, 'paid', current_date);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.alert_type_catalog (type, severity) VALUES ('test424', 'normal');
  INSERT INTO public.alerts (id, type, message) VALUES (${ALERT_ITEM}, 'test424', 'Alerta C424');
  INSERT INTO public.alert_items (id, alert_id, item_type, source, severity, message)
    VALUES (${ALERT_ITEM}, ${ALERT_ITEM}, 'test424', 'test', 'normal', 'Alerta C424');
  SET LOCAL session_replication_role = origin;
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

const describeLocal = describeWithProbe(decisionsApplied, 'decisionsApplied (migrations 424 a 428)')

describeLocal('424 a 428 — decisões do dono da auditoria run-3', () => {
  it('424: dispensa vai até o fim do 30º dia e não além', () => {
    const endOfDay30 = `(date_trunc('day', now() AT TIME ZONE 'UTC') + interval '30 days 23:59:59') AT TIME ZONE 'UTC'`
    const day31 = `(date_trunc('day', now() AT TIME ZONE 'UTC') + interval '31 days') AT TIME ZONE 'UTC'`
    expect(scenario(`
      ${as(ADM)}
      ${try_(`SELECT public.dismiss_alert_item(${ALERT_ITEM}, 'Aguardando o armador', ${day31})`)}
      ${try_(`SELECT public.dismiss_alert_item(${ALERT_ITEM}, 'Aguardando o armador', ${endOfDay30})`)}
    `)).toEqual(['22023', 'ok'])
  })

  it('425: Invoice de Demurrage reemitida para o novo Cliente nasce sem o desconto, com o R$ cheio', () => {
    expect(scenario(`
      UPDATE public.bls SET customer_id = ${CUSTOMER_B} WHERE id = '${BL_DESCONTO}';
      SELECT concat_ws('|', coalesce(discount_mode, '-'), coalesce(discount_value::text, '-'), coalesce(discount_justification, '-'),
          current_total_brl, notes LIKE '%desconto da Invoice anterior não foi copiado%')
        FROM public.demurrage_invoices WHERE bl_id = '${BL_DESCONTO}' AND customer_id = ${CUSTOMER_B};
      SELECT status FROM public.demurrage_invoices WHERE id = ${INVOICE_DESCONTO};
    `)).toEqual(['-|-|-|550.00|t', 'cancelled'])
  })

  it('425: Portal não abre Dispute nova em Invoice paga, mas segue a conversa já aberta', () => {
    expect(scenario(`
      ${as(PORTAL_A)}
      ${try_(`SELECT public.portal_open_demurrage_dispute(${INVOICE_PAGA}, 'Contesto a cobrança')`)}
      ${asOwner}
      INSERT INTO public.demurrage_disputes (demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by)
        VALUES (${INVOICE_PAGA}, ${CUSTOMER_A}, 'aberta', 'cliente', 'Aberta antes do pagamento', 'cliente');
      ${as(PORTAL_A)}
      ${try_(`SELECT public.portal_add_dispute_message(${INVOICE_PAGA}, 'Segue o comprovante do pagamento')`)}
    `)).toEqual(['22023', 'ok'])
  })

  it('426: ROE manual do B/L só pela função, pelos três setores, com motivo no histórico', () => {
    const [direct, ops, short, set, afterSet, history, removed, afterRemove] = scenario(`
      ${as(OPS)}
      ${try_(`UPDATE public.bls SET demurrage_roe = 5, demurrage_roe_manual = true WHERE id = '${BL_ROE}'`)}
      ${try_(`SELECT public.set_bl_manual_roe('${BL_ROE}', 5.9, 'ROE combinado com o armador')`)}
      ${as(EQUIP)}
      ${try_(`SELECT public.set_bl_manual_roe('${BL_ROE}', 5.9, 'curto')`)}
      ${try_(`SELECT public.set_bl_manual_roe('${BL_ROE}', 5.91234, 'ROE combinado com o armador')`)}
      ${asOwner}
      SELECT concat_ws('|', demurrage_roe_manual, demurrage_roe) FROM public.bls WHERE id = '${BL_ROE}';
      SELECT justification FROM public.audit_logs WHERE entity_type = 'bls' AND entity_id = '${BL_ROE}' AND field_name = 'demurrage_roe' ORDER BY id DESC LIMIT 1;
      ${as(EQUIP)}
      ${try_(`SELECT public.set_bl_manual_roe('${BL_ROE}', NULL, 'Volta para a PTAX do dia')`)}
      ${asOwner}
      SELECT concat_ws('|', demurrage_roe_manual, coalesce(demurrage_roe::text, '-')) FROM public.bls WHERE id = '${BL_ROE}';
    `)
    expect(direct).toBe('42501')
    expect(ops).toBe('42501')
    expect(short).toBe('22023')
    expect(set).toBe('ok')
    expect(afterSet).toBe('t|5.9123')
    expect(history).toBe('ROE manual: ROE combinado com o armador')
    expect(removed).toBe('ok')
    expect(afterRemove).toBe('f|-')
  })

  it('427: CNPJ do Cliente só muda pela função com justificativa; com Conta de Portal, só pela troca administrativa', () => {
    const [direct, viaFunction, stored, history, withPortal] = scenario(`
      ${as(ADM)}
      ${try_(`UPDATE public.customers SET cnpj_cpf = '${CNPJ_NOVO}' WHERE id = ${CUSTOMER_C}`)}
      ${as(OPS)}
      ${try_(`SELECT public.update_customer_with_audit(${CUSTOMER_C}, jsonb_build_object('cnpj_cpf', '${CNPJ_NOVO}'), '${OPS}'::uuid, 'CNPJ corrigido pelo cartão CNPJ')`)}
      ${asOwner}
      SELECT cnpj_cpf FROM public.customers WHERE id = ${CUSTOMER_C};
      SELECT justification FROM public.audit_logs WHERE entity_type = 'customer' AND entity_id = '${CUSTOMER_C}' AND field_name = 'cnpj_cpf' ORDER BY id DESC LIMIT 1;
      ${as(OPS)}
      ${try_(`SELECT public.update_customer_with_audit(${CUSTOMER_A}, jsonb_build_object('cnpj_cpf', '${syntheticCnpj(42408)}'), '${OPS}'::uuid, 'Troca indevida')`)}
    `)
    expect(direct).toBe('42501')
    expect(viaFunction).toBe('ok')
    expect(stored).toBe(CNPJ_NOVO)
    expect(history).toBe('CNPJ corrigido pelo cartão CNPJ')
    expect(withPortal).toBe('42501')
  })

  it('428: bucket do Desbloqueio de CE aceita só PDF e DOCX de até 10 MB', () => {
    expect(psql(`SELECT concat_ws('|', file_size_limit, array_to_string(allowed_mime_types, ','))
      FROM storage.buckets WHERE id = 'ce-unlock-documents'`))
      .toBe('10485760|application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })
})
