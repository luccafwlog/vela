import { supabase } from './supabase'
import type { BLListItem, CustomerContact, CustomerRateOverride, DemurrageInvoice } from '../types/database'
import { isCustomerReconciliationResolved } from './customerReconciliation'
import { formatBRL } from '../lib/utils'
import { classifyDbError } from '../lib/errors'
import { accountSituationLabel, provisioningDecisionLabel } from '../lib/portalProvisioningViewModel'
import { fetchPaymentRegistrarNames } from './billing'
import { fetchCustomerCommunicationHistory, customerCommunicationKindLabel, customerCommunicationStatusLabel, type CustomerCommunicationHistoryItem } from './customerCommunications'

export type FichaLocalInvoiceRow = {
  id: number
  invoice_number: string | null
  issued_at: string | null
  total_brl: number | null
  balance_brl: number | null
  status: string | null
}

export type FichaDemurrageInvoiceRow = Pick<DemurrageInvoice, 'id' | 'doc_number' | 'bl_id' | 'due_date' | 'billed_at' | 'paid_at' | 'total_usd' | 'current_total_brl' | 'status' | 'dispute_open' | 'dispute_status' | 'dispute_subject' | 'discount_mode' | 'discount_value'>
export type FichaReceivableRow = { id: number; bl_id: string; original_amount_brl: number; settled_amount_brl: number; balance_brl: number; status: string }
export type FichaPaymentRow = { id: number; amount_brl: number; payment_method: string | null; paid_at: string | null; notes: string | null; registered_by_name?: string | null; invoice: { id: number; invoice_number: string | null } | null }
export type FichaOverrideRow = Pick<CustomerRateOverride, 'id' | 'override_value' | 'valid_from' | 'valid_to' | 'notes'> & { charge_item: { id: number; name: string | null; currency: string | null; charge_table: { id: number; name: string | null; pod: string | null; cargo_mode: string | null } | null } | null }
export type FichaManualChargeBlRow = { bl_id: string; manual_count: number }
export type FichaPendingReconciliationRow = { id: string; consignee: string | null; customer_reconciliation_status: string | null }
export type FichaRunningDemurrageRow = { container_id: number; container_number: string | null; bl_id: string; discharge_date: string }

/** Linha da aba BLs: as colunas da lista de BLs aprovada (lote 1 da identidade). */
export type FichaBlRow = Pick<BLListItem,
  'id' | 'cargo_mode' | 'pol' | 'pod' | 'ce_mercante' | 'charge_status' | 'financial_status' | 'created_at'
  | 'bb_weight_ton' | 'bb_packages_total' | 'bb_packages_qty' | 'bb_machine_qty' | 'bb_cbm'
> & {
  cancelled_at?: string | null
  consignee?: string | null
  voyage: { id: number; voyage_number: string | null; vessel: { name: string | null } | null } | null
  bl_containers: Array<{ id: number; container_number: string | null }> | null
  bl_breakbulk_items: Array<{ id: number }> | null
}

// ponytail: busca todos os B/Ls do Cliente em lotes de 1.000 e pagina na
// tela; com milhares de B/Ls por Cliente, trocar por paginação no banco.
/**
 * Nome do manifesto que vale mostrar sob o B/L (aba BLs, lote 1): só quando
 * difere do nome do Cliente, comparando sem acento, pontuação nem caixa.
 */
export function differingConsignee(consignee: string | null | undefined, customerName: string): string | null {
  const name = consignee?.trim()
  if (!name) return null
  const plain = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9A-Za-z]+/g, ' ').trim().toUpperCase()
  return plain(name) === plain(customerName) ? null : name
}

