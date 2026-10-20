import { supabase } from './supabase'
import { classifyDbError } from '../lib/errors'
import { blTotalCbm, blTotalWeightKg } from '../lib/cargoMode'
import { saoPauloTodayIso } from '../lib/dates'
import { storedPortAliases } from './portCode'
import type { DemurrageInvoiceListItem } from './demurrage/demurrageInvoices'

// ─── Leitura em páginas (achado R2 do lote 5b) ────────────────────────────
// O servidor entrega no máximo 1.000 linhas por consulta (`max_rows` em
// supabase/config.toml). Pedir mais com `.limit()` não adianta: a resposta
// para em 1.000 sem erro. Cada relatório lê em páginas até o fim do recorte;
// a tela para num teto declarado e avisa quantas linhas faltam, e a planilha
// lê tudo.

export const REPORT_PAGE_SIZE = 1000
// ponytail: teto fixo da tela. Acima dele os indicadores ficam parciais (com
// aviso) e só a planilha traz o recorte inteiro. Upgrade: agregar no banco.
export const REPORT_SCREEN_CEILING = 10_000

type PageResponse<T> = { data: T[] | null; error: unknown; count?: number | null }

/** Linhas carregadas e o total do recorte no banco (`count` da primeira página). */
export type ReportLoad = { loaded: number; total: number }

export type PagedRows<T> = { rows: T[]; load: ReportLoad }

/**
 * Lê `fetchPage(from, to)` até o fim do recorte ou até `ceiling`. Avança pelo
 * que chegou, não pelo que pediu: um servidor com `max_rows` menor que a
 * página não pula linhas. A primeira página deve pedir `count: 'exact'`
 * (`reportSelectOptions`), que diz quando parar e quantas linhas faltam.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  options: { pageSize?: number; ceiling?: number } = {},
): Promise<PagedRows<T>> {
  const pageSize = options.pageSize ?? REPORT_PAGE_SIZE
  const ceiling = options.ceiling ?? Number.POSITIVE_INFINITY
  const rows: T[] = []
  let total: number | null = null

  while (rows.length < ceiling) {
    const from = rows.length
    const to = Math.min(from + pageSize, ceiling) - 1
    const { data, error, count } = await fetchPage(from, to)
    if (error) throw error
    if (total === null && typeof count === 'number') total = count
    const page = data ?? []
    rows.push(...page)
    if (page.length === 0) break
    if (total !== null ? rows.length >= total : page.length < to - from + 1) break
  }

  const loaded = rows.length
  return { rows, load: { loaded, total: Math.max(total ?? loaded, loaded) } }
}

/** `count: 'exact'` só na primeira página: as demais não precisam recontar. */
export function reportSelectOptions(from: number) {
  return from === 0 ? { count: 'exact' as const } : undefined
}

export function isReportComplete(load: ReportLoad) {
  return load.loaded >= load.total
}

// ─── Período em horário de Brasília (achado R4) ───────────────────────────
// created_at/issued_at são TIMESTAMPTZ. A data crua seria lida em UTC e cortaria
// o dia 3 horas antes da meia-noite de Brasília. Fonte única das quatro visões.
// ponytail: fuso fixo -03:00; o Brasil não tem horário de verão desde 2019.

export function brasiliaStartOfDay(date: string) {
  return `${date}T00:00:00-03:00`
}

export function brasiliaEndOfDay(date: string) {
  return `${date}T23:59:59.999-03:00`
}

/** Período padrão do Demurrage: do 1º de janeiro até hoje, no calendário de Brasília. */
export function defaultDemurragePeriod(now = new Date()) {
  const today = saoPauloTodayIso(now)
  return { dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: today }
}

// ─── Filtros ──────────────────────────────────────────────────────────────

/** Período, Navio / Viagem e Cliente: sempre abertos nas quatro visões. */
export type ReportScope = {
  dateFrom: string
  dateTo: string
  voyageId: string
  customerId: string
}

export type ReviewFilter = '' | 'pendente' | 'em-ordem'
export type LocalChargesFilter = '' | 'pendente' | 'emitida' | 'paga' | 'isenta'
export type YesNoFilter = '' | 'sim' | 'nao'

