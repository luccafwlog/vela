import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 426 (auditoria run-3, notas de endurecimento): reabertura de
// Dispute com teto e só da resolvida, Invoice reemitida sem a Dispute do
// Cliente anterior e sem oráculo de ids para a sessão do Portal.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const EQUIP = '41400000-0000-4000-8000-000000000001'
const PORTAL_A = '41400000-0000-4000-8000-000000000002'
const PORTAL_B = '41400000-0000-4000-8000-000000000003'
const CUSTOMER_A = 414001
const CUSTOMER_B = 414002
const CARRIER = 414010
const VESSEL = 414011
const VOYAGE = 414012
const BL = 'C414-BL'
const BL_TROCA = 'C414-BL-TROCA'
const INVOICE = 414020
const INVOICE_TROCA = 414021
const RESOLVIDA = 414030
const CANCELADA = 414031
const MESSAGE = 414040

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${EQUIP}'; ${sql}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function migration414Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('dispute_reopen_request' in prosrc) > 0 FROM pg_proc WHERE proname = 'portal_request_dispute_reopen';`) === 't'
  } catch {
    return false
  }
}

function as(sub: string, sql: string) {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated;
     SET LOCAL request.jwt.claims = '${JSON.stringify({ sub, role: 'authenticated', iat: Math.floor(Date.now() / 1000) + 60 })}';
     ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { status: result.status, out: (result.stdout ?? '').trim(), error: result.stderr ?? '' }
}

function sqlstate(error: string): string | undefined {
  return /ERROR:\s+([0-9A-Z]{5}):/.exec(error)?.[1]
}

function cleanup() {
  spawnPsql(['-X', '-q', '-d', databaseUrl, '-c', `
    SET session_replication_role = replica;
    DELETE FROM public.portal_rate_limits WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.demurrage_dispute_messages WHERE dispute_id IN (SELECT id FROM public.demurrage_disputes WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B}));
    DELETE FROM public.demurrage_disputes WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.demurrage_invoices WHERE bl_id IN ('${BL}', '${BL_TROCA}');
    DELETE FROM public.audit_logs WHERE entity_type = 'demurrage_invoice' AND entity_id IN ('${INVOICE}', '${INVOICE_TROCA}');
    DELETE FROM public.bls WHERE id IN ('${BL}', '${BL_TROCA}');
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.vessels WHERE id = ${VESSEL};
    DELETE FROM public.carriers WHERE id = ${CARRIER};
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.user_profiles WHERE id = '${EQUIP}';
    DELETE FROM auth.users WHERE id IN ('${EQUIP}', '${PORTAL_A}', '${PORTAL_B}');
  `], { encoding: 'utf8' })
}

const describeLocal = describeWithProbe(migration414Applied, 'migration414Applied (Disputas)')

