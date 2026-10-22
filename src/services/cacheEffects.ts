import { INVOICE_BASIS_CACHE_KEYS } from './invoiceBasisCacheKeys'
import type { QueryClient } from '@tanstack/react-query'
import { invalidateReviewQueueCaches, type ReviewCacheScope } from '../components/review/reviewCaches'
import { queryKeys } from './queryKeys'

export type QueryInvalidator = {
  invalidateQueries: (input: { queryKey: readonly unknown[]; refetchType?: 'none' | 'active' | 'inactive' | 'all' }) => Promise<unknown>
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
  ['containers'], queryKeys.bls.portOptions(),
  queryKeys.vehicles.all(), ['vehicle-stats'], ['voyage-vehicle-stats'],
  queryKeys.voyages.all(), queryKeys.voyages.detail(), ['voyage-billing-status'], queryKeys.voyages.breakbulkTons(),
  // O contexto do Baplie lista os containers dos B/Ls da Viagem (ADR 0079, decisão 6).
  ['baplie-bls-exist'], ['baplie-reconciliation'], ['baplie-voyage-context'], ['bl-timeline'], ['voyage-timeline'],
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
    // A lista do Granito mostra Navio / Viagem de cada B/L (lote 5b).
    queryKeys.granite.all(),
  ])
}

export async function afterEscalaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [...SCHEDULE_KEYS, ...CARD_SCHEDULE_KEYS, voyageTimelineKey(options.voyageId), ['voyages'], queryKeys.voyages.detail(Number(options.voyageId)), ['baplie-reconciliation'], queryKeys.baplie.voyageContext(Number(options.voyageId)), ['bl-cockpit'], ['agency-report'], ...LINEUP_KEYS])
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
    // A planilha COSCO entra pela tela do Granito e pela ficha da Viagem (G6).
    queryKeys.granite.all(),
  ])
}

/** Natureza (Cama, Cover plate) dos vazios de importação: a lista, os totais e o ADR, que a mostra. */
export async function afterNaturezaVaziosAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [['vazios-importacao-containers'], ['vazios-importacao-stats'], ['agency-report']])
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
    // Remover o CE, cancelar e reativar mudam o vínculo do Manifesto Mercante
    // (migration 396): a aba Rotas e Manifestos da Viagem conta os B/Ls.
    queryKeys.manifestosMercante.all(),
    ...CARGO_READ_KEYS, ...FINANCIAL_READ_KEYS, ...SCHEDULE_KEYS, ...LINEUP_KEYS,
    ...(options.voyageId === null ? [] : [queryKeys.voyages.detail(Number(options.voyageId))]),
  ])
}

export async function afterBlRevisado(queryClient: QueryClient, scope: ReviewCacheScope = {}): Promise<void> {
  await invalidateReviewQueueCaches(queryClient, scope)
}

/**
 * Fim de um disparo em lote de `/clientes/comunicacao` (plano dos e-mails, 3.2):
 * uma invalidação só, depois do último destinatário. A conferência na tela não é
 * relida agora — relê-la trocava os discriminadores e desfazia a seleção no meio
 * do lote —, mas fica velha, e o próximo "Conferir destinatários" a busca de novo;
 * disparar outra vez com ela é recusado pela reconferência da tela. O reenvio do
 * CE e Taxas também fecha `comunicado_ce_reenvio_pendente` nos B/Ls da Viagem.
 */
export async function afterCustomerCommunicationBatchDispatched(
  queryClient: QueryInvalidator,
  options: { customerIds?: readonly number[]; blIds?: readonly string[] } = {},
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['customer-communications', 'conference'], refetchType: 'none' })
  await invalidate(queryClient, [
    queryKeys.customerCommunications.history(),
    ['customer-communications', 'coverage'],
    ['customer-communications', 'bl'],
    ...(options.customerIds ?? []).map((customerId) => ['customer-ficha', 'timeline', customerId] as const),
    ...[...new Set(options.blIds ?? [])].map((blId) => ['bl-timeline', blId] as const),
    // O contador de Alertas do menu também muda quando o reenvio fecha um alerta.
    queryKeys.alerts.all(), queryKeys.alerts.operationalCount(), ['alert-department-summary'], ['header-alert'],
  ])
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
    // A concessão emite as retidas: "Fatura emitida" entra no Histórico.
    queryKeys.customerFicha.timeline(options.customerId),
    ['customer-detail'],
    // Saldo da lista de Clientes: a concessão emite as faturas retidas.
    ['customers'],
    ['customers-summary'],
    // Conceder ou revogar reavalia a Revisão dos B/Ls do Cliente (migration 167).
    ['review-queue'],
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
/**
 * Cliente desativado ou reativado (ficha, Mais ações): a lista, o resumo, a
 * busca de Cliente, a ficha com o Histórico (evento `deactivated` em
 * `audit_logs`) e o Provisionamento do Portal, que perde ou recupera a conta.
 */