export type OperationalReportFilters = ReportScope & {
  pol: string
  pod: string
  cargoMode: '' | 'container' | 'carga_solta' | 'misto'
  review: ReviewFilter
  localCharges: LocalChargesFilter
}

export type FinancialReportFilters = ReportScope & {
  status: '' | 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled'
  consolidated: YesNoFilter
  balance: '' | 'aberto' | 'zerado'
}

export type CustomerReportFilters = ReportScope

export type DemurrageReportFilters = ReportScope & {
  status: '' | 'draft' | 'issued' | 'paid' | 'cancelled'
  dispute: YesNoFilter
  overdue: '' | 'sim'
}

type ReportOptions = { ceiling?: number }

function positiveId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// ─── Operacional ──────────────────────────────────────────────────────────

export type OperationalReportRow = {
  id: string
  pol: string | null
  pod: string | null
  cargo_mode: string | null
  review_status: string | null
  financial_status: string | null
  charge_status: string | null
  cancelled_at: string | null
  total_weight_kg: number | null
  bb_weight_ton: number | null
  total_cbm: number | null
  bb_cbm: number | null
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
  }
  load: ReportLoad
}

const OPERATIONAL_SELECT = `
  id, pol, pod, cargo_mode, review_status, financial_status, charge_status, cancelled_at,
  total_weight_kg, bb_weight_ton, total_cbm, bb_cbm, created_at, voyage_id,
  customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf),
  voyage:voyages(id, voyage_number, vessel:vessels(id, name, carrier:carriers(id, name))),
  bl_containers(id, container_number)
`

const LOCKED_FINANCIAL_STATUSES = '(invoiced,partially_paid,paid)'

export async function fetchOperationalReport(filters: OperationalReportFilters, options: ReportOptions = {}): Promise<OperationalReportResult> {
  const ceiling = options.ceiling ?? REPORT_SCREEN_CEILING
  const { rows, load } = await fetchAllPages<OperationalReportRow>((from, to) => {
    let query = supabase
      .from('bls')
      .select(OPERATIONAL_SELECT, reportSelectOptions(from))
      // id desempata: sem ele, B/Ls criados no mesmo instante trocam de página.
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })

    if (filters.dateFrom) query = query.gte('created_at', brasiliaStartOfDay(filters.dateFrom))
    if (filters.dateTo) query = query.lte('created_at', brasiliaEndOfDay(filters.dateTo))
    const voyageId = positiveId(filters.voyageId)
    if (voyageId) query = query.eq('voyage_id', voyageId)
    const customerId = positiveId(filters.customerId)
    if (customerId) query = query.eq('customer_id', customerId)
    // As opções de POL/POD são canônicas (BRVIX); a coluna guarda a grafia
    // importada (BRVIT). Filtra por todas as grafias do mesmo porto.
    if (filters.pol) query = query.in('pol', storedPortAliases(filters.pol))
    if (filters.pod) query = query.in('pod', storedPortAliases(filters.pod))
    if (filters.cargoMode === 'container') query = query.in('cargo_mode', ['container', 'misto'])
    else if (filters.cargoMode === 'carga_solta') query = query.in('cargo_mode', ['carga_solta', 'misto'])
    else if (filters.cargoMode) query = query.eq('cargo_mode', filters.cargoMode)
    if (filters.review === 'pendente') query = query.eq('review_status', 'pending_review')
    else if (filters.review === 'em-ordem') query = query.or('review_status.is.null,review_status.neq.pending_review')
    // Mesmos estados de `localChargesListState`/`public.bl_local_charges_state`,
    // com Paga separada de Emitida (coluna "Taxas locais" do relatório).
    if (filters.localCharges) {
      query = query.is('cancelled_at', null)
      if (filters.localCharges === 'isenta') query = query.eq('charge_status', 'exempt')
      else {
        query = query.or('charge_status.is.null,charge_status.neq.exempt')
        if (filters.localCharges === 'emitida') query = query.in('financial_status', ['invoiced', 'partially_paid'])
        else if (filters.localCharges === 'paga') query = query.eq('financial_status', 'paid')
        else query = query.or(`financial_status.is.null,financial_status.not.in.${LOCKED_FINANCIAL_STATUSES}`)
      }
    }
    return query.range(from, to).overrideTypes<OperationalReportRow[], { merge: false }>()
  }, { ceiling })

  const distinctContainers = new Set<string>()
  const distinctVoyages = new Set<number>()
  for (const row of rows) {
    for (const container of row.bl_containers ?? []) {
      if (container.container_number) distinctContainers.add(container.container_number)
    }
    if (row.voyage_id != null) distinctVoyages.add(row.voyage_id)
  }

  return {
    rows,
    kpis: {
      totalBls: rows.length,
      totalContainers: distinctContainers.size,
      totalWeightKg: rows.reduce((sum, row) => sum + blTotalWeightKg(row), 0),
      totalCbm: rows.reduce((sum, row) => sum + blTotalCbm(row), 0),
      totalVoyages: distinctVoyages.size,
    },
    load,
  }
}

