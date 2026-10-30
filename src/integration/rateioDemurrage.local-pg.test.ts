// Migration 521 (ADR 0112, D19, D22 e D23; lote 8 do plano da repaginação da
// Demurrage): a caixa em B/Ls de Clientes diferentes na mesma Viagem é rateada
// em partes iguais, cada Cliente pela própria condição; a mudança do número de
// Clientes depois da emissão segue a regra das datas alteradas.
//
// Namespace exclusivo: ids 99521xxx, B/Ls 'R521-*', containers 'RQCU521xxxx',
// usuário ...000000521001. Uma Viagem por caso.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000521001'
const customerA = 99521001
const customerB = 99521002
const customerC = 99521003 // acordo de 40 dias
const customers = [customerA, customerB, customerC]
const carrierId = 99521010
const vesselId = 99521011
const CASES = ['split', 'agreement', 'arrives', 'paid', 'cancelled'] as const
type Case = typeof CASES[number]
const voyageOf = (name: Case) => 99521100 + CASES.indexOf(name)
const voyageIds = CASES.map(voyageOf).join(', ')
const blPrefix = 'R521-'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asAdmin(sql: string): string {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${adminId}';
    ${sql};
    COMMIT;`], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return (result.stdout ?? '').trim().split('\n').filter(Boolean).at(-1) ?? ''
}

const day = (offset: number) => `(now() AT TIME ZONE 'America/Sao_Paulo')::date + ${offset}`

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._demurrage_box_share_count(bigint,text,bigint)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 521 (rateio da caixa)')

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r521_bls AS SELECT id FROM public.bls WHERE id LIKE '${blPrefix}%';
    CREATE TEMP TABLE r521_invoices AS SELECT id FROM public.demurrage_invoices WHERE bl_id IN (SELECT id FROM r521_bls);
    CREATE TEMP TABLE r521_effects AS SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM r521_bls);
    CREATE TEMP TABLE r521_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'demurrage_invoice' AND entity_id IN (SELECT id::text FROM r521_invoices))
         OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM r521_effects))
         OR (entity_type = 'bl' AND entity_id IN (SELECT id FROM r521_bls))
         OR (entity_type = 'customer' AND entity_id IN (${customers.map((id) => `'${id}'`).join(', ')}));
    CREATE TEMP TABLE r521_items AS SELECT id FROM public.alert_items
      WHERE alert_id IN (SELECT id FROM r521_alerts) OR metadata->>'bl_id' LIKE '${blPrefix}%';
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r521_items) OR alert_id IN (SELECT id FROM r521_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r521_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r521_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r521_items) OR alert_id IN (SELECT id FROM r521_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r521_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r521_alerts);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM r521_effects);
    DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM r521_effects);
    DELETE FROM public.portal_notifications WHERE customer_id IN (${customers.join(', ')}) OR bl_id IN (SELECT id FROM r521_bls);
    DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM r521_invoices);
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM r521_invoices);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM r521_invoices);
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM r521_invoices);
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM r521_invoices);
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM r521_invoices);
    DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM r521_invoices);
    DELETE FROM public.demurrage_box_waivers WHERE customer_id IN (${customers.join(', ')});
    DELETE FROM public.customer_demurrage_agreements WHERE customer_id IN (${customers.join(', ')});
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM r521_bls);
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM r521_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM r521_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id IN (SELECT id FROM r521_bls)
      OR (entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (SELECT id::text FROM r521_invoices));
    DELETE FROM public.voyages WHERE id IN (${voyageIds});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    SET session_replication_role = origin;
    SET vela.retention = 'on';
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${customers.join(', ')});
    DELETE FROM public.customers WHERE id IN (${customers.join(', ')});
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

let tableFree = 21
let p1 = 60
let p2 = 80
let p1To = 30

/** US$ cheio da caixa com `days` dias, pela tarifa de 40' dry carregada no banco. */
function fullUsd(days: number, free = tableFree) {
  const daysP1 = Math.max(0, Math.min(days, p1To) - free)
  const daysP2 = Math.max(0, days - Math.max(p1To + 1, free + 1) + 1)
  return daysP1 * p1 + daysP2 * p2
}

function bl(id: string, voyage: Case, customer: number) {
  psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, ce_mercante, demurrage_roe_manual, demurrage_roe)
        VALUES ('${blPrefix}${id}', ${voyageOf(voyage)}, ${customer}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', 'CE521${id}', true, 5.5)`)
}

function box(blId: string, number: string, discharge = 65, returned = 5) {
  psql(`INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date, ownership)
        VALUES ('${blPrefix}${blId}', '${number}', '40HC', ${day(-discharge)}, ${day(-returned)}, 'COC')`)
}

function issue(blId: string): number {
  const result = JSON.parse(psql(`SET vela.demurrage_internal = 'on'; SELECT public.issue_demurrage_invoice_for_bl('${blPrefix}${blId}')`)) as { status: string; invoice_id: number }
  expect(result.status, blId).toBe('issued')
  return result.invoice_id
}

function item(invoiceId: number) {
  const [share, subtotal] = psql(`SELECT coalesce(box_share_count::text, '') || '|' || subtotal_usd FROM public.demurrage_invoice_items WHERE invoice_id = ${invoiceId}`).split('|')
  return { share, subtotal: Number(subtotal) }
}

function liveInvoice(blId: string) {
  return psql(`SELECT id || '|' || status || '|' || coalesce(replaces_invoice_id::text, '') FROM public.demurrage_invoices WHERE bl_id = '${blPrefix}${blId}' AND status IN ('issued', 'paid') ORDER BY id DESC LIMIT 1`).split('|')
}

