/* eslint-disable react-refresh/only-export-components */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './index.css'
import App from './AppInterno'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './hooks/useAuth'
import { VisualThemeProvider } from './hooks/useVisualTheme'
import { ToastProvider } from './components/ui/Toast'
import { ConfirmDialogProvider } from './components/ui/ConfirmDialog'
import { isSupabaseConfigured } from './services/supabase'
import { initTelemetry, markStartupStage, redactVercelTelemetryEvent, vercelTelemetryEnabled } from './lib/telemetry'
import { initFeatureFlags } from './lib/featureFlags'
import { createAppQueryClient } from './lib/queryClient'

initTelemetry('internal')
void initFeatureFlags()
markStartupStage('entry')

function ConfigurationError() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#e2e8f0', padding: '2rem' }}>
      <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.75rem' }}>Erro de configuração</h1>
        <p style={{ lineHeight: 1.6 }}>
          As variáveis de ambiente <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> não
          foram definidas no build. A aplicação não pode se conectar ao banco de dados.
          Configure o arquivo <code>.env</code> (ou os secrets do pipeline) e gere o build novamente.
        </p>
      </div>
    </div>
  )
}

const queryClient = createAppQueryClient()

createRoot(document.getElementById('root')!).render(
  !isSupabaseConfigured ? (
    <ConfigurationError />
  ) : (
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <ConfirmDialogProvider>
              <VisualThemeProvider>
                <AuthProvider>
                  <App />
                  {vercelTelemetryEnabled && <SpeedInsights beforeSend={redactVercelTelemetryEvent} />}
                </AuthProvider>
              </VisualThemeProvider>
            </ConfirmDialogProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
  ),
)