// ─── Regra comum de faturas (achado R3) ───────────────────────────────────
// "Financeiro" e "Por Cliente" contam a mesma coisa (decisão de 2026-10-19):
// a fatura emitida no período, sem rascunho e sem cancelada. O valor emitido
// de uma fatura de Taxas Locais vem dos recebíveis do B/L, contados uma vez
// cada: a individual e a consolidada que a cobre apontam o mesmo recebível.

type InvoiceForTotals = {
  id: number
  customer_id: number | null
  invoice_type: string | null
  status: string | null
  issued_at: string | null
  total_brl: number | null
  balance_brl: number | null
}

/** Situações que o Faturamento agrupa como Cancelada: a consolidada `obsolete` perdeu a validade. */
export const CANCELLED_INVOICE_STATUSES = ['cancelled', 'obsolete'] as const

/** Fatura que entra nos totais: emitida (com data), sem rascunho e sem cancelada (nem obsoleta). */
export function countsAsIssuedInvoice(invoice: { status: string | null; issued_at: string | null }) {
  return Boolean(invoice.issued_at)
    && invoice.status !== 'draft'
    && !(CANCELLED_INVOICE_STATUSES as readonly (string | null)[]).includes(invoice.status)
}

export type InvoiceTotals = { invoiceCount: number; issued: number; open: number; paid: number }

const isOpenStatus = (status: string | null) => status === 'issued' || status === 'partially_paid'

/**
 * Totais das faturas que contam (`countsAsIssuedInvoice`), por Cliente e no
 * todo. Emitido e Pago somam o recebível uma vez por Cliente; Em aberto soma o
 * saldo dos recebíveis ativos e abertos, ou o saldo da fatura sem recebível.
 */
export function summarizeIssuedInvoices(invoices: InvoiceForTotals[], links: ReceivableLinkRow[]) {
  const ledger = summarizeReceivableBalances(links)
  const byCustomer = new Map<number, InvoiceTotals>()
  const seenIssued = new Set<string>()
  const seenPaid = new Set<string>()
  const seenOpen = new Set<string>()

  for (const invoice of invoices) {
    if (!countsAsIssuedInvoice(invoice)) continue
    const customerId = invoice.customer_id ?? 0
    const totals = byCustomer.get(customerId) ?? { invoiceCount: 0, issued: 0, open: 0, paid: 0 }
    byCustomer.set(customerId, totals)
    totals.invoiceCount++

    const invoiceLinks = isLedgerLocalInvoice(invoice) ? ledger.linksByInvoiceId.get(invoice.id) ?? [] : []
    if (invoiceLinks.length === 0) {
      const total = Number(invoice.total_brl ?? 0)
      totals.issued += total
      if (invoice.status === 'paid') totals.paid += total
      if (isOpenStatus(invoice.status)) totals.open += Number(invoice.balance_brl ?? 0)
      continue
    }

    for (const link of invoiceLinks) {
      const receivable = normalizeReceivable(link.receivable)
      if (!receivable) continue
      const key = `${customerId}:${link.receivable_id}`
      const original = Number(receivable.original_amount_brl ?? 0)
      if (!seenIssued.has(key)) {
        seenIssued.add(key)
        totals.issued += original
      }
      if (invoice.status === 'paid' && !seenPaid.has(key)) {
        seenPaid.add(key)
        totals.paid += original
      }
      const balance = Number(receivable.balance_brl ?? 0)
      if (link.status === 'active' && balance > 0 && receivable.status !== 'settled' && receivable.status !== 'void' && !seenOpen.has(key)) {
        seenOpen.add(key)
        totals.open += balance
      }
    }
  }

  const all: InvoiceTotals = { invoiceCount: 0, issued: 0, open: 0, paid: 0 }
  for (const totals of byCustomer.values()) {
    all.invoiceCount += totals.invoiceCount
    all.issued += totals.issued
    all.open += totals.open
    all.paid += totals.paid
  }
  return { all, byCustomer }
}

