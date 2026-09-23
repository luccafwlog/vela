import type { InvoiceDetail } from './billing'
import type { ConsolidatableReceivable, DemurrageInvoiceItem } from '../types/database'
import type { PortalBillingFilters } from '../lib/portalBillingFilters'
import { callPortalRpc, clientPortalScope, isPortalReadOnly, type PortalScope } from './portalScope'
import { supabase, supabasePortal } from './supabase'

export type PortalSessionOverview = {
  customer_id: number
  customer_name: string
  customer_cnpj_cpf: string
  pending_balance: number | null
  contact_email: string | null
  login_cnpj: string | null
  account_active?: boolean
}

export type PortalInvoiceSummary = {
  id: number
  invoice_number: string | null
  issued_at: string | null
  total_brl: number | null
  total_paid_brl: number | null
  balance_brl: number | null
  status: string | null
  invoice_type: string | null
  vessels: string[]
  voyages: string[]
  vessel_voyages: string[]
  bls: string[]
  pods: string[]
}

export type PortalInvoicePage = {
  rows: PortalInvoiceSummary[]
  totalCount: number
  vesselOptions: string[]
  pods: string[]
}

type PortalInvoiceContainer = {
  id: number
  bl_id: string | null
  container_number: string
  type: string | null
  seal_number: string | null
  gross_weight_kg: number | null
}

export type PortalInvoiceDetail = Omit<InvoiceDetail, 'invoice'> & {
  invoice: (NonNullable<InvoiceDetail['invoice']> & { pix_payload: string | null }) | null
  containers: PortalInvoiceContainer[]
}

export async function portalListConsolidatableReceivables(scope: PortalScope = clientPortalScope) {
  const data = await callPortalRpc<ConsolidatableReceivable[]>(scope, 'portal_list_consolidatable_receivables')
  return ((data ?? []) as ConsolidatableReceivable[]).map((row) => ({
    ...row,
    balance_brl: Number(row.balance_brl ?? 0),
    original_amount_brl: Number(row.original_amount_brl ?? 0),
  }))
}

export async function portalListInvoices(scope: PortalScope = clientPortalScope): Promise<PortalInvoiceSummary[]> {
  const data = await callPortalRpc<PortalInvoiceSummary[]>(scope, 'portal_list_invoices')
  return ((data ?? []) as PortalInvoiceSummary[]).map(normalizePortalInvoiceSummary)
}

function normalizePortalInvoiceSummary(row: PortalInvoiceSummary): PortalInvoiceSummary {
  return {
    ...row,
    total_brl: Number(row.total_brl ?? 0),
    total_paid_brl: Number(row.total_paid_brl ?? 0),
    balance_brl: Number(row.balance_brl ?? 0),
    vessels: row.vessels ?? [],
    voyages: row.voyages ?? [],
    vessel_voyages: row.vessel_voyages ?? [],
    bls: row.bls ?? [],
    pods: row.pods ?? [],
  }
}

function pageArgs(filters: PortalBillingFilters, page: number, pageSize: number) {
  return {
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
    p_status: filters.status || null,
    p_vessel: filters.vessel.trim() || null,
    p_bl: filters.bl.trim() || null,
    p_pod: filters.pod || null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
  }
}

export async function portalListInvoicesPage(
  filters: PortalBillingFilters,
  page: number,
  pageSize = 25,
  scope: PortalScope = clientPortalScope,
): Promise<PortalInvoicePage> {
  const data = await callPortalRpc<unknown>(scope, 'portal_list_invoices_page', pageArgs(filters, page, pageSize))
  const payload = (data ?? {}) as {
    rows?: PortalInvoiceSummary[]
    total_count?: number | string
    vessel_options?: string[]
    pods?: string[]
  }
  return {
    rows: (payload.rows ?? []).map(normalizePortalInvoiceSummary),
    totalCount: Number(payload.total_count ?? 0),
    vesselOptions: payload.vessel_options ?? [],
    pods: payload.pods ?? [],
  }
}

const PORTAL_EXPORT_PAGE_SIZE = 100

