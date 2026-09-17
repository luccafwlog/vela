import { supabase } from './supabase'
import { z } from 'zod'
import type { Customer, Invoice, InvoiceDocumentStatus, InvoiceItem, InvoicePayment, InvoiceSummary, InvoiceBlLink, Json } from '../types/database'
import { classifyDbError } from '../lib/errors'
import { escapeFilterTerm, sanitizeLikeTerm } from '../lib/utils'
import { canonicalizeDocument } from '../lib/cnpj'
import { reportBestEffortFailure } from '../lib/telemetry'

// Filtro de status exposto na UI: 3 estados operacionais. Cada um cobre os
// status documentais reais persistidos na coluna invoices.status.
export type InvoiceStatusFilter = '' | 'issued' | 'paid' | 'cancelled'

const INVOICE_STATUS_GROUPS: Record<Exclude<InvoiceStatusFilter, ''>, InvoiceDocumentStatus[]> = {
  issued: ['issued', 'partially_paid', 'draft'],
  paid: ['paid', 'covered'],
  cancelled: ['cancelled', 'obsolete'],
}

const INVOICE_EXPORT_PAGE_SIZE = 1000

// Tipo de fatura para filtro: "Unico BL" agrupa individuais e granito.
export type InvoiceTypeFilter = '' | 'single' | 'consolidated'

export type InvoiceFilters = {
  search: string
  customerId: string
  status: InvoiceStatusFilter
  invoiceType: InvoiceTypeFilter
  blSearch: string
  voyageSearch: string
  pod: string
  dateFrom: string
  dateTo: string
  paidFrom: string
  paidTo: string
  page: number
  pageSize: number
}

// Linha enriquecida da lista de faturas: traz os BLs vinculados (de invoice_bls
// para individuais/granito e de invoice_receivable_links para consolidadas), com
// navio/viagem e POD do BL, alem das datas de pagamento.
type InvoiceListBlSnapshot = {
  pod: string | null
  voyage?: { id?: number | null; voyage_number: string | null; vessel?: { name: string | null } | null } | null
}

// Apenas os campos de invoices efetivamente buscados em INVOICE_LIST_SELECT.
// Estender InvoiceSummary (Invoice completo) prometia colunas que a query
// não busca — o cast em listInvoices escondia isso do compilador.
export type InvoiceListRow = Pick<
  Invoice,
  | 'id'
  | 'invoice_number'
  | 'customer_id'
  | 'bl_id'
  | 'issued_at'
  | 'total_brl'
  | 'status'
  | 'invoice_type'
  | 'total_paid_brl'
  | 'balance_brl'
  | 'created_at'
> & {
  customer?: Pick<Customer, 'id' | 'name' | 'cnpj_cpf'> | null
  invoice_bls?:
    | Array<{ id: number; bl_id: string | null; subtotal_brl: number; subtotal_usd: number; bl?: InvoiceListBlSnapshot | null }>
    | null
  invoice_receivable_links?:
    | Array<{ id: number; bl_id: string | null; subtotal_brl: number; bl?: InvoiceListBlSnapshot | null }>
    | null
  payments?: Array<{ paid_at: string | null }> | null
}
export type InvoiceDetail = {
  invoice: (InvoiceSummary & {
    customer_name?: string | null
    customer_cnpj_cpf?: string | null
  }) | null
  bls: Array<
    InvoiceBlLink & {
      charge_status?: string | null
      financial_status?: string | null
      pol?: string | null
      pod?: string | null
      voyage_number?: string | null
      vessel_name?: string | null
      cargo_mode?: string | null
    }
  >
  items: InvoiceItem[]
  payments: InvoicePayment[]
}

export type InvoiceLinkInfo = {
  id: number
  invoice_number: string | null
  status: string | null
  total_brl: number | null
  balance_brl: number | null
  invoice_type: string | null
  source: 'invoice_bls' | 'invoice_receivable_links'
}

type InvoiceLinksByBl = Record<string, InvoiceLinkInfo[]>


type BillingCustomerOption = {
  id: number
  name: string
  cnpj_cpf: string
}

const INVOICE_LIST_SELECT = `
  id,
  invoice_number,
  customer_id,
  bl_id,
  issued_at,
  total_brl,
  status,
  invoice_type,
  total_paid_brl,
  balance_brl,
  created_at,
  customer:customers(id,name,cnpj_cpf),
  invoice_bls(id,bl_id,subtotal_brl,subtotal_usd,bl:bls(pod,voyage:voyages(id,voyage_number,vessel:vessels(name)))),
  invoice_receivable_links(id,bl_id,subtotal_brl,bl:bls(pod,voyage:voyages(id,voyage_number,vessel:vessels(name)))),
  payments(paid_at)
`

