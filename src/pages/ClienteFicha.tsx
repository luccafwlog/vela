import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileStack, MoreHorizontal, Power, ReceiptText, ShieldCheck } from 'lucide-react'
import { useToast } from '../components/ui/Toast'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { deactivateCustomer, reactivateCustomer } from '../services/customers'
import { afterClienteAtivacaoAlterada } from '../services/cacheEffects'
import { CeUnlockVipCoveragePanel } from '../components/ce-unlock/CeUnlockVipCoveragePanel'
import { useAuth } from '../hooks/useAuth'
import { ActionMenu, type ActionMenuItem } from '../components/ui/ActionMenu'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { CopyValue } from '../components/ui/CopyValue'
import { NoValue } from '../components/ui/NoValue'
import { IdentityBand } from '../components/ui/IdentityBand'
import { useCustomerDetail } from '../hooks/useCustomers'
import { buildCustomerBillingUrl } from '../lib/customerTableViewModel'
import { userFacingErrorMessage } from '../lib/errors'
import { formatCnpjCpf, formatCountLabel, formatDate } from '../lib/utils'
import { FichaTabBar, fichaPanelId, fichaTabId, resolveFichaTab, type FichaTabId } from '../components/clientes/FichaTabs'
import { CadastroContatosTab } from '../components/clientes/CadastroContatosTab'
import { VisaoGeralTab } from '../components/clientes/VisaoGeralTab'
import { BlsTab } from '../components/clientes/BlsTab'
import { ConteineresTab } from '../components/clientes/ConteineresTab'
import { CeUnlockRequestsBlock } from '../components/clientes/CeUnlockRequestsBlock'
import { FinanceiroTab } from '../components/clientes/FinanceiroTab'
import { HistoricoTab } from '../components/clientes/HistoricoTab'
import { clientesListHref } from './clientesListState'

type Deactivation = { deactivated_at?: string | null; deactivation_reason?: string | null }

