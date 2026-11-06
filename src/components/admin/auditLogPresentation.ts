import { blFieldLabel, describeChargeAdjustmentEvent, describeDemurrageWaiver, describeManualChargeUpdate, formatBlFieldValue } from '../bl/blTimelinePresentation'
import { CUSTOMER_FIELD_LABELS } from '../../services/customerFicha'
import { TIMELINE_VOYAGE_FIELD_LABELS } from '../../services/voyageSummaries'
import { DEPARTMENT_LABELS } from '../../lib/departmentLabel'
import { splitIsoDateTime } from '../../lib/utils'
import { getAlertTypeLabel } from '../../services/alerts'
import { AGENCY_REPORT_SECTION_LABELS } from '../../services/agencyReportLabels'
import { ceActionLabel } from '../../lib/ceUnlockLabels'
import { accountSituationLabel, provisioningDecisionLabel } from '../../lib/portalProvisioningViewModel'
import { customerCommunicationKindLabel, customerCommunicationStatusLabel } from '../../services/customerCommunications'
import { getVoyagePodCeStatusLabel } from '../../services/voyageRouteSchedules'
import { INVOICE_STATUS_LABELS } from '../../lib/statusLabels'
import { diasLabel, tamanhoLabel } from '../../lib/vaziosLabels'

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
  { id: 'importacao', label: 'Importação', entityTypes: ['import_batches', 'import_batch', 'import_effect'] },
  // `vazios_export_operation` (singular): exclusão do Embarque de vazios (migration 544).
  { id: 'vazios', label: 'Vazios', entityTypes: ['vazios_bookings', 'vazios_export_operation', 'vazios_export_operations', 'vazios_export_service_lines', 'vazios_importacao_containers', 'vazios_importacao_manifests', 'vazios_manifests'] },
  { id: 'granito', label: 'Granito', entityTypes: ['granite_bl', 'granite_bls', 'granite_manifests', 'granite_bl_charges'] },
  { id: 'tarifa-granito', label: 'Tarifa do Granito', entityTypes: ['granite_rates'] },
  { id: 'taxas-locais', label: 'Tabela de Taxas Locais', entityTypes: ['charge_tables', 'charge_table_items'] },
  { id: 'condicao-cliente', label: 'Condição de Cliente', entityTypes: ['customer_rate_overrides'] },
  // Migration 560: o "ciente" do impacto de taxa alterada à mão.
  { id: 'taxas-bl', label: 'Taxas do B/L', entityTypes: ['charge_calculation', 'charge_calculations', 'bl_charge_adjustment_acks'] },
  { id: 'fatura', label: 'Fatura', entityTypes: ['invoice', 'invoices', 'invoice_items', 'invoice_bls', 'invoice_receivable_links', 'payments', 'ledger_settlements', 'bl_receivables'] },
  { id: 'restituicao', label: 'Restituição', entityTypes: ['invoice_refund', 'invoice_refunds', 'demurrage_refund'] },
  { id: 'cod', label: 'Ajuste de COD', entityTypes: ['cod_adjustment'] },
  // Migration 559: Pix tratado e exceções de Pix entram no Histórico.
  { id: 'pix', label: 'Conciliação PIX', entityTypes: ['itau_pix_receipts', 'pix_reconciliation_exceptions'] },
  { id: 'demurrage', label: 'Invoice de Demurrage', entityTypes: ['demurrage_invoice', 'demurrage_invoices', 'demurrage_invoice_items'] },
  { id: 'tarifa-demurrage', label: 'Tarifa de Demurrage', entityTypes: ['demurrage_rates'] },
  { id: 'tipo-container', label: 'Tipo de container', entityTypes: ['container_types'] },
  { id: 'acordo-demurrage', label: 'Acordo de Demurrage', entityTypes: ['customer_demurrage_agreements'] },
  { id: 'cambio', label: 'Câmbio', entityTypes: ['exchange_rate_reference'] },
  { id: 'cliente', label: 'Cliente', entityTypes: ['customer', 'customers', 'customer_contacts'] },
  { id: 'liberacao', label: 'Liberação de faturamento', entityTypes: ['customer_billing_portal_releases'] },
  // Migration 560: modelos salvos de Comunicado; 561: os Comunicados enviados.
  { id: 'comunicado', label: 'Comunicado', entityTypes: ['customer_communication', 'customer_communication_saved_templates'] },
  // Migration 561: trilhas próprias lidas na aba.
  { id: 'desbloqueio-ce', label: 'Desbloqueio de CE', entityTypes: ['ce_unlock_request'] },
  { id: 'conta-portal', label: 'Conta do Portal', entityTypes: ['portal_account'] },
  { id: 'disputa-demurrage', label: 'Disputa de Demurrage', entityTypes: ['demurrage_dispute'] },
  { id: 'central', label: 'Central de Informações', entityTypes: ['portal_information_depot', 'portal_information_agent', 'portal_information_contact', 'portal_information_carrier'] },
  { id: 'cadastros', label: 'Navio, armador e porto', entityTypes: ['vessels', 'carriers', 'ports'] },
  { id: 'locais', label: 'Local e serviço', entityTypes: ['depots', 'depot_services'] },
  { id: 'usuario', label: 'Usuário', entityTypes: ['user_profile'] },
  // ALE-D08 (migration 476): a resolução de alerta com justificativa.
  { id: 'alerta', label: 'Alerta', entityTypes: ['alert_item'] },
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
  vazios_export_operation: { noun: 'Embarque de vazios', feminine: false },
  vazios_export_operations: { noun: 'Embarque de vazios', feminine: false },
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
  container_types: { noun: 'Tipo de container', feminine: false },
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
  alert_item: { noun: 'Alerta', feminine: false },
  itau_pix_receipts: { noun: 'Pix recebido', feminine: false },
  pix_reconciliation_exceptions: { noun: 'Exceção de Pix', feminine: true },
  vazios_export_service_lines: { noun: 'Linha de serviço', feminine: true },
  granite_bls: { noun: 'B/L de Granito', feminine: false },
  customer_communication_saved_templates: { noun: 'Modelo de Comunicado', feminine: false },
  // Sem nome próprio, a frase usava o assunto no masculino ("Fatura alterado").
  voyage_pol_schedule: { noun: 'Escala', feminine: true },
  bl_receivables: { noun: 'Recebível', feminine: false },
  invoice_receivable_links: { noun: 'Vínculo com a fatura', feminine: false },
  invoice_bls: { noun: 'B/L da fatura', feminine: false },
  bl_freight_lines: { noun: 'Linha de frete', feminine: true },
  charge_calculation: { noun: 'Taxa', feminine: true },
  manifestos_mercante: { noun: 'Manifesto', feminine: false },
  voyage_route_ce_master: { noun: 'CE Master', feminine: false },
  vazios_importacao_containers: { noun: 'Container de vazio', feminine: false },
  vazios_importacao_manifests: { noun: 'Manifesto de vazios', feminine: false },
  exchange_rate_reference: { noun: 'Câmbio', feminine: false },
  app_settings: { noun: 'Configuração', feminine: true },
}

