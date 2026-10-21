import { expect } from 'vitest'
import { execPsql, spawnPsql } from './localPsql'
import { syntheticCnpj } from './localTestData'

/**
 * Fixtures das suítes da frente financeira (plano
 * docs/archive/plans/2026-10-21-correcoes-frente-financeira.md). Cada suíte recebe um
 * namespace numérico próprio: IDs, CNPJs, B/Ls (`FF<ns>-...`) e o POD saem
 * dele, e `cleanup()` apaga só o que o namespace criou.
 */
export const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

export type Role = 'administrativo' | 'financeiro' | 'operacoes'

export function financeWorld(ns: number) {
  const base = 99_000_000 + ns * 100
  const uuid = (n: number) => `00000000-0000-0000-${String(ns).padStart(4, '0')}-${String(n).padStart(12, '0')}`
  const actors: Record<Role, string> = { administrativo: uuid(1), financeiro: uuid(2), operacoes: uuid(3) }
  const customerId = base + 1
  const otherCustomerId = base + 2
  const carrierId = base + 3
  const vesselId = base + 4
  const voyageId = base + 5
  const pod = `FF${ns}POD`
  const prefix = `FF${ns}-`
  const customers = [customerId, otherCustomerId]
  let nextTable = base + 10
  let nextItem = base + 40
  let nextContainer = 1
  /** Número ISO de container do namespace (4 letras e 7 dígitos). */
  const container = () => `FFCU${String(ns).padStart(4, '0').slice(-4)}${String(nextContainer++).padStart(3, '0')}`

  function psql(sql: string, actor: string = actors.administrativo): string {
    return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actor}'; ${sql}`], { encoding: 'utf8' }).trim()
  }

  /** Como usuário autenticado do Departamento, numa transação própria. */
  function as(role: Role, sql: string) {
    return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN;
      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claim.sub = '${actors[role]}';
      ${sql};
      COMMIT;
    `], { encoding: 'utf8' })
  }

  function asOk(role: Role, sql: string): string {
    const result = as(role, sql)
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }

  function json<T>(role: Role, sql: string): T {
    const out = asOk(role, sql)
    const line = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('[')).at(-1)
    return JSON.parse(line ?? '{}') as T
  }

  function bl(name: string) {
    return `${prefix}${name}`
  }

  function setup() {
    cleanup()
    const profiles = (Object.entries(actors) as [Role, string][])
    psql(`
      INSERT INTO auth.users (id, email) VALUES ${profiles.map(([role, id]) => `('${id}', 'ff${ns}-${role}@example.test')`).join(', ')};
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ${profiles.map(([role, id]) => `('${id}', 'FF${ns} ${role}', '${role}', true)`).join(', ')}
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      ${customers.map((id, i) => `
        INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${id}, '${syntheticCnpj(ns * 10 + i)}', 'Cliente FF${ns}-${i}');
        INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
          VALUES (${id}, 'Financeiro FF${ns}-${i}', 'financeiro-ff${ns}-${i}@example.test', 'financeiro', true);
        INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
          VALUES (${id}, 'Fixture: gate aberto', '${actors.administrativo}', now() + interval '1 day');`).join('\n')}
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier FF${ns}');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel FF${ns}', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'FF${ns}', 'active');
    `)
  }

  /** Tabela de container com um item por container (BRL). Devolve [tabela, item]. */
  function table(unitBrl: number, opts: { validFrom?: string; active?: boolean; cargoMode?: string; basis?: string } = {}): [number, number] {
    const tableId = nextTable++
    const itemId = nextItem++
    const cargoMode = opts.cargoMode ?? 'container'
    const basis = opts.basis ?? (cargoMode === 'container' ? 'container_distinct_voyage' : 'bl')
    psql(`
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (${tableId}, 'Tabela FF${ns}-${tableId}', '${pod}', ${opts.validFrom ?? 'CURRENT_DATE - 30'}, ${opts.active ?? true}, '${cargoMode}');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc)
        VALUES (${itemId}, ${tableId}, 'Taxa FF${ns}-${itemId}', '${basis === 'bl' ? 'bl' : 'container'}', ${unitBrl}, ${unitBrl}, '${basis}', 'base', 'any', 'BRL', true);
    `)
    return [tableId, itemId]
  }

  /** B/L de container com um container próprio (ou o informado, para dividir). */
  function createBl(name: string, opts: { container?: string; customerId?: number | null; ce?: string } = {}) {
    const id = bl(name)
    const customer = opts.customerId === undefined ? customerId : opts.customerId
    psql(`
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ('${id}', ${voyageId}, ${customer ?? 'NULL'}, '${pod}', 'container', 'pending', 'not_calculated', '${customer ? 'reconciled' : 'missing_customer'}', NULL);
      INSERT INTO public.bl_containers (bl_id, container_number, type)
      VALUES ('${id}', '${opts.container ?? container()}', '22G1');
    `)
    return id
  }

  function calculate(id: string) {
    return JSON.parse(psql(`SELECT public.calculate_bl_local_charges('${id}', '${actors.administrativo}'::uuid, true)`))
  }

  function calcTotal(id: string): number {
    return Number(psql(`SELECT coalesce(sum(total_value_brl), 0) FROM public.charge_calculations WHERE bl_id = '${id}'`))
  }

  function boundTable(id: string, scope = 'container'): number | null {
    const out = psql(`SELECT charge_table_id FROM public.bl_charge_table_links WHERE bl_id = '${id}' AND scope = '${scope}'`)
    return out ? Number(out) : null
  }

  /** CE gravado como manutenção do servidor; o gatilho do CE emite. */
  function issueByCe(id: string, ce: string): number {
    const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN;
      SET LOCAL ROLE service_role;
      SET LOCAL request.jwt.claim.role = 'service_role';
      SET LOCAL request.jwt.claim.sub = '${actors.administrativo}';
      DO $$ BEGIN PERFORM public.apply_ce_mercante_update('${id}', '${ce}', '${actors.administrativo}'::uuid); END $$;
      COMMIT;`], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    return liveInvoice(id)
  }

  function liveInvoice(id: string): number {
    return Number(psql(`SELECT i.id FROM public.invoices i JOIN public.invoice_bls ib ON ib.invoice_id = i.id
      WHERE ib.bl_id = '${id}' AND i.invoice_type = 'individual' AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid')
      ORDER BY i.id DESC LIMIT 1`))
  }

  function invoice(id: number) {
    const [status, total, balance, replaces] = psql(`SELECT status, total_brl, coalesce(balance_brl, 0), coalesce(replaces_invoice_id, 0) FROM public.invoices WHERE id = ${id}`).split('|')
    return { status, total: Number(total), balance: Number(balance), replaces: Number(replaces) }
  }

  function successorOf(id: number): number | null {
    const out = psql(`SELECT id FROM public.invoices WHERE replaces_invoice_id = ${id} ORDER BY id DESC LIMIT 1`)
    return out ? Number(out) : null
  }

  function receivableId(id: string) {
    return Number(psql(`SELECT id FROM public.bl_receivables WHERE bl_id = '${id}' AND source = 'local_charges'`))
  }

  function pay(invoiceId: number, amount: number, note = 'Baixa do teste'): { payment_id: number; status: string } {
    return json('financeiro', `SELECT public.register_ledger_invoice_payment(${invoiceId}, ${amount}, 'ted', now(), NULL, 'manual', '${note}', NULL)`)
  }

  function consolidate(blIds: string[], customer = customerId): number {
    return json<{ invoice_id: number }>('administrativo',
      `SELECT public.create_local_consolidated_invoice(${customer}, ARRAY[${blIds.map(receivableId).join(',')}]::bigint[], NULL, '${actors.administrativo}'::uuid)`).invoice_id
  }

  function reversePayment(paymentId: number, reason = 'Estorno do teste') {
    return json<Record<string, unknown>>('administrativo', `SELECT public.reverse_invoice_payment(${paymentId}, '${reason}')`)
  }

  function activeInvoiceAlerts(type: string, invoiceId: number): number {
    return Number(psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE ai.item_type = '${type}' AND ai.status = 'active' AND a.entity_type = 'invoice' AND a.entity_id = '${invoiceId}'`))
  }

  /** Fecha o gate do Portal (sem Liberação vigente): o CE calcula e retém. */
  function closeGate(customer = customerId) {
    psql(`DELETE FROM public.customer_billing_portal_releases WHERE customer_id = ${customer}`)
  }

  /** Concede a Liberação pela RPC, como o Administrativo: reprocessa as retidas. */
  function openGate(customer = customerId) {
    return json<{ reprocess: { issued: number } }>('administrativo',
      `SELECT public.grant_customer_billing_portal_release(${customer}, 'Liberação do teste', now() + interval '7 days')`)
  }

  function cancelBl(id: string, reason = 'Cancelado no teste') {
    return json<Record<string, unknown>>('administrativo', `SELECT public.cancel_bl('${id}', '${reason}')`)
  }

  function cleanup() {
    const bls = `(SELECT id FROM public.bls WHERE id LIKE '${prefix}%')`
    const cust = customers.join(',')
    const invoices = `(SELECT id FROM public.invoices WHERE customer_id IN (${cust}))`
    const invoiceKeys = `(SELECT id::text FROM public.invoices WHERE customer_id IN (${cust}))`
    const tables = `(SELECT id FROM public.charge_tables WHERE pod = '${pod}')`
    const actorList = Object.values(actors).map((id) => `'${id}'`).join(',')
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT ai.id FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
        WHERE (a.entity_type = 'invoice' AND a.entity_id IN ${invoiceKeys}) OR (a.entity_type = 'bl' AND a.entity_id LIKE '${prefix}%'));
      DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE (entity_type = 'invoice' AND entity_id IN ${invoiceKeys}) OR (entity_type = 'bl' AND entity_id LIKE '${prefix}%'));
      DELETE FROM public.alert_items WHERE metadata->>'bl_id' LIKE '${prefix}%';
      DELETE FROM public.alerts WHERE (entity_type = 'invoice' AND entity_id IN ${invoiceKeys}) OR (entity_type = 'bl' AND entity_id LIKE '${prefix}%');
      DELETE FROM public.invoice_corrections WHERE invoice_id IN ${invoices};
      DELETE FROM public.invoice_refunds WHERE invoice_id IN ${invoices};
      DELETE FROM public.ledger_settlements WHERE invoice_id IN ${invoices};
      DELETE FROM public.ledger_payment_requests WHERE created_by IN (${actorList});
      DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN ${invoices};
      DELETE FROM public.invoice_items WHERE invoice_id IN ${invoices};
      DELETE FROM public.invoice_receivable_links WHERE invoice_id IN ${invoices};
      DELETE FROM public.invoice_bls WHERE invoice_id IN ${invoices};
      DELETE FROM public.payments WHERE invoice_id IN ${invoices};
      DELETE FROM public.invoice_customer_changes WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.billing_batches WHERE customer_id IN (${cust});
      DELETE FROM public.portal_notifications WHERE customer_id IN (${cust});
      DELETE FROM public.itau_pix_receipts WHERE charge_id IN (SELECT id FROM public.itau_pix_charges WHERE invoice_id IN ${invoices});
      DELETE FROM public.itau_pix_charges WHERE invoice_id IN ${invoices};
      DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN ${invoices};
      DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE customer_id IN (${cust}));
      DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE customer_id IN (${cust}));
      DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE customer_id IN (${cust}));
      DELETE FROM public.demurrage_invoices WHERE customer_id IN (${cust});
      DELETE FROM public.invoices WHERE customer_id IN (${cust});
      DELETE FROM public.invoice_basis_pending_changes WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.bl_receivables WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.import_pending_effects WHERE entity_id LIKE '${prefix}%';
      DELETE FROM public.charge_calculations WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.bl_price_freeze_items WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.bl_price_freezes WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.bl_charge_calculation_basis WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.bl_breakbulk_items WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.bl_charge_table_links WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.pricing_rule_versions WHERE charge_table_id IN ${tables};
      DELETE FROM public.vehicles WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.bl_containers WHERE bl_id LIKE '${prefix}%';
      DELETE FROM public.bls WHERE id IN ${bls};
      DELETE FROM public.customer_rate_overrides WHERE customer_id IN (${cust});
      DELETE FROM public.charge_table_items WHERE charge_table_id IN ${tables};
      DELETE FROM public.charge_tables WHERE id IN ${tables};
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${cust});
      DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${cust}));
      DELETE FROM public.customer_contacts WHERE customer_id IN (${cust});
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${cust});
      DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${cust});
      DELETE FROM public.customers WHERE id IN (${cust});
      DELETE FROM public.audit_logs WHERE changed_by IN (${actorList});
      DELETE FROM public.user_profiles WHERE id IN (${actorList});
      DELETE FROM auth.users WHERE id IN (${actorList});
      SET session_replication_role = origin;
    `)
  }

  return {
    ns, actors, customerId, otherCustomerId, voyageId, pod, prefix,
    container, psql, as, asOk, json, bl, setup, cleanup, table, createBl, calculate, calcTotal, boundTable,
    closeGate, openGate, cancelBl, issueByCe, liveInvoice, invoice, successorOf, receivableId, pay, consolidate, reversePayment, activeInvoiceAlerts,
  }
}
