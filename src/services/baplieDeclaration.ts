import { supabase } from './supabase'

/**
 * Declaração "Viagem sem Baplie" (migration 610, ADR 0131 D4): sem o Baplie
 * importado e sem esta declaração, o CE Mercante dos B/Ls de container fica
 * travado. Declarar e desfazer pedem motivo; só Documentação e Administrativo.
 */
export type VoyageBaplieDeclaration = {
  voyageId: number
  hasBaplie: boolean
  declared: boolean
  reason: string | null
  declaredAt: string | null
  declaredByName: string | null
}

export function parseVoyageBaplieDeclaration(value: unknown): VoyageBaplieDeclaration {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const voyageId = Number(row?.voyage_id)
  if (!row || !Number.isInteger(voyageId)) throw new Error('Resposta inesperada da declaração de Baplie da viagem.')
  const text = (key: string) => (typeof row[key] === 'string' && (row[key] as string).trim() ? (row[key] as string).trim() : null)
  return {
    voyageId,
    hasBaplie: row.has_baplie === true,
    declared: row.declared === true,
    reason: text('reason'),
    declaredAt: text('declared_at'),
    declaredByName: text('declared_by_name'),
  }
}

export async function fetchVoyageBaplieDeclaration(voyageId: number): Promise<VoyageBaplieDeclaration> {
  const { data, error } = await supabase.rpc('voyage_baplie_declaration' as never, { p_voyage_id: voyageId } as never)
  if (error) throw error
  return parseVoyageBaplieDeclaration(data)
}

export async function declareVoyageWithoutBaplie(voyageId: number, reason: string): Promise<VoyageBaplieDeclaration> {
  const { data, error } = await supabase.rpc('declare_voyage_without_baplie' as never, { p_voyage_id: voyageId, p_reason: reason } as never)
  if (error) throw error
  return parseVoyageBaplieDeclaration(data)
}

export async function undoVoyageBaplieDeclaration(voyageId: number, reason: string): Promise<VoyageBaplieDeclaration> {
  const { data, error } = await supabase.rpc('undo_voyage_baplie_declaration' as never, { p_voyage_id: voyageId, p_reason: reason } as never)
  if (error) throw error
  return parseVoyageBaplieDeclaration(data)
}
