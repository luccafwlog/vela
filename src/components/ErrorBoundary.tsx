import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportCaughtException } from '../lib/telemetry'
import { describeRoute } from '../lib/telemetryContext'

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
      if (this.props.variant === 'route') {
        return (
          <main className="px-6 py-10">
            <div className="mx-auto w-full max-w-lg rounded-2xl border border-red-400/40 bg-red-500/10 p-6 text-center">
              <h1 className="mb-2 text-lg font-semibold text-red-400">Não foi possível exibir esta tela</h1>
              <p className="mb-4 text-sm text-[var(--app-muted)]">
                Ocorreu um erro inesperado nesta página. As demais áreas do sistema continuam funcionando.
              </p>
              {import.meta.env.DEV ? <details className="mb-4 rounded-lg bg-[var(--app-surface)] p-3 text-left text-xs text-[var(--app-muted)]">
                <summary className="cursor-pointer font-semibold">Detalhe técnico</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{this.state.error.message}</pre>
              </details> : null}
              <div className="flex justify-center gap-3">
                <a href="/painel" className="app-btn app-btn--secondary">Voltar ao Painel</a>
                <button type="button" className="app-btn app-btn--primary" onClick={() => window.location.reload()}>
                  Recarregar página
                </button>
              </div>
            </div>
          </main>
        )
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0d1117] p-8">
          <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
            <h1 className="mb-2 text-lg font-semibold text-red-300">Erro inesperado</h1>
            <p className="mb-4 text-sm text-slate-400">
              Algo deu errado. Recarregue a página para continuar.
            </p>
            {import.meta.env.DEV ? <details className="mb-4 rounded-lg bg-[#0d1117] p-3 text-left text-xs text-slate-400">
              <summary className="cursor-pointer font-semibold">Detalhe técnico</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{this.state.error.message}</pre>
            </details> : null}
            <button
              className="rounded-lg bg-[#21262d] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-[#30363d]"
              onClick={() => window.location.reload()}
            >
              Recarregar página
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
