import type { BlTimelineEvent, BlTimelineFamily } from '../../services/blTimeline'

const FAMILY_LABEL: Record<BlTimelineFamily, string> = {
  edicao: 'Edição',
  container: 'Container',
  taxas: 'Taxas',
  fatura: 'Fatura',
  sistema: 'Sistema',
}

const FAMILY_TONE: Record<BlTimelineFamily, 'blue' | 'slate' | 'green' | 'yellow' | 'red'> = {
  edicao: 'blue',
  container: 'slate',
  taxas: 'green',
  fatura: 'yellow',
  sistema: 'red',
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
  ncm_codes: 'NCM',
  cargo_description: 'Descrição da carga',
  notes: 'Notas',
  payment_type: 'Tipo de pagamento',
  voyage_id: 'Viagem',
  terminal_id: 'Terminal',
  bb_machine_qty: 'Máquinas',
  bb_packages_qty: 'Volumes',
  bb_packages_total: 'Total de volumes',
  bb_weight_ton: 'Peso (Ton)',
  bb_cbm: 'CBM carga solta',
  total_weight_kg: 'Peso contêiner (kg)',
  total_cbm: 'CBM contêiner (m³)',
}

const VALUE_LABELS: Record<string, string> = {
  pending: 'Pendente',
  pending_review: 'Pendente de revisão',
  ready: 'Pronto para faturar',
  exempt: 'Isento',
  invoiced: 'Faturado',
  cancelled: 'Cancelado',
  settled: 'Liquidado',
  open: 'Em aberto',
  ok: 'Revisado',
  sem_cliente: 'Sem cliente',
}

function formatTimelineValue(val: string | null | undefined): string {
  if (val == null || val.trim() === '') return '-'
  const trimmed = val.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner || inner === '|') return '-'
    return inner.replace(/|/g, ', ')
  }
  return VALUE_LABELS[trimmed.toLowerCase()] ?? trimmed
}

export function describeTimelineEvent(event: BlTimelineEvent): string {
  const { entity_type, field_name, old_value, new_value } = event
  if (entity_type === 'invoice') {
    if (new_value && /^INV-/i.test(new_value)) return `Fatura ${new_value}`
    if (new_value === 'issued') return 'Fatura emitida'
    if (new_value === 'paid') return 'Fatura paga'
    return `Fatura: ${field_name}`
  }
  if (entity_type === 'charge_calculation') {
    return `Taxa: ${new_value ?? field_name}`
  }
  if (entity_type === 'bl_container') {
    const cleanField = FIELD_LABELS[field_name] ?? field_name
    return `Container ${cleanField}: ${formatTimelineValue(old_value)} → ${formatTimelineValue(new_value)}`
  }
  if (entity_type === 'system_event') {
    return new_value ?? field_name
  }
  // entity_type === 'bl' (field edits, incl. charge_status/financial_status)
  const cleanField = FIELD_LABELS[field_name] ?? field_name
  return `${cleanField}: ${formatTimelineValue(old_value)} → ${formatTimelineValue(new_value)}`
}

// Auditoria = entrada com justificativa deliberada (ver CONTEXT.md).
export function isAudited(event: BlTimelineEvent): boolean {
  return Boolean(event.justification && event.justification.trim())
}