// Resolve os invoice_ids que possuem algum BL na lista informada, olhando tanto
// invoice_bls (individuais/granito) quanto invoice_receivable_links (consolidadas).
async function invoiceIdsForBlIds(blIds: string[]): Promise<number[]> {
  if (blIds.length === 0) return []
  const ids = new Set<number>()
  const [direct, consolidated] = await Promise.all([
    supabase.from('invoice_bls').select('invoice_id').in('bl_id', blIds).limit(5000),
    supabase.from('invoice_receivable_links').select('invoice_id').in('bl_id', blIds).limit(5000),
  ])
  if (direct.error) throw direct.error
  if (consolidated.error) throw consolidated.error
  for (const row of direct.data ?? []) {
    if (Number.isInteger(Number(row.invoice_id))) ids.add(Number(row.invoice_id))
  }
  for (const row of consolidated.data ?? []) {
    if (Number.isInteger(Number(row.invoice_id))) ids.add(Number(row.invoice_id))
  }
  return Array.from(ids)
}

// Intersecta progressivamente o conjunto de invoice_ids candidatos. null = sem
// restricao ainda. Retorna Set vazio quando algum filtro nao casa nada.
function intersectIds(current: Set<number> | null, next: number[]): Set<number> {
  const nextSet = new Set(next)
  if (current === null) return nextSet
  const out = new Set<number>()
  for (const id of current) if (nextSet.has(id)) out.add(id)
  return out
}

export async function listInvoices(filters: InvoiceFilters): Promise<{ rows: InvoiceListRow[]; count: number }> {
  const from = (filters.page - 1) * filters.pageSize
  const to = from + filters.pageSize - 1

  // Filtros que dependem dos BLs vinculados resolvem invoice_ids e sao intersectados.
  let idFilter: Set<number> | null = null

  const normalizedBlSearch = sanitizeLikeTerm(normalizeText(filters.blSearch).toUpperCase())
  if (normalizedBlSearch) {
    const [direct, consolidated] = await Promise.all([
      supabase.from('invoice_bls').select('invoice_id').ilike('bl_id', `%${normalizedBlSearch}%`).limit(5000),
      supabase.from('invoice_receivable_links').select('invoice_id').ilike('bl_id', `%${normalizedBlSearch}%`).limit(5000),
    ])
    if (direct.error) throw direct.error
    if (consolidated.error) throw consolidated.error
    const ids = new Set<number>()
    for (const row of [...(direct.data ?? []), ...(consolidated.data ?? [])]) {
      if (Number.isInteger(Number(row.invoice_id))) ids.add(Number(row.invoice_id))
    }
    idFilter = intersectIds(idFilter, Array.from(ids))
  }

  const pod = sanitizeLikeTerm(filters.pod)
  if (pod) {
    const { data: blRows, error: blError } = await supabase
      .from('bls')
      .select('id')
      .ilike('pod', `%${pod}%`)
      .limit(5000)
    if (blError) throw blError
    const blIds = (blRows ?? []).map((row) => String(row.id))
    idFilter = intersectIds(idFilter, await invoiceIdsForBlIds(blIds))
  }

  const voyageSearch = sanitizeLikeTerm(filters.voyageSearch)
  if (voyageSearch) {
    const term = `%${voyageSearch}%`
    const [byNumber, byVessel] = await Promise.all([
      supabase.from('voyages').select('id').ilike('voyage_number', term).limit(2000),
      supabase.from('voyages').select('id,vessels!inner(name)').ilike('vessels.name', term).limit(2000),
    ])
    if (byNumber.error) throw byNumber.error
    if (byVessel.error) throw byVessel.error
    const voyageIds = new Set<number>()
    for (const row of [...(byNumber.data ?? []), ...(byVessel.data ?? [])]) {
      if (Number.isInteger(Number(row.id))) voyageIds.add(Number(row.id))
    }
    let blIds: string[] = []
    if (voyageIds.size > 0) {
      const { data: blRows, error: blError } = await supabase
        .from('bls')
        .select('id')
        .in('voyage_id', Array.from(voyageIds))
        .limit(5000)
      if (blError) throw blError
      blIds = (blRows ?? []).map((row) => String(row.id))
    }
    idFilter = intersectIds(idFilter, await invoiceIdsForBlIds(blIds))
  }

  if (filters.paidFrom || filters.paidTo) {
    let paymentsQuery = supabase.from('payments').select('invoice_id').not('paid_at', 'is', null).limit(10000)
    if (filters.paidFrom) paymentsQuery = paymentsQuery.gte('paid_at', `${filters.paidFrom}T00:00:00`)
    if (filters.paidTo) paymentsQuery = paymentsQuery.lte('paid_at', `${filters.paidTo}T23:59:59`)
    const { data: payRows, error: payError } = await paymentsQuery
    if (payError) throw payError
    const ids = new Set<number>()
    for (const row of payRows ?? []) {
      if (Number.isInteger(Number(row.invoice_id))) ids.add(Number(row.invoice_id))
    }
    idFilter = intersectIds(idFilter, Array.from(ids))
  }

  if (idFilter !== null && idFilter.size === 0) {
    return { rows: [], count: 0 }
  }

  let query = supabase
    .from('invoices')
    .select(INVOICE_LIST_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })

  if (filters.search) {
    const term = escapeFilterTerm(filters.search)
    if (term) {
      query = query.or(`invoice_number.ilike.%${term}%`)
    }
  }

  if (filters.customerId) {
    query = query.eq('customer_id', Number(filters.customerId))
  }

  if (filters.status) {
    query = query.in('status', INVOICE_STATUS_GROUPS[filters.status])
  }

  if (filters.invoiceType === 'consolidated') {
    query = query.eq('invoice_type', 'consolidated')
  } else if (filters.invoiceType === 'single') {
    query = query.in('invoice_type', ['individual', 'granite'])
  }

  if (filters.dateFrom) {
    query = query.gte('issued_at', `${filters.dateFrom}T00:00:00`)
  }
  if (filters.dateTo) {
    query = query.lte('issued_at', `${filters.dateTo}T23:59:59`)
  }

  if (idFilter !== null) {
    query = query.in('id', Array.from(idFilter))
  }

  const { data, error, count } = await query.range(from, to).overrideTypes<InvoiceListRow[], { merge: false }>()
  if (error) throw error

  return {
    rows: data ?? [],
    count: count ?? 0,
  }
}

