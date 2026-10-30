import { z } from 'zod'
import { canonicalizeDocument } from '../lib/cnpj'
import { formatDate } from '../lib/utils'
import { sanitizeSheetRows } from '../lib/spreadsheetSafe'
import { normalizePixTxid } from '../lib/pix'
import { supabase } from './supabase'
import { invoiceTypeLabel } from './billing'
import type { PixTransaction } from '../types/database'
import { matchesAnyToken } from '../lib/searchTerms'
import { INVOICE_STATUS_LABELS } from '../lib/statusLabels'

export type UnifiedPixMatch = {
  transaction: PixTransaction
  source: 'local' | 'demurrage' | 'unmatched'
  invoiceId: number
  docNumber: string
  customerName: string
  customerCnpj: string
  amount: number
  ambiguous: boolean
  ambiguityReason?: string
  candidateCount?: number
  matchType: 'txid' | 'unmatched'
  exceptionId?: number
}

export type PixReconciliationException = {
  id: number
  importKey: string
  lineNumber: number
  txid: string
  cnpj: string
  paidAt: string | null
  amount: number
  reason: 'unmatched' | 'ambiguous'
  candidateCount: number
  metadata: Record<string, unknown>
  status: 'active' | 'resolved'
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

type PixExceptionRpcRow = {
  id: number
  import_key: string
  line_number: number
  txid: string
  cnpj: string
  paid_at: string | null
  amount_brl: number | string
  reason: 'unmatched' | 'ambiguous'
  candidate_count: number
  metadata: Record<string, unknown> | null
  status: 'active' | 'resolved'
  created_at: string
  updated_at: string
  resolved_at: string | null
}

type PixRpcResult = { data: unknown; error: { message: string } | null }

const pixRpcClient = supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<PixRpcResult>
}

async function callPixRpc(name: string, args: Record<string, unknown>): Promise<PixRpcResult> {
  try {
    return await pixRpcClient.rpc(name, args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      data: null,
      error: { message: `Falha na chamada da operação ${name}: ${msg}` },
    }
  }
}

export type PixExceptionResolution = {
  source: 'local' | 'demurrage'
  invoiceId?: number
  demurrageInvoiceId?: number
  txid?: string
}

export type PixReconciliationCandidate = {
  source: 'local' | 'demurrage'
  invoiceId: number
  docNumber: string
  amount: number
}

export type UnifiedPixConfirmationResult = {
  local: number
  demurrage: number
  items: Array<{ source: 'local' | 'demurrage'; invoice_id: number; doc_number: string; status: 'ok' }>
}

const normTxid = normalizePixTxid


/**
 * Parser rows normally carry the physical spreadsheet line. This fallback is
 * deterministic for callers that construct PixTransaction objects manually;
 * it intentionally never depends on the filtered match-array index.
 */
export function getPixLineIdentity(transaction: Pick<PixTransaction, 'txid' | 'cnpj' | 'date' | 'amount' | 'lineNumber'>): number {
  if (Number.isInteger(transaction.lineNumber) && (transaction.lineNumber ?? 0) > 0) return transaction.lineNumber as number
  const value = `${transaction.txid ?? ''}\u001f${transaction.cnpj ?? ''}\u001f${transaction.date ?? ''}\u001f${transaction.amount}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 2_000_000_000 + 1
}

function normalizePixException(row: PixExceptionRpcRow): PixReconciliationException {
  return {
    id: Number(row.id),
    importKey: row.import_key,
    lineNumber: Number(row.line_number),
    txid: row.txid ?? '',
    cnpj: row.cnpj ?? '',
    paidAt: row.paid_at ?? null,
    amount: Number(row.amount_brl ?? 0),
    reason: row.reason,
    candidateCount: Number(row.candidate_count ?? 0),
    metadata: row.metadata ?? {},
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? null,
  }
}

export async function createPixImportKey(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return `file:${file.name}:${file.size}:${file.lastModified}`
  const digest = await subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hash}`
}

