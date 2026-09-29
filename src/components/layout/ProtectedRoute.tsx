import { Navigate, Outlet } from 'react-router-dom'
import { useAuth, type Permission } from '../../hooks/useAuth'

export function ProtectedRoute({ adminOnly = false, permission }: { adminOnly?: boolean; permission?: Permission }) {
  const { user, profile, loading, isAdmin, can, profileStatus, profileError, refreshProfile, signOut } = useAuth()

  // Perfil ainda hidratando (getSession e INITIAL_SESSION correm em paralelo e
  // `loading` pode cair antes do perfil chegar): não é "não provisionado".
  if (loading || (user && !profile && profileStatus === 'loading')) {
    return <div className="grid min-h-screen place-items-center bg-[#0d1117] text-slate-300">Carregando sessão...</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!profile) {
    if (profileStatus === 'transient-error') {
      return (
        <div className="grid min-h-screen place-items-center bg-[#0d1117] p-6 text-center text-slate-200">
          <div className="max-w-md rounded-2xl border border-[#30363d] bg-[#161b22] p-6">
            <h1 className="text-xl font-semibold">Falha temporária ao carregar o perfil</h1>
            <p className="mt-2 text-sm text-slate-400">
              Sua sessão continua válida. {profileError ?? 'Verifique a conexão e recarregue o perfil.'}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                className="app-btn app-btn--primary app-btn--sm"
                onClick={() => void refreshProfile()}
              >
                Recarregar perfil
              </button>
              <button
                type="button"
                className="app-btn app-btn--secondary app-btn--sm"
                onClick={() => void signOut()}
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="grid min-h-screen place-items-center bg-[#0d1117] p-6 text-center text-slate-200">
        <div className="max-w-md rounded-2xl border border-[#30363d] bg-[#161b22] p-6">
          <h1 className="text-xl font-semibold">Perfil não provisionado</h1>
          <p className="mt-2 text-sm text-slate-400">
            Sua autenticação existe, mas não há um perfil ativo em user_profiles. Peça ao administrador para
            provisionar seu acesso.
          </p>
        </div>
      </div>
    )
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/painel" replace />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/painel" replace />
  }

  return <Outlet />
}