export type InvoiceListBl = {
  bl_id: string
  pod: string | null
  voyage_number: string | null
  vessel_name: string | null
}

export type InvoiceCommunicationContext = {
  customerId: number
  voyageId: number | null
  voyageNumber: string | null
  vesselName: string | null
  pod: string | null
}

export function getInvoiceCommunicationContexts(row: InvoiceListRow): InvoiceCommunicationContext[] {
  const direct = row.invoice_bls ?? []
  const links = row.invoice_receivable_links ?? []
  const source = direct.length > 0 ? direct : links
  const contexts = source
    .filter((link) => link.bl?.voyage?.id != null)
    .map((link) => ({
      customerId: row.customer_id,
      voyageId: link.bl?.voyage?.id ?? null,
      voyageNumber: link.bl?.voyage?.voyage_number ?? null,
      vesselName: link.bl?.voyage?.vessel?.name ?? null,
      pod: link.bl?.pod ?? null,
    }))
  return contexts.filter((context, index) => contexts.findIndex((candidate) => candidate.voyageId === context.voyageId) === index)
}

/** Contexto mínimo para a coluna de status do comunicado financeiro. */
export function getInvoiceCommunicationContext(row: InvoiceListRow): InvoiceCommunicationContext {
  const contexts = getInvoiceCommunicationContexts(row)
  if (contexts.length) return contexts[0]
  const direct = row.invoice_bls ?? []
  const links = row.invoice_receivable_links ?? []
  const source = direct.length > 0 ? direct : links
  const first = source.find((link) => Boolean(link.bl_id?.trim()))
  return {
    customerId: row.customer_id,
    voyageId: first?.bl?.voyage?.id ?? null,
    voyageNumber: first?.bl?.voyage?.voyage_number ?? null,
    vesselName: first?.bl?.voyage?.vessel?.name ?? null,
    pod: first?.bl?.pod ?? null,
  }
}

// BLs vinculados a uma fatura, abstraindo a origem (invoice_bls vs receivable_links).
export function getInvoiceBls(row: InvoiceListRow): InvoiceListBl[] {
  const direct = row.invoice_bls ?? []
  const links = row.invoice_receivable_links ?? []
  const source: Array<{ bl_id: string | null; bl?: InvoiceListBlSnapshot | null }> = direct.length > 0 ? direct : links
  return source
    .map((link) => ({
      bl_id: String(link.bl_id ?? '').trim(),
      pod: link.bl?.pod ?? null,
      voyage_number: link.bl?.voyage?.voyage_number ?? null,
      vessel_name: link.bl?.voyage?.vessel?.name ?? null,
    }))
    .filter((bl) => bl.bl_id.length > 0)
}