/** Rótulos de campo comuns às tabelas sem rótulo próprio. */
const GENERIC_FIELD_LABELS: Record<string, string> = {
  // Dispensa da cobrança de Demurrage no B/L: De/Para é o container.
  demurrage_dispensa: 'Dispensa da Demurrage',
  name: 'Nome',
  cnpj_cpf: 'CNPJ',
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
  demurrage_roe: 'ROE manual do B/L',
  demurrage_roe_manual: 'Usa ROE manual',
  demurrage_rate_override_p2_usd: 'Diária do 2º período do B/L',
  dispute_notes: 'Notas da disputa',
  dispute_subject: 'Assunto da disputa',
  dispute_reason: 'Motivo da disputa',
  communications_enabled: 'Envio real de e-mails',
  is_dev: 'Marca Dev',
  password: 'Senha',
  container_number: 'Container',
  pod: 'POD',
  pol: 'POL',
  ata: 'ATA',
  atd: 'ATD',
  eta: 'ETA',
  etd: 'ETD',
  terminal_id: 'Terminal',
  terminal: 'Terminal',
  code: 'Código',
  email: 'E-mail',
  invoice_number: 'Número da fatura',
  doc_number: 'Número',
  vessel_id: 'Navio',
  carrier_id: 'Armador',
  customer_id: 'Cliente',
  voyage_id: 'Viagem',
  depot_id: 'Local',
  local_id: 'Local',
  port_id: 'Porto',
  pol_id: 'POL',
  pod_id: 'POD',
  charge_table_id: 'Tabela',
  charge_item_id: 'Item',
  invoice_id: 'Fatura',
  container_id: 'Container',
  manifesto_mercante_id: 'Manifesto',
  handled_note: 'Observação do tratamento',
  handled_at: 'Tratado em',
  justification: 'Justificativa',
  revoke_reason: 'Motivo da revogação',
  revoked_at: 'Revogada em',
  review_at: 'Revisar em',
  embark_port: 'Porto de embarque',
  subject: 'Assunto',
  body: 'Texto',
  cargo_mode: 'Modalidade',
  bl_number: 'Nº do B/L',
  // Campos que apareciam como "B/L alterado" (diagnóstico de 2026-11-06).
  updated_at: 'Data de atualização',
  calculated_at: 'Data do cálculo',
  charges_calculated_at: 'Data do cálculo das taxas',
  batch_id: 'Importação',
  ownership_source: 'Origem do SOC/COC',
  profile_source: 'Origem do perfil',
  billing_hold_reason: 'Retenção do faturamento',
  charge_exemption_reason: 'Motivo da isenção',
  customer_reconciliation_status: 'Conciliação do Cliente',
  customer_reconciliation_notes: 'Observação da conciliação do Cliente',
  table_total_value_brl: 'Total pela tabela',
  table_unit_value_brl: 'Valor unitário pela tabela',
  original_amount_brl: 'Valor original',
  settled_amount_brl: 'Valor baixado',
  total_paid_brl: 'Total pago',
  cancel_reason: 'Motivo do cancelamento',
  cancelled_at: 'Data do cancelamento',
  cancelled_by: 'Autor do cancelamento',
  covered_by_invoice_id: 'Fatura consolidada',
  conciliated_by_extract: 'Conciliada pelo extrato',
  pix_payload: 'Código Pix',
  pix_txid: 'TXID do Pix',
  bank_reference: 'Referência bancária',
  source: 'Origem',
  phone: 'Telefone',
  is_primary: 'Contato principal',
  deactivated_at: 'Data da desativação',
  email_normalized: 'E-mail padronizado',
  container_type: 'Tipo de container',
  // Migration 606 (ADR 0130): free time do depot gravado na linha de armazenagem.
  free_time_days: 'Free time do lançamento',
  ptax: 'PTAX',
  roe: 'ROE',
  quote_date: 'Data da cotação',
  effective_date: 'Vigência',
  natureza: 'Natureza',
  imo: 'IMO',
  charge_calculation_id: 'Taxa',
  pod_schedule_snapshot: 'Retrato das escalas de POD',
  pol_schedule_snapshot: 'Retrato das escalas de POL',
  escala_number: 'Número da escala',
  linked: 'Manifestos vinculados',
  tem_importacao: 'Tem importação',
  ce_master: 'CE Master',
  ces: 'CE da escala',
}

