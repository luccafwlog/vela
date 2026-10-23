import { parseImportNumber } from '../../lib/importNumber'
import type {
  ItauPixMonitor,
  ItauPixMonitorCharge,
  ItauPixReceipt,
  ItauPixReceiptOrigin,
  ReconciliationHistoryRow,
  PixReconciliationException,
  UnifiedPixConfirmationResult,
  UnifiedPixMatch,
} from '../../services/reconciliacao'

/**
 * Leituras da Conciliação PIX. Não decidem nada: organizam o que o matching
 * (`matchUnifiedPixTransactions`), a confirmação (`confirm_unified_pix_matches`)
 * e o monitor Itaú (`itau_pix_monitor`) já devolveram, para a tela separar
 * Pix recebido, baixa confirmada e exceção pendente.
 */

const BRASILIA_DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Instante gravado em UTC (consulta e recebimento Itaú) no horário de
 * Brasília. `formatDateTime` de `lib/utils` mostra a hora literal do texto,
 * que para `…T15:00:00+00:00` seria 15:00 e não 12:00.
 */
export function formatBrasiliaInstant(value: string | null | undefined): string {
  if (!value) return '—'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return '—'
  return BRASILIA_DATE_TIME.format(at).replace(',', ' às')
}

/**
 * Dia do extrato. A exceção grava a data da linha (aaaa-mm-dd) num
 * `timestamptz` à meia-noite UTC; convertida para Brasília viraria o dia
 * anterior, então vale a data escrita.
 */
export function formatExtractDay(value: string | null | undefined): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  return day ? `${day[3]}/${day[2]}/${day[1]}` : '—'
}

export type ExtractLineKind = 'ready' | 'ambiguous' | 'unmatched'

export function extractLineKind(match: UnifiedPixMatch): ExtractLineKind {
  if (match.source === 'unmatched') return 'unmatched'
  return match.ambiguous ? 'ambiguous' : 'ready'
}

/** Linhas do extrato: as que entram no lote e as que ficam como exceção pendente. */
export function splitExtractLines(matches: readonly UnifiedPixMatch[]) {
  const ready: UnifiedPixMatch[] = []
  const exceptions: UnifiedPixMatch[] = []
  for (const match of matches) (extractLineKind(match) === 'ready' ? ready : exceptions).push(match)
  return {
    ready,
    exceptions,
    ambiguous: exceptions.filter((match) => match.source !== 'unmatched').length,
    unmatched: exceptions.filter((match) => match.source === 'unmatched').length,
    readyTotal: ready.reduce((sum, match) => sum + match.transaction.amount, 0),
  }
}

/**
 * Pronta para baixa com valor diferente do documento só acontece na Demurrage:
 * o QR de um dia anterior continua pagável dentro da janela das duas PTAX
 * (ADR 0015). A Taxa Local exige o valor exato da cobrança.
 */
export function readyAmountNote(match: UnifiedPixMatch): string | null {
  if (Math.abs(match.transaction.amount - match.amount) <= 0.01) return null
  return match.source === 'demurrage'
    ? 'Cotação anterior aceita (janela das duas PTAX); a baixa grava o valor pago.'
    : 'Valor diferente da cobrança; o banco confere de novo na baixa.'
}

/**
 * Identificador do Pix encurtado para a tabela: começo e fim, que é onde
 * dois identificadores da Vela diferem. O valor inteiro vai no `title` e na
 * linha aberta.
 */
