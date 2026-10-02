/** Financial projections changed by a B/L correction, regardless of its source. */
export const INVOICE_BASIS_CACHE_KEYS: readonly (readonly unknown[])[] = [
  ['bls'], ['bl-detail'], ['bl-portal-status'],
  ['invoices'], ['invoice-detail'], ['invoice-links'], ['invoice-corrections'],
  ['billing-ledger'], ['invoice-refunds'], ['cod-adjustments'], ['financial-alerts'],
  ['alerts'], ['customers'], ['customer-detail'], ['customer-ficha'], ['portal-invoice-detail'],
  ['portal-invoices'], ['portal-invoices-page'], ['reconciliation-history'], ['op-count'],
]