async function collectPortalPages<TRow, TPage extends { rows: TRow[]; totalCount: number }>(
  firstPage: TPage,
  loadPage: (page: number) => Promise<TPage>,
): Promise<TRow[]> {
  const rows = [...firstPage.rows]
  const totalPages = Math.ceil(firstPage.totalCount / PORTAL_EXPORT_PAGE_SIZE)
  for (let page = 1; page < totalPages; page += 1) {
    const nextPage = await loadPage(page)
    rows.push(...nextPage.rows)
    if (nextPage.rows.length === 0) break
  }
  return rows
}

export async function portalListInvoicesForExport(
  filters: PortalBillingFilters,
  scope: PortalScope = clientPortalScope,
): Promise<PortalInvoiceSummary[]> {
  const loadPage = (page: number) => portalListInvoicesPage(filters, page, PORTAL_EXPORT_PAGE_SIZE, scope)
  const firstPage = await loadPage(0)
  return collectPortalPages(firstPage, loadPage)
}

export async function portalInvoiceDetails(invoiceId: number, scope: PortalScope = clientPortalScope) {
  const data = await callPortalRpc<unknown>(scope, 'portal_invoice_details', { p_invoice_id: invoiceId })

  const payload = (data ?? {}) as {
    invoice?: InvoiceDetail['invoice']
    bls?: InvoiceDetail['bls']
    items?: InvoiceDetail['items']
    containers?: PortalInvoiceContainer[]
    payments?: InvoiceDetail['payments']
  }

  return {
    invoice: payload.invoice ?? null,
    bls: payload.bls ?? [],
    items: payload.items ?? [],
    containers: payload.containers ?? [],
    payments: payload.payments ?? [],
  } as PortalInvoiceDetail
}

export type PortalDemurrageInvoice = {
  id: number
  doc_number: string
  doc_date: string | null
  due_date: string | null
  billed_at: string | null
  paid_at: string | null
  total_usd: number
  current_roe: number | null
  current_total_brl: number | null
  roe_source: string | null
  updated_at: string | null
  status: string
  pix_payload: string | null
  dispute_open: boolean | null
  discount_type: string | null
  discount_value: number | null
  discount_mode: string | null
  bl_id: string
  pol: string | null
  pod: string | null
  voyage_number: string | null
  vessel_name: string | null
}

export type PortalDemurrageInvoiceDetail = {
  invoice: PortalDemurrageInvoice & { customer_name: string; customer_cnpj_cpf: string }
  items: DemurrageInvoiceItem[]
}

export type PortalCurrentRoe = {
  roe: number
  updatedAt: string
}

export async function portalGetCurrentRoe(scope: PortalScope = clientPortalScope): Promise<PortalCurrentRoe | null> {
  const data = await callPortalRpc<unknown>(scope, 'portal_get_current_roe')
  const row = (Array.isArray(data) ? data[0] : data) as { roe?: number | string; updated_at?: string } | null
  if (row?.roe == null || !row.updated_at) return null
  return { roe: Number(row.roe), updatedAt: row.updated_at }
}

export async function portalListDemurrageInvoices(scope: PortalScope = clientPortalScope): Promise<PortalDemurrageInvoice[]> {
  const data = await callPortalRpc<PortalDemurrageInvoice[]>(scope, 'portal_list_demurrage_invoices')
  return ((data ?? []) as PortalDemurrageInvoice[]).map(normalizePortalDemurrageInvoice)
}

function normalizePortalDemurrageInvoice(row: PortalDemurrageInvoice): PortalDemurrageInvoice {
  return {
    ...row,
    total_usd: Number(row.total_usd ?? 0),
    current_total_brl: row.current_total_brl != null ? Number(row.current_total_brl) : null,
  }
}

export type PortalDemurrageInvoicePage = {
  rows: PortalDemurrageInvoice[]
  totalCount: number
  vesselOptions: string[]
  pods: string[]
}

export async function portalListDemurrageInvoicesPage(
  filters: PortalBillingFilters,
  page: number,
  pageSize = 25,
  scope: PortalScope = clientPortalScope,
): Promise<PortalDemurrageInvoicePage> {
  const data = await callPortalRpc<unknown>(scope, 'portal_list_demurrage_invoices_page', pageArgs(filters, page, pageSize))
  const payload = (data ?? {}) as {
    rows?: PortalDemurrageInvoice[]
    total_count?: number | string
    vessel_options?: string[]
    pods?: string[]
  }
  return {
    rows: (payload.rows ?? []).map(normalizePortalDemurrageInvoice),
    totalCount: Number(payload.total_count ?? 0),
    vesselOptions: payload.vessel_options ?? [],
    pods: payload.pods ?? [],
  }
}

