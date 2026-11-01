import type { PortalStatusFilter } from './portalInvoiceStatus'

export type PortalBillingFilters = {
  status: PortalStatusFilter
  vessel: string
  bl: string
  pod: string
  dateFrom: string
  dateTo: string
}

export const EMPTY_PORTAL_BILLING_FILTERS: PortalBillingFilters = {
  status: '',
  vessel: '',
  bl: '',
  pod: '',
  dateFrom: '',
  dateTo: '',
}

const STATUS_FROM_URL: Record<string, PortalStatusFilter> = { issued: 'issued', paid: 'paid', cancelled: 'cancelled' }

/**
 * Filtros que um atalho de outra tela traz na URL de Faturas (`?bl=` e
 * `?status=`), como "Ver faturas do B/L" do Desbloqueio de CE. Valor
 * desconhecido é ignorado.
 */
export function portalBillingFiltersFromSearch(params: URLSearchParams): PortalBillingFilters | null {
  const bl = params.get('bl')?.trim() ?? ''
  const status = STATUS_FROM_URL[params.get('status') ?? ''] ?? ''
  if (!bl && !status) return null
  return { ...EMPTY_PORTAL_BILLING_FILTERS, bl, status }
}

/** Endereço de Faturas filtrado nas faturas em aberto de um B/L. */
export function portalBillingOpenForBlSuffix(blId: string) {
  return `/billing?${new URLSearchParams({ tab: 'local', status: 'issued', bl: blId }).toString()}`
}