/**
 * Faturas de uma Navio / Viagem: a própria viagem da fatura, o B/L da avulsa
 * e os B/Ls da individual e da consolidada. Mesmo critério de `listInvoices`.
 * `invoices` chega a `bls` também pelas tabelas de ligação; o nome da chave
 * (`invoices_bl_id_fkey`) tira a ambiguidade.
 */
async function invoiceIdsForVoyage(voyageId: number): Promise<number[]> {
  type IdRow = { id?: number; invoice_id?: number }
  const [direct, byBl, individual, consolidated] = await Promise.all([
    fetchAllPages<IdRow>((from, to) => supabase.from('invoices').select('id', reportSelectOptions(from)).filter('voyage_id', 'eq', voyageId).order('id').range(from, to).overrideTypes<IdRow[], { merge: false }>()),
    fetchAllPages<IdRow>((from, to) => supabase.from('invoices').select('id, bl:bls!invoices_bl_id_fkey!inner(voyage_id)', reportSelectOptions(from)).eq('bl.voyage_id', voyageId).order('id').range(from, to).overrideTypes<IdRow[], { merge: false }>()),
    fetchAllPages<IdRow>((from, to) => supabase.from('invoice_bls').select('invoice_id, bl:bls!inner(voyage_id)', reportSelectOptions(from)).eq('bl.voyage_id', voyageId).order('id').range(from, to).overrideTypes<IdRow[], { merge: false }>()),
    fetchAllPages<IdRow>((from, to) => supabase.from('invoice_receivable_links').select('invoice_id, bl:bls!inner(voyage_id)', reportSelectOptions(from)).eq('bl.voyage_id', voyageId).order('id').range(from, to).overrideTypes<IdRow[], { merge: false }>()),
  ])
  const ids = new Set<number>()
  for (const row of [...direct.rows, ...byBl.rows]) if (Number.isInteger(Number(row.id))) ids.add(Number(row.id))
  for (const row of [...individual.rows, ...consolidated.rows]) if (Number.isInteger(Number(row.invoice_id))) ids.add(Number(row.invoice_id))
  return [...ids]
}

// ─── Financeiro ───────────────────────────────────────────────────────────

export type FinancialReportRow = {
  id: number
  invoice_number: string | null
  invoice_type: string | null
  status: string | null
  total_brl: number | null
  balance_brl: number | null
  issued_at: string | null
  created_at: string | null
  customer_id: number | null
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
  }
  load: ReportLoad
  accessDenied: boolean
}

const EMPTY_LOAD: ReportLoad = { loaded: 0, total: 0 }

function deniedFinancialResult(): FinancialReportResult {
  return {
    rows: [],
    kpis: { totalInvoices: 0, totalIssued: 0, totalPaid: 0, totalOpen: 0, totalCanceled: 0 },
    load: EMPTY_LOAD,
    accessDenied: true,
  }
}