export async function portalListDemurrageInvoicesForExport(
  filters: PortalBillingFilters,
  scope: PortalScope = clientPortalScope,
): Promise<PortalDemurrageInvoice[]> {
  const loadPage = (page: number) => portalListDemurrageInvoicesPage(filters, page, PORTAL_EXPORT_PAGE_SIZE, scope)
  const firstPage = await loadPage(0)
  return collectPortalPages(firstPage, loadPage)
}

export async function portalGetDemurrageInvoiceDetail(invoiceId: number, scope: PortalScope = clientPortalScope): Promise<PortalDemurrageInvoiceDetail> {
  const data = await callPortalRpc<unknown>(scope, 'portal_get_demurrage_invoice_detail', { p_invoice_id: invoiceId })
  const payload = (data ?? {}) as { invoice?: PortalDemurrageInvoiceDetail['invoice']; items?: DemurrageInvoiceItem[] }
  return { invoice: payload.invoice!, items: payload.items ?? [] }
}

export async function portalCreateConsolidation(input: { receivableIds: number[] }, scope: PortalScope = clientPortalScope) {
  const data = await callPortalRpc(scope, 'portal_create_consolidation', { p_receivable_ids: input.receivableIds })
  return (data ?? {}) as Record<string, unknown>
}

/**
 * @deprecated A chamada direta no cliente foi revogada (ADR 0047). A resolução
 * de login do Portal agora é executada exclusivamente server-side via Edge
 * Function `portal-login`.
 */
export async function portalResolveLogin(login: string): Promise<string> {
  const { data, error } = await supabasePortal.rpc('portal_resolve_login', {
    p_login: login,
  })
  if (error) throw error
  return String(data ?? '')
}

export type PortalNotification = {
  id: number
  type: string
  title: string
  message: string
  link: string | null
  read: boolean
  created_at: string
}

export async function portalListNotifications(scope: PortalScope = clientPortalScope): Promise<PortalNotification[]> {
  const data = await callPortalRpc<PortalNotification[]>(scope, 'portal_list_notifications', { p_limit: 20 })
  return (data ?? []) as PortalNotification[]
}

export async function portalNotificationUnreadCount(scope: PortalScope = clientPortalScope): Promise<number> {
  const data = await callPortalRpc<unknown>(scope, 'portal_notification_unread_count')
  return Number(data ?? 0)
}

export async function portalMarkNotificationRead(notificationId: number, scope: PortalScope = clientPortalScope): Promise<void> {
  await callPortalRpc(scope, 'portal_mark_notification_read', { p_notification_id: notificationId })
}

export async function portalMarkAllNotificationsRead(scope: PortalScope = clientPortalScope): Promise<void> {
  await callPortalRpc(scope, 'portal_mark_all_notifications_read')
}

export async function portalOpenDemurrageDispute(demurrageInvoiceId: number, reason: string, scope: PortalScope = clientPortalScope): Promise<void> {
  await callPortalRpc(scope, 'portal_open_demurrage_dispute', { p_demurrage_invoice_id: demurrageInvoiceId, p_reason: reason })
}

export type PortalDisputeMessage = {
  id: number
  author_type: 'cliente' | 'equipamentos' | 'administrativo' | 'sistema'
  body: string
  next_responder: 'cliente' | 'equipamentos' | 'ninguem'
  created_at: string
  attachments: Array<{ id: number; file_name: string; mime_type: string; storage_path: string }>
}

export type PortalDispute = {
  id: number
  demurrage_invoice_id: number
  doc_number: string
  state: 'aberta' | 'resolvida' | 'cancelada'
  next_responder: 'cliente' | 'equipamentos' | 'ninguem'
  subject: string | null
  created_at: string
  updated_at: string
  messages: PortalDisputeMessage[]
}

