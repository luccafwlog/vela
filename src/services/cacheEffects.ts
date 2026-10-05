import { INVOICE_BASIS_CACHE_KEYS } from './invoiceBasisCacheKeys'
import type { QueryClient } from '@tanstack/react-query'
import { invalidateReviewQueueCaches, type ReviewCacheScope } from '../components/review/reviewCaches'
import { queryKeys } from './queryKeys'

export type QueryInvalidator = {
  invalidateQueries: (input: { queryKey: readonly unknown[] }) => Promise<unknown>
}

const LINEUP_KEYS: readonly (readonly unknown[])[] = [['lineup-tv-v3'], ['lineup-tv-display-v2']]
const SCHEDULE_KEYS: readonly (readonly unknown[])[] = [
  ['voyage-pod-schedules'],
  ['voyage-pol-schedules'],
  ['voyage-export-schedules'],
  ['voyage-escala-schedules'],
  ['portal-schedule-voyages'],
]

// Listas, cards e fichas são consultas independentes: invalidar a lista não
// atualiza o resumo nem os joins materializados nas telas consumidoras.
const CARGO_READ_KEYS: readonly (readonly unknown[])[] = [
  queryKeys.ceUnlock.all(),
  queryKeys.portalInformation.all(), ['portal-operation-bls'],
  queryKeys.bls.all(), queryKeys.bls.summary(), queryKeys.bls.detail(), queryKeys.bls.cockpit(), queryKeys.portal.blStatus(),
  ['containers'], ['container-type-options'], queryKeys.bls.portOptions(),
  queryKeys.vehicles.all(), ['vehicle-stats'], ['voyage-vehicle-stats'],
  queryKeys.voyages.all(), queryKeys.voyages.detail(), ['voyage-billing-status'],
  ['baplie-bls-exist'], ['baplie-reconciliation'], ['bl-timeline'], ['voyage-timeline'],
  ['agency-report'], ['review-queue'], ['op-count'], ['report-operational'],
  ['customer-detail'], ['customer-ficha'], ['customers-summary'],
  ['customer-communications'], queryKeys.dashboard(),
  ['demurrage-containers'], ['demurrage-invoices'], ['demurrage-invoice-detail'],
  ['demurrage-kpis'], ['demurrage-customer-summary'], ['demurrage-customer-detail'],
  ['demurrage-report'], ['header-alert'],
]
const FINANCIAL_READ_KEYS: readonly (readonly unknown[])[] = [
  queryKeys.ceUnlock.all(),
  // Correções de B/L também afetam restituições, COD e as faturas do Portal.
  ...INVOICE_BASIS_CACHE_KEYS,
  ['alerts'], ['alert-department-summary'], ['financial-alerts'], ['invoice-corrections'],
  ['invoices'], ['invoice-detail'], ['invoice-links'], ['invoice-bl-subtotal'], ['billing-ledger'],
  queryKeys.billingReady.all(), ['billing-ready-bl-diagnostics'],
  ['local-charge-operations'], ['local-charge-pendencies'], ['bl-local-charge-lines'],
  ['customer-reconciliation-queue'], ['report-financial'], ['report-customers'],
]
const CARD_SCHEDULE_KEYS: readonly (readonly unknown[])[] = [
  ['baplie-voyage-card-schedules'], ['vehicles-voyage-card-schedules'],
]
const EMPTY_IMPORT_KEYS: readonly (readonly unknown[])[] = [
  ['vazios-importacao-containers'], ['vazios-importacao-manifests'], ['vazios-importacao-stats'],
  ['baplie-vazios-manifest'], queryKeys.manifestosMercante.all(),
]

/** Cadastro, edição ou exclusão de B/L/container/veículo, inclusive filhos removidos. */
export async function afterCargaAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [...CARGO_READ_KEYS, ...FINANCIAL_READ_KEYS, ...SCHEDULE_KEYS, ...LINEUP_KEYS])
}

/** Descarga/devolução também pode emitir demurrage; inclui seus consumidores. */
export async function afterDatasContainerAlteradas(queryClient: QueryInvalidator): Promise<void> {
  await afterCargaAlterada(queryClient)
}

function voyageTimelineKey(voyageId: number | string): readonly unknown[] {
  return ['voyage-timeline', String(voyageId)]
}

async function invalidate(queryClient: QueryInvalidator, keys: readonly (readonly unknown[])[]): Promise<void> {
  const seen = new Set<string>()
  const unique = keys.filter((key) => {
    const id = JSON.stringify(key)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  // ponytail: catálogo curto de famílias; scan O(n²) evita refetch duplicado
  // de ID + família. Se o catálogo crescer, indexar os prefixos numa trie.
  const prefixes = unique.filter((key) => !unique.some((parent) =>
    parent.length < key.length && parent.every((part, index) => JSON.stringify(part) === JSON.stringify(key[index])),
  ))
  await Promise.all(prefixes.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

export async function afterViagemAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [
    ['voyages'], ['voyage-options'], ['voyage-pod-schedules'], ['voyage-escala-schedules'], ['portal-schedule-voyages'], ['bls'], ['containers'], ['dashboard'],
    voyageTimelineKey(options.voyageId), ...LINEUP_KEYS,
    ...CARGO_READ_KEYS, ...FINANCIAL_READ_KEYS, ...SCHEDULE_KEYS, ...CARD_SCHEDULE_KEYS,
    queryKeys.voyages.options(), ['vehicle-voyage-options'], ['voyage-indicated-first-port'],
    ...EMPTY_IMPORT_KEYS, ['baplie-staging'],
  ])
}

export async function afterEscalaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [...SCHEDULE_KEYS, ...CARD_SCHEDULE_KEYS, voyageTimelineKey(options.voyageId), ['voyages'], queryKeys.voyages.detail(Number(options.voyageId)), ['baplie-reconciliation'], ['bl-cockpit'], ['agency-report'], ...LINEUP_KEYS])
}

