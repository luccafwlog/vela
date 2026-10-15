import type { BlTimelineEvent, BlTimelineFamily } from '../../services/blTimeline'

const FAMILY_LABEL: Record<BlTimelineFamily, string> = {
  edicao: 'Edição',
  container: 'Contêiner',
  taxas: 'Taxas',
  fatura: 'Fatura',
  sistema: 'Sistema',
}

const FAMILY_TONE: Record<BlTimelineFamily, 'blue' | 'slate' | 'green' | 'yellow' | 'red'> = {
  edicao: 'blue',
  container: 'slate',
  taxas: 'green',
  fatura: 'yellow',
  sistema: 'slate',
}

export function familyLabel(family: BlTimelineFamily): string {
  return FAMILY_LABEL[family]
}

export function familyTone(family: BlTimelineFamily) {
  return FAMILY_TONE[family]
}

const FIELD_LABELS: Record<string, string> = {
  notify_party: 'Notify Party',
  notify2_block: 'Notify 2',
  shipper: 'Shipper',
  consignee: 'Consignatário',
  consignee_phone: 'Telefone do consignatário',
  charge_status: 'Status das taxas',
  financial_status: 'Status financeiro',
  review_status: 'Status de revisão',
  customer_id: 'Cliente',
  place_of_receipt: 'Place of Receipt',
  place_of_delivery: 'Place of Delivery',
  movement_from: 'Movement From',
  movement_to: 'Movement To',
  bl_emission_date: 'Data de emissão',
  issue_place: 'Local de emissão',
  ce_mercante: 'CE Mercante',
  manifesto_mercante: 'Manifesto Mercante',
  ncm_codes: 'NCM',
  cargo_description: 'Descrição da carga',
  notes: 'Notas',
  payment_type: 'Tipo de pagamento',
  voyage_id: 'Viagem',
  terminal_id: 'Terminal',
  bb_machine_qty: 'Máquinas',
  bb_packages_qty: 'Packages',
  bb_packages_total: 'Total de packages',
  bb_weight_ton: 'Peso (Ton)',
  bb_cbm: 'CBM carga solta',
  total_weight_kg: 'Peso contêiner (kg)',
  total_cbm: 'CBM contêiner (m³)',
  discharge_date: 'Descarga',
  return_date: 'Devolução',
  is_imo: 'IMO',
  imo_class: 'Classe IMO',
  un_number: 'Número ONU',
  is_oog: 'OOG',
  seal_number: 'Lacre',
  gross_weight_kg: 'Peso bruto (kg)',
  cbm: 'CBM (m³)',
}

const VALUE_LABELS_BY_FIELD: Record<string, Record<string, string>> = {
  is_imo: { true: 'Sim', false: 'Não' },
  is_oog: { true: 'Sim', false: 'Não' },
  charge_status: {
    not_calculated: 'Pendente',
    calculated: 'Calculado',
    review_required: 'Pendente',
    reviewed: 'Revisado',
    ready_for_billing: 'Pronto para faturar',
    exempt: 'Isento',
  },
  financial_status: {
    pending: 'Pendente',
    invoiced: 'Faturado',
    partially_paid: 'Parcialmente pago',
    paid: 'Pago',
    cancelled: 'Cancelado',
  },
  review_status: {
    ok: 'OK',
    pending_review: 'Pendente',
    reviewed: 'Revisado',
  },
  customer_id: {
    sem_cliente: 'Sem cliente',
  },
}

function normalizeCollectionValue(fieldName: string, value: string): string | null {
  const trimmed = value.trim()
  if (fieldName === 'ncm_codes' && trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean).join(', ') || null
    } catch {
      // Keep the original value when an older audit record is not valid JSON.
    }
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner || inner === '|') return null
    const values = inner.split(/[|,]/).map((item) => item.trim()).filter(Boolean)
    return values.length ? values.join(', ') : null
  }

  if (fieldName === 'ncm_codes' && trimmed.includes(',')) {
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean).join(', ') || null
  }

  return trimmed
}

// Valor ausente escrito por extenso ("Notas: vazio → …"), não "-".
const EMPTY_VALUE = 'vazio'

