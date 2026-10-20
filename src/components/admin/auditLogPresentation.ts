import { blFieldLabel, formatBlFieldValue } from '../bl/blTimelinePresentation'
import { CUSTOMER_FIELD_LABELS } from '../../services/customerFicha'
import { TIMELINE_VOYAGE_FIELD_LABELS } from '../../services/voyageSummaries'
import { DEPARTMENT_LABELS } from '../../lib/departmentLabel'
import { splitIsoDateTime } from '../../lib/utils'

// Histórico de ações legível (lote 5b, Administração): cada linha de
// `audit_logs` vira assunto, frase e "de → para" em português. Entidade sem
// assunto conhecido aparece como "Outro registro" e campo sem rótulo como
// "Dado"; o nome técnico nunca chega à tela.

export type AuditSubject = {
  id: string
  label: string
  entityTypes: readonly string[]
}

type Noun = { noun: string; feminine: boolean }

/** Assuntos do filtro, na ordem da lista, com as entidades que cada um cobre. */
export const AUDIT_SUBJECTS: readonly AuditSubject[] = [
  { id: 'viagem', label: 'Viagem', entityTypes: ['voyage', 'voyages', 'ended_vessels'] },
  { id: 'escala', label: 'Escala', entityTypes: ['voyage_pod_schedule', 'voyage_pol_schedule', 'voyage_export_schedules', 'vessel_schedules', 'voyage_omissions'] },
  { id: 'adr', label: 'ADR de Saída', entityTypes: ['agency_departure_report', 'agency_departure_reports', 'agency_departure_report_signoff', 'agency_departure_report_signoffs', 'agency_departure_report_department_signoff', 'agency_departure_report_department_signoffs', 'agency_departure_report_occurrences'] },
  { id: 'manifesto', label: 'Manifesto e CE Mercante', entityTypes: ['manifestos_mercante', 'voyage_route_ce_master'] },
  { id: 'bl', label: 'B/L', entityTypes: ['bl', 'bls', 'bl_breakbulk_items', 'bl_freight_lines', 'bl_transshipments'] },
  { id: 'container', label: 'Container', entityTypes: ['bl_container', 'bl_containers', 'container'] },
  { id: 'veiculo', label: 'Veículo', entityTypes: ['vehicle', 'vehicles'] },
  { id: 'importacao', label: 'Importação', entityTypes: ['import_batches', 'import_effect'] },
  { id: 'vazios', label: 'Vazios', entityTypes: ['vazios_bookings', 'vazios_export_operations', 'vazios_export_service_lines', 'vazios_importacao_containers', 'vazios_importacao_manifests', 'vazios_manifests'] },
  { id: 'granito', label: 'Granito', entityTypes: ['granite_bl', 'granite_bls', 'granite_manifests', 'granite_bl_charges'] },
  { id: 'tarifa-granito', label: 'Tarifa do Granito', entityTypes: ['granite_rates'] },
  { id: 'taxas-locais', label: 'Tabela de Taxas Locais', entityTypes: ['charge_tables', 'charge_table_items'] },
  { id: 'condicao-cliente', label: 'Condição de Cliente', entityTypes: ['customer_rate_overrides'] },
  { id: 'taxas-bl', label: 'Taxas do B/L', entityTypes: ['charge_calculation', 'charge_calculations'] },
  { id: 'fatura', label: 'Fatura', entityTypes: ['invoice', 'invoices', 'invoice_items', 'invoice_bls', 'invoice_receivable_links', 'payments', 'ledger_settlements', 'bl_receivables'] },
  { id: 'restituicao', label: 'Restituição', entityTypes: ['invoice_refund', 'invoice_refunds', 'demurrage_refund'] },
  { id: 'cod', label: 'Ajuste de COD', entityTypes: ['cod_adjustment'] },
  { id: 'demurrage', label: 'Invoice de Demurrage', entityTypes: ['demurrage_invoice', 'demurrage_invoices', 'demurrage_invoice_items'] },
  { id: 'tarifa-demurrage', label: 'Tarifa de Demurrage', entityTypes: ['demurrage_rates'] },
  { id: 'acordo-demurrage', label: 'Acordo de Demurrage', entityTypes: ['customer_demurrage_agreements'] },
  { id: 'cambio', label: 'Câmbio', entityTypes: ['exchange_rate_reference'] },
  { id: 'cliente', label: 'Cliente', entityTypes: ['customer', 'customers', 'customer_contacts'] },
  { id: 'liberacao', label: 'Liberação de faturamento', entityTypes: ['customer_billing_portal_releases'] },
  { id: 'central', label: 'Central de Informações', entityTypes: ['portal_information_depot', 'portal_information_agent', 'portal_information_contact', 'portal_information_carrier'] },
  { id: 'cadastros', label: 'Navio, armador e porto', entityTypes: ['vessels', 'carriers', 'ports'] },
  { id: 'locais', label: 'Local e serviço', entityTypes: ['depots', 'depot_services'] },
  { id: 'usuario', label: 'Usuário', entityTypes: ['user_profile'] },
  { id: 'sistema', label: 'Configuração do sistema', entityTypes: ['app_settings', 'system_event'] },
]

