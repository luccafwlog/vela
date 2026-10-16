import { useNavigate } from 'react-router-dom'
import { TabButton } from '../ui/TabButton'
import { TabList } from '../ui/TabList'
import { useAuth } from '../../hooks/useAuth'
import { usePortalProvisioning } from '../../hooks/usePortalProvisioning'

type ClientesTab = 'clientes' | 'portal' | 'comunicacao'

const ROUTES: Record<ClientesTab, string> = {
  clientes: '/clientes',
  portal: '/clientes/portal',
  comunicacao: '/clientes/comunicacao',
}

/** Quem vê a fila do Provisionamento (mesma lista da contagem de Clientes). */
const PORTAL_QUEUE_ROLES = ['administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos']

/**
 * Abas de Clientes, Provisionamento do Portal e Comunicação no topo das três
 * páginas (lote 2, 2026-10-16): as duas páginas muito usadas ficam à vista. O
 * número é o de Clientes aguardando análise no Provisionamento. Os endereços
 * das páginas não mudam.
 */
export function ClientesTabs({ active }: { active: ClientesTab }) {
  const navigate = useNavigate()
  const { effectiveRole } = useAuth()
  const canSeePortalQueue = PORTAL_QUEUE_ROLES.includes(effectiveRole ?? '')
  const { data: portalRows } = usePortalProvisioning(canSeePortalQueue)
  const awaiting = canSeePortalQueue
    ? (portalRows?.filter((row) => row.provisioning_decision === 'aguardando_analise').length ?? null)
    : null
  const go = (tab: ClientesTab) => { if (tab !== active) navigate(ROUTES[tab]) }
  return (
    <TabList label="Clientes">
      <TabButton active={active === 'clientes'} label="Clientes" onClick={() => go('clientes')} />
      <TabButton
        active={active === 'portal'}
        label="Provisionamento do Portal"
        count={awaiting}
        countLabel={awaiting === 1 ? '1 Cliente aguardando análise' : `${awaiting} Clientes aguardando análise`}
        onClick={() => go('portal')}
      />
      <TabButton active={active === 'comunicacao'} label="Comunicação" onClick={() => go('comunicacao')} />
    </TabList>
  )
}
