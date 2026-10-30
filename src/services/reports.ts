import { supabase } from './supabase'
import { classifyDbError } from '../lib/errors'
import { blTotalCbm, blTotalWeightKg } from '../lib/cargoMode'
import { saoPauloTodayIso } from '../lib/dates'
import { storedPortAliases } from './portCode'
import type { DemurrageInvoiceListItem } from './demurrage/demurrageInvoices'
import { listDemurrageBillingBoard, type BoardBox, type BoardGroup } from './demurrage/demurrageBoard'
import { DEMURRAGE_DIVISIONS, type DemurrageDivision } from './demurrage/demurrageDivisions'
import { invoiceNetUsd } from './demurrage/demurrageNetUsd'

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
 * (`reportSelectOptions`), que diz quantas linhas faltam quando a leitura
 * para no teto.
 *
 * Fim do recorte é a página vazia, ou a curta que já alcançou a contagem: uma
 * linha criada no meio da leitura empurra as outras uma posição, e parar só
 * pela contagem da primeira página perderia a última. A mesma troca repete na
 * página seguinte a linha da fronteira, descartada pelo `id`. Terminando antes
 * do teto, o total é o que foi lido: não há "faltam N" de uma contagem velha.
 * ponytail: paginação por deslocamento. Linha apagada no meio da leitura
 * ainda pode fazer outra pular de página. Upgrade: paginar pela chave
 * (`created_at`, `id`) em vez do deslocamento.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  options: { pageSize?: number; ceiling?: number } = {},
): Promise<PagedRows<T>> {
  const pageSize = options.pageSize ?? REPORT_PAGE_SIZE
  const ceiling = options.ceiling ?? Number.POSITIVE_INFINITY
  const rows: T[] = []
  const seenIds = new Set<unknown>()
  let offset = 0
  let count: number | null = null

  while (offset < ceiling) {
    const from = offset
    const to = Math.min(from + pageSize, ceiling) - 1
    const { data, error, count: pageCount } = await fetchPage(from, to)
    if (error) throw error
    if (count === null && typeof pageCount === 'number') count = pageCount
    const page = data ?? []
    offset += page.length
    for (const row of page) {
      const id = (row as { id?: unknown } | null)?.id
      if (id != null) {
        if (seenIds.has(id)) continue
        seenIds.add(id)
      }
      rows.push(row)
    }
    if (page.length === 0) break
    const shortPage = page.length < to - from + 1
    if (shortPage && (count === null || offset >= count)) break
  }

  const loaded = rows.length
  // Parou no teto: a contagem diz quantas faltam. Antes dele, leu o recorte inteiro.
  const total = offset >= ceiling ? Math.max(count ?? loaded, loaded) : loaded
  return { rows, load: { loaded, total } }
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
export type LocalChargesFilter = '' | 'pendente' | 'emitida' | 'parcial' | 'paga' | 'isenta'
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

/** Recortes de Demurrage em `/relatorios` (ADR 0112, D13). */
export type DemurrageReportSlice = 'exposicao' | 'invoices' | 'itens'

export type DemurrageReportFilters = ReportScope & {
  slice: DemurrageReportSlice
  status: '' | 'issued' | 'paid' | 'cancelled'
  dispute: YesNoFilter
  /** Exposição: divisão da aba Containers. */
  division: '' | DemurrageDivision
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

/**
 * Revisão do B/L no relatório (tela e planilha) e no filtro: só
 * `pending_review` é Pendente. `review_status` vazio é o B/L sem pendência
 * gravada (a coluna nasce `ok`), como em todas as outras telas que perguntam
 * por `pending_review`; por isso conta e aparece como "Em ordem".
 */
export function reportReviewLabel(status: string | null | undefined) {
  return status === 'pending_review' ? 'Pendente' : 'Em ordem'
}

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
        if (filters.localCharges === 'emitida') query = query.eq('financial_status', 'invoiced')
        else if (filters.localCharges === 'parcial') query = query.eq('financial_status', 'partially_paid')
        else if (filters.localCharges === 'paga') query = query.eq('financial_status', 'paid')
        else query = query.or(`financial_status.is.null,financial_status.not.in.${LOCKED_FINANCIAL_STATUSES}`)
      }
    }
    return query.range(from, to).overrideTypes<OperationalReportRow[], { merge: false }>()
  }, { ceiling })

  // B/L cancelado aparece na tabela ("B/L cancelado"), mas não entra nos
  // cartões (decisão do responsável de 2026-10-20).
  const counted = rows.filter((row) => !row.cancelled_at)
  const distinctContainers = new Set<string>()
  const distinctVoyages = new Set<number>()
  for (const row of counted) {
    for (const container of row.bl_containers ?? []) {
      if (container.container_number) distinctContainers.add(container.container_number)
    }
    if (row.voyage_id != null) distinctVoyages.add(row.voyage_id)
  }

  return {
    rows,
    kpis: {
      totalBls: counted.length,
      totalContainers: distinctContainers.size,
      totalWeightKg: counted.reduce((sum, row) => sum + blTotalWeightKg(row), 0),
      totalCbm: counted.reduce((sum, row) => sum + blTotalCbm(row), 0),
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
 * Situações que o Faturamento agrupa como Paga: a individual `covered` foi
 * quitada pela consolidada que a cobre (docs/modules/faturamento.md).
 */
export const PAID_INVOICE_STATUSES = ['paid', 'covered'] as const

export function countsAsPaidInvoice(status: string | null) {
  return (PAID_INVOICE_STATUSES as readonly (string | null)[]).includes(status)
}

/**
 * Totais das faturas que contam (`countsAsIssuedInvoice`), por Cliente e no
 * todo. Emitido e Pago somam o recebível uma vez por Cliente; Em aberto soma o
 * saldo dos recebíveis ativos e abertos, ou o saldo da fatura sem recebível.
 * Pago inclui a individual coberta: ela e a consolidada paga que a cobre
 * apontam o mesmo recebível, que entra uma vez só. Sem recebível (granito,
 * avulsa), Pago usa o total da fatura, como o Emitido.
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
      if (countsAsPaidInvoice(invoice.status)) totals.paid += total
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
      if (countsAsPaidInvoice(invoice.status) && !seenPaid.has(key)) {
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
  /** Faturas lidas do banco, antes do filtro de Saldo (aplicado no navegador). */
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
      // Paga inclui a individual coberta pela consolidada, como no Faturamento.
      else if (filters.status === 'paid') query = query.in('status', [...PAID_INVOICE_STATUSES])
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
  /** Cada fonte com o próprio teto: o aviso diz qual delas parou (B/Ls ou faturas). */
  load: { bls: ReportLoad; invoices: ReportLoad }
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
      // B/L cancelado fica fora de B/Ls, Peso e CBM do Cliente, como nos
      // cartões do Operacional (decisão do responsável de 2026-10-20).
      .is('cancelled_at', null)
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
    load: { bls: bls.load, invoices: invoices.load },
    invoicesAccessDenied,
  }
}

