import { useQuery } from '@tanstack/react-query'
import { lookupCnpj } from '../services/cnpjLookup'
import { queryKeys } from '../services/queryKeys'

/**
 * Dados da Receita para um CNPJ já válido (`null` desliga). Uma consulta por
 * CNPJ na sessão: o dado público muda pouco, e a BrasilAPI tem limite de uso.
 */
export function useCnpjLookup(cnpj: string | null) {
  return useQuery({
    queryKey: queryKeys.cnpjLookup(cnpj ?? ''),
    queryFn: () => lookupCnpj(cnpj!),
    enabled: Boolean(cnpj),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  })
}
