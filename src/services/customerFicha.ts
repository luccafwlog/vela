import { supabase } from './supabase'
import type { CustomerContact, CustomerRateOverride, DemurrageInvoice } from '../types/database'
import { isCustomerReconciliationResolved } from './customerReconciliation'
import { formatBRL } from '../lib/utils'
import { classifyDbError } from '../lib/errors'
import { accountSituationLabel, provisioningDecisionLabel } from '../lib/portalProvisioningViewModel'
import { fetchCustomerCommunicationHistory, customerCommunicationKindLabel, customerCommunicationStatusLabel, type CustomerCommunicationHistoryItem } from './customerCommunications'

export type FichaLocalInvoiceRow = {
  id: number
  invoice_number: string | null
  issued_at: string | null
  total_brl: number | null
  balance_brl: number | null
  status: string | null
}

export type FichaDemurrageInvoiceRow = Pick<DemurrageInvoice, 'id' | 'doc_number' | 'bl_id' | 'due_date' | 'billed_at' | 'paid_at' | 'total_usd' | 'current_total_brl' | 'status' | 'dispute_open' | 'dispute_status' | 'dispute_subject'>
export type FichaReceivableRow = { id: number; bl_id: string; original_amount_brl: number; settled_amount_brl: number; balance_brl: number; status: string }
export type FichaPaymentRow = { id: number; amount_brl: number; payment_method: string | null; paid_at: string | null; notes: string | null; invoice: { id: number; invoice_number: string | null } | null }
export type FichaOverrideRow = Pick<CustomerRateOverride, 'id' | 'override_value' | 'valid_from' | 'valid_to' | 'notes'> & { charge_item: { id: number; name: string | null; currency: string | null; charge_table: { id: number; name: string | null; pod: string | null; cargo_mode: string | null } | null } | null }
export type FichaManualChargeBlRow = { bl_id: string; manual_count: number }
export type FichaPendingReconciliationRow = { id: string; consignee: string | null; customer_reconciliation_status: string | null }
export type FichaRunningDemurrageRow = { container_id: number; container_number: string | null; bl_id: string; discharge_date: string }

export type ConsolidatedBalance = { localBrl: number; demurrageBrl: number; totalBrl: number }
const UNPAID_DEMURRAGE_STATUSES = new Set(['issued', 'overdue'])
// Glossário (CONTEXT.md, "Saldo Pendente do Cliente"): emitidas e ainda não
// pagas — inclui as parcialmente pagas, pelo saldo restante. Taxa local não tem
// vencimento praticado, então não há estado "vencida" para somar (issue #605).
const UNPAID_LOCAL_STATUSES = new Set(['issued', 'partially_paid'])

export function buildConsolidatedBalance(
  localInvoices: Array<{ status: string | null; balance_brl: number | null }>,
  demurrageInvoices: Array<{ status: string | null; current_total_brl: number | null }>,
): ConsolidatedBalance {
  const localBrl = localInvoices.filter((row) => UNPAID_LOCAL_STATUSES.has(row.status ?? '')).reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0)
  const demurrageBrl = demurrageInvoices.filter((row) => UNPAID_DEMURRAGE_STATUSES.has(row.status ?? '')).reduce((sum, row) => sum + Number(row.current_total_brl ?? 0), 0)
  return { localBrl, demurrageBrl, totalBrl: localBrl + demurrageBrl }
}

export type CustomerTimelineEvent = {
  kind: 'cadastro_audit' | 'portal_event' | 'contact_created' | 'contact_configuration_changed' | 'local_invoice_issued' | 'local_payment' | 'demurrage_invoice_issued' | 'demurrage_invoice_paid' | 'bl_created' | 'communication'
  sourceId: string
  at: string
  label: string
  detail: string | null
  link: string | null
  actorId?: string | null
}