// ─── Demurrage ────────────────────────────────────────────────────────────
// Três recortes (ADR 0112, D13): Exposição (caixas sem Invoice, da
// classificação do banco), Invoices (líquidas, pela emissão de Brasília) e
// Itens por container (cada caixa cobrada em Invoice viva).

const DEMURRAGE_SELECT = 'customer:customers(id,name,cnpj_cpf,address,city,state,zip)'

/** Caixa com Demurrage sem Invoice: correndo, devolvida com sobreestadia ou de tipo sem tarifa. */
const EXPOSURE_STATES = new Set<BoardBox['state']>(['running', 'returned_overstay', 'no_rate'])

export type DemurrageExposureRow = BoardBox & {
  division: DemurrageDivision
  reason: string | null
  anchor_bl_id: string
  customer_id: number | null
  customer_name: string | null
  voyage_label: string | null
}

export type DemurrageExposureResult = {
  rows: DemurrageExposureRow[]
  byDivision: Record<DemurrageDivision, { boxes: number; usd: number }>
  byCustomer: Array<{ customer_id: number | null; customer_name: string; boxes: number; usd: number }>
}

export function demurrageExposureRows(groups: readonly BoardGroup[], division: DemurrageReportFilters['division'] = ''): DemurrageExposureResult {
  const rows = groups
    .filter((group) => !division || group.division === division)
    .flatMap((group) => group.boxes.filter((box) => EXPOSURE_STATES.has(box.state)).map((box): DemurrageExposureRow => ({
      ...box,
      usd: box.usd == null ? null : Number(box.usd),
      division: group.division,
      reason: group.reason,
      anchor_bl_id: group.anchor_bl_id,
      customer_id: group.customer_id,
      customer_name: group.customer_name,
      voyage_label: group.voyage_label,
    })))
    .sort((left, right) => DEMURRAGE_DIVISIONS.indexOf(left.division) - DEMURRAGE_DIVISIONS.indexOf(right.division)
      || Number(right.usd ?? 0) - Number(left.usd ?? 0)
      || left.container_number.localeCompare(right.container_number))
  const byDivision = Object.fromEntries(DEMURRAGE_DIVISIONS.map((item) => [item, { boxes: 0, usd: 0 }])) as DemurrageExposureResult['byDivision']
  const customers = new Map<string, DemurrageExposureResult['byCustomer'][number]>()
  for (const row of rows) {
    byDivision[row.division].boxes += 1
    byDivision[row.division].usd += Number(row.usd ?? 0)
    const key = String(row.customer_id ?? 'sem')
    const customer = customers.get(key) ?? { customer_id: row.customer_id, customer_name: row.customer_name ?? 'Sem Cliente', boxes: 0, usd: 0 }
    customer.boxes += 1
    customer.usd += Number(row.usd ?? 0)
    customers.set(key, customer)
  }
  return { rows, byDivision, byCustomer: Array.from(customers.values()).sort((left, right) => right.usd - left.usd) }
}

