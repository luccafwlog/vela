import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

// Migration 128 (ADR 0077, decisões de 2026-10-02): toda correção do B/L —
// alteração direta, reimportação ou Baplie — é tratada no fim da transação.
// Sem pagamento reemite; com pagamento abate o saldo e restitui o excedente.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000128001'
const customerId = 99212801
const otherCustomerId = 99212809
const carrierId = 99212802
const vesselId = 99212803
const voyageId = 99212804
const chargeTableId = 99212805
const perContainerItem = 99212806
const dropOffItem = 99212807
const prefix = 'R128-'
const bl = {
  soc: 'R128-BL-SOC',
  pairA: 'R128-BL-PA',
  pairB: 'R128-BL-PB',
  partial: 'R128-BL-PP',
  full: 'R128-BL-PF',
  more: 'R128-BL-PM',
  moveA: 'R128-BL-MA',
  moveB: 'R128-BL-MB',
  vehicle: 'R128-BL-VH',
  vehicleB: 'R128-BL-VB',
  baplie: 'R128-BL-BP',
}
const allBls = Object.values(bl)

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`], { encoding: 'utf8' }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regproc('public.process_invoice_basis_changes') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = migrationApplied() ? describe : describe.skip

function asAdmin(sql: string) {
  return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${actorId}';
    ${sql};
    COMMIT;
  `], { encoding: 'utf8' })
}

function adminJson<T>(sql: string): T {
  const result = asAdmin(sql)
  expect(result.status, result.stderr).toBe(0)
  const line = result.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('[')).at(-1)
  return JSON.parse(line ?? '{}') as T
}

function issueByCe(blId: string, ce: string) {
  const result = asAdmin(`DO $$ BEGIN PERFORM public.apply_ce_mercante_update('${blId}', '${ce}', '${actorId}'::uuid); END $$`)
  expect(result.status, result.stderr).toBe(0)
  return Number(psql(`SELECT id FROM public.invoices WHERE bl_id = '${blId}' AND status = 'issued' AND invoice_type = 'individual'`))
}

function receivableId(blId: string) {
  return Number(psql(`SELECT id FROM public.bl_receivables WHERE bl_id = '${blId}' AND source = 'local_charges'`))
}

function consolidate(blIds: string[]) {
  return adminJson<{ invoice_id: number }>(
    `SELECT public.create_local_consolidated_invoice(${customerId}, ARRAY[${blIds.map(receivableId).join(',')}]::bigint[], NULL, '${actorId}'::uuid)`,
  ).invoice_id
}

function successor(invoiceId: number) {
  return psql(`SELECT coalesce(string_agg(id || '|' || total_brl || '|' || status, ','), '') FROM public.invoices WHERE replaces_invoice_id = ${invoiceId}`)
}