export async function fetchFinancialReport(filters: FinancialReportFilters, options: ReportOptions = {}): Promise<FinancialReportResult> {
  const ceiling = options.ceiling ?? REPORT_SCREEN_CEILING
  const voyageId = positiveId(filters.voyageId)
  let voyageInvoiceIds: number[] | null = null
  try {
    if (voyageId) voyageInvoiceIds = await invoiceIdsForVoyage(voyageId)
  } catch (error) {
    if (isAccessDenied(error)) return deniedFinancialResult()
    throw error
  }
  if (voyageInvoiceIds && voyageInvoiceIds.length === 0) {
    return { rows: [], kpis: { totalInvoices: 0, totalIssued: 0, totalPaid: 0, totalOpen: 0, totalCanceled: 0 }, load: EMPTY_LOAD, accessDenied: false }
  }

  let paged: PagedRows<FinancialReportRow>
  try {
    paged = await fetchAllPages<FinancialReportRow>((from, to) => {
      let query = supabase
        .from('invoices')
        .select(
          `id, invoice_number, invoice_type, status, total_brl, balance_brl, issued_at, created_at, customer_id,
           customer:customers(id, name, cnpj_cpf)`,
          reportSelectOptions(from),
        )
        .order('issued_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })

      if (filters.dateFrom) query = query.gte('issued_at', brasiliaStartOfDay(filters.dateFrom))
      if (filters.dateTo) query = query.lte('issued_at', brasiliaEndOfDay(filters.dateTo))
      // ponytail: os ids da viagem vão na URL; uma viagem tem centenas de
      // faturas, não milhares. Upgrade: filtrar a viagem numa RPC.
      if (voyageInvoiceIds) query = query.in('id', voyageInvoiceIds)
      const customerId = positiveId(filters.customerId)
      if (customerId) query = query.eq('customer_id', customerId)
      // Cancelada inclui a consolidada obsoleta, como nos filtros do Faturamento.
      if (filters.status === 'cancelled') query = query.in('status', [...CANCELLED_INVOICE_STATUSES])
      else if (filters.status) query = query.eq('status', filters.status)
      if (filters.consolidated === 'sim') query = query.eq('invoice_type', 'consolidated')
      else if (filters.consolidated === 'nao') query = query.neq('invoice_type', 'consolidated')
      return query.range(from, to).overrideTypes<FinancialReportRow[], { merge: false }>()
    }, { ceiling })
  } catch (error) {
    // R5: só a falta de permissão vira aviso; sessão expirada é erro da
    // consulta e pede login de novo.
    if (isAccessDenied(error)) return deniedFinancialResult()
    throw error
  }

  const receivables = await fetchReceivableLinksByInvoiceIds(paged.rows.filter(isLedgerLocalInvoice).map((row) => row.id))
  if (receivables.accessDenied) return deniedFinancialResult()

  // O saldo da fatura de Taxas Locais vem do recebível; só então o filtro de
  // saldo pode ser aplicado (no navegador, sobre o recorte carregado).
  let rows = applyReceivableBalances(paged.rows, summarizeReceivableBalances(receivables.links))
  if (filters.balance === 'aberto') rows = rows.filter((row) => Number(row.balance_brl ?? 0) > 0)
  else if (filters.balance === 'zerado') rows = rows.filter((row) => Number(row.balance_brl ?? 0) <= 0)

  const shownIds = new Set(rows.map((row) => row.id))
  const { all } = summarizeIssuedInvoices(rows, receivables.links.filter((link) => shownIds.has(link.invoice_id)))

  return {
    rows,
    kpis: {
      totalInvoices: all.invoiceCount,
      totalIssued: all.issued,
      totalPaid: all.paid,
      totalOpen: all.open,
      totalCanceled: rows.filter((row) => (CANCELLED_INVOICE_STATUSES as readonly string[]).includes(row.status ?? '')).length,
    },
    load: paged.load,
    accessDenied: false,
  }
}

// ─── Por Cliente ──────────────────────────────────────────────────────────

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
    customersWithInvoices: number
    topByBls: string | null
    topByInvoiced: string | null
    totalIssued: number
  }
  /** B/Ls e faturas: a tela fica parcial se qualquer uma das duas parou no teto. */
  load: ReportLoad
  invoicesAccessDenied: boolean
}

type CustomerRef = { id: number; name: string; cnpj_cpf: string } | null

