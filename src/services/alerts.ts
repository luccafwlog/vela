import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Alert } from '../types/database'
import { reportBestEffortFailure } from '../lib/telemetry'
import { voyageDisplayName } from '../lib/utils'
import { queryKeys } from './queryKeys'

// Catálogo vivo de alertas suportados pela aplicação.
export type ActiveAlertType =
  | 'fatura_desatualizada'
  | 'restituicao_pendente'
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
  | 'billing_charge_table_missing'
  | 'import_effect_blocked'
  | 'import_effects_queue_stalled'
  | 'itau_pix_consulta_parada'
  | 'demurrage_invoice_dates_changed'
  | 'cobranca_demurrage_recusada'
  | 'ce_trocado_com_desbloqueio'
  | 'ce_fora_do_manifesto_da_rota'
  | 'bl_vehicles_changed_on_reimport'
  | 'comunicado_ce_reenvio_pendente'
  | 'demurrage_ptax_recalc_failed'
  | 'calendario_feriados_pendente'
  | 'portal_pendencia_geral'
  | 'portal_excecao_critica_fatura'
  | 'portal_reprocessamento_falhou'
  | 'portal_convite_expirado'
  | 'portal_falha_envio'
  | 'portal_email_suprimido'
  | 'portal_abuso_login'
  | 'cliente_contato_bounced_sem_alternativa'
  | 'nob_sem_destinatario'
  | 'caixa_sem_destinatario'
  | 'cliente_sem_contato_principal'
  | 'comunicado_noa_pendente'
  | 'comunicado_nor_pendente'
  | 'comunicado_nob_pendente'
  | 'comunicado_recusado'
  | 'desbloqueio_ce_aviso_nao_enviado'
  | 'email_retorno_provedor_silencioso'
  | 'usuario_email_devolvido'
  | 'rotina_http_falhou'
  | 'agency_report_department_pending'
  | 'agency_report_deadline_missed'
  | 'review_customer_unlinked'
  | 'review_customer_email_missing'
  | 'review_portal_not_ready'
  | 'review_breakbulk_weight_missing'
  | 'review_granite_customer_unlinked'
  | 'bl_sem_cliente_perto_eta'
  | 'voyage_bl_expected'
  | 'voyage_baplie_missing'
  | 'voyage_baplie_documentary_coverage'
  | 'voyage_ce_mercante_missing'
  | 'voyage_schedule_date_pending'
  | 'voyage_terminal_date_pending'
  | 'voyage_export_after_atd'

export const TYPE_LABELS: Record<string, string> = {
  fatura_desatualizada: 'Fatura desatualizada',
  restituicao_pendente: 'Restituição pendente',
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
  billing_charge_table_missing: 'Tabela de cobrança faltando',
  import_effect_blocked: 'Efeito de importação bloqueado',
  import_effects_queue_stalled: 'Fila de efeitos de importação parada',
  itau_pix_consulta_parada: 'Consulta de Pix do Itaú parada',
  demurrage_invoice_dates_changed: 'Datas mudaram em Invoice de Demurrage emitida',
  cobranca_demurrage_recusada: 'Cobrança de Demurrage recusada',
  ce_trocado_com_desbloqueio: 'CE trocado depois do Desbloqueio conferido',
  ce_fora_do_manifesto_da_rota: 'CE fora do Manifesto da rota',
  bl_vehicles_changed_on_reimport: 'Veículos alterados na reimportação do B/L',
  comunicado_ce_reenvio_pendente: 'Reenviar Comunicado de CE e Taxas',
  demurrage_ptax_recalc_failed: 'Falha na atualização da PTAX Demurrage',
  calendario_feriados_pendente: 'Calendário de feriados pendente',
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
  comunicado_recusado: 'Comunicado automático recusado',
  email_retorno_provedor_silencioso: 'Provedor de e-mail sem retorno',
  usuario_email_devolvido: 'Usuário interno com e-mail devolvido',
  rotina_http_falhou: 'Rotina agendada com resposta de erro',
  desbloqueio_ce_aviso_nao_enviado: 'Aviso do Desbloqueio de CE não enviado',
  nob_sem_destinatario: 'Comunicado sem destinatário',
  caixa_sem_destinatario: 'Caixa de comunicação sem destinatário',
  cliente_sem_contato_principal: 'Cliente sem contato principal',
  agency_report_department_pending: 'ADR — departamento pendente',
  agency_report_deadline_missed: 'ADR — prazo vencido',
  review_customer_unlinked: 'Revisão de B/L — cliente não vinculado',
  review_customer_email_missing: 'Revisão de B/L — cliente sem e-mail',
  review_portal_not_ready: 'Revisão de B/L — Portal não provisionado',
  review_breakbulk_weight_missing: 'Revisão de B/L — peso BB ausente',
  review_granite_customer_unlinked: 'Revisão de Granito — cliente não vinculado',
  bl_sem_cliente_perto_eta: 'B/L sem Cliente perto do ETA',
  voyage_bl_expected: 'B/L esperado pendente',
  voyage_baplie_missing: 'Baplie ausente',
  voyage_baplie_documentary_coverage: 'Cobertura Baplie / B/L',
  voyage_ce_mercante_missing: 'CE Mercante pendente',
  voyage_schedule_date_pending: 'Data da escala pendente',
  voyage_terminal_date_pending: 'Data de terminal pendente',
  voyage_export_after_atd: 'Exportação pendente pós-ATD',
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  itau_pix_checkpoint: 'Consulta Itaú',
  itau_pix_receipt_failure: 'Recebimento Itaú',
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
  import_effect_queue: 'Fila de efeitos de importação',
  charge_table_gap: 'Tabela de cobrança',
  pix_transaction: 'Transação PIX',
  itau_pix_receipt: 'Pix recebido',
  business_holidays: 'Calendário de feriados',
  email_provider: 'Provedor de e-mail',
  user_profile: 'Usuário interno',
  cron_http: 'Rotinas agendadas',
  portal_email_event: 'Evento de e-mail',
}

