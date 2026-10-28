import type { DeleteDependencyReport } from './deleteDependencies'
import { supabase } from './supabase'
import { mapChunks } from '../lib/utils'
import type { BlChargeImpactChange } from './charges/chargeOperationsService'

/**
 * Exclui veículos por id, com motivo, para qualquer usuário ativo e mesmo com
 * CE no B/L (ADR 0078, item 23; migration 184). A fatura viva segue a ADR 0077.
 */
export async function deleteVehicles(ids: number[], reason?: string): Promise<DeleteDependencyReport<number>> {
  const { data, error } = await supabase.rpc('delete_vehicles_with_reason' as never, { p_vehicle_ids: ids, p_reason: reason ?? '' } as never)
  if (error) throw error
  const deleted = new Set(((data as { deleted_ids?: number[] } | null)?.deleted_ids ?? []).map(Number))
  return {
    deletableIds: ids.filter((id) => deleted.has(id)),
    blockedIds: ids.filter((id) => !deleted.has(id)).map((id) => ({ id, reasons: ['não encontrado'] })),
  }
}

export type MoveVehiclesResult = { moved: number; target_bl_id: string; container_id: number }

/** Move veículos para outro B/L (e container dele), com motivo (migration 184). */
export async function moveVehiclesToBl(args: { ids: number[]; targetBlId: string; containerId?: number | null; reason: string }): Promise<MoveVehiclesResult> {
  const { data, error } = await supabase.rpc('move_vehicles_to_bl' as never, {
    p_vehicle_ids: args.ids,
    p_target_bl_id: args.targetBlId.trim().toUpperCase(),
    p_reason: args.reason,
    p_target_container_id: args.containerId ?? null,
  } as never)
  if (error) throw error
  return data as unknown as MoveVehiclesResult
}

/**
 * Mudanças que excluir ou mover veículos fazem nos B/Ls de origem, para a
 * prévia **Taxas alteradas à mão** (ADR 0111, D6). A seleção da página
 * Veículos passa das páginas da lista: o B/L de cada veículo vem do banco.
 */
export async function vehicleChargeImpactChanges(ids: number[], targetBlId?: string): Promise<BlChargeImpactChange[]> {
  const rows = await mapChunks(ids, 400, async (chunk) => {
    const { data, error } = await supabase.from('vehicles').select('id, bl_id').in('id', chunk)
    if (error) throw error
    return (data ?? []) as Array<{ id: number; bl_id: string | null }>
  })
  const byBl = new Map<string, number[]>()
  for (const row of rows) {
    if (!row.bl_id) continue
    byBl.set(row.bl_id, [...(byBl.get(row.bl_id) ?? []), row.id])
  }
  return [...byBl].map(([blId, vehicles]) => (targetBlId
    ? { bl_id: blId, move_vehicles: vehicles.map((id) => ({ id, to_bl_id: targetBlId })) }
    : { bl_id: blId, remove_vehicle_ids: vehicles }))
}

/** Containers do B/L de destino, para escolher quem recebe os veículos. */
export async function listBlContainersForMove(blId: string): Promise<Array<{ id: number; container_number: string }>> {
  const { data, error } = await supabase
    .from('bl_containers')
    .select('id, container_number')
    .eq('bl_id', blId.trim().toUpperCase())
    .order('container_number')
  if (error) throw error
  return (data ?? []) as Array<{ id: number; container_number: string }>
}

/** Declaração "Esta viagem não terá veículos" (migration 468), com quem declarou. */
export type VoyageVehicleDeclaration = {
  voyageId: number
  declaredAt: string
  declaredByName: string | null
}

export function parseVoyageVehicleDeclaration(value: unknown): VoyageVehicleDeclaration | null {
  if (value === null || value === undefined) return null
  const row = typeof value === 'object' ? value as Record<string, unknown> : null
  const voyageId = Number(row?.voyage_id)
  const declaredAt = typeof row?.declared_at === 'string' ? row.declared_at : ''
  if (!row || !Number.isInteger(voyageId) || !declaredAt) throw new Error('Resposta inesperada da declaração de veículos da viagem.')
  const name = typeof row.declared_by_name === 'string' ? row.declared_by_name.trim() : ''
  return { voyageId, declaredAt, declaredByName: name || null }
}

/** `null` quando a viagem não está declarada sem veículos. */
export async function fetchVoyageVehicleDeclaration(voyageId: number): Promise<VoyageVehicleDeclaration | null> {
  const { data, error } = await supabase.rpc('voyage_vehicle_declaration' as never, { p_voyage_id: voyageId } as never)
  if (error) throw error
  return parseVoyageVehicleDeclaration(data)
}

/**
 * Declara que a viagem não terá veículos: fecha o alerta Planilha de Veículos
 * pendente. O banco recusa viagem cancelada ou que já tem veículo.
 */
export async function declareVoyageWithoutVehicles(voyageId: number): Promise<VoyageVehicleDeclaration | null> {
  const { data, error } = await supabase.rpc('declare_voyage_without_vehicles' as never, { p_voyage_id: voyageId } as never)
  if (error) throw error
  return parseVoyageVehicleDeclaration(data)
}

/** Desfaz a declaração, com motivo; dentro do prazo, o alerta reabre. */
export async function undoVoyageVehicleDeclaration(voyageId: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('undo_voyage_vehicle_declaration' as never, { p_voyage_id: voyageId, p_reason: reason } as never)
  if (error) throw error
}
