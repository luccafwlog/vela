import { escapeFilterTerm } from '../lib/utils'
import { supabase } from './supabase'

export async function setVazioImportacaoNatureza(
  id: string,
  natureza: 'cama' | 'cover_plate' | null,
) {
  const { error } = await supabase
    .from('vazios_importacao_containers')
    .update({ natureza })
    .eq('id', id)
  if (error) throw error
}

export async function setVaziosImportacaoNaturezaMany(
  ids: string[],
  natureza: 'cama' | 'cover_plate' | null,
) {
  if (ids.length === 0) return
  const CHUNK_SIZE = 200
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE)
    const { error } = await supabase
      .from('vazios_importacao_containers')
      .update({ natureza })
      .in('id', chunk)
    if (error) throw error
  }
}

export async function fetchVaziosImportacaoContainerIds(filters: {
  manifestId?: string
  voyageId?: string
  pod?: string
  search?: string
}): Promise<string[]> {
  let query = supabase
    .from('vazios_importacao_containers')
    .select('id')
    .order('created_at', { ascending: false })

  if (filters.search) {
    const safe = escapeFilterTerm(filters.search)
    if (safe) {
      query = query.or(
        `container_number.ilike.%${safe}%,container_type.ilike.%${safe}%`,
      )
    }
  }

  if (filters.manifestId) {
    query = query.eq('manifest_id', filters.manifestId)
  }

  if (filters.voyageId) {
    const { data: manifestIds } = await supabase
      .from('vazios_importacao_manifests')
      .select('id')
      .eq('voyage_id', Number(filters.voyageId))
    const ids = (manifestIds ?? []).map((m: { id: string }) => m.id)
    if (!ids.length) return []
    query = query.in('manifest_id', ids)
  }

  if (filters.pod) {
    const safe = escapeFilterTerm(filters.pod)
    if (safe) {
      query = query.ilike('pod', safe)
    }
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((r: { id: string }) => r.id)
}

export type ContainerProfile = 'standard' | 'oog' | 'imo' | 'imo_oog'

/** Perfil de carga do container (Standard/OOG/IMO). Sair de IMO limpa classe e UN. */
export async function setContainerProfile(containerId: number, profile: ContainerProfile) {
  const isImo = profile === 'imo' || profile === 'imo_oog'
  const { error } = await supabase
    .from('bl_containers')
    .update({
      is_imo: isImo,
      is_oog: profile === 'oog' || profile === 'imo_oog',
      ...(isImo ? {} : { imo_class: null, un_number: null }),
    })
    .eq('id', containerId)
  if (error) throw error
}

export async function setContainerUnpackingLocation(
  containerId: number,
  unpackingLocation: string | null,
) {
  const { error } = await supabase
    .from('bl_containers')
    .update({ unpacking_location: unpackingLocation })
    .eq('id', containerId)
  if (error) throw error
}
