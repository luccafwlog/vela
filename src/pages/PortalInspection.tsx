import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { PortalLayout } from '../components/layout/PortalLayout'
import { PortalInspectionAuthProvider } from '../hooks/usePortalAuth'
import { PortalScopeProvider } from '../hooks/usePortalScope'
import { openPortalInspection, type PortalScope } from '../services/portalScope'
import { Button } from '../components/ui/Button'
import { InlineError } from '../components/ui/Card'
import { CopyValue } from '../components/ui/CopyValue'
import { StatusText } from '../components/ui/StatusText'
import { formatCnpjCpf } from '../lib/utils'
import type { PortalSessionOverview } from '../services/portalBilling'
import { inspectionExit } from '../lib/portalInspectionExit'


export function PortalInspection() {
  const { customerId } = useParams<{ customerId: string }>()
  const numericCustomerId = Number(customerId)
  const [overview, setOverview] = useState<PortalSessionOverview | null>(null)
  const [error, setError] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  // A origem só vem no endereço de entrada; as telas do Portal dentro da
  // inspeção navegam sem ela, então fica guardada desde a montagem.
  const [entry] = useState(() => {
    const params = new URLSearchParams(location.search)
    return { origin: params.get('origem'), newTab: params.get('aba') === 'nova' }
  })
  useEffect(() => {
    if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0) return
    void openPortalInspection(numericCustomerId, entry.origin).then(setOverview).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a inspeção.'))
  }, [numericCustomerId, entry.origin])
  if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0) return <Navigate to="/painel" replace />
  if (error) return <main className="p-6"><InlineError message={error} /></main>
  if (!overview) return <main className="p-6 text-sm text-[var(--app-muted)]">Abrindo Modo Inspeção...</main>
  const scope: PortalScope = { mode: 'inspect', customerId: numericCustomerId, overview, basePath: `/clientes/portal/inspecao/${numericCustomerId}` }
  const exit = inspectionExit(entry.origin, entry.newTab, numericCustomerId, overview.customer_cnpj_cpf)

  function leave() {
    if (exit.closeTab) {
      window.close()
      // O navegador só deixa fechar a aba que ainda não navegou; se ela
      // continuar aberta, a saída leva ao Provisionamento.
      window.setTimeout(() => navigate(exit.to), 150)
      return
    }
    navigate(exit.to)
  }

  return (
    <PortalInspectionAuthProvider overview={overview}>
      <PortalScopeProvider scope={scope}>
        <div className="border-b border-[var(--app-warning-border)] bg-[var(--app-warning-bg)] px-4 py-2 text-sm">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-4 gap-y-2">
            <strong className="text-[var(--app-warning-fg)]">Modo Inspeção</strong>
            <span>{overview.customer_name}</span>
            <span className="font-mono"><CopyValue value={formatCnpjCpf(overview.customer_cnpj_cpf)} label="CNPJ/CPF" /></span>
            {overview.account_active === false ? <StatusText tone="warning">Conta não ativa</StatusText> : <span>Conta ativa</span>}
            <Button variant="secondary" className="app-btn--sm ml-auto" onClick={leave}>{exit.label}</Button>
          </div>
        </div>
        <PortalLayout />
      </PortalScopeProvider>
    </PortalInspectionAuthProvider>
  )
}