export function isConsolidatedInvoice(row: { invoice_type?: string | null }): boolean {
  return row.invoice_type === 'consolidated'
}

// Data de pagamento exibida: o pagamento mais recente registrado na fatura.
export function getInvoicePaymentDate(row: InvoiceListRow): string | null {
  const dates = (row.payments ?? []).map((payment) => payment.paid_at).filter((value): value is string => Boolean(value))
  if (dates.length === 0) return null
  return dates.reduce((max, value) => (value > max ? value : max))
}

// Busca todas as faturas que casam os filtros (sem paginacao) para exportacao.
export async function listInvoicesForExport(filters: InvoiceFilters): Promise<InvoiceListRow[]> {
  const rows: InvoiceListRow[] = []
  let page = 1

  while (true) {
    const result = await listInvoices({ ...filters, page, pageSize: INVOICE_EXPORT_PAGE_SIZE })
    rows.push(...result.rows)

    if (result.rows.length < INVOICE_EXPORT_PAGE_SIZE) break
    if (result.count > 0 && rows.length >= result.count) break
    page += 1
  }

  return rows
}

// ---- Sugestoes para os campos de busca preditiva (combobox) ----

// Sugestao de valores distintos de uma coluna por ilike. Interface unica dos
// tres comboboxes de texto; a busca de viagens (abaixo) tem forma propria.
async function suggestDistinctColumn(
  table: 'invoices' | 'bls',
  column: string,
  term: string,
  opts: { notNull?: boolean; orderBy?: string; fetchLimit?: number } = {},
): Promise<string[]> {
  if (!term) return []
  let query = supabase.from(table).select(column).ilike(column, `%${term}%`)
  if (opts.notNull) query = query.not(column, 'is', null)
  if (opts.orderBy) query = query.order(opts.orderBy, { ascending: false })
  const { data, error } = await query.limit(opts.fetchLimit ?? 10)
  if (error) throw error
  const values = ((data ?? []) as unknown as Array<Record<string, unknown>>)
    .map((row) => String(row[column] ?? ''))
    .filter(Boolean)
  return Array.from(new Set(values)).slice(0, 10)
}

export function listInvoiceNumberSuggestions(search: string): Promise<string[]> {
  return suggestDistinctColumn('invoices', 'invoice_number', sanitizeLikeTerm(search), {
    notNull: true,
    orderBy: 'created_at',
  })
}

export function listBlSuggestions(search: string): Promise<string[]> {
  return suggestDistinctColumn('bls', 'id', sanitizeLikeTerm(normalizeText(search).toUpperCase()))
}

export function listPodSuggestions(search: string): Promise<string[]> {
  return suggestDistinctColumn('bls', 'pod', sanitizeLikeTerm(search), { notNull: true, fetchLimit: 50 })
}

export async function listVoyageSuggestions(search: string): Promise<Array<{ label: string; voyageNumber: string }>> {
  const term = sanitizeLikeTerm(search)
  if (!term) return []
  const like = `%${term}%`
  type VoyageRow = { voyage_number: string | null; vessels?: { name: string | null } | null }
  const [byNumber, byVessel] = await Promise.all([
    supabase
      .from('voyages')
      .select('voyage_number,vessels(name)')
      .ilike('voyage_number', like)
      .limit(10)
      .overrideTypes<VoyageRow[], { merge: false }>(),
    supabase
      .from('voyages')
      .select('voyage_number,vessels!inner(name)')
      .ilike('vessels.name', like)
      .limit(10)
      .overrideTypes<VoyageRow[], { merge: false }>(),
  ])
  if (byNumber.error) throw byNumber.error
  if (byVessel.error) throw byVessel.error
  const out: Array<{ label: string; voyageNumber: string }> = []
  for (const row of [...(byNumber.data ?? []), ...(byVessel.data ?? [])]) {
    if (row.voyage_number) {
      out.push({ voyageNumber: String(row.voyage_number), label: `${row.vessels?.name ?? 'Navio'} · ${row.voyage_number}` })
    }
  }
  const seen = new Set<string>()
  return out.filter((row) => (seen.has(row.label) ? false : (seen.add(row.label), true))).slice(0, 10)
}

