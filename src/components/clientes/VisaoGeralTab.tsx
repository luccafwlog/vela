import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { useBillingPortalRelease } from '../../hooks/useBillingPortalRelease'
import { accountSituationLabel, isPortalReadyForBilling } from '../../lib/portalProvisioningViewModel'
import { useCustomerDemurrageInvoices, useCustomerPendingReconciliation, useCustomerRunningDemurrage, useCustomerTimeline } from '../../hooks/useCustomerFicha'
import { billingPortalReleaseState } from '../../services/billingPortalRelease'
import { buildConsolidatedBalance } from '../../services/customerFicha'
import { formatBRL, formatCountLabel, formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import type { FichaTabId } from './FichaTabs'
import { buildFichaOverview, type OverviewAction, type OverviewItem } from './fichaOverview'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
type VisaoGeralTabProps = { data: Data; onNavigateTab: (tab: FichaTabId) => void }

/**
 * Valor da consulta: `undefined` carregando, `null` falhou. Sucesso sem linha
 * (Cliente sem registro do Portal, `select` devolve `undefined`) é resposta.
 */
function sourceOf<T>(query: { data?: T; isLoading?: boolean; isError?: boolean; isSuccess?: boolean }, map: (value: T) => unknown) {
  if (query.isError) return null
  if (!(query.isSuccess ?? !query.isLoading)) return undefined
  return map(query.data as T)
}

export function VisaoGeralTab({ data, onNavigateTab }: VisaoGeralTabProps) {
  const portalQuery = usePortalProvisioningForCustomer(data.id)
  const releaseQuery = useBillingPortalRelease(data.id)
  const demurrageQuery = useCustomerDemurrageInvoices(data.id)
  const reconciliationQuery = useCustomerPendingReconciliation(data.id)
  const runningQuery = useCustomerRunningDemurrage(data.id)
  const timelineQuery = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])

  const financialDenied = data.invoices_access_denied || (demurrageQuery.data?.denied ?? false)
  const canonicalData = data as Data & { pending_balance_local?: number; pending_balance_demurrage?: number; pending_balance?: number }
  const legacyBalance = buildConsolidatedBalance(data.invoices ?? [], demurrageQuery.data?.rows ?? [])
  const balance = canonicalData.pending_balance_local == null
    ? legacyBalance
    : { localBrl: canonicalData.pending_balance_local, demurrageBrl: canonicalData.pending_balance_demurrage ?? 0, totalBrl: canonicalData.pending_balance ?? 0 }
  const primaryContact = data.customer_contacts?.find(
    (contact) => contact.is_primary && !contact.deactivated_at && Boolean(contact.email?.trim()),
  )
  const today = new Date().toISOString().slice(0, 10)
  const portalRow = portalQuery.data ?? null
  const release = releaseQuery.data ?? null
  const releaseState = release ? billingPortalReleaseState(release) : null

  const overview = buildFichaOverview({
    customerId: data.id,
    customerName: data.name,
    portal: sourceOf(portalQuery, (row) => row ?? false) as never,
    releaseUntil: sourceOf(releaseQuery, (value) => (value && billingPortalReleaseState(value) === 'vigente' ? value.review_at : false)) as string | false | null | undefined,
    blsInReview: (data.bls ?? []).filter((bl) => bl.review_status === 'pending_review').length,
    hasPrimaryEmail: Boolean(primaryContact),
    pendingReconciliation: sourceOf(reconciliationQuery, (rows) => (rows ?? []).length) as number | null | undefined,
    demurrage: financialDenied
      ? false
      : sourceOf(demurrageQuery, (value) => ({
          // Taxa local não tem vencimento praticado (issue #605): só o Demurrage vence.
          overdue: (value?.rows ?? []).filter((invoice) => invoice.status === 'overdue' || (invoice.status === 'issued' && invoice.due_date && invoice.due_date < today)).length,
          disputes: (value?.rows ?? []).filter((invoice) => invoice.dispute_open || invoice.dispute_status === 'aberto').length,
        })) as { overdue: number; disputes: number } | null | undefined,
    runningDemurrage: sourceOf(runningQuery, (rows) => (rows ?? []).length) as number | null | undefined,
  })

  function retryFailed() {
    if (portalQuery.isError) void portalQuery.refetch()
    if (releaseQuery.isError) void releaseQuery.refetch()
    if (demurrageQuery.isError) void demurrageQuery.refetch()
    if (reconciliationQuery.isError) void reconciliationQuery.refetch()
    if (runningQuery.isError) void runningQuery.refetch()
  }

  const money = (value: number) => (financialDenied
    ? 'Restrito'
    : demurrageQuery.isLoading
      ? 'Carregando…'
      : demurrageQuery.isError
        ? 'Erro ao carregar'
        : formatBRL(value))

  return (
    <div className="app-customer-overview">
      <Card className="app-customer-sheet">
        <div className="app-customer-sheet__columns">
          <section className="app-customer-sheet__section" aria-labelledby="ficha-pendencias">
            <div className="app-customer-section-head">
              <h2 id="ficha-pendencias" className="app-customer-section-title">
                Pendências
                {overview.items.length ? <span className="app-customer-section-count">{overview.items.length}</span> : null}
              </h2>
            </div>
            <PendencyList items={overview.items} onNavigateTab={onNavigateTab} />
            {overview.loading.length ? (
              <p className="app-customer-muted" role="status">Verificando: {overview.loading.join(', ')}…</p>
            ) : null}
            {overview.failed.length ? (
              <div className="app-customer-notice app-customer-notice--danger" role="alert">
                <span>Não foi possível verificar: {overview.failed.join(', ')}. A lista acima pode estar incompleta.</span>
                <Button variant="secondary" className="app-btn--sm" onClick={retryFailed}>Tentar novamente</Button>
              </div>
            ) : null}
            {!overview.items.length && !overview.loading.length && !overview.failed.length ? (
              <p className="app-customer-clear"><CheckCircle2 size={16} aria-hidden="true" />Nenhuma pendência aberta.</p>
            ) : null}
          </section>

          <section className="app-customer-sheet__section app-customer-sheet__aside" aria-labelledby="ficha-saldo">
            <h2 id="ficha-saldo" className="app-customer-section-title">Saldo pendente</h2>
            <p className="app-customer-balance">{money(balance.totalBrl)}</p>
            <dl className="app-customer-facts app-customer-facts--rows">
              <div><dt>Taxas Locais</dt><dd className="app-customer-money">{money(balance.localBrl)}</dd></div>
              <div><dt>Demurrage</dt><dd className="app-customer-money">{money(balance.demurrageBrl)}</dd></div>
            </dl>
            <button type="button" className="app-customer-text-link" onClick={() => onNavigateTab('financeiro')}>
              Faturas e recebíveis na aba Financeiro <ArrowRight size={14} aria-hidden="true" />
            </button>

            <h2 className="app-customer-section-title app-customer-section-title--ruled">Situação</h2>
            <dl className="app-customer-facts app-customer-facts--rows">
              <div>
                <dt>Conta de Portal</dt>
                <dd>{portalQuery.isLoading ? 'Carregando…' : portalQuery.isError ? 'Erro ao carregar' : portalRow ? accountSituationLabel(portalRow.account_situation) : 'Sem registro'}</dd>
              </div>
              {portalRow && !isPortalReadyForBilling(portalRow) ? (
                <div>
                  <dt>Liberação sem Portal</dt>
                  <dd>
                    {releaseQuery.isLoading ? 'Carregando…'
                      : releaseQuery.isError ? 'Erro ao carregar'
                      : releaseState === 'vigente' ? `Vigente até ${formatDate(release!.review_at)}`
                      : releaseState === 'vencida' ? `Vencida em ${formatDate(release!.review_at)}`
                      : releaseState === 'revogada' ? 'Revogada'
                      : 'Não concedida'}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Contato principal</dt>
                <dd>{primaryContact ? <><span>{primaryContact.name ?? '—'}</span><span className="app-customer-facts__sub">{primaryContact.email}</span></> : <span className="app-customer-note app-customer-note--warning">Sem e-mail</span>}</dd>
              </div>
              <div>
                <dt>B/Ls vinculados</dt>
                <dd>
                  <button type="button" className="app-customer-text-link" onClick={() => onNavigateTab('operacional')}>
                    {formatCountLabel(data.bls?.length ?? 0, 'B/L', 'B/Ls')} <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </Card>

      <Card className="app-customer-sheet">
        <div className="app-customer-section-head">
          <h2 className="app-customer-section-title">Atividade recente</h2>
          <button type="button" className="app-customer-text-link" onClick={() => onNavigateTab('historico')}>
            Histórico completo <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
        {timelineQuery.isLoading ? <p className="app-customer-muted" role="status">Carregando atividade…</p>
          : timelineQuery.isError ? (
            <div className="app-customer-notice app-customer-notice--danger" role="alert">
              <span>Não foi possível carregar a atividade.</span>
              <Button variant="secondary" className="app-btn--sm" onClick={() => void timelineQuery.refetch()}>Tentar novamente</Button>
            </div>
          )
          : (timelineQuery.data ?? []).length === 0 ? <p className="app-customer-muted">Sem eventos registrados.</p>
          : (
            <ol className="app-customer-timeline app-customer-timeline--compact">
              {timelineQuery.data!.slice(0, 5).map((event) => (
                <li key={`${event.kind}-${event.sourceId}`} className="app-customer-timeline__item">
                  <time className="app-customer-timeline__date" dateTime={event.at}>{formatDate(event.at)}</time>
                  <span className="app-customer-timeline__body">
                    {event.link ? <Link className="app-customer-link" to={event.link}>{event.label}</Link> : <span>{event.label}</span>}
                    {event.actorId ? <span className="app-customer-timeline__meta">por {event.actorId}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
      </Card>
    </div>
  )
}

function PendencyList({ items, onNavigateTab }: { items: OverviewItem[]; onNavigateTab: (tab: FichaTabId) => void }) {
  if (!items.length) return null
  return (
    <ul className="app-customer-pendencies">
      {items.map((item) => (
        <li key={item.key} className={`app-customer-pendency app-customer-pendency--${item.tone}`}>
          <span className="app-customer-pendency__dot" aria-hidden="true" />
          <div className="app-customer-pendency__body">
            <p className="app-customer-pendency__title">
              <span className="sr-only">{item.tone === 'danger' ? 'Urgente: ' : item.tone === 'warning' ? 'Atenção: ' : 'Informação: '}</span>
              {item.title}
            </p>
            {item.detail ? <p className="app-customer-pendency__detail">{item.detail}</p> : null}
            <div className="app-customer-pendency__actions">
              {item.actions.map((action) => <PendencyAction key={action.label} action={action} onNavigateTab={onNavigateTab} />)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function PendencyAction({ action, onNavigateTab }: { action: OverviewAction; onNavigateTab: (tab: FichaTabId) => void }) {
  if ('to' in action) {
    return <Link className="app-customer-text-link" to={action.to}>{action.label} <ArrowRight size={14} aria-hidden="true" /></Link>
  }
  return (
    <button type="button" className="app-customer-text-link" onClick={() => onNavigateTab(action.tab)}>
      {action.label} <ArrowRight size={14} aria-hidden="true" />
    </button>
  )
}
