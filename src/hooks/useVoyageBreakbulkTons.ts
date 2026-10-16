import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import { breakbulkWeightTon } from '../lib/breakbulkWeight'

/**
 * Toneladas de carga solta por viagem, para a coluna BB da tabela de Viagens
 * (lote 2, 2026-10-16). Mesmo peso do card da Viagem (`breakbulkWeightTon`),
 * só de B/Ls ativos de carga solta ou mistos.
 * ponytail: lê os B/Ls de carga solta das viagens listadas, paginando de 1000
 * em 1000; com milhares de B/Ls BB, levar a soma para a RPC de resumo das
 * viagens (`operational_list_voyage_summaries`).
 */
export function useVoyageBreakbulkTons(voyageIds: readonly number[]) {
  return useQuery({
    queryKey: ['voyage-breakbulk-tons', [...voyageIds].sort((a, b) => a - b)],
    enabled: voyageIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const tons = new Map<number, number>()
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('bls')
          .select('voyage_id, cargo_mode, bb_weight_ton, total_weight_kg')
          .in('voyage_id', [...voyageIds])
          .in('cargo_mode', ['carga_solta', 'misto'])
          .is('cancelled_at', null)
          .order('id', { ascending: true })
          .range(from, from + 999)
        if (error) throw error
        for (const bl of data ?? []) {
          const id = Number(bl.voyage_id)
          tons.set(id, (tons.get(id) ?? 0) + breakbulkWeightTon(bl))
        }
        if (!data || data.length < 1000) break
      }
      return tons
    },
  })
}