const SUBJECT_BY_ENTITY = new Map(AUDIT_SUBJECTS.flatMap((subject) => subject.entityTypes.map((entity) => [entity, subject] as const)))

/** Nome do registro na frase ("Tarifa criada"), por entidade; o assunto vale quando não há. */
const NOUN_BY_ENTITY: Record<string, Noun> = {
  voyage: { noun: 'Viagem', feminine: true },
  voyages: { noun: 'Viagem', feminine: true },
  voyage_pod_schedule: { noun: 'Escala', feminine: true },
  voyage_export_schedules: { noun: 'Escala de exportação', feminine: true },
  vessel_schedules: { noun: 'Programação', feminine: true },
  voyage_omissions: { noun: 'Omissão de escala', feminine: true },
  agency_departure_report: { noun: 'ADR de Saída', feminine: false },
  bl: { noun: 'B/L', feminine: false },
  bls: { noun: 'B/L', feminine: false },
  bl_containers: { noun: 'Container', feminine: false },
  vehicles: { noun: 'Veículo', feminine: false },
  import_batches: { noun: 'Importação', feminine: true },
  granite_rates: { noun: 'Tarifa', feminine: true },
  charge_tables: { noun: 'Tabela', feminine: true },
  charge_table_items: { noun: 'Item', feminine: false },
  customer_rate_overrides: { noun: 'Condição de Cliente', feminine: true },
  charge_calculations: { noun: 'Taxa', feminine: true },
  invoice: { noun: 'Fatura', feminine: true },
  invoices: { noun: 'Fatura', feminine: true },
  invoice_items: { noun: 'Item da fatura', feminine: false },
  payments: { noun: 'Pagamento', feminine: false },
  ledger_settlements: { noun: 'Baixa', feminine: true },
  invoice_refunds: { noun: 'Restituição', feminine: true },
  demurrage_invoices: { noun: 'Invoice de Demurrage', feminine: true },
  demurrage_invoice_items: { noun: 'Item da Invoice', feminine: false },
  demurrage_rates: { noun: 'Tarifa', feminine: true },
  customer_demurrage_agreements: { noun: 'Acordo', feminine: false },
  customers: { noun: 'Cliente', feminine: false },
  customer: { noun: 'Cliente', feminine: false },
  customer_contacts: { noun: 'Contato', feminine: false },
  customer_billing_portal_releases: { noun: 'Liberação de faturamento', feminine: true },
  vessels: { noun: 'Navio', feminine: false },
  carriers: { noun: 'Armador', feminine: false },
  ports: { noun: 'Porto', feminine: false },
  depots: { noun: 'Local', feminine: false },
  depot_services: { noun: 'Serviço do Local', feminine: false },
  user_profile: { noun: 'Usuário', feminine: false },
}

