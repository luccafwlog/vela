import { useState } from 'react'
import { Link, Navigate, Outlet } from 'react-router-dom'
import { Lock, UserX, WifiOff } from 'lucide-react'
import { useAuth, type Permission } from '../../hooks/useAuth'
import { departmentLabel } from '../../lib/departmentLabel'
import { Button } from '../ui/Button'
import { StatusScreen } from './StatusScreen'

export function ProtectedRoute({ adminOnly = false, permission }: { adminOnly?: boolean; permission?: Permission }) {
  const { user, profile, loading, isAdmin, can, profileStatus, profileError, refreshProfile, signOut } = useAuth()
  const [reloadingProfile, setReloadingProfile] = useState(false)

  async function reloadProfile() {
    setReloadingProfile(true)
    try {
      await refreshProfile()
    } finally {
      setReloadingProfile(false)
    }
  }

  // Perfil ainda hidratando (getSession e INITIAL_SESSION correm em paralelo e
  // `loading` pode cair antes do perfil chegar): não é "não provisionado".
  if (loading || (user && !profile && profileStatus === 'loading')) {
    return (
      <main className="app-auth">
        <p className="app-status-loading" role="status">Carregando sessão…</p>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!profile) {
    if (profileStatus === 'transient-error') {
      return (
        <StatusScreen
          fullscreen
          role="alert"
          tone="warning"
          icon={WifiOff}
          title="Falha temporária ao carregar o perfil"
          actions={(
            <>
              <Button type="button" loading={reloadingProfile} loadingLabel="Recarregando…" onClick={() => void reloadProfile()}>
                Recarregar perfil
              </Button>
              <button type="button" className="app-btn app-btn--secondary" onClick={() => void signOut()}>
                Sair
              </button>
            </>
          )}
        >
          <p>Sua sessão continua válida. {profileError ?? 'Verifique a conexão e recarregue o perfil.'}</p>
        </StatusScreen>
      )
    }
    return (
      <StatusScreen
        fullscreen
        role="alert"
        tone="warning"
        icon={UserX}
        title="Acesso ainda não liberado"
        actions={(
          <button type="button" className="app-btn app-btn--secondary" onClick={() => void signOut()}>
            Sair
          </button>
        )}
      >
        <p>Seu login existe, mas ainda não há um perfil ativo no Vela. Peça ao Administrativo para liberar seu acesso.</p>
      </StatusScreen>
    )
  }

  // A guarda de rota só orienta a navegação; quem barra a leitura e a escrita
  // são as policies e RPCs. Em vez de devolver ao Painel sem explicação, a
  // tela diz por que não abriu.
  if ((adminOnly && !isAdmin) || (permission && !can(permission))) {
    return (
      <StatusScreen
        fullscreen={adminOnly}
        role="alert"
        icon={Lock}
        title="Acesso restrito"
        actions={<Link to="/painel" className="app-btn app-btn--primary">Voltar para o Painel</Link>}
      >
        <p>
          {adminOnly
            ? 'A Administração é exclusiva do departamento Administrativo.'
            : `Esta tela não está liberada para o departamento ${departmentLabel(profile.role)}.`}
          {' '}Se precisar dela no seu trabalho, fale com o Administrativo.
        </p>
      </StatusScreen>
    )
  }

  return <Outlet />
}