export async function persistUnresolvedPixMatches(
  importKey: string,
  matches: UnifiedPixMatch[],
): Promise<Array<{ id: number; lineNumber: number; status: 'active' | 'resolved' }>> {
  const rows = matches
    .filter((match) => match.source === 'unmatched' || match.ambiguous)
    .map((match) => ({
      line_number: getPixLineIdentity(match.transaction),
      txid: match.transaction.txid ?? '',
      cnpj: match.transaction.cnpj ?? '',
      paid_at: match.transaction.date || null,
      amount_brl: match.transaction.amount,
      reason: match.source === 'unmatched' ? 'unmatched' : 'ambiguous',
      candidate_count: match.candidateCount ?? 0,
      metadata: {
        doc_number: match.docNumber,
        customer_name: match.customerName,
        customer_cnpj: match.customerCnpj,
        ambiguity_reason: match.ambiguityReason ?? null,
        source: match.source,
        line_identity: getPixLineIdentity(match.transaction),
      },
    }))

  if (!rows.length) return []
  const { data, error } = await callPixRpc('upsert_pix_reconciliation_exceptions', {
    p_import_key: importKey,
    p_rows: rows,
  })
  if (error) throw error
  const items = ((data as { items?: Array<{ id: number; line_number: number; status: 'active' | 'resolved' }> } | null)?.items ?? [])
  return items.map((item) => ({ id: Number(item.id), lineNumber: Number(item.line_number), status: item.status }))
}

export async function listPixReconciliationCandidates(exceptionId: number): Promise<PixReconciliationCandidate[]> {
  const { data, error } = await callPixRpc('list_pix_reconciliation_candidates', { p_exception_id: exceptionId })
  if (error) throw error
  return ((data ?? []) as Array<{ source: 'local' | 'demurrage'; invoice_id: number; doc_number: string; amount_brl: number | string }>).map((row) => ({
    source: row.source,
    invoiceId: Number(row.invoice_id),
    docNumber: row.doc_number,
    amount: Number(row.amount_brl ?? 0),
  }))
}

export async function linkPixReconciliationCandidate(
  exceptionId: number,
  candidate: Pick<PixReconciliationCandidate, 'source' | 'invoiceId'>,
): Promise<{ id: number; status: 'active' | 'resolved' }> {
  const { data, error } = await callPixRpc('link_pix_reconciliation_candidate', {
    p_exception_id: exceptionId,
    p_resolution_source: candidate.source,
    p_invoice_id: candidate.source === 'local' ? candidate.invoiceId : null,
    p_demurrage_invoice_id: candidate.source === 'demurrage' ? candidate.invoiceId : null,
  })
  if (error) throw error
  const result = data as { id?: number; status?: 'active' | 'resolved' } | null
  return { id: Number(result?.id ?? exceptionId), status: result?.status ?? 'active' }
}

export async function listPixReconciliationExceptions(
  status: 'active' | 'resolved' | 'all' = 'active',
): Promise<PixReconciliationException[]> {
  const { data, error } = await callPixRpc('list_pix_reconciliation_exceptions', { p_status: status })
  if (error) throw error
  return ((data ?? []) as unknown as PixExceptionRpcRow[]).map(normalizePixException)
}

export async function resolvePixReconciliationException(
  exceptionId: number,
  resolution: PixExceptionResolution,
): Promise<{ id: number; status: 'resolved' }> {
  const { data, error } = await callPixRpc('resolve_pix_reconciliation_exception', {
    p_exception_id: exceptionId,
    p_resolution_source: resolution.source,
    p_invoice_id: resolution.source === 'local' ? resolution.invoiceId ?? null : null,
    p_demurrage_invoice_id: resolution.source === 'demurrage' ? resolution.demurrageInvoiceId ?? null : null,
    p_txid: resolution.txid ?? null,
  })
  if (error) throw error
  const result = data as { id?: number; status?: 'resolved' } | null
  return { id: Number(result?.id ?? exceptionId), status: result?.status ?? 'resolved' }
}

