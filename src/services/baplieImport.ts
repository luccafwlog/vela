import { supabase } from './supabase'
import type { BaplieContainer } from './baplieParser'

/** Persiste containers do Baplie no staging. Substitui staging anterior da mesma viagem. */
export async function importBaplieStaging(
  voyageId: number,
  containers: BaplieContainer[],
  actorId?: string | null,
): Promise<{ staged: number }> {
  const rows = containers.map((c) => ({
    voyage_id: voyageId,
    container_number: c.container_number,
    size_type: c.size_type,
    status: c.status,
    weight_kg: c.weight_kg,
    pol: c.pol,
    pod: c.pod,
    final_dest: c.final_dest,
    bl_ref: c.bl_ref,
    slot: c.slot,
    is_imo: c.is_imo,
    imo_class: c.imo_class,
    un_number: c.un_number,
    is_oog: c.is_oog,
    imported_by: actorId ?? null,
  }))

  const { error } = await supabase.rpc('import_baplie_staging_transactional', {
    p_voyage_id: voyageId,
    p_rows: rows,
  })
  if (error) throw error

  return { staged: rows.length }
}

/** Quantos containers o Baplie atual da viagem tem; 0 quando ainda não há Baplie. */
export async function countBaplieStaging(voyageId: number): Promise<number> {
  const { count, error } = await supabase
    .from('baplie_containers')
    .select('id', { count: 'exact', head: true })
    .eq('voyage_id', voyageId)
  if (error) throw error
  return count ?? 0
}

/**
 * Reimportar apaga o Baplie anterior da viagem inteiro. Como todo Departamento
 * importa (decisão de 2026-09-23), a substituição sempre pede confirmação.
 */
export function baplieReplacementMessage(existing: number, incoming: number): string {
  return `Esta viagem já tem um Baplie com ${existing} container(s). O arquivo novo, com ${incoming} container(s), substitui o anterior por inteiro.`
}
