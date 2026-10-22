import { supabase } from './supabase'
import { toError } from '../lib/errors'
import { resolveVaziosImportacaoContainerFilters, type VaziosImportacaoContainerFilters } from './vaziosImportacaoImport'

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

const CONTAINER_IDS_PAGE_SIZE = 1000

/**
 * Ids de todo o recorte da tela ("Selecionar os N do filtro"). Pagina em
 * blocos de 1.000 (o `max_rows` do PostgREST) com ordem estável por `id`,
 * como `listVaziosExportOperationsWithUnits`; o filtro é o mesmo da lista
 * (`resolveVaziosImportacaoContainerFilters`).
 */
export async function fetchVaziosImportacaoContainerIds(
  filters: VaziosImportacaoContainerFilters,
): Promise<string[]> {
  const applyFilters = await resolveVaziosImportacaoContainerFilters(filters)
  if (!applyFilters) return []
  const ids: string[] = []
  for (let from = 0; ; from += CONTAINER_IDS_PAGE_SIZE) {
    const { data, error } = await applyFilters(supabase.from('vazios_importacao_containers').select('id'))
      .order('id')
      .range(from, from + CONTAINER_IDS_PAGE_SIZE - 1)
    if (error) throw error
    const rows = (data ?? []) as Array<{ id: string }>
    ids.push(...rows.map((row) => row.id))
    if (rows.length < CONTAINER_IDS_PAGE_SIZE) break
  }
  return ids
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

/** Local de desova já gravado que a gravação nova troca (ou apaga). */
export type UnpackingReplacement = { containerNumber: string; blId: string; current: string }

type UnpackingRow = { id: number; bl_id: string | null; container_number: string | null; unpacking_location: string | null; bl?: { voyage_id: number | null } | null }

const containerKey = (value: string | null | undefined) => String(value ?? '').replace(/\s+/g, '').toUpperCase()

/**
 * Um local de desova por container físico (ADR 0095, decisão 26; migration
 * 421): gravar o local num B/L grava em todos os B/Ls ativos da Viagem com o
 * mesmo container. Devolve, por container e B/L, o local diferente já gravado
 * que a gravação vai trocar, para a tela pedir a confirmação.
 */
export function unpackingReplacements(rows: readonly UnpackingRow[], targetIds: readonly number[], value: string | null): UnpackingReplacement[] {
  const next = (value ?? '').trim().toUpperCase()
  const targets = new Set(rows.filter((row) => targetIds.includes(row.id)).map((row) => `${row.bl?.voyage_id ?? ''}|${containerKey(row.container_number)}`))
  const seen = new Set<string>()
  const out: UnpackingReplacement[] = []
  for (const row of rows) {
    const current = (row.unpacking_location ?? '').trim()
    if (!current || current.toUpperCase() === next) continue
    if (!targets.has(`${row.bl?.voyage_id ?? ''}|${containerKey(row.container_number)}`)) continue
    const key = `${containerKey(row.container_number)}|${row.bl_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ containerNumber: containerKey(row.container_number), blId: row.bl_id ?? '', current })
  }
  return out.sort((a, b) => a.containerNumber.localeCompare(b.containerNumber) || a.blId.localeCompare(b.blId))
}

export async function findUnpackingReplacements(containerIds: readonly number[], value: string | null): Promise<UnpackingReplacement[]> {
  if (!containerIds.length) return []
  const select = 'id, bl_id, container_number, unpacking_location, bl:bls!inner(voyage_id, cancelled_at)'
  const targets: UnpackingRow[] = []
  for (let index = 0; index < containerIds.length; index += 200) {
    const { data, error } = await supabase.from('bl_containers').select(select).in('id', containerIds.slice(index, index + 200))
    if (error) throw toError(error)
    targets.push(...((data ?? []) as unknown as UnpackingRow[]))
  }
  const numbers = [...new Set(targets.map((row) => row.container_number).filter((n): n is string => Boolean(n)))]
  const voyages = [...new Set(targets.map((row) => row.bl?.voyage_id).filter((v): v is number => v != null))]
  if (!numbers.length || !voyages.length) return []
  const siblings: UnpackingRow[] = []
  for (let index = 0; index < numbers.length; index += 200) {
    const { data, error } = await supabase.from('bl_containers').select(select)
      .in('container_number', numbers.slice(index, index + 200))
      .in('bl.voyage_id', voyages)
      .is('bl.cancelled_at', null)
    if (error) throw toError(error)
    siblings.push(...((data ?? []) as unknown as UnpackingRow[]))
  }
  return unpackingReplacements([...targets, ...siblings], containerIds, value)
}

/** O servidor grava o local em todos os B/Ls do container físico (migration 421). */
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