/** Rótulos de campo comuns às tabelas sem rótulo próprio. */
const GENERIC_FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  description: 'Descrição',
  notes: 'Observações',
  active: 'Situação',
  role: 'Setor',
  status: 'Situação',
  valid_from: 'Vigência desde',
  valid_to: 'Vigência até',
  value_brl: 'Valor',
  unit_value: 'Valor',
  unit_value_brl: 'Valor unitário',
  total_value_brl: 'Total',
  total_brl: 'Total',
  balance_brl: 'Saldo',
  amount_brl: 'Valor',
  currency: 'Moeda',
  charge_type: 'Cobrança',
  applies_to: 'Aplica-se a',
  applies_to_soc: 'Vale para SOC',
  due_date: 'Vencimento',
  free_days: 'Free time',
  free_time_override: 'Free time do B/L',
  demurrage_rate_override_p1_usd: 'Diária do 1º período do B/L',
  demurrage_rate_override_p2_usd: 'Diária do 2º período do B/L',
  dispute_notes: 'Notas da disputa',
  dispute_subject: 'Assunto da disputa',
  dispute_reason: 'Motivo da disputa',
  communications_enabled: 'Envio real de e-mails',
  password: 'Senha',
  container_number: 'Container',
  pod: 'POD',
  pol: 'POL',
  ata: 'ATA',
  atd: 'ATD',
  eta: 'ETA',
  etd: 'ETD',
  terminal_id: 'Terminal',
  code: 'Código',
  email: 'E-mail',
  invoice_number: 'Número da fatura',
  doc_number: 'Número',
  vessel_id: 'Navio',
  carrier_id: 'Armador',
  customer_id: 'Cliente',
}

/** Situação gravada em código, por entidade ("open" do ADR vira "Aberto"). */
const STATUS_LABELS_BY_ENTITY: Record<string, Record<string, string>> = {
  agency_departure_report: { open: 'Aberto', closed: 'Fechado' },
  agency_departure_reports: { open: 'Aberto', closed: 'Fechado' },
}

/** Frase da troca de situação, quando a entidade tem uma ("ADR de Saída reaberto"). */
const STATUS_SUMMARY_BY_ENTITY: Record<string, Record<string, string>> = {
  agency_departure_report: { open: 'ADR de Saída reaberto', closed: 'ADR de Saída fechado' },
  agency_departure_reports: { open: 'ADR de Saída reaberto', closed: 'ADR de Saída fechado' },
}

/** O Usuário criado pela Edge Function `admin-users` grava "Nome (setor)". */
const NAME_WITH_ROLE = /^(.*\S)\s*\(([a-z_]+)\)$/

function roleLabel(role: string): string {
  return DEPARTMENT_LABELS[role as keyof typeof DEPARTMENT_LABELS] ?? (role === 'operator' ? 'Documentação' : 'Outro setor')
}

/** "Ana Souza (financeiro)" → "Ana Souza · Financeiro"; `null` quando o texto não tem esse formato. */
function nameWithRole(value: string | null): string | null {
  const match = value ? NAME_WITH_ROLE.exec(value.trim()) : null
  return match ? `${match[1]} · ${roleLabel(match[2])}` : null
}

const CREATED_FIELDS = new Set(['criado', 'created', 'bl_created', 'insert'])
const DELETED_FIELDS = new Set(['excluido', 'excluído', 'deleted', 'delete'])
const REACTIVATED_FIELDS = new Set(['reativado', 'reactivated'])
const DEACTIVATED_FIELDS = new Set(['desativado', 'deactivated'])

/** Chaves que nomeiam o registro dentro do JSON gravado na criação ou exclusão. */
const NAME_KEYS = ['name', 'description', 'container_number', 'voyage_number', 'invoice_number', 'doc_number', 'code', 'full_name'] as const
const HIDDEN_JSON_KEYS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by'])

export type AuditLogLike = {
  entity_type: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
}

export function auditSubjectLabel(entityType: string): string {
  return SUBJECT_BY_ENTITY.get(entityType)?.label ?? 'Outro registro'
}

function nounOf(entityType: string): Noun {
  const subject = SUBJECT_BY_ENTITY.get(entityType)
  return NOUN_BY_ENTITY[entityType] ?? { noun: subject?.label ?? 'Registro', feminine: false }
}

function participle(noun: Noun, masculine: string) {
  return `${noun.noun} ${noun.feminine ? `${masculine.slice(0, -1)}a` : masculine}`
}

