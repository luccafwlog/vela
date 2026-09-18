import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Alert } from '../types/database'
import { reportBestEffortFailure } from '../lib/telemetry'
import { voyageDisplayName } from '../lib/utils'
import { queryKeys } from './queryKeys'

// Catálogo vivo de alertas suportados pela aplicação.
export type ActiveAlertType =
  | 'invoice_overdue'
  | 'invoice_payment_invalid'
  | 'invoice_cancel_blocked'
  | 'portal_invoice_created'
  | 'portal_consolidation_obsoleted'
  | 'portal_dispute_opened'
  | 'demurrage'
  | 'pix_unreconciled'
  | 'billing_calculation_blocked'
  | 'billing_auto_issue_failed'
  | 'import_effect_blocked'
  | 'demurrage_ptax_recalc_failed'
  | 'portal_pendencia_geral'
  | 'portal_excecao_critica_fatura'
  | 'portal_reprocessamento_falhou'
  | 'portal_convite_expirado'
  | 'portal_falha_envio'
  | 'portal_email_suprimido'
  | 'portal_abuso_login'
  | 'cliente_contato_bounced_sem_alternativa'
  | 'comunicado_noa_pendente'
  | 'comunicado_nor_pendente'
  | 'comunicado_nob_pendente'
  | 'agency_report_department_pending'
  | 'agency_report_deadline_missed'
  | 'review_customer_unlinked'
  | 'review_customer_email_missing'
  | 'review_portal_not_ready'
  | 'review_breakbulk_weight_missing'
  | 'review_granite_customer_unlinked'
  | 'voyage_bl_expected'
  | 'voyage_baplie_missing'
  | 'voyage_baplie_documentary_coverage'
  | 'voyage_ce_mercante_missing'
  | 'voyage_schedule_date_pending'
  | 'voyage_terminal_date_pending'
  | 'voyage_export_after_atd'

export const TYPE_LABELS: Record<string, string> = {
  // Aposentado pela 348 (issue #605): sem produtor, mas o rótulo permanece para
  // os itens históricos, como os tipos aposentados pela 327/347.
  invoice_overdue: 'Fatura vencida',
  invoice_payment_invalid: 'Pagamento inválido',
  invoice_cancel_blocked: 'Cancelamento bloqueado',
  portal_invoice_created: 'Fatura criada no portal',
  portal_consolidation_obsoleted: 'Consolidada obsoleta (portal)',
  portal_dispute_opened: 'Disputa de invoice Demurrage',
  demurrage: 'Demurrage',
  pix_unreconciled: 'PIX sem conciliação segura',
  billing_calculation_blocked: 'Cálculo bloqueado',
  billing_auto_issue_failed: 'Falha de emissão automática',
  import_effect_blocked: 'Efeito de importação bloqueado',
  demurrage_ptax_recalc_failed: 'Falha na atualização da PTAX Demurrage',
  portal_pendencia_geral: 'Portal do Cliente — pendência geral',
  portal_excecao_critica_fatura: 'Portal do Cliente — exceção de fatura',
  portal_reprocessamento_falhou: 'Portal do Cliente — falha no reprocessamento',
  portal_convite_expirado: 'Portal do Cliente — convite expirado',
  portal_falha_envio: 'Portal do Cliente — falha de envio',
  portal_email_suprimido: 'Portal do Cliente — email suprimido',
  portal_abuso_login: 'Portal do Cliente — abuso de login',
  cliente_contato_bounced_sem_alternativa: 'Cliente sem contato alternativo',
  comunicado_noa_pendente: 'Comunicado NOA pendente',
  comunicado_nor_pendente: 'Comunicado NOR pendente',
  comunicado_nob_pendente: 'Comunicado NOB pendente',
  agency_report_department_pending: 'ADR — departamento pendente',
  agency_report_deadline_missed: 'ADR — prazo vencido',
  review_customer_unlinked: 'Revisão de B/L — cliente não vinculado',
  review_customer_email_missing: 'Revisão de B/L — cliente sem e-mail',
  review_portal_not_ready: 'Revisão de B/L — Portal não provisionado',
  review_breakbulk_weight_missing: 'Revisão de B/L — peso BB ausente',
  review_granite_customer_unlinked: 'Revisão de Granito — cliente não vinculado',
  voyage_bl_expected: 'B/L esperado pendente',
  voyage_baplie_missing: 'Baplie ausente',
  voyage_baplie_documentary_coverage: 'Cobertura Baplie / B/L',
  voyage_ce_mercante_missing: 'CE Mercante pendente',
  voyage_schedule_date_pending: 'Data da escala pendente',
  voyage_terminal_date_pending: 'Data de terminal pendente',
  voyage_export_after_atd: 'Exportação pendente pós-ATD',
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  invoice: 'Fatura',
  container: 'Container',
  bl: 'B/L',
  granite_bl: 'Granito',
  agency_departure_report: 'ADR',
  voyage: 'Viagem',
  voyage_pod_schedule: 'Escala',
  voyage_escala_terminal: 'Terminal da escala',
  customer: 'Cliente',
  demurrage_invoice: 'Invoice Demurrage',
  exchange_rate_reference: 'Referência cambial',
  import_effect: 'Efeito de importação',
  pix_transaction: 'Transação PIX',
}