/** Exposição: o estado de hoje, sem período; Cliente e Navio / Viagem vão ao banco. */
export async function fetchDemurrageExposure(filters: DemurrageReportFilters): Promise<DemurrageExposureResult> {
  const groups = await listDemurrageBillingBoard({ customerId: positiveId(filters.customerId), voyageId: positiveId(filters.voyageId) })
  return demurrageExposureRows(groups, filters.division)
}

export type DemurrageInvoiceKind = { label: 'Normal' | 'Complementar' | 'Substitui'; doc: string | null }

export type DemurrageReportRow = DemurrageInvoiceListItem & {
  kind: DemurrageInvoiceKind
  net_usd: number
  discount_usd: number
}

export type DemurrageReportResult = {
  rows: DemurrageReportRow[]
  kpis: { netUsd: number; invoices: number; openBrl: number; paidBrl: number }
  load: ReportLoad
}

const LIVE_DEMURRAGE = new Set(['issued', 'overdue', 'paid'])

type SiblingInvoice = { id: number; bl_id: string; doc_number: string; status: string | null; created_at: string | null }

/**
 * Tipo da Invoice, a mesma regra do detalhe: substitui a cancelada de
 * `replaces_invoice_id`; complementar quando outra Invoice viva do mesmo B/L
 * foi criada antes; senão Normal.
 */
export function demurrageInvoiceKind(invoice: Pick<DemurrageInvoiceListItem, 'id' | 'bl_id' | 'created_at' | 'replaces_invoice_id'>, siblings: readonly SiblingInvoice[]): DemurrageInvoiceKind {
  if (invoice.replaces_invoice_id != null) {
    return { label: 'Substitui', doc: siblings.find((other) => other.id === invoice.replaces_invoice_id)?.doc_number ?? null }
  }
  const earlier = siblings.some((other) => other.bl_id === invoice.bl_id && other.id !== invoice.id && LIVE_DEMURRAGE.has(other.status ?? '')
    && ((other.created_at ?? '') < (invoice.created_at ?? '') || ((other.created_at ?? '') === (invoice.created_at ?? '') && other.id < invoice.id)))
  return { label: earlier ? 'Complementar' : 'Normal', doc: null }
}

// ponytail: ids em lotes de 200 para a URL não estourar.
const SIBLING_BATCH = 200

async function fetchSiblingInvoices(rows: readonly DemurrageInvoiceListItem[]): Promise<SiblingInvoice[]> {
  const blIds = Array.from(new Set(rows.map((row) => row.bl_id).filter(Boolean)))
  const replaced = Array.from(new Set(rows.map((row) => row.replaces_invoice_id).filter((id): id is number => id != null)))
  const siblings: SiblingInvoice[] = []
  for (let start = 0; start < blIds.length; start += SIBLING_BATCH) {
    const { data, error } = await supabase.from('demurrage_invoices').select('id, bl_id, doc_number, status, created_at').in('bl_id', blIds.slice(start, start + SIBLING_BATCH))
    if (error) throw error
    siblings.push(...((data ?? []) as SiblingInvoice[]))
  }
  const missing = replaced.filter((id) => !siblings.some((other) => other.id === id))
  for (let start = 0; start < missing.length; start += SIBLING_BATCH) {
    const { data, error } = await supabase.from('demurrage_invoices').select('id, bl_id, doc_number, status, created_at').in('id', missing.slice(start, start + SIBLING_BATCH))
    if (error) throw error
    siblings.push(...((data ?? []) as SiblingInvoice[]))
  }
  return siblings
}

/**
 * Invoices de Demurrage: emissão por `billed_at` no dia de Brasília (filtro,
 * coluna e ordem), USD líquido do desconto, BRL de hoje das em aberto separado
 * do BRL pago. Sem a situação Rascunho nem o filtro Vencidas (D13).
 */