export async function afterRotaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [queryKeys.voyages.detail(Number(options.voyageId)), ...CARD_SCHEDULE_KEYS, ['voyage-route-ce-masters'], ['voyage-pol-schedules'], ['voyage-pod-schedules'], ['voyage-escala-schedules'], voyageTimelineKey(options.voyageId), ['voyages'], ...LINEUP_KEYS])
}

export async function afterManifestoImportado(queryClient: QueryInvalidator, _options: { voyageId: number | string }): Promise<void> {
  void _options // Mantém o contrato dos chamadores; os joins exigem invalidar famílias inteiras.
  await invalidate(queryClient, [
    ...CARGO_READ_KEYS, ...FINANCIAL_READ_KEYS, ...SCHEDULE_KEYS, ...CARD_SCHEDULE_KEYS,
    ...EMPTY_IMPORT_KEYS, ...LINEUP_KEYS, ['customers'], ['customer-lookup'],
    queryKeys.voyages.options(), ['vehicle-voyage-options'], ['baplie-staging'],
  ])
}

export async function afterBaplieImportado(queryClient: QueryInvalidator, options: { voyageId: string }): Promise<void> {
  await invalidate(queryClient, [
    ...CARGO_READ_KEYS, ...FINANCIAL_READ_KEYS, ...EMPTY_IMPORT_KEYS,
    ['baplie-staging', String(options.voyageId)], ...SCHEDULE_KEYS, ...CARD_SCHEDULE_KEYS, ...LINEUP_KEYS,
  ])
}

/**
 * B/L cancelado ou reativado (ADR 0071): muda a ficha, as listas, o
 * faturamento pronto e a viagem.
 */
export async function afterBlEstadoAlterado(
  queryClient: QueryInvalidator,
  options: { blId: string; voyageId: number | string | null },
): Promise<void> {
  await invalidate(queryClient, [
    queryKeys.bls.detail(options.blId),
    queryKeys.bls.cockpit(options.blId),
    queryKeys.bls.all(),
    queryKeys.bls.summary(),
    ...CARGO_READ_KEYS, ...FINANCIAL_READ_KEYS,
    ...(options.voyageId === null ? [] : [queryKeys.voyages.detail(Number(options.voyageId))]),
  ])
}

export async function afterBlRevisado(queryClient: QueryClient, scope: ReviewCacheScope = {}): Promise<void> {
  await invalidateReviewQueueCaches(queryClient, scope)
}

export async function afterCustomerCommunicationDispatched(
  queryClient: QueryInvalidator,
  options: { customerId?: number; blIds?: readonly string[] } = {},
): Promise<void> {
  const keys: readonly (readonly unknown[])[] = [
    ['customer-communications'],
    ...(options.customerId != null ? [['customer-ficha', 'timeline', options.customerId] as const] : []),
    ...(options.blIds ?? []).map((blId) => ['bl-timeline', blId] as const),
  ]
  await invalidate(queryClient, keys)
}

// Liberação de faturamento sem Portal (ADR 0070): conceder reprocessa o Cliente
// e emite as faturas retidas; revogar muda o gate e o Alerta do Portal.
export async function afterLiberacaoFaturamentoPortal(
  queryClient: QueryInvalidator,
  options: { customerId: number },
): Promise<void> {
  await invalidate(queryClient, [
    ['customer-ficha', 'billing-portal-release', options.customerId],
    ['customer-ficha', 'receivables', options.customerId],
    ['customer-detail'],
    ['portal-provisioning'],
    ['invoices'],
    ['bls'],
    ['bl-summary'],
    ['local-charge-operations'],
    ['alerts'],
    ['financial-alerts'],
  ])
}

/** B/L corrections may reissue invoices, correct balances or create refunds. */
export async function afterBlInvoiceBasisAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [...INVOICE_BASIS_CACHE_KEYS, queryKeys.ceUnlock.all()])
}

export async function afterCeUnlockChanged(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [queryKeys.ceUnlock.all(), ['customer-detail'], ['customer-ficha']])
}

/** Mudanças no cadastro de depósitos afetam catálogo e orientações de devolução. */
export async function afterDepotAlterado(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [['depots'], queryKeys.portalInformation.all(), ['portal-operation-bls']])
}

/** Referências publicadas no Portal dependem das tabelas e acordos internos. */
export async function afterReferenciaPortalAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [queryKeys.portalInformation.all()])
}

/** Tarifas e acordos mudam o free time e o status calculados na operação. */
export async function afterReferenciaDemurrageAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [queryKeys.portalInformation.all(), ['portal-operation-bls']])
}
