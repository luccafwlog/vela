import type { DemurrageInvoice } from '../types/database'
import {
  resolveCustomerCommunicationRecipientsByBoxes,
  type CustomerContactBoxLink,
} from './customerCommunicationBoxes'
import { supabase } from './supabase'

export type DemurrageDunningAttempt = {
  attemptDiscriminator: number
  status: string
  createdAt: string
}

export type DemurrageDunningDisplay = {
  invoiceId: number
  attemptCount: number
  nextAttemptNumber: number
  nextDate: string | null
  statusLabel: string
  pauseReason: string | null
  lastAttemptAt: string | null
}

export type DemurrageDunningStatusRow = {
  invoiceId: number
  attemptCount: number
  lastAttemptAt: string | null
  hasValidContact: boolean
  intervalDays: number
}

type DunningClaimStatusRow = {
  invoice_id: number
  attempt_count: number
  last_attempt_at: string | null
}

type DunningContactRow = {
  id: number
  customer_id: number | null
  email: string | null
  deactivated_at?: string | null
}

type SuppressionRow = { email: string; reason?: string | null }

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(value)
}

function parseDate(value: string | null | undefined): Date | null {
  const normalized = value?.trim()
  if (!normalized) return null
  // DATE fields are business dates, not UTC instants. Noon UTC remains on the
  // same calendar day in America/Sao_Paulo and keeps the display stable.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T12:00:00Z`)
    : new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// Colunas lidas com `select('*')` que o tipo gerado ainda não traz.
type DunningInvoiceFields = Pick<DemurrageInvoice, 'paid_at' | 'dispute_open'> & { dunning_suspended_reason?: string | null }

export function demurrageDunningPauseReason(invoice: DunningInvoiceFields, hasValidContact: boolean): string | null {
  if (invoice.paid_at) return 'liquidada'
  // A Régua não cobra Invoice suspensa (migrations 179, 203 e 214): datas do
  // container alteradas depois do pagamento ou com desconto/disputa aberta.
  if (invoice.dunning_suspended_reason?.trim()) return 'datas alteradas, aguarda tratamento'
  if (invoice.dispute_open) return 'disputa aberta'
  if (!hasValidContact) return 'cliente sem contatos válidos'
  return null
}

export function getDemurrageDunningDisplay(
  invoice: Pick<DemurrageInvoice, 'id' | 'first_billed_at' | 'paid_at' | 'dispute_open' | 'status'> & { dunning_suspended_reason?: string | null },
  input: { attempts?: readonly DemurrageDunningAttempt[]; attemptCount?: number; lastAttemptAt?: string | null; hasValidContact?: boolean; intervalDays?: number; now?: Date } = {},
): DemurrageDunningDisplay {
  const attempts = input.attempts ?? []
  const attemptCount = input.attemptCount ?? attempts.length
  const pauseReason = invoice.status === 'cancelled'
    ? 'cancelada'
    : demurrageDunningPauseReason(invoice, input.hasValidContact ?? true)
  const firstBilledAt = parseDate(invoice.first_billed_at)
  const intervalDays = Math.max(1, Math.trunc(input.intervalDays ?? 7))
  const nextDate = firstBilledAt && !pauseReason
    ? addDays(firstBilledAt, attemptCount * intervalDays)
    : null
  const nextAttemptNumber = attemptCount + 1
  const lastAttemptAt = input.lastAttemptAt ?? attempts
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt ?? null

  let statusLabel = `${nextAttemptNumber}ª cobrança`
  if (pauseReason === 'liquidada') statusLabel = 'Régua encerrada: liquidada'
  else if (pauseReason === 'cancelada') statusLabel = 'Régua encerrada: cancelada'
  else if (pauseReason) statusLabel = `Pausada: ${pauseReason}`
  else if (nextDate) statusLabel += `, próxima em ${formatDate(nextDate)}`
  else statusLabel = 'Aguardando primeira emissão'

  return {
    invoiceId: invoice.id,
    attemptCount,
    nextAttemptNumber,
    nextDate: nextDate?.toISOString() ?? null,
    statusLabel,
    pauseReason,
    lastAttemptAt,
  }
}

export function nextDemurrageDunningAttemptNumber(attempts: readonly Pick<DemurrageDunningAttempt, 'attemptDiscriminator'>[]): number {
  return attempts.length ? Math.max(...attempts.map((attempt) => attempt.attemptDiscriminator)) + 1 : 1
}

/** Lê o ponto da régua sem expor o claim server-side à escrita do navegador. */
export async function fetchDemurrageDunningStatuses(
  invoices: readonly Pick<DemurrageInvoice, 'id' | 'customer_id'>[],
): Promise<Map<number, DemurrageDunningStatusRow>> {
  const invoiceIds = [...new Set(invoices.map((invoice) => invoice.id))]
  if (!invoiceIds.length) return new Map()
  const customerIds = [...new Set(invoices.map((invoice) => invoice.customer_id))]
  const [claimsResult, contactsResult, settingsResult] = await Promise.all([
    supabase.rpc('list_demurrage_dunning_claim_statuses', { p_invoice_ids: invoiceIds })
      .overrideTypes<DunningClaimStatusRow[], { merge: false }>(),
    supabase.from('customer_contacts').select('id, customer_id, email, deactivated_at').in('customer_id', customerIds),
    supabase.from('app_settings').select('demurrage_dunning_interval_days').eq('id', 1).maybeSingle(),
  ])
  if (claimsResult.error) throw claimsResult.error
  if (contactsResult.error) throw contactsResult.error

  const contacts = (contactsResult.data ?? []) as DunningContactRow[]
  const contactIds = contacts.map((contact) => contact.id)
  const contactEmails = [...new Set(contacts.flatMap((contact) => {
    const email = (contact.email ?? '').trim()
    return email ? [email, email.toLowerCase()] : []
  }))]
  const [boxLinksResult, communicationSuppressionsResult, portalSuppressionsResult] = await Promise.all([
    contactIds.length
      ? supabase.from('customer_contact_box_links').select('contact_id, box_code').in('contact_id', contactIds).in('box_code', ['financeiro', 'demurrage'])
      : Promise.resolve({ data: [], error: null }),
    contactEmails.length
      ? supabase.from('customer_communication_suppressions').select('email, reason').in('email', contactEmails)
      : Promise.resolve({ data: [], error: null }),
    contactEmails.length
      ? supabase.from('portal_suppressed_emails').select('email, reason').in('email', contactEmails)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (boxLinksResult.error) throw boxLinksResult.error
  if (communicationSuppressionsResult.error) throw communicationSuppressionsResult.error
  if (portalSuppressionsResult.error) throw portalSuppressionsResult.error
  if (settingsResult.error) throw settingsResult.error
  const intervalDays = Math.max(1, Number((settingsResult.data as { demurrage_dunning_interval_days?: number } | null)?.demurrage_dunning_interval_days ?? 7))

  const boxLinks = (boxLinksResult.data ?? []) as CustomerContactBoxLink[]
  const communicationSuppressions = (communicationSuppressionsResult.data ?? []) as SuppressionRow[]
  const portalSuppressions = (portalSuppressionsResult.data ?? []) as SuppressionRow[]

  const validByCustomer = new Map<number, boolean>()
  for (const customerId of customerIds) {
    const customerContacts = contacts.filter((contact) => contact.customer_id === customerId)
    const resolved = resolveCustomerCommunicationRecipientsByBoxes({
      kind: 'cobranca_demurrage',
      contacts: customerContacts.map((contact) => ({
        id: contact.id,
        name: null,
        email: contact.email,
        phone: null,
        is_primary: false,
        deactivated_at: contact.deactivated_at ?? null,
      })),
      boxLinks,
      portalSuppressions,
      communicationSuppressions,
    })
    validByCustomer.set(customerId, !resolved.blocked && resolved.eligible.length > 0)
  }

  const claimsByInvoice = new Map<number, DunningClaimStatusRow>(
    ((claimsResult.data ?? []) as DunningClaimStatusRow[]).map((row) => [row.invoice_id, row]),
  )
  return new Map(invoices.map((invoice) => {
    const claim = claimsByInvoice.get(invoice.id)
    return [invoice.id, {
      invoiceId: invoice.id,
      attemptCount: Number(claim?.attempt_count ?? 0),
      lastAttemptAt: claim?.last_attempt_at ?? null,
      hasValidContact: validByCustomer.get(invoice.customer_id) ?? false,
      intervalDays,
    } satisfies DemurrageDunningStatusRow]
  }))
}