export async function matchUnifiedPixTransactions(transactions: PixTransaction[]): Promise<UnifiedPixMatch[]> {
  // O servidor resolve cada TXID nas faturas abertas: versão de cobrança local,
  // TXID gravado, avulsa e Invoice de Demurrage pelo número (QR estático) ou
  // pela cobrança Itaú (`list_pix_txid_candidates`, migration 242).
  const candidatesRes = await supabase.rpc('list_pix_txid_candidates' as never, {
    p_txids: [...new Set(transactions.map((tx) => tx.txid).filter((txid) => normTxid(txid)))],
  } as never)
  if (candidatesRes.error) throw candidatesRes.error
  const candidates = z.array(z.object({
    txid: z.string(), source: z.enum(['local', 'demurrage']), id: z.number(), doc_number: z.string().nullable(),
    amount_brl: z.coerce.number(),
    customer: z.object({ name: z.string().nullable(), cnpj_cpf: z.string().nullable() }),
  })).parse(candidatesRes.data ?? [])

  // Janela das duas PTAX (ADR 0015): para validar pagamentos feitos com um QR de
  // um dia anterior, carregamos o histórico de recálculo das faturas candidatas.
  const demurrageIds = [...new Set(candidates.filter((c) => c.source === 'demurrage').map((c) => c.id))]
  const historyByInvoice = new Map<number, Array<{ event_date: string; total_brl: number }>>()
  if (demurrageIds.length) {
    const { data: histRows, error: histErr } = await supabase
      .from('demurrage_invoice_history')
      .select('invoice_id, event_date, total_brl, id')
      .in('invoice_id', demurrageIds)
      .order('event_date', { ascending: false })
      .order('id', { ascending: false })
    if (histErr) throw histErr
    for (const row of (histRows ?? []) as Array<{ invoice_id: number; event_date: string; total_brl: number }>) {
      const list = historyByInvoice.get(row.invoice_id) ?? []
      list.push({ event_date: row.event_date, total_brl: Number(row.total_brl) })
      historyByInvoice.set(row.invoice_id, list)
    }
  }

  // Aceita o valor pago se casar com qualquer uma das duas entradas de recálculo
  // mais recentes com event_date <= data do pagamento, ou (fallback) com o corrente.
  function demurrageAmountAcceptable(invoiceId: number, paymentDate: string, amount: number, currentBrl: number): boolean {
    const rows = historyByInvoice.get(invoiceId) ?? []
    const windowRows = rows.filter((r) => r.event_date <= paymentDate).slice(0, 2)
    if (windowRows.some((r) => Math.abs(r.total_brl - amount) <= 0.01)) return true
    return Math.abs(currentBrl - amount) <= 0.01
  }

  type InvEntry = {
    source: 'local' | 'demurrage'
    id: number
    docNumber: string
    customerName: string
    customerCnpj: string
    amount: number
  }

  const txidMap = new Map<string, InvEntry[]>()
  for (const candidate of candidates) {
    // O TXID normalizado é a identidade primária do PIX. O número do documento
    // permanece apenas como rótulo.
    const key = normTxid(candidate.txid)
    if (!key) continue
    txidMap.set(key, [...(txidMap.get(key) ?? []), {
      source: candidate.source,
      id: candidate.id,
      docNumber: candidate.doc_number ?? String(candidate.id),
      customerName: candidate.customer.name ?? '',
      customerCnpj: canonicalizeDocument(candidate.customer.cnpj_cpf ?? ''),
      amount: candidate.amount_brl,
    }])
  }

  const matches: UnifiedPixMatch[] = []
  const seenTxids = new Set<string>()
  for (const tx of transactions) {
    const key = normTxid(tx.txid)
    const entries = key ? txidMap.get(key) ?? [] : []
    if (!entries.length) {
      matches.push({
        transaction: tx,
        source: 'unmatched',
        invoiceId: 0,
        docNumber: tx.txid,
        customerName: '',
        customerCnpj: canonicalizeDocument(tx.cnpj ?? ''),
        amount: tx.amount,
        ambiguous: true,
        ambiguityReason: 'Nenhum documento aberto usa este TXID.',
        candidateCount: 0,
        matchType: 'unmatched',
      })
      continue
    }

    const entry = entries[0]
    const amountDiff = tx.amount - entry.amount
    let ambiguityReason: string | undefined
    if (entries.length > 1) {
      ambiguityReason = `${entries.length} documentos usam o mesmo TXID.`
    } else if (seenTxids.has(key)) {
      // O mesmo TXID aparece mais de uma vez no extrato (faixas de data sobrepostas).
      // O PIX copia-e-cola tem valor fixo, entao a fatura ja foi casada pela 1a linha.
      ambiguityReason = 'TXID repetido no mesmo extrato.'
    } else if (!Number.isFinite(amountDiff)) {
      ambiguityReason = 'Valor do documento não é numérico.'
    } else if (
      entry.source === 'demurrage'
        ? !demurrageAmountAcceptable(entry.id, tx.date, tx.amount, entry.amount)
        : Math.abs(amountDiff) > 0.01
    ) {
      // PIX e copia-e-cola de valor fixo: precisa bater exatamente. Para demurrage,
      // aceita a janela das duas PTAX (QR de um dia anterior ainda e pagavel).
      ambiguityReason =
        entry.source === 'demurrage'
          ? 'Valor do Pix diferente da Invoice de Demurrage (fora da janela das duas PTAX).'
          : 'Valor do Pix diferente do valor da cobrança da fatura.'
    }

    if (key && !ambiguityReason) seenTxids.add(key)

    matches.push({
      transaction: tx,
      source: entry.source,
      invoiceId: entry.id,
      docNumber: entry.docNumber,
      customerName: entry.customerName,
      customerCnpj: entry.customerCnpj,
      amount: entry.amount,
      ambiguous: Boolean(ambiguityReason),
      ambiguityReason,
      candidateCount: entries.length,
      matchType: 'txid',
    })
  }

  return matches
}