export function shortTxid(txid: string | null | undefined): string {
  const value = (txid ?? '').trim()
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-7)}` : value
}

const NO_TXID_REASON = 'Linha sem identificador no extrato'
const UNMATCHED_REASON = 'Nenhuma fatura aberta com este identificador'

/** Texto da tela: o matching e o banco ainda dizem "TXID"; a tela diz "identificador". */
function screenReason(text: string): string {
  return text
    .trim()
    .replace(/\.$/, '')
    .replace(/Nenhum documento aberto usa este TXID/i, UNMATCHED_REASON)
    .replace(/documentos usam o mesmo TXID/i, 'faturas usam o mesmo identificador')
    .replace(/TXID repetido no mesmo extrato/i, 'Identificador repetido no mesmo extrato')
    .replace(/\bTXID\b/g, 'identificador do Pix')
}

/** Motivo de uma exceção persistida, com o que a tela tem do matching. */
export function pendingExceptionReason(exception: Pick<PixReconciliationException, 'reason' | 'txid' | 'candidateCount' | 'metadata'>): string {
  if (!exception.txid.trim()) return NO_TXID_REASON
  const stored = typeof exception.metadata?.ambiguity_reason === 'string' ? exception.metadata.ambiguity_reason.trim() : ''
  if (stored) return screenReason(stored)
  if (exception.reason === 'unmatched') return UNMATCHED_REASON
  return exception.candidateCount > 1 ? `${exception.candidateCount} faturas usam o mesmo identificador` : 'Precisa de conferência antes da baixa'
}

/**
 * Motivo de uma linha do extrato que fica como exceção, com as mesmas
 * palavras de Pendências: linha sem identificador não é "nenhuma fatura usa".
 */
export function extractLineReason(match: Pick<UnifiedPixMatch, 'transaction' | 'ambiguityReason' | 'source'>): string {
  if (!match.transaction.txid.trim()) return NO_TXID_REASON
  if (match.ambiguityReason) return screenReason(match.ambiguityReason)
  return match.source === 'unmatched' ? UNMATCHED_REASON : 'Precisa de conferência antes da baixa'
}

export function pendingExceptionDoc(exception: Pick<PixReconciliationException, 'metadata'>): string | null {
  const doc = exception.metadata?.doc_number
  return typeof doc === 'string' && doc.trim() && exception.metadata?.source !== 'unmatched' ? doc.trim() : null
}

// ponytail: o job `itau-pix-queue` roda a cada minuto e cada execução cobre o
// atraso em janelas de até 6 h; 15 min sem avançar o checkpoint é sinal de que
// a consulta parou. Limite fixo da tela; se o job mudar de cadência, revisar.
export const ITAU_POLL_STALE_MINUTES = 15

export function describeItauPoll(polledUntil: string | null, now: Date): { text: string; stale: boolean } {
  if (!polledUntil) return { text: 'ainda não feita', stale: true }
  const at = new Date(polledUntil)
  if (Number.isNaN(at.getTime())) return { text: 'horário inválido', stale: true }
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000))
  const ago = minutes < 1 ? 'agora há pouco' : minutes < 60 ? `há ${minutes} min` : minutes < 48 * 60 ? `há ${Math.floor(minutes / 60)} h` : `há ${Math.floor(minutes / 1440)} dias`
  return { text: ago, stale: minutes >= ITAU_POLL_STALE_MINUTES }
}

const ITAU_CHARGE_STATUS: Record<ItauPixMonitorCharge['status'], string> = {
  pending_create: 'Aguardando emissão',
  pending_update: 'Aguardando alteração',
  pending_expire_check: 'Conferindo vencimento',
  pending_cancel: 'Cancelamento pendente',
  active: 'Ativa',
  cancelled: 'Cancelada',
  concluded: 'Paga',
  expired: 'Vencida',
}

/** O pedido ao banco, para dizer o que ficou sem resposta ou deu erro. */
const ITAU_CHARGE_REQUEST: Record<ItauPixMonitorCharge['status'], string> = {
  pending_create: 'Emissão',
  pending_update: 'Alteração',
  pending_expire_check: 'Conferência de vencimento',
  pending_cancel: 'Cancelamento',
  active: 'Cobrança',
  cancelled: 'Cancelamento',
  concluded: 'Cobrança',
  expired: 'Cobrança',
}

/**
 * Situação da cobrança na fila do Itaú, em texto. Resposta incerta e erro
 * pedem ação de quem acompanha (âmbar); o resto é o banco processando (a fila
 * tenta de novo sozinha) e fica na tinta normal.
 */
export function itauChargeState(charge: Pick<ItauPixMonitorCharge, 'status' | 'uncertain' | 'lastError'>): { label: string; needsAction: boolean } {
  if (charge.uncertain) return { label: `${ITAU_CHARGE_REQUEST[charge.status]} sem resposta do banco`, needsAction: true }
  if (charge.lastError) return { label: `${ITAU_CHARGE_REQUEST[charge.status]} com erro`, needsAction: true }
  return { label: ITAU_CHARGE_STATUS[charge.status], needsAction: false }
}

/** Primeiro o que pede ação (incerta, erro), depois a fila na ordem do banco. */
export function sortItauCharges<T extends Pick<ItauPixMonitorCharge, 'status' | 'uncertain' | 'lastError' | 'updatedAt'>>(charges: readonly T[]): T[] {
  return [...charges].sort((a, b) => {
    const urgency = Number(itauChargeState(b).needsAction) - Number(itauChargeState(a).needsAction)
    return urgency || a.updatedAt.localeCompare(b.updatedAt)
  })
}

export type ConfirmedPixItem = {
  key: string
  source: 'local' | 'demurrage'
  invoiceId: number
  docNumber: string
  customerName: string
  amount: number | null
  txid: string | null
  paidAt: string | null
}

/**
 * Resultado do lote como o banco devolveu: cada item retornado vira uma linha,
 * completada com o que foi enviado (Cliente, valor, TXID). `missing` conta o
 * que foi enviado e não voltou — o lote é transacional, então isso não deveria
 * acontecer; se acontecer, a tela manda conferir o histórico em vez de
 * prometer a baixa.
 */
export function describeConfirmation(sent: readonly UnifiedPixMatch[], result: UnifiedPixConfirmationResult): { items: ConfirmedPixItem[]; missing: number } {
  const pool = [...sent]
  const items = result.items.map((item, index) => {
    const at = pool.findIndex((match) => match.source === item.source && match.invoiceId === Number(item.invoice_id))
    const match = at >= 0 ? pool.splice(at, 1)[0] : null
    return {
      key: `${item.source}-${item.invoice_id}-${index}`,
      source: item.source,
      invoiceId: Number(item.invoice_id),
      docNumber: item.doc_number || match?.docNumber || String(item.invoice_id),
      customerName: match?.customerName ?? '',
      amount: match ? match.transaction.amount : null,
      txid: match?.transaction.txid ?? null,
      paidAt: match?.transaction.date || null,
    }
  })
  return { items, missing: Math.max(0, sent.length - items.length) }
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? singular : plural}`
}

