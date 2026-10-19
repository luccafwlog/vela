import { escapeFilterTerm } from '../lib/utils'
import { supabase } from './supabase'
import { toError } from '../lib/errors'

export async function setVazioImportacaoNatureza(
  id: string,
  natureza: 'cama' | 'cover_plate' | null,
) {
  const { error } = await supabase
    .from('vazios_importacao_containers')
    .update({ natureza })
    .eq('id', id)
  if (error) throw toError(error)
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
  pol?: string
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

  if (filters.pol) {
    const safe = escapeFilterTerm(filters.pol)
    if (safe) {
      query = query.ilike('pol', safe)
    }
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

export const CONTAINER_PROFILE_LABELS: Record<ContainerProfile, string> = {
  standard: 'Standard',
  oog: 'OOG',
  imo: 'IMO',
  imo_oog: 'IMO + OOG',
}

export function containerProfileOf(container: { is_imo?: boolean | null; is_oog?: boolean | null }): ContainerProfile {
  if (container.is_imo) return container.is_oog ? 'imo_oog' : 'imo'
  return container.is_oog ? 'oog' : 'standard'
}

export function containerProfileLabel(container: { is_imo?: boolean | null; is_oog?: boolean | null }) {
  return CONTAINER_PROFILE_LABELS[containerProfileOf(container)]
}

/** Resultado da correção manual: B/Ls do mesmo container que já estavam faturados. */
export type ContainerCorrectionResult = { invoicedBls: string[] }

function correctionResult(data: unknown): ContainerCorrectionResult {
  const invoiced = (data as { invoiced_bls?: unknown } | null)?.invoiced_bls
  return { invoicedBls: Array.isArray(invoiced) ? invoiced.filter((item): item is string => typeof item === 'string') : [] }
}

/**
 * Frase do aviso de sucesso quando a correção chegou a B/L já faturado do
 * mesmo container (Part Lot, ADR 0079 decisão 5): esse B/L não é recalculado;
 * a fatura segue a correção após emissão (ADR 0077).
 */
export function partLotInvoicedNotice(invoicedBls: string[]): string {
  if (invoicedBls.length === 0) return ''
  const list = invoicedBls.join(', ')
  return invoicedBls.length === 1
    ? ` O B/L ${list}, do mesmo container, já foi faturado: a fatura segue a correção após emissão (reemitida sem pagamento; com pagamento, restituição ou Fatura desatualizada).`
    : ` Os B/Ls ${list}, do mesmo container, já foram faturados: as faturas seguem a correção após emissão (reemitidas sem pagamento; com pagamento, restituição ou Fatura desatualizada).`
}

/**
 * Perfil de carga do container (Standard/OOG/IMO). É uma mutação de domínio:
 * a RPC exige justificativa, registra o histórico, limpa classe/UN ao sair de
 * IMO e recalcula as taxas locais do B/L na mesma transação. A marca vale
 * para os outros B/Ls do container (Part Lot); os já faturados voltam em
 * `invoicedBls` e não são recalculados.
 */
export async function setContainerProfile(input: {
  containerId: number
  profile: ContainerProfile
  justification: string
  changedBy?: string | null
}): Promise<ContainerCorrectionResult> {
  const { data, error } = await supabase.rpc('set_bl_container_profile' as never, {
    p_container_id: input.containerId,
    p_profile: input.profile,
    p_justification: input.justification,
    p_changed_by: input.changedBy ?? null,
  } as never)
  if (error) throw new Error(error.message ?? 'Não foi possível alterar o perfil do container.')
  return correctionResult(data)
}

/**
 * SOC/COC do container. Mesmo contrato do perfil: justificativa obrigatória,
 * histórico e recálculo das taxas locais (Drop Off e Damage Protection não
 * cobram de SOC). A correção manual não é sobrescrita pelo Baplie; uma
 * reimportação do B/L volta ao que o B/L declara.
 */
export async function setContainerOwnership(input: {
  containerId: number
  ownership: 'SOC' | 'COC'
  justification: string
  changedBy?: string | null
}): Promise<ContainerCorrectionResult> {
  const { data, error } = await supabase.rpc('set_bl_container_ownership', {
    p_container_id: input.containerId,
    p_ownership: input.ownership,
    p_justification: input.justification,
    p_changed_by: input.changedBy ?? undefined,
  })
  if (error) throw new Error(error.message ?? 'Não foi possível alterar SOC/COC do container.')
  return correctionResult(data)
}

export async function setContainerUnpackingLocation(
  containerId: number,
  unpackingLocation: string | null,
) {
  const { error } = await supabase
    .from('bl_containers')
    .update({ unpacking_location: unpackingLocation })
    .eq('id', containerId)
  if (error) throw toError(error)
}
