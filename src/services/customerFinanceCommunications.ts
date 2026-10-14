import type { CustomerContact } from '../types/database'
import {
  CUSTOMER_PORTAL_BILLING_URL,
  renderCeMercanteTaxasTemplate,
  type CustomerCommunicationCeMercanteRow,
  type CustomerCommunicationTemplateInput,
} from './customerCommunicationTemplates'
import {
  customerCommunicationReadinessReasonLabel,
  fetchCustomerLocalChargesCommunicationReadiness,
  type CustomerLocalChargesCommunicationReadiness,
} from './customerCommunicationReadiness'
import {
  dispatchCustomerCommunication,
  type CustomerCommunicationDispatchResult,
} from './customerCommunicationDispatches'
import { type EmailSuppressionRow } from './customerCommunications'
import {
  fetchCommunicationBoxKinds,
  resolveCustomerCommunicationRecipientsByBoxes,
  type CustomerContactBoxLink,
} from './customerCommunicationBoxes'
import { supabase } from './supabase'

type FinanceBlRow = {
  id: string
  voyage_id: number
  customer_id: number
  ce_mercante: string | null
  financial_status: string | null
  pod: string | null
  customer: { id: number; name: string; cnpj_cpf: string } | null
  voyage: { id: number; voyage_number: string; eta: string | null; vessel: { name: string } | null } | null
}

type InvoiceBlRow = {
  bl_id: string | null
  subtotal_brl: number | null
  status?: string | null
  invoice: { id: number; status: string | null } | null
}

type CommunicationHistoryRow = {
  id: number
  status: string
  attempt_discriminator: number
  created_at: string
}

const ACTIVE_LOCAL_INVOICE_STATUSES = new Set(['issued', 'partially_paid', 'paid', 'covered'])

export type CustomerVoyageCommunicationStatus = {
  readiness: CustomerLocalChargesCommunicationReadiness
  latest: {
    id: number
    status: string
    createdAt: string
    attemptDiscriminator: number
  } | null
  blockedReason: string | null
  nextManualAttemptDiscriminator: number
}

export type CeMercanteCommunicationDispatchSummary = {
  status: 'enviado' | 'simulado' | 'parcial' | 'falha' | 'bloqueado' | 'ignorado'
  readiness: CustomerLocalChargesCommunicationReadiness
  sentCount: number
  simulatedCount: number
  communicationIds: number[]
  attemptDiscriminator: number
  reason: string | null
}

function canonicalPortalBillingUrl(value: string): string {
  const normalized = value.replace(/\/+$/, '')
  if (normalized.endsWith('/portal/billing')) return normalized
  if (normalized.endsWith('/portal')) return `${normalized}/billing`
  if (normalized.endsWith('/billing')) return `${normalized.slice(0, -'/billing'.length)}/portal/billing`
  return `${normalized}/portal/billing`
}

function configuredPortalBillingUrl(): string {
  const explicit = String(import.meta.env.VITE_PORTAL_BILLING_URL ?? '').trim()
  if (explicit) return canonicalPortalBillingUrl(explicit)
  const portal = String(import.meta.env.VITE_PORTAL_URL ?? '').trim().replace(/\/+$/, '')
  return portal ? canonicalPortalBillingUrl(portal) : CUSTOMER_PORTAL_BILLING_URL
}

function normalizeNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function firstReason(readiness: CustomerLocalChargesCommunicationReadiness): string | null {
  const reason = readiness.reasons[0] ?? readiness.bls.flatMap((bl) => bl.blocked_reasons)[0]
  return reason ? customerCommunicationReadinessReasonLabel(reason) : null
}

async function fetchFinanceBls(voyageId: number, customerId: number): Promise<FinanceBlRow[]> {
  const { data, error } = await supabase
    .from('bls')
    .select('id, voyage_id, customer_id, ce_mercante, financial_status, pod, customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf), voyage:voyages(id, voyage_number, eta, vessel:vessels(name))')
    .eq('voyage_id', voyageId)
    .eq('customer_id', customerId)
    .overrideTypes<FinanceBlRow[], { merge: false }>()
  if (error) throw error
  return (data ?? [])
    .filter((row) => row.financial_status !== 'cancelled')
    .sort((left, right) => left.id.localeCompare(right.id))
}