/** Valor gravado em código, por campo ("itau_pix" vira "Pix Itaú"). */
const VALUE_LABELS_BY_FIELD: Record<string, Record<string, string>> = {
  ownership_source: { bl: 'Documento do B/L', baplie: 'Baplie', manual: 'Manual' },
  profile_source: { bl: 'Documento do B/L', baplie: 'Baplie', manual: 'Manual' },
  source: { manual: 'Manual', itau_pix: 'Pix Itaú', pix_extract: 'Extrato Pix', backfill: 'Carga inicial' },
  customer_reconciliation_status: {
    matched_document: 'Achado pelo CNPJ',
    matched_name: 'Achado pelo nome',
    missing_customer: 'Sem Cliente',
    reconciled: 'Conciliado',
    rejected: 'Recusado',
  },
  cargo_mode: { container: 'Container', carga_solta: 'Carga solta' },
  natureza: { cama: 'Cama', cover_plate: 'Cover plate' },
}

/**
 * Campo cujo valor é um código do sistema: sem tradução conhecida, a frase diz
 * só que o campo mudou, para o código não chegar à tela.
 */
function isCodeField(field: string): boolean {
  return field === 'status' || field === 'source' || field.endsWith('_status') || field.endsWith('_source')
}
const CODE_VALUE = /^[a-z]+(_[a-z]+)*$/

