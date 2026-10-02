import type { BaplieContainer } from '../types/database'
import { supabase } from './supabase'

// A tela de Baplie precisa destas colunas para os cards, filtros, conciliação
// visual e exportação. O limite é aplicado por viagem e a paginação continua
// explícita para não depender do limite padrão do PostgREST.
export const BAPLIE_STAGING_COLUMNS = 'id, voyage_id, container_number, bl_ref, pol, pod, final_dest, size_type, status, slot, weight_kg, is_imo, is_oog, imo_class, un_number, ownership, imported_at, imported_by'

export async function listBaplieStaging(voyageId: number, pageSize = 1000): Promise<BaplieContainer[]> {
  if (!Number.isInteger(voyageId) || voyageId < 1) {
    throw new Error('Viagem inválida para leitura do Baplie.')
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('Tamanho de página inválido para leitura do Baplie.')
  }

  const rows: BaplieContainer[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('baplie_containers')
      .select(BAPLIE_STAGING_COLUMNS)
      .eq('voyage_id', voyageId)
      .order('container_number')
      .order('id')
      .range(from, from + pageSize - 1)

    if (error) throw error
    rows.push(...((data ?? []) as unknown as BaplieContainer[]))
    if (!data || data.length < pageSize) break
    from += pageSize
  }

  return rows
}

export async function hasBlsForVoyage(voyageId: number): Promise<boolean> {
  if (!Number.isInteger(voyageId) || voyageId < 1) {
    throw new Error('Viagem inválida para verificar B/Ls.')
  }

  const { data, error } = await supabase
    .from('bls')
    .select('id')
    .eq('voyage_id', voyageId)
    .limit(1)

  if (error) throw error
  return (data ?? []).length > 0
}