// A RPC get_consolidated_invoice_item_breakdown não está nos tipos gerados;
// valida-se o retorno em runtime. Falha de parse degrada para a linha
// agregada por BL (mesmo fallback usado quando o detalhamento não reconcilia).
const consolidatedBreakdownRowSchema = z.object({
  bl_id: z.string(),
  charge_calculation_id: z.number(),
  charge_table_id: z.number().nullable(),
  charge_item_id: z.number().nullable(),
  quantity: z.number().nullable(),
  unit_value_brl: z.number().nullable(),
  total_value_brl: z.number().nullable(),
  currency: z.string().nullable(),
  unit_value_usd: z.number().nullable(),
  total_value_usd: z.number().nullable(),
  calculation_key: z.string().nullable(),
  charge_name: z.string().nullable(),
})

type InvoiceDetailPayload = Partial<InvoiceDetail>
type GraniteInvoiceLink = {
  id: number
  granite_bl_id: string
  subtotal_brl: number
  created_at: string
  granite_bl: {
    bl_number: string
    loading_port: string | null
    discharge_port: string | null
    manifest: {
      voyage: {
        voyage_number: string | null
        vessel: { name: string | null } | null
      } | null
    } | null
  } | null
}
type ConsolidatedInvoiceLink = {
  id: number
  bl_id: string
  subtotal_brl: number | null
  bl_snapshot: Json | null
  created_at: string
}
type ConsolidatedVoyage = {
  id: number
  voyage_number: string | null
  vessel: { name: string | null } | null
}
type ConsolidatedBreakdown = z.infer<typeof consolidatedBreakdownRowSchema>
type ConsolidatedCharge = Omit<ConsolidatedBreakdown, 'bl_id' | 'charge_calculation_id'> & {
  charge_calculation_id: number
}

function createInvoiceDetail(payload: InvoiceDetailPayload): InvoiceDetail {
  return {
    invoice: payload.invoice ?? null,
    bls: payload.bls ?? [],
    items: payload.items ?? [],
    payments: payload.payments ?? [],
  }
}

function mapGraniteInvoiceBls(invoiceId: number, links: GraniteInvoiceLink[]): InvoiceDetail['bls'] {
  return links.map((link) => ({
    id: Number(link.id),
    invoice_id: invoiceId,
    bl_id: link.granite_bl?.bl_number ?? link.granite_bl_id,
    charge_status_snapshot: null,
    financial_status_snapshot: null,
    subtotal_brl: Number(link.subtotal_brl ?? 0),
    subtotal_usd: 0,
    created_at: link.created_at,
    pol: link.granite_bl?.loading_port ?? null,
    pod: link.granite_bl?.discharge_port ?? null,
    voyage_number: link.granite_bl?.manifest?.voyage?.voyage_number ?? null,
    vessel_name: link.granite_bl?.manifest?.voyage?.vessel?.name ?? null,
  }))
}

function extractConsolidatedVoyageIds(links: ConsolidatedInvoiceLink[]): number[] {
  return Array.from(
    new Set(
      links
        .map((link) => {
          const snapshot = (link.bl_snapshot ?? {}) as { voyage_id?: number | null }
          return snapshot.voyage_id == null ? null : Number(snapshot.voyage_id)
        })
        .filter((voyageId): voyageId is number => voyageId != null),
    ),
  )
}

function createConsolidatedVoyageMap(voyages: ConsolidatedVoyage[]): Map<number, { voyage_number: string | null; vessel_name: string | null }> {
  const voyageMap = new Map<number, { voyage_number: string | null; vessel_name: string | null }>()
  for (const voyage of voyages) {
    voyageMap.set(Number(voyage.id), {
      voyage_number: voyage.voyage_number ?? null,
      vessel_name: voyage.vessel?.name ?? null,
    })
  }
  return voyageMap
}

function mapConsolidatedInvoiceBls(
  invoiceId: number,
  links: ConsolidatedInvoiceLink[],
  voyageMap: Map<number, { voyage_number: string | null; vessel_name: string | null }>,
): InvoiceDetail['bls'] {
  return links.map((link) => {
    const snapshot = (link.bl_snapshot ?? {}) as { voyage_id?: number | null; pol?: string | null; pod?: string | null }
    const voyage = snapshot.voyage_id == null ? undefined : voyageMap.get(Number(snapshot.voyage_id))
    return {
      id: Number(link.id),
      invoice_id: invoiceId,
      bl_id: link.bl_id,
      charge_status_snapshot: null,
      financial_status_snapshot: null,
      subtotal_brl: Number(link.subtotal_brl ?? 0),
      subtotal_usd: 0,
      created_at: link.created_at,
      pol: snapshot.pol ?? null,
      pod: snapshot.pod ?? null,
      voyage_number: voyage?.voyage_number ?? null,
      vessel_name: voyage?.vessel_name ?? null,
    }
  })
}

