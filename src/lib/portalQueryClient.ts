import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { reportCaughtException } from './telemetry'
import { classifyDbError, isExpectedUserFacingDbError, isRetriableDbError } from './errors'

function reportPortalQueryError(
  error: unknown,
  meta: Record<string, unknown>,
) {
  if (isExpectedUserFacingDbError(error)) return
  const classification = classifyDbError(error)
  const tags: Record<string, string> = {
    surface: 'portal',
    categoria_falha: classification.kind,
  }
  reportCaughtException(
    error,
    'TanStack Query Portal',
    { ...meta, diagnostico: classification.message },
    tags,
  )
}

/** Query client da superfície Fwlog, sem importar o catálogo de rotas internas. */
export function createPortalQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        reportPortalQueryError(error, {
          queryKey: JSON.stringify(query.queryKey),
        })
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        reportPortalQueryError(error, {
          mutationKey: mutation.options.mutationKey
            ? JSON.stringify(mutation.options.mutationKey)
            : undefined,
        })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => failureCount < 3 && isRetriableDbError(error),
      },
    },
  })
}