export async function confirmUnifiedPixReconciliation(matches: UnifiedPixMatch[]): Promise<UnifiedPixConfirmationResult> {
  const payload = matches
    .filter((match): match is UnifiedPixMatch & { source: 'local' | 'demurrage' } =>
      !match.ambiguous && match.source !== 'unmatched')
    .map((match) => {
      const paidAt = match.transaction.date
      if (!paidAt) {
        throw new Error(`Data do pagamento não identificada no extrato para ${match.docNumber}.`)
      }

      return {
        source: match.source,
        invoice_id: match.invoiceId,
        doc_number: match.docNumber,
        txid: match.transaction.txid,
        amount: match.transaction.amount,
        expected_amount: match.amount,
        paid_at: paidAt,
      }
    })

  const { data, error } = await supabase.rpc('confirm_unified_pix_matches', {
    p_matches: payload,
  })
  if (error) throw error

  const result = (data ?? {}) as UnifiedPixConfirmationResult
  return {
    local: Number(result.local ?? 0),
    demurrage: Number(result.demurrage ?? 0),
    items: Array.isArray(result.items) ? result.items : [],
  }
}

// ========== Reconciliation History ==========

/**
 * Forma da baixa (ADR 0115, migration 546): automática pela consulta do Itaú,
 * pelo extrato (plano B), registrada à mão (inclusive a baixa de um Pix
 * recebido escolhida pelo operador) ou isenção da Invoice de Demurrage.
 */
export type PaymentMethod = 'itau' | 'extract' | 'manual' | 'exemption'

/**
 * Uma baixa num B/L. A consolidada paga por uma baixa tem uma linha por B/L,
 * cada uma com o que a baixa liquidou nele; a fatura coberta pela consolidada
 * mostra as baixas que recebeu antes. Situação e saldo são os atuais da fatura.
 */
export type ReconciliationHistoryRow = {
  id: string
  source: 'local' | 'demurrage'
  invoiceId: number
  docNumber: string
  invoiceType: string | null
  customerName: string
  customerCnpj: string
  /** `-` quando a baixa não é de um B/L só (avulsa sem B/L ou com vários). */
  blId: string
  /** B/Ls da fatura quando a baixa não foi rateada por B/L (avulsa). */
  blCount: number
  vesselName: string | null
  voyageNumber: string | null
  pod: string | null
  /** Valor do B/L na fatura (a fatura inteira quando não há B/L). */
  blAmount: number
  totalAmount: number
  paymentId: number | null
  paidAt: string | null
  /** Quanto esta baixa pôs neste B/L. */
  amount: number
  /** Valor da baixa inteira (repete nas linhas de B/L da mesma baixa). */
  paymentAmount: number
  method: PaymentMethod
  /** Referência bancária da baixa (identificador do Pix, TXID ou o que foi digitado). */
  bankReference: string | null
  balance: number | null
  status: string
}

export type ReconciliationFilters = {
  paidFrom: string
  paidTo: string
  source: '' | 'local' | 'demurrage'
  method: '' | PaymentMethod
  customerId: string
  blSearch: string
  vesselSearch: string
  voyageSearch: string
  invoiceTypeFilter: '' | 'consolidated' | 'single' | 'manual'
  pod: string
  sort: string
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

const DEFAULT_HISTORY_FILTERS: ReconciliationFilters = {
  paidFrom: '',
  paidTo: '',
  source: '',
  method: '',
  customerId: '',
  blSearch: '',
  vesselSearch: '',
  voyageSearch: '',
  invoiceTypeFilter: '',
  pod: '',
  sort: 'paidAt',
  sortDir: 'desc',
  page: 1,
  pageSize: 50,
}

export function normalizeReconciliationInvoiceTypeFilter(
  filter: ReconciliationFilters['invoiceTypeFilter'],
): '' | 'consolidated' | 'individual' | 'manual' {
  return filter === 'single' ? 'individual' : filter
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  itau: 'Automática (Itaú)',
  extract: 'Pelo extrato',
  manual: 'Manual',
  exemption: 'Isenção',
}

export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS[method] ?? method
}

/** Saldo da fatura; Demurrage paga não tem saldo. */
export function historyBalance(row: Pick<ReconciliationHistoryRow, 'source' | 'balance'>): number {
  return row.source === 'demurrage' ? 0 : row.balance ?? 0
}

export type ReconciliationHistorySummary = {
  /** Baixas distintas no recorte (a da consolidada tem uma linha por B/L). */
  payments: number
  /** Soma do que as baixas do recorte puseram nos B/Ls. */
  received: number
}