function groupConsolidatedBreakdown(rows: ConsolidatedBreakdown[]): Map<string, ConsolidatedCharge[]> {
  const chargesByBl = new Map<string, ConsolidatedCharge[]>()
  for (const row of rows) {
    const charges = chargesByBl.get(row.bl_id) ?? []
    charges.push({
      charge_calculation_id: Number(row.charge_calculation_id),
      charge_table_id: row.charge_table_id ?? null,
      charge_item_id: row.charge_item_id ?? null,
      quantity: row.quantity ?? null,
      unit_value_brl: row.unit_value_brl ?? null,
      total_value_brl: row.total_value_brl ?? null,
      currency: row.currency ?? null,
      unit_value_usd: row.unit_value_usd ?? null,
      total_value_usd: row.total_value_usd ?? null,
      calculation_key: row.calculation_key ?? null,
      charge_name: row.charge_name ?? null,
    })
    chargesByBl.set(row.bl_id, charges)
  }
  return chargesByBl
}

function buildConsolidatedInvoiceItems(
  invoiceId: number,
  links: ConsolidatedInvoiceLink[],
  chargesByBl: Map<string, ConsolidatedCharge[]>,
): InvoiceItem[] {
  return links.flatMap<InvoiceItem>((link) => {
    const subtotal = Number(link.subtotal_brl ?? 0)
    const charges = chargesByBl.get(link.bl_id) ?? []
    const detailedSum = charges.reduce((sum, charge) => sum + Number(charge.total_value_brl ?? 0), 0)
    const reconciles = charges.length > 0 && Math.abs(detailedSum - subtotal) < 0.01

    if (!reconciles) {
      return [{
        id: Number(link.id),
        invoice_id: invoiceId,
        charge_calculation_id: null,
        description: `BL ${link.bl_id} - Taxas locais`,
        quantity: 1,
        unit_value_brl: subtotal,
        total_value_brl: subtotal,
        bl_id: link.bl_id,
        manifest_id: null,
        charge_table_id: null,
        charge_item_id: null,
        source: 'ledger',
        currency: 'BRL',
        unit_value_usd: null,
        total_value_usd: null,
        pricing_rule_version_id: null,
        billing_run_id: null,
        calculation_key: null,
        snapshot_payload: null,
      }]
    }

    return charges.map((charge) => ({
      id: charge.charge_calculation_id,
      invoice_id: invoiceId,
      charge_calculation_id: charge.charge_calculation_id,
      description: `BL ${link.bl_id} - ${charge.charge_name ?? charge.calculation_key ?? 'Linha de taxa'}`,
      quantity: charge.quantity ?? 1,
      unit_value_brl: charge.unit_value_brl == null ? null : Number(charge.unit_value_brl),
      total_value_brl: Number(charge.total_value_brl ?? 0),
      bl_id: link.bl_id,
      manifest_id: null,
      charge_table_id: charge.charge_table_id,
      charge_item_id: charge.charge_item_id,
      source: 'ledger',
      currency: charge.currency ?? 'BRL',
      unit_value_usd: charge.unit_value_usd,
      total_value_usd: charge.total_value_usd,
      pricing_rule_version_id: null,
      billing_run_id: null,
      calculation_key: charge.calculation_key,
      snapshot_payload: null,
    }))
  })
}

async function hydrateGraniteInvoiceBls(result: InvoiceDetail, invoiceId: number): Promise<void> {
  if (result.invoice?.invoice_type !== 'granite' || result.bls.length > 0) return

  const { data: graniteLinks, error: graniteLinksError } = await supabase
    .from('invoice_granite_bls')
    .select(`
        id,
        created_at,
        granite_bl_id,
        subtotal_brl,
        granite_bl:granite_bls(
          bl_number,
          loading_port,
          discharge_port,
          manifest:granite_manifests(
            voyage:voyages(
              voyage_number,
              vessel:vessels(name)
            )
          )
        )
      `)
    .eq('invoice_id', invoiceId)

  if (graniteLinksError) throw graniteLinksError
  result.bls = mapGraniteInvoiceBls(invoiceId, graniteLinks ?? [])
}