export type AlertAudience = 'documentacao' | 'equipamentos' | 'operacoes' | 'financeiro' | 'administrativo'
export type AlertEventUnit = 'bl' | 'invoice' | 'pix_transaction' | 'itau_pix_receipt' | 'demurrage_invoice' | 'exchange_rate_reference'

// Entidades em que cada tipo financeiro abre. O Pix sem baixa tem duas: a
// exceção do extrato (pix_transaction) e o Pix recebido pela cobrança Itaú
// (itau_pix_receipt, migration 153).
export const FINANCIAL_ALERT_EVENTS = {
  fatura_desatualizada: { audience: ['administrativo', 'financeiro'], units: ['invoice'] },
  restituicao_pendente: { audience: ['administrativo', 'financeiro'], units: ['invoice'] },
  billing_calculation_blocked: { audience: ['documentacao'], units: ['bl'] },
  billing_auto_issue_failed: { audience: ['documentacao'], units: ['bl'] },
  demurrage_ptax_recalc_failed: { audience: ['documentacao'], units: ['exchange_rate_reference'] },
  pix_unreconciled: { audience: ['administrativo', 'financeiro', 'documentacao', 'equipamentos'], units: ['pix_transaction', 'itau_pix_receipt'] },
  portal_dispute_opened: { audience: ['equipamentos'], units: ['demurrage_invoice'] },
} as const satisfies Record<string, { audience: readonly AlertAudience[]; units: readonly AlertEventUnit[] }>

export const FINANCIAL_ALERT_TYPES = [
  'fatura_desatualizada',
  'restituicao_pendente',
  'billing_calculation_blocked',
  'billing_auto_issue_failed',
  'demurrage_ptax_recalc_failed',
  'pix_unreconciled',
] as const

export type FinancialAlertType = typeof FINANCIAL_ALERT_TYPES[number]

import { AGENCY_REPORT_DEPARTMENT_LABELS, agencyReportSectionLabel } from './agencyReportLabels'

/**
 * Setor responsável por um alerta, como a fila e o Painel o mostram. Os três
 * setores do ADR mais o Administrativo, responsável por parte do catálogo
 * (Pix, restituição, cobrança de Demurrage, rotinas). "Sem setor" é o alerta
 * anterior à divisão por setor.
 */
export const ALERT_DEPARTMENT_LABELS: Record<string, string> = {
  ...AGENCY_REPORT_DEPARTMENT_LABELS,
  administrativo: 'Administrativo',
  sem_departamento: 'Sem setor',
}

/** Alertas de contato do Cliente: o tratamento é na aba Cadastro e contatos. */
const CUSTOMER_CONTACT_ALERT_TYPES: ReadonlySet<string> = new Set([
  'cliente_contato_bounced_sem_alternativa',
  'nob_sem_destinatario',
  'desbloqueio_ce_aviso_nao_enviado',
  'caixa_sem_destinatario',
  'cliente_sem_contato_principal',
])

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

