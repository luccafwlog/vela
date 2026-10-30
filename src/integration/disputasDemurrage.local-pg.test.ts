// Migration 520 (ADR 0112, D15 a D18; lote 7 do plano da repaginação da
// Demurrage): a Invoice cancelada cancela a Disputa aberta, o Portal não abre
// Disputa nova depois da resolvida, a reabertura recusa Invoice cancelada e a
// Disputa que espera Equipamentos vence em 1 dia útil, com Alerta.
//
// Namespace exclusivo: ids 520xxx, B/Ls 'R520-*', usuários ...520000...
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN = '52000000-0000-4000-8000-000000000001'
const EQUIP = '52000000-0000-4000-8000-000000000002'
const PORTAL = '52000000-0000-4000-8000-000000000003'
const CUSTOMER = 520001
const CARRIER = 520010
const VESSEL = 520011
const VOYAGE = 520012
const INV_CANCEL = 520020
const INV_RESOLVED = 520021
const INV_LATE = 520022
const INV_PAID = 520023
const DISP_CANCEL = 520030
const DISP_RESOLVED = 520031
const DISP_LATE = 520032
const DISP_PAID = 520033
const INVOICES = [INV_CANCEL, INV_RESOLVED, INV_LATE, INV_PAID]

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function as(sub: string, sql: string) {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated;
     SET LOCAL request.jwt.claims = '${JSON.stringify({ sub, role: 'authenticated', iat: Math.floor(Date.now() / 1000) + 60 })}';
     SET LOCAL request.jwt.claim.sub = '${sub}';
     ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { status: result.status, out: (result.stdout ?? '').trim(), error: result.stderr ?? '' }
}

function sqlstate(error: string): string | undefined {
  return /ERROR:\s+([0-9A-Z]{5}):/.exec(error)?.[1]
}

function migrationApplied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._demurrage_dispute_due_at(timestamptz)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

function cleanup() {
  spawnPsql(['-X', '-q', '-d', databaseUrl, '-c', `
    SET session_replication_role = replica;
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id IN (${INVOICES.map((id) => `'${id}'`).join(', ')}));
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id IN (${INVOICES.map((id) => `'${id}'`).join(', ')}));
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'demurrage_invoice' AND entity_id IN (${INVOICES.map((id) => `'${id}'`).join(', ')}));
    DELETE FROM public.alerts WHERE entity_type = 'demurrage_invoice' AND entity_id IN (${INVOICES.map((id) => `'${id}'`).join(', ')});
    DELETE FROM public.portal_notifications WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.portal_rate_limits WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.demurrage_dispute_messages WHERE dispute_id IN (SELECT id FROM public.demurrage_disputes WHERE customer_id = ${CUSTOMER});
    DELETE FROM public.demurrage_disputes WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (${INVOICES.join(', ')});
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (${INVOICES.join(', ')});
    DELETE FROM public.demurrage_invoices WHERE id IN (${INVOICES.join(', ')});
    DELETE FROM public.audit_logs WHERE entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (${INVOICES.map((id) => `'${id}'`).join(', ')});
    DELETE FROM public.audit_logs WHERE changed_by IN ('${ADMIN}', '${EQUIP}');
    DELETE FROM public.bls WHERE id LIKE 'R520-%';
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.vessels WHERE id = ${VESSEL};
    DELETE FROM public.carriers WHERE id = ${CARRIER};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN}', '${EQUIP}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN}', '${EQUIP}', '${PORTAL}');
  `], { encoding: 'utf8' })
}