const paymentKey = (row: Pick<ReconciliationHistoryRow, 'source' | 'paymentId' | 'invoiceId'>) =>
  row.source === 'local' ? `local-${row.paymentId}` : `demurrage-${row.invoiceId}`

/** Resumo do recorte inteiro, não só da página: cada baixa conta uma vez. */
export function summarizeReconciliationHistory(rows: readonly ReconciliationHistoryRow[]): ReconciliationHistorySummary {
  const payments = new Set(rows.map(paymentKey))
  const received = rows.reduce((sum, row) => sum + row.amount, 0)
  return { payments: payments.size, received: Math.round(received * 100) / 100 }
}

type PaymentHistoryRpcRow = {
  source: 'local' | 'demurrage'
  invoice_id: number | string
  doc_number: string | null
  invoice_type: string | null
  invoice_status: string | null
  invoice_total_brl: number | string | null
  invoice_balance_brl: number | string | null
  customer_name: string | null
  customer_cnpj: string | null
  payment_id: number | string | null
  paid_at: string | null
  payment_amount_brl: number | string | null
  method: PaymentMethod
  bank_reference: string | null
  bl_id: string | null
  bl_count: number | null
  bl_amount_brl: number | string | null
  amount_brl: number | string | null
  pod: string | null
  voyage_number: string | null
  vessel_name: string | null
}

const toNumber = (value: number | string | null | undefined) => Number(value ?? 0)

export function toReconciliationHistoryRow(r: PaymentHistoryRpcRow): ReconciliationHistoryRow {
  const blId = (r.bl_id ?? '').trim() || '-'
  const paymentId = r.payment_id == null ? null : Number(r.payment_id)
  return {
    id: r.source === 'local' ? `local-${paymentId}-${blId}` : `demurrage-${r.invoice_id}`,
    source: r.source,
    invoiceId: Number(r.invoice_id),
    docNumber: r.doc_number ?? `INV-${r.invoice_id}`,
    invoiceType: r.invoice_type,
    customerName: r.customer_name ?? '',
    customerCnpj: r.customer_cnpj ?? '',
    blId,
    blCount: Number(r.bl_count ?? 0),
    vesselName: r.vessel_name,
    voyageNumber: r.voyage_number,
    pod: r.pod,
    blAmount: toNumber(r.bl_amount_brl),
    totalAmount: toNumber(r.invoice_total_brl),
    paymentId,
    paidAt: r.paid_at,
    amount: toNumber(r.amount_brl),
    paymentAmount: toNumber(r.payment_amount_brl),
    method: r.method,
    bankReference: r.bank_reference,
    balance: r.invoice_balance_brl == null ? null : Number(r.invoice_balance_brl),
    status: r.invoice_status ?? '',
  }
}

