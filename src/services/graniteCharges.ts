import { supabase } from './supabase'
import { escapeFilterTerm } from '../lib/utils'
import type { GraniteBlCharge, GraniteRate } from '../types/database'
import { deleteOneById } from './deleteRecords'

export async function listGraniteRates(): Promise<GraniteRate[]> {
  const { data, error } = await supabase
    .from('granite_rates')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as GraniteRate[]
}

export async function upsertGraniteRate(
  rate: Omit<GraniteRate, 'id' | 'created_at'> & { id?: string },
): Promise<GraniteRate> {
  const { data, error } = await supabase
    .from('granite_rates')
    .upsert(rate, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data as GraniteRate
}

export async function deleteGraniteRate(id: string): Promise<void> {
  const { error } = await deleteOneById('granite_rates', id)
  if (error) throw error
}

export async function calculateGraniteBlCharges(blId: string): Promise<GraniteBlCharge[]> {
  // O cálculo, a seleção de tarifas vigentes e a troca das linhas precisam
  // acontecer no mesmo lock/transação do servidor. A fila S05 chama a mesma
  // RPC, então o botão manual e o consumidor assíncrono têm uma única fonte
  // de verdade e não podem interpretar tarifa ausente como lista vazia.
  const { data, error } = await supabase.rpc(
    'calculate_granite_bl_charges' as never,
    { p_bl_id: blId } as never,
  )
  if (error) throw error

  const charges = (data as { charges?: unknown } | null)?.charges
  if (!Array.isArray(charges)) {
    throw new Error('O cálculo de Granito não retornou linhas de cobrança válidas.')
  }
  return charges as GraniteBlCharge[]
}

export async function listGraniteBls(filters: {
  voyageId?: string
  dischargePort?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('granite_bls')
    .select(
      `*, manifest:granite_manifests(id, vessel_voyage, voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(id, name))), customer:customers!granite_bls_client_id_fkey(id, name), suggested_customer:customers!granite_bls_suggested_client_id_fkey(id, name)`,
      { count: 'exact' },
    )
    .range(from, to)
    .order('created_at', { ascending: false })

  if (filters.search) {
    const search = escapeFilterTerm(filters.search)
    if (search) {
      query = query.or(
        `bl_number.ilike.%${search}%,shipper_name.ilike.%${search}%,shipper_cnpj.ilike.%${search}%`,
      )
    }
  }

  if (filters.dischargePort) {
    query = query.eq('discharge_port', filters.dischargePort)
  }

  if (filters.voyageId) {
    const { data: manifestIds } = await supabase
      .from('granite_manifests')
      .select('id')
      .eq('voyage_id', Number(filters.voyageId))
    const ids = (manifestIds ?? []).map((m: { id: string }) => m.id)
    if (!ids.length) return { rows: [], count: 0 }
    query = query.in('manifest_id', ids)
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], count: count ?? 0 }
}