export async function fetchCustomerReport(filters: CustomerReportFilters, options: ReportOptions = {}): Promise<CustomerReportResult> {
  const ceiling = options.ceiling ?? REPORT_SCREEN_CEILING
  const voyageId = positiveId(filters.voyageId)
  const customerId = positiveId(filters.customerId)

  type BlRow = {
    id: string
    customer_id: number
    total_weight_kg: number | null
    bb_weight_ton: number | null
    total_cbm: number | null
    bb_cbm: number | null
    customer: CustomerRef
  }

  const bls = await fetchAllPages<BlRow>((from, to) => {
    let query = supabase
      .from('bls')
      .select(
        `id, customer_id, total_weight_kg, bb_weight_ton, total_cbm, bb_cbm,
         customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf)`,
        reportSelectOptions(from),
      )
      .not('customer_id', 'is', null)
      .order('id', { ascending: true })
    if (filters.dateFrom) query = query.gte('created_at', brasiliaStartOfDay(filters.dateFrom))
    if (filters.dateTo) query = query.lte('created_at', brasiliaEndOfDay(filters.dateTo))
    if (voyageId) query = query.eq('voyage_id', voyageId)
    if (customerId) query = query.eq('customer_id', customerId)
    return query.range(from, to).overrideTypes<BlRow[], { merge: false }>()
  }, { ceiling })

  const perCustomer = new Map<number, CustomerReportRow>()
  const entryFor = (id: number, customer: NonNullable<CustomerRef>) => {
    let entry = perCustomer.get(id)
    if (!entry) {
      entry = {
        customer_id: id,
        name: customer.name,
        cnpj_cpf: customer.cnpj_cpf,
        blCount: 0,
        totalWeightKg: 0,
        totalCbm: 0,
        invoiceCount: 0,
        totalIssued: 0,
        totalBalance: 0,
      }
      perCustomer.set(id, entry)
    }
    return entry
  }

  for (const bl of bls.rows) {
    if (bl.customer_id == null || !bl.customer) continue
    const entry = entryFor(bl.customer_id, bl.customer)
    entry.blCount++
    entry.totalWeightKg += blTotalWeightKg(bl)
    entry.totalCbm += blTotalCbm(bl)
  }

  type InvoiceRow = InvoiceForTotals & { customer: CustomerRef }
  let invoicesAccessDenied = false
  let invoices: PagedRows<InvoiceRow> = { rows: [], load: EMPTY_LOAD }
  let links: ReceivableLinkRow[] = []
  try {
    const voyageInvoiceIds = voyageId ? await invoiceIdsForVoyage(voyageId) : null
    if (!voyageInvoiceIds || voyageInvoiceIds.length > 0) {
      invoices = await fetchAllPages<InvoiceRow>((from, to) => {
        let query = supabase
          .from('invoices')
          .select('id, customer_id, invoice_type, total_brl, balance_brl, status, issued_at, customer:customers(id, name, cnpj_cpf)', reportSelectOptions(from))
          .not('customer_id', 'is', null)
          // A regra comum (R3): emitida no período, sem rascunho e sem cancelada (nem obsoleta).
          .not('issued_at', 'is', null)
          .not('status', 'in', '(draft,cancelled,obsolete)')
          .order('id', { ascending: true })
        if (filters.dateFrom) query = query.gte('issued_at', brasiliaStartOfDay(filters.dateFrom))
        if (filters.dateTo) query = query.lte('issued_at', brasiliaEndOfDay(filters.dateTo))
        if (voyageInvoiceIds) query = query.in('id', voyageInvoiceIds)
        if (customerId) query = query.eq('customer_id', customerId)
        return query.range(from, to).overrideTypes<InvoiceRow[], { merge: false }>()
      }, { ceiling })
    }
    const receivables = await fetchReceivableLinksByInvoiceIds(invoices.rows.filter(isLedgerLocalInvoice).map((invoice) => invoice.id))
    if (receivables.accessDenied) invoicesAccessDenied = true
    links = receivables.links
  } catch (error) {
    if (!isAccessDenied(error)) throw error
    invoicesAccessDenied = true
  }

  if (!invoicesAccessDenied) {
    // R3: a fatura conta mesmo quando o Cliente não teve B/L criado no período.
    for (const invoice of invoices.rows) {
      if (invoice.customer_id != null && invoice.customer && countsAsIssuedInvoice(invoice)) entryFor(invoice.customer_id, invoice.customer)
    }
    const { byCustomer } = summarizeIssuedInvoices(invoices.rows, links)
    for (const [id, totals] of byCustomer) {
      const entry = perCustomer.get(id)
      if (!entry) continue
      entry.invoiceCount = totals.invoiceCount
      entry.totalIssued = totals.issued
      entry.totalBalance = totals.open
    }
  }

  const rows = [...perCustomer.values()].sort((a, b) =>
    b.totalIssued - a.totalIssued || b.blCount - a.blCount || a.name.localeCompare(b.name, 'pt-BR'),
  )
  const topByBls = [...rows].sort((a, b) => b.blCount - a.blCount)[0]
  const topByInvoiced = rows[0]

  return {
    rows,
    kpis: {
      customersWithInvoices: rows.filter((row) => row.invoiceCount > 0).length,
      topByBls: topByBls && topByBls.blCount > 0 ? topByBls.name : null,
      topByInvoiced: topByInvoiced && topByInvoiced.totalIssued > 0 ? topByInvoiced.name : null,
      totalIssued: rows.reduce((sum, row) => sum + row.totalIssued, 0),
    },
    load: {
      loaded: bls.load.loaded + invoices.load.loaded,
      total: bls.load.total + invoices.load.total,
    },
    invoicesAccessDenied,
  }
}

