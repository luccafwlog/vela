// Migration 519 (ADR 0112, D9 e D10; lote 4 do plano da repaginação da
// Demurrage): a baixa grava o meio de pagamento (Pix Itaú, extrato, manual ou
// isenção), e `list_demurrage_invoice_details` devolve o ROE do pagamento, quem
// cancelou e por quê, e o destino de cada caixa da Invoice cancelada.
//
// Namespace exclusivo: ids 99519xxx, B/Ls 'R519-*', containers 'RQCU519xxxx',
// usuário ...000000519001. Uma Viagem por caso.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000519001'
const customerId = 99519001
const otherCustomerId = 99519002 // troca de CNPJ e caixa dividida (550)
const carrierId = 99519003
const vesselId = 99519004
const CASES = ['manual', 'itau', 'extrato', 'isencao', 'reversed', 'waiting', 'billed', 'reissued', 'soc', 'cnpj', 'split'] as const
type Case = typeof CASES[number]
const voyageOf = (name: Case) => 99519100 + CASES.indexOf(name)
const voyageIds = CASES.map(voyageOf).join(', ')
const blPrefix = 'R519-'
const blOf = (name: Case) => `${blPrefix}${name.toUpperCase()}`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function run(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
}

function asAdmin(sql: string): string {
  const result = run(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${adminId}';
    ${sql};
    COMMIT;`)
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? ''
}

const day = (offset: number) => `(now() AT TIME ZONE 'America/Sao_Paulo')::date + ${offset}`

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.list_demurrage_invoice_details(bigint[])') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 519 (list_demurrage_invoice_details)')

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r519_bls AS SELECT id FROM public.bls WHERE id LIKE '${blPrefix}%';
    CREATE TEMP TABLE r519_invoices AS SELECT id FROM public.demurrage_invoices WHERE bl_id IN (SELECT id FROM r519_bls);
    CREATE TEMP TABLE r519_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'demurrage_invoice' AND entity_id IN (SELECT id::text FROM r519_invoices))
         OR (entity_type = 'bl' AND entity_id IN (SELECT id FROM r519_bls))
         OR (entity_type = 'customer' AND entity_id IN ('${customerId}', '${otherCustomerId}'));
    CREATE TEMP TABLE r519_items AS SELECT id FROM public.alert_items
      WHERE alert_id IN (SELECT id FROM r519_alerts) OR metadata->>'bl_id' LIKE '${blPrefix}%';
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r519_items) OR alert_id IN (SELECT id FROM r519_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r519_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r519_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r519_items) OR alert_id IN (SELECT id FROM r519_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r519_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r519_alerts);
    DELETE FROM public.portal_notifications WHERE customer_id IN (${customerId}, ${otherCustomerId}) OR bl_id IN (SELECT id FROM r519_bls);
    DELETE FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'R519%';
    DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM r519_invoices);
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM r519_invoices);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM r519_invoices);
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM r519_invoices);
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM r519_invoices);
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM r519_invoices);
    DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM r519_invoices);
    DELETE FROM public.demurrage_box_waivers WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM r519_bls);
    -- 550: a troca de SOC e de Cliente recalcula as Taxas Locais do B/L.
    DELETE FROM public.bl_receivables WHERE bl_id IN (SELECT id FROM r519_bls) OR customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM r519_bls);
    DELETE FROM public.pricing_rule_versions WHERE version_key LIKE '%|customer:${customerId}|%' OR version_key LIKE '%|customer:${otherCustomerId}|%';
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM r519_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM r519_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id IN (SELECT id FROM r519_bls)
      OR (entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (SELECT id::text FROM r519_invoices));
    DELETE FROM public.voyages WHERE id IN (${voyageIds});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    SET session_replication_role = origin;
    SET vela.retention = 'on';
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.customers WHERE id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

/** B/L com uma caixa devolvida com sobreestadia e a Invoice emitida pela RPC real. */
function issued(name: Case, container: string): number {
  psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, ce_mercante, demurrage_roe_manual, demurrage_roe)
        VALUES ('${blOf(name)}', ${voyageOf(name)}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated',
                '9951900000${CASES.indexOf(name)}', true, 5.5)`)
  psql(`INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date, ownership)
        VALUES ('${blOf(name)}', '${container}', '40HC', ${day(-40)}, ${day(-5)}, 'COC')`)
  // 550: no caso SOC, a Invoice cobra duas caixas e uma delas passa a SOC.
  if (name === 'soc') {
    psql(`INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date, ownership)
          VALUES ('${blOf(name)}', 'RQCU5199901', '40HC', ${day(-40)}, ${day(-5)}, 'COC')`)
  }
  const result = JSON.parse(psql(`SET vela.demurrage_internal = 'on'; SELECT public.issue_demurrage_invoice_for_bl('${blOf(name)}')`)) as { status: string; invoice_id: number }
  expect(result.status).toBe('issued')
  return result.invoice_id
}