async function fetchInvoiceBls(blIds: readonly string[]): Promise<InvoiceBlRow[]> {
  if (!blIds.length) return []
  const { data: directData, error: directError } = await supabase
    .from('invoice_bls')
    .select('bl_id, subtotal_brl, invoice:invoices(id, status)')
    .in('bl_id', [...blIds])
    .overrideTypes<InvoiceBlRow[], { merge: false }>()
  if (directError) throw directError
  const directRows = (directData ?? []).map((row) => ({
    ...row,
    invoice: normalizeNested(row.invoice),
  })).filter((row) => row.bl_id && row.invoice && ACTIVE_LOCAL_INVOICE_STATUSES.has(row.invoice.status ?? ''))
  const directBlIds = new Set(directRows.map((row) => row.bl_id as string))
  const missingBlIds = blIds.filter((blId) => !directBlIds.has(blId))
  if (!missingBlIds.length) return directRows

  // Individual invoices are present in invoice_bls and are mirrored into the
  // ledger. Consolidated invoices only have invoice_receivable_links; prefer
  // the direct source per B/L so the mirror is never counted twice.
  const { data: ledgerData, error: ledgerError } = await supabase
    .from('invoice_receivable_links')
    .select('bl_id, subtotal_brl, status, invoice:invoices(id, status)')
    .in('bl_id', missingBlIds)
    .overrideTypes<InvoiceBlRow[], { merge: false }>()
  if (ledgerError) throw ledgerError
  const ledgerRows = (ledgerData ?? []).map((row) => ({
    ...row,
    invoice: normalizeNested(row.invoice),
  })).filter((row) => row.bl_id && row.status !== 'obsolete' && row.invoice && ACTIVE_LOCAL_INVOICE_STATUSES.has(row.invoice.status ?? ''))
  return [...directRows, ...ledgerRows]
}

