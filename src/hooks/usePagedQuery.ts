import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query'

type PagedQueryOptions<T> = {
  queryKey: QueryKey
  queryFn: () => Promise<T>
  nextQueryKey: QueryKey
  nextQueryFn: () => Promise<T>
  hasNext: (data: T) => boolean
}

// Lista paginada no servidor: a página atual fica na tela enquanto a próxima
// chega (sem esqueleto a cada clique) e a página seguinte já é pedida em
// segundo plano, então "Próxima" abre do cache.
export function usePagedQuery<T>({ queryKey, queryFn, nextQueryKey, nextQueryFn, hasNext }: PagedQueryOptions<T>) {
  const query = useQuery({ queryKey, queryFn, placeholderData: keepPreviousData })
  useQuery({
    queryKey: nextQueryKey,
    queryFn: nextQueryFn,
    enabled: query.data !== undefined && !query.isPlaceholderData && hasNext(query.data),
    // Só aquece o cache; a tela não re-renderiza por causa dela.
    notifyOnChangeProps: [],
  })
  return query
}