function brl(invoiceId: number) {
  return psql(`SELECT current_total_brl FROM public.demurrage_invoices WHERE id = ${invoiceId}`)
}

function method(invoiceId: number) {
  return psql(`SELECT COALESCE(payment_method, '-') FROM public.demurrage_invoices WHERE id = ${invoiceId}`)
}

type Destination = { kind: string; invoice_id: number | null; doc_number: string | null; containers: string[] }
type Detail = { invoice_id: number; payment_roe: string | null; cancel_reason: string | null; cancelled_by: string | null; box_destinations: Destination[] }

function details(invoiceId: number): Detail {
  const row = asAdmin(`SELECT row_to_json(d) FROM public.list_demurrage_invoice_details(ARRAY[${invoiceId}]::bigint[]) AS d`)
  return JSON.parse(row) as Detail
}

describeLocal('Meio de pagamento e destino das caixas da Demurrage (migration 519)', () => {
  const ids = {} as Record<Case, number>

  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r519-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R519 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${customerId}, '${syntheticCnpj(519001)}', 'R519 CLIENTE'),
        (${otherCustomerId}, '${syntheticCnpj(519002)}', 'R519 OUTRO CLIENTE');
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at) VALUES
        (${customerId}, 'Fixture R519: gate aberto para a Demurrage', '${adminId}', now() + interval '1 day'),
        (${otherCustomerId}, 'Fixture R519: gate aberto para a Demurrage', '${adminId}', now() + interval '1 day');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R519 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R519 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        ${CASES.map((name) => `(${voyageOf(name)}, ${vesselId}, 'R519-${name}', 'active')`).join(',\n        ')};
    `)
    CASES.forEach((name, index) => { ids[name] = issued(name, `RQCU519${String(index).padStart(4, '0')}`) })
  })

  afterAll(cleanup)

  describe('meio de pagamento (D9)', () => {
    it('baixa à mão, sem TXID, é manual e guarda o ROE do pagamento', () => {
      asAdmin(`SELECT public.register_demurrage_payment(gen_random_uuid(), ${ids.manual}, ${day(0)}, NULL, ${brl(ids.manual)}, NULL)`)
      expect(method(ids.manual)).toBe('manual')
      expect(Number(details(ids.manual).payment_roe)).toBe(5.5)
    })

    it('Pix recebido pelo Itaú é Pix Itaú', () => {
      psql(`INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status)
            VALUES ('R519E2E0001', 'R519TXIDITAU', ${brl(ids.itau)}, now(), 'received')`)
      asAdmin(`SELECT public.register_demurrage_payment(gen_random_uuid(), ${ids.itau}, ${day(0)}, 'R519E2E0001', ${brl(ids.itau)}, NULL)`)
      expect(method(ids.itau)).toBe('pix_itau')
    })

    it('conciliação pelo extrato é extrato', () => {
      asAdmin(`SELECT public.confirm_demurrage_pix_matches(jsonb_build_array(jsonb_build_object(
        'invoice_id', ${ids.extrato}, 'paid_at', ${day(0)}, 'pix_txid', 'R519EXTRATO01', 'total_brl', ${brl(ids.extrato)})))`)
      expect(method(ids.extrato)).toBe('extrato')
      // 548: a recusa da lista inválida chega à tela com acento.
      const refused = run(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated';
        SET LOCAL request.jwt.claim.sub = '${adminId}'; SELECT public.confirm_demurrage_pix_matches('{}'::jsonb); ROLLBACK;`)
      expect(refused.stderr).toContain('Lista de conciliação inválida.')
    })

    it('desconto integral é isenção', () => {
      asAdmin(`SELECT public.apply_demurrage_discount(gen_random_uuid(), ${ids.isencao}, 'percent', 100, 'comercial', 'Cliente isento por acordo comercial', NULL)`)
      expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${ids.isencao}`)).toBe('paid')
      expect(method(ids.isencao)).toBe('isencao')
    })

    it('estorno da baixa apaga o meio', () => {
      asAdmin(`SELECT public.register_demurrage_payment(gen_random_uuid(), ${ids.reversed}, ${day(0)}, NULL, ${brl(ids.reversed)}, NULL)`)
      expect(method(ids.reversed)).toBe('manual')
      asAdmin(`SELECT public.reverse_demurrage_payment(${ids.reversed}, 'Baixa registrada na Invoice errada')`)
      expect(method(ids.reversed)).toBe('-')
    })
  })

  describe('Invoice cancelada (D10)', () => {
    it('cancelada à mão: motivo, quem cancelou e a caixa aguardando; depois dispensada', () => {
      asAdmin(`SELECT public.cancel_demurrage_invoice(gen_random_uuid(), ${ids.waiting}, 'Valor combinado com o Cliente')`)
      const detail = details(ids.waiting)
      expect(detail.cancel_reason).toBe('Valor combinado com o Cliente')
      expect(detail.cancelled_by).toBe(adminId)
      expect(detail.box_destinations).toEqual([{ kind: 'aguardando', invoice_id: null, doc_number: null, containers: ['RQCU5190005'] }])

      asAdmin(`SELECT public.waive_demurrage_box('${blOf('waiting')}', 'RQCU5190005', 'Cliente isento por acordo comercial')`)
      expect(details(ids.waiting).box_destinations.map((item) => item.kind)).toEqual(['dispensada'])
    })

    it('cancelada e emitida de novo: cobrada na Invoice nova', () => {
      asAdmin(`SELECT public.cancel_demurrage_invoice(gen_random_uuid(), ${ids.billed}, 'Emitida antes da hora')`)
      const again = JSON.parse(psql(`SET vela.demurrage_internal = 'on'; SELECT public.issue_demurrage_invoice_for_bl('${blOf('billed')}')`)) as { invoice_id: number }
      const doc = psql(`SELECT doc_number FROM public.demurrage_invoices WHERE id = ${again.invoice_id}`)
      expect(details(ids.billed).box_destinations).toEqual([{ kind: 'cobrada', invoice_id: again.invoice_id, doc_number: doc, containers: ['RQCU5190006'] }])
    })

    it('datas alteradas: reemitida na Invoice que a substitui', () => {
      const containerId = psql(`SELECT id FROM public.bl_containers WHERE container_number = 'RQCU5190007'`)
      asAdmin(`SELECT public.set_container_dates(${containerId}, ${day(-40)}, ${day(-3)}, 'Devolução corrigida pelo terminal', false)`)
      expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${ids.reissued}`)).toBe('cancelled')
      const replacement = psql(`SELECT id || '|' || doc_number FROM public.demurrage_invoices WHERE replaces_invoice_id = ${ids.reissued}`).split('|')
      const detail = details(ids.reissued)
      expect(detail.cancel_reason).toBe('Datas de container alteradas: cancelada para reemissão automática.')
      expect(detail.box_destinations).toEqual([{ kind: 'reemitida', invoice_id: Number(replacement[0]), doc_number: replacement[1], containers: ['RQCU5190007'] }])
    })
  })

  describe('motivo pela causa e destino das caixas (550)', () => {
    const replacementOf = (invoiceId: number) => psql(`SELECT id || '|' || doc_number FROM public.demurrage_invoices
      WHERE status = 'issued' AND bl_id = (SELECT bl_id FROM public.demurrage_invoices WHERE id = ${invoiceId}) AND id <> ${invoiceId}
      ORDER BY id DESC LIMIT 1`).split('|')

    it('container que passa a SOC: o motivo diz SOC, a caixa SOC sai do destino e a outra é reemitida', () => {
      const socId = psql(`SELECT id FROM public.bl_containers WHERE container_number = 'RQCU5199901'`)
      asAdmin(`SELECT public.set_bl_container_ownership(${socId}, 'SOC', 'Container do embarcador, não do armador', '${adminId}')`)
      expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${ids.soc}`)).toBe('cancelled')
      const [replacementId, replacementDoc] = replacementOf(ids.soc)
      // A reemissão saiu sozinha: a cancelada pela causa nova não conta como à mão (530).
      expect(psql(`SELECT replaces_invoice_id FROM public.demurrage_invoices WHERE id = ${replacementId}`)).toBe(String(ids.soc))
      const detail = details(ids.soc)
      expect(detail.cancel_reason).toBe('Container passou a SOC: cancelada para reemissão automática.')
      expect(detail.box_destinations).toEqual([{ kind: 'reemitida', invoice_id: Number(replacementId), doc_number: replacementDoc, containers: ['RQCU5190008'] }])
    })

    it('troca de CNPJ do B/L: a caixa aparece reemitida na Invoice do Cliente novo', () => {
      asAdmin(`UPDATE public.bls SET customer_id = ${otherCustomerId} WHERE id = '${blOf('cnpj')}'`)
      expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${ids.cnpj}`)).toBe('cancelled')
      const [replacementId, replacementDoc] = replacementOf(ids.cnpj)
      expect(psql(`SELECT customer_id FROM public.demurrage_invoices WHERE id = ${replacementId}`)).toBe(String(otherCustomerId))
      const detail = details(ids.cnpj)
      expect(detail.cancel_reason).toMatch(/^Troca de CNPJ do B\/L R519-CNPJ/)
      expect(detail.box_destinations).toEqual([{ kind: 'reemitida', invoice_id: Number(replacementId), doc_number: replacementDoc, containers: ['RQCU5190009'] }])
    })

    it('caixa que passa a ser dividida com outro Cliente: o motivo diz a divisão (D22)', () => {
      psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, ce_mercante, demurrage_roe_manual, demurrage_roe)
            VALUES ('${blPrefix}SPLIT-B', ${voyageOf('split')}, ${otherCustomerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', '9951900099', true, 5.5)`)
      psql(`INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date, ownership)
            VALUES ('${blPrefix}SPLIT-B', 'RQCU5190010', '40HC', ${day(-40)}, ${day(-5)}, 'COC')`)
      expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${ids.split}`)).toBe('cancelled')
      const [replacementId] = replacementOf(ids.split)
      expect(psql(`SELECT box_share_count FROM public.demurrage_invoice_items WHERE invoice_id = ${replacementId}`)).toBe('2')
      const detail = details(ids.split)
      expect(detail.cancel_reason).toBe('Divisão do container entre Clientes alterada: cancelada para reemissão automática.')
      expect(detail.box_destinations.map((item) => item.kind)).toEqual(['reemitida'])
    })
  })

  it('Invoice em aberto não traz cancelamento nem destino', () => {
    const open = details(ids.reversed)
    expect(open.cancel_reason).toBeNull()
    expect(open.box_destinations).toEqual([])
  })
})