/**
 * Linhas que registram um acontecimento, não um campo: a frase vale pela linha
 * inteira (os valores ficam no De e no Para).
 */
const EVENT_SUMMARY: Record<string, string> = {
  'invoice/create_invoice': 'Fatura emitida',
  'invoice/create_consolidated': 'Fatura consolidada emitida',
  'invoice/cancel_invoice': 'Fatura cancelada',
  'invoice/ledger_payment': 'Baixa registrada na fatura',
  'customer/held_billing_reprocessed': 'Faturamento retido reprocessado',
  'charge_calculation/manual_insert': 'Cobrança manual lançada',
  'voyage/baplie_import': 'Baplie importado',
  'voyage/baplie_physical_flags': 'Marcas físicas do Baplie aplicadas',
  'voyage/manifesto_mercante_created': 'Manifesto Mercante criado',
  'voyage_pod_schedule/adr_created': 'ADR terminalizado criado',
  'voyage_pod_schedule/front_created': 'Operação da escala registrada',
  'voyage_pod_schedule/terminal_assignment': 'Terminal da operação alterado',
  'voyage_pod_schedule/export_expectation': 'Exportação da escala atualizada',
}

/** Situação gravada em código, por entidade ("open" do ADR vira "Aberto"). */
const CHARGE_STATUS_LABELS = { calculated: 'Calculada', review_required: 'Revisão pendente', reviewed: 'Revisada', ready_for_billing: 'Pronta para faturar', exempt: 'Isenta', excluded: 'Excluída' }

const STATUS_LABELS_BY_ENTITY: Record<string, Record<string, string>> = {
  agency_departure_report: { open: 'Aberto', closed: 'Fechado' },
  agency_departure_reports: { open: 'Aberto', closed: 'Fechado' },
  charge_calculation: CHARGE_STATUS_LABELS,
  charge_calculations: CHARGE_STATUS_LABELS,
  bl_receivables: { open: 'Em aberto', partially_settled: 'Baixado em parte', settled: 'Baixado', void: 'Anulado' },
  invoice_receivable_links: { active: 'Ativo', settled_by_this_invoice: 'Baixado por esta fatura', settled_elsewhere: 'Baixado por outra fatura', obsolete: 'Obsoleto' },
  invoice: INVOICE_STATUS_LABELS,
  invoices: INVOICE_STATUS_LABELS,
  import_batches: { processing: 'Em processamento', completed: 'Concluída', partial: 'Parcial', failed: 'Falhou' },
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
  /** Nome do cadastro quando o campo é chave de outro (RPC `admin_action_history`, migration 558). */
  old_label?: string | null
  new_label?: string | null
}

/**
 * Campo que guarda a chave de outro registro (`vessel_id`, `created_by`). Sem
 * o nome resolvido pelo banco, o valor é número interno e não vai à tela.
 */
export function isReferenceField(fieldName: string | null): boolean {
  const field = (fieldName ?? '').split('|')[0]
  return field === 'id' || field.endsWith('_id') || field.endsWith('_by')
}

/** Texto de um valor que é chave de outro registro e não tem nome conhecido. */
export const UNRESOLVED_REFERENCE = 'Registro vinculado'

export function auditSubjectLabel(entityType: string): string {
  return SUBJECT_BY_ENTITY.get(entityType)?.label ?? 'Outro registro'
}

function nounOf(entityType: string): Noun {
  const subject = SUBJECT_BY_ENTITY.get(entityType)
  return NOUN_BY_ENTITY[entityType] ?? { noun: subject?.label ?? 'Registro', feminine: false }
}

/** Rótulos femininos e plurais de campo, para a frase "<campo> alterada(s)". */
const FEMININE_FIELD_LABELS = new Set([
  'Viagem', 'Fatura', 'Tabela', 'Situação', 'Moeda', 'Cobrança', 'Descrição', 'Senha', 'Justificativa', 'Observação do tratamento', 'Vigência desde', 'Vigência até',
  'Data de atualização', 'Data do cálculo', 'Data do cálculo das taxas', 'Importação', 'Origem do SOC/COC', 'Origem do perfil', 'Retenção do faturamento',
  'Conciliação do Cliente', 'Observação da conciliação do Cliente', 'Data do cancelamento', 'Fatura consolidada', 'Conciliada pelo extrato', 'Referência bancária',
  'Origem', 'Data da desativação', 'Data da cotação', 'Vigência', 'Natureza', 'Taxa', 'Modalidade',
])
const PLURAL_FIELD_LABELS = new Set(['Observações', 'Notas da disputa'])