export async function portalListDisputes(scope: PortalScope = clientPortalScope): Promise<PortalDispute[]> {
  const data = await callPortalRpc<PortalDispute[]>(scope, 'portal_list_disputes')
  return Array.isArray(data) ? data : []
}

export async function portalAddDisputeMessage(demurrageInvoiceId: number, body: string, scope: PortalScope = clientPortalScope) {
  return callPortalRpc<{ dispute_id: number; message_id: number }>(scope, 'portal_add_dispute_message', {
    p_demurrage_invoice_id: demurrageInvoiceId,
    p_body: body,
  })
}

export async function portalUploadDisputeAttachment(
  messageId: number,
  disputeId: number,
  file: File,
  scope: PortalScope = clientPortalScope,
) {
  if (isPortalReadOnly(scope)) {
    throw new Error('Upload de anexo indisponível em Modo Inspeção.')
  }
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
  if (!allowed.has(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Anexo inválido. Use PDF, JPG, PNG ou TXT de até 10 MB.')
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('message_id', String(messageId))
  formData.append('dispute_id', String(disputeId))

  const { data, error } = await supabasePortal.functions.invoke('portal-dispute-attachment', {
    body: formData,
  })
  if (error) {
    let serverMessage: string | undefined
    let serverCode: string | undefined
    if ('context' in error && error.context && typeof (error.context as { json?: unknown }).json === 'function') {
      try {
        const body = await (error.context as { json: () => Promise<{ error?: string; code?: string }> }).json()
        if (body && typeof body.error === 'string') {
          serverMessage = body.error
          serverCode = body.code
        }
      } catch {
        // ignora falha de parse
      }
    }
    const message = serverMessage || (error as { message?: string }).message || 'Falha ao enviar anexo.'
    const err = new Error(message) as Error & { code?: string; isUserSafe?: boolean }
    if (serverCode) err.code = serverCode
    if (serverMessage) err.isUserSafe = true
    throw err
  }
  return data
}

export async function portalCheckDisputeAttachmentEligibility(
  disputeId: number,
  sizeBytes: number,
  scope: PortalScope = clientPortalScope,
) {
  if (isPortalReadOnly(scope)) {
    throw new Error('Upload de anexo indisponível em Modo Inspeção.')
  }
  const client = scope.mode === 'inspect' ? supabase : supabasePortal
  const { data, error } = await (client as unknown as { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string; code?: string } | null }> }).rpc(
    'portal_check_dispute_attachment_eligibility',
    {
      p_dispute_id: disputeId,
      p_size_bytes: sizeBytes,
    },
  )
  if (error) {
    const err = new Error(error.message) as Error & { code?: string; isUserSafe?: boolean }
    err.code = error.code
    err.isUserSafe = true
    throw err
  }
  return data
}

export async function portalRequestDisputeReopen(disputeId: number, body: string, scope: PortalScope = clientPortalScope) {
  await callPortalRpc(scope, 'portal_request_dispute_reopen', { p_dispute_id: disputeId, p_body: body })
}

export type PortalProfile = {
  contact_email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export async function portalGetProfile(scope: PortalScope = clientPortalScope): Promise<PortalProfile> {
  const data = await callPortalRpc<PortalProfile>(scope, 'portal_get_profile')
  return (data ?? {}) as PortalProfile
}

export async function portalUpdateProfile(input: {
  contactEmail?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}, scope: PortalScope = clientPortalScope): Promise<void> {
  await callPortalRpc(scope, 'portal_update_profile', {
    ...(input.contactEmail == null ? {} : { p_contact_email: input.contactEmail }),
    ...(input.phone == null ? {} : { p_phone: input.phone }),
    ...(input.address == null ? {} : { p_address: input.address }),
    ...(input.city == null ? {} : { p_city: input.city }),
    ...(input.state == null ? {} : { p_state: input.state }),
    ...(input.zip == null ? {} : { p_zip: input.zip }),
  })
}

export async function portalObsoleteConsolidation(invoiceId: number, scope: PortalScope = clientPortalScope) {
  const data = await callPortalRpc(scope, 'portal_obsolete_consolidation', { p_invoice_id: invoiceId })
  return (data ?? {}) as Record<string, unknown>
}
