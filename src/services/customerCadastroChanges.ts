import { supabase } from './supabase'
import { classifyDbError } from '../lib/errors'
import { CUSTOMER_COMMUNICATION_BOXES } from './customerCommunicationBoxes'
import { CUSTOMER_FIELD_LABELS } from './customerFicha'

/**
 * Alterações do cadastro do Cliente (aba Cadastro e contatos, lote 1 da
 * identidade): o que mudou, de, para, por quem, quando e a justificativa,
 * a partir de `audit_logs` (dados cadastrais) e de
 * `customer_contact_change_events` (contatos e caixas de Comunicado).
 */
export type CadastroChange = {
  id: string
  at: string
  what: string
  from: string | null
  to: string | null
  /** Nome, "Sistema" ou `null` quando o registro não guarda autor. */
  by: string | null
  justification: string | null
}

type SnapshotContact = { id?: number | null; name?: string | null; email?: string | null; phone?: string | null; is_primary?: boolean | null; active?: boolean | null; box_codes?: string[] | null }

const BOX_LABELS = new Map<string, string>(CUSTOMER_COMMUNICATION_BOXES.map((box) => [box.code, box.label]))

function boxesText(codes: readonly string[] | null | undefined) {
  const list = [...(codes ?? [])]
    .sort((left, right) => CUSTOMER_COMMUNICATION_BOXES.findIndex((box) => box.code === left) - CUSTOMER_COMMUNICATION_BOXES.findIndex((box) => box.code === right))
    .map((code) => BOX_LABELS.get(code) ?? code)
  return list.length ? list.join(', ') : null
}

function asContacts(value: unknown): SnapshotContact[] {
  return Array.isArray(value) ? (value as SnapshotContact[]) : []
}

const CONTACT_FIELDS: Array<[keyof SnapshotContact, string]> = [['name', 'Nome'], ['email', 'E-mail'], ['phone', 'Telefone']]

/** Uma alteração de contatos vira uma linha por mudança legível: criado, desativado, campo, caixas, principal. */
export function diffContactSnapshots(before: unknown, after: unknown): Array<Pick<CadastroChange, 'what' | 'from' | 'to'>> {
  const previous = new Map(asContacts(before).filter((contact) => contact.id != null).map((contact) => [contact.id, contact]))
  const changes: Array<Pick<CadastroChange, 'what' | 'from' | 'to'>> = []
  for (const contact of asContacts(after)) {
    const name = contact.name?.trim() || contact.email || 'Contato'
    const old = contact.id != null ? previous.get(contact.id) : undefined
    if (!old) {
      changes.push({ what: 'Contato criado', from: null, to: [contact.name, contact.email].filter(Boolean).join(' · ') || null })
      if (contact.box_codes?.length) changes.push({ what: `Caixas do contato ${name}`, from: null, to: boxesText(contact.box_codes) })
      continue
    }
    if (old.active !== false && contact.active === false) changes.push({ what: `Contato ${name}`, from: 'Ativo', to: 'Desativado' })
    if (old.active === false && contact.active !== false) changes.push({ what: `Contato ${name}`, from: 'Desativado', to: 'Ativo' })
    for (const [field, label] of CONTACT_FIELDS) {
      if ((old[field] ?? '') !== (contact[field] ?? '')) changes.push({ what: `${label} do contato ${name}`, from: (old[field] as string | null) || null, to: (contact[field] as string | null) || null })
    }
    if (!old.is_primary && contact.is_primary) changes.push({ what: 'Contato principal', from: null, to: name })
    if (boxesText(old.box_codes) !== boxesText(contact.box_codes)) changes.push({ what: `Caixas do contato ${name}`, from: boxesText(old.box_codes), to: boxesText(contact.box_codes) })
  }
  return changes
}

type AuditRow = { id: number; field_name: string; old_value: string | null; new_value: string | null; changed_at: string | null; justification: string | null; changed_by: string | null }
type ContactEventRow = { id: number; source: string; actor_id: string | null; before_snapshot: unknown; after_snapshot: unknown; change_summary: { justification?: unknown; action?: unknown } | null; created_at: string }

export function buildCadastroChanges(audit: AuditRow[], events: ContactEventRow[], names: ReadonlyMap<string, string>): CadastroChange[] {
  const actor = (id: string | null) => (id ? names.get(id) ?? 'Usuário interno' : null)
  const rows: CadastroChange[] = audit.filter((row) => row.changed_at).map((row) => ({
    id: `audit-${row.id}`,
    at: row.changed_at!,
    what: row.field_name === 'deactivated' ? 'Situação do Cliente' : CUSTOMER_FIELD_LABELS[row.field_name] ?? 'Dado cadastral',
    from: row.field_name === 'deactivated' ? (row.old_value === 'true' ? 'Desativado' : 'Ativo') : row.old_value,
    to: row.field_name === 'deactivated' ? (row.new_value === 'true' ? 'Desativado' : 'Ativo') : row.new_value,
    by: actor(row.changed_by),
    justification: row.justification,
  }))
  for (const event of events) {
    const summary = event.change_summary ?? {}
    const justification = typeof summary.justification === 'string' && summary.justification.trim()
      ? summary.justification.trim()
      : summary.action === 'customer_created' ? 'Cadastro inicial' : null
    // Conta do Portal não tem perfil interno: a mudança é do Cliente, não de
    // um "Usuário interno" desconhecido.
    const by = event.source === 'portal'
      ? 'Cliente pelo Portal'
      : event.actor_id ? actor(event.actor_id) : event.source === 'interno' ? null : 'Feito pelo sistema'
    diffContactSnapshots(event.before_snapshot, event.after_snapshot).forEach((change, index) => {
      rows.push({ id: `contact-${event.id}-${index}`, at: event.created_at, ...change, by, justification })
    })
  }
  return rows.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
}

export async function fetchCustomerCadastroChanges(customerId: number): Promise<CadastroChange[]> {
  const [audit, events] = await Promise.all([
    supabase.from('audit_logs').select('id, field_name, old_value, new_value, changed_at, justification, changed_by').eq('entity_type', 'customer').eq('entity_id', String(customerId)).order('changed_at', { ascending: false }).range(0, 199),
    supabase.from('customer_contact_change_events').select('id, source, actor_id, before_snapshot, after_snapshot, change_summary, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).range(0, 199),
  ])
  if (audit.error) throw audit.error
  if (events.error && classifyDbError(events.error).kind !== 'permissao') throw events.error
  const eventRows = (events.data ?? []) as unknown as ContactEventRow[]
  const ids = [...new Set([...(audit.data ?? []).map((row) => row.changed_by), ...eventRows.map((row) => row.actor_id)].filter((id): id is string => Boolean(id)))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data, error } = await supabase.from('user_profiles').select('id, full_name').in('id', ids)
    if (error && classifyDbError(error).kind !== 'permissao') throw error
    for (const profile of data ?? []) names.set(profile.id, profile.full_name)
  }
  return buildCadastroChanges((audit.data ?? []) as AuditRow[], eventRows, names)
}
