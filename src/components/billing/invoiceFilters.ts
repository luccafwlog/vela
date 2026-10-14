import type { InvoiceStatusFilter, InvoiceTypeFilter } from '../../services/billing'

export type Filters = {
  /** Busca única por número da fatura ou do B/L (lote 1 da identidade). */
  query?: string
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

export const FILTER_KEYS: (keyof Filters)[] = [
  'query',
  'search',
  'customerId',
  'status',
  'invoiceType',
  'blSearch',
  'voyageSearch',
  'pod',
  'dateFrom',
  'dateTo',
  'paidFrom',
  'paidTo',
]
