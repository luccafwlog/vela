import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { InlineError, PageHeader } from '../components/ui/Card'
import { Block } from '../components/ui/Block'
import { MetricCard } from '../components/ui/MetricCard'
import { NoValue } from '../components/ui/NoValue'
import { ScheduleWidthPage, ShipScheduleWidget } from '../components/portal/ShipScheduleWidget'
import { usePortalInvoices, usePortalDemurrageInvoices } from '../hooks/usePortalBilling'
import { usePortalOperationBls } from '../hooks/usePortalOperation'
import { countContainersInDemurrage, countContainersWithoutReturn } from '../lib/portalOperationViews'
import { formatBRL, formatCountLabel } from '../lib/utils'
import { formatUsd, portalInvoicesInOpenBalance } from '../lib/portalInvoiceStatus'
import { invoiceNetUsd } from '../services/demurrage/demurragePresentation'
import { usePortalScope } from '../hooks/usePortalScope'
import { portalPath } from '../services/portalScope'
import { fetchAllPortalCeUnlockRequests } from '../services/ceUnlockService'

// Demurrage em aberto: emitida (com ou sem disputa) e o legado `overdue`, como na aba Demurrage.
const OPEN_DEMURRAGE_STATUSES = ['issued', 'overdue']
// Solicitação de Desbloqueio de CE ainda não concluída nem cancelada.
const OPEN_CE_REQUEST_STATES = ['draft', 'submitted', 'in_review', 'changes_requested']

// Atalhos para as seções da Central de Informações (lote 4).
const CONSULTAS = [
  { section: 'taxas', label: 'Taxas Locais' },
  { section: 'devolucao', label: 'Depósitos de devolução' },
  { section: 'demurrage', label: 'Tarifa de Demurrage' },
  { section: 'agentes', label: 'Agentes por porto' },
  { section: 'atendimento', label: 'Contato' },
  { section: 'tracking', label: 'Tracking' },
] as const

export function PortalDashboard() {
  const { data: invoices, isLoading: invLoading, error: invoicesError } = usePortalInvoices()
  const { data: demurrage, isLoading: demLoading, error: demurrageError } = usePortalDemurrageInvoices()
  const { data: operationBls, isLoading: opLoading, error: operationError } = usePortalOperationBls()
  const nav = useNavigate()
  const scope = usePortalScope()
  // Mesma família de chave do Desbloqueio de CE: um comando lá atualiza o cartão aqui.
  const ceRequests = useQuery({
    queryKey: ['ce-unlock', 'requests', { mode: scope.mode, customerId: scope.customerId, authCustomer: scope.overview?.customer_id }, 'all'],
    queryFn: () => fetchAllPortalCeUnlockRequests(scope),
  })

  const openLocal = portalInvoicesInOpenBalance(invoices ?? [])
  const localTotal = openLocal.reduce((sum, i) => sum + (i.balance_brl ?? 0), 0)

  const openDemurrage = (demurrage ?? []).filter((i) => OPEN_DEMURRAGE_STATUSES.includes(i.status ?? 'issued'))
  // F-54: US$ líquido do desconto, o mesmo que gera o R$ ao lado.
  const demurrageUsd = openDemurrage.reduce((sum, i) => sum + invoiceNetUsd(i).netUsd, 0)
  const demurrageBrl = openDemurrage.reduce((sum, i) => sum + Number(i.current_total_brl ?? 0), 0)

  const containersNoReturn = countContainersWithoutReturn(operationBls ?? [])
  const containersDemurrage = countContainersInDemurrage(operationBls ?? [])

  const openRequests = (ceRequests.data ?? []).filter((request) => OPEN_CE_REQUEST_STATES.includes(request.state))
  const correctionRequests = openRequests.filter((request) => request.state === 'changes_requested').length

  const loading = invLoading || demLoading || opLoading
  // Releitura que falha (Atualizar de Chegadas e saídas, foco da janela) não
  // apaga os cartões: o React Query mantém a última leitura junto do erro, e o
  // aviso só toma o lugar deles quando não há leitura nenhuma.
  const financialError = Boolean((invoicesError && !invoices) || (demurrageError && !demurrage))
  const operationLoadError = Boolean(operationError && !operationBls)

  return (
    <ScheduleWidthPage>
      <PageHeader title="Painel" />

      {loading ? (
        <div className="text-sm text-[var(--app-muted)]">Carregando indicadores...</div>
      ) : financialError ? (
        <InlineError message="Falha ao carregar indicadores financeiros. Tente novamente em instantes." />
      ) : operationLoadError ? (
        <InlineError message="Falha ao carregar indicadores operacionais. Tente novamente em instantes." />
      ) : (
        <div className="app-metric-row" role="group" aria-label="Resumo">
          <MetricCard
            label="Taxas Locais em aberto"
            value={formatBRL(localTotal)}
            detail={formatCountLabel(openLocal.length, 'fatura', 'faturas')}
            tone={localTotal > 0 ? 'warning' : 'secondary'}
            onSelect={() => nav(portalPath(scope, '/billing?tab=local'))}
          />
          <MetricCard
            label="Demurrage em aberto"
            value={formatUsd(demurrageUsd)}
            detail={`${formatCountLabel(openDemurrage.length, 'fatura', 'faturas')} · ${formatBRL(demurrageBrl)} hoje`}
            tone={demurrageUsd > 0 ? 'warning' : 'secondary'}
            onSelect={() => nav(portalPath(scope, '/billing?tab=demurrage'))}
          />
          <MetricCard
            label="Containers sem devolução"
            value={String(containersNoReturn)}
            detail={`${containersDemurrage} já em demurrage`}
            tone={containersNoReturn > 0 ? 'warning' : 'secondary'}
            onSelect={() => nav(portalPath(scope, '/operacao?tab=containers&devolucao=sem_devolucao'))}
          />
          <MetricCard
            label="Desbloqueio de CE em aberto"
            value={ceRequests.isError ? <NoValue label="Não foi possível carregar as solicitações" /> : ceRequests.isLoading ? <NoValue label="Carregando" /> : formatCountLabel(openRequests.length, 'solicitação', 'solicitações')}
            detail={ceRequests.isError ? 'Não foi possível carregar.' : ceRequests.data && openRequests.length > 0 ? correctionLabel(correctionRequests) : null}
            onSelect={() => nav(portalPath(scope, '/desbloqueio-ce?aba=solicitacoes'))}
          />
        </div>
      )}

      <ShipScheduleWidget className="mt-6" />

      <Block title="Consultas" aside="Central de Informações" className="mt-6">
        <nav aria-label="Consultas na Central de Informações" className="flex flex-wrap gap-2">
          {CONSULTAS.map((item) => (
            <Link key={item.section} to={portalPath(scope, `/informacoes/${item.section}`)} className="app-btn app-btn--secondary">
              {item.label}
            </Link>
          ))}
        </nav>
      </Block>
    </ScheduleWidthPage>
  )
}

function correctionLabel(count: number) {
  if (count === 0) return 'nenhuma pede correção'
  return `${count} ${count === 1 ? 'pede' : 'pedem'} correção`
}
