import { supabase } from './supabase'
import { classifyDbError } from '../lib/errors'

const REPORT_ROW_LIMIT = 2000

// created_at/issued_at sao TIMESTAMPTZ; comparar com a data crua descarta tudo que
// foi criado ou emitido depois da meia-noite do ultimo dia do filtro. Fonte unica
// para as quatro visoes, senao cada aba interpreta o mesmo periodo de forma diferente.
function endOfDay(date: string) {
  return `${date}T23:59:59.999`
}

export type ReportFilters = {
  dateFrom: string
  dateTo: string
}

export type OperationalReportFilters = ReportFilters & {
  pod: string
  cargoMode: '' | 'container' | 'carga_solta' | 'misto'
}

export type FinancialReportFilters = ReportFilters & {
  status: '' | 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled'
}

export type OperationalReportRow = {
  id: string
  pol: string | null
  pod: string | null
  cargo_mode: string | null
  review_status: string | null
  financial_status: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  created_at: string | null
  voyage_id: number | null
  customer: { id: number; name: string; cnpj_cpf: string } | null
  voyage: {
    id: number
    voyage_number: string | null
    vessel: {
      id: number
      name: string | null
      carrier: { id: number; name: string | null } | null
    } | null
  } | null
  bl_containers: { id: number; container_number: string | null }[] | null
}

export type OperationalReportResult = {
  rows: OperationalReportRow[]
  kpis: {
    totalBls: number
    totalContainers: number
    totalWeightKg: number
    totalCbm: number
    totalVoyages: number
    truncated: boolean
  }
}