/** Nome legível do campo, ou `null` quando não há rótulo (a tela mostra "Dado"). */
export function auditFieldLabel(entityType: string, fieldName: string | null): string | null {
  if (!fieldName) return null
  const [field] = fieldName.split('|')
  if (entityType === 'customers' || entityType === 'customer') {
    if (CUSTOMER_FIELD_LABELS[field]) return CUSTOMER_FIELD_LABELS[field]
  }
  if (entityType === 'voyages' || entityType === 'voyage') {
    if (TIMELINE_VOYAGE_FIELD_LABELS[field] && field !== 'created') return TIMELINE_VOYAGE_FIELD_LABELS[field]
  }
  return blFieldLabel(field) ?? GENERIC_FIELD_LABELS[field] ?? null
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function recordName(value: string | null): string | null {
  const parsed = parseJsonObject(value)
  if (!parsed) return null
  for (const key of NAME_KEYS) {
    const candidate = parsed[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/

/** Data e hora de Brasília ("19/10/2026 21:04"). */
export function formatBrasiliaDateTime(value: string): string {
  const { date, time } = splitIsoDateTime(value)
  if (!date) return value
  const [year, month, day] = date.split('-')
  return time ? `${day}/${month}/${year} ${time}` : `${day}/${month}/${year}`
}

/**
 * Valor de um campo em português: Sim/Não, setor, situação da entidade, data de
 * Brasília, "vazio". `entityType` traduz o que só faz sentido por entidade.
 */
export function formatAuditValue(fieldName: string | null, value: string | null, entityType?: string): string {
  const field = (fieldName ?? '').split('|')[0]
  if (value == null || value.trim() === '' || value === 'null') return 'vazio'
  const trimmed = value.trim()
  if (field === 'status' && entityType) {
    const status = STATUS_LABELS_BY_ENTITY[entityType]?.[trimmed]
    if (status) return status
  }
  if (entityType === 'user_profile' && CREATED_FIELDS.has(field)) {
    const person = nameWithRole(trimmed)
    if (person) return person
  }
  if (blFieldLabel(field)) return formatBlFieldValue(field, trimmed)
  if (trimmed === 'true') return field === 'active' ? 'Ativo' : 'Sim'
  if (trimmed === 'false') return field === 'active' ? 'Inativo' : 'Não'
  if (field === 'role') return roleLabel(trimmed)
  if (ISO_DATE.test(trimmed)) {
    const [year, month, day] = trimmed.split('-')
    return `${day}/${month}/${year}`
  }
  if (ISO_DATE_TIME.test(trimmed)) return formatBrasiliaDateTime(trimmed)
  return trimmed
}

export type AuditValueFact = { label: string; value: string }

/**
 * Registro inteiro gravado em JSON (criação ou exclusão): só os campos com
 * rótulo, para o detalhe não mostrar código cru. `null` quando o valor não é
 * um registro.
 */
export function auditValueFacts(entityType: string, value: string | null): AuditValueFact[] | null {
  const parsed = parseJsonObject(value)
  if (!parsed) return null
  return Object.entries(parsed).flatMap(([key, raw]) => {
    if (HIDDEN_JSON_KEYS.has(key) || raw == null || raw === '') return []
    const label = auditFieldLabel(entityType, key)
    if (!label || typeof raw === 'object') return []
    return [{ label, value: formatAuditValue(key, String(raw), entityType) }]
  })
}

/** Frase da coluna "O que mudou". */
export function describeAuditLog(row: AuditLogLike): string {
  const noun = nounOf(row.entity_type)
  const field = (row.field_name ?? '').split('|')[0]
  if (CREATED_FIELDS.has(field)) {
    const name = recordName(row.new_value) ?? (row.entity_type === 'user_profile' ? nameWithRole(row.new_value) : null)
    return name ? `${participle(noun, 'criado')}: ${name}` : participle(noun, 'criado')
  }
  if (DELETED_FIELDS.has(field)) {
    const name = recordName(row.old_value)
    return name ? `${participle(noun, 'excluído')}: ${name}` : participle(noun, 'excluído')
  }
  if (REACTIVATED_FIELDS.has(field) || (field === 'active' && row.new_value === 'true')) return participle(noun, 'reativado')
  if (DEACTIVATED_FIELDS.has(field) || (field === 'active' && row.new_value === 'false')) return participle(noun, 'desativado')
  if (field === 'status') {
    const statusSummary = STATUS_SUMMARY_BY_ENTITY[row.entity_type]?.[(row.new_value ?? '').trim()]
    if (statusSummary) return statusSummary
  }
  if (row.entity_type === 'user_profile' && field === 'password') return 'Senha redefinida'
  const label = auditFieldLabel(row.entity_type, row.field_name)
  if (!label) return participle(noun, 'alterado')
  const value = formatAuditValue(row.field_name, row.new_value, row.entity_type)
  if (parseJsonObject(row.new_value) || value.length > 60) return `${label} alterado`
  return `${label}: ${value}`
}