export type AlertAudience = 'documentacao' | 'equipamentos' | 'operacoes' | 'administrativo'
export type AlertEventUnit = 'bl' | 'invoice' | 'pix_transaction' | 'demurrage_invoice' | 'exchange_rate_reference'

export const FINANCIAL_ALERT_EVENTS = {
  billing_calculation_blocked: { audience: ['documentacao'], unit: 'bl' },
  billing_auto_issue_failed: { audience: ['documentacao'], unit: 'bl' },
  demurrage_ptax_recalc_failed: { audience: ['documentacao'], unit: 'exchange_rate_reference' },
  pix_unreconciled: { audience: ['documentacao', 'equipamentos'], unit: 'pix_transaction' },
  portal_dispute_opened: { audience: ['equipamentos'], unit: 'demurrage_invoice' },
} as const satisfies Record<string, { audience: readonly AlertAudience[]; unit: AlertEventUnit }>

export const FINANCIAL_ALERT_TYPES = [
  'billing_calculation_blocked',
  'billing_auto_issue_failed',
  'demurrage_ptax_recalc_failed',
  'pix_unreconciled',
] as const

export type FinancialAlertType = typeof FINANCIAL_ALERT_TYPES[number]

import { AGENCY_REPORT_DEPARTMENT_LABELS, agencyReportSectionLabel } from './agencyDepartureReport'

function isTerminalCode(value: string | undefined): boolean {
  return Boolean(value && /^[A-Z0-9][A-Z0-9._-]*$/.test(value))
}

function isTerminalizedAgencyReportKey(value: string | undefined, metadata: Record<string, unknown> = {}): boolean {
  const metadataTerminal = metadata.terminal_code
  return (typeof metadataTerminal === 'string' && metadataTerminal.trim().length > 0)
    || isTerminalCode(value)
}

/**
 * Rótulos humanos das entidades citadas na fila: `alert_items` guarda apenas a
 * chave surrogate (`voyage_id`, `invoice.id`, ...), então a tela precisa
 * traduzi-la antes de exibir. A chave do mapa é `${entityType}:${entityId}`.
 */
export type AlertEntityLabels = Record<string, string>

function resolveEntityLabel(
  labels: AlertEntityLabels | undefined,
  entityType: string,
  entityId: string,
): string | null {
  return labels?.[`${entityType}:${entityId}`] ?? null
}

function voyageLabel(labels: AlertEntityLabels | undefined, voyageId: string): string {
  return `Viagem ${resolveEntityLabel(labels, 'voyage', voyageId) ?? voyageId}`
}

