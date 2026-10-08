import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportCaughtException } from '../lib/telemetry'
import { describeRoute } from '../lib/telemetryContext'
import { AlertTriangle } from 'lucide-react'
import { StatusScreen } from './layout/StatusScreen'

type Props = {
  children: ReactNode
  /**
   * 'fullscreen' (padrão): tela inteira, usado na raiz da aplicação.
   * 'route': card dentro do layout — preserva header e navegação, oferece
   * volta ao Painel e esconde o detalhe técnico atrás de um <details>.
   */
  variant?: 'fullscreen' | 'route'
  /** Quando muda (ex: pathname), o erro é limpo e a nova rota renderiza. */
  resetKey?: string
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
    const routeInfo = describeRoute(pathname)
    reportCaughtException(
      error,
      'ErrorBoundary',
      {
        pathname,
        variant: this.props.variant ?? 'fullscreen',
        componentStack: _info.componentStack,
      },
      {
        modulo: routeInfo.modulo,
        tela: routeInfo.tela,
        tarefa: 'Renderizar tela',
        categoria_falha: 'Quebra de Renderização (React Error Boundary)',
      },
    )
    // Em produção logamos apenas a mensagem; o componentStack fica fora
    // para não vazar estrutura interna de componentes no console do browser.
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] Erro não capturado:', error, _info.componentStack)
    } else {
      console.error('[ErrorBoundary]', error.message)
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      const detail = import.meta.env.DEV ? (
        <details className="app-status-panel__details">
          <summary>Detalhe técnico</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      ) : null

      if (this.props.variant === 'route') {
        return (
          <StatusScreen
            role="alert"
            tone="danger"
            icon={AlertTriangle}
            title="Não foi possível exibir esta tela"
            actions={(
              <>
                <button type="button" className="app-btn app-btn--primary" onClick={() => window.location.reload()}>
                  Recarregar página
                </button>
                <a href="/painel" className="app-btn app-btn--secondary">Voltar ao Painel</a>
              </>
            )}
          >
            <p>Ocorreu um erro inesperado nesta tela. O menu e as demais áreas do sistema continuam funcionando.</p>
            {detail}
          </StatusScreen>
        )
      }

      return (
        <StatusScreen
          fullscreen
          role="alert"
          tone="danger"
          icon={AlertTriangle}
          title="Erro inesperado"
          actions={(
            <button type="button" className="app-btn app-btn--primary" onClick={() => window.location.reload()}>
              Recarregar página
            </button>
          )}
        >
          <p>Algo deu errado ao abrir o Vela. Recarregue a página para continuar.</p>
          {detail}
        </StatusScreen>
      )
    }

    return this.props.children
  }
}