export type ContactChangeEventSource = {
  id: number
  action_id: string | null
  source: string
  actor_id: string | null
  portal_account_id: number | null
  related_bl_id: string | null
  before_snapshot: unknown
  after_snapshot: unknown
  change_summary: Record<string, unknown> | null
  created_at: string
}

function contactChangeSourceLabel(source: string): 'Portal' | 'Equipe' | 'B/L' | 'Sistema' {
  if (source === 'portal') return 'Portal'
  if (source === 'interno') return 'Equipe'
  if (source === 'bl_automatico') return 'B/L'
  return 'Sistema'
}

type TimelineSources = {
  customerId?: number
  auditLogs: Array<{ id: number; field_name: string; old_value: string | null; new_value: string | null; changed_at: string | null; justification: string | null; changed_by: string | null }>
  portalEvents: Array<{ id: number; new_decision: string | null; new_situation: string | null; reason: string | null; created_at: string }>
  contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>>
  contactChangeEvents?: ContactChangeEventSource[]
  localInvoices: Array<{ id: number; invoice_number: string | null; issued_at: string | null; status: string | null }>
  payments: Array<{ id: number; amount_brl: number; paid_at: string | null; invoice: { id: number; invoice_number: string | null } | null }>
  demurrageInvoices: Array<{ id: number; doc_number: string; billed_at: string | null; paid_at: string | null; status: string | null }>
  bls: Array<{ id: string; created_at: string | null }>
  communications?: CustomerCommunicationHistoryItem[]
  actorNames?: ReadonlyMap<string, string>
}

