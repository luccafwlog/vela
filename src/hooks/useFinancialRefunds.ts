import { useQuery } from '@tanstack/react-query'
import { listFinancialRefunds, type RefundSource } from '../services/financialRefunds'
import { queryKeys } from '../services/queryKeys'
export function useFinancialRefunds(source: RefundSource, invoiceId?: number | null) {
  return useQuery({ queryKey: queryKeys.financialRefunds.byInvoice(source, invoiceId), enabled: Boolean(invoiceId),
    queryFn: () => listFinancialRefunds(source, Number(invoiceId)) })
}
