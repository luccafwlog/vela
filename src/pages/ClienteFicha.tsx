import { CeUnlockVipCoveragePanel } from '../components/ce-unlock/CeUnlockVipCoveragePanel'
import { useAuth } from '../hooks/useAuth'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Card, PageHeader } from '../components/ui/Card'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { useCustomerDetail } from '../hooks/useCustomers'
import { formatCnpjCpf } from '../lib/utils'
import { FichaTabBar, resolveFichaTab, type FichaTabId } from '../components/clientes/FichaTabs'
import { CadastroContatosTab } from '../components/clientes/CadastroContatosTab'
import { VisaoGeralTab } from '../components/clientes/VisaoGeralTab'
import { OperacionalTab } from '../components/clientes/OperacionalTab'
import { FinanceiroTab } from '../components/clientes/FinanceiroTab'
import { HistoricoTab } from '../components/clientes/HistoricoTab'

export function ClienteFicha() {
  const { can } = useAuth()
  const { cnpj } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveFichaTab(searchParams.get('tab'))
  const { data, isLoading, error } = useCustomerDetail(cnpj)

  const selectTab = (tab: FichaTabId) =>
    setSearchParams(
      (params) => {
        params.set('tab', tab)
        return params
      },
      { replace: true }
    )

  if (isLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Clientes', to: '/clientes' }, { label: 'Carregando...' }]} />
        <SkeletonCard lines={5} />
      </>
    )
  }

  if (error || !data) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const errorMessage =
      !cnpj || code === 'PGRST116' || (!error && !data)
        ? 'Cliente não encontrado.'
        : 'Falha ao consultar o cliente.'

    return (
      <>
        <Breadcrumb
          items={[
            { label: 'Clientes', to: '/clientes' },
            { label: 'Cliente não encontrado' },
          ]}
        />
        <PageHeader
          title="Ficha do Cliente"
          description="Hub de consulta do cadastro, operação e financeiro."
          action={
            <Link className="text-sm font-semibold text-[var(--app-link)] hover:underline" to="/clientes">
              <ArrowLeft className="mr-1 inline" size={16} />Voltar para clientes
            </Link>
          }
        />
        <Card className="text-red-200">{errorMessage}</Card>
      </>
    )
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Clientes', to: '/clientes' }, { label: data.name }]} />
      <PageHeader
        title={data.name}
        description={`Ficha do cliente ${formatCnpjCpf(data.cnpj_cpf)} — hub de consulta do cadastro, operação e financeiro.`}
        action={
          <Link className="text-sm font-semibold text-[var(--app-link)] hover:underline" to="/clientes">
            <ArrowLeft className="mr-1 inline" size={16} />Voltar para clientes
          </Link>
        }
      />
      <FichaTabBar active={activeTab} onSelect={selectTab} />
      {activeTab === 'visao-geral' ? <VisaoGeralTab data={data} onNavigateTab={selectTab} /> : null}
      {activeTab === 'cadastro' ? <CadastroContatosTab data={data} cnpj={cnpj!} /> : null}
      {activeTab === 'operacional' ? <OperacionalTab data={data} /> : null}
      {activeTab === 'financeiro' ? <FinanceiroTab data={data} /> : null}
      {activeTab === 'desbloqueio-ce' && can('ce_unlock_read') ? <Card><CeUnlockVipCoveragePanel customerId={data.id} manage={can('ce_unlock_manage')} /></Card> : null}
      {activeTab === 'historico' ? <HistoricoTab data={data} /> : null}
    </>
  )
}