// ─── Demurrage ────────────────────────────────────────────────────────────

export type DemurrageReportResult = {
  rows: DemurrageInvoiceListItem[]
  kpis: { totalUsd: number; billedBrl: number; paidBrl: number }
  load: ReportLoad
}

const DEMURRAGE_SELECT = 'customer:customers(id,name,cnpj_cpf,address,city,state,zip)'

export async function fetchDemurrageReport(filters: DemurrageReportFilters, options: ReportOptions & { today?: string } = {}): Promise<DemurrageReportResult> {
  const ceiling = options.ceiling ?? REPORT_SCREEN_CEILING
  const today = options.today ?? saoPauloTodayIso()
  const voyageId = positiveId(filters.voyageId)
  const customerId = positiveId(filters.customerId)

  const { rows, load } = await fetchAllPages<DemurrageInvoiceListItem>((from, to) => {
    // Com Navio / Viagem, o B/L entra como junção obrigatória para filtrar por ela.
    const bl = voyageId
      ? 'bl:bls!inner(id,pol,pod,voyage_id,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))'
      : 'bl:bls(id,pol,pod,voyage:voyages(id,voyage_number,vessel:vessels(id,name)))'
    let query = supabase
      .from('demurrage_invoices')
      .select(`*, ${DEMURRAGE_SELECT}, ${bl}`, reportSelectOptions(from))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    // doc_date é DATE (calendário), comparado com a data crua.
    if (filters.dateFrom) query = query.gte('doc_date', filters.dateFrom)
    if (filters.dateTo) query = query.lte('doc_date', filters.dateTo)
    if (voyageId) query = query.eq('bl.voyage_id', voyageId)
    if (customerId) query = query.eq('customer_id', customerId)
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.dispute === 'sim') query = query.eq('dispute_open', true)
    else if (filters.dispute === 'nao') query = query.or('dispute_open.is.null,dispute_open.eq.false')
    if (filters.overdue === 'sim') query = query.in('status', ['issued', 'overdue']).lt('due_date', today)
    return query.range(from, to).overrideTypes<DemurrageInvoiceListItem[], { merge: false }>()
  }, { ceiling })

  // Faturas canceladas continuam listadas (o operador precisa vê-las), mas somá-las
  // inflaria os totais. Cada indicador declara no rótulo o recorte que agrega.
  const active = rows.filter((invoice) => invoice.status !== 'cancelled')
  return {
    rows,
    kpis: {
      totalUsd: active.reduce((sum, invoice) => sum + Number(invoice.total_usd ?? 0), 0),
      billedBrl: active
        .filter((invoice) => invoice.status === 'issued' || invoice.status === 'overdue' || invoice.status === 'paid')
        .reduce((sum, invoice) => sum + Number(invoice.current_total_brl ?? 0), 0),
      paidBrl: rows
        .filter((invoice) => invoice.status === 'paid')
        .reduce((sum, invoice) => sum + Number(invoice.current_total_brl ?? 0), 0),
    },
    load,
  }
}