async function fetchContacts(customerId: number): Promise<{
  contacts: CustomerContact[]
  boxLinks: CustomerContactBoxLink[]
  communicationSuppressions: EmailSuppressionRow[]
  portalSuppressions: EmailSuppressionRow[]
}> {
  const { data: contactData, error: contactError } = await supabase
    .from('customer_contacts')
    .select('*')
    .eq('customer_id', customerId)
  if (contactError) throw contactError
  const contacts = (contactData ?? []) as CustomerContact[]
  const contactIds = contacts.map((contact) => contact.id)
  const contactEmails = [...new Set(contacts.flatMap((contact) => {
    const email = (contact.email ?? '').trim()
    return email ? [email, email.toLowerCase()] : []
  }))]
  const [boxLinksResult, communicationSuppressionsResult, portalSuppressionsResult] = await Promise.all([
    contactIds.length
      ? supabase.from('customer_contact_box_links').select('contact_id, box_code').in('contact_id', contactIds)
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
  return {
    contacts,
    boxLinks: (boxLinksResult.data ?? []) as CustomerContactBoxLink[],
    communicationSuppressions: (communicationSuppressionsResult.data ?? []) as EmailSuppressionRow[],
    portalSuppressions: (portalSuppressionsResult.data ?? []) as EmailSuppressionRow[],
  }
}

async function fetchCommunicationHistory(voyageId: number, customerId: number): Promise<CommunicationHistoryRow[]> {
  const { data, error } = await supabase
    .from('customer_communications')
    .select('id, status, attempt_discriminator, created_at')
    .eq('kind', 'ce_mercante_taxas')
    .eq('customer_id', customerId)
    .eq('anchor_voyage_id', voyageId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CommunicationHistoryRow[]
}

function nextAttempt(history: readonly CommunicationHistoryRow[]): number {
  if (!history.length) return 1
  return Math.max(...history.map((row) => Number(row.attempt_discriminator) || 0)) + 1
}

function buildCeMercanteInput(
  bls: readonly FinanceBlRow[],
  invoiceBls: readonly InvoiceBlRow[],
): CustomerCommunicationTemplateInput {
  const first = bls[0]
  if (!first?.customer || !first.voyage) throw new Error('Dados de cliente ou viagem ausentes para o comunicado financeiro.')
  const totals = new Map<string, number>()
  for (const link of invoiceBls) {
    const invoice = normalizeNested(link.invoice)
    if (!link.bl_id || !invoice || !ACTIVE_LOCAL_INVOICE_STATUSES.has(invoice.status ?? '')) continue
    totals.set(link.bl_id, (totals.get(link.bl_id) ?? 0) + Number(link.subtotal_brl ?? 0))
  }
  const ceMercanteRows: CustomerCommunicationCeMercanteRow[] = bls.map((bl) => ({
    blId: bl.id,
    ceMercante: bl.ce_mercante?.trim() ?? '',
    totalBrl: totals.get(bl.id) ?? 0,
  }))
  return {
    customerId: first.customer_id,
    customerName: first.customer.name,
    vesselName: first.voyage.vessel?.name ?? '',
    voyageNumber: first.voyage.voyage_number,
    port: first.pod ?? '—',
    milestoneAt: first.voyage.eta ?? '',
    bls: bls.map((bl) => ({ id: bl.id, customerId: bl.customer_id })),
    portalUrl: configuredPortalBillingUrl(),
    ceMercanteRows,
    totalBrl: ceMercanteRows.reduce((sum, row) => sum + row.totalBrl, 0),
  }
}

export async function fetchCustomerVoyageCommunicationStatus(
  voyageId: number,
  customerId: number,
): Promise<CustomerVoyageCommunicationStatus> {
  const readiness = await fetchCustomerLocalChargesCommunicationReadiness(voyageId, customerId)
  const history = await fetchCommunicationHistory(voyageId, customerId)
  const latest = history[0]
  return {
    readiness,
    latest: latest
      ? {
        id: latest.id,
        status: latest.status,
        createdAt: latest.created_at,
        attemptDiscriminator: latest.attempt_discriminator,
      }
      : null,
    blockedReason: readiness.ready ? null : firstReason(readiness),
    nextManualAttemptDiscriminator: nextAttempt(history),
  }
}

export async function dispatchCeMercanteTaxasCommunication(
  voyageId: number,
  customerId: number,
  options: { forceRetry?: boolean } = {},
): Promise<CeMercanteCommunicationDispatchSummary> {
  const readiness = await fetchCustomerLocalChargesCommunicationReadiness(voyageId, customerId)
  if (!readiness.ready) {
    return {
      status: 'bloqueado',
      readiness,
      sentCount: 0,
      simulatedCount: 0,
      communicationIds: [],
      attemptDiscriminator: 0,
      reason: firstReason(readiness),
    }
  }

  const history = await fetchCommunicationHistory(voyageId, customerId)
  const hasAutomaticAttempt = history.some((row) => (
    Number(row.attempt_discriminator) === 0
      && (row.status === 'enviado' || row.status === 'simulado')
  ))
  const automaticAttemptFailed = history.some((row) => (
    Number(row.attempt_discriminator) === 0 && row.status === 'falha'
  ))
  if (hasAutomaticAttempt && !options.forceRetry) {
    return {
      status: 'ignorado',
      readiness,
      sentCount: 0,
      simulatedCount: 0,
      communicationIds: [],
      attemptDiscriminator: 0,
      reason: 'Comunicado automático já registrado; o reenvio deve ser assistido pela tela.',
    }
  }

  const bls = await fetchFinanceBls(voyageId, customerId)
  if (!bls.length) {
    return {
      status: 'bloqueado',
      readiness,
      sentCount: 0,
      simulatedCount: 0,
      communicationIds: [],
      attemptDiscriminator: 0,
      reason: customerCommunicationReadinessReasonLabel('no_bls'),
    }
  }
  const invoiceBls = await fetchInvoiceBls(bls.map((bl) => bl.id))
  const templateInput = buildCeMercanteInput(bls, invoiceBls)
  const [contacts, boxKinds] = await Promise.all([
    fetchContacts(customerId),
    fetchCommunicationBoxKinds('ce_mercante_taxas'),
  ])
  const recipients = resolveCustomerCommunicationRecipientsByBoxes({
    contacts: contacts.contacts,
    boxLinks: contacts.boxLinks,
    boxKinds,
    kind: 'ce_mercante_taxas',
    communicationSuppressions: contacts.communicationSuppressions,
    portalSuppressions: contacts.portalSuppressions,
  })
  if (recipients.blocked) {
    return {
      status: 'bloqueado',
      readiness,
      sentCount: 0,
      simulatedCount: 0,
      communicationIds: [],
      attemptDiscriminator: options.forceRetry || automaticAttemptFailed ? nextAttempt(history) : 0,
      reason: 'Cliente sem contato válido habilitado para Documentação e Operação ou Financeiro.',
    }
  }

  const rendered = renderCeMercanteTaxasTemplate(templateInput)
  const attemptDiscriminator = options.forceRetry || automaticAttemptFailed ? nextAttempt(history) : 0
  const results: CustomerCommunicationDispatchResult[] = []
  for (const contact of recipients.eligible) {
    if (!contact.email?.trim()) continue
    results.push(await dispatchCustomerCommunication({
      customerId,
      kind: 'ce_mercante_taxas',
      nature: 'documentacao',
      audience: { mode: 'caixa', boxCode: contact.matchedBoxCodes[0] ?? 'documentacao_operacao' },
      recipient: contact.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      blIds: rendered.blIds,
      anchorVoyageId: voyageId,
      // A viagem pode ter mais de um POD. O porto não é parte da identidade
      // deste comunicado financeiro agrupado; usar o primeiro B/L tornava a
      // idempotência dependente da ordem arbitrária do SELECT.
      anchorPort: null,
      attemptDiscriminator,
      vesselName: templateInput.vesselName,
      voyageNumber: templateInput.voyageNumber,
      attachments: [],
    }))
  }
  const communicationIds = results.map((result) => result.communicationId).filter((id) => Number.isFinite(id))
  const sentCount = results.filter((result) => result.status === 'enviado').length
  const simulatedCount = results.filter((result) => result.status === 'simulado').length
  const hasFailed = results.some((result) => result.status === 'falha')
  const hasPartial = results.some((result) => result.status === 'parcial')
  const hasSent = sentCount > 0
  const hasSimulated = simulatedCount > 0
  const status = hasSent && !hasSimulated && !hasFailed && !hasPartial
    ? 'enviado'
    : hasSimulated && !hasSent && !hasFailed && !hasPartial
      ? 'simulado'
      : hasSent || hasSimulated || hasPartial
        ? 'parcial'
        : hasFailed
          ? 'falha'
          : 'bloqueado'
  return {
    status,
    readiness,
    sentCount,
    simulatedCount,
    communicationIds,
    attemptDiscriminator,
    reason: results.length
      ? (status === 'falha' ? 'Falha no envio de todos os destinatários.' : null)
      : 'Nenhum contato válido habilitado para Documentação.',
  }
}
