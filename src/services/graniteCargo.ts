import { supabase } from './supabase'
import { escapeFilterTerm, voyageDisplayName } from '../lib/utils'
import { tokenIlikeClauses } from '../lib/searchTerms'

/**
 * Carga de Granito movimentada no navio (lote 5b da identidade, regra de
 * 2026-10-19): o Granito não tem Cliente nem taxa; a tela totaliza B/Ls,
 * blocos e peso por recorte e por viagem.
 */

export type GraniteBlRow = {
  id: string
  bl_number: string
  shipper_name: string | null
  vessel_voyage: string | null
  loading_port: string | null
  discharge_port: string | null
  blocks_qty: number | null
  real_weight_kg: number | null
  manifest: {
    voyage_id: number | null
    voyage: { id: number; voyage_number: string | null; vessel: { name: string | null } | null } | null
  } | null
}

export type GraniteCargoFilters = {
  search?: string
  voyageId?: string
  dischargePort?: string
}

const GRANITE_BL_COLUMNS = `id, bl_number, shipper_name, vessel_voyage, loading_port, discharge_port, blocks_qty, real_weight_kg,
  manifest:granite_manifests!inner(voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(name)))`

/**
 * Peso do B/L (decidido em 2026-10-19): só o peso real. O peso declarado pelo
 * shipper não conta, nem como reserva. Sem peso real (ou zero), `null`.
 */
export function graniteWeightKg(bl: Pick<GraniteBlRow, 'real_weight_kg'>): number | null {
  const real = toNumber(bl.real_weight_kg)
  return real !== null && real > 0 ? real : null
}

/** "Navio / Viagem" da Viagem do manifesto; sem ela, o texto da planilha. */
export function graniteVoyageLabel(bl: Pick<GraniteBlRow, 'manifest' | 'vessel_voyage'>): string | null {
  const voyage = bl.manifest?.voyage
  return voyageDisplayName(voyage?.vessel?.name, voyage?.voyage_number) ?? (bl.vessel_voyage?.trim() || null)
}

/** Trecho "POL → POD"; o lado que falta fica sem código. */
export function graniteLegLabel(bl: Pick<GraniteBlRow, 'loading_port' | 'discharge_port'>): string | null {
  const pol = bl.loading_port?.trim()
  const pod = bl.discharge_port?.trim()
  if (!pol && !pod) return null
  return `${pol || '—'} → ${pod || '—'}`
}

export type GraniteCargoTotals = { bls: number; blocks: number; weightKg: number }

export type GraniteVoyageCargo = GraniteCargoTotals & {
  key: string
  voyageId: number | null
  voyageLabel: string | null
  leg: string | null
}

/**
 * Totais do recorte e uma linha por navio e viagem e trecho (o bloco "Carga
 * por viagem"). Blocos e peso ausentes contam zero. Ordem: navio/viagem e
 * depois trecho.
 */
export function summarizeGraniteCargo(rows: readonly Pick<GraniteBlRow, 'manifest' | 'vessel_voyage' | 'loading_port' | 'discharge_port' | 'blocks_qty' | 'real_weight_kg'>[]): {
  totals: GraniteCargoTotals
  byVoyage: GraniteVoyageCargo[]
} {
  const totals: GraniteCargoTotals = { bls: 0, blocks: 0, weightKg: 0 }
  const groups = new Map<string, GraniteVoyageCargo>()
  for (const row of rows) {
    const blocks = toNumber(row.blocks_qty) ?? 0
    const weightKg = graniteWeightKg(row) ?? 0
    totals.bls += 1
    totals.blocks += blocks
    totals.weightKg += weightKg

    const voyageId = row.manifest?.voyage?.id ?? row.manifest?.voyage_id ?? null
    const voyageLabel = graniteVoyageLabel(row)
    const leg = graniteLegLabel(row)
    const key = `${voyageId ?? `sem:${voyageLabel ?? ''}`}|${leg ?? ''}`
    const group = groups.get(key) ?? { key, voyageId, voyageLabel, leg, bls: 0, blocks: 0, weightKg: 0 }
    group.bls += 1
    group.blocks += blocks
    group.weightKg += weightKg
    groups.set(key, group)
  }
  const byVoyage = [...groups.values()].sort((a, b) =>
    (a.voyageLabel ?? '').localeCompare(b.voyageLabel ?? '', 'pt-BR') || (a.leg ?? '').localeCompare(b.leg ?? '', 'pt-BR'))
  return { totals, byVoyage }
}

/** Peso em toneladas com uma casa: "610,2 t". */
export function formatGraniteTons(weightKg: number): string {
  return `${(weightKg / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}


/** `granite_bls` com Busca, Viagem e POD do recorte. */
function filteredGraniteBls(filters: GraniteCargoFilters, withCount = false) {
  let query = supabase.from('granite_bls').select(GRANITE_BL_COLUMNS, withCount ? { count: 'exact' } : undefined)
  const search = filters.search ? escapeFilterTerm(filters.search) : ''
  // Busca por B/L ou shipper (achado G2: o CNPJ saiu da tela e da busca).
  if (search) query = query.or([`bl_number.ilike.%${search}%`, `shipper_name.ilike.%${search}%`, ...tokenIlikeClauses(filters.search ?? '', ['bl_number'])].join(','))
  if (filters.voyageId) query = query.eq('manifest.voyage_id', Number(filters.voyageId))
  if (filters.dischargePort) query = query.eq('discharge_port', filters.dischargePort)
  return query
}

/** Página da tabela "B/Ls de Granito", com a contagem do recorte. */
export async function listGraniteBls(filters: GraniteCargoFilters & { page?: number; pageSize?: number }): Promise<{ rows: GraniteBlRow[]; count: number }> {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20
  const from = (page - 1) * pageSize
  const query = filteredGraniteBls(filters, true)
    .order('created_at', { ascending: false })
    .order('bl_number', { ascending: true })
    .range(from, from + pageSize - 1)
  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as unknown as GraniteBlRow[], count: count ?? 0 }
}

/**
 * Todas as linhas do recorte (sem o POD), para os totais, a "Carga por
 * viagem" e a lista de portos de descarga. O POD é aplicado na tela, para a
 * lista de portos não sumir quando um deles está escolhido.
 *
 * ponytail: lê o recorte inteiro em páginas de 1.000 e soma no navegador. O
 * Granito tem centenas de B/Ls por viagem, então cabe; sem filtro de viagem,
 * cresce com o histórico. Caminho de evolução: uma RPC de agregação por
 * viagem e trecho, quando o volume pesar.
 */
export async function fetchGraniteCargoRows(filters: Omit<GraniteCargoFilters, 'dischargePort'>): Promise<GraniteBlRow[]> {
  const rows: GraniteBlRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filteredGraniteBls(filters)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as GraniteBlRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}