describeLocal('426 — Disputas: reabertura, reemissão e sem oráculo de ids', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${EQUIP}', 'c414-equip@example.test'),
        ('${PORTAL_A}', 'c414-a@example.test'), ('${PORTAL_B}', 'c414-b@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${EQUIP}', 'Equipamentos C414', 'equipamentos', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${CUSTOMER_A}, '${syntheticCnpj(41401)}', 'Cliente C414 A'), (${CUSTOMER_B}, '${syntheticCnpj(41402)}', 'Cliente C414 B');
      UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL_A}', active = true, account_situation = 'ativo'
        WHERE customer_id = ${CUSTOMER_A};
      UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL_B}', active = true, account_situation = 'ativo'
        WHERE customer_id = ${CUSTOMER_B};
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier C414');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel C414', ${CARRIER});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'V414', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES
        ('${BL}', ${VOYAGE}, ${CUSTOMER_A}, 'CE414'), ('${BL_TROCA}', ${VOYAGE}, ${CUSTOMER_A}, 'CE414T');
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status) VALUES
        (${INVOICE}, 'DEM-C414', '${BL}', ${CUSTOMER_A}, 100, 'issued');
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status, dispute_open, dispute_status, dispute_reason, dispute_subject)
        VALUES (${INVOICE_TROCA}, 'DEM-C414-T', '${BL_TROCA}', ${CUSTOMER_A}, 100, 'issued', true, 'aberto', 'Motivo do Cliente A', 'Assunto do A');
      INSERT INTO public.demurrage_disputes (id, demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by) VALUES
        (${RESOLVIDA}, ${INVOICE}, ${CUSTOMER_A}, 'resolvida', 'ninguem', 'Resolvida C414', 'cliente'),
        (${CANCELADA}, ${INVOICE}, ${CUSTOMER_A}, 'cancelada', 'ninguem', 'Cancelada C414', 'cliente');
      INSERT INTO public.demurrage_dispute_messages (id, dispute_id, author_id, author_type, body, next_responder)
        VALUES (${MESSAGE}, ${RESOLVIDA}, '${PORTAL_A}', 'cliente', 'Mensagem C414', 'equipamentos');
    `)
  })

  afterAll(cleanup)

  it('pedido de reabertura do Portal tem o mesmo teto da abertura (3 em 30 min)', () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ok = as(PORTAL_A, `SELECT public.portal_request_dispute_reopen(${RESOLVIDA}, 'Pedido ${attempt}')`)
      expect(ok.error).toBe('')
    }
    const fourth = as(PORTAL_A, `SELECT public.portal_request_dispute_reopen(${RESOLVIDA}, 'Pedido 4')`)
    expect(sqlstate(fourth.error)).toBe('P0429')
    expect(psql(`SELECT count(*) FROM public.demurrage_dispute_messages WHERE dispute_id = ${RESOLVIDA} AND metadata->>'action' = 'reopen_request'`)).toBe('3')
  })

  it('Equipamentos só reabre a Dispute resolvida', () => {
    expect(sqlstate(as(EQUIP, `SELECT public.reopen_demurrage_dispute(${CANCELADA}, 'Reabrir cancelada')`).error)).toBe('22023')
    expect(psql(`SELECT state FROM public.demurrage_disputes WHERE id = ${CANCELADA}`)).toBe('cancelada')
    expect(as(EQUIP, `SELECT public.reopen_demurrage_dispute(${RESOLVIDA}, 'Reabrir resolvida')`).error).toBe('')
    expect(psql(`SELECT state FROM public.demurrage_disputes WHERE id = ${RESOLVIDA}`)).toBe('aberta')
  })

  it('Portal de outro Cliente recebe o mesmo erro para Dispute e mensagem alheias e inexistentes', () => {
    const foreignDispute = as(PORTAL_B, `SELECT public.portal_check_dispute_attachment_eligibility(${RESOLVIDA}, 100)`)
    const missingDispute = as(PORTAL_B, `SELECT public.portal_check_dispute_attachment_eligibility(${RESOLVIDA + 900}, 100)`)
    expect(sqlstate(foreignDispute.error)).toBe('P0002')
    expect(sqlstate(missingDispute.error)).toBe('P0002')

    const path = `${CUSTOMER_A}/disputes/${RESOLVIDA}/${MESSAGE}/a.pdf`
    const foreignMessage = as(PORTAL_B, `SELECT public.add_demurrage_dispute_attachment(${MESSAGE}, '${path}', 'a.pdf', 'application/pdf', 100)`)
    const missingMessage = as(PORTAL_B, `SELECT public.add_demurrage_dispute_attachment(${MESSAGE + 900}, '${path}', 'a.pdf', 'application/pdf', 100)`)
    expect(sqlstate(foreignMessage.error)).toBe('P0002')
    expect(foreignMessage.error.replace(/\d+/g, '')).toBe(missingMessage.error.replace(/\d+/g, ''))
  })

  it('Invoice reemitida para o novo Cliente nasce sem a Dispute do anterior', () => {
    psql(`UPDATE public.bls SET customer_id = ${CUSTOMER_B} WHERE id = '${BL_TROCA}'`)
    const reissued = psql(`SELECT concat_ws('|', dispute_open, coalesce(dispute_status, '-'), coalesce(dispute_reason, '-'), coalesce(dispute_subject, '-'))
      FROM public.demurrage_invoices WHERE bl_id = '${BL_TROCA}' AND customer_id = ${CUSTOMER_B}`)
    expect(reissued).toBe('f|-|-|-')
    expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${INVOICE_TROCA}`)).toBe('cancelled')
  })
})