export async function fetchCustomerBls(customerId: number): Promise<FichaBlRow[]> {
  const rows: FichaBlRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('bls')
      .select('id, consignee, cargo_mode, pol, pod, ce_mercante, charge_status, financial_status, created_at, cancelled_at, bb_weight_ton, bb_packages_total, bb_packages_qty, bb_machine_qty, bb_cbm, voyage:voyages(id, voyage_number, vessel:vessels(name)), bl_containers(id, container_number), bl_breakbulk_items(id)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as FichaBlRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

export type FichaInvoiceRow = FichaLocalInvoiceRow & {
  invoice_type: string | null
  /** Pagamentos registrados; cobertura por consolidada e abatimento não contam. */
  total_paid_brl?: number | null
  bl_ids: string[]
}

/** Faturas de Taxas Locais do Cliente com os B/Ls de cada uma (direta, consolidada ou granito). */
export async function fetchCustomerInvoices(customerId: number): Promise<Restrictable<FichaInvoiceRow>> {
  const { rows, error } = await fetchAllRows<{ id: number; invoice_number: string | null; issued_at: string | null; total_brl: number | null; balance_brl: number | null; total_paid_brl: number | null; status: string | null; invoice_type: string | null; bl_id: string | null; invoice_bls: Array<{ bl_id: string | null }> | null; invoice_receivable_links: Array<{ bl_id: string | null }> | null }>((from, to) => supabase
    .from('invoices')
    .select('id, invoice_number, issued_at, total_brl, balance_brl, total_paid_brl, status, invoice_type, bl_id, invoice_bls(bl_id), invoice_receivable_links(bl_id)')
    .eq('customer_id', customerId)
    .order('issued_at', { ascending: false })
    .range(from, to) as never)
  if (error) { if (classifyDbError(error).kind === 'permissao') return { rows: [], denied: true }; throw error }
  return {
    rows: rows.map((row) => {
      const links = (row.invoice_bls?.length ? row.invoice_bls : row.invoice_receivable_links ?? []).map((link) => String(link.bl_id ?? '').trim()).filter(Boolean)
      const bl_ids = [...new Set(links.length ? links : row.bl_id ? [row.bl_id] : [])]
      return { id: row.id, invoice_number: row.invoice_number, issued_at: row.issued_at, total_brl: row.total_brl, balance_brl: row.balance_brl, total_paid_brl: row.total_paid_brl, status: row.status, invoice_type: row.invoice_type, bl_ids }
    }),
    denied: false,
  }
}

const DEAD_INVOICE_STATUSES = new Set(['cancelled', 'obsolete'])
const OPEN_INVOICE_STATUSES = new Set(['draft', 'issued', 'partially_paid', 'overdue'])

export type FichaInvoiceLine =
  | { kind: 'invoice'; invoice: FichaInvoiceRow; receivables: FichaReceivableRow[] }
  /** B/L com saldo sem fatura viva que o cubra: aparece para o saldo não sumir. */
  | { kind: 'no_invoice'; blId: string; receivable: FichaReceivableRow }

/**
 * Faturas e Recebíveis num bloco só (lote 1 da identidade): uma linha por
 * fatura com os B/Ls dela e o saldo por B/L para abrir na linha; B/L com
 * saldo sem fatura viva vira linha "Sem fatura ativa".
 */
export function buildCustomerInvoiceLines(invoices: FichaInvoiceRow[], receivables: FichaReceivableRow[]): FichaInvoiceLine[] {
  const receivablesByBl = new Map<string, FichaReceivableRow[]>()
  for (const row of receivables) receivablesByBl.set(row.bl_id, [...(receivablesByBl.get(row.bl_id) ?? []), row])
  // Só fatura em aberto cobre saldo vivo: B/L com saldo e fatura paga (ex.:
  // cobrança complementar depois do pagamento) aparece em "Sem fatura ativa".
  const coveredBls = new Set(invoices.filter((invoice) => OPEN_INVOICE_STATUSES.has(invoice.status ?? 'issued')).flatMap((invoice) => invoice.bl_ids))
  const lines: FichaInvoiceLine[] = invoices.map((invoice) => ({
    kind: 'invoice' as const,
    invoice,
    // O saldo vivo do B/L aparece uma vez só: na fatura em aberto que o cobre
    // ou em "Sem fatura ativa". Fatura cancelada não leva recebível; paga ou
    // coberta leva só o razão já liquidado do B/L.
    receivables: DEAD_INVOICE_STATUSES.has(invoice.status ?? '')
      ? []
      : invoice.bl_ids.flatMap((blId) => receivablesByBl.get(blId) ?? []).filter((row) => OPEN_INVOICE_STATUSES.has(invoice.status ?? 'issued') || Number(row.balance_brl) <= 0),
  }))
  for (const row of receivables) {
    if (Number(row.balance_brl) > 0 && row.status !== 'cancelled' && !coveredBls.has(row.bl_id)) lines.push({ kind: 'no_invoice', blId: row.bl_id, receivable: row })
  }
  return lines
}

export type FichaInvoiceFilter = { search: string; situation: '' | 'open' | 'paid' | 'cancelled' | 'no_invoice'; from: string; to: string }

/** Busca por B/L: a consolidada aparece inteira quando um dos B/Ls dela bate. */
export function filterCustomerInvoiceLines(lines: FichaInvoiceLine[], filter: FichaInvoiceFilter): FichaInvoiceLine[] {
  const term = filter.search.trim().toUpperCase()
  return lines.filter((line) => {
    const blIds = line.kind === 'invoice' ? line.invoice.bl_ids : [line.blId]
    if (term && !blIds.some((id) => id.toUpperCase().includes(term)) && !(line.kind === 'invoice' && (line.invoice.invoice_number ?? '').toUpperCase().includes(term))) return false
    if (filter.situation === 'no_invoice') return line.kind === 'no_invoice'
    if (line.kind === 'no_invoice') return filter.situation === '' || filter.situation === 'open'
    const status = line.invoice.status ?? 'issued'
    if (filter.situation === 'paid' && status !== 'paid' && status !== 'covered') return false
    if (filter.situation === 'cancelled' && !DEAD_INVOICE_STATUSES.has(status)) return false
    if (filter.situation === 'open' && (DEAD_INVOICE_STATUSES.has(status) || status === 'paid' || status === 'covered')) return false
    const issued = (line.invoice.issued_at ?? '').slice(0, 10)
    if (filter.from && issued < filter.from) return false
    if (filter.to && issued > filter.to) return false
    return true
  })
}

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
  /** Assunto do evento, para a coluna e o filtro do Histórico. */
  subject: CustomerTimelineSubject
  /** Quem fez: nome, "Sistema" ou `null` quando o registro não guarda autor. Nunca um id. */
  actor: string | null
}

export const CUSTOMER_TIMELINE_SUBJECTS = ['Cadastro', 'Contatos', 'Portal', 'Faturas', 'Pagamentos', 'B/Ls', 'Comunicados'] as const
export type CustomerTimelineSubject = (typeof CUSTOMER_TIMELINE_SUBJECTS)[number]

const SUBJECT_BY_KIND: Record<CustomerTimelineEvent['kind'], CustomerTimelineSubject> = {
  cadastro_audit: 'Cadastro',
  contact_created: 'Contatos',
  contact_configuration_changed: 'Contatos',
  portal_event: 'Portal',
  local_invoice_issued: 'Faturas',
  demurrage_invoice_issued: 'Faturas',
  local_payment: 'Pagamentos',
  demurrage_invoice_paid: 'Pagamentos',
  bl_created: 'B/Ls',
  communication: 'Comunicados',
}

/** Autor guardado mas sem nome legível (perfil sem acesso ao cadastro de usuários): nunca o id. */
const UNKNOWN_ACTOR = 'Usuário interno'

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

// Nome legível do campo gravado por `updateCustomerWithAudit` (coluna crua).
export const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  name: 'Razão social',
  trade_name: 'Nome fantasia',
  address: 'Endereço',
  city: 'Cidade',
  state: 'UF',
  zip: 'CEP',
  notes: 'Notas',
  cnpj_cpf: 'CNPJ',
}

