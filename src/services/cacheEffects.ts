import type { QueryClient } from '@tanstack/react-query'
import { invalidateReviewQueueCaches, type ReviewCacheScope } from '../components/review/reviewCaches'
import { invalidateBaplieDependentQueries } from './baplieInvalidation'

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
  await Promise.all(unique.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

export async function afterViagemAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [
    ['voyages'], ['voyage-options'], ['voyage-pod-schedules'], ['voyage-escala-schedules'], ['portal-schedule-voyages'], ['bls'], ['containers'], ['dashboard'],
    voyageTimelineKey(options.voyageId), ...LINEUP_KEYS,
  ])
}

export async function afterEscalaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [...SCHEDULE_KEYS, voyageTimelineKey(options.voyageId), ['voyages'], ...LINEUP_KEYS])
}

export async function afterRotaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [['voyage-route-ce-masters'], ['voyage-pol-schedules'], ['voyage-pod-schedules'], ['voyage-escala-schedules'], voyageTimelineKey(options.voyageId), ['voyages'], ...LINEUP_KEYS])
}

export async function afterManifestoImportado(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  const vId = String(options.voyageId)
  await invalidate(queryClient, [
    // Um manifesto CNTR pode alterar os cards do B/L, fisico (containers,
    // veiculos), vinculos de fatura e o cliente exibido nas telas consumidoras.
    // Este e o unico efeito pos-importacao para que cada modal nao mantenha
    // uma lista parcial de caches.
    ['bls'], ['bl-summary'], ['bl-detail'], ['containers'], ['vehicles'], ['vehicle-stats'], ['voyage-vehicle-stats'],
    ['invoices'], ['invoice-links'], ['customers'], ['voyages'], ['port-options'],
    ['vazios-importacao-containers'], ['vazios-importacao-manifests'], ['vazios-importacao-stats'],
    ['baplie-reconciliation', vId], ['baplie-staging', vId],
    // Taxas locais e reconciliação de clientes: após importar novos B/Ls,
    // as filas operacionais de validação e conferência refletem imediatamente o cálculo.
    ['local-charge-operations'], ['customer-reconciliation-queue'], ['bl-local-charge-lines'],
    // P0-4: Importar B/L, CE Mercante e Manifesto BB alimentam as seções
    // "Carga descarregada" e "Veículos" do ADR (agencyDepartureReport.ts),
    // mas nenhuma dessas invalidava a família 'agency-report' — a aba
    // continuava mostrando "nada operado" depois de um import concluído.
    ['agency-report'],
    ['voyage-pol-schedules'], ['voyage-escala-schedules'], voyageTimelineKey(options.voyageId), ...LINEUP_KEYS,
  ])
}

export async function afterBaplieImportado(queryClient: QueryInvalidator, options: { voyageId: string }): Promise<void> {
  await invalidateBaplieDependentQueries(queryClient, options.voyageId)
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
