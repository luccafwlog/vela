import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { listDemurrageInvoices, type DemurrageInvoiceListItem } from '../services/demurrage/demurrageInvoices'
import { earlierLiveInvoices } from '../services/demurrage/demurragePresentation'

/**
 * Números das Invoices vivas anteriores do mesmo B/L, para a fatura e o
 * recibo de Demurrage dizerem que a Invoice é complementar (ADR 0080,
 * decisão 1). Mesma consulta e mesma regra do detalhe da Invoice, então o
 * cache aberto pelo detalhe já responde. Enquanto carrega ou se falhar, o
 * documento não afirma nada (`undefined`).
 */
export function useDemurrageComplementOf(invoice: Pick<DemurrageInvoiceListItem, 'id' | 'bl_id' | 'status' | 'created_at' | 'doc_number'> | null | undefined): string[] | undefined {
  const siblings = useQuery({
    queryKey: queryKeys.demurrage.invoices({ blId: invoice?.bl_id }),
    queryFn: () => listDemurrageInvoices({ blId: invoice!.bl_id }),
    enabled: Boolean(invoice?.bl_id),
  })
  if (!invoice || !siblings.data) return undefined
  return earlierLiveInvoices<Pick<DemurrageInvoiceListItem, 'id' | 'status' | 'created_at' | 'doc_number'>>(invoice, siblings.data).map((other) => other.doc_number)
}