/** Situação gravada da fatura na baixa mais recente; parcial e coberta não são "paga". */
export function historyRowStatus(row: Pick<ReconciliationHistoryRow, 'source' | 'status'>): { label: string; kind: 'paid' | 'partial' | 'covered' | 'other' } {
  if (row.status === 'paid') return { label: 'Paga', kind: 'paid' }
  if (row.status === 'partially_paid') return { label: 'Parcialmente paga', kind: 'partial' }
  if (row.status === 'covered') return { label: 'Coberta pela consolidada', kind: 'covered' }
  return { label: row.status || '—', kind: 'other' }
}

/** O que a aba Pendências conta: só o que pede uma decisão de quem opera. */
export function countPixPending(monitor: Pick<ItauPixMonitor, 'receipts' | 'charges'> | undefined, exceptions: readonly unknown[] | undefined): number | null {
  if (!monitor || !exceptions) return null
  return monitor.receipts.length + exceptions.length + monitor.charges.filter((charge) => itauChargeState(charge).needsAction).length
}

// Aba Pix recebidos (ADR 0100).

const RECEIPT_ORIGIN: Record<ItauPixReceiptOrigin, string> = {
  vela: 'Cobrança do Vela',
  none: 'Sem identificador',
  other: 'Outro sistema',
  test: 'Teste do Vela',
}

/** De onde veio o Pix, pelo identificador: QR do Vela, chave digitada (sem identificador), QR de outro sistema na mesma chave ou teste. */
export function receiptOriginLabel(origin: ItauPixReceiptOrigin): string {
  return RECEIPT_ORIGIN[origin] ?? origin
}

/**
 * Situação do Pix recebido em texto (regra 5): só "Em análise" pede ação, e
 * só no Pix de cobrança do Vela; o Pix sem baixa de outra origem não pede
 * nada (ADR 0100).
 */
export function receiptSituation(receipt: Pick<ItauPixReceipt, 'situation' | 'settledBy'>): { label: string; needsAction: boolean } {
  if (receipt.situation === 'settled') return { label: receipt.settledBy === 'manual' ? 'Baixa manual' : 'Baixa automática', needsAction: false }
  if (receipt.situation === 'review') return { label: 'Em análise', needsAction: true }
  if (receipt.situation === 'handled') return { label: 'Tratado', needsAction: false }
  return { label: 'Sem baixa', needsAction: false }
}

/** Fatura que mostrar na linha: a da baixa ou, sem baixa, a da cobrança do Vela que gerou o Pix. */
export function receiptInvoice(receipt: Pick<ItauPixReceipt, 'settled' | 'charge'>) {
  return receipt.settled ?? receipt.charge
}

/**
 * Valor digitado no filtro ("1.234,56", "R$ 50", "50.00"): número positivo ou
 * `null` quando vazio; `NaN` quando ilegível, para a tela avisar sem consultar.
 */
export function parsePixAmountFilter(text: string): number | null {
  const value = text.replace(/R\$/gi, '').trim()
  if (!value) return null
  const pt = parseImportNumber(value, 'pt-BR')
  const parsed = pt.kind === 'value' ? pt : parseImportNumber(value, 'unknown')
  const amount = parsed.kind === 'value' ? Number(parsed.decimal) : Number.NaN
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : Number.NaN
}

/** Campos do retorno do Itaú que a linha aberta já mostra com nome próprio. */
const SHOWN_BANK_FIELDS = new Set(['endToEndId', 'txid', 'valor', 'horario', 'chave', 'infoPagador', 'pagador', 'devedor'])
const BANK_FIELD_LIMIT = 30

/**
 * O que mais o Itaú mandou no Pix (componentes do valor, devoluções, campos
 * próprios do banco), achatado em rótulo e valor para a linha aberta. Os campos
 * com nome próprio na tela ficam de fora.
 */
export function bankExtraFields(raw: Record<string, unknown> | null): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = []
  const walk = (value: unknown, path: string[]) => {
    if (fields.length >= BANK_FIELD_LIMIT) return
    if (value !== null && typeof value === 'object') {
      const entries = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item] as const) : Object.entries(value)
      for (const [key, item] of entries) walk(item, [...path, key])
      return
    }
    if (value === null || value === undefined || String(value).trim() === '') return
    fields.push({ label: path.join(' › '), value: String(value) })
  }
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!SHOWN_BANK_FIELDS.has(key)) walk(value, [key])
  }
  return fields
}