// Consolidated ledger invoices have no invoice_bls, and (before migration 261)
// had no invoice_items either — both were rendered from invoice_receivable_links
// so the existing PDF/print path worked unchanged. Migration 261 (etapa 1 do
// plano de faturamento, ADR 0038 achado 3) now freezes invoice_items at
// consolidation time, so for any consolidada created after it result.items
// already comes populated from list_invoice_details and only the BL summary
// (still sourced from invoice_bls, which consolidadas never populate) needs
// reconstructing here. The live item breakdown stays as a safety net for the
// rare consolidada that predates the backfill.
async function hydrateConsolidatedInvoiceDetails(result: InvoiceDetail, invoiceId: number): Promise<void> {
  if (!result.invoice) return
  if (result.bls.length !== 0 && result.items.length !== 0) return

  const { data: links, error: linksError } = await supabase
    .from('invoice_receivable_links')
    .select('id, bl_id, subtotal_brl, bl_snapshot, created_at')
    .eq('invoice_id', invoiceId)
    .overrideTypes<ConsolidatedInvoiceLink[], { merge: false }>()

  if (linksError || !links || links.length === 0) return

  const consolidatedLinks = links

  if (result.bls.length === 0) {
    const voyageIds = extractConsolidatedVoyageIds(consolidatedLinks)
    let voyageMap = new Map<number, { voyage_number: string | null; vessel_name: string | null }>()
    if (voyageIds.length > 0) {
      const { data: voyages } = await supabase
        .from('voyages')
        .select('id, voyage_number, vessel:vessels(name)')
        .in('id', voyageIds)
        .overrideTypes<ConsolidatedVoyage[], { merge: false }>()
      voyageMap = createConsolidatedVoyageMap(voyages ?? [])
    }

    result.bls = mapConsolidatedInvoiceBls(invoiceId, consolidatedLinks, voyageMap)
  }

  if (result.items.length === 0) {
    // Detail each BL with its individual charges (THD, Drop-Off, etc.) reconstructed
    // from charge_calculations at read-time. charge_calculations/charge_table_items are
    // admin-only under RLS, so we go through a SECURITY DEFINER function scoped to this
    // invoice. The ledger subtotal_brl remains the source of truth for the invoice total,
    // so we only show the breakdown when it reconciles with the subtotal; otherwise
    // (e.g. partial settlement) we fall back to a single aggregated line for that BL.
    const { data: breakdown } = await supabase.rpc('get_consolidated_invoice_item_breakdown', { p_invoice_id: invoiceId })

    const parsedBreakdown = z.array(consolidatedBreakdownRowSchema).safeParse(breakdown ?? [])
    if (!parsedBreakdown.success) {
      reportBestEffortFailure('listInvoiceDetails breakdown parse', parsedBreakdown.error, { invoiceId })
    }

    result.items = buildConsolidatedInvoiceItems(
      invoiceId,
      consolidatedLinks,
      groupConsolidatedBreakdown(parsedBreakdown.success ? parsedBreakdown.data : []),
    )
  }
}