export function formatAgencyReportAlertEntity(entityId: string, labels?: AlertEntityLabels): string | null {
  const parts = entityId.split('::')
  const [voyageId, port, third, fourth] = parts
  if (!voyageId || !port || parts.length < 2 || parts.length > 4) return null
  const voyage = voyageLabel(labels, voyageId)
  if (parts.length === 2) return `${voyage} · ${port}`

  const terminalized = parts.length === 4 || (parts.length === 3 && isTerminalizedAgencyReportKey(third))
  if (terminalized) {
    const terminalLabel = parts.length === 4 && fourth
      ? ` · ${((AGENCY_REPORT_DEPARTMENT_LABELS as Record<string, string>)[fourth] ?? agencyReportSectionLabel(fourth))}`
      : ''
    return `${voyage} · ${port} · Terminal ${third}${terminalLabel}`
  }

  const label = (AGENCY_REPORT_DEPARTMENT_LABELS as Record<string, string>)[third]
    ?? agencyReportSectionLabel(third)
  return `${voyage} · ${port} · ${label}`
}

export function formatAlertEntity(
  entityType: string | null,
  entityId: string | null,
  labels?: AlertEntityLabels,
): string | null {
  if (!entityType || !entityId) return null
  if (entityType === 'agency_departure_report') {
    return formatAgencyReportAlertEntity(entityId, labels)
  }
  if (entityType === 'voyage_pod_schedule') {
    const [voyageId, port] = entityId.split('::')
    return port ? `${voyageLabel(labels, voyageId)} · Escala ${port}` : `Escala ${entityId}`
  }
  if (entityType === 'voyage_escala_terminal') {
    const [voyageId, port, terminalId] = entityId.split('::')
    return terminalId
      ? `${voyageLabel(labels, voyageId)} · ${port} · Terminal ${terminalId}`
      : `Terminal ${entityId}`
  }
  const label = ENTITY_TYPE_LABELS[entityType]
  if (label) {
    return `${label} ${resolveEntityLabel(labels, entityType, entityId) ?? entityId}`
  }
  return null
}

export function agencyReportAlertLink(
  entityId: string,
  metadata: Record<string, unknown> = {},
): string | null {
  const parts = entityId.split('::')
  const [voyageId, port, third] = parts
  if (!/^\d+$/.test(voyageId ?? '') || !port || parts.length < 2 || parts.length > 4) return null

  const params = new URLSearchParams({ tab: 'adr', escala: port })
  const terminal = parts.length === 4 || (parts.length === 3 && isTerminalizedAgencyReportKey(third, metadata))
    ? third
    : undefined
  if (terminal) params.set('terminal', terminal)
  const reportId = metadata.report_id
  if (typeof reportId === 'string' && reportId.length > 0) params.set('report', reportId)
  return `/viagens/${voyageId}?${params.toString()}`
}

export function getEffectiveAlertType(alert: {
  type: string
  item_type?: string | null
}): string {
  return alert.item_type ?? alert.type
}

export function getAlertTypeLabel(type: string): string {
  // `AlertasCatalogContract` garante rótulo para todo tipo do catálogo. Se
  // mesmo assim chegar um tipo desconhecido (registro histórico, tipo novo
  // ainda não catalogado), a fila sinaliza a lacuna mas preserva a chave
  // crua: é a única informação que identifica o alerta, e sem ela tipos
  // distintos colapsariam em um rótulo indistinguível na fila e na busca.
  const label = TYPE_LABELS[type]
  if (label) return label
  return type ? `Alerta não catalogado (${type})` : 'Alerta não catalogado'
}

