import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import {
  portalCreateConsolidation,
  portalGetCurrentRoe,
  portalGetDemurrageInvoiceDetail,
  portalInvoiceDetails,
  portalListConsolidatableReceivables,
  portalListDemurrageInvoices,
  portalListDemurrageInvoicesPage,
  portalListInvoices,
  portalListInvoicesPage,
  portalDemurrageComplementOf,
  portalObsoleteConsolidation,
  type PortalDemurrageInvoice,
} from '../services/portalBilling'
import { EMPTY_PORTAL_BILLING_FILTERS, type PortalBillingFilters } from '../lib/portalBillingFilters'
import { queryKeys } from '../services/queryKeys'
import { isPortalReadOnly } from '../services/portalScope'

export function usePortalCurrentRoe() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  return useQuery({
    queryKey: queryKeys.portal.currentRoe(),
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalGetCurrentRoe(scope),
    staleTime: 60 * 60 * 1000,
  })
}

export function usePortalConsolidatableReceivables() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-consolidatable-receivables', scope.mode, scope.customerId],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListConsolidatableReceivables(scope),
  })
}

export function usePortalInvoices() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-invoices', scope.mode, scope.customerId],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListInvoices(scope),
  })
}

export function usePortalInvoicesPage(filters: PortalBillingFilters = EMPTY_PORTAL_BILLING_FILTERS, page = 0, pageSize = 25) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-invoices-page', scope.mode, scope.customerId, filters, page, pageSize],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListInvoicesPage(filters, page, pageSize, scope),
    placeholderData: (previous) => previous,
  })
}

// Fatura aberta na tela e ainda pagável: a baixa automática do Pix Itaú (até
// cerca de 1 min) aparece sem o cliente recarregar a página.
export function refreshWhilePayable(status: string | null | undefined, payable: string[]): number | false {
  return status && payable.includes(status) ? 20_000 : false
}

// F-50: a baixa (Itaú ou do Financeiro) chega pela releitura do detalhe; o
// saldo da sessão e as listas só mudam se forem relidos também.
function useRefreshWhenSettled(status: string | null | undefined, payable: string[], listKeys: string[]) {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()
  const previous = useRef(status)
  useEffect(() => {
    const was = previous.current
    previous.current = status
    if (!was || !status || was === status || !payable.includes(was)) return
    void Promise.all(listKeys.map((key) => queryClient.invalidateQueries({ queryKey: [key] }))).then(() => refreshOverview())
  }, [status, payable, listKeys, queryClient, refreshOverview])
}

const LOCAL_PAYABLE = ['issued', 'partially_paid', 'overdue']
const LOCAL_LIST_KEYS = ['portal-invoices', 'portal-invoices-page', 'portal-consolidatable-receivables']

export function usePortalInvoiceDetail(invoiceId?: number | null) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  const query = useQuery({
    queryKey: ['portal-invoice-detail', scope.mode, scope.customerId, invoiceId],
    enabled: Boolean((isAuthenticated || readOnly) && invoiceId),
    queryFn: () => portalInvoiceDetails(Number(invoiceId), scope),
    refetchInterval: (query) => refreshWhilePayable(query.state.data?.invoice?.status, LOCAL_PAYABLE),
  })
  useRefreshWhenSettled(query.data?.invoice?.status, LOCAL_PAYABLE, LOCAL_LIST_KEYS)
  return query
}

export function usePortalDemurrageInvoices() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  // ponytail: refresh is governed by query lifecycle; re-enable Realtime only
  // after demurrage_invoices is explicitly added to supabase_realtime.

  return useQuery({
    queryKey: ['portal-demurrage-invoices', scope.mode, scope.customerId],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListDemurrageInvoices(scope),
  })
}

export type PortalDemurrageComplements = {
  /** Lista inteira do Cliente (também serve para achar o B/L de uma disputa). */
  invoices: PortalDemurrageInvoice[] | undefined
  /** Invoices anteriores que esta completa; `undefined` enquanto não se sabe. */
  complementOf: (invoice: PortalDemurrageInvoice) => PortalDemurrageInvoice[] | undefined
  /** Ainda não se sabe se é complementar: o documento não deve ser impresso. */
  pending: boolean
  /** A consulta falhou: imprimir omitiria o aviso de complementar. */
  failed: boolean
}

/**
 * Invoice complementar (ADR 0080, decisão 1) a partir da lista inteira de
 * Demurrage do Portal, a mesma do Painel: a marca da lista e o detalhe não
 * dependem dos filtros nem da página aberta.
 * ponytail: lê a lista inteira do Cliente só para a marca; com muitas
 * Invoices, upgrade é a RPC do Portal devolver `complement_of`.
 */
export function usePortalDemurrageComplements(): PortalDemurrageComplements {
  const { data, error } = usePortalDemurrageInvoices()
  return useMemo(() => ({
    invoices: data,
    complementOf: (invoice: PortalDemurrageInvoice) => (data ? portalDemurrageComplementOf(invoice, data) : undefined),
    pending: !data && !error,
    failed: Boolean(error),
  }), [data, error])
}

export function usePortalDemurrageInvoicesPage(filters: PortalBillingFilters = EMPTY_PORTAL_BILLING_FILTERS, page = 0, pageSize = 25) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  return useQuery({
    queryKey: ['portal-demurrage-invoices-page', scope.mode, scope.customerId, filters, page, pageSize],
    enabled: isAuthenticated || readOnly,
    queryFn: () => portalListDemurrageInvoicesPage(filters, page, pageSize, scope),
    placeholderData: (previous) => previous,
  })
}

export function usePortalDemurrageInvoiceDetail(invoiceId?: number | null) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  const query = useQuery({
    queryKey: ['portal-demurrage-invoice-detail', scope.mode, scope.customerId, invoiceId],
    enabled: Boolean((isAuthenticated || readOnly) && invoiceId),
    queryFn: () => portalGetDemurrageInvoiceDetail(Number(invoiceId), scope),
    refetchInterval: (query) => refreshWhilePayable(query.state.data?.invoice?.status, DEMURRAGE_PAYABLE),
  })
  useRefreshWhenSettled(query.data?.invoice?.status, DEMURRAGE_PAYABLE, DEMURRAGE_LIST_KEYS)
  return query
}

const DEMURRAGE_PAYABLE = ['issued', 'overdue']
const DEMURRAGE_LIST_KEYS = ['portal-demurrage-invoices', 'portal-demurrage-invoices-page']

export function usePortalCreateConsolidation() {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()
  const scope = usePortalScope()

  return useMutation({
    mutationFn: (payload: { receivableIds: number[] }) => portalCreateConsolidation(payload, scope),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices-page'] }),
      ])
      await refreshOverview()
    },
  })
}

export function usePortalObsoleteConsolidation() {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()
  const scope = usePortalScope()

  return useMutation({
    mutationFn: (invoiceId: number) => portalObsoleteConsolidation(invoiceId, scope),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices-page'] }),
      ])
      await refreshOverview()
    },
  })
}
