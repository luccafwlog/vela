import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Copy, FileStack, MoreHorizontal, ReceiptText, ShieldCheck } from 'lucide-react'
import { CeUnlockVipCoveragePanel } from '../components/ce-unlock/CeUnlockVipCoveragePanel'
import { useAuth } from '../hooks/useAuth'
import { ActionMenu, type ActionMenuItem } from '../components/ui/ActionMenu'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { useToast } from '../components/ui/Toast'
import { useCustomerDetail } from '../hooks/useCustomers'
import { buildCustomerBillingUrl } from '../lib/customerTableViewModel'
import { userFacingErrorMessage } from '../lib/errors'
import { formatCnpjCpf, formatCountLabel, formatDate } from '../lib/utils'
import { FichaTabBar, fichaPanelId, fichaTabId, resolveFichaTab, type FichaTabId } from '../components/clientes/FichaTabs'
import { CadastroContatosTab } from '../components/clientes/CadastroContatosTab'
import { VisaoGeralTab } from '../components/clientes/VisaoGeralTab'
import { OperacionalTab } from '../components/clientes/OperacionalTab'
import { FinanceiroTab } from '../components/clientes/FinanceiroTab'
import { HistoricoTab } from '../components/clientes/HistoricoTab'
import { clientesListHref } from './clientesListState'

type Deactivation = { deactivated_at?: string | null; deactivation_reason?: string | null }

