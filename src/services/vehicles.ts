import type { DeleteDependencyReport } from './deleteDependencies'
import { supabase } from './supabase'

/**
 * Exclui veículos por id, com motivo, para qualquer usuário ativo e mesmo com
 * CE no B/L (ADR 0078, item 23; migration 183). A fatura viva segue a ADR 0077.
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

/** Move veículos para outro B/L (e container dele), com motivo (migration 183). */
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
