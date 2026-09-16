import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { accountSituationLabel, hasPortalPendency } from '../../lib/portalProvisioningViewModel'
import { useCustomerDemurrageInvoices, useCustomerPendingReconciliation, useCustomerRunningDemurrage, useCustomerTimeline } from '../../hooks/useCustomerFicha'
import { buildConsolidatedBalance } from '../../services/customerFicha'
import { formatBRL, formatCnpjCpf, formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import type { FichaTabId } from './FichaTabs'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
type VisaoGeralTabProps = { data: Data; onNavigateTab: (tab: FichaTabId) => void }

export function VisaoGeralTab({ data, onNavigateTab }: VisaoGeralTabProps) {
  const { data: portalRow, isLoading: portalLoading, isError: portalError } = usePortalProvisioningForCustomer(data.id)
  const { data: demurrage, isLoading: demurrageLoading, isError: demurrageError } = useCustomerDemurrageInvoices(data.id)
  const { data: pendingReconciliation, isLoading: reconciliationLoading, isError: reconciliationError } = useCustomerPendingReconciliation(data.id)
  const { data: runningDemurrage, isLoading: runningDemurrageLoading, isError: runningDemurrageError } = useCustomerRunningDemurrage(data.id)
  const { data: timeline, isLoading: timelineLoading, isError: timelineError } = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])

  const financialDenied = data.invoices_access_denied || (demurrage?.denied ?? false)
  const balance = buildConsolidatedBalance(data.invoices ?? [], demurrage?.rows ?? [])
  const primaryContact = data.customer_contacts?.find(
    (contact) => contact.is_primary && !contact.deactivated_at && Boolean(contact.email?.trim()),
  )
  const today = new Date().toISOString().slice(0, 10)
  // Taxa local não tem vencimento praticado (issue #605): só o Demurrage vence.
  const overdueDemurrage = (demurrage?.rows ?? []).filter((invoice) => invoice.status === 'overdue' || (invoice.status === 'issued' && invoice.due_date && invoice.due_date < today))
  const openDisputes = (demurrage?.rows ?? []).filter((invoice) => invoice.dispute_open || invoice.dispute_status === 'aberto')

  const pendenciasLoading = portalLoading || demurrageLoading || reconciliationLoading || runningDemurrageLoading
  const pendenciasError = portalError || demurrageError || reconciliationError || runningDemurrageError

  const pendencias: Array<{ key: string; label: string; onClick?: () => void; to?: string }> = []
  if (!pendenciasLoading && !pendenciasError) {
    if ((pendingReconciliation?.length ?? 0) > 0) {
      pendencias.push({ key: 'reconciliacao', label: `${pendingReconciliation!.length} ${pendingReconciliation!.length === 1 ? 'B/L com reconciliação de cliente pendente' : 'B/Ls com reconciliação de cliente pendente'}`, onClick: () => onNavigateTab('operacional') })
    }
    if (hasPortalPendency(portalRow) || portalRow?.hasCriticalAlert) {
      const portalBlCount = portalRow?.hasActiveProcess && portalRow.account_situation !== 'ativo'
        ? (data.bls ?? []).filter((bl) => bl.financial_status !== 'cancelled').length
        : 0
      pendencias.push({ key: 'portal', label: portalRow?.hasCriticalAlert ? `Pendência crítica de Portal${portalBlCount ? ` (${portalBlCount} B/L${portalBlCount === 1 ? '' : 's'})` : ''}` : `Portal não ativo${portalRow?.account_situation ? `: ${accountSituationLabel(portalRow.account_situation)}` : ''}`, to: `/clientes/portal?cliente=${data.id}` })
    }
    if (!financialDenied && overdueDemurrage.length > 0) {
      pendencias.push({ key: 'vencidas', label: `${overdueDemurrage.length} ${overdueDemurrage.length === 1 ? 'invoice de Demurrage vencida' : 'invoices de Demurrage vencidas'}`, onClick: () => onNavigateTab('financeiro') })
    }
    if (!financialDenied && openDisputes.length > 0) {
      pendencias.push({ key: 'disputas', label: `${openDisputes.length} ${openDisputes.length === 1 ? 'disputa de demurrage aberta' : 'disputas de demurrage abertas'}`, onClick: () => onNavigateTab('financeiro') })
    }
    if ((runningDemurrage?.length ?? 0) > 0) {
      pendencias.push({ key: 'correndo', label: `${runningDemurrage!.length} ${runningDemurrage!.length === 1 ? 'container com demurrage correndo' : 'containers com demurrage correndo'}`, to: '/demurrage' })
    }
  }

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Saldo pendente (local + demurrage)" value={financialDenied ? 'Restrito' : formatBRL(balance.totalBrl)} tone="primary" />
        <MetricCard label="Local" value={financialDenied ? '—' : formatBRL(balance.localBrl)} />
        <MetricCard label="Demurrage" value={financialDenied ? '—' : formatBRL(balance.demurrageBrl)} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Identidade</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">CNPJ</dt><dd>{formatCnpjCpf(data.cnpj_cpf)}</dd></div>
            <div><dt className="text-xs text-slate-500">Cidade/UF</dt><dd>{[data.city, data.state].filter(Boolean).join(' / ') || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Contato principal</dt><dd>{primaryContact ? `${primaryContact.name ?? '—'} · ${primaryContact.email ?? primaryContact.phone ?? '—'}` : 'Configuração pendente'}</dd></div>
            <div><dt className="text-xs text-slate-500">Portal</dt><dd>{portalRow ? accountSituationLabel(portalRow.account_situation) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">B/Ls vinculados</dt><dd>{data.bls?.length ?? 0}</dd></div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Pendências</h2>
          {pendenciasLoading ? <div className="text-sm text-slate-400">Verificando pendências…</div>
            : pendenciasError ? <div className="text-sm text-red-300">Erro ao carregar pendências.</div>
            : pendencias.length === 0 ? <div className="text-sm text-slate-400">Nenhuma pendência aberta.</div>
            : <ul className="grid gap-2 text-sm">{pendencias.map((item) => <li key={item.key} className="rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-amber-100">{item.to ? <Link className="hover:underline" to={item.to}>{item.label} →</Link> : <button type="button" className="text-left hover:underline" onClick={item.onClick}>{item.label} →</button>}</li>)}</ul>}
        </Card>
      </div>
      <Card className="mt-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Atividade recente</h2>
        {timelineLoading ? <div className="text-sm text-slate-400">Carregando atividade…</div>
          : timelineError ? <div className="text-sm text-red-300">Erro ao carregar atividade.</div>
          : (timeline ?? []).length === 0 ? <div className="text-sm text-slate-400">Sem eventos registrados.</div>
          : <ul className="grid gap-2 text-sm">{timeline!.slice(0, 5).map((event) => <li key={`${event.kind}-${event.sourceId}`} className="flex items-baseline gap-3"><span className="shrink-0 text-xs text-slate-500">{formatDate(event.at)}</span><span>{event.link ? <Link className="hover:underline" to={event.link}>{event.label}</Link> : event.label}</span></li>)}</ul>}
      </Card>
    </>
  )
}