export function buildCustomerTimeline(sources: TimelineSources): CustomerTimelineEvent[] {
  const contactChangeEventsByAction = new Map<string, ContactChangeEventSource>()
  for (const event of sources.contactChangeEvents ?? []) {
    const key = event.action_id ?? String(event.id)
    if (!contactChangeEventsByAction.has(key)) {
      contactChangeEventsByAction.set(key, event)
    }
  }

  const contactEvents: CustomerTimelineEvent[] = Array.from(contactChangeEventsByAction.values()).map((row) => {
    const origin = contactChangeSourceLabel(row.source)
    const contacts = Array.isArray(row.after_snapshot) ? (row.after_snapshot as Array<{ box_codes?: string[] }>) : []
    const contactCount = contacts.length
    const boxCodes = new Set(contacts.flatMap((c) => c.box_codes ?? []))
    const boxCount = boxCodes.size

    let summaryText = ''
    if (row.change_summary && typeof row.change_summary === 'object') {
      if (typeof row.change_summary.justification === 'string' && row.change_summary.justification.trim()) {
        summaryText = `${row.change_summary.justification.trim()} · `
      } else if (row.change_summary.action === 'customer_created') {
        summaryText = 'Cadastro inicial · '
      }
    }
    if (!summaryText && row.related_bl_id) {
      summaryText = `B/L ${row.related_bl_id} · `
    }

    const countsText = `${contactCount} contato(s), ${boxCount} caixa(s)`
    const detail = `${summaryText}${countsText}`

    return {
      kind: 'contact_configuration_changed' as const,
      sourceId: row.action_id ?? String(row.id),
      at: row.created_at,
      label: `Contatos: alteração via ${origin}`,
      detail,
      link: null,
      actorId: row.actor_id ? (sources.actorNames?.get(row.actor_id) ?? row.actor_id) : null,
    }
  })

  const events: CustomerTimelineEvent[] = [
    ...sources.auditLogs.filter((row) => row.changed_at).map((row) => ({ kind: 'cadastro_audit' as const, sourceId: String(row.id), at: row.changed_at!, label: `Cadastro alterado: ${row.field_name}`, detail: `${row.old_value ?? '—'} → ${row.new_value ?? '—'}${row.justification ? ` · ${row.justification}` : ''}`, link: null, actorId: row.changed_by ? (sources.actorNames?.get(row.changed_by) ?? row.changed_by) : null })),
    ...sources.portalEvents.map((row) => ({ kind: 'portal_event' as const, sourceId: String(row.id), at: row.created_at, label: `Portal: ${row.new_decision ? provisioningDecisionLabel(row.new_decision) : row.new_situation ? accountSituationLabel(row.new_situation) : 'evento'}`, detail: row.reason, link: null })),
    ...sources.contacts.filter((row) => row.created_at).map((row) => ({ kind: 'contact_created' as const, sourceId: String(row.id), at: row.created_at!, label: `Contato criado: ${row.name ?? '—'}`, detail: null, link: null })),
    ...contactEvents,
    ...sources.localInvoices.filter((row) => row.issued_at).map((row) => ({ kind: 'local_invoice_issued' as const, sourceId: String(row.id), at: row.issued_at!, label: `Invoice emitida: ${row.invoice_number ?? `INV-${row.id}`}`, detail: null, link: `/taxas-locais?${sources.customerId ? `customer=${sources.customerId}&` : ''}invoice=${row.id}` })),
    ...(sources.payments ?? []).filter((row) => row.paid_at).map((row) => ({ kind: 'local_payment' as const, sourceId: String(row.id), at: row.paid_at!, label: `Pagamento recebido: ${row.invoice?.invoice_number ?? (row.invoice ? `INV-${row.invoice.id}` : '—')}`, detail: formatBRL(row.amount_brl), link: row.invoice ? `/taxas-locais?${sources.customerId ? `customer=${sources.customerId}&` : ''}invoice=${row.invoice.id}` : null })),
    ...sources.demurrageInvoices.flatMap((row) => [
      ...(row.billed_at ? [{ kind: 'demurrage_invoice_issued' as const, sourceId: `${row.id}:issued`, at: row.billed_at, label: `Demurrage emitida: ${row.doc_number}`, detail: null, link: '/demurrage' }] : []),
      ...(row.paid_at ? [{ kind: 'demurrage_invoice_paid' as const, sourceId: `${row.id}:paid`, at: row.paid_at, label: `Demurrage paga: ${row.doc_number}`, detail: null, link: '/demurrage' }] : []),
    ]),
    ...sources.bls.filter((row) => row.created_at).map((row) => ({ kind: 'bl_created' as const, sourceId: row.id, at: row.created_at!, label: `B/L vinculado: ${row.id}`, detail: null, link: `/bls/${row.id}` })),
    ...(sources.communications ?? []).map((row) => ({
      kind: 'communication' as const,
      sourceId: String(row.id),
      at: row.created_at,
      label: `${customerCommunicationKindLabel(row.kind)}: ${customerCommunicationStatusLabel(row.status)}`,
      detail: `${row.attempts.length} tentativa(s)${row.anchor_port ? ` · ${row.anchor_port}` : ''}${row.attachments.length ? ` · ${row.attachments.length} anexo(s)` : ''}`,
      link: `/clientes/comunicacao?tab=historico&communication=${encodeURIComponent(String(row.id))}`,
    })),
  ]
  return events.sort((a, b) => b.at.localeCompare(a.at))
}

export type Restrictable<T> = { rows: T[]; denied: boolean }

// Pagina ate esgotar o resultado em vez de truncar em uma janela fixa — saldos
// e contagens de pendencia precisam do total exato, nao de uma amostra.
const FICHA_PAGE_SIZE = 500
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string | null; message?: string | null } | null }>,
): Promise<{ rows: T[]; error: { code?: string | null; message?: string | null } | null }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await page(from, from + FICHA_PAGE_SIZE - 1)
    if (error) return { rows, error }
    rows.push(...(data ?? []))
    if (!data || data.length < FICHA_PAGE_SIZE) break
    from += FICHA_PAGE_SIZE
  }
  return { rows, error: null }
}