describeLocal('Caixa dividida entre Clientes (migration 521)', () => {
  beforeAll(() => {
    cleanup()
    const rate = psql(`SELECT free_days || ',' || p1_usd || ',' || p2_usd || ',' || p1_day_to FROM public.demurrage_rates WHERE container_type = '40GP' AND active ORDER BY valid_from DESC LIMIT 1`).split(',')
    ;[tableFree, p1, p2, p1To] = rate.map(Number)
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r521-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R521 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${customerA}, '${syntheticCnpj(521001)}', 'R521 CLIENTE A'),
        (${customerB}, '${syntheticCnpj(521002)}', 'R521 CLIENTE B'),
        (${customerC}, '${syntheticCnpj(521003)}', 'R521 CLIENTE C');
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      SELECT id, 'Fixture R521: gate aberto para a Demurrage', '${adminId}', now() + interval '1 day' FROM public.customers WHERE id IN (${customers.join(', ')});
      INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, valid_from, active, notes)
      VALUES (${customerC}, 40, '2026-01-01', true, 'R521 acordo de 40 dias');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R521 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R521 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        ${CASES.map((name) => `(${voyageOf(name)}, ${vesselId}, 'R521-${name}', 'active')`).join(',\n        ')};
    `)
  })

  afterAll(cleanup)

  it('QV-18A e QV-18B: mesma caixa, Clientes diferentes, mesma condição — metade para cada (D19)', () => {
    bl('18A', 'split', customerA); box('18A', 'RQCU5210001')
    bl('18B', 'split', customerB); box('18B', 'RQCU5210001')
    const half = Math.round((fullUsd(60) / 2) * 100) / 100
    for (const id of ['18A', '18B']) {
      expect(item(issue(id))).toEqual({ share: '2', subtotal: half })
    }
    const board = JSON.parse(asAdmin(`SELECT public.list_demurrage_billing_board(NULL, ${voyageOf('split')})`)) as unknown[]
    expect(board).toEqual([])
  })

  it('cada Cliente pela própria condição: o do acordo de 40 dias paga a metade da conta com 40 dias (D23)', () => {
    bl('AGRC', 'agreement', customerC); box('AGRC', 'RQCU5210002')
    bl('AGRB', 'agreement', customerB); box('AGRB', 'RQCU5210002')
    expect(item(issue('AGRC')).subtotal).toBe(Math.round((fullUsd(60, 40) / 2) * 100) / 100)
    expect(item(issue('AGRB')).subtotal).toBe(Math.round((fullUsd(60) / 2) * 100) / 100)
  })

  it('a Invoice cheia sem pagamento é cancelada e reemitida pela metade quando chega o B/L do outro Cliente (D22)', () => {
    bl('ARRA', 'arrives', customerA); box('ARRA', 'RQCU5210003')
    const first = issue('ARRA')
    expect(item(first)).toEqual({ share: '1', subtotal: fullUsd(60) })
    bl('ARRB', 'arrives', customerB); box('ARRB', 'RQCU5210003')
    expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${first}`)).toBe('cancelled')
    const [replacement, status, replaces] = liveInvoice('ARRA')
    expect([status, replaces]).toEqual(['issued', String(first)])
    expect(item(Number(replacement))).toEqual({ share: '2', subtotal: Math.round((fullUsd(60) / 2) * 100) / 100 })
  })

  it('a Invoice paga fica fora da Régua com o Alerta da divisão (D22)', () => {
    bl('PAIDA', 'paid', customerA); box('PAIDA', 'RQCU5210004')
    const paid = issue('PAIDA')
    const brl = psql(`SELECT current_total_brl FROM public.demurrage_invoices WHERE id = ${paid}`)
    asAdmin(`SELECT public.register_demurrage_payment(gen_random_uuid(), ${paid}, ${day(0)}, NULL, ${brl}, NULL)`)
    bl('PAIDB', 'paid', customerB); box('PAIDB', 'RQCU5210004')
    expect(psql(`SELECT status || '|' || dunning_suspended_reason FROM public.demurrage_invoices WHERE id = ${paid}`))
      .toBe('paid|Datas de container alteradas depois do pagamento; conferir a diferença.')
    expect(psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'demurrage_invoice_dates_changed' AND i.status = 'active' AND a.entity_id = '${paid}'`))
      .toMatch(/^A divisão das caixas entre Clientes da Invoice de Demurrage .* mudou depois da emissão e ela já tem pagamento/)
  })

  it('o B/L cancelado de um dos Clientes devolve a caixa inteira ao outro (D22)', () => {
    bl('CANA', 'cancelled', customerA); box('CANA', 'RQCU5210005')
    bl('CANB', 'cancelled', customerB); box('CANB', 'RQCU5210005')
    const half = issue('CANA')
    expect(item(half).share).toBe('2')
    // B/L com sobreestadia sem Invoice só se cancela com a cobrança dispensada (517).
    asAdmin(`SELECT public.waive_demurrage_box('${blPrefix}CANB', 'RQCU5210005', 'B/L substituído antes da cobrança')`)
    expect(JSON.parse(asAdmin(`SELECT public.cancel_bl('${blPrefix}CANB', 'B/L emitido em duplicidade', false)`)).cancelled).toBe(true)
    expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${half}`)).toBe('cancelled')
    const [replacement] = liveInvoice('CANA')
    expect(item(Number(replacement))).toEqual({ share: '1', subtotal: fullUsd(60) })
  })
})
