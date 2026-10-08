import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { reportCaughtException } from '../lib/telemetry'
import { StatusScreen } from './layout/StatusScreen'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

/** Error boundary da superfície Fwlog. Mantém o bundle do Portal livre do
 * catálogo de rotas internas usado pelo ErrorBoundary operacional. */
export class PortalErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/portal'
    reportCaughtException(
      error,
      'PortalErrorBoundary',
      { pathname, componentStack: info.componentStack },
      { surface: 'portal', tarefa: 'Renderizar tela', categoria_falha: 'Quebra de Renderização (React Error Boundary)' },
    )
    if (import.meta.env.DEV) {
      console.error('[PortalErrorBoundary] Erro não capturado:', error, info.componentStack)
    } else {
      console.error('[PortalErrorBoundary]', error.message)
    }
  }

  render() {
    if (this.state.error) {
      return (
        <StatusScreen
          fullscreen
          role="alert"
          tone="danger"
          icon={AlertTriangle}
          title="Erro inesperado"
          actions={(
            <>
              <button type="button" className="app-btn app-btn--primary" onClick={() => window.location.reload()}>
                Recarregar página
              </button>
              <a href="/portal/login" className="app-btn app-btn--secondary">Ir para o login</a>
            </>
          )}
        >
          <p>Algo deu errado ao abrir o Portal. Recarregue a página para continuar.</p>
          {import.meta.env.DEV ? (
            <details className="app-status-panel__details">
              <summary>Detalhe técnico</summary>
              <pre>{this.state.error.message}</pre>
            </details>
          ) : null}
        </StatusScreen>
      )
    }

    return this.props.children
  }
}