export async function fetchOperationalReport(filters: OperationalReportFilters): Promise<OperationalReportResult> {
  let query = supabase
    .from('bls')
    .select(
      `
      id, pol, pod, cargo_mode, review_status, financial_status,
      total_weight_kg, total_cbm, created_at, voyage_id,
      customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf),
      voyage:voyages(id, voyage_number, vessel:vessels(id, name, carrier:carriers(id, name))),
      bl_containers(id, container_number)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(REPORT_ROW_LIMIT)

  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', endOfDay(filters.dateTo))
  if (filters.pod) query = query.eq('pod', filters.pod.toUpperCase())
  if (filters.cargoMode === 'container') query = query.in('cargo_mode', ['container', 'misto'])
  else if (filters.cargoMode === 'carga_solta') query = query.in('cargo_mode', ['carga_solta', 'misto'])
  else if (filters.cargoMode) query = query.eq('cargo_mode', filters.cargoMode)

  const { data, error } = await query.overrideTypes<OperationalReportRow[], { merge: false }>()
  if (error) throw error

  const rows = data ?? []

  const distinctContainers = new Set<string>()
  for (const row of rows) {
    for (const container of row.bl_containers ?? []) {
      if (container.container_number) distinctContainers.add(container.container_number)
    }
  }

  const distinctVoyages = new Set<number>()
  for (const row of rows) {
    if (row.voyage_id != null) distinctVoyages.add(row.voyage_id)
  }

  const kpis = {
    totalBls: rows.length,
    totalContainers: distinctContainers.size,
    totalWeightKg: rows.reduce((sum, row) => sum + Number(row.total_weight_kg ?? 0), 0),
    totalCbm: rows.reduce((sum, row) => sum + Number(row.total_cbm ?? 0), 0),
    totalVoyages: distinctVoyages.size,
    truncated: rows.length === REPORT_ROW_LIMIT,
  }

  return { rows, kpis }
}

export type FinancialReportRow = {
  id: number
  invoice_number: string | null
  invoice_type: string | null
  status: string | null
  total_brl: number | null
  balance_brl: number | null
  issued_at: string | null
  created_at: string | null
  customer: { id: number; name: string; cnpj_cpf: string } | null
}

export type FinancialReportResult = {
  rows: FinancialReportRow[]
  kpis: {
    totalInvoices: number
    totalIssued: number
    totalPaid: number
    totalOpen: number
    totalCanceled: number
    truncated: boolean
  }
  accessDenied: boolean
}

export async function fetchFinancialReport(filters: FinancialReportFilters): Promise<FinancialReportResult> {
  let query = supabase
    .from('invoices')
    .select(
      `
      id, invoice_number, invoice_type, status, total_brl, balance_brl, issued_at, created_at,
      customer:customers(id, name, cnpj_cpf)
    `,
    )
    .order('issued_at', { ascending: false, nullsFirst: false })
    .limit(REPORT_ROW_LIMIT)

  if (filters.dateFrom) query = query.gte('issued_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('issued_at', endOfDay(filters.dateTo))
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query.overrideTypes<FinancialReportRow[], { merge: false }>()
  if (error) {
    if (isAccessDenied(error)) {
      return {
        rows: [],
        kpis: { totalInvoices: 0, totalIssued: 0, totalPaid: 0, totalOpen: 0, totalCanceled: 0, truncated: false },
        accessDenied: true,
      }
    }
    throw error
  }

  const rows = data ?? []
  const receivables = await fetchReceivableLinksByInvoiceIds(rows.filter(isLedgerLocalInvoice).map((row) => row.id))
  if (receivables.accessDenied) {
    return {
      rows: [],
      kpis: { totalInvoices: 0, totalIssued: 0, totalPaid: 0, totalOpen: 0, totalCanceled: 0, truncated: false },
      accessDenied: true,
    }
  }
  const ledgerBalances = summarizeReceivableBalances(receivables.links)
  const rowsWithLedgerBalances = applyReceivableBalances(rows, ledgerBalances)

  const isOpen = (status: string | null) =>
    status === 'issued' || status === 'partially_paid'

  const fallbackOpen = rowsWithLedgerBalances
    .filter((row) => isOpen(row.status) && !ledgerBalances.linksByInvoiceId.has(row.id))
    .reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0)

  const kpis = {
    totalInvoices: rowsWithLedgerBalances.length,
    totalIssued: rowsWithLedgerBalances
      .filter((row) => row.status !== 'cancelled' && row.status !== 'draft')
      .reduce((sum, row) => sum + Number(row.total_brl ?? 0), 0),
    totalPaid: rowsWithLedgerBalances
      .filter((row) => row.status === 'paid')
      .reduce((sum, row) => sum + Number(row.total_brl ?? 0), 0),
    totalOpen: ledgerBalances.uniqueOpenBalance + fallbackOpen,
    totalCanceled: rowsWithLedgerBalances.filter((row) => row.status === 'cancelled').length,
    truncated: rowsWithLedgerBalances.length === REPORT_ROW_LIMIT,
  }

  return { rows: rowsWithLedgerBalances, kpis, accessDenied: false }
}

export type CustomerReportRow = {
  customer_id: number
  name: string
  cnpj_cpf: string
  blCount: number
  totalWeightKg: number
  totalCbm: number
  invoiceCount: number
  totalIssued: number
  totalBalance: number
}

export type CustomerReportResult = {
  rows: CustomerReportRow[]
  kpis: {
    totalCustomers: number
    topByBls: string
    topByInvoiced: string
    totalIssued: number
    truncated: boolean
  }
  invoicesAccessDenied: boolean
}

export async function fetchCustomerReport(filters: ReportFilters): Promise<CustomerReportResult> {
  type BlRow = {
    customer_id: number
    total_weight_kg: number | null
    total_cbm: number | null
    customer: { id: number; name: string; cnpj_cpf: string } | null
  }

  let blsQuery = supabase
    .from('bls')
    .select(
      `id, customer_id, total_weight_kg, total_cbm, created_at,
       customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf)`,
    )
    .not('customer_id', 'is', null)
    .limit(REPORT_ROW_LIMIT * 2)

  if (filters.dateFrom) blsQuery = blsQuery.gte('created_at', filters.dateFrom)
  if (filters.dateTo) blsQuery = blsQuery.lte('created_at', endOfDay(filters.dateTo))

  const { data: blsData, error: blsError } = await blsQuery.overrideTypes<BlRow[], { merge: false }>()
  if (blsError) throw blsError

  const bls = blsData ?? []

  const perCustomer = new Map<number, CustomerReportRow>()
  for (const bl of bls) {
    if (bl.customer_id == null || !bl.customer) continue
    let entry = perCustomer.get(bl.customer_id)
    if (!entry) {
      entry = {
        customer_id: bl.customer_id,
        name: bl.customer.name,
        cnpj_cpf: bl.customer.cnpj_cpf,
        blCount: 0,
        totalWeightKg: 0,
        totalCbm: 0,
        invoiceCount: 0,
        totalIssued: 0,
        totalBalance: 0,
      }
      perCustomer.set(bl.customer_id, entry)
    }
    entry.blCount++
    entry.totalWeightKg += Number(bl.total_weight_kg ?? 0)
    entry.totalCbm += Number(bl.total_cbm ?? 0)
  }

  let invoicesAccessDenied = false
  type InvoiceRow = {
    id: number
    customer_id: number
    invoice_type: string | null
    total_brl: number | null
    balance_brl: number | null
    status: string | null
  }

  let invoicesQuery = supabase
    .from('invoices')
    .select('id, customer_id, invoice_type, total_brl, balance_brl, status, issued_at')
    .not('customer_id', 'is', null)
    .limit(REPORT_ROW_LIMIT * 2)

  if (filters.dateFrom) invoicesQuery = invoicesQuery.gte('issued_at', filters.dateFrom)
  if (filters.dateTo) invoicesQuery = invoicesQuery.lte('issued_at', endOfDay(filters.dateTo))

  const { data: invoicesData, error: invoicesError } = await invoicesQuery.overrideTypes<InvoiceRow[], { merge: false }>()
  if (invoicesError) {
    if (isAccessDenied(invoicesError)) {
      invoicesAccessDenied = true
    } else {
      throw invoicesError
    }
  }

  const invoices = invoicesData ?? []
  const receivables = invoicesAccessDenied
    ? { links: [] as ReceivableLinkRow[], accessDenied: false }
    : await fetchReceivableLinksByInvoiceIds(invoices.filter(isLedgerLocalInvoice).map((invoice) => invoice.id))
  if (receivables.accessDenied) invoicesAccessDenied = true
  const ledgerBalances = summarizeReceivableBalances(receivables.links)
  const countedReceivablesByCustomer = new Set<string>()

  if (!invoicesAccessDenied) {
    for (const invoice of invoices) {
      if (invoice.customer_id == null) continue
      const entry = perCustomer.get(invoice.customer_id)
      if (!entry) continue
      if (invoice.status === 'cancelled') continue
      entry.invoiceCount++
      const links = ledgerBalances.linksByInvoiceId.get(invoice.id) ?? []
      if (isLedgerLocalInvoice(invoice) && links.length > 0) {
        for (const link of links) {
          const receivable = normalizeReceivable(link.receivable)
          if (!receivable) continue
          const key = `${invoice.customer_id}:${link.receivable_id}`
          if (countedReceivablesByCustomer.has(key)) continue
          countedReceivablesByCustomer.add(key)
          entry.totalIssued += Number(receivable.original_amount_brl ?? 0)
          entry.totalBalance += Number(receivable.balance_brl ?? 0)
        }
        continue
      }
      entry.totalIssued += Number(invoice.total_brl ?? 0)
      entry.totalBalance += Number(invoice.balance_brl ?? 0)
    }
  }

  const rows = [...perCustomer.values()].sort((a, b) => {
    if (b.totalIssued !== a.totalIssued) return b.totalIssued - a.totalIssued
    return b.blCount - a.blCount
  })

  const topByBls = [...rows].sort((a, b) => b.blCount - a.blCount)[0]?.name ?? '-'
  const topByInvoiced = rows[0] && rows[0].totalIssued > 0 ? rows[0].name : '-'

  const kpis = {
    totalCustomers: rows.length,
    topByBls,
    topByInvoiced,
    totalIssued: rows.reduce((sum, row) => sum + row.totalIssued, 0),
    // Duas consultas independentes; qualquer uma no teto ja torna os totais parciais.
    truncated: bls.length === REPORT_ROW_LIMIT * 2 || invoices.length === REPORT_ROW_LIMIT * 2,
  }

  return { rows, kpis, invoicesAccessDenied }
}

// ─── Export variants (no row limit — for XLSX download) ───────────────────

export async function fetchOperationalReportForExport(filters: OperationalReportFilters): Promise<OperationalReportRow[]> {
  let query = supabase
    .from('bls')
    .select(
      `
      id, pol, pod, cargo_mode, review_status, financial_status,
      total_weight_kg, total_cbm, created_at, voyage_id,
      customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf),
      voyage:voyages(id, voyage_number, vessel:vessels(id, name, carrier:carriers(id, name))),
      bl_containers(id, container_number)
    `,
    )
    .order('created_at', { ascending: false })

  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', endOfDay(filters.dateTo))
  if (filters.pod) query = query.eq('pod', filters.pod.toUpperCase())
  if (filters.cargoMode === 'container') query = query.in('cargo_mode', ['container', 'misto'])
  else if (filters.cargoMode === 'carga_solta') query = query.in('cargo_mode', ['carga_solta', 'misto'])
  else if (filters.cargoMode) query = query.eq('cargo_mode', filters.cargoMode)

  const { data, error } = await query.overrideTypes<OperationalReportRow[], { merge: false }>()
  if (error) throw error
  return data ?? []
}

export async function fetchFinancialReportForExport(filters: FinancialReportFilters): Promise<FinancialReportRow[]> {
  let query = supabase
    .from('invoices')
    .select(
      `
      id, invoice_number, invoice_type, status, total_brl, balance_brl, issued_at, created_at,
      customer:customers(id, name, cnpj_cpf)
    `,
    )
    .order('issued_at', { ascending: false, nullsFirst: false })

  if (filters.dateFrom) query = query.gte('issued_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('issued_at', endOfDay(filters.dateTo))
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query.overrideTypes<FinancialReportRow[], { merge: false }>()
  if (error) throw error
  const rows = data ?? []
  const receivables = await fetchReceivableLinksByInvoiceIds(rows.filter(isLedgerLocalInvoice).map((row) => row.id))
  if (receivables.accessDenied) throw new Error('Visualização financeira restrita ao perfil admin.')
  return applyReceivableBalances(rows, summarizeReceivableBalances(receivables.links))
}

type LedgerInvoiceLike = {
  id: number
  invoice_type?: string | null
}

type ReceivableLinkRow = {
  invoice_id: number
  receivable_id: number
  status: string | null
  receivable:
    | {
        id?: number | null
        original_amount_brl?: number | string | null
        balance_brl?: number | string | null
        status?: string | null
      }
    | {
        id?: number | null
        original_amount_brl?: number | string | null
        balance_brl?: number | string | null
        status?: string | null
      }[]
    | null
}

function isLedgerLocalInvoice(invoice: LedgerInvoiceLike) {
  return invoice.invoice_type === 'individual' || invoice.invoice_type === 'consolidated'
}

function isAccessDenied(error: unknown): boolean {
  const kind = classifyDbError(error).kind
  return kind === 'permissao' || kind === 'sessao_expirada'
}

async function fetchReceivableLinksByInvoiceIds(invoiceIds: number[]) {
  const uniqueIds = [...new Set(invoiceIds)].filter((id) => Number.isFinite(id))
  if (!uniqueIds.length) return { links: [] as ReceivableLinkRow[], accessDenied: false }

  const { data, error } = await supabase
    .from('invoice_receivable_links')
    .select('invoice_id, receivable_id, status, receivable:bl_receivables(id, original_amount_brl, balance_brl, status)')
    .in('invoice_id', uniqueIds)
    .overrideTypes<ReceivableLinkRow[], { merge: false }>()

  if (error) {
    if (isAccessDenied(error)) return { links: [] as ReceivableLinkRow[], accessDenied: true }
    throw error
  }

  return { links: data ?? [], accessDenied: false }
}

function normalizeReceivable(receivable: ReceivableLinkRow['receivable']) {
  if (Array.isArray(receivable)) return receivable[0] ?? null
  return receivable
}

function summarizeReceivableBalances(links: ReceivableLinkRow[]) {
  const invoiceBalanceById = new Map<number, number>()
  const linksByInvoiceId = new Map<number, ReceivableLinkRow[]>()
  const openReceivables = new Map<number, number>()

  for (const link of links) {
    const receivable = normalizeReceivable(link.receivable)
    if (!receivable) continue

    const invoiceLinks = linksByInvoiceId.get(link.invoice_id) ?? []
    invoiceLinks.push(link)
    linksByInvoiceId.set(link.invoice_id, invoiceLinks)

    if (link.status !== 'active') continue
    const balance = Number(receivable.balance_brl ?? 0)
    invoiceBalanceById.set(link.invoice_id, (invoiceBalanceById.get(link.invoice_id) ?? 0) + balance)

    if (balance > 0 && receivable.status !== 'settled' && receivable.status !== 'void') {
      openReceivables.set(link.receivable_id, balance)
    }
  }

  return {
    invoiceBalanceById,
    linksByInvoiceId,
    uniqueOpenBalance: [...openReceivables.values()].reduce((sum, balance) => sum + balance, 0),
  }
}

function applyReceivableBalances<T extends FinancialReportRow>(rows: T[], summary: ReturnType<typeof summarizeReceivableBalances>) {
  return rows.map((row) => {
    if (!isLedgerLocalInvoice(row) || !summary.linksByInvoiceId.has(row.id)) return row
    return { ...row, balance_brl: summary.invoiceBalanceById.get(row.id) ?? 0 }
  })
}