export async function listReconciliationHistory(
  userFilters: Partial<ReconciliationFilters>,
): Promise<{ rows: ReconciliationHistoryRow[]; totalCount: number; summary: ReconciliationHistorySummary }> {
  const filters: ReconciliationFilters = { ...DEFAULT_HISTORY_FILTERS, ...userFilters }

  // Uma linha por baixa e B/L, com a forma da baixa decidida no banco
  // (`list_payment_history`, migration 546): o navegador não lê os
  // recebimentos do Itaú nem a conta da baixa automática.
  const { data, error } = await callPixRpc('list_payment_history', {
    p_customer_id: filters.customerId ? Number(filters.customerId) : null,
  })
  if (error) throw error

  let all = ((data ?? []) as PaymentHistoryRpcRow[]).map(toReconciliationHistoryRow)

  // Only show rows with a payment date — data de pagamento é obrigatória
  all = all.filter((r) => r.paidAt !== null)

  if (filters.paidFrom) all = all.filter((r) => r.paidAt! >= filters.paidFrom)
  if (filters.paidTo) all = all.filter((r) => r.paidAt! <= `${filters.paidTo}T23:59:59`)
  if (filters.source) all = all.filter((r) => r.source === filters.source)
  if (filters.method) all = all.filter((r) => r.method === filters.method)
  if (filters.blSearch) {
    const term = filters.blSearch.toUpperCase()
    all = all.filter((r) => r.blId.toUpperCase().includes(term) || matchesAnyToken(term, [r.blId]))
  }
  if (filters.vesselSearch) {
    const term = filters.vesselSearch.toUpperCase()
    all = all.filter((r) => (r.vesselName?.toUpperCase() ?? '').includes(term))
  }
  if (filters.voyageSearch) {
    const term = filters.voyageSearch.toUpperCase()
    all = all.filter((r) => (r.voyageNumber?.toUpperCase() ?? '').includes(term))
  }
  if (filters.invoiceTypeFilter) {
    const invoiceType = normalizeReconciliationInvoiceTypeFilter(filters.invoiceTypeFilter)
    all = all.filter((r) => r.invoiceType === invoiceType)
  }
  if (filters.pod) {
    const term = filters.pod.toUpperCase()
    all = all.filter((r) => (r.pod?.toUpperCase() ?? '').includes(term))
  }

  const sf = filters.sort || 'paidAt'
  const sd = filters.sortDir || 'desc'
  all.sort((a, b) => {
    let cmp = 0
    if (sf === 'paidAt') cmp = (a.paidAt ?? '').localeCompare(b.paidAt ?? '')
    else if (sf === 'docNumber') cmp = a.docNumber.localeCompare(b.docNumber)
    else if (sf === 'customerName') cmp = a.customerName.localeCompare(b.customerName)
    else if (sf === 'blAmount') cmp = a.blAmount - b.blAmount
    else if (sf === 'amount') cmp = a.amount - b.amount
    else if (sf === 'totalAmount') cmp = a.totalAmount - b.totalAmount
    else if (sf === 'blId') cmp = a.blId.localeCompare(b.blId)
    // Empate: a baixa mais nova primeiro e as linhas dela juntas, na ordem do B/L.
    return (sd === 'desc' ? -cmp : cmp)
      || (b.paymentId ?? 0) - (a.paymentId ?? 0) || a.docNumber.localeCompare(b.docNumber) || a.blId.localeCompare(b.blId)
  })

  const totalCount = all.length
  const from = (filters.page - 1) * filters.pageSize
  const rows = all.slice(from, from + filters.pageSize)

  // ponytail: o histórico já é filtrado e paginado no navegador sobre a lista
  // inteira, então o resumo do recorte sai daqui sem nova consulta. Se a
  // paginação for para o servidor, o resumo precisa vir junto da RPC.
  return { rows, totalCount, summary: summarizeReconciliationHistory(all) }
}

export async function exportReconciliationHistoryExcel(filters: Partial<ReconciliationFilters>) {
  const { rows } = await listReconciliationHistory({ ...filters, page: 1, pageSize: 999999 })

  const XLSX = await import('@e965/xlsx')

  // Cabeçalhos com os nomes das colunas da tela (lote 3 da identidade), uma
  // linha por baixa e B/L como na tela (ADR 0115).
  const data = rows.map((r) => ({
    Fatura: r.docNumber,
    Origem: r.source === 'demurrage' ? 'Demurrage' : 'Taxas Locais',
    'Tipo de fatura': r.source === 'demurrage' ? '' : invoiceTypeLabel(r.invoiceType),
    'B/L': r.blId === '-' ? '' : r.blId,
    Cliente: r.customerName,
    CNPJ: r.customerCnpj,
    Navio: r.vesselName ?? '',
    Viagem: r.voyageNumber ?? '',
    POD: r.pod ?? '',
    'Pago em': r.paidAt ? formatDate(r.paidAt) : '',
    'Forma da baixa': paymentMethodLabel(r.method),
    'Referência bancária': r.bankReference ?? '',
    'Valor do B/L': r.blAmount,
    'Valor da fatura': r.totalAmount,
    'Valor pago': r.amount,
    'Valor da baixa': r.paymentAmount,
    Saldo: historyBalance(r),
    Situação: r.status === 'paid' ? 'Paga' : r.status === 'covered' ? 'Coberta pela consolidada' : r.status === 'partially_paid' ? 'Parcialmente paga' : INVOICE_STATUS_LABELS[r.status] ?? r.status,
  }))

  const safeRows = sanitizeSheetRows(data)

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(safeRows)
  XLSX.utils.book_append_sheet(workbook, sheet, 'Conciliação')
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('')
  XLSX.writeFile(workbook, `conciliacao-${ts}.xlsx`)
}

export async function reverseLocalInvoicePayment(paymentId: number, reason?: string) {
  const { error } = await supabase.rpc('reverse_invoice_payment', {
    p_payment_id: paymentId,
    ...(reason == null ? {} : { p_reason: reason }),
  })
  if (error) throw error
}

export async function reverseDemurragePayment(invoiceId: number, reason?: string) {
  const { error } = await supabase.rpc('reverse_demurrage_payment', {
    p_invoice_id: invoiceId,
    ...(reason == null ? {} : { p_reason: reason }),
  })
  if (error) throw error
}