function activeAlerts(type: string, invoiceId: number) {
  return psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
    WHERE ai.item_type = '${type}' AND ai.status = 'active' AND a.entity_type = 'invoice' AND a.entity_id = '${invoiceId}'`)
}

function cleanup() {
  const bls = `ARRAY['${allBls.join("','")}']::text[]`
  const invoices = `(SELECT id FROM public.invoices WHERE customer_id IN (${customerId}, ${otherCustomerId}))`
  const invoiceKeys = `(SELECT id::text FROM public.invoices WHERE customer_id IN (${customerId}, ${otherCustomerId}))`
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT ai.id FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE a.entity_type = 'invoice' AND a.entity_id IN ${invoiceKeys});
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'invoice' AND entity_id IN ${invoiceKeys});
    DELETE FROM public.alert_items WHERE metadata->>'bl_id' LIKE '${prefix}%';
    DELETE FROM public.alerts WHERE entity_type = 'invoice' AND entity_id IN ${invoiceKeys};
    DELETE FROM public.invoice_corrections WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_refunds WHERE invoice_id IN ${invoices};
    DELETE FROM public.ledger_settlements WHERE invoice_id IN ${invoices};
    DELETE FROM public.ledger_payment_requests WHERE created_by = '${actorId}';
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_items WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_receivable_links WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_bls WHERE invoice_id IN ${invoices};
    DELETE FROM public.payments WHERE invoice_id IN ${invoices};
    DELETE FROM public.billing_batches WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.portal_notifications WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.invoices WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.bl_receivables WHERE bl_id = ANY(${bls});
    DELETE FROM public.import_pending_effects WHERE entity_id = ANY(${bls});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(${bls});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.vehicles WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_containers WHERE bl_id = ANY(${bls});
    DELETE FROM public.bls WHERE id = ANY(${bls});
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${customerId}, ${otherCustomerId}));
    DELETE FROM public.customer_contacts WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.customers WHERE id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('128 — correção do B/L sempre automática', () => {
  beforeAll(() => {
    cleanup()
    const customers = [[customerId, 128001], [otherCustomerId, 128009]] as const
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'basis-128@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'Administrativo 128', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
      ${customers.map(([id, ns]) => `
        INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${id}, '${syntheticCnpj(ns)}', 'Cliente ${ns}');
        INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
          VALUES (${id}, 'Financeiro ${ns}', 'financeiro-${ns}@example.test', 'financeiro', true);
        INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
          VALUES (${id}, 'Fixture: gate aberto', '${actorId}', now() + interval '1 day');`).join('\n')}
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 128');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 128', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R128', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (${chargeTableId}, 'Tabela 128', 'R128POD', CURRENT_DATE - 30, true, 'container');
      -- COC: R$ 600 por container (500 + Drop Off 100). SOC: R$ 500.
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc)
        VALUES (${perContainerItem}, ${chargeTableId}, 'Taxa por container 128', 'container', 500, 500, 'container_distinct_voyage', 'base', 'any', 'BRL', true),
               (${dropOffItem}, ${chargeTableId}, 'Drop Off 128', 'container', 100, 100, 'container_distinct_voyage', 'base', 'any', 'BRL', false);
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ${allBls.map((id) => `('${id}', ${voyageId}, ${customerId}, 'R128POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL)`).join(', ')};
      INSERT INTO public.bl_containers (bl_id, container_number, type)
      VALUES ${allBls.map((id, i) => `('${id}', 'RCCU128${String(i).padStart(4, '0')}', '22G1')`).join(', ')};
    `)
  })

  afterAll(cleanup)

  it('a API já não cancela para reemitir nem registra correção digitada', () => {
    expect(asAdmin(`SELECT public.cancel_invoice_for_reissue(1, 'x', NULL)`).stderr).toMatch(/does not exist/)
    expect(asAdmin(`SELECT public.register_invoice_correction(1, 1, 1, 'xpto')`).stderr).toMatch(/does not exist/)
    // Os núcleos do sistema não são chamáveis pela API.
    expect(asAdmin(`SELECT public.apply_invoice_basis_changes(ARRAY['x'], 'x')`).stderr).toMatch(/permission denied/)
  })

  it('alteração direta de SOC/COC reemite individual e consolidada; data de Demurrage não', () => {
    const individual = issueByCe(bl.soc, '128000000000001')
    const other = issueByCe(bl.pairA, '128000000000002')
    const consolidated = consolidate([bl.soc, bl.pairA])
    expect(psql(`SELECT total_brl FROM public.invoices WHERE id = ${consolidated}`)).toBe('1200.00')

    // Data de Demurrage no container não é base de Taxas Locais.
    psql(`UPDATE public.bl_containers SET discharge_date = CURRENT_DATE WHERE bl_id = '${bl.soc}'`)
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${individual}`)).toBe('issued')
    expect(activeAlerts('fatura_desatualizada', individual)).toBe('0')

    psql(`UPDATE public.bl_containers SET ownership = 'SOC', ownership_source = 'manual' WHERE bl_id = '${bl.soc}'`)
    expect(psql(`SELECT status FROM public.invoices WHERE id IN (${individual}, ${consolidated}) ORDER BY id`)).toBe('cancelled\ncancelled')
    expect(successor(individual)).toMatch(/\|500\.00\|issued$/)
    expect(successor(consolidated)).toMatch(/\|1100\.00\|issued$/)
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${other}`)).toBe('issued')
  })

  it('dois B/Ls da mesma consolidada corrigidos juntos recriam a consolidada uma vez só', () => {
    issueByCe(bl.pairB, '128000000000003')
    const live = Number(psql(`SELECT id FROM public.invoices WHERE customer_id = ${customerId} AND invoice_type = 'consolidated' AND status = 'issued'`))
    const before = Number(psql(`SELECT count(*) FROM public.invoices WHERE customer_id = ${customerId} AND invoice_type = 'consolidated'`))
    // A consolidada do caso anterior sai; uma nova junta os dois B/Ls do par.
    psql(`UPDATE public.invoices SET status = 'cancelled' WHERE id = ${live}`)
    const pair = consolidate([bl.pairA, bl.pairB])
    psql(`
      UPDATE public.bl_containers SET is_imo = true WHERE bl_id = '${bl.pairA}';
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.pairA}', 'RCCU1289001', '22G1');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.pairB}', 'RCCU1289002', '22G1');
    `)
    const after = Number(psql(`SELECT count(*) FROM public.invoices WHERE customer_id = ${customerId} AND invoice_type = 'consolidated'`))
    expect(after).toBe(before + 2) // a nova do par + a única reemissão dela
    expect(successor(pair)).toMatch(/\|2400\.00\|issued$/)
  })

  it('mudança que não altera o valor nem o Cliente não reemite', () => {
    const live = Number(psql(`SELECT id FROM public.invoices WHERE bl_id = '${bl.pairB}' AND invoice_type = 'individual' AND status = 'issued'`))
    // Item "any" não diferencia IMO: o valor do B/L não muda.
    psql(`UPDATE public.bl_containers SET is_imo = true WHERE bl_id = '${bl.pairB}'`)
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${live}`)).toBe('issued')
    expect(successor(live)).toBe('')
  })

  it('com pagamento parcial, a redução abate o saldo sem restituição', () => {
    psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.partial}', 'RCCU1289003', '22G1')`)
    const invoice = issueByCe(bl.partial, '128000000000004')
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice}, 200)`)
    psql(`DELETE FROM public.bl_containers WHERE bl_id = '${bl.partial}' AND container_number = 'RCCU1289003'`)
    expect(psql(`SELECT status || '|' || total_brl || '|' || balance_brl FROM public.invoices WHERE id = ${invoice}`)).toBe('partially_paid|1200.00|400.00')
    expect(psql(`SELECT offset_brl || '|' || refund_brl FROM public.invoice_corrections WHERE invoice_id = ${invoice}`)).toBe('600.00|0.00')
    expect(activeAlerts('restituicao_pendente', invoice)).toBe('0')
  })

  it('com pagamento integral, a redução restitui e o alerta fecha quando a restituição é confirmada', () => {
    psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.full}', 'RCCU1289004', '22G1')`)
    const invoice = issueByCe(bl.full, '128000000000005')
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice}, 1200)`)
    psql(`UPDATE public.bl_containers SET ownership = 'SOC', ownership_source = 'manual' WHERE bl_id = '${bl.full}'`)
    expect(psql(`SELECT status || '|' || total_brl FROM public.invoices WHERE id = ${invoice}`)).toBe('paid|1200.00')
    const refund = psql(`SELECT id || '|' || amount_brl || '|' || status FROM public.invoice_refunds WHERE invoice_id = ${invoice}`)
    expect(refund).toMatch(/\|200\.00\|pending$/)
    expect(activeAlerts('restituicao_pendente', invoice)).toBe('1')
    adminJson(`SELECT public.confirm_invoice_refund(${refund.split('|')[0]},'BASIS-REF-${refund.split('|')[0]}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(activeAlerts('restituicao_pendente', invoice)).toBe('0')
  })

  it('com pagamento, aumento não muda a fatura e pede avulsa', () => {
    const invoice = issueByCe(bl.more, '128000000000006')
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice}, 100)`)
    psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.more}', 'RCCU1289005', '22G1')`)
    expect(psql(`SELECT status || '|' || total_brl FROM public.invoices WHERE id = ${invoice}`)).toBe('partially_paid|600.00')
    expect(activeAlerts('fatura_desatualizada', invoice)).toBe('1')
  })

  it('B/L que muda de Cliente: a individual sai para o novo e a consolidada é encerrada sem reemissão', () => {
    issueByCe(bl.moveA, '128000000000007')
    issueByCe(bl.moveB, '128000000000008')
    const consolidated = consolidate([bl.moveA, bl.moveB])
    psql(`UPDATE public.bls SET customer_id = ${otherCustomerId} WHERE id = '${bl.moveA}'`)
    expect(psql(`SELECT customer_id || '|' || status FROM public.invoices WHERE bl_id = '${bl.moveA}' AND invoice_type = 'individual' AND status = 'issued'`))
      .toBe(`${otherCustomerId}|issued`)
    expect(successor(consolidated)).toBe('')
    expect(psql(`SELECT (reissue_closed_at IS NOT NULL) || '|' || reissue_closed_reason FROM public.invoices WHERE id = ${consolidated}`)).toMatch(/^true\|.*outro Cliente/)
    const pending = asAdmin(`SELECT invoice_id FROM public.list_pending_reissues()`)
    expect(pending.stdout.split('\n')).not.toContain(String(consolidated))
    expect(activeAlerts('fatura_desatualizada', consolidated)).toBe('0')
    // O B/L B continua cobrado pela individual dele.
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id = '${bl.moveB}' AND status = 'issued'`)).toBe('1')
  })

  it('efeito de veículos cancela e encerra a consolidada do B/L isento', () => {
    issueByCe(bl.vehicle, '128000000000009')
    issueByCe(bl.vehicleB, '128000000000010')
    const consolidated = consolidate([bl.vehicle, bl.vehicleB])
    const result = psql(`SELECT public._run_import_effect_vehicle_followup('${bl.vehicle}', '${actorId}'::uuid)`)
    expect(JSON.parse(result).cancelled_invoice_ids).toContain(consolidated)
    expect(psql(`SELECT status || '|' || (reissue_closed_at IS NOT NULL) FROM public.invoices WHERE id = ${consolidated}`)).toBe('cancelled|true')
  })

  it('Baplie que declara o container como SOC reemite pelo valor novo', () => {
    const invoice = issueByCe(bl.baplie, '128000000000011')
    const container = psql(`SELECT container_number FROM public.bl_containers WHERE bl_id = '${bl.baplie}'`)
    psql(`INSERT INTO public.baplie_containers (voyage_id, container_number, status, ownership) VALUES (${voyageId}, '${container}', 'full', 'SOC')`)
    const result = adminJson<{ invoice_reissues: Array<{ bl_id: string; status: string }> }>(
      `SELECT public.apply_baplie_physical_flags_atomic(${voyageId}, NULL, '${actorId}'::uuid)`,
    )
    expect(result.invoice_reissues).toEqual(expect.arrayContaining([expect.objectContaining({ bl_id: bl.baplie, status: 'reissued' })]))
    expect(successor(invoice)).toMatch(/\|500\.00\|issued$/)
  })

  it('Portal: sem filtro, as canceladas não aparecem; o filtro Cancelada mostra', () => {
    const all = JSON.parse(psql(`SELECT public._portal_list_invoices_page_core(${customerId}, 100, 0, NULL, NULL, NULL, NULL, NULL, NULL)`))
    expect(all.rows.some((row: { status: string }) => row.status === 'cancelled')).toBe(false)
    const cancelled = JSON.parse(psql(`SELECT public._portal_list_invoices_page_core(${customerId}, 100, 0, 'cancelled', NULL, NULL, NULL, NULL, NULL)`))
    expect(cancelled.rows.length).toBeGreaterThan(0)
  })
})