/**
 * Coluna Registro da fila (lote 5a): onde está a pendência, sem o tipo na
 * frente ("COSCO SHIPPING ARIES / 088E", não "Viagem COSCO…"), porque o tipo
 * já está no filtro e no nome do alerta. Abre a ficha quando o registro tem
 * uma (B/L e viagem); os demais ficam em texto e se resolvem pelo botão.
 * O grupo de B/Ls sem Cliente (`customer:sem_cliente`) não é um Cliente.
 */
export function alertRecord(
  alert: Pick<AlertEntityRef, 'entity_type' | 'entity_id'>,
  labels?: AlertEntityLabels,
): { label: string; href: string | null } | null {
  const { entity_type: entityType, entity_id: entityId } = alert
  if (!entityType || !entityId) return null
  if (entityType === 'customer' && entityId === 'sem_cliente') return { label: 'B/Ls sem Cliente', href: null }
  const voyageId = voyageIdOf({ entity_type: entityType, entity_id: entityId })
  if (voyageId) {
    const voyage = resolveEntityLabel(labels, 'voyage', voyageId) ?? `Viagem ${voyageId}`
    const [, port] = entityId.split('::')
    return { label: port && entityType !== 'voyage' ? `${voyage} · ${port}` : voyage, href: `/viagens/${voyageId}` }
  }
  const label = resolveEntityLabel(labels, entityType, entityId) ?? entityId
  if (entityType === 'bl') return { label, href: `/bls/${encodeURIComponent(entityId)}` }
  return { label, href: null }
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

// A Conciliação PIX abre no Histórico de baixas; o que um Alerta de Pix aponta
// está em Pendências. Destinos gravados antes como "/reconciliacao" (migrations
// 152, 153 e 247) passam a abrir nessa aba.
export const PIX_PENDING_HREF = '/reconciliacao?tab=pendencias'

export function alertEntityLink(alert: Parameters<typeof alertEntityLinkRaw>[0]): string | null {
  const link = alertEntityLinkRaw(alert)
  return link === '/reconciliacao' ? PIX_PENDING_HREF : link
}

// Rotas vindas do banco (`destination` e `metadata.correction_route`) chegam ao
// `navigate()` e ao `<Link to>`. Só passa caminho interno: uma única '/' no
// início, sem '\\', sem esquema e sem caractere de controle. Fora disso o
// chamador usa o destino padrão do tipo de alerta.
export function safeInternalRoute(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\')) return null
  if (/^[^/]+:\/\//.test(value)) return null
  const hasControlCharacter = Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || (code >= 0x7f && code <= 0x9f)
  })
  return hasControlCharacter ? null : value
}