export async function afterClienteAtivacaoAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [
    ['customers'], ['customers-summary'], ['customer-lookup'], ['customer-detail'], ['customer-ficha'], ['portal-provisioning'],
  ])
}

export async function afterBlInvoiceBasisAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [...INVOICE_BASIS_CACHE_KEYS, queryKeys.ceUnlock.all()])
}

export async function afterCeUnlockChanged(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [queryKeys.ceUnlock.all(), ['customer-detail'], ['customer-ficha']])
}

/**
 * Mudanças no cadastro de locais (depots e terminais) e no catálogo de
 * serviços afetam as orientações de devolução do Portal, os serviços
 * oferecidos e a armazenagem sugerida no Embarque de vazios (achado L7 do
 * lote 5b) e a lista de embarques, que soma a armazenagem pelo free time.
 */
export async function afterDepotAlterado(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [
    ['depots'], ['depot-services'], ['armazenagem-services'],
    ['vazios-export-operations'], ['embarque-vazios-operation'],
    queryKeys.portalInformation.all(), ['portal-operation-bls'],
  ])
}

/** Referências publicadas no Portal dependem das tabelas e acordos internos. */
export async function afterReferenciaPortalAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [queryKeys.portalInformation.all()])
}

/** Tarifas e acordos mudam o free time e o status calculados na operação. */
export async function afterReferenciaDemurrageAlterada(queryClient: QueryInvalidator): Promise<void> {
  // A aba Containers de /demurrage prevê a sobreestadia com o acordo vigente na descarga.
  await invalidate(queryClient, [queryKeys.portalInformation.all(), ['portal-operation-bls'], ['demurrage-containers']])
}

const DEMURRAGE_INVOICE_KEYS: readonly (readonly unknown[])[] = [
  ['demurrage-invoices'], ['demurrage-invoice-detail'], ['demurrage-kpis'], ['demurrage-containers'],
  ['demurrage-customer-summary'], ['demurrage-customer-detail'], ['demurrage-disputes'], ['demurrage-report'],
  ['demurrage-latest-recalc'], ['financial-refunds'], ['bl-detail'], ['bl-cockpit'], ['customer-ficha'],
  ['customer-detail'], ['portal-demurrage-invoices'], ['portal-demurrage-invoices-page'],
  ['portal-demurrage-invoice-detail'], ['portal-disputes'], ['reconciliation-history'],
  ['alerts'], ['header-alert'],
]

/**
 * Emissão, baixa, estorno, cancelamento, desconto, disputa ou PTAX de uma
 * Invoice de Demurrage: a lista, o detalhe, os totais, as caixas cobradas na
 * aba Containers, a ficha do B/L e do Cliente, o Portal e os alertas leem o
 * mesmo documento.
 */
export async function afterFaturaDemurrageAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, DEMURRAGE_INVOICE_KEYS)
}

/**
 * Baixa por Pix pela Conciliação (lote do extrato ou exceção conciliada): a
 * fatura local passa pelo ledger e a Invoice de Demurrage pela persistência
 * própria; as duas famílias, o histórico, as exceções PIX, o monitor Itaú e o
 * Alerta `pix_unreconciled` leem o resultado.
 */
export async function afterPixConciliado(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [
    ...INVOICE_BASIS_CACHE_KEYS, ...DEMURRAGE_INVOICE_KEYS,
    queryKeys.reconciliation.pixExceptions(), queryKeys.reconciliation.itauPixMonitor(), ['pix-reconciliation-candidates'],
  ])
}

/**
 * Pendência PIX aberta ou encerrada sem baixa: exceções gravadas na leitura do
 * extrato ou Pix Itaú marcado como tratado. Muda as listas de Pendências e o
 * Alerta `pix_unreconciled` (lista, Financeiro e cabeçalho), não as faturas.
 */
export async function afterPendenciaPixAlterada(queryClient: QueryInvalidator): Promise<void> {
  await invalidate(queryClient, [
    queryKeys.reconciliation.pixExceptions(), queryKeys.reconciliation.itauPixMonitor(),
    queryKeys.alerts.all(), queryKeys.alerts.financial(), ['header-alert'],
  ])
}
