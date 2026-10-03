import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from '../../services/queryKeys'

// Conjunto canônico de caches afetados por uma correção na fila de revisão.
// Antes, cada fluxo (correção inline, vínculo em lote, reavaliação de grupo,
// drawer) mantinha sua própria lista de query keys, que divergiam — uma chave
// nova entrava em alguns lugares e não em outros, causando cache obsoleto.
// Centralizamos aqui; cada chamador liga apenas os caches que de fato mexeu.
export type ReviewCacheScope = {
  blId?: string
  /** Inclui ['granite-bls'] (default: true — a fila mistura B/L e granito). */
  includeGranite?: boolean
  /** Inclui ['customers'] quando o vínculo/contatos do cliente mudaram. */
  includeCustomers?: boolean
  /** Inclui ['audit-logs', 'bl', blId] quando houve escrita auditada no B/L. */
  includeAudit?: boolean
  /** Inclui as taxas locais quando o gate pode ter mudado o cálculo. */
  includeCharges?: boolean
  /** Inclui as faturas quando o pós-correção pode ter emitido fatura. */
  includeInvoices?: boolean
  /** Inclui a fila de provisionamento quando o Portal foi alterado. */
  includePortal?: boolean
}

export async function invalidateReviewQueueCaches(
  queryClient: QueryClient,
  scope: ReviewCacheScope = {},
): Promise<void> {
  const keys: QueryKey[] = [
    ['review-queue'], queryKeys.bls.all(), queryKeys.bls.summary(), queryKeys.bls.cockpit(), queryKeys.bls.detail(),
    ['op-count'], queryKeys.voyages.all(), queryKeys.voyages.detail(), ['voyage-billing-status'],
    ['containers'], ['vehicles'], ['report-operational'], ['customer-detail'], ['customer-ficha'],
    ['customer-communications'], queryKeys.billingReady.all(), ['billing-ready-bl-diagnostics'],
  ]
  if (scope.includeGranite ?? true) keys.push(['granite-bls'])
  if (scope.includeAudit && scope.blId) keys.push(['audit-logs', 'bl', scope.blId])
  if (scope.includeCustomers) keys.push(['customers'])
  if (scope.includeCharges) keys.push(queryKeys.charges.operations())
  if (scope.includeInvoices) keys.push(queryKeys.invoices.all())
  keys.push(['customer-lookup'])
  if (scope.includeCharges) keys.push(['local-charge-pendencies'])
  if (scope.includePortal) keys.push(['portal-provisioning'])
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}
