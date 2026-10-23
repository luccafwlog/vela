/** Financial projections changed by a B/L correction, regardless of its source. */
export const INVOICE_BASIS_CACHE_KEYS: readonly (readonly unknown[])[] = [
  ['bls'], ['bl-detail'], ['bl-portal-status'],
  ['invoices'], ['invoice-detail'], ['invoice-links'], ['invoice-corrections'],
  ['billing-ledger'], ['invoice-refunds'], ['financial-refunds'], ['demurrage-invoices'], ['demurrage-invoice-detail'], ['cod-adjustments'], ['financial-alerts'],
  ['alerts'], ['customers'], ['customer-detail'], ['customer-ficha'], ['portal-invoice-detail'],
  ['portal-invoices'], ['portal-invoices-page'], ['reconciliation-history'], ['op-count'],
  // F-50: saldo do Cliente, linhas do cálculo e fila de faturamento também mudam.
  ['customers-summary'], ['bl-local-charge-lines'], ['local-charge-operations'], ['billing-ready-bls'],
  // ADR 0100: a situação na aba Pix recebidos é lida da baixa (registrar ou cancelar);
  // cancelar a baixa automática devolve o Pix a Pix em análise (monitor Itaú).
  ['itau-pix-receipts'], ['itau-pix-monitor'],
]
