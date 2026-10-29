import { supabase } from '../supabase'
import { deleteOneById, reactivateCatalogRow } from '../deleteRecords'

/**
 * Cadastro Tipos de container (migration 513, ADR 0112 D29): o código como vem
 * no B/L e o grupo de tarifa que ele cobra. A tarifa de Demurrage é uma por
 * grupo; tipo fora do cadastro, ou inativo, não tem tarifa.
 * As tabelas são posteriores aos tipos gerados (`src/types/database.ts`).
 */
export type DemurrageRateGroup = { code: string; name: string; sort_order: number }

export type ContainerType = {
  id: number
  code: string
  description: string
  rate_group: string
  active: boolean
}

export type ContainerTypeInput = { id?: number; code: string; description: string; rate_group: string }

export function normalizeContainerTypeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export async function listDemurrageRateGroups(): Promise<DemurrageRateGroup[]> {
  const { data, error } = await supabase
    .from('demurrage_rate_groups' as never)
    .select('code, name, sort_order')
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as DemurrageRateGroup[]
}

export async function listContainerTypes(): Promise<ContainerType[]> {
  const { data, error } = await supabase
    .from('container_types' as never)
    .select('id, code, description, rate_group, active')
    .order('code')
  if (error) throw error
  return (data ?? []) as ContainerType[]
}

export async function saveContainerType(input: ContainerTypeInput): Promise<void> {
  const row = {
    code: normalizeContainerTypeCode(input.code),
    description: input.description.trim(),
    rate_group: input.rate_group,
  }
  const { error } = input.id != null
    ? await supabase.from('container_types' as never).update(row as never).eq('id', input.id)
    : await supabase.from('container_types' as never).insert(row as never)
  if (error) throw error
}

export async function toggleContainerTypeActive(id: number, active: boolean, reason?: string): Promise<void> {
  // Reativar pede motivo e passa pela RPC do Administrativo, como as tarifas.
  if (active) {
    await reactivateCatalogRow('container_types', id, reason ?? '')
    return
  }
  const { error } = await supabase.from('container_types' as never).update({ active } as never).eq('id', id)
  if (error) throw error
}

export async function deleteContainerType(id: number, reason: string): Promise<void> {
  const { error } = await deleteOneById('container_types', id, reason)
  if (error) throw error
}
