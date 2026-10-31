// Migration 522 (ADR 0112, D20; lote 9 do plano da repaginação da Demurrage):
// o container que vira SOC depois de faturado segue a regra das datas
// alteradas: a Invoice sem pagamento é reemitida sem a caixa, e a paga sai da
// Régua com Alerta.
//
// Namespace exclusivo: ids 99522xxx, B/Ls 'R522-*', containers 'RQCU522xxxx',
// usuário ...000000522001. Uma Viagem por caso.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000522001'
const customerA = 99522001
const customerB = 99522002
const customerC = 99522003 // acordo de 40 dias
const customers = [customerA, customerB, customerC]
const carrierId = 99522010
const vesselId = 99522011
const CASES = ['reissue', 'paid'] as const
type Case = typeof CASES[number]
const voyageOf = (name: Case) => 99522100 + CASES.indexOf(name)
const voyageIds = CASES.map(voyageOf).join(', ')
const blPrefix = 'R522-'

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
    return psql(`SELECT position('passou a SOC' in prosrc) > 0 FROM pg_proc WHERE proname = '_reconcile_demurrage_after_dates'`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 522 (SOC depois de faturado)')

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r522_bls AS SELECT id FROM public.bls WHERE id LIKE '${blPrefix}%';
    CREATE TEMP TABLE r522_invoices AS SELECT id FROM public.demurrage_invoices WHERE bl_id IN (SELECT id FROM r522_bls);
    CREATE TEMP TABLE r522_effects AS SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM r522_bls);
    CREATE TEMP TABLE r522_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'demurrage_invoice' AND entity_id IN (SELECT id::text FROM r522_invoices))
         OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM r522_effects))
         OR (entity_type = 'bl' AND entity_id IN (SELECT id FROM r522_bls))
         OR (entity_type = 'customer' AND entity_id IN (${customers.map((id) => `'${id}'`).join(', ')}));
    CREATE TEMP TABLE r522_items AS SELECT id FROM public.alert_items
      WHERE alert_id IN (SELECT id FROM r522_alerts) OR metadata->>'bl_id' LIKE '${blPrefix}%';
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r522_items) OR alert_id IN (SELECT id FROM r522_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r522_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r522_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r522_items) OR alert_id IN (SELECT id FROM r522_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r522_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r522_alerts);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM r522_effects);
    DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM r522_effects);
    DELETE FROM public.portal_notifications WHERE customer_id IN (${customers.join(', ')}) OR bl_id IN (SELECT id FROM r522_bls);
    DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM r522_invoices);
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM r522_invoices);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM r522_invoices);
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM r522_invoices);
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM r522_invoices);
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM r522_invoices);
    DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM r522_invoices);
    DELETE FROM public.demurrage_box_waivers WHERE customer_id IN (${customers.join(', ')});
    DELETE FROM public.customer_demurrage_agreements WHERE customer_id IN (${customers.join(', ')});
    -- A troca SOC/COC recalcula as taxas locais do B/L (recebíveis e cálculos).
    DELETE FROM public.bl_receivables WHERE bl_id IN (SELECT id FROM r522_bls) OR customer_id IN (${customers.join(', ')});
    DELETE FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM r522_bls);
    DELETE FROM public.pricing_rule_versions WHERE ${customers.map((id) => `version_key LIKE '%|customer:${id}|%'`).join(' OR ')};
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM r522_bls);
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM r522_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM r522_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id IN (SELECT id FROM r522_bls)
      OR (entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (SELECT id::text FROM r522_invoices));
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

