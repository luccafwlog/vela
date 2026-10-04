import { useQuery } from '@tanstack/react-query'
import { listFinancialRefunds, type RefundSource } from '../services/financialRefunds'
export function useFinancialRefunds(source: RefundSource, invoiceId?: number | null) {
  return useQuery({ queryKey: ['financial-refunds', source, invoiceId], enabled: Boolean(invoiceId),
    queryFn: () => listFinancialRefunds(source, Number(invoiceId)) })
}