export function alertEntityLink(alert: {
  type: string
  item_type?: string | null
  entity_type: string | null
  entity_id: string | null
  metadata?: Record<string, unknown> | null
  destination?: string | null
}): string | null {
  if (!alert.entity_id) return alert.destination ?? null
  const effectiveType = getEffectiveAlertType(alert)

  if (
    (effectiveType === 'billing_calculation_blocked' || effectiveType === 'billing_auto_issue_failed')
    && alert.entity_type === 'bl'
  ) {
    const correctionRoute = alert.metadata?.correction_route
    const hasControlCharacter = typeof correctionRoute === 'string'
      && Array.from(correctionRoute).some((character) => {
        const code = character.charCodeAt(0)
        return code < 0x20 || code === 0x7f
      })
    if (
      effectiveType === 'billing_calculation_blocked'
      && typeof correctionRoute === 'string'
      && correctionRoute.startsWith('/')
      && !correctionRoute.startsWith('//')
      && !correctionRoute.includes('\\')
      && !hasControlCharacter
      && !/^[^/]+:\/\//.test(correctionRoute)
    ) {
      return correctionRoute
    }
    return '/taxas-locais'
  }

  if (
    effectiveType === 'comunicado_noa_pendente'
    || effectiveType === 'comunicado_nor_pendente'
    || effectiveType === 'comunicado_nob_pendente'
  ) {
    return alert.destination ?? '/clientes/comunicacao'
  }

  if (alert.entity_type === 'pix_transaction') return '/reconciliacao'
  if (effectiveType === 'portal_dispute_opened' && alert.entity_type === 'demurrage_invoice') {
    const disputeId = alert.metadata?.dispute_id
    return typeof disputeId === 'string' || typeof disputeId === 'number'
      ? `/demurrage?dispute=${encodeURIComponent(String(disputeId))}`
      : '/demurrage'
  }
  if (
    (effectiveType === 'portal_excecao_critica_fatura' || effectiveType === 'portal_reprocessamento_falhou')
    && alert.entity_type === 'bl'
  ) {
    return `/bls/${encodeURIComponent(alert.entity_id)}?tab=faturamento`
  }
  if (effectiveType === 'review_portal_not_ready') {
    // A 364 consolidou este alerta por cliente (`entity_type = 'customer'`), e o
    // detector resolve em varredura os legados por B/L da 337. Enquanto algum
    // legado seguir ativo, o `entity_id` e um id de B/L: mandá-lo como
    // `?cliente=` apontaria para um cliente inexistente. Cada forma vai para a
    // tela onde de fato se resolve.
    if (alert.entity_type === 'bl') {
      return `/revisao?bl=${encodeURIComponent(alert.entity_id)}`
    }
    return alert.entity_id
      ? `/clientes/portal?cliente=${encodeURIComponent(alert.entity_id)}`
      : '/clientes/portal'
  }
  if (effectiveType === 'review_granite_customer_unlinked') {
    return '/granito'
  }
  if (effectiveType === 'cliente_contato_bounced_sem_alternativa' && alert.entity_type === 'customer') {
    const customerCnpj = alert.metadata?.customer_cnpj
    if (typeof customerCnpj === 'string' && customerCnpj.trim()) {
      return `/clientes/${encodeURIComponent(customerCnpj.trim())}?tab=contatos`
    }
    return alert.destination ?? '/clientes'
  }
  if (effectiveType.startsWith('review_')) {
    return alert.entity_id
      ? `/revisao?cliente=${encodeURIComponent(alert.entity_id)}`
      : '/revisao'
  }
  if (effectiveType.startsWith('portal_')) {
    if (alert.entity_type === 'invoice') return invoiceLink(alert)
    return `/clientes/portal?cliente=${encodeURIComponent(alert.entity_id)}`
  }
  if (alert.entity_type === 'customer') {
    return `/clientes/portal?cliente=${encodeURIComponent(alert.entity_id)}`
  }
  if (alert.entity_type === 'invoice') return invoiceLink(alert)
  if (alert.entity_type === 'container') return `/demurrage?busca=${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'bl') return `/bls/${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'granite_bl') return '/granito'
  if (alert.entity_type === 'demurrage_invoice') return '/demurrage'
  if (alert.entity_type === 'agency_departure_report') {
    return agencyReportAlertLink(alert.entity_id, alert.metadata ?? undefined)
  }
  if (alert.entity_type === 'voyage') {
    if (effectiveType.startsWith('voyage_baplie_')) {
      return `/baplie?voyage=${encodeURIComponent(alert.entity_id)}`
    }
    if (/^\d+$/.test(alert.entity_id)) return `/viagens/${encodeURIComponent(alert.entity_id)}`
    return '/viagens'
  }
  if (alert.entity_type === 'voyage_pod_schedule') {
    const [voyageId, port] = alert.entity_id.split('::')
    if (!/^\d+$/.test(voyageId)) return '/viagens'
    const params = new URLSearchParams()
    if (port) params.set('escala', port)
    return `/viagens/${voyageId}${params.toString() ? `?${params.toString()}` : ''}`
  }
  if (alert.entity_type === 'voyage_escala_terminal') {
    const [voyageId, port, terminalId] = alert.entity_id.split('::')
    if (!/^\d+$/.test(voyageId)) return '/viagens'
    const params = new URLSearchParams()
    if (port) params.set('escala', port)
    if (terminalId) params.set('terminal', terminalId)
    return `/viagens/${voyageId}${params.toString() ? `?${params.toString()}` : ''}`
  }
  return alert.destination ?? null
}