function formatTimelineValue(fieldName: string, val: string | null | undefined): string {
  if (val == null || val.trim() === '') return EMPTY_VALUE
  const normalized = normalizeCollectionValue(fieldName, val)
  if (!normalized) return EMPTY_VALUE
  if (VALUE_LABELS_BY_FIELD[fieldName] && normalized.toLowerCase() === 'null') return EMPTY_VALUE
  const fieldLabels = VALUE_LABELS_BY_FIELD[fieldName]
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized)
  if (isoDate && (fieldName === 'discharge_date' || fieldName === 'return_date')) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`
  return fieldLabels?.[normalized.toLowerCase()] ?? normalized
}

type ContainerDatesSnapshot = { container?: unknown; discharge_date?: unknown; return_date?: unknown }

function parseContainerDates(value: string | null | undefined): ContainerDatesSnapshot | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as ContainerDatesSnapshot) : null
  } catch {
    return null
  }
}

/**
 * Edição das datas pela ficha do B/L (`set_container_dates`, migration 179):
 * o evento guarda o antes e o depois em JSON, com o motivo na justificativa.
 * Mostra só as datas que mudaram, no formato da tela.
 */
function describeContainerDates(oldValue: string | null | undefined, newValue: string | null | undefined): string | null {
  const before = parseContainerDates(oldValue)
  const after = parseContainerDates(newValue)
  if (!before && !after) return null
  const container = String(after?.container ?? before?.container ?? '').trim()
  const parts = (['discharge_date', 'return_date'] as const).flatMap((field) => {
    const from = before?.[field] == null ? null : String(before[field])
    const to = after?.[field] == null ? null : String(after[field])
    if (from === to) return []
    return [`${FIELD_LABELS[field]}: ${formatTimelineValue(field, from)} → ${formatTimelineValue(field, to)}`]
  })
  const subject = container ? `Container ${container} · datas` : 'Datas do container'
  return parts.length ? `${subject}: ${parts.join('; ')}` : subject
}

export function describeTimelineEvent(event: BlTimelineEvent): string {
  const { entity_type, field_name, old_value, new_value } = event
  if (entity_type === 'bl' && field_name === 'container_dates') {
    const described = describeContainerDates(old_value, new_value)
    if (described) return described
  }
  if (entity_type === 'invoice') {
    if (new_value && /^INV-/i.test(new_value)) return `Fatura ${new_value}`
    if (new_value === 'issued') return 'Fatura emitida'
    if (new_value === 'paid') return 'Fatura paga'
    if (new_value === 'partially_paid') return 'Fatura parcialmente paga'
    if (new_value === 'cancelled') return 'Fatura cancelada'
    // O nome técnico do campo não aparece no Histórico (identidade, lote 1).
    return 'Fatura alterada'
  }
  if (entity_type === 'charge_calculation') {
    return new_value ? `Taxa: ${new_value}` : 'Taxa alterada'
  }
  if (entity_type === 'bl_container') {
    // bl_timeline (migration 079) envia '<campo>|<container>' para a auditoria
    // por coluna de bl_containers; eventos antigos vêm só com o campo.
    const [field, containerNumber] = field_name.split('|')
    const cleanField = FIELD_LABELS[field] ?? field
    const subject = containerNumber ? `Container ${containerNumber} · ${cleanField}` : `Container ${cleanField}`
    return `${subject}: ${formatTimelineValue(field, old_value)} → ${formatTimelineValue(field, new_value)}`
  }
  if (entity_type === 'system_event') {
    return new_value ?? field_name
  }
  // entity_type === 'bl' (field edits, incl. charge_status/financial_status)
  const cleanField = FIELD_LABELS[field_name] ?? field_name
  return `${cleanField}: ${formatTimelineValue(field_name, old_value)} → ${formatTimelineValue(field_name, new_value)}`
}

// Contexto que a importação grava em cada linha do Histórico (migration 189,
// `_set_import_context`): "Importação de <tipo> · Viagem … · Manifesto …".
// É rastro do sistema, não justificativa deliberada — salvo quando traz o
// motivo que a pessoa informou (troca de CE pela planilha, migration 195).
const IMPORT_CONTEXT_PREFIX = 'Importação de '
const REASON_MARK = ' · Motivo: '

export function isImportContext(justification: string | null | undefined): boolean {
  const text = justification?.trim() ?? ''
  return text.startsWith(IMPORT_CONTEXT_PREFIX) && !text.includes(REASON_MARK)
}

// Auditoria = entrada com justificativa deliberada (ver CONTEXT.md).
export function isAudited(event: BlTimelineEvent): boolean {
  return Boolean(event.justification && event.justification.trim()) && !isImportContext(event.justification)
}

// Motivo que o próprio banco escreve quando a pessoa não informa um
// (`save_bl_review`, migration 271): não explica nada a quem lê.
const SYSTEM_DEFAULT_REASONS = new Set(['Revisao manual'])

/**
 * Texto que acompanha o evento na coluna "O que aconteceu": "Motivo: …" para
 * a justificativa de quem fez, "Origem: …" para o rastro da importação, e
 * nada para o motivo padrão escrito pelo sistema.
 */
export function timelineEventDetail(event: Pick<BlTimelineEvent, 'justification'>): string | null {
  const text = event.justification?.trim()
  if (!text || SYSTEM_DEFAULT_REASONS.has(text)) return null
  return `${isImportContext(text) ? 'Origem' : 'Motivo'}: ${text}`
}

/** Coluna "Por": nome de quem fez, "Sistema" no rastro automático, ou nada. */
export function timelineEventActor(event: Pick<BlTimelineEvent, 'family' | 'changed_by' | 'justification'>, actorNames: ReadonlyMap<string, string>): string | null {
  if (event.changed_by) return actorNames.get(event.changed_by) ?? null
  if (event.family === 'sistema' || isImportContext(event.justification)) return 'Sistema'
  return null
}
