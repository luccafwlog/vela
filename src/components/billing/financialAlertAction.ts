import { alertEntityLink, type AlertQueueRow } from '../../services/alerts'

export type AlertAction =
  | { kind: 'invoice'; invoiceId: number }
  | { kind: 'validacao'; blId: string }
  | { kind: 'link'; to: string }

const INVOICE_LINK = /^\/taxas-locais\?invoice=(\d+)$/

/**
 * Nesta página, os destinos que voltam para /taxas-locais agem no lugar: a
 * fatura abre sem perder o recorte da lista e o bloqueio de cobrança do B/L
 * vai para a Validação filtrada por ele, em vez de recarregar a página vazia.
 */
export function financialAlertAction(alert: AlertQueueRow): AlertAction | null {
  const target = alertEntityLink(alert)
  if (!target) return null
  const invoice = INVOICE_LINK.exec(target)
  if (invoice) return { kind: 'invoice', invoiceId: Number(invoice[1]) }
  if (target === '/taxas-locais' && alert.entity_type === 'bl' && alert.entity_id) return { kind: 'validacao', blId: alert.entity_id }
  return { kind: 'link', to: target }
}