export function alertEntityLinkLabel(alert: {
  type: string
  item_type?: string | null
  entity_type: string | null
}): string {
  const effectiveType = getEffectiveAlertType(alert)
  if (
    effectiveType === 'comunicado_noa_pendente'
    || effectiveType === 'comunicado_nor_pendente'
    || effectiveType === 'comunicado_nob_pendente'
  ) return 'Abrir Comunicados'
  if (effectiveType === 'cliente_contato_bounced_sem_alternativa') return 'Abrir Cliente'
  if (effectiveType.startsWith('voyage_baplie_')) return 'Abrir Baplie'
  if (alert.entity_type === 'bl' && (effectiveType === 'billing_calculation_blocked' || effectiveType === 'billing_auto_issue_failed')) {
    return 'Taxas Locais'
  }
  if (effectiveType === 'review_portal_not_ready') return 'Abrir Portal'
  if (effectiveType === 'review_granite_customer_unlinked') return 'Abrir Granito'
  if (effectiveType.startsWith('review_')) return 'Revisar B/Ls'
  if (alert.entity_type === 'pix_transaction') return 'Abrir Reconciliação'
  if (alert.entity_type === 'customer') return 'Abrir Portal'
  if (alert.entity_type === 'invoice') return 'Ver Fatura'
  if (alert.entity_type === 'demurrage_invoice') return 'Ver Demurrage'
  if (alert.entity_type === 'container') return 'Ver Demurrage'
  if (alert.entity_type === 'bl') return 'Abrir B/L'
  if (alert.entity_type === 'granite_bl') return 'Abrir Granito'
  if (
    alert.entity_type === 'agency_departure_report' ||
    alert.entity_type === 'voyage' ||
    alert.entity_type === 'voyage_pod_schedule' ||
    alert.entity_type === 'voyage_escala_terminal'
  ) {
    return 'Abrir Viagem'
  }
  return 'Abrir'
}

function invoiceLink(alert: { entity_id: string | null; metadata?: Record<string, unknown> | null }): string {
  if (!alert.entity_id) return '/taxas-locais'
  const metadataInvoiceId = alert.metadata?.invoice_id
  const invoiceId = typeof metadataInvoiceId === 'number' && Number.isInteger(metadataInvoiceId) && metadataInvoiceId > 0
    ? String(metadataInvoiceId)
    : typeof metadataInvoiceId === 'string' && /^\d+$/.test(metadataInvoiceId)
      ? metadataInvoiceId
      : /^\d+$/.test(alert.entity_id)
        ? alert.entity_id
        : null
  return invoiceId ? `/taxas-locais?invoice=${encodeURIComponent(invoiceId)}` : '/taxas-locais'
}

export type AlertQueueRow = Alert & {
  item_type?: string | null
  item_id: number | null
  item_status: 'active' | 'resolved' | null
  severity: 'normal' | 'critical'
  department: string | null
  target_route: string | null
  dismissed_until: string | null
  dismissal_reason: string | null
  dismissed_by: string | null
  dismissed_by_name?: string | null
  dismissed_at?: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_source: string | null
  payload: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

export type AlertStatusFilter = 'all' | 'active' | 'dismissed'

export type AlertDepartmentSummary = {
  department: string
  active_count: number
  dismissed_count: number
  is_legacy: boolean
}

const alertsRpc = supabase as unknown as {
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>
}

export async function dismissAlertItem(
  itemId: number,
  reason: string,
  reviewAt: string,
): Promise<void> {
  const { error } = await alertsRpc.rpc('dismiss_alert_item', {
    p_item_id: itemId,
    p_reason: reason,
    p_review_at: reviewAt,
  })
  if (error) throw error
}

export async function invalidateAllAlertQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.alerts.departmentSummary() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.alerts.financial() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.alerts.operationalCount() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.alerts.internalNotifications() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.alerts.internalNotificationsUnreadCount() }),
  ])
}