/** "Navio alterado", "Viagem alterada", "Observações alteradas". */
function fieldChanged(label: string): string {
  if (PLURAL_FIELD_LABELS.has(label)) return `${label} alteradas`
  return `${label} ${FEMININE_FIELD_LABELS.has(label) ? 'alterada' : 'alterado'}`
}

function participle(noun: Noun, masculine: string) {
  return `${noun.noun} ${noun.feminine ? `${masculine.slice(0, -1)}a` : masculine}`
}

/**
 * Migration 606 (ADR 0130): no serviço de Locais e na Linha de Serviço do
 * Embarque, `container_type` é o tamanho que o serviço cobra ('20', '40' ou
 * nulo = qualquer), com o nome e o valor da tela de Locais; nas outras tabelas
 * continua sendo o tipo do container.
 */
const SIZE_ENTITIES = new Set(['depot_services', 'vazios_export_service_lines'])

function isServiceSize(entityType: string | undefined, field: string): boolean {
  return field === 'container_type' && entityType !== undefined && SIZE_ENTITIES.has(entityType)
}

/** Nome legível do campo, ou `null` quando não há rótulo (a tela mostra "Dado"). */
export function auditFieldLabel(entityType: string, fieldName: string | null): string | null {
  if (!fieldName) return null
  const [field] = fieldName.split('|')
  if (isServiceSize(entityType, field)) return 'Tamanho'
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

const BRASILIA_WITH_SECONDS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/**
 * Data e hora de Brasília com os segundos ("19/10/2026 21:04:37"), para a
 * coluna Quando do Histórico de ações separar uma ação da outra no mesmo
 * minuto. Valor sem fuso cai em `formatBrasiliaDateTime`.
 */
export function formatBrasiliaDateTimeWithSeconds(value: string): string {
  const trimmed = value.trim()
  if (!/(Z|[+-]\d{2}(:?\d{2})?)$/.test(trimmed)) return formatBrasiliaDateTime(value)
  const instant = new Date(trimmed.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  if (Number.isNaN(instant.getTime())) return formatBrasiliaDateTime(value)
  const parts = Object.fromEntries(BRASILIA_WITH_SECONDS.formatToParts(instant).map((part) => [part.type, part.value]))
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`
}

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
  // Tamanho vazio é "Qualquer tamanho"; valor fora de 20/40 (linha anterior à 606) segue como está.
  if (isServiceSize(entityType, field)) {
    const size = value == null || value === 'null' ? '' : value.trim()
    if (size === '' || size === '20' || size === '40') return tamanhoLabel(size)
  }
  if (value == null || value.trim() === '' || value === 'null') return 'vazio'
  const trimmed = value.trim()
  if (field === 'free_time_days' && /^\d+$/.test(trimmed)) return diasLabel(Number(trimmed))
  if (field === 'status' && entityType) {
    const status = STATUS_LABELS_BY_ENTITY[entityType]?.[trimmed]
    if (status) return status
  }
  const coded = VALUE_LABELS_BY_FIELD[field]?.[trimmed]
  if (coded) return coded
  if (field === 'ces') return getVoyagePodCeStatusLabel(trimmed as Parameters<typeof getVoyagePodCeStatusLabel>[0])
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
export function auditValueFacts(
  entityType: string,
  value: string | null,
  valueLabels?: Readonly<Record<string, string>> | null,
): AuditValueFact[] | null {
  const parsed = parseJsonObject(value)
  if (!parsed) return null
  return Object.entries(parsed).flatMap(([key, raw]) => {
    if (HIDDEN_JSON_KEYS.has(key) || raw == null || raw === '') return []
    const label = auditFieldLabel(entityType, key)
    if (!label || typeof raw === 'object') return []
    // Chave de outro cadastro: o nome do banco, ou fora da lista (nunca o número).
    if (isReferenceField(key)) {
      const name = valueLabels?.[key]
      return name ? [{ label, value: name }] : []
    }
    return [{ label, value: formatAuditValue(key, String(raw), entityType) }]
  })
}

/**
 * Valor de De ou Para na tela: o nome do cadastro quando o banco resolveu, a
 * formatação de sempre quando não é chave, e "Registro vinculado" quando é
 * chave sem nome — o número interno nunca.
 */
export function displayAuditValue(fieldName: string | null, value: string | null, entityType: string, label?: string | null): string {
  if (label) return label
  const trail = trailValueText(entityType, fieldName, value)
  if (trail !== undefined) return trail
  if (value != null && value.trim() !== '' && value !== 'null' && isReferenceField(fieldName)) return UNRESOLVED_REFERENCE
  // Na troca de Cliente, a dispensa da Demurrage grava o id de cada Cliente
  // (565): o número interno nunca vai à tela.
  if (fieldName?.split('|')[0] === 'demurrage_dispensa' && value != null && /^\d+$/.test(value.trim())) return UNRESOLVED_REFERENCE
  return formatAuditValue(fieldName, value, entityType)
}

/** Tipo de Comunicado em português; código desconhecido vira "Comunicado", nunca o código. */
function communicationKind(kind: string): string {
  const label = customerCommunicationKindLabel(kind)
  return label === kind ? 'Comunicado' : label
}

/** Situação do Comunicado em português; código desconhecido fica sem situação. */
function communicationStatus(status: string | null): string | null {
  if (!status) return null
  const label = customerCommunicationStatusLabel(status)
  return label === status ? null : label
}

/**
 * Frase das linhas que vêm das trilhas próprias (migration 561): Desbloqueio
 * de CE, conta do Portal, Comunicado enviado, mensagem e anexo de disputa.
 * `null` quando a linha não é de trilha.
 */
function describeTrailRow(row: AuditLogLike): string | null {
  const [field, detail] = (row.field_name ?? '').split('|')
  if (row.entity_type === 'ce_unlock_request' && field === 'ce_unlock') return `Desbloqueio de CE: ${ceActionLabel(detail ?? '')}`
  if (row.entity_type === 'portal_account' && field === 'portal_decision') return `Portal: ${provisioningDecisionLabel(row.new_value)}`
  if (row.entity_type === 'portal_account' && field === 'portal_situation') return `Portal: ${accountSituationLabel(row.new_value)}`
  // Evento da conta sem mudança de decisão nem de situação: o que houve está no Motivo.
  if (row.entity_type === 'portal_account' && field === 'portal_event') return 'Conta do Portal: ação registrada'
  if (row.entity_type === 'customer_communication' && field === 'comunicado') {
    const status = communicationStatus(row.new_value)
    return status ? `${communicationKind(detail ?? '')}: ${status}` : `${communicationKind(detail ?? '')} criado`
  }
  if (row.entity_type === 'demurrage_dispute' && field === 'dispute_message') return 'Mensagem na disputa'
  if (row.entity_type === 'demurrage_dispute' && field === 'dispute_attachment') return `Anexo na disputa: ${row.new_value ?? 'arquivo'}`
  return null
}

/**
 * Valor de De ou Para numa linha de trilha, em português (situação do
 * Comunicado, decisão e situação da conta do Portal, B/L do Desbloqueio).
 * `undefined` quando a linha não é de trilha.
 */
export function trailValueText(entityType: string, fieldName: string | null, value: string | null): string | undefined {
  const field = (fieldName ?? '').split('|')[0]
  if (entityType === 'portal_account' && field === 'portal_decision') return value ? provisioningDecisionLabel(value) : undefined
  if (entityType === 'portal_account' && field === 'portal_situation') return value ? accountSituationLabel(value) : undefined
  if (entityType === 'customer_communication' && field === 'comunicado') return communicationStatus(value) ?? undefined
  if (entityType === 'ce_unlock_request' && field === 'ce_unlock') return value ? `B/L ${value}` : undefined
  return undefined
}

/** Frase da coluna "O que mudou". */
export function describeAuditLog(row: AuditLogLike): string {
  const noun = nounOf(row.entity_type)
  const field = (row.field_name ?? '').split('|')[0]
  // Migration 561: linhas das trilhas próprias.
  const trail = describeTrailRow(row)
  if (trail) return trail
  // Migration 560: o "ciente" do impacto de taxa alterada à mão.
  if (row.entity_type === 'bl_charge_adjustment_acks' && CREATED_FIELDS.has(field)) return 'Impacto da taxa marcado como ciente'
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
  // ALE-D08: a justificativa vai na coluna própria; o tipo do alerta, no texto.
  if (row.entity_type === 'alert_item' && field === 'status' && row.new_value === 'resolved') {
    return `Alerta resolvido com justificativa: ${getAlertTypeLabel(row.old_value ?? '')}`
  }
  if (field === 'status') {
    const statusSummary = STATUS_SUMMARY_BY_ENTITY[row.entity_type]?.[(row.new_value ?? '').trim()]
    if (statusSummary) return statusSummary
  }
  if (row.entity_type === 'user_profile' && field === 'password') return 'Senha redefinida'
  // Migration 560: a observação de seção do ADR.
  if (row.entity_type === 'agency_departure_report' && field === 'observation') {
    const section = (row.field_name ?? '').split('|')[1] ?? ''
    const sectionLabel = AGENCY_REPORT_SECTION_LABELS[section as keyof typeof AGENCY_REPORT_SECTION_LABELS] ?? 'do ADR'
    const text = (row.new_value ?? '').trim()
    if (!text) return `Observação da seção ${sectionLabel} apagada`
    return text.length > 60 ? `Observação da seção ${sectionLabel} alterada` : `Observação da seção ${sectionLabel}: ${text}`
  }
  // ADR 0111: taxa alterada, excluída ou isenta à mão e edição da cobrança manual.
  if (row.entity_type === 'charge_calculation' && field === 'charge_adjustment') return describeChargeAdjustmentEvent(row.new_value)
  if (row.entity_type === 'charge_calculation' && field === 'manual_update') return describeManualChargeUpdate(row.old_value, row.new_value)
  // Dispensa da Demurrage: a mesma frase do Histórico do B/L (dispensou, desfez
  // ou acompanhou a troca de Cliente).
  if (row.entity_type === 'bl' && field === 'demurrage_dispensa') return describeDemurrageWaiver(row.old_value, row.new_value)
  const event = EVENT_SUMMARY[`${row.entity_type}/${field}`]
  if (event) return event
  // B/L excluído da Viagem: o número do B/L vem no De.
  if (row.entity_type === 'voyages' && field === 'bl_deleted') {
    const bl = row.old_value?.trim()
    return bl ? `B/L ${bl} excluído da Viagem` : 'B/L excluído da Viagem'
  }
  const label = auditFieldLabel(row.entity_type, row.field_name)
  if (!label) return participle(noun, 'alterado')
  if (isReferenceField(row.field_name) && !row.new_label) return fieldChanged(label)
  // O cadastro apontado já foi apagado: "Cliente: cadastro excluído", não "Cliente: Cliente excluído".
  if (row.new_label && /\bexcluíd[oa]$/.test(row.new_label)) return `${label}: cadastro excluído`
  const value = displayAuditValue(row.field_name, row.new_value, row.entity_type, row.new_label)
  if (parseJsonObject(row.new_value) || value.length > 60) return fieldChanged(label)
  // Código sem tradução ("settled_elsewhere"): diz só que mudou.
  if (isCodeField(field) && value === (row.new_value ?? '').trim() && CODE_VALUE.test(value)) return fieldChanged(label)
  return `${label}: ${value}`
}

// ---------- Uma linha por ação (migration 603) ----------

/** Áreas do filtro Assunto, na ordem da lista (`optgroup`). */
export const AUDIT_SUBJECT_AREAS: ReadonlyArray<{ label: string; subjects: readonly string[] }> = [
  { label: 'Operação', subjects: ['viagem', 'escala', 'adr', 'manifesto', 'bl', 'container', 'veiculo', 'importacao', 'vazios', 'granito', 'desbloqueio-ce'] },
  { label: 'Financeiro', subjects: ['fatura', 'taxas-bl', 'taxas-locais', 'condicao-cliente', 'liberacao', 'restituicao', 'cod', 'pix', 'tarifa-granito'] },
  { label: 'Demurrage', subjects: ['demurrage', 'tarifa-demurrage', 'tipo-container', 'acordo-demurrage', 'disputa-demurrage', 'cambio'] },
  { label: 'Clientes e Portal', subjects: ['cliente', 'comunicado', 'conta-portal', 'central'] },
  { label: 'Cadastros', subjects: ['cadastros', 'locais'] },
  { label: 'Usuários e sistema', subjects: ['usuario', 'alerta', 'sistema'] },
]

/** Plural do nome ("B/L" → "B/Ls", "Item da fatura" → "Itens da fatura", "Recebível" → "Recebíveis"). */
// Palavras emprestadas que não seguem a regra do português.
const PLURAL_EXCEPTIONS: Readonly<Record<string, string>> = { Container: 'Containers', Pix: 'Pix' }

export function pluralNoun(noun: string): string {
  const [first, ...rest] = noun.split(' ')
  const tail = rest.length ? ` ${rest.join(' ')}` : ''
  if (PLURAL_EXCEPTIONS[first]) return `${PLURAL_EXCEPTIONS[first]}${tail}`
  if (/^[A-Z/]+$/.test(first)) return `${first}s${tail}`
  if (/ível$/.test(first)) return `${first.slice(0, -4)}íveis${tail}`
  if (/el$/.test(first)) return `${first.slice(0, -2)}éis${tail}`
  if (/al$/.test(first)) return `${first.slice(0, -1)}is${tail}`
  if (/m$/.test(first)) return `${first.slice(0, -1)}ns${tail}`
  if (/ão$/.test(first)) return `${first.slice(0, -2)}ões${tail}`
  if (/[rz]$/.test(first)) return `${first}es${tail}`
  return `${first}s${tail}`
}

const KIND_PARTICIPLE: Record<AuditActionKind, string> = { criou: 'criado', alterou: 'alterado', excluiu: 'excluído' }
type AuditActionKind = 'criou' | 'alterou' | 'excluiu'

export type AuditActionGroupLike = { entity_type: string; kind: AuditActionKind; entities: number; fields: readonly string[] }

/** "B/L criado", "17 B/Ls criados", "3 Taxas excluídas". */
export function describeActionGroup(group: AuditActionGroupLike): string {
  const noun = nounOf(group.entity_type)
  const masculine = KIND_PARTICIPLE[group.kind]
  if (group.entities <= 1) return participle(noun, masculine)
  const plural = noun.feminine ? `${masculine.slice(0, -1)}as` : `${masculine}s`
  return `${group.entities.toLocaleString('pt-BR')} ${pluralNoun(noun.noun)} ${plural}`
}

export type AuditActionLike = AuditLogLike & {
  source: string
  line_count: number
  groups: readonly AuditActionGroupLike[]
}

/**
 * Frase da coluna "O que fez" de uma ação: a da linha quando a ação é uma
 * linha só; "<registro> alterado: campo, campo" quando muda vários campos de um
 * registro; e a contagem por tipo de registro quando mexe em vários
 * ("17 B/Ls criados, 781 Containers criados e mais 2").
 */
export function describeAuditAction(action: AuditActionLike): string {
  if (action.source !== 'audit' || action.line_count <= 1 || action.groups.length === 0) return describeAuditLog(action)
  const [first] = action.groups
  if (action.groups.length === 1 && first.entities <= 1) {
    if (first.kind !== 'alterou') return describeAuditLog(action)
    const labels = [...new Set(first.fields.map((field) => auditFieldLabel(first.entity_type, field)).filter((label): label is string => Boolean(label)))]
    if (!labels.length) return participle(nounOf(first.entity_type), 'alterado')
    const shown = labels.slice(0, 3).join(', ')
    const more = labels.length > 3 || first.fields.length >= 8 ? ' e outros' : ''
    return `${participle(nounOf(first.entity_type), 'alterado')}: ${shown}${more}`
  }
  const parts = action.groups.slice(0, 3).map(describeActionGroup)
  const rest = action.groups.length - parts.length
  return rest > 0 ? `${parts.join(', ')} e mais ${rest}` : parts.join(', ')
}

/** Dia de Brasília (YYYY-MM-DD) de hoje menos `days`. */
export function brasiliaDay(daysAgo = 0, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - daysAgo * 86_400_000)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(shifted).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
