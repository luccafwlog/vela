import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { getItauPixMonitor, listPixReconciliationExceptions } from '../services/reconciliacao'

/** Monitor das cobranças Pix Itaú (`itau_pix_monitor`, só Administrativo), relido a cada minuto. */
export function useItauPixMonitor() {
  return useQuery({
    queryKey: queryKeys.reconciliation.itauPixMonitor(),
    queryFn: getItauPixMonitor,
    refetchInterval: 60_000,
  })
}

/** Exceções do extrato ainda ativas (`list_pix_reconciliation_exceptions`). */
export function usePixExceptions() {
  return useQuery({
    queryKey: queryKeys.reconciliation.pixExceptions(),
    queryFn: () => listPixReconciliationExceptions(),
  })
}