export async function fetchCustomerDemurrageInvoices(customerId: number) {
  const { rows, error } = await fetchAllRows<FichaDemurrageInvoiceRow>((from, to) =>
    supabase.from('demurrage_invoices').select('id, doc_number, bl_id, due_date, billed_at, paid_at, total_usd, current_total_brl, status, dispute_open, dispute_status, dispute_subject').eq('customer_id', customerId).order('billed_at', { ascending: false }).range(from, to).overrideTypes<FichaDemurrageInvoiceRow[], { merge: false }>(),
  )
  if (error) { if (classifyDbError(error).kind === 'permissao') return { rows: [], denied: true }; throw error }
  return { rows, denied: false }
}

// Le via RPC (get_customer_receivables), nao pela tabela direto: a RLS de
// bl_receivables e USING(is_admin()) e devolve uma lista vazia bem-sucedida
// para quem nao e admin — indistinguivel de "sem recebiveis". A RPC levanta
// 42501 explicito para usuario inativo, permitindo separar os dois casos.
export async function fetchCustomerReceivables(customerId: number) {
  const { data, error } = await supabase.rpc('get_customer_receivables', { p_customer_id: customerId })
  if (error) { if (classifyDbError(error).kind === 'permissao') return { rows: [], denied: true }; throw error }
  return { rows: data ?? [], denied: false }
}

export async function fetchCustomerPayments(customerId: number) {
  const { rows, error } = await fetchAllRows<FichaPaymentRow>((from, to) =>
    supabase.from('payments').select('id, amount_brl, payment_method, paid_at, notes, invoice:invoices!inner(id, invoice_number, customer_id)').eq('invoice.customer_id', customerId).order('paid_at', { ascending: false }).range(from, to).overrideTypes<FichaPaymentRow[], { merge: false }>(),
  )
  if (error) { if (classifyDbError(error).kind === 'permissao') return { rows: [], denied: true }; throw error }
  return { rows, denied: false }
}

export async function fetchCustomerRateOverrides(customerId: number) {
  const { rows, error } = await fetchAllRows<FichaOverrideRow>((from, to) =>
    supabase.from('customer_rate_overrides').select('id, override_value, valid_from, valid_to, notes, charge_item:charge_table_items(id, name, currency, charge_table:charge_tables(id, name, pod, cargo_mode))').eq('customer_id', customerId).order('created_at', { ascending: false }).range(from, to).overrideTypes<FichaOverrideRow[], { merge: false }>(),
  )
  if (error) throw error
  return rows
}

export async function fetchCustomerManualChargeBls(customerId: number) {
  const { rows, error } = await fetchAllRows<{ bl_id: string | null }>((from, to) =>
    supabase.from('charge_calculations').select('bl_id, bl:bls!inner(customer_id)').eq('bl.customer_id', customerId).eq('source', 'manual').range(from, to),
  )
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of rows) if (row.bl_id) counts.set(row.bl_id, (counts.get(row.bl_id) ?? 0) + 1)
  return Array.from(counts, ([bl_id, manual_count]) => ({ bl_id, manual_count }))
}

// matched_document e resolvido automaticamente por CNPJ/CPF exato
// (isCustomerReconciliationResolved) — filtra pelo mesmo predicado canonico
// para nao listar como pendente um vinculo que ja fechou sozinho.
export async function fetchCustomerPendingReconciliation(customerId: number) {
  const { rows, error } = await fetchAllRows<FichaPendingReconciliationRow>((from, to) =>
    supabase.from('bls').select('id, consignee, customer_reconciliation_status').eq('customer_id', customerId).in('customer_reconciliation_status', ['matched_document', 'matched_name']).order('created_at', { ascending: false }).range(from, to).overrideTypes<FichaPendingReconciliationRow[], { merge: false }>(),
  )
  if (error) throw error
  return rows.filter((row) => !isCustomerReconciliationResolved(row.customer_reconciliation_status))
}