export async function listInvoiceDetails(invoiceId: number) {
  const { data, error } = await supabase.rpc('list_invoice_details', {
    p_invoice_id: invoiceId,
  })

  if (error) throw error

  const result = createInvoiceDetail((data ?? {}) as InvoiceDetailPayload)
  await hydrateGraniteInvoiceBls(result, invoiceId)
  await hydrateConsolidatedInvoiceDetails(result, invoiceId)

  return result
}
export async function createInvoiceFromBls(input: {
  blIds: string[]
  customerId?: number | null
  notes?: string | null
  issueNow?: boolean
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('create_invoice_from_bls_with_ledger', {
    p_bl_ids: input.blIds,
    ...(input.customerId == null ? {} : { p_customer_id: input.customerId }),
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    p_issue_now: input.issueNow ?? true,
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error

  const result = (data ?? {}) as Json
  return result
}

export async function markBlReadyAndCreateInvoice(input: {
  blId: string
  customerId?: number | null
  notes?: string | null
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('mark_bl_ready_and_create_invoice', {
    p_bl_id: input.blId,
    ...(input.customerId == null ? {} : { p_customer_id: input.customerId }),
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error

  const result = (data ?? {}) as Json
  return result
}

export async function markBlsReadyAndCreateInvoice(input: {
  blIds: string[]
  customerId: number
  notes?: string | null
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('mark_bls_ready_and_create_invoice', {
    p_bl_ids: input.blIds,
    p_customer_id: input.customerId,
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error

  const result = (data ?? {}) as Json
  return result
}

export async function registerInvoicePayment(input: {
  invoiceId: number
  amountBrl: number
  paymentMethod: 'pix' | 'ted' | 'doc' | 'boleto' | 'outros'
  paidAt?: string | null
  notes?: string | null
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('register_invoice_payment', {
    p_invoice_id: input.invoiceId,
    p_amount_brl: input.amountBrl,
    p_payment_method: input.paymentMethod,
    ...(input.paidAt == null ? {} : { p_paid_at: input.paidAt }),
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return (data ?? {}) as Json
}

export async function cancelInvoice(input: {
  invoiceId: number
  reason?: string | null
  actorId?: string | null
}) {
  const reason = input.reason?.trim() ?? ''
  if (!reason) throw new Error('Informe a justificativa para cancelar a invoice.')

  const { data, error } = await supabase.rpc('cancel_invoice', {
    p_invoice_id: input.invoiceId,
    p_reason: reason,
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return (data ?? {}) as Json
}

export async function addManualInvoiceCharge(input: {
  invoiceId: number
  description: string
  quantity: number
  unitValueBrl: number
  notes?: string | null
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('add_manual_invoice_charge', {
    p_invoice_id: input.invoiceId,
    p_description: input.description,
    p_quantity: input.quantity,
    p_unit_value_brl: input.unitValueBrl,
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return (data ?? {}) as Json
}

export async function deleteManualInvoiceCharge(input: {
  itemId: number
  actorId?: string | null
}) {
  const { data, error } = await supabase.rpc('delete_manual_invoice_charge', {
    p_item_id: input.itemId,
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return (data ?? {}) as Json
}

export async function listInvoiceLinksByBls(blIds: string[]) {
  const normalizedIds = Array.from(new Set(blIds.map((value) => value.trim().toUpperCase()).filter(Boolean)))
  if (normalizedIds.length === 0) return {} as InvoiceLinksByBl

  const invoiceSelect = 'bl_id, invoice:invoices(id, invoice_number, status, total_brl, balance_brl, invoice_type)'
  const [individualResult, consolidatedResult] = await Promise.all([
    supabase.from('invoice_bls').select(invoiceSelect).in('bl_id', normalizedIds),
    supabase
      .from('invoice_receivable_links')
      .select(invoiceSelect)
      .eq('status', 'active')
      .in('bl_id', normalizedIds),
  ])

  const sources = [
    { ...individualResult, source: 'invoice_bls' as const },
    { ...consolidatedResult, source: 'invoice_receivable_links' as const },
  ]

  const map: InvoiceLinksByBl = {}
  for (const source of sources) {
    if (source.error) {
      if (classifyDbError(source.error).kind === 'permissao') continue
      throw source.error
    }

    for (const row of source.data ?? []) {
      const blId = String(row.bl_id ?? '').trim().toUpperCase()
      if (!blId) continue

      const invoice = row.invoice as {
        id?: number
        invoice_number?: string | null
        status?: string | null
        total_brl?: number | null
        balance_brl?: number | null
        invoice_type?: string | null
      } | null

      if (!invoice?.id) continue

      if (!map[blId]) {
        map[blId] = []
      }
      if (map[blId].some((item) => item.id === invoice.id)) continue
      map[blId].push({
        id: invoice.id,
        invoice_number: invoice.invoice_number ?? null,
        status: invoice.status ?? null,
        total_brl: invoice.total_brl ?? null,
        balance_brl: invoice.balance_brl ?? null,
        invoice_type: invoice.invoice_type ?? null,
        source: source.source,
      })
    }
  }

  for (const key of Object.keys(map)) {
    map[key] = map[key]
      .slice()
      .sort((left, right) => right.id - left.id || left.source.localeCompare(right.source))
  }

  return map
}

export async function listBillingCustomers(search = '') {
  const normalizedSearch = String(search ?? '').trim()
  const safeSearch = escapeFilterTerm(normalizedSearch)
  const cnpjSearch = canonicalizeDocument(normalizedSearch)

  let query = supabase
    .from('customers')
    .select('id,name,cnpj_cpf')
    .order('name', { ascending: true })
    .limit(normalizedSearch.length >= 2 ? 100 : 200)

  if (normalizedSearch.length >= 2) {
    const terms = safeSearch ? [`name.ilike.%${safeSearch}%,cnpj_cpf.ilike.%${safeSearch}%`] : []
    if (/\d/.test(normalizedSearch) && cnpjSearch.length >= 2) terms.push(`cnpj_cpf.ilike.%${cnpjSearch}%`)
    if (terms.length) query = query.or(terms.join(','))
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as BillingCustomerOption[]
}


function normalizeText(value: string) {
  return String(value ?? '').trim()
}
