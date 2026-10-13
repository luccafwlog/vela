import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { listDemurrageInvoices, type DemurrageInvoiceListItem } from '../services/demurrage/demurrageInvoices'
import { earlierLiveInvoices } from '../services/demurrage/demurragePresentation'

type InvoiceRef = Pick<DemurrageInvoiceListItem, 'id' | 'bl_id' | 'status' | 'created_at' | 'doc_number'>

export type DemurrageComplementLookup = {
  /** Números das Invoices vivas anteriores do mesmo B/L; vazio quando não é complementar. */
  complementOf: string[] | undefined
  /** Ainda não se sabe se é complementar: o documento não deve ser impresso. */
  pending: boolean
  /** A consulta falhou: imprimir omitiria o aviso de complementar. */
  failed: boolean
}

/**
 * Diz se a Invoice de Demurrage é complementar (ADR 0080, decisão 1), para a
 * fatura e o recibo dizerem de qual Invoice ela completa. Mesma consulta e
 * mesma regra do detalhe da Invoice, então o cache aberto pelo detalhe já
 * responde. Enquanto carrega ou se falhar, quem imprime segura o botão, como
 * já faz com as restituições do recibo.
 */
export function useDemurrageComplementOf(invoice: InvoiceRef | null | undefined): DemurrageComplementLookup {
  const siblings = useQuery({
    queryKey: queryKeys.demurrage.invoices({ blId: invoice?.bl_id }),
    queryFn: () => listDemurrageInvoices({ blId: invoice!.bl_id }),
    enabled: Boolean(invoice?.bl_id),
  })
  if (!invoice) return { complementOf: undefined, pending: false, failed: false }
  // Cache aberto pelo detalhe é recarregado ao montar: até a resposta chegar
  // (ou se ela falhar), a lista guardada pode estar velha e não vale para o papel.
  if (siblings.isError) return { complementOf: undefined, pending: false, failed: true }
  if (!siblings.data || siblings.isFetching) return { complementOf: undefined, pending: true, failed: false }
  return {
    complementOf: earlierLiveInvoices<Pick<DemurrageInvoiceListItem, 'id' | 'status' | 'created_at' | 'doc_number'>>(invoice, siblings.data).map((other) => other.doc_number),
    pending: false,
    failed: false,
  }
}
