import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/ui/Card'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { AdminUsersTab } from '../components/admin/AdminUsersTab'
import { AdminAlertFailuresTab } from '../components/admin/AdminAlertFailuresTab'
import { AdminHistoryTab } from '../components/admin/AdminHistoryTab'
import { AdminSystemTab } from '../components/admin/AdminSystemTab'
import { AdminAdrDeadlineTab } from '../components/admin/AdminAdrDeadlineTab'
import { NaoEncontrado } from './NaoEncontrado'
import { ADMIN_TABS, DEFAULT_ADMIN_TAB, isAdminTab, legacyAdminTab, type AdminTab } from './adminTabs'

/**
 * Administração (lote 5b da identidade visual): cinco abas, uma sub-rota cada.
 * Só o Administrativo abre a tela (rota `adminOnly`; os dados de usuários são
 * recusados pelo banco aos demais).
 */
export function Admin() {
  const navigate = useNavigate()
  // A aba vive na URL: `/admin/historico` é compartilhável e sobrevive ao refresh.
  // `/admin` sem sufixo abre a aba padrão.
  const { tab: tabParam } = useParams<{ tab?: string }>()
  const legacy = legacyAdminTab(tabParam)
  if (legacy) return <Navigate to={`/admin/${legacy}`} replace />
  // `/admin/<aba-inexistente>` não é silenciosamente corrigido.
  if (tabParam !== undefined && !isAdminTab(tabParam)) return <NaoEncontrado />
  const tab: AdminTab = isAdminTab(tabParam) ? tabParam : DEFAULT_ADMIN_TAB

  return (
    <>
      <PageHeader title="Administração" />

      <TabList label="Seções da administração" className="mb-4">
        {ADMIN_TABS.map((entry) => (
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

      <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'usuarios' ? <AdminUsersTab /> : null}
        {tab === 'falhas-de-alertas' ? <AdminAlertFailuresTab /> : null}
        {tab === 'historico' ? <AdminHistoryTab /> : null}
        {tab === 'sistema' ? <AdminSystemTab /> : null}
        {tab === 'prazo-do-adr' ? <AdminAdrDeadlineTab /> : null}
      </div>
    </>
  )
}