export function ClienteFicha() {
  const { can } = useAuth()
  const { showToast } = useToast()
  const canReadCeUnlock = can('ce_unlock_read')
  const { cnpj } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveFichaTab(searchParams.get('tab'), canReadCeUnlock)
  const { data, isLoading, error, refetch } = useCustomerDetail(cnpj)
  const listHref = clientesListHref()

  const selectTab = (tab: FichaTabId) =>
    setSearchParams(
      (params) => {
        if (tab === 'visao-geral') params.delete('tab')
        else params.set('tab', tab)
        return params
      },
      { replace: true },
    )

  if (isLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Clientes', to: listHref }, { label: 'Carregando…' }]} />
        <div className="app-customer-skeleton" role="status" aria-label="Carregando a ficha do Cliente">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={5} />
        </div>
      </>
    )
  }

  if (error || !data) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const missing = !cnpj || code === 'PGRST116' || (!error && !data)
    const document = cnpj ? formatCnpjCpf(cnpj) : ''

    return (
      <>
        <Breadcrumb items={[{ label: 'Clientes', to: listHref }, { label: missing ? 'Cliente não encontrado' : 'Ficha do Cliente' }]} />
        <Card className="app-customer-missing">
          <h1 className="app-customer-missing__title">{missing ? 'Cliente não encontrado' : 'Não foi possível abrir este Cliente'}</h1>
          <p className="app-customer-missing__text">
            {missing
              ? `Nenhum Cliente com o CNPJ/CPF ${document || 'informado'}. Confira o número ou busque pelo nome na lista.`
              : userFacingErrorMessage(error, 'A consulta falhou. Tente de novo em instantes.')}
          </p>
          <div className="app-customer-missing__actions">
            {missing ? null : <Button variant="secondary" onClick={() => void refetch()}>Tentar novamente</Button>}
            <Link className="app-btn app-btn--ghost" to={listHref}>
              <ArrowLeft size={16} aria-hidden="true" />
              Voltar para Clientes
            </Link>
          </div>
        </Card>
      </>
    )
  }

  const { deactivated_at: deactivatedAt, deactivation_reason: deactivationReason } = data as typeof data & Deactivation
  const primary = data.customer_contacts?.find((contact) => contact.is_primary && !contact.deactivated_at && contact.email?.trim())
  const place = [data.city, data.state].filter(Boolean).join('/')
  const blCount = data.bls?.length ?? 0

  async function copyCnpj() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      await navigator.clipboard.writeText(formatCnpjCpf(data!.cnpj_cpf))
      showToast('CNPJ copiado.', 'success')
    } catch {
      showToast('Não foi possível copiar o CNPJ.', 'error')
    }
  }

  const menu: ActionMenuItem[] = [
    { key: 'cnpj', label: 'Copiar CNPJ', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void copyCnpj() },
    { key: 'faturas', label: 'Ver faturas em Taxas Locais', icon: <ReceiptText size={14} aria-hidden="true" />, to: buildCustomerBillingUrl(data) },
    { key: 'bls', label: 'Ver os B/Ls na lista de BLs', icon: <FileStack size={14} aria-hidden="true" />, to: `/bls?q=${encodeURIComponent(data.cnpj_cpf)}` },
    { key: 'portal', label: 'Abrir no Provisionamento do Portal', icon: <ShieldCheck size={14} aria-hidden="true" />, to: `/clientes/portal?cliente=${data.id}` },
  ]

  return (
    <>
      <Breadcrumb items={[{ label: 'Clientes', to: listHref }, { label: data.name }]} />
      <header className="app-customer-head">
        <div className="app-customer-head__copy">
          <p className="app-customer-head__eyebrow">
            <span>Cliente</span>
            <span aria-hidden="true">·</span>
            <span>CNPJ <span className="tabular-nums">{formatCnpjCpf(data.cnpj_cpf)}</span></span>
            {deactivatedAt ? <Badge tone="neutral">Desativado</Badge> : null}
          </p>
          <h1 className="app-customer-head__title">{data.name}</h1>
          <p className="app-customer-head__context">
            {data.trade_name ? <span>{data.trade_name}</span> : null}
            {place ? <span>{place}</span> : null}
            {primary ? <span>{primary.email}</span> : <span className="app-customer-head__missing">Sem contato principal com e-mail</span>}
            <span>{formatCountLabel(blCount, 'B/L vinculado', 'B/Ls vinculados')}</span>
          </p>
        </div>
        <div className="app-customer-head__actions">
          <ActionMenu
            label="Mais ações do Cliente"
            menuId="customer-header-menu"
            triggerClassName="app-btn app-btn--secondary app-customer-head__more"
            trigger={<><MoreHorizontal size={16} aria-hidden="true" />Mais ações</>}
            items={menu}
          />
        </div>
      </header>

      {deactivatedAt ? (
        <div className="app-customer-banner" role="status">
          <p><strong>Cliente desativado em {formatDate(deactivatedAt)}.</strong> Fora das listas de escolha e sem acesso ao Portal; B/Ls novos com este CNPJ vão para a Revisão. O Administrativo reativa pela lista de Clientes.</p>
          {deactivationReason ? <p className="app-customer-banner__reason">Motivo: {deactivationReason}</p> : null}
        </div>
      ) : null}

      <FichaTabBar
        active={activeTab}
        onSelect={selectTab}
        canReadCeUnlock={canReadCeUnlock}
        counts={{ operacional: { value: blCount, label: formatCountLabel(blCount, 'B/L vinculado', 'B/Ls vinculados') } }}
      />
      <div id={fichaPanelId(activeTab)} role="tabpanel" aria-labelledby={fichaTabId(activeTab)} className="app-customer-panel">
        {activeTab === 'visao-geral' ? <VisaoGeralTab data={data} onNavigateTab={selectTab} /> : null}
        {activeTab === 'cadastro' ? <CadastroContatosTab data={data} cnpj={cnpj!} /> : null}
        {activeTab === 'operacional' ? <OperacionalTab data={data} /> : null}
        {activeTab === 'financeiro' ? <FinanceiroTab data={data} /> : null}
        {activeTab === 'historico' ? <HistoricoTab data={data} /> : null}
        {activeTab === 'desbloqueio-ce' ? <Card><CeUnlockVipCoveragePanel customerId={data.id} manage={can('ce_unlock_manage')} /></Card> : null}
      </div>
    </>
  )
}
