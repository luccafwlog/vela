import type { ReactNode } from 'react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { Button } from '../ui/Button'
import { SkeletonCard } from '../ui/Skeleton'

type QueryStateGateProps = {
  /** `query.isLoading` (sem nenhum dado ainda). */
  isLoading: boolean
  /** `query.isError`. */
  isError: boolean
  /** `query.fetchStatus === 'paused'` — o TanStack pausa sem rede. */
  isPaused?: boolean
  /** Há dados em cache para exibir (`data !== undefined`), mesmo que stale. */
  hasData: boolean
  errorMessage?: string
  onRetry?: () => void
  loadingLabel?: string
  /** Esqueleto na geometria final do conteúdo; padrão: três linhas. */
  loadingFallback?: ReactNode
  children: ReactNode
}

function RetryButton({ onRetry }: { onRetry?: () => void }) {
  if (!onRetry) return null
  return (
    <Button variant="secondary" className="app-btn--sm mt-3" onClick={onRetry}>
      Tentar novamente
    </Button>
  )
}

/**
 * Porta única de estado de leitura para listas e painéis.
 *
 * - Offline sem cache: mostra indisponibilidade — nunca "nenhum registro".
 * - Offline com cache: conserva os dados com indicação de desatualização.
 * - Reconnect retoma sozinho (a query volta a `fetchStatus === 'fetching'`).
 * - Escrita offline nunca é anunciada aqui: este gate só cobre leitura.
 * - Carregamento da tela é esqueleto; ação em andamento fica no botão que a
 *   disparou (`Button loading`), nunca aqui.
 */
export function QueryStateGate({
  isLoading,
  isError,
  isPaused = false,
  hasData,
  errorMessage = 'Falha ao carregar os dados.',
  onRetry,
  loadingLabel = 'Carregando…',
  loadingFallback,
  children,
}: QueryStateGateProps) {
  const online = useOnlineStatus()
  const offline = !online || isPaused

  if (hasData) {
    return (
      <>
        {offline ? (
          <div role="status" className="app-offline-banner">
            Você está offline. Exibindo dados salvos — a leitura retoma ao reconectar.
          </div>
        ) : isError ? (
          <div role="alert" className="app-panel app-panel--padded">
            <p className="text-sm font-semibold text-[var(--app-text-strong)]">{errorMessage}</p>
            <RetryButton onRetry={onRetry} />
          </div>
        ) : null}
        {children}
      </>
    )
  }

  if (offline) {
    return (
      <div role="status" className="app-panel app-panel--padded">
        <p className="text-sm font-semibold text-[var(--app-text-strong)]">Sem conexão no momento.</p>
        <p className="mt-1 text-sm text-[var(--app-muted)]">
          Não foi possível carregar os dados e não há cópia salva. Verifique a rede e tente de novo —
          isto não significa que a lista esteja vazia.
        </p>
        <RetryButton onRetry={onRetry} />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{loadingLabel}</span>
        <div aria-hidden="true">{loadingFallback ?? <SkeletonCard lines={3} />}</div>
      </div>
    )
  }

  if (isError) {
    return (
      <div role="alert" className="app-panel app-panel--padded">
        <p className="text-sm font-semibold text-[var(--app-text-strong)]">{errorMessage}</p>
        <RetryButton onRetry={onRetry} />
      </div>
    )
  }

  return <>{children}</>
}
