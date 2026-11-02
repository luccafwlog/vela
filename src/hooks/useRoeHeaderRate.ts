import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchROE } from '../services/demurrage/demurrageRoe'

const QUERY_KEY = ['header-roe-reference'] as const

/**
 * Câmbio de referência (PTAX venda e ROE) para a linha de câmbio da tela
 * Demurrage. O nome vem da faixa do alto de todas as telas, que saiu em
 * 2026-11-01.
 */
export function useRoeHeaderRate() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchROE(),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  })

  return {
    ptax: query.data?.ptax ?? null,
    roe: query.data?.roe ?? null,
    effectiveDate: query.data?.effectiveDate ?? null,
    offline: query.data?.offline ?? false,
    cachedAt: query.data?.cachedAt ?? null,
    loading: query.isLoading,
    unavailable: query.isError,
    refresh: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  }
}