export type ItauPixMonitorCharge = {
  id: number
  txid: string
  status: 'pending_create' | 'pending_update' | 'pending_expire_check' | 'pending_cancel' | 'active' | 'cancelled' | 'concluded' | 'expired'
  uncertain: boolean
  attempts: number
  lastError: string | null
  amount: number
  nextAttemptAt: string
  updatedAt: string
  source: 'local' | 'demurrage'
  invoiceId: number | null
  docNumber: string | null
}

export type ItauPixMonitor = {
  provider: 'static' | 'itau'
  polledUntil: string | null
  counts: Record<string, number>
  charges: ItauPixMonitorCharge[]
  receipts: Array<{ endToEndId: string; txid: string; amount: number; paidAt: string; reason: string | null }>
}

type ItauPixMonitorRow = {
  provider: 'static' | 'itau'
  polled_until: string | null
  counts: Record<string, number> | null
  charges: Array<{
    id: number; txid: string; status: ItauPixMonitorCharge['status']; uncertain: boolean; attempts: number
    last_error: string | null; amount_brl: number | string; next_attempt_at: string; updated_at: string
    source: 'local' | 'demurrage'; invoice_id: number | null; doc_number: string | null
  }> | null
  receipts: Array<{ end_to_end_id: string; txid: string; amount_brl: number | string; paid_at: string; reason: string | null }> | null
}

export async function getItauPixMonitor(): Promise<ItauPixMonitor> {
  const { data, error } = await callPixRpc('itau_pix_monitor', {})
  if (error) throw error
  const row = data as ItauPixMonitorRow
  return {
    provider: row.provider,
    polledUntil: row.polled_until,
    counts: row.counts ?? {},
    charges: (row.charges ?? []).map((c) => ({
      id: Number(c.id),
      txid: c.txid,
      status: c.status,
      uncertain: c.uncertain,
      attempts: Number(c.attempts),
      lastError: c.last_error,
      amount: Number(c.amount_brl),
      nextAttemptAt: c.next_attempt_at,
      updatedAt: c.updated_at,
      source: c.source,
      invoiceId: c.invoice_id == null ? null : Number(c.invoice_id),
      docNumber: c.doc_number,
    })),
    receipts: (row.receipts ?? []).map((r) => ({
      endToEndId: r.end_to_end_id,
      txid: r.txid,
      amount: Number(r.amount_brl),
      paidAt: r.paid_at,
      reason: r.reason,
    })),
  }
}

// Encerra um Pix Itaú em análise que não se resolve por baixa (ex.: restituição).
export async function markItauPixReceiptHandled(endToEndId: string, note: string): Promise<void> {
  const { error } = await callPixRpc('itau_pix_mark_receipt_handled', { p_end_to_end_id: endToEndId, p_note: note })
  if (error) throw error
}

// Pix recebidos (ADR 0100, migration 442): todo Pix que o Itaú informou na
// consulta. O de cobrança do Vela tem a baixa automática, e o do QR estático
// do Vela também quando este ambiente cobra pelo QR estático (ADR 0115,
// migration 545); o resto fica gravado sem baixa e sem Alerta, e o operador
// pode dar a baixa numa fatura se quiser.

export type ItauPixReceiptOrigin = 'vela' | 'static' | 'none' | 'other' | 'test'
export type ItauPixReceiptSituation = 'settled' | 'received' | 'review' | 'handled'
type InvoiceRef = { source: 'local' | 'demurrage'; invoiceId: number; docNumber: string | null }

export type ItauPixReceipt = {
  endToEndId: string
  txid: string
  origin: ItauPixReceiptOrigin
  amount: number
  paidAt: string
  recordedAt: string
  situation: ItauPixReceiptSituation
  /** Quem deu a baixa: a automática do Itaú, o extrato antes dela (migration 444) ou a manual (por esta tela ou com o endToEndId na referência). */
  settledBy: 'itau' | 'extract' | 'manual' | null
  settled: InvoiceRef | null
  /** Fatura da cobrança do Vela que gerou o Pix, mesmo sem baixa. */
  charge: InvoiceRef | null
  reason: string | null
  handledNote: string | null
  pixKey: string | null
  payerName: string | null
  payerDocument: string | null
  payerMessage: string | null
  /** Retorno do Itaú como veio; só para Financeiro e Administrativo. */
  raw: Record<string, unknown> | null
}

export type ItauPixReceiptFilters = {
  from: string
  to: string
  situation: ItauPixReceiptSituation | ''
  origin: ItauPixReceiptOrigin | ''
  amount: number | null
  search: string
  page: number
  pageSize: number
}

export type ItauPixReceiptPage = { total: number; totalAmount: number; rows: ItauPixReceipt[] }

