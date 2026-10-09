type LedgerInvoicePaymentCandidate = {
  invoice_type?: string | null
  status?: string | null
  balance_brl?: number | string | null
}

export function isLedgerInvoicePayable(invoice: LedgerInvoicePaymentCandidate | null | undefined) {
  if (!invoice) return false
  const isLocalLedgerInvoice = invoice.invoice_type === 'individual' || invoice.invoice_type === 'consolidated'
  const isPayableStatus = invoice.status === 'issued' || invoice.status === 'partially_paid' || invoice.status === 'overdue'
  return isLocalLedgerInvoice && isPayableStatus && Number(invoice.balance_brl ?? 0) > 0
}

// Estados em que as RPCs de baixa aceitam pagamento: register_verified_invoice_payment
// para avulsa (migration 136) e register_ledger_invoice_payment para as demais.
// Fora deles a RPC responde 22023 (VELA-15: avulsa cancelada em /taxas-locais).
const MANUAL_PAYABLE_STATUSES = ['issued', 'overdue', 'partially_paid', 'paid']
const LEDGER_PAYABLE_STATUSES = ['issued', 'partially_paid', 'overdue']

export function canRegisterInvoicePayment(invoice: LedgerInvoicePaymentCandidate | null | undefined) {
  if (!invoice) return false
  const status = invoice.status ?? 'issued'
  if (invoice.invoice_type === 'manual') return MANUAL_PAYABLE_STATUSES.includes(status)
  return LEDGER_PAYABLE_STATUSES.includes(status) && Number(invoice.balance_brl ?? 0) > 0
}