// ─── Recebíveis das faturas de Taxas Locais ───────────────────────────────

type LedgerInvoiceLike = {
  id: number
  invoice_type?: string | null
}

type ReceivableShape = {
  id?: number | null
  original_amount_brl?: number | string | null
  balance_brl?: number | string | null
  status?: string | null
}

export type ReceivableLinkRow = {
  invoice_id: number
  receivable_id: number
  status: string | null
  receivable: ReceivableShape | ReceivableShape[] | null
}

function isLedgerLocalInvoice(invoice: LedgerInvoiceLike) {
  return invoice.invoice_type === 'individual' || invoice.invoice_type === 'consolidated'
}

/** Falta de permissão de leitura. Sessão expirada não entra: é erro e pede login de novo (R5). */
function isAccessDenied(error: unknown): boolean {
  return classifyDbError(error).kind === 'permissao'
}

// ponytail: ids em lotes de 200 para a URL não estourar; cada lote também lê
// em páginas, porque uma consolidada liga muitos recebíveis.
const LINK_ID_BATCH = 200

async function fetchReceivableLinksByInvoiceIds(invoiceIds: number[]) {
  const uniqueIds = [...new Set(invoiceIds)].filter((id) => Number.isFinite(id))
  const links: ReceivableLinkRow[] = []
  try {
    for (let start = 0; start < uniqueIds.length; start += LINK_ID_BATCH) {
      const batch = uniqueIds.slice(start, start + LINK_ID_BATCH)
      const { rows } = await fetchAllPages<ReceivableLinkRow>((from, to) => supabase
        .from('invoice_receivable_links')
        .select('invoice_id, receivable_id, status, receivable:bl_receivables(id, original_amount_brl, balance_brl, status)', reportSelectOptions(from))
        .in('invoice_id', batch)
        .order('id', { ascending: true })
        .range(from, to)
        .overrideTypes<ReceivableLinkRow[], { merge: false }>())
      links.push(...rows)
    }
  } catch (error) {
    if (isAccessDenied(error)) return { links: [] as ReceivableLinkRow[], accessDenied: true }
    throw error
  }
  return { links, accessDenied: false }
}

function normalizeReceivable(receivable: ReceivableLinkRow['receivable']) {
  if (Array.isArray(receivable)) return receivable[0] ?? null
  return receivable
}

function summarizeReceivableBalances(links: ReceivableLinkRow[]) {
  const invoiceBalanceById = new Map<number, number>()
  const linksByInvoiceId = new Map<number, ReceivableLinkRow[]>()

  for (const link of links) {
    const receivable = normalizeReceivable(link.receivable)
    if (!receivable) continue

    const invoiceLinks = linksByInvoiceId.get(link.invoice_id) ?? []
    invoiceLinks.push(link)
    linksByInvoiceId.set(link.invoice_id, invoiceLinks)

    if (link.status !== 'active') continue
    const balance = Number(receivable.balance_brl ?? 0)
    invoiceBalanceById.set(link.invoice_id, (invoiceBalanceById.get(link.invoice_id) ?? 0) + balance)
  }

  return { invoiceBalanceById, linksByInvoiceId }
}

function applyReceivableBalances<T extends FinancialReportRow>(rows: T[], summary: ReturnType<typeof summarizeReceivableBalances>) {
  return rows.map((row) => {
    if (!isLedgerLocalInvoice(row) || !summary.linksByInvoiceId.has(row.id)) return row
    return { ...row, balance_brl: summary.invoiceBalanceById.get(row.id) ?? 0 }
  })
}
