import { supabase } from '../supabase'
import { sanitizeLikeTerm } from '../../lib/utils'
import { deleteOneById } from '../deleteRecords'

export type LocalChargeTableWithItems = {
  id: number
  name: string
  cargo_mode: 'container' | 'carga_solta' | 'granito' | null
  pod: string | null
  valid_from: string
  valid_to: string | null
  active: boolean | null
  notes: string | null
  charge_table_items: Array<{
    id: number
    name: string
    category: string | null
    application_basis: string | null
    cargo_profile: string | null
    currency: string | null
    unit_value_brl: number | null
    unit_value_usd: number | null
    manual_only: boolean | null
    active: boolean | null
    sort_order: number | null
  }>
}

export type ChargeTableInput = {
  id?: number | null
  name: string
  cargoMode: 'container' | 'carga_solta' | 'granito'
  pod: string
  validFrom: string
  validTo?: string | null
  active?: boolean
  notes?: string | null
}

export type ChargeTableItemInput = {
  id?: number | null
  chargeTableId: number
  name: string
  category: 'base' | 'other_charge'
  applicationBasis: 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu'
  cargoProfile: 'standard' | 'imo' | 'oog' | 'any'
  currency: 'BRL' | 'USD'
  unitValue: number
  manualOnly: boolean
  active?: boolean
  sortOrder?: number
}

export async function listLocalChargeTables(filters?: {
  cargoMode?: '' | 'container' | 'carga_solta' | 'granito'
  pod?: string
}) {
  let query = supabase
    .from('charge_tables')
    .select(
      `
      id,
      name,
      cargo_mode,
      pod,
      valid_from,
      valid_to,
      active,
      notes,
      charge_table_items(
        id,
        name,
        category,
        application_basis,
        cargo_profile,
        currency,
        unit_value_brl,
        unit_value_usd,
        manual_only,
        active,
        sort_order
      )
    `,
    )
    .order('valid_from', { ascending: false })
    .order('id', { ascending: false })

  if (filters?.cargoMode) {
    // database.ts não lista 'granito'; a migration 051 permite esse valor no banco.
    query = query.eq('cargo_mode', filters.cargoMode as 'container' | 'carga_solta')
  }

  if (filters?.pod) {
    const pod = sanitizeLikeTerm(filters.pod)
    if (pod) query = query.ilike('pod', `%${pod}%`)
  }

  const { data, error } = await query.overrideTypes<LocalChargeTableWithItems[], { merge: false }>()
  if (error) throw error

  const rows = data ?? []

  return rows.map((table) => ({
    ...table,
    charge_table_items: [...(Array.isArray(table.charge_table_items) ? table.charge_table_items : [])].sort((left, right) => {
      const bySort = Number(left.sort_order ?? 999) - Number(right.sort_order ?? 999)
      if (bySort !== 0) return bySort
      return String(left.name ?? '').localeCompare(String(right.name ?? ''), 'pt-BR')
    }),
  }))
}

export async function saveChargeTable(input: ChargeTableInput) {
  const payload = {
    name: input.name.trim(),
    // database.ts não lista 'granito'; a migration 051 permite esse valor no banco.
    cargo_mode: input.cargoMode as 'container' | 'carga_solta',
    pod: input.pod.trim().toUpperCase(),
    valid_from: input.validFrom,
    valid_to: input.validTo?.trim() ? input.validTo : null,
    active: input.active ?? true,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  }

  if (input.id) {
    const { error } = await supabase.from('charge_tables').update(payload).eq('id', input.id)
    if (error) throw error
    return input.id
  }

  const { data, error } = await supabase.from('charge_tables').insert(payload).select('id').single()
  if (error) throw error
  return Number(data.id)
}

export async function setChargeTableActive(id: number, active: boolean) {
  const { error } = await supabase.from('charge_tables').update({ active }).eq('id', id)
  if (error) throw error
}

/**
 * Desativa ou reativa um item de taxa (ADR 0073). Desativado, nao entra em
 * calculos novos e continua explicando os antigos. So o Administrativo; o
 * banco recusa os demais (migration 091).
 */
export async function setChargeTableItemActive(id: number, active: boolean) {
  const { data, error } = await supabase.from('charge_table_items').update({ active }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('O item não foi alterado: sem permissão ou item inexistente.')
}

export async function saveChargeTableItem(input: ChargeTableItemInput) {
  const normalizedUnitValue = Number(input.unitValue)
  const appliesTo: 'container' | 'bl' | 'teu' =
    input.applicationBasis === 'container_distinct_voyage'
      ? 'container'
      : input.applicationBasis === 'teu'
        ? 'teu'
        : 'bl'

  const payload = {
    charge_table_id: input.chargeTableId,
    name: input.name.trim(),
    category: input.category,
    application_basis: input.applicationBasis,
    applies_to: appliesTo,
    cargo_profile: input.cargoProfile,
    currency: input.currency,
    unit_value_brl: input.currency === 'BRL' ? normalizedUnitValue : null,
    unit_value_usd: input.currency === 'USD' ? normalizedUnitValue : null,
    value_brl: input.currency === 'BRL' ? normalizedUnitValue : 0,
    manual_only: input.manualOnly,
    active: input.active ?? true,
    sort_order: Number(input.sortOrder ?? 100),
  }

  if (input.id) {
    const { error } = await supabase.from('charge_table_items').update(payload).eq('id', input.id)
    if (error) throw error
    return input.id
  }

  const { data, error } = await supabase.from('charge_table_items').insert(payload).select('id').single()
  if (error) throw error
  return Number(data.id)
}

export async function deleteChargeTableItem(id: number) {
  const { error } = await deleteOneById('charge_table_items', id)
  if (error) throw error
}
