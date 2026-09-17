import { supabase } from './supabase'
import type { Depot, DepotService } from '../types/database'
export type { Depot, DepotService }

export type LocalType = 'depot' | 'terminal_portuario'
export type ServiceNature = 'armazenagem' | 'transporte' | 'geral'
export type DepotWithPort = Depot & { port_id: number | null }
export type BrazilianPortOption = { id: number; locode: string; name: string | null }
export type PendingTerminalPortMapping = { pending_count: number; codes: string[] }

type DepotInput = Omit<Depot, 'id' | 'created_at' | 'updated_at'> & {
  id?: string
  port_id?: number | null
}

export async function listDepots(): Promise<DepotWithPort[]> {
  const { data, error } = await supabase.from('depots').select('*').order('code')
  if (error) throw error
  return (data ?? []) as unknown as DepotWithPort[]
}

export async function listBrazilianPorts(): Promise<BrazilianPortOption[]> {
  const { data, error } = await supabase
    .from('ports')
    .select('id, locode, name')
    .like('locode', 'BR%')
    .order('locode')
  if (error) throw error
  return (data ?? []) as BrazilianPortOption[]
}

/** Leitura do legado que ainda precisa ser associado a um porto brasileiro. */
export async function preflightDepotsTerminalPortMapping(): Promise<PendingTerminalPortMapping> {
  const { data, error } = await supabase.rpc('preflight_depots_terminal_port_mapping')
  if (error) throw error
  const value = (data ?? {}) as Partial<PendingTerminalPortMapping>
  return {
    pending_count: Number(value.pending_count ?? 0),
    codes: Array.isArray(value.codes) ? value.codes.filter((code): code is string => typeof code === 'string') : [],
  }
}

export async function upsertDepot(input: DepotInput): Promise<void> {
  if (!input.code.trim()) throw new Error('Código do local obrigatório.')
  const rawPortId = input.port_id
  const portId = input.tipo === 'terminal_portuario'
    && typeof rawPortId === 'number'
    && Number.isInteger(rawPortId)
    && rawPortId > 0
    ? rawPortId
    : null
  if (input.tipo === 'terminal_portuario' && portId === null) {
    throw new Error('Terminal portuário exige um porto brasileiro.')
  }
  if (input.tipo === 'terminal_portuario' && (input.free_time_vazio_days !== 0 || input.free_time_material_days !== 0)) {
    throw new Error('Terminal portuário não possui free time.')
  }
  const payload = {
    code: input.code.trim(), name: input.name?.trim() || null, tipo: input.tipo,
    port_id: portId,
    active: input.active, free_time_vazio_days: input.free_time_vazio_days ?? 0,
    free_time_material_days: input.free_time_material_days ?? 0, updated_at: new Date().toISOString(),
  }
  const query = input.id ? supabase.from('depots').update(payload).eq('id', input.id) : supabase.from('depots').insert(payload)
  const { error } = await query
  if (error) throw error
}

export async function deleteDepot(id: string): Promise<void> {
  const { error } = await supabase.from('depots').delete().eq('id', id)
  if (!error) return
  // A FK composta (terminal_id, pod_port_id) -> depots(id, port_id) e
  // ON DELETE RESTRICT (migration 060): um local ainda apontado por B/L nao
  // pode ser removido. Sem esta traducao o usuario ve a mensagem crua do
  // Postgres ("violates foreign key constraint bls_terminal_pod_port_fk").
  if ((error as { code?: string }).code === '23503') {
    const { count } = await supabase
      .from('bls')
      .select('id', { count: 'exact', head: true })
      .eq('terminal_id', id)
    const quantos = count ?? 0
    throw new Error(
      quantos > 0
        ? `Este local esta definido como terminal em ${quantos} B/L. Troque o terminal desses B/Ls antes de excluir.`
        : 'Este local ainda esta referenciado por outros registros e nao pode ser excluido.',
    )
  }
  throw error
}

export async function listDepotServices(depotId: string): Promise<DepotService[]> {
  const { data, error } = await supabase.from('depot_services').select('*').eq('depot_id', depotId).order('name')
  if (error) throw error
  return (data ?? []) as unknown as DepotService[]
}

/** Catálogo de armazenagem de todos os depots, para sugerir a linha que falta por (depot, condição). */
export async function listArmazenagemServices(): Promise<DepotService[]> {
  const { data, error } = await supabase.from('depot_services').select('*').eq('natureza', 'armazenagem').eq('active', true)
  if (error) throw error
  return (data ?? []) as unknown as DepotService[]
}

export async function upsertDepotService(input: Omit<DepotService, 'id' | 'created_at'> & { id?: string }): Promise<void> {
  const query = input.id ? supabase.from('depot_services').update(input).eq('id', input.id) : supabase.from('depot_services').insert(input)
  const { error } = await query
  if (error) throw error
}

export async function deleteDepotService(id: string): Promise<void> {
  const { error } = await supabase.from('depot_services').delete().eq('id', id)
  if (error) throw error
}

export async function resolveDepot(codeOrPort: string | null | undefined): Promise<Depot | null> {
  const value = codeOrPort?.trim()
  if (!value) return null
  const { data, error } = await supabase.from('depots').select('*').ilike('code', value).eq('active', true).limit(1).maybeSingle()
  if (error) throw error
  return (data as unknown as Depot | null) ?? null
}

export async function listCurrentDepotServices(depotId: string): Promise<DepotService[]> {
  const { data, error } = await supabase.from('depot_services').select('*').eq('depot_id', depotId).eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as unknown as DepotService[]
}

export type SuggestionInput = {
  local: Pick<Depot, 'id'>
  servico: Pick<DepotService, 'id' | 'depot_id' | 'name' | 'rate_brl'>
  tipo?: string | null
  rota?: string | null
  condicao?: string | null
  catalogo?: Array<Pick<DepotService, 'id' | 'depot_id' | 'name' | 'rate_brl' | 'active' | 'container_type' | 'route_destino_id' | 'condition'>>
}

/** Casa do discriminante mais específico ao genérico; o valor efetivo fica na linha. */
export function valorSugerido({ local, servico, tipo, rota, condicao, catalogo = [servico as DepotService] }: SuggestionInput): number | null {
  const candidates = catalogo.filter((item) => item.active !== false && item.depot_id === local.id && item.name.trim().toLocaleLowerCase() === servico.name.trim().toLocaleLowerCase())
  const matches = candidates.filter((item) =>
    (item.container_type == null || item.container_type === tipo) &&
    (item.route_destino_id == null || item.route_destino_id === rota) &&
    (item.condition == null || item.condition === condicao),
  )
  if (!matches.length) return null
  const best = [...matches].sort((a, b) => specificity(b, tipo, rota, condicao) - specificity(a, tipo, rota, condicao))[0]
  return best ? Number(best.rate_brl) : null
}

function specificity(item: Pick<DepotService, 'container_type' | 'route_destino_id' | 'condition'>, tipo?: string | null, rota?: string | null, condicao?: string | null): number {
  return Number(item.container_type != null && item.container_type === tipo)
    + Number(item.route_destino_id != null && item.route_destino_id === rota)
    + Number(item.condition != null && item.condition === condicao)
}