export async function fetchDemurrageReport(filters: DemurrageReportFilters, options: ReportOptions = {}): Promise<DemurrageReportResult> {
  const ceiling = options.ceiling ?? REPORT_SCREEN_CEILING
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
      .neq('status', 'draft')
      .order('billed_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
    if (filters.dateFrom) query = query.gte('billed_at', brasiliaStartOfDay(filters.dateFrom))
    if (filters.dateTo) query = query.lte('billed_at', brasiliaEndOfDay(filters.dateTo))
    if (voyageId) query = query.eq('bl.voyage_id', voyageId)
    if (customerId) query = query.eq('customer_id', customerId)
    if (filters.status === 'issued') query = query.in('status', ['issued', 'overdue'])
    else if (filters.status) query = query.eq('status', filters.status)
    if (filters.dispute === 'sim') query = query.eq('dispute_open', true)
    else if (filters.dispute === 'nao') query = query.or('dispute_open.is.null,dispute_open.eq.false')
    return query.range(from, to).overrideTypes<DemurrageInvoiceListItem[], { merge: false }>()
  }, { ceiling })

  const siblings = await fetchSiblingInvoices(rows)
  const reportRows = rows.map((invoice): DemurrageReportRow => {
    const net = invoiceNetUsd(invoice)
    return { ...invoice, kind: demurrageInvoiceKind(invoice, siblings), net_usd: net.netUsd, discount_usd: net.discountUsd }
  })
  // Canceladas continuam listadas, mas nenhum cartão as soma.
  const live = reportRows.filter((invoice) => invoice.status !== 'cancelled')
  return {
    rows: reportRows,
    kpis: {
      netUsd: live.reduce((sum, invoice) => sum + invoice.net_usd, 0),
      invoices: live.length,
      openBrl: live.filter((invoice) => invoice.status !== 'paid').reduce((sum, invoice) => sum + Number(invoice.current_total_brl ?? 0), 0),
      paidBrl: live.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + Number(invoice.current_total_brl ?? 0), 0),
    },
    load,
  }
}

export type DemurrageItemReportRow = {
  id: number
  container_number: string
  container_type: string | null
  discharge_date: string | null
  return_date: string | null
  total_days: number | null
  free_days: number | null
  days_p1: number | null
  rate_p1_usd: number | null
  days_p2: number | null
  rate_p2_usd: number | null
  subtotal_usd: number | null
  invoice: {
    id: number
    doc_number: string
    status: string | null
    billed_at: string | null
    bl_id: string
    customer: { id: number; name: string } | null
    bl: { voyage_id: number | null; voyage: { voyage_number: string; vessel: { name: string } | null } | null } | null
  }
}

/** Itens por container: cada caixa de Invoice viva (emitida ou paga), pela emissão da Invoice. */
export async function fetchDemurrageItemsReport(filters: DemurrageReportFilters, options: ReportOptions = {}): Promise<PagedRows<DemurrageItemReportRow>> {
  const ceiling = options.ceiling ?? REPORT_SCREEN_CEILING
  const voyageId = positiveId(filters.voyageId)
  const customerId = positiveId(filters.customerId)
  return fetchAllPages<DemurrageItemReportRow>((from, to) => {
    const bl = voyageId ? 'bl:bls!inner(voyage_id,voyage:voyages(voyage_number,vessel:vessels(name)))' : 'bl:bls(voyage_id,voyage:voyages(voyage_number,vessel:vessels(name)))'
    let query = supabase
      .from('demurrage_invoice_items')
      .select(`id, container_number, container_type, discharge_date, return_date, total_days, free_days, days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd,
        invoice:demurrage_invoices!inner(id, doc_number, status, billed_at, bl_id, customer_id, customer:customers(id,name), ${bl})`, reportSelectOptions(from))
      .in('invoice.status', ['issued', 'overdue', 'paid'])
      .order('invoice_id', { ascending: false })
      .order('container_number')
      .order('id')
    if (filters.dateFrom) query = query.gte('invoice.billed_at', brasiliaStartOfDay(filters.dateFrom))
    if (filters.dateTo) query = query.lte('invoice.billed_at', brasiliaEndOfDay(filters.dateTo))
    if (customerId) query = query.eq('invoice.customer_id', customerId)
    if (voyageId) query = query.eq('invoice.bl.voyage_id', voyageId)
    return query.range(from, to).overrideTypes<DemurrageItemReportRow[], { merge: false }>()
  }, { ceiling })
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
  id?: number
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
        // `id` deixa `fetchAllPages` descartar a ligação repetida na fronteira da página.
        .select('id, invoice_id, receivable_id, status, receivable:bl_receivables(id, original_amount_brl, balance_brl, status)', reportSelectOptions(from))
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
