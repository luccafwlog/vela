// Leitura dos valores de uma fatura de Taxas Locais para o detalhe interno.
// Não calcula nada: organiza o que `list_invoice_details` já devolve
// (`financial_summary`, migration 136) para que total emitido, recebido,
// abatido, devolvido, a devolver, saldo e cobertura não se confundam.
// Taxa local não tem vencimento (ADR 0055): nenhuma linha fala de prazo.
import { INVOICE_STATUS_LABELS } from '../../lib/statusLabels'
import { formatBRL, formatDate } from '../../lib/utils'
import type { InvoiceDetail } from '../../services/billing'
import type { StatusTextTone } from '../ui/StatusText'

export type InvoiceBalanceLead = {
  /** Dado principal do bloco Saldo: o que falta receber, ou o estado encerrado. */
  value: string
  /** Linha de apoio: total, recebido e o que a correção abateu ou devolveu. */
  detail: string
  tone: 'default' | 'warning' | 'muted'
  /** Paga: o texto leva o ✓ verde (StatusText `paid`). */
  paid: boolean
}

// Situação em texto (regra 5, tabela limpa): Paga e Coberta com o ✓ verde,
// cancelada e obsoleta em cinza, o resto em tinta normal.
export type InvoiceStatusTag = { label: string; tone: StatusTextTone }

const STATUS_TONES: Record<string, InvoiceStatusTag['tone']> = {
  paid: 'paid',
  covered: 'paid',
  obsolete: 'muted',
  cancelled: 'muted',
}

/** Situação exata da fatura (não o grupo do filtro): "Parcialmente paga" não vira "Emitida". */
export function invoiceStatusTag(status: string | null | undefined): InvoiceStatusTag {
  // `overdue` é legado: taxa local não vence (ADR 0055) e o banco trata como aberta.
  const key = !status || status === 'overdue' ? 'issued' : status
  return { label: INVOICE_STATUS_LABELS[key] ?? 'Situação não informada', tone: STATUS_TONES[key] ?? 'default' }
}

type Refund = { amount_brl: number; status: 'pending' | 'settled' | 'cancelled' }

function sum(refunds: Refund[], status: Refund['status']) {
  return refunds.filter((refund) => refund.status === status).reduce((total, refund) => total + Number(refund.amount_brl ?? 0), 0)
}

/**
 * Dado principal do bloco Saldo (regra 2): em aberto mostra o que falta
 * receber, em âmbar; paga, coberta e cancelada dizem o estado e não aparecem
 * como dívida. Total, recebido, abatido, devolvido e a devolver vão na linha
 * de apoio, só quando existem, na ordem em que o dinheiro anda.
 */
export function describeInvoiceBalance(detail: Pick<InvoiceDetail, 'invoice' | 'financial_summary'>, refunds: Refund[] = []): InvoiceBalanceLead | null {
  const invoice = detail.invoice
  if (!invoice) return null
  const summary = detail.financial_summary
  const status = invoice.status ?? 'issued'
  const total = formatBRL(invoice.total_brl)
  const received = Number(summary?.gross_received_brl ?? invoice.total_paid_brl ?? 0)
  const offset = Number(summary?.offset_brl ?? 0)
  const refunded = Number(summary?.refunded_brl ?? sum(refunds, 'settled'))
  const pendingRefund = Number(summary?.pending_refund_brl ?? sum(refunds, 'pending'))
  const extras = [
    offset > 0.009 ? `abatido pela correção do B/L ${formatBRL(offset)}` : null,
    refunded > 0.009 ? `devolvido ao Cliente ${formatBRL(refunded)}` : null,
    pendingRefund > 0.009 ? `a devolver ${formatBRL(pendingRefund)}` : null,
  ]
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(' · ')
  const reason = (invoice as { cancel_reason?: string | null }).cancel_reason?.trim()
  if (status === 'cancelled') {
    return { value: 'Cancelada', detail: join('não cobrada', reason ? `motivo: ${reason}` : null, received > 0.009 ? `recebido ${formatBRL(received)}` : null, ...extras), tone: 'muted', paid: false }
  }
  if (status === 'obsolete') {
    return { value: 'Cancelada', detail: join('obsoleta: os B/Ls foram quitados por outra fatura', ...extras), tone: 'muted', paid: false }
  }
  if (status === 'covered') {
    const coveredBy = summary?.covered_by_invoice_number
    return { value: 'Coberta', detail: join(coveredBy ? `pela consolidada ${coveredBy}` : 'por consolidada', `total ${total}`, ...extras), tone: 'muted', paid: false }
  }
  const balance = Number(invoice.balance_brl ?? 0)
  if (balance <= 0.009) {
    const paidAt = summary?.paid_at ? ` em ${formatDate(summary.paid_at)}` : ''
    return { value: 'Paga', detail: join(`${formatBRL(received)} recebidos${paidAt}`, received - Number(invoice.total_brl ?? 0) > 0.009 || offset > 0.009 ? `total ${total}` : null, ...extras), tone: 'default', paid: true }
  }
  return {
    value: `${formatBRL(balance)} em aberto`,
    detail: join(`de ${total}`, received > 0.009 ? `recebido ${formatBRL(received)}` : null, ...extras),
    tone: 'warning',
    paid: false,
  }
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