export function ClienteFicha() {
  const { can, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
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
  const place = [data.city, data.state].filter(Boolean).join('/')
  const blCount = data.bls?.length ?? 0
  // E-mail do contato principal ativo, o mesmo do bloco Contato principal da Visão geral.
  const primaryEmail = data.customer_contacts?.find((contact) => contact.is_primary && !contact.deactivated_at && Boolean(contact.email?.trim()))?.email ?? null

  // Desativar e Reativar ficam só aqui desde o lote 2 (2026-10-16); a lista não tem mais o menu ⋮.
  async function handleToggleCustomerActive(id: number, deactivated: boolean) {
    try {
      if (!deactivated) {
        const preview = await deactivateCustomer(id, '', { dryRun: true })
        if (preview.reasons.length > 0) {
          showToast(`O cliente não pode ser desativado: ${preview.reasons.join(', ')}. O Financeiro quita ou cancela antes.`, 'error')
          return
        }
      }
      const reason = await confirmWithReason(deactivated ? {
        title: 'Reativar cliente',
        message: 'Reativar este cliente?',
        consequence: 'O cliente volta às listas de escolha, recupera o acesso ao Portal e pode ser vinculado de novo a B/Ls.',
        reversibility: 'Desative de novo se precisar.',
        confirmLabel: 'Reativar cliente',
        tone: 'primary',
      } : {
        title: 'Desativar cliente',
        message: 'Desativar este cliente?',
        consequence: 'O cliente sai das listas de escolha e perde o acesso ao Portal. B/Ls novos com o CNPJ dele vão para a Revisão. O histórico, as faturas e os B/Ls antigos continuam com ele.',
        reversibility: 'Reativar cliente, pelo Administrativo, com motivo.',
        confirmLabel: 'Desativar cliente',
        tone: 'danger',
      })
      if (reason === null) return
      if (deactivated) {
        await reactivateCustomer(id, reason)
      } else {
        const result = await deactivateCustomer(id, reason)
        if (!result.deactivated) {
          showToast(`O cliente não foi desativado: ${result.reasons.join(', ')}.`, 'error')
          return
        }
      }
      await afterClienteAtivacaoAlterada(queryClient)
      showToast(deactivated ? 'Cliente reativado.' : 'Cliente desativado.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao alterar o cliente.', 'error')
    }
  }

  const menu: ActionMenuItem[] = [
    { key: 'faturas', label: 'Ver faturas em Taxas Locais', icon: <ReceiptText size={14} aria-hidden="true" />, to: buildCustomerBillingUrl(data) },
    { key: 'bls', label: 'Ver os B/Ls na lista de BLs', icon: <FileStack size={14} aria-hidden="true" />, to: `/bls?q=${encodeURIComponent(data.cnpj_cpf)}` },
    { key: 'portal', label: 'Abrir no Provisionamento do Portal', icon: <ShieldCheck size={14} aria-hidden="true" />, to: `/clientes/portal?cliente=${data.id}` },
    ...(isAdmin ? [{
      key: 'ativo',
      label: deactivatedAt ? 'Reativar cliente' : 'Desativar cliente',
      icon: <Power size={14} aria-hidden="true" />,
      danger: !deactivatedAt,
      onSelect: () => void handleToggleCustomerActive(data.id, Boolean(deactivatedAt)),
    }] : []),
  ]

  return (
    <>
      <Breadcrumb items={[{ label: 'Clientes', to: listHref }, { label: data.name }]} />
      <IdentityBand
        kind="Cliente"
        title={data.name}
        titleAside={deactivatedAt ? <Badge tone="neutral">Desativado</Badge> : null}
        facts={[
          { label: 'CNPJ', value: data.cnpj_cpf ? <span className="tabular-nums"><CopyValue value={formatCnpjCpf(data.cnpj_cpf)} label="CNPJ/CPF" /></span> : <NoValue label="Sem CNPJ/CPF" /> },
          ...(data.trade_name ? [{ label: 'Nome fantasia', value: data.trade_name }] : []),
          ...(place ? [{ label: 'Cidade', value: place }] : []),
          { label: 'E-mail', value: primaryEmail ?? <NoValue label="Sem e-mail do contato principal" /> },
          { label: 'B/Ls vinculados', value: blCount.toLocaleString('pt-BR') },
        ]}
        actions={(
          <ActionMenu
            label="Mais ações do Cliente"
            menuId="customer-header-menu"
            triggerClassName="app-btn app-btn--ghost"
            trigger={<><MoreHorizontal size={16} aria-hidden="true" />Mais ações</>}
            items={menu}
          />
        )}
      />

      {deactivatedAt ? (
        <div className="app-customer-banner" role="status">
          <p><strong>Cliente desativado em {formatDate(deactivatedAt)}.</strong> Fora das listas de escolha e sem acesso ao Portal; B/Ls novos com este CNPJ vão para a Revisão. O Administrativo reativa em Mais ações, nesta ficha.</p>
          {deactivationReason ? <p className="app-customer-banner__reason">Motivo: {deactivationReason}</p> : null}
        </div>
      ) : null}

      <FichaTabBar
        active={activeTab}
        onSelect={selectTab}
        canReadCeUnlock={canReadCeUnlock}
        counts={{ bls: { value: blCount, label: formatCountLabel(blCount, 'B/L vinculado', 'B/Ls vinculados') } }}
      />
      <div id={fichaPanelId(activeTab)} role="tabpanel" aria-labelledby={fichaTabId(activeTab)} className="app-customer-panel">
        {activeTab === 'visao-geral' ? <VisaoGeralTab data={data} onNavigateTab={selectTab} /> : null}
        {activeTab === 'cadastro' ? <CadastroContatosTab data={data} cnpj={cnpj!} /> : null}
        {activeTab === 'bls' ? <BlsTab data={data} /> : null}
        {activeTab === 'conteineres' ? <ConteineresTab data={data} /> : null}
        {activeTab === 'financeiro' ? <FinanceiroTab data={data} /> : null}
        {activeTab === 'historico' ? <HistoricoTab data={data} /> : null}
        {activeTab === 'desbloqueio-ce' ? (
          <div className="grid gap-4">
            <CeUnlockRequestsBlock customerId={data.id} manage={can('ce_unlock_manage')} />
            <CeUnlockVipCoveragePanel customerId={data.id} manage={can('ce_unlock_manage')} />
          </div>
        ) : null}
      </div>
    </>
  )
}
