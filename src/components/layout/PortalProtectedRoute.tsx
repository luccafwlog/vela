import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { usePortalAuth } from '../../hooks/usePortalAuth'

export function PortalProtectedRoute() {
  const { isAuthenticated, loading } = usePortalAuth()
  const location = useLocation()

  if (loading) {
    return (
      <main className="app-auth">
        <p className="app-status-loading" role="status">Carregando o Portal…</p>
      </main>
    )
  }

  if (!isAuthenticated) {
    // Convites de confirmacao de email enviados antes da rota publica existir
    // apontam para /portal/perfil?confirm_email= e valem 48h. Redirecionar para
    // o login descartaria a query string e o token se perderia em silencio --
    // justamente para quem le o Email de Recuperacao sem ter a senha do Portal.
    // Sai junto com o ramo de compatibilidade de `PortalProfile`. Ver ADR 0048.
    if (new URLSearchParams(location.search).has('confirm_email')) {
      return <Navigate to={`/portal/confirmar-email${location.search}`} replace />
    }
    return <Navigate to="/portal/login" replace />
  }

  return <Outlet />
}