function alertEntityLinkRaw(alert: {
  type: string
  item_type?: string | null
  entity_type: string | null
  entity_id: string | null
  metadata?: Record<string, unknown> | null
  destination?: string | null
}): string | null {
  const destination = safeInternalRoute(alert.destination)
  if (!alert.entity_id) return destination
  const effectiveType = getEffectiveAlertType(alert)
  if ((effectiveType === 'fatura_desatualizada' || effectiveType === 'restituicao_pendente') && alert.entity_type === 'invoice') return `/taxas-locais?invoice=${encodeURIComponent(alert.entity_id)}`

  if (
    (effectiveType === 'billing_calculation_blocked' || effectiveType === 'billing_auto_issue_failed')
    && alert.entity_type === 'bl'
  ) {
    const correctionRoute = safeInternalRoute(alert.metadata?.correction_route)
    if (effectiveType === 'billing_calculation_blocked' && correctionRoute) {
      return correctionRoute
    }
    return '/taxas-locais'
  }

  if (
    effectiveType === 'comunicado_noa_pendente'
    || effectiveType === 'comunicado_nor_pendente'
    || effectiveType === 'comunicado_nob_pendente'
    || effectiveType === 'comunicado_recusado'
  ) {
    return destination ?? '/clientes/comunicacao'
  }

  // O reenvio do CE e Taxas mora no Histórico dos Comunicados (plano dos
  // e-mails, 3.1): o alerta abre os Comunicados deste B/L.
  if (effectiveType === 'comunicado_ce_reenvio_pendente' && alert.entity_type === 'bl') {
    return `/clientes/comunicacao?tab=historico&kind=ce_mercante_taxas&bl=${encodeURIComponent(alert.entity_id)}`
  }

  if (alert.entity_type === 'pix_transaction' || alert.entity_type === 'itau_pix_receipt') return PIX_PENDING_HREF
  // Evento do provedor de e-mail que foi para investigação (migrations 109 e
  // 309): o entity_id é o id do evento, não de um Cliente, e nenhuma tela
  // mostra o evento. O alerta fica na fila, com o motivo na mensagem.
  if (alert.entity_type === 'portal_email_event') return '/alertas'
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
  if (CUSTOMER_CONTACT_ALERT_TYPES.has(effectiveType) && alert.entity_type === 'customer') {
    const customerCnpj = alert.metadata?.customer_cnpj
    if (typeof customerCnpj === 'string' && customerCnpj.trim()) {
      return `/clientes/${encodeURIComponent(customerCnpj.trim())}?tab=cadastro`
    }
    return destination ?? '/clientes'
  }
  if (effectiveType.startsWith('review_')) {
    return alert.entity_id
      ? `/revisao?cliente=${encodeURIComponent(alert.entity_id)}`
      : '/revisao'
  }
  // B/L sem Cliente perto do ETA (migration 352): a chave é a escala, e o
  // vínculo se faz na Revisão, no cartão dos B/Ls sem Cliente.
  if (effectiveType === 'bl_sem_cliente_perto_eta') return '/revisao?causa=cliente'
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
  // A Invoice abre direto no detalhe de /demurrage (etapa 11).
  if (alert.entity_type === 'demurrage_invoice') {
    return /^\d+$/.test(alert.entity_id) ? `/demurrage?fatura=${alert.entity_id}` : '/demurrage'
  }
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
  return destination
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
    || effectiveType === 'comunicado_recusado'
    || effectiveType === 'comunicado_ce_reenvio_pendente'
  ) return 'Abrir Comunicados'
  if (CUSTOMER_CONTACT_ALERT_TYPES.has(effectiveType)) return 'Abrir Cliente'
  if (effectiveType.startsWith('voyage_baplie_')) return 'Abrir Baplie'
  if (alert.entity_type === 'bl' && (effectiveType === 'billing_calculation_blocked' || effectiveType === 'billing_auto_issue_failed')) {
    return 'Taxas Locais'
  }
  if (effectiveType === 'review_portal_not_ready') return 'Abrir Portal'
  if (effectiveType === 'review_granite_customer_unlinked') return 'Abrir Granito'
  if (effectiveType.startsWith('review_') || effectiveType === 'bl_sem_cliente_perto_eta') return 'Revisar B/Ls'
  if (alert.entity_type === 'pix_transaction') return 'Abrir Reconciliação'
  if (alert.entity_type === 'portal_email_event') return 'Abrir Alertas'
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

// Mesma chave do consignatário na Revisão (`reconcile_customer_bl_review_alerts`):
// nome aparado, ou `sem_cliente` quando vazio.
function consigneeKey(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'sem_cliente'
}

/** Consignatários dos B/Ls em "B/L sem Cliente perto do ETA" ativos (migration 352). */
export function consigneesNearEta(alerts: readonly AlertQueueRow[] | undefined): Set<string> {
  const keys = new Set<string>()
  for (const alert of alerts ?? []) {
    if (getEffectiveAlertType(alert) !== 'bl_sem_cliente_perto_eta' || alert.item_status !== 'active') continue
    const bls = alert.metadata?.bls
    if (!Array.isArray(bls)) continue
    for (const bl of bls) keys.add(consigneeKey((bl as { consignee?: unknown } | null)?.consignee))
  }
  return keys
}

/**
 * Selo "ETA próximo" na Revisão de cliente não vinculado: o consignatário dela
 * tem B/L no alerta crítico de B/L sem Cliente perto do ETA. Mostra a urgência
 * sem abrir um segundo aviso para o mesmo B/L.
 */
export function hasNearEtaMark(alert: AlertQueueRow, nearEta: ReadonlySet<string>): boolean {
  if (nearEta.size === 0 || getEffectiveAlertType(alert) !== 'review_customer_unlinked') return false
  return nearEta.has(consigneeKey(alert.metadata?.consignee ?? alert.entity_id))
}

export type AlertDepartmentSummary = {
  department: string
  active_count: number
  dismissed_count: number
  is_legacy: boolean
}

const alertsRpc = supabase as unknown as {
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>
}