type InvoiceRefRow = { source: 'local' | 'demurrage' | null; id: number | string | null; doc: string | null }
type ItauPixReceiptRow = {
  end_to_end_id: string; txid: string; origin: ItauPixReceiptOrigin; amount_brl: number | string; paid_at: string
  recorded_at: string; situation: ItauPixReceiptSituation; settled_by: ItauPixReceipt['settledBy']
  settled_source: InvoiceRefRow['source']; settled_invoice_id: InvoiceRefRow['id']; settled_doc_number: string | null
  charge_source: InvoiceRefRow['source']; charge_invoice_id: InvoiceRefRow['id']; charge_doc_number: string | null
  reason: string | null; handled_note: string | null; pix_key: string | null
  payer_name: string | null; payer_document: string | null; payer_message: string | null
  raw: Record<string, unknown> | null
}

function invoiceRef({ source, id, doc }: InvoiceRefRow): InvoiceRef | null {
  return source && id != null ? { source, invoiceId: Number(id), docNumber: doc } : null
}

export async function listItauPixReceipts(filters: ItauPixReceiptFilters): Promise<ItauPixReceiptPage> {
  const { data, error } = await callPixRpc('list_itau_pix_receipts', {
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_situation: filters.situation || null,
    p_origin: filters.origin || null,
    p_amount_brl: filters.amount,
    p_search: filters.search.trim() || null,
    p_limit: filters.pageSize,
    p_offset: (Math.max(filters.page, 1) - 1) * filters.pageSize,
  })
  if (error) throw error
  const page = data as { total: number | string; total_amount_brl: number | string; rows: ItauPixReceiptRow[] | null }
  return {
    total: Number(page.total),
    totalAmount: Number(page.total_amount_brl),
    rows: (page.rows ?? []).map((r) => ({
      endToEndId: r.end_to_end_id,
      txid: r.txid,
      origin: r.origin,
      amount: Number(r.amount_brl),
      paidAt: r.paid_at,
      recordedAt: r.recorded_at,
      situation: r.situation,
      settledBy: r.settled_by,
      settled: invoiceRef({ source: r.settled_source, id: r.settled_invoice_id, doc: r.settled_doc_number }),
      charge: invoiceRef({ source: r.charge_source, id: r.charge_invoice_id, doc: r.charge_doc_number }),
      reason: r.reason,
      handledNote: r.handled_note,
      pixKey: r.pix_key,
      payerName: r.payer_name,
      payerDocument: r.payer_document,
      payerMessage: r.payer_message,
      raw: r.raw,
    })),
  }
}

export type ItauPixReceiptCandidate = {
  source: 'local' | 'demurrage'
  invoiceId: number
  docNumber: string
  invoiceType: string | null
  openAmount: number
  customerName: string | null
  customerDocument: string | null
  sameAmount: boolean
  /** O documento do pagador informado pelo Itaú é o do Cliente da fatura. */
  sameCustomer: boolean
}

/** Faturas abertas para um Pix recebido: as do número digitado ou, sem número, as de mesmo valor ou do Cliente do pagador. */
export async function listItauPixReceiptCandidates(endToEndId: string, docNumber?: string): Promise<ItauPixReceiptCandidate[]> {
  const { data, error } = await callPixRpc('list_itau_pix_receipt_candidates', {
    p_end_to_end_id: endToEndId,
    p_doc_number: docNumber?.trim() || null,
  })
  if (error) throw error
  return ((data ?? []) as Array<{
    source: 'local' | 'demurrage'; invoice_id: number | string; doc_number: string; invoice_type: string | null
    open_amount_brl: number | string | null; customer_name: string | null; customer_document: string | null
    same_amount: boolean; same_customer: boolean
  }>).map((c) => ({
    source: c.source,
    invoiceId: Number(c.invoice_id),
    docNumber: c.doc_number,
    invoiceType: c.invoice_type,
    openAmount: Number(c.open_amount_brl ?? 0),
    customerName: c.customer_name,
    customerDocument: c.customer_document,
    sameAmount: c.same_amount === true,
    sameCustomer: c.same_customer === true,
  }))
}

/** Baixa de um Pix recebido na fatura escolhida, com o valor e o horário do Pix e o endToEndId na referência. */
export async function settleItauPixReceipt(endToEndId: string, candidate: Pick<ItauPixReceiptCandidate, 'source' | 'invoiceId'>): Promise<{ docNumber: string | null }> {
  const { data, error } = await callPixRpc('itau_pix_settle_received', {
    p_end_to_end_id: endToEndId,
    p_source: candidate.source,
    p_invoice_id: candidate.invoiceId,
  })
  if (error) throw error
  return { docNumber: (data as { doc_number?: string | null } | null)?.doc_number ?? null }
}
