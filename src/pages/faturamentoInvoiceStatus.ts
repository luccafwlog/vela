// Ciclo de vida real da fatura tem 8 status no banco, mas operacionalmente apenas
// 3 estados importam para o usuario. Os demais sao absorvidos:
//   Emitida   <- issued, partially_paid, overdue, draft   (em aberto)
//   Paga      <- paid, covered                            (quitada / coberta por consolidada)
//   Cancelada <- cancelled, obsolete                      (cancelada / substituida)
export type InvoiceDisplayStatus = 'issued' | 'paid' | 'cancelled'

const PAID_STATUSES = new Set(['paid', 'covered'])
const CANCELLED_STATUSES = new Set(['cancelled', 'obsolete'])

function invoiceDisplayStatus(status: string | null): InvoiceDisplayStatus {
  if (status && PAID_STATUSES.has(status)) return 'paid'
  if (status && CANCELLED_STATUSES.has(status)) return 'cancelled'
  return 'issued'
}

export function invoiceStatusLabel(status: string | null) {
  const display = invoiceDisplayStatus(status)
  if (display === 'paid') return 'Paga'
  if (display === 'cancelled') return 'Cancelada'
  return 'Emitida'
}

export function invoiceStatusTone(status: string | null) {
  const display = invoiceDisplayStatus(status)
  if (display === 'paid') return 'green'
  if (display === 'cancelled') return 'red'
  return 'blue'
}

// Fatura em aberto: ainda nao quitada (direta ou via consolidada) nem cancelada.
// E o unico conjunto que aceita edicao de itens manuais (Other Charges).
const OPEN_STATUSES = new Set(['issued', 'overdue', 'draft', 'partially_paid'])

export function isOpenInvoiceStatus(status: string | null | undefined) {
  return OPEN_STATUSES.has(status ?? 'issued')
}

// Opcoes para o filtro de status na aba Faturas.
export const INVOICE_STATUS_FILTER_OPTIONS: Array<{ value: InvoiceDisplayStatus; label: string }> = [
  { value: 'issued', label: 'Emitida' },
  { value: 'paid', label: 'Paga' },
  { value: 'cancelled', label: 'Cancelada' },
]