/**
 * Último dia aceito para a dispensa voltar à fila: o 30º a partir de hoje, em
 * UTC como a data que a tela envia (`T23:59:59Z`). `dismiss_alert_item`
 * recusa depois dele (migration 433).
 */
export function getMaxReviewDateString(now: Date = new Date()): string {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() + 30)
  return d.toISOString().slice(0, 10)
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

/**
 * Tipos de conferência sem fato de origem: fecham com "Resolver com
 * justificativa" (ADR 0083, item 23). Espelha
 * `_alert_types_resolved_with_justification()` (migrations 238, 313, 316 e
 * 349), na mesma ordem; os demais fecham sozinhos quando a origem é corrigida.
 */
export const ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION: readonly string[] = [
  'portal_abuso_login',
  'bl_vehicles_changed_on_reimport',
  'ce_trocado_com_desbloqueio',
  // Recusa definitiva da cobrança (migration 313): resolver retoma a Régua.
  'cobranca_demurrage_recusada',
  // Aviso que não sai de novo depois que a solicitação terminou (migration 316).
  'desbloqueio_ce_aviso_nao_enviado',
  // Conferência da diferença de datas, paga ou negociada (migration 349).
  'demurrage_invoice_dates_changed',
  // Também fecha pelo envio; justificado, a próxima falha do mesmo Comunicado
  // não reabre (migration 349).
  'comunicado_recusado',
]

/**
 * Espelha `_alert_item_resolved_with_justification(tipo, entidade)` (migration
 * 316): o evento de e-mail em investigação nunca sai de lá sozinho; o mesmo tipo
 * no reprocessamento do faturamento por B/L fecha pela origem.
 */
export function canResolveWithJustification(type: string | null | undefined, entityType?: string | null): boolean {
  if (!type) return false
  if (type === 'portal_reprocessamento_falhou' && entityType === 'portal_email_event') return true
  return ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION.includes(type)
}

/**
 * "Efeito de importação bloqueado" se resolve reprocessando o efeito, com
 * justificativa (ADR 0095, decisão 25; `retry_import_effect`). Devolve o efeito,
 * o B/L (ou a entidade) e o motivo gravados no alerta (migration 394).
 */
export function importEffectRetryTarget(alert: {
  type: string
  item_type?: string | null
  entity_type: string | null
  entity_id: string | null
  metadata?: Record<string, unknown> | null
}): { effectId: number; record: string | null; reason: string | null; reprocessing: boolean } | null {
  if (getEffectiveAlertType(alert) !== 'import_effect_blocked') return null
  if (alert.entity_type !== 'import_effect' || !/^\d+$/.test(alert.entity_id ?? '')) return null
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  return {
    effectId: Number(alert.entity_id),
    record: text(alert.metadata?.bl_id) ?? text(alert.metadata?.entity_id),
    reason: text(alert.metadata?.error_message) ?? text(alert.metadata?.error_code),
    // Migration 395: depois do Reprocessar o alerta fica aberto até o efeito concluir.
    reprocessing: alert.metadata?.reprocessing === true,
  }
}

export async function resolveAlertItemWithJustification(itemId: number, reason: string): Promise<void> {
  const { error } = await alertsRpc.rpc('resolve_alert_item_with_justification', {
    p_item_id: itemId,
    p_reason: reason,
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
  // Fatura desatualizada voltou a usar invoice; vencimento segue aposentado.
  const financialEntityTypes = ['invoice', 'bl', 'pix_transaction', 'itau_pix_receipt', 'exchange_rate_reference'] as const
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
      const expectedEntityTypes: readonly string[] = FINANCIAL_ALERT_EVENTS[effectiveType as keyof typeof FINANCIAL_ALERT_EVENTS]?.units ?? []
      if (!financialTypes.has(effectiveType) || !expectedEntityTypes.includes(alert.entity_type ?? '')) continue
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

/** Carrega todas as notificações não lidas para mostrar o escopo de uma baixa em massa. */
export async function listAllUnreadInternalNotifications(): Promise<InternalNotification[]> {
  const pageSize = 100
  const notifications: InternalNotification[] = []
  let before: InternalNotificationCursor | null = null

  while (true) {
    const page = await listInternalNotifications({ includeRead: false, limit: pageSize, before })
    notifications.push(...page)
    if (page.length < pageSize) return notifications

    const last = page[page.length - 1]
    if (!last) return notifications
    before = { createdAt: last.created_at, id: last.id }
  }
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