export async function fetchCustomerRunningDemurrage(customerId: number) {
  const { rows: data, error } = await fetchAllRows<{ id: number; container_number: string | null; bl_id: string; discharge_date: string }>((from, to) =>
    supabase.from('bl_containers').select('id, container_number, bl_id, discharge_date, return_date, bl:bls!inner(customer_id)').eq('bl.customer_id', customerId).eq('demurrage_status', 'overdue').not('discharge_date', 'is', null).is('return_date', null).range(from, to).overrideTypes<Array<{ id: number; container_number: string | null; bl_id: string; discharge_date: string }>, { merge: false }>(),
  )
  if (error) throw error
  return (data ?? []).map((row) => ({ container_id: row.id, container_number: row.container_number, bl_id: row.bl_id, discharge_date: row.discharge_date }))
}

export async function fetchCustomerTimelineSources(customerId: number, contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>>, bls: Array<{ id: string; created_at: string | null }>) {
  const [auditLogs, portalEvents, localInvoices, payments, demurrage, communications, contactChanges] = await Promise.all([
    supabase.from('audit_logs').select('id, field_name, old_value, new_value, changed_at, justification, changed_by').eq('entity_type', 'customer').eq('entity_id', String(customerId)).order('changed_at', { ascending: false }).range(0, 99),
    supabase.from('portal_provisioning_events').select('id, new_decision, new_situation, reason, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 99),
    supabase.from('invoices').select('id, invoice_number, issued_at, status').eq('customer_id', customerId).order('issued_at', { ascending: false }).range(0, 99),
    supabase.from('payments').select('id, amount_brl, paid_at, invoice:invoices!inner(id, invoice_number, customer_id)').eq('invoice.customer_id', customerId).order('paid_at', { ascending: false }).range(0, 99),
    supabase.from('demurrage_invoices').select('id, doc_number, billed_at, paid_at, status').eq('customer_id', customerId).order('billed_at', { ascending: false }).range(0, 99),
    fetchCustomerCommunicationHistory(customerId),
    supabase.from('customer_contact_change_events').select('id, action_id, source, actor_id, portal_account_id, related_bl_id, before_snapshot, after_snapshot, change_summary, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 99),
  ])
  for (const result of [auditLogs, portalEvents]) if (result.error) throw result.error
  const localRows = localInvoices.error && classifyDbError(localInvoices.error).kind !== 'permissao' ? (() => { throw localInvoices.error })() : (localInvoices.data ?? [])
  const paymentRows = payments.error && classifyDbError(payments.error).kind !== 'permissao' ? (() => { throw payments.error })() : (payments.data ?? [])
  const demurrageRows = demurrage.error && classifyDbError(demurrage.error).kind !== 'permissao' ? (() => { throw demurrage.error })() : (demurrage.data ?? [])
  const contactChangeRows = contactChanges.error && classifyDbError(contactChanges.error).kind !== 'permissao' ? (() => { throw contactChanges.error })() : (contactChanges.data ?? [])
  const actorIds = Array.from(new Set([
    ...(auditLogs.data ?? []).map((row) => row.changed_by),
    ...contactChangeRows.map((row) => row.actor_id),
  ].filter((id): id is string => Boolean(id))))
  const actorNames = new Map<string, string>()
  if (actorIds.length) {
    const { data: profiles, error: profilesError } = await supabase.from('user_profiles').select('id, full_name').in('id', actorIds)
    if (profilesError && classifyDbError(profilesError).kind !== 'permissao') throw profilesError
    for (const profile of profiles ?? []) actorNames.set(profile.id, profile.full_name)
  }
  return buildCustomerTimeline({
    customerId,
    auditLogs: (auditLogs.data ?? []).filter((row) => row.changed_at).map((row) => ({ ...row, changed_at: row.changed_at! })),
    portalEvents: portalEvents.data ?? [],
    contacts,
    contactChangeEvents: contactChangeRows as ContactChangeEventSource[],
    localInvoices: (localRows ?? []).map((row) => ({ ...row, invoice_number: row.invoice_number ?? null })),
    payments: (paymentRows ?? []) as unknown as TimelineSources['payments'],
    demurrageInvoices: demurrageRows,
    bls,
    communications,
    actorNames,
  })
}