// Data sem hora (`billed_at`/`paid_at` de Demurrage são `date`): o
// `Date.parse` a lê como meia-noite UTC, 21h do dia anterior em Brasília, e o
// evento cairia abaixo de outro do dia anterior. Lida como meia-noite local.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function timelineTime(value: string) {
  const dateOnly = DATE_ONLY.exec(value)
  const time = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime()
    : Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

/** Linha de `audit_logs` do Cliente; desativar/reativar (migration `092`) grava `deactivated`. */
// Rastro da Base de Clientes (`_set_import_context`): vira "Origem: Base de
// Clientes", não justificativa.
const IMPORT_CONTEXT_PREFIX = 'Importação de '

function auditOrigin(justification: string | null) {
  const text = justification?.trim() ?? ''
  if (!text) return ''
  if (text.startsWith(IMPORT_CONTEXT_PREFIX)) return ` · Origem: ${text.slice(IMPORT_CONTEXT_PREFIX.length).split(' · ')[0]}`
  return ` · ${text}`
}

export function auditEventText(row: TimelineSources['auditLogs'][number]) {
  const suffix = auditOrigin(row.justification)
  if (row.field_name === 'deactivated') {
    return { label: row.new_value === 'true' ? 'Cliente desativado' : 'Cliente reativado', detail: row.justification }
  }
  if (row.field_name === 'contact_added') return { label: 'E-mail incluído', detail: `${row.new_value ?? '—'}${suffix}` }
  if (row.field_name === 'contact_removed') return { label: 'E-mail retirado', detail: `${row.old_value ?? '—'}${suffix}` }
  if (row.field_name === 'contact_email') return { label: 'E-mail alterado', detail: `${row.old_value ?? '—'} → ${row.new_value ?? '—'}${suffix}` }
  return {
    label: `Cadastro alterado: ${CUSTOMER_FIELD_LABELS[row.field_name] ?? 'dado cadastral'}`,
    detail: `${row.old_value ?? '—'} → ${row.new_value ?? '—'}${suffix}`,
  }
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
  portalEvents: Array<{ id: number; new_decision: string | null; new_situation: string | null; reason: string | null; created_at: string; actor_id?: string | null; actor_type?: string | null }>
  contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>>
  contactChangeEvents?: ContactChangeEventSource[]
  localInvoices: Array<{ id: number; invoice_number: string | null; issued_at: string | null; status: string | null }>
  payments: Array<{ id: number; amount_brl: number; paid_at: string | null; registered_by_name?: string | null; invoice: { id: number; invoice_number: string | null } | null }>
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
      subject: 'Contatos' as const,
      actor: row.actor_id ? sources.actorNames?.get(row.actor_id) ?? UNKNOWN_ACTOR : origin === 'Sistema' || origin === 'B/L' ? 'Sistema' : null,
    }
  })

  // Motivo escrito pelo sistema é texto técnico ("Reparo automático da fila do
  // Portal durante a leitura."): o Histórico mostra só o autor "Sistema"
  // (lote 1 da identidade). O motivo de uma pessoa é justificativa e fica.
  const actorName = (id: string | null | undefined) => (id ? sources.actorNames?.get(id) ?? UNKNOWN_ACTOR : null)
  const events: Array<Omit<CustomerTimelineEvent, 'subject' | 'actor'> & { actor?: string | null }> = [
    ...sources.auditLogs.filter((row) => row.changed_at).map((row) => ({ kind: row.field_name.startsWith('contact_') ? 'contact_configuration_changed' as const : 'cadastro_audit' as const, sourceId: row.field_name.startsWith('contact_') ? `audit:${row.id}` : String(row.id), at: row.changed_at!, ...auditEventText(row), link: null, actorId: row.changed_by ? (sources.actorNames?.get(row.changed_by) ?? row.changed_by) : null, actor: actorName(row.changed_by) })),
    ...sources.portalEvents.map((row) => ({ kind: 'portal_event' as const, sourceId: String(row.id), at: row.created_at, label: `Portal: ${row.new_decision ? provisioningDecisionLabel(row.new_decision) : row.new_situation ? accountSituationLabel(row.new_situation) : 'evento'}`, detail: row.actor_type === 'system' ? null : row.reason, link: null, actor: row.actor_type === 'system' ? 'Sistema' : actorName(row.actor_id) })),
    ...sources.contacts.filter((row) => row.created_at).map((row) => ({ kind: 'contact_created' as const, sourceId: String(row.id), at: row.created_at!, label: `Contato criado: ${row.name ?? '—'}`, detail: null, link: null })),
    ...contactEvents,
    ...sources.localInvoices.filter((row) => row.issued_at).map((row) => ({ kind: 'local_invoice_issued' as const, sourceId: String(row.id), at: row.issued_at!, label: `Fatura emitida: ${row.invoice_number ?? `INV-${row.id}`}`, detail: null, link: `/taxas-locais?${sources.customerId ? `customer=${sources.customerId}&` : ''}invoice=${row.id}` })),
    ...(sources.payments ?? []).filter((row) => row.paid_at).map((row) => ({ kind: 'local_payment' as const, sourceId: String(row.id), at: row.paid_at!, label: `Pagamento recebido: ${row.invoice?.invoice_number ?? (row.invoice ? `INV-${row.invoice.id}` : '—')}`, detail: formatBRL(row.amount_brl), actor: row.registered_by_name ?? null, link: row.invoice ? `/taxas-locais?${sources.customerId ? `customer=${sources.customerId}&` : ''}invoice=${row.invoice.id}` : null })),
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
  // Pela data, não pelo texto: fontes diferentes podem trazer formatos
  // diferentes do mesmo instante ("T" × espaço, fuso explícito ou não).
  return events.map((event): CustomerTimelineEvent => ({ ...event, subject: SUBJECT_BY_KIND[event.kind], actor: event.actor ?? null })).sort((a, b) => timelineTime(b.at) - timelineTime(a.at) || b.at.localeCompare(a.at))
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
    supabase.from('demurrage_invoices').select('id, doc_number, bl_id, due_date, billed_at, paid_at, total_usd, current_total_brl, status, dispute_open, dispute_status, dispute_subject, discount_mode, discount_value').eq('customer_id', customerId).order('billed_at', { ascending: false }).range(from, to).overrideTypes<FichaDemurrageInvoiceRow[], { merge: false }>(),
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
  const names = await fetchPaymentRegistrarNames(rows.map((row) => row.id))
  return { rows: rows.map((row) => ({ ...row, registered_by_name: names.get(row.id) ?? null })), denied: false }
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

// B16: a sugestão por nome grava `suggested_customer_id` com `customer_id`
// nulo (resolveCustomerLink); é por ela que a ficha do Cliente sugerido acha
// os B/Ls. matched_document é resolvido sozinho (isCustomerReconciliationResolved).
export async function fetchCustomerPendingReconciliation(customerId: number) {
  const { rows, error } = await fetchAllRows<FichaPendingReconciliationRow>((from, to) =>
    supabase.from('bls').select('id, consignee, customer_reconciliation_status').eq('suggested_customer_id', customerId).eq('customer_reconciliation_status', 'matched_name').order('created_at', { ascending: false }).range(from, to).overrideTypes<FichaPendingReconciliationRow[], { merge: false }>(),
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
    // Cadastro e e-mails da Base de Clientes, com origem (migration 404, F-24).
    supabase.rpc('customer_audit_timeline' as never, { p_customer_id: customerId, p_limit: 100 } as never)
      .overrideTypes<TimelineSources['auditLogs'], { merge: false }>(),
    supabase.from('portal_provisioning_events').select('id, new_decision, new_situation, reason, created_at, actor_id, actor_type').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 99),
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
    ...(portalEvents.data ?? []).map((row) => row.actor_id),
  ].filter((id): id is string => Boolean(id))))
  const actorNames = new Map<string, string>()
  if (actorIds.length) {
    const { data: profiles, error: profilesError } = await supabase.from('user_profiles').select('id, full_name').in('id', actorIds)
    if (profilesError && classifyDbError(profilesError).kind !== 'permissao') throw profilesError
    for (const profile of profiles ?? []) actorNames.set(profile.id, profile.full_name)
  }
  const registrarNames = await fetchPaymentRegistrarNames((paymentRows ?? []).map((row) => Number(row.id)))
  return buildCustomerTimeline({
    customerId,
    auditLogs: (auditLogs.data ?? []).filter((row) => row.changed_at).map((row) => ({ ...row, changed_at: row.changed_at! })),
    portalEvents: portalEvents.data ?? [],
    contacts,
    contactChangeEvents: contactChangeRows as ContactChangeEventSource[],
    localInvoices: (localRows ?? []).map((row) => ({ ...row, invoice_number: row.invoice_number ?? null })),
    payments: (paymentRows ?? []).map((row) => ({ ...row, registered_by_name: registrarNames.get(Number(row.id)) ?? null })) as unknown as TimelineSources['payments'],
    demurrageInvoices: demurrageRows,
    bls,
    communications,
    actorNames,
  })
}
