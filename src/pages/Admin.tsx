import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { PageHeader } from '../components/ui/Card'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { StatusScreen } from '../components/layout/StatusScreen'
import { AdminUsersTab } from '../components/admin/AdminUsersTab'
import { AdminAlertFailuresTab } from '../components/admin/AdminAlertFailuresTab'
import { AdminHistoryTab } from '../components/admin/AdminHistoryTab'
import { AdminSystemTab } from '../components/admin/AdminSystemTab'
import { AdminAdrDeadlineTab } from '../components/admin/AdminAdrDeadlineTab'
import { useAuth } from '../hooks/useAuth'
import { NaoEncontrado } from './NaoEncontrado'
import { DEFAULT_ADMIN_TAB, isAdminTab, isDevOnlyAdminTab, legacyAdminTab, visibleAdminTabs, type AdminTab } from './adminTabs'

/**
 * Administração (lote 5b da identidade visual): uma sub-rota por aba. Só o
 * Administrativo abre a tela (rota `adminOnly`; os dados de usuários são
 * recusados pelo banco aos demais). Sistema e Falhas de entrega de alertas são
 * só da conta Dev (decisão do dono de 2026-11-06, `adminTabs.ts`).
 */
export function Admin() {
  const navigate = useNavigate()
  const { isDev } = useAuth()
  // A aba vive na URL: `/admin/historico` é compartilhável e sobrevive ao refresh.
  // `/admin` sem sufixo abre a aba padrão.
  const { tab: tabParam } = useParams<{ tab?: string }>()
  const legacy = legacyAdminTab(tabParam)
  if (legacy) return <Navigate to={`/admin/${legacy}`} replace />
  // `/admin/<aba-inexistente>` não é silenciosamente corrigido.
  if (tabParam !== undefined && !isAdminTab(tabParam)) return <NaoEncontrado />
  const tab: AdminTab = isAdminTab(tabParam) ? tabParam : DEFAULT_ADMIN_TAB
  const tabs = visibleAdminTabs(isDev)
  // O endereço da aba da conta Dev, aberto por outra conta, diz por que não abriu.
  const restricted = isDevOnlyAdminTab(tab) && !isDev

  return (
    <>
      <PageHeader title="Administração" />

      <TabList label="Seções da administração" className="mb-4">
        {tabs.map((entry) => (
          <TabButton
            key={entry.slug}
            id={`admin-tab-${entry.slug}`}
            controls="admin-panel"
            active={tab === entry.slug}
            label={entry.label}
            onClick={() => navigate(`/admin/${entry.slug}`)}
          />
        ))}
      </TabList>

      {restricted ? (
        <StatusScreen
          role="alert"
          icon={Lock}
          title="Acesso restrito"
          actions={<Link to={`/admin/${DEFAULT_ADMIN_TAB}`} className="app-btn app-btn--primary">Ir para Usuários</Link>}
        >
          <p>Esta aba é exclusiva da conta Dev do Administrativo.</p>
        </StatusScreen>
      ) : (
        <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
          {tab === 'usuarios' ? <AdminUsersTab /> : null}
          {tab === 'falhas-de-alertas' ? <AdminAlertFailuresTab /> : null}
          {tab === 'historico' ? <AdminHistoryTab /> : null}
          {tab === 'sistema' ? <AdminSystemTab /> : null}
          {tab === 'prazo-do-adr' ? <AdminAdrDeadlineTab /> : null}
        </div>
      )}
    </>
  )
}
