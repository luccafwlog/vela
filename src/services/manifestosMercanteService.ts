import { supabase } from './supabase'

export type ManifestoMercanteNatureza = 'carga' | 'vazio'

export type ManifestoMercante = {
  id: string
  voyage_id: number
  pol: string
  pod: string
  numero: string
  natureza: ManifestoMercanteNatureza
  created_at: string
  updated_at?: string
}

export type CreateManifestoMercanteInput = {
  voyage_id: number
  pol: string
  pod: string
  numero: string
  natureza: ManifestoMercanteNatureza
}

export async function createManifestoMercante(
  input: CreateManifestoMercanteInput,
): Promise<ManifestoMercante> {
  const pol = input.pol.trim()
  const pod = input.pod.trim()
  const numero = input.numero.trim()
  const natureza = input.natureza

  if (!pol || !pod) {
    throw new Error('Portos de origem (POL) e destino (POD) são obrigatórios.')
  }
  if (!numero) {
    throw new Error('Número do manifesto Mercante é obrigatório.')
  }
  if (natureza !== 'carga' && natureza !== 'vazio') {
    throw new Error('Natureza do manifesto deve ser "carga" ou "vazio".')
  }

  const { data, error } = await supabase
    .from('manifestos_mercante')
    .insert({
      voyage_id: input.voyage_id,
      pol,
      pod,
      numero,
      natureza,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error(`O número de manifesto Mercante "${numero}" já foi cadastrado no sistema.`)
    }
    throw error
  }

  return data as ManifestoMercante
}

export async function listManifestosMercanteByVoyage(
  voyageId: number,
): Promise<ManifestoMercante[]> {
  const { data, error } = await supabase
    .from('manifestos_mercante')
    .select('*')
    .eq('voyage_id', voyageId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ManifestoMercante[]
}

export async function listManifestosMercanteByRota(
  voyageId: number,
  pol: string,
  pod: string,
): Promise<ManifestoMercante[]> {
  const { data, error } = await supabase
    .from('manifestos_mercante')
    .select('*')
    .eq('voyage_id', voyageId)
    .eq('pol', pol)
    .eq('pod', pod)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ManifestoMercante[]
}

export async function linkBlToManifestoMercante(
  blId: string,
  manifestoId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('bls')
    .update({ manifesto_mercante_id: manifestoId })
    .eq('id', blId)

  if (error) throw error
}

export async function linkBlsToManifestoMercante(
  blIds: string[],
  manifestoId: string | null,
): Promise<void> {
  if (!blIds.length) return
  const { error } = await supabase
    .from('bls')
    .update({ manifesto_mercante_id: manifestoId })
    .in('id', blIds)

  if (error) throw error
}