export async function createAlert(input: {
  type: ActiveAlertType
  entityType: string
  entityId: string
  message: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  if (input.type !== 'billing_calculation_blocked' && input.type !== 'billing_auto_issue_failed') {
    throw new Error(`Produtor de alerta não permitido no browser: ${input.type}`)
  }
  const { error } = await alertsRpc.rpc('upsert_billing_alert', {
    p_type: input.type,
    p_bl_id: input.entityId,
    p_message: input.message,
    p_metadata: input.metadata ?? {},
  })
  if (error) reportBestEffortFailure('criar item de alerta', error, { type: input.type })
}

export async function resolveAlertItem(input: {
  type: ActiveAlertType
  entityType: string
  entityId: string
  source?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  if (input.type !== 'billing_calculation_blocked' && input.type !== 'billing_auto_issue_failed') {
    throw new Error(`Resolvedor de alerta não permitido no browser: ${input.type}`)
  }
  const { error } = await alertsRpc.rpc('resolve_billing_alert', {
    p_type: input.type,
    p_bl_id: input.entityId,
    p_metadata: input.metadata ?? {},
  })
  if (error) reportBestEffortFailure('resolver item de alerta', error, { type: input.type })
}

export async function listFinancialAlerts(): Promise<AlertQueueRow[]> {
  // 'invoice' saiu da lista na 348 (#605): nenhum tipo financeiro ativo aponta
  // para faturas desde que invoice_overdue foi aposentado.
  const financialEntityTypes = ['bl', 'pix_transaction', 'exchange_rate_reference'] as const
  const financialTypes = new Set<string>(FINANCIAL_ALERT_TYPES)
  const alertsByEntityType = await Promise.all(financialEntityTypes.map(async (entityType) => {
    const rows: AlertQueueRow[] = []
    for (let page = 0; page < 2; page += 1) {
      const batch = await listAlerts('active', entityType, page)
      rows.push(...batch)
      if (batch.length < 100) break
    }
    return rows
  }))
  const uniqueAlerts = new Map<string, AlertQueueRow>()

  for (const alerts of alertsByEntityType) {
    for (const alert of alerts) {
      const effectiveType = getEffectiveAlertType(alert)
      const expectedEntityType = FINANCIAL_ALERT_EVENTS[effectiveType as keyof typeof FINANCIAL_ALERT_EVENTS]?.unit
      if (!financialTypes.has(effectiveType) || expectedEntityType !== alert.entity_type) continue
      const occurrenceKey = [
        alert.id,
        alert.item_id ?? 'legacy',
        effectiveType,
        alert.entity_type,
        alert.entity_id,
      ].join(':')
      uniqueAlerts.set(occurrenceKey, alert)
    }
  }

  return Array.from(uniqueAlerts.values())
    .sort((left, right) => {
      const createdAtDifference = Date.parse(right.created_at ?? '') - Date.parse(left.created_at ?? '')
      if (Number.isFinite(createdAtDifference) && createdAtDifference !== 0) return createdAtDifference
      return Number(right.id) - Number(left.id) || Number(right.item_id ?? 0) - Number(left.item_id ?? 0)
    })
    .slice(0, 200)
}

export async function listAlerts(
  statusFilter: AlertStatusFilter = 'all',
  entityType?: string,
  page = 0,
  department?: string,
): Promise<AlertQueueRow[]> {
  const params: Record<string, unknown> = {
    p_filter: statusFilter,
    p_entity_type: entityType ?? null,
    p_offset: page * 100,
    p_limit: 100,
  }
  if (department) {
    params.p_department = department
  }
  const { data, error } = await alertsRpc.rpc('list_alert_queue_page', params)
  if (error) throw error
  return (data as AlertQueueRow[]) ?? []
}

/**
 * Entidades cuja chave na fila é um id surrogate: sem esta tradução a coluna
 * "Entidade" mostra "Viagem 1" em vez do navio/viagem que o operador conhece.
 * B/L, Granito e Container já chegam com a chave de negócio no `entity_id`.
 */
type VoyageDerivedEntity = 'voyage' | 'voyage_pod_schedule' | 'voyage_escala_terminal' | 'agency_departure_report'

const VOYAGE_DERIVED_ENTITIES: VoyageDerivedEntity[] = [
  'voyage',
  'voyage_pod_schedule',
  'voyage_escala_terminal',
  'agency_departure_report',
]

export type AlertEntityRef = {
  entity_type: string | null
  entity_id: string | null
  metadata?: Record<string, unknown> | null
}

function voyageIdOf(row: AlertEntityRef): string | null {
  if (!row.entity_type || !row.entity_id) return null
  if (!VOYAGE_DERIVED_ENTITIES.includes(row.entity_type as VoyageDerivedEntity)) return null
  // Todas as chaves derivadas de viagem começam pelo id da viagem, seja
  // sozinho ('voyage') ou como primeiro segmento de uma chave composta.
  const [voyageId] = row.entity_id.split('::')
  return /^\d+$/.test(voyageId) ? voyageId : null
}

function numericIdsOf(rows: AlertEntityRef[], entityType: string): string[] {
  return Array.from(new Set(
    rows
      .filter((row) => row.entity_type === entityType && row.entity_id && /^\d+$/.test(row.entity_id))
      .map((row) => row.entity_id as string),
  ))
}

function idsOf(rows: AlertEntityRef[], entityType: string): string[] {
  return Array.from(new Set(
    rows.filter((row) => row.entity_type === entityType && row.entity_id).map((row) => row.entity_id as string),
  ))
}

function pixLabelFromMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  const txid = metadata?.normalized_txid
  if (typeof txid === 'string' && txid.trim().length > 0) return txid.trim()
  const importKey = metadata?.import_key
  const line = metadata?.line_number
  if (typeof importKey === 'string' && importKey.trim().length > 0 && (typeof line === 'number' || typeof line === 'string')) {
    return `${importKey.trim()} linha ${line}`
  }
  return null
}

/**
 * Busca em lote os rótulos humanos das entidades citadas na página de alertas.
 * ponytail: uma consulta por tabela envolvida, no máximo uma página de 100
 * alertas por vez. Se a fila crescer para leituras muito maiores, o caminho de
 * evolução é devolver o rótulo já pronto em `list_alert_queue_page`.
 */
export async function fetchAlertEntityLabels(rows: AlertEntityRef[]): Promise<AlertEntityLabels> {
  const labels: AlertEntityLabels = {}
  if (rows.length === 0) return labels

  for (const row of rows) {
    if (row.entity_type !== 'pix_transaction' || !row.entity_id) continue
    const label = pixLabelFromMetadata(row.metadata)
    if (label) labels[`pix_transaction:${row.entity_id}`] = label
  }

  const voyageIds = Array.from(new Set(rows.map(voyageIdOf).filter((id): id is string => id !== null)))
  const invoiceIds = numericIdsOf(rows, 'invoice')
  const customerIds = numericIdsOf(rows, 'customer')
  const demurrageIds = numericIdsOf(rows, 'demurrage_invoice')
  const graniteIds = idsOf(rows, 'granite_bl')

  async function collect<T>(
    ids: string[],
    load: () => Promise<T[]>,
    toEntry: (record: T) => [string, string] | null,
  ): Promise<void> {
    if (ids.length === 0) return
    try {
      for (const record of await load()) {
        const entry = toEntry(record)
        if (entry) labels[entry[0]] = entry[1]
      }
    } catch (error) {
      // Rótulo é enfeite: sem ele a tela cai no id, que continua correto.
      reportBestEffortFailure('resolver rótulos de entidades de alertas', error)
    }
  }

  type VoyageRow = { id: number; voyage_number: string | null; vessel: { name: string | null } | { name: string | null }[] | null }
  type InvoiceRow = { id: number; invoice_number: string | null }
  type CustomerRow = { id: number; name: string | null }
  type DemurrageRow = { id: number; doc_number: string | null }
  type GraniteRow = { id: string; bl_number: string | null }

  async function select<T>(table: string, columns: string, ids: string[]): Promise<T[]> {
    const { data, error } = await supabase.from(table as never).select(columns).in('id', ids as never[])
    if (error) throw error
    return (data ?? []) as unknown as T[]
  }

  await Promise.all([
    collect<VoyageRow>(
      voyageIds,
      () => select<VoyageRow>('voyages', 'id, voyage_number, vessel:vessels(name)', voyageIds),
      (voyage) => {
        const vessel = Array.isArray(voyage.vessel) ? voyage.vessel[0] : voyage.vessel
        const label = voyageDisplayName(vessel?.name, voyage.voyage_number)
        return label ? [`voyage:${voyage.id}`, label] : null
      },
    ),
    collect<InvoiceRow>(
      invoiceIds,
      () => select<InvoiceRow>('invoices', 'id, invoice_number', invoiceIds),
      (invoice) => (invoice.invoice_number ? [`invoice:${invoice.id}`, invoice.invoice_number] : null),
    ),
    collect<CustomerRow>(
      customerIds,
      () => select<CustomerRow>('customers', 'id, name', customerIds),
      (customer) => (customer.name ? [`customer:${customer.id}`, customer.name] : null),
    ),
    collect<DemurrageRow>(
      demurrageIds,
      () => select<DemurrageRow>('demurrage_invoices', 'id, doc_number', demurrageIds),
      (invoice) => (invoice.doc_number ? [`demurrage_invoice:${invoice.id}`, invoice.doc_number] : null),
    ),
    collect<GraniteRow>(
      graniteIds,
      () => select<GraniteRow>('granite_bls', 'id, bl_number', graniteIds),
      (bl) => (bl.bl_number ? [`granite_bl:${bl.id}`, bl.bl_number] : null),
    ),
  ])

  return labels
}

export async function countAlertQueue(statusFilter: AlertStatusFilter = 'active'): Promise<number> {
  const { data, error } = await alertsRpc.rpc('count_alert_queue', { p_filter: statusFilter })
  if (error) throw error
  return typeof data === 'number' ? data : Number(data ?? 0)
}

export async function getAlertDepartmentSummary(): Promise<AlertDepartmentSummary[]> {
  const { data, error } = await alertsRpc.rpc('summarize_alert_queue_by_department')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as AlertDepartmentSummary[]
}

export type InternalNotification = {
  id: number
  alert_id?: number
  alert_item_id?: number
  item_id?: number
  type?: string
  item_type?: string | null
  entity_type: string | null
  entity_id: string | null
  title?: string
  message: string
  severity: 'normal' | 'critical'
  destination?: string | null
  is_fallback?: boolean
  read_at: string | null
  created_at: string
  payload?: Record<string, unknown> | null
}

export type InternalNotificationCursor = {
  createdAt: string
  id: number
}

export async function listInternalNotifications(options: {
  includeRead?: boolean
  limit?: number
  before?: InternalNotificationCursor | null
} = {}): Promise<InternalNotification[]> {
  const params: Record<string, unknown> = {
    p_include_read: options.includeRead ?? false,
    p_limit: options.limit ?? 20,
  }
  if (options.before) {
    params.p_before_created_at = options.before.createdAt
    params.p_before_id = options.before.id
  }
  const { data, error } = await alertsRpc.rpc('list_internal_notifications', params)
  if (error) throw error
  return (Array.isArray(data) ? data : []) as InternalNotification[]
}

export async function countUnreadInternalNotifications(): Promise<number> {
  const { data, error } = await alertsRpc.rpc('count_unread_internal_notifications')
  if (error) throw error
  return typeof data === 'number' ? data : Number(data ?? 0)
}

export async function markInternalNotificationRead(notificationId: number): Promise<void> {
  const { error } = await alertsRpc.rpc('mark_internal_notification_read', { p_notification_id: notificationId })
  if (error) throw error
}

export async function markAllInternalNotificationsRead(): Promise<number> {
  const { data, error } = await alertsRpc.rpc('mark_all_internal_notifications_read')
  if (error) throw error
  return typeof data === 'number' ? data : Number(data ?? 0)
}