function bl(id: string, voyage: Case, customer: number) {
  psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, ce_mercante, demurrage_roe_manual, demurrage_roe)
        VALUES ('${blPrefix}${id}', ${voyageOf(voyage)}, ${customer}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', 'CE522${id}', true, 5.5)`)
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

function liveInvoice(blId: string) {
  return psql(`SELECT id || '|' || status || '|' || coalesce(replaces_invoice_id::text, '') FROM public.demurrage_invoices WHERE bl_id = '${blPrefix}${blId}' AND status IN ('issued', 'paid') ORDER BY id DESC LIMIT 1`).split('|')
}

describeLocal('Caixa dividida entre Clientes (migration 522)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r522-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R522 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${customerA}, '${syntheticCnpj(522001)}', 'R522 CLIENTE A'),
        (${customerB}, '${syntheticCnpj(522002)}', 'R522 CLIENTE B'),
        (${customerC}, '${syntheticCnpj(522003)}', 'R522 CLIENTE C');
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      SELECT id, 'Fixture R522: gate aberto para a Demurrage', '${adminId}', now() + interval '1 day' FROM public.customers WHERE id IN (${customers.join(', ')});
      INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, valid_from, active, notes)
      VALUES (${customerC}, 40, '2026-01-01', true, 'R522 acordo de 40 dias');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R522 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R522 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        ${CASES.map((name) => `(${voyageOf(name)}, ${vesselId}, 'R522-${name}', 'active')`).join(',\n        ')};
    `)
  })

  afterAll(cleanup)

  function containerId(number: string) {
    return psql(`SELECT id FROM public.bl_containers WHERE container_number = '${number}' AND bl_id LIKE '${blPrefix}%'`)
  }

  function toSoc(number: string) {
    asAdmin(`SELECT public.set_bl_container_ownership(${containerId(number)}, 'SOC', 'Container do Cliente, confirmado no Baplie')`)
  }

  it('QV-06B: faturado e depois SOC, a Invoice sem pagamento é reemitida sem a caixa', () => {
    bl('06B', 'reissue', customerA); box('06B', 'RQCU5220001'); box('06B', 'RQCU5220002')
    const first = issue('06B')
    expect(psql(`SELECT count(*) FROM public.demurrage_invoice_items WHERE invoice_id = ${first}`)).toBe('2')
    toSoc('RQCU5220002')
    expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${first}`)).toBe('cancelled')
    const [replacement, status, replaces] = liveInvoice('06B')
    expect([status, replaces]).toEqual(['issued', String(first)])
    expect(psql(`SELECT string_agg(container_number, ',') FROM public.demurrage_invoice_items WHERE invoice_id = ${replacement}`)).toBe('RQCU5220001')
    // A caixa que virou SOC não é cobrança perdida: nenhum Alerta fica aberto.
    expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'demurrage_invoice_dates_changed' AND i.status = 'active' AND a.entity_id = '${first}'`)).toBe('0')
  })

  it('555: o Portal recebe a causa da reemissão em código, sem o motivo interno', () => {
    const replacement = liveInvoice('06B')[0]
    const detail = JSON.parse(psql(`SELECT public._portal_get_demurrage_invoice_detail_core(${customerA}, ${replacement})`)) as { invoice: Record<string, unknown> }
    expect(detail.invoice.replaces_doc_number).toBeTruthy()
    expect(detail.invoice.replaces_cause).toBe('soc')
    expect(JSON.stringify(detail)).not.toMatch(/cancelada para reemissão/)
  })

  it('555: cada motivo de reemissão automática vira um código; o resto, nenhum', () => {
    // Ids negativos: não existem em demurrage_invoices; as linhas saem no fim.
    const reasons = [
      'Datas de container alteradas: cancelada para reemissão automática.',
      'Container passou a SOC: cancelada para reemissão automática.',
      'Divisão da caixa entre Clientes alterada: cancelada para reemissão automática.',
      'Troca de CNPJ do B/L R522-X: cancelada.',
      'Cliente pediu cancelamento por telefone.',
    ]
    try {
      reasons.forEach((reason, index) => psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, justification)
        VALUES ('demurrage_invoice', '-9952290${index}', 'status', 'issued', 'cancelled', '${reason}')`))
      expect(reasons.map((_, index) => psql(`SELECT coalesce(public._demurrage_replaced_cause(-9952290${index}), '-')`)))
        .toEqual(['datas', 'soc', 'divisao', '-', '-'])
      expect(psql(`SELECT coalesce(public._demurrage_replaced_cause(-99522999), '-')`)).toBe('-')
    } finally {
      psql(`DELETE FROM public.audit_logs WHERE entity_type = 'demurrage_invoice' AND entity_id LIKE '-995229%'`)
    }
  })

  it('a versão paga fica fora da Régua com o Alerta da caixa SOC', () => {
    bl('PAID', 'paid', customerA); box('PAID', 'RQCU5220003')
    const paid = issue('PAID')
    const brl = psql(`SELECT current_total_brl FROM public.demurrage_invoices WHERE id = ${paid}`)
    asAdmin(`SELECT public.register_demurrage_payment(gen_random_uuid(), ${paid}, ${day(0)}, NULL, ${brl}, NULL)`)
    toSoc('RQCU5220003')
    expect(psql(`SELECT status || '|' || dunning_suspended_reason FROM public.demurrage_invoices WHERE id = ${paid}`))
      .toBe('paid|Container passou a SOC depois do pagamento; conferir a diferença.')
    expect(psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'demurrage_invoice_dates_changed' AND i.status = 'active' AND a.entity_id = '${paid}'`))
      .toMatch(/^Container da Invoice de Demurrage .* passou a SOC depois da emissão e sai da cobrança e ela já tem pagamento/)
  })
})