function activeAlert(type: string, invoiceId: number) {
  return psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND i.status = 'active' AND a.entity_type = 'demurrage_invoice' AND a.entity_id = '${invoiceId}'`)
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 520 (Disputas de Demurrage)')

describeLocal('520 — Disputas de Demurrage', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'r520-admin@example.test'), ('${EQUIP}', 'r520-equip@example.test'), ('${PORTAL}', 'r520-portal@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN}', 'R520 Administrativo', 'administrativo', true), ('${EQUIP}', 'R520 Equipamentos', 'equipamentos', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${syntheticCnpj(52001)}', 'Cliente R520');
      UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL}', active = true, account_situation = 'ativo' WHERE customer_id = ${CUSTOMER};
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier R520');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel R520', ${CARRIER});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'V520', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES
        ('R520-A', ${VOYAGE}, ${CUSTOMER}, 'CE520A'), ('R520-B', ${VOYAGE}, ${CUSTOMER}, 'CE520B'),
        ('R520-C', ${VOYAGE}, ${CUSTOMER}, 'CE520C'), ('R520-D', ${VOYAGE}, ${CUSTOMER}, 'CE520D');
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status, dispute_open, dispute_status) VALUES
        (${INV_CANCEL}, 'DEM-R520-1', 'R520-A', ${CUSTOMER}, 100, 'issued', true, 'aberto'),
        (${INV_RESOLVED}, 'DEM-R520-2', 'R520-B', ${CUSTOMER}, 100, 'issued', false, 'resolvido'),
        (${INV_LATE}, 'DEM-R520-3', 'R520-C', ${CUSTOMER}, 100, 'issued', true, 'aberto'),
        (${INV_PAID}, 'DEM-R520-4', 'R520-D', ${CUSTOMER}, 100, 'issued', false, 'resolvido');
      INSERT INTO public.demurrage_disputes (id, demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by, created_at) VALUES
        (${DISP_CANCEL}, ${INV_CANCEL}, ${CUSTOMER}, 'aberta', 'equipamentos', 'Cancelar junto', 'cliente', now()),
        (${DISP_RESOLVED}, ${INV_RESOLVED}, ${CUSTOMER}, 'resolvida', 'ninguem', 'Resolvida', 'cliente', now()),
        (${DISP_LATE}, ${INV_LATE}, ${CUSTOMER}, 'aberta', 'equipamentos', 'Sem resposta', 'cliente', now() - interval '10 days'),
        (${DISP_PAID}, ${INV_PAID}, ${CUSTOMER}, 'resolvida', 'ninguem', 'Resolvida, Invoice cancelada', 'cliente', now());
      INSERT INTO public.demurrage_dispute_messages (dispute_id, author_id, author_type, body, next_responder, created_at) VALUES
        (${DISP_LATE}, '${EQUIP}', 'equipamentos', 'Pedimos o comprovante.', 'cliente', now() - interval '10 days'),
        (${DISP_LATE}, '${PORTAL}', 'cliente', 'Segue o comprovante.', 'equipamentos', now() - interval '6 days'),
        (${DISP_LATE}, '${PORTAL}', 'cliente', 'Alguma novidade?', 'equipamentos', now() - interval '5 days');
    `)
  })

  afterAll(cleanup)

  describe('Invoice cancelada (D16)', () => {
    it('cancelar a Invoice cancela a Disputa aberta, com a mensagem e o aviso ao Cliente', () => {
      psql(`SELECT public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', '${INV_CANCEL}', 'Disputa R520', 'teste', 'equipamentos', '{}'::jsonb, '/demurrage')`)
      expect(activeAlert('portal_dispute_opened', INV_CANCEL)).toBe('1')
      const cancelled = as(ADMIN, `SELECT public.cancel_demurrage_invoice(gen_random_uuid(), ${INV_CANCEL}, 'Valor errado na emissão')`)
      expect(cancelled.error).toBe('')
      expect(psql(`SELECT state || '|' || next_responder || '|' || (cancelled_at IS NOT NULL) FROM public.demurrage_disputes WHERE id = ${DISP_CANCEL}`)).toBe('cancelada|ninguem|true')
      expect(psql(`SELECT coalesce(dispute_open, false) || '|' || dispute_status FROM public.demurrage_invoices WHERE id = ${INV_CANCEL}`)).toBe('false|cancelado')
      expect(psql(`SELECT author_type || '|' || body FROM public.demurrage_dispute_messages WHERE dispute_id = ${DISP_CANCEL} ORDER BY id DESC LIMIT 1`))
        .toBe('sistema|A Invoice DEM-R520-1 foi cancelada e esta disputa foi encerrada junto. Motivo: Valor errado na emissão')
      expect(psql(`SELECT title || '|' || message || '|' || link FROM public.portal_notifications WHERE customer_id = ${CUSTOMER} AND type = 'dispute_cancelled'`))
        .toBe(`Disputa encerrada|A Invoice de Demurrage DEM-R520-1 foi cancelada e a disputa foi encerrada. Motivo: Valor errado na emissão|/portal/billing?tab=demurrage&disputas=1&disputa=${DISP_CANCEL}`)
      expect(activeAlert('portal_dispute_opened', INV_CANCEL)).toBe('0')
    })
  })

  describe('Uma conversa por Invoice (D17)', () => {
    it('o Portal recusa Disputa nova depois da resolvida e indica a reabertura', () => {
      const refused = as(PORTAL, `SELECT public.portal_add_dispute_message(${INV_RESOLVED}, 'Discordo de novo')`)
      expect(sqlstate(refused.error)).toBe('22023')
      expect(refused.error).toContain('Solicitar reabertura')
      expect(psql(`SELECT count(*) FROM public.demurrage_disputes WHERE demurrage_invoice_id = ${INV_RESOLVED}`)).toBe('1')
    })

    it('reabrir recusa a Disputa de Invoice cancelada', () => {
      psql(`SET session_replication_role = replica; UPDATE public.demurrage_invoices SET status = 'cancelled' WHERE id = ${INV_PAID}`)
      const refused = as(EQUIP, `SELECT public.reopen_demurrage_dispute(${DISP_PAID}, 'Cliente trouxe fato novo')`)
      expect(sqlstate(refused.error)).toBe('22023')
      expect(refused.error).toContain('está cancelada')
      expect(psql(`SELECT state FROM public.demurrage_disputes WHERE id = ${DISP_PAID}`)).toBe('resolvida')
    })
  })

  describe('Prazo de 1 dia útil (D18)', () => {
    it('sexta 17h vence segunda 17h; véspera de feriado pula o feriado e o fim de semana', () => {
      const due = (since: string) => psql(`SELECT to_char(public._demurrage_dispute_due_at('${since}'::timestamptz) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')`)
      expect(due('2026-10-23 17:00-03')).toBe('2026-10-26 17:00')
      expect(due('2026-12-24 10:00-03')).toBe('2026-12-28 10:00')
    })

    it('espera desde a primeira mensagem do Cliente depois da nossa última', () => {
      expect(psql(`SELECT public._demurrage_dispute_waiting_since(${DISP_LATE}) = (SELECT min(created_at) FROM public.demurrage_dispute_messages WHERE dispute_id = ${DISP_LATE} AND author_type = 'cliente')`)).toBe('t')
    })

    it('vencido, abre o Alerta para Equipamentos; a resposta da equipe fecha', () => {
      psql(`SELECT public.reconcile_demurrage_dispute_deadline_alerts(NULL, 'teste-r520')`)
      expect(activeAlert('demurrage_disputa_prazo', INV_LATE)).toBe('1')
      expect(psql(`SELECT i.department FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'demurrage_disputa_prazo' AND i.status = 'active' AND a.entity_id = '${INV_LATE}'`)).toBe('equipamentos')

      const list = JSON.parse(as(EQUIP, `SELECT public.list_demurrage_disputes_internal(NULL)`).out) as Array<{ id: number; overdue: boolean; invoice_status: string }>
      const ours = list.filter((row) => [DISP_CANCEL, DISP_RESOLVED, DISP_LATE].includes(row.id))
      expect(ours[0]).toMatchObject({ id: DISP_LATE, overdue: true, invoice_status: 'issued' })
      expect(ours.find((row) => row.id === DISP_CANCEL)?.invoice_status).toBe('cancelled')

      const replied = as(EQUIP, `SELECT public.add_demurrage_dispute_message(${DISP_LATE}, 'Recebemos; analisando.', 'cliente')`)
      expect(replied.error).toBe('')
      expect(activeAlert('demurrage_disputa_prazo', INV_LATE)).toBe('0')
    })
  })
})
