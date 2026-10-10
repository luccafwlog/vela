// Leitura dos valores de uma fatura de Taxas Locais para o detalhe interno.
// Não calcula nada: organiza o que `list_invoice_details` já devolve
// (`financial_summary`, migration 136) para que total emitido, recebido,
// abatido, devolvido, a devolver, saldo e cobertura não se confundam.
// Taxa local não tem vencimento (ADR 0055): nenhuma linha fala de prazo.
import { INVOICE_STATUS_LABELS } from '../../lib/statusLabels'
import { formatBRL } from '../../lib/utils'
import type { InvoiceDetail } from '../../services/billing'

export type InvoiceAmountLine = {
  key: 'total' | 'received' | 'offset' | 'refunded' | 'pending_refund' | 'balance'
  label: string
  value: string
  /** Explicação curta quando o número sozinho engana. */
  note?: string
  tone?: 'default' | 'warning' | 'success' | 'muted'
}

export type InvoiceStatusTag = { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }

const STATUS_TONES: Record<string, InvoiceStatusTag['tone']> = {
  draft: 'neutral',
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
  covered: 'success',
  obsolete: 'neutral',
  cancelled: 'danger',
}

/** Situação exata da fatura (não o grupo do filtro): "Parcialmente paga" não vira "Emitida". */
export function invoiceStatusTag(status: string | null | undefined): InvoiceStatusTag {
  // `overdue` é legado: taxa local não vence (ADR 0055) e o banco trata como aberta.
  const key = !status || status === 'overdue' ? 'issued' : status
  return { label: INVOICE_STATUS_LABELS[key] ?? 'Situação não informada', tone: STATUS_TONES[key] ?? 'neutral' }
}

type Refund = { amount_brl: number; status: 'pending' | 'settled' | 'cancelled' }

function sum(refunds: Refund[], status: Refund['status']) {
  return refunds.filter((refund) => refund.status === status).reduce((total, refund) => total + Number(refund.amount_brl ?? 0), 0)
}

/**
 * Linhas de valores na ordem em que o dinheiro anda: emitido → recebido →
 * abatido pela correção → devolvido → a devolver → saldo. Abatimento e
 * devolução só aparecem quando existem; saldo de fatura cancelada ou coberta
 * não é apresentado como dívida.
 */
export function describeInvoiceAmounts(detail: Pick<InvoiceDetail, 'invoice' | 'financial_summary'>, refunds: Refund[] = []): InvoiceAmountLine[] {
  const invoice = detail.invoice
  if (!invoice) return []
  const summary = detail.financial_summary
  const status = invoice.status ?? 'issued'
  const received = Number(summary?.gross_received_brl ?? invoice.total_paid_brl ?? 0)
  const offset = Number(summary?.offset_brl ?? 0)
  const refunded = Number(summary?.refunded_brl ?? sum(refunds, 'settled'))
  const pendingRefund = Number(summary?.pending_refund_brl ?? sum(refunds, 'pending'))
  const lines: InvoiceAmountLine[] = [
    { key: 'total', label: 'Total emitido', value: formatBRL(invoice.total_brl) },
    { key: 'received', label: 'Recebido', value: formatBRL(received), tone: received > 0 ? 'default' : 'muted' },
  ]
  if (offset > 0.009) lines.push({ key: 'offset', label: 'Abatido pela correção do B/L', value: formatBRL(offset) })
  if (refunded > 0.009) lines.push({ key: 'refunded', label: 'Devolvido ao Cliente', value: formatBRL(refunded) })
  if (pendingRefund > 0.009) {
    lines.push({ key: 'pending_refund', label: 'A devolver', value: formatBRL(pendingRefund), note: 'Ainda não devolvido no banco', tone: 'warning' })
  }
  lines.push(balanceLine(status, Number(invoice.balance_brl ?? 0), summary?.covered_by_invoice_number ?? null))
  return lines
}

function balanceLine(status: string, balance: number, coveredBy: string | null): InvoiceAmountLine {
  if (status === 'cancelled') return { key: 'balance', label: 'Saldo', value: 'Não cobrado', note: 'Fatura cancelada', tone: 'muted' }
  if (status === 'obsolete') return { key: 'balance', label: 'Saldo', value: 'Não cobrado', note: 'Obsoleta: os B/Ls foram quitados por outra fatura', tone: 'muted' }
  if (status === 'covered') {
    return { key: 'balance', label: 'Saldo', value: formatBRL(0), note: coveredBy ? `Coberta pela consolidada ${coveredBy}` : 'Coberta por consolidada', tone: 'success' }
  }
  if (balance <= 0.009) return { key: 'balance', label: 'Saldo em aberto', value: formatBRL(0), note: 'Quitada', tone: 'success' }
  return { key: 'balance', label: 'Saldo em aberto', value: formatBRL(balance), tone: 'warning' }
}

export function paymentMethodLabel(method: string | null | undefined) {
  if (method === 'pix') return 'Pix'
  if (method === 'ted') return 'TED'
  if (method === 'doc') return 'DOC'
  if (method === 'boleto') return 'Boleto'
  return 'Outros'
}

/**
 * Valor que decide numa linha da lista (contrato: o número principal é o que
 * decide; os demais em linha secundária): em aberto mostra o saldo; paga, o
 * total; coberta e cancelada não aparecem como dívida.
 */
export function describeInvoiceRowAmount(row: { status: string | null; total_brl: number | null; total_paid_brl: number | null; balance_brl: number | null }): { main: string; detail: string; tone: 'default' | 'warning' | 'muted' } {
  const total = formatBRL(row.total_brl)
  const paid = Number(row.total_paid_brl ?? 0)
  const status = row.status ?? 'issued'
  if (status === 'cancelled' || status === 'obsolete') return { main: total, detail: 'não cobrado', tone: 'muted' }
  if (status === 'covered') return { main: formatBRL(0), detail: `coberta · total ${total}`, tone: 'muted' }
  if (status === 'paid') return { main: total, detail: `recebido ${formatBRL(paid)}`, tone: 'default' }
  if (paid > 0) return { main: formatBRL(row.balance_brl), detail: `em aberto de ${total}`, tone: 'warning' }
  return { main: formatBRL(row.balance_brl), detail: 'em aberto', tone: 'warning' }
}
