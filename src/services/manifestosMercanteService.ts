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
  // Forma canônica: o banco guarda 13 letras ou dígitos (migration 180).
  const numero = canonicalManifestoNumero(input.numero)
  const natureza = input.natureza

  if (!pol || !pod) {
    throw new Error('Portos de origem (POL) e destino (POD) são obrigatórios.')
  }
  if (!numero) {
    throw new Error('Número do manifesto Mercante é obrigatório.')
  }
  if (!MANIFESTO_NUMERO_PATTERN.test(numero)) {
    throw new Error('O Nº de Manifesto Mercante tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).')
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

/** Forma canônica do Nº de Manifesto Mercante: 13 letras ou dígitos (ADR 0078, item 6). */
export function canonicalManifestoNumero(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

export const MANIFESTO_NUMERO_PATTERN = /^[A-Z0-9]{13}$/

/** Lista colada: B/Ls separados por espaço, vírgula, ponto e vírgula ou linha. */
export function parsePastedBlList(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,;]+/).map((item) => item.trim().toUpperCase()).filter(Boolean)))
}

export type VoyageManifestoBl = {
  id: string
  pol: string | null
  pod: string | null
  cancelled: boolean
  manifestoNumero: string | null
}

export async function listVoyageBlsForManifesto(voyageId: number): Promise<VoyageManifestoBl[]> {
  const { data, error } = await supabase
    .from('bls')
    .select('id, pol, pod, cancelled_at, manifesto:manifestos_mercante!bls_manifesto_mercante_id_fkey(numero)')
    .eq('voyage_id', voyageId)
    .order('id')
  if (error) throw error
  type Row = { id: string; pol: string | null; pod: string | null; cancelled_at?: string | null; manifesto: { numero: string } | null }
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    pol: row.pol,
    pod: row.pod,
    cancelled: Boolean(row.cancelled_at),
    manifestoNumero: row.manifesto?.numero ?? null,
  }))
}

/**
 * Mover B/Ls para um Manifesto Mercante (migration 180): tudo ou nada, com
 * motivo no Histórico; o destino novo é validado e criado na hora.
 */
export async function moveBlsToManifestoMercante(blIds: string[], numero: string, reason: string) {
  const { data, error } = await supabase.rpc('move_bls_to_manifesto_mercante' as never, {
    p_bl_ids: blIds,
    p_numero: numero,
    p_reason: reason,
  } as never)
  if (error) throw error
  return data as unknown as { numero: string; created: boolean; moved: number; unchanged: number }
}

export async function unlinkBlsFromManifestoMercante(blIds: string[], reason: string) {
  const { data, error } = await supabase.rpc('unlink_bls_from_manifesto_mercante' as never, {
    p_bl_ids: blIds,
    p_reason: reason,
  } as never)
  if (error) throw error
  return data as unknown as { unlinked: number; unchanged: number }
}
