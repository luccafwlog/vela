import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { reportCaughtException } from './telemetry'
import { isExpectedUserFacingDbError, isRetriableDbError } from './errors'
import { classifyErrorForTelemetry, describeMutation, describeQuery } from './telemetryContext'

function reportQueryError(
  error: unknown,
  meta: Record<string, unknown>,
  tags?: Record<string, string>,
) {
  if (isExpectedUserFacingDbError(error)) return
  reportCaughtException(error, 'TanStack Query', meta, tags)
}

export function createAppQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const queryInfo = describeQuery(query.queryKey)
        const classification = classifyErrorForTelemetry(error)
        const tags: Record<string, string> = {
          modulo: queryInfo.modulo,
          tela: queryInfo.tela,
          tarefa: queryInfo.tarefa,
          categoria_falha: classification.categoria,
          diagnostico: classification.diagnostico,
        }
        if (classification.codigo) {
          tags.codigo_erro = classification.codigo
        }
        reportQueryError(
          error,
          {
            queryKey: JSON.stringify(query.queryKey),
            resumo_didatico: queryInfo.resumo,
            diagnostico: classification.diagnostico,
          },
          tags,
        )
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const mutationInfo = describeMutation(mutation.options.mutationKey, mutation.meta)
        const classification = classifyErrorForTelemetry(error)
        const tags: Record<string, string> = {
          modulo: mutationInfo.modulo,
          tela: mutationInfo.tela,
          tarefa: mutationInfo.tarefa,
          categoria_falha: classification.categoria,
          diagnostico: classification.diagnostico,
        }
        if (classification.codigo) {
          tags.codigo_erro = classification.codigo
        }
        reportQueryError(
          error,
          {
            mutationKey: mutation.options.mutationKey ? JSON.stringify(mutation.options.mutationKey) : undefined,
            resumo_didatico: mutationInfo.resumo,
            diagnostico: classification.diagnostico,
          },
          tags,
        )
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
