import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { StatusText } from '../ui/StatusText'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { useBillingPortalRelease } from '../../hooks/useBillingPortalRelease'
import { useAuth } from '../../hooks/useAuth'
import { accountSituationLabel, hasPortalPendency } from '../../lib/portalProvisioningViewModel'
import { useCustomerDemurrageInvoices, useCustomerPendingReconciliation, useCustomerRunningDemurrage, useCustomerTimeline } from '../../hooks/useCustomerFicha'
import { billingPortalReleaseState } from '../../services/billingPortalRelease'
import { buildConsolidatedBalance } from '../../services/customerFicha'
import { formatBRL, formatCountLabel, formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import type { FichaTabId } from './FichaTabs'
import { buildFichaOverview, portalLooksReadyForBilling, RECOVERY_EMAIL_READER_ROLES, type OverviewAction, type OverviewBlock, type OverviewItem } from './fichaOverview'

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
  const { effectiveRole } = useAuth()
  const recoveryEmailVisible = RECOVERY_EMAIL_READER_ROLES.includes(effectiveRole ?? '')
  const portalQuery = usePortalProvisioningForCustomer(data.id)
  const releaseQuery = useBillingPortalRelease(data.id)
  const demurrageQuery = useCustomerDemurrageInvoices(data.id)
  const reconciliationQuery = useCustomerPendingReconciliation(data.id)
  const runningQuery = useCustomerRunningDemurrage(data.id)
  const timelineQuery = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])

  const financialDenied = data.invoices_access_denied || (demurrageQuery.data?.denied ?? false)
  const canonicalData = data as Data & {
    pending_balance_local?: number; pending_balance_demurrage?: number; pending_balance?: number
    pending_balance_manual?: number; pending_balance_invoiced_open?: number; pending_balance_to_invoice?: number
  }
  const legacyBalance = buildConsolidatedBalance(data.invoices ?? [], demurrageQuery.data?.rows ?? [])
  // Saldo do Vela (ADR 0093, decisões 10 e 11; migration 371): faturado em
  // aberto + a faturar; a avulsa aberta numa linha própria.
  const balance = canonicalData.pending_balance_local == null
    ? { ...legacyBalance, manualBrl: null, invoicedOpenBrl: null, toInvoiceBrl: null }
    : {
        localBrl: canonicalData.pending_balance_local,
        demurrageBrl: canonicalData.pending_balance_demurrage ?? 0,
        manualBrl: canonicalData.pending_balance_manual ?? 0,
        invoicedOpenBrl: canonicalData.pending_balance_invoiced_open ?? 0,
        toInvoiceBrl: canonicalData.pending_balance_to_invoice ?? 0,
        totalBrl: canonicalData.pending_balance ?? 0,
      }
  const primaryContact = data.customer_contacts?.find(
    (contact) => contact.is_primary && !contact.deactivated_at && Boolean(contact.email?.trim()),
  )
  const portalRow = portalQuery.data ?? null
  const release = releaseQuery.data ?? null
  const releaseState = release ? billingPortalReleaseState(release) : null

  const overview = buildFichaOverview({
    customerId: data.id,
    customerName: data.name,
    customerDocument: data.cnpj_cpf,
    portal: sourceOf(portalQuery, (row) => row ?? false) as never,
    recoveryEmailVisible,
    releaseUntil: sourceOf(releaseQuery, (value) => (value && billingPortalReleaseState(value) === 'vigente' ? value.review_at : false)) as string | false | null | undefined,
    blsInReview: (data.bls ?? []).filter((bl) => bl.review_status === 'pending_review').length,
    hasPrimaryEmail: Boolean(primaryContact),
    pendingReconciliation: sourceOf(reconciliationQuery, (rows) => (rows ?? []).length) as number | null | undefined,
    demurrage: financialDenied
      ? false
      : sourceOf(demurrageQuery, (value) => ({
          disputes: (value?.rows ?? []).filter((invoice) => invoice.dispute_open || invoice.dispute_status === 'aberto').length,
        })) as { disputes: number } | null | undefined,
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

  const itemsOf = (block: OverviewBlock) => overview.items.filter((item) => item.block === block)
  const portalItems = itemsOf('portal')
  const blItems = itemsOf('bls')
  const portalRetained = portalItems.some((item) => item.tone !== 'info')
  const portalSituation = portalQuery.isLoading ? 'Carregando…' : portalQuery.isError ? 'Erro ao carregar' : portalRow ? accountSituationLabel(portalRow.account_situation) : 'Sem conta'
  const recent = (timelineQuery.data ?? []).slice(0, 5)

  return (
    <div className="grid gap-4">
      {overview.loading.length ? (
        <p className="app-facts__detail" role="status">Verificando: {overview.loading.join(', ')}…</p>
      ) : null}
      {overview.failed.length ? (
        <div className="app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível verificar: {overview.failed.join(', ')}. As pendências abaixo podem estar incompletas.</span>
          <Button variant="secondary" className="app-btn--sm" onClick={retryFailed}>Tentar novamente</Button>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Block title="Saldo pendente">
          <LeadValue detail="Saldo pendente total">{money(balance.totalBrl)}</LeadValue>
          <FactList>
            {balance.invoicedOpenBrl != null ? <Fact label="Faturado em aberto">{money(balance.invoicedOpenBrl)}</Fact> : null}
            {balance.toInvoiceBrl != null ? <Fact label="A faturar">{money(balance.toInvoiceBrl)}</Fact> : null}
            <Fact label="Taxas Locais">{money(balance.localBrl)}</Fact>
            <Fact label="Demurrage">{money(balance.demurrageBrl)}</Fact>
            {balance.manualBrl != null ? <Fact label="Fatura avulsa">{money(balance.manualBrl)}</Fact> : null}
          </FactList>
          <Pendencies items={itemsOf('saldo')} onNavigateTab={onNavigateTab} />
          <div>
            <Button variant="secondary" className="app-btn--sm" onClick={() => onNavigateTab('financeiro')}>
              Faturas e recebíveis na aba Financeiro <ArrowRight size={14} aria-hidden="true" />
            </Button>
          </div>
        </Block>

        <Block title="Portal" aside={portalRetained ? <StatusText tone="warning">Faturas retidas</StatusText> : null}>
          <LeadValue tone={portalRetained ? 'warning' : 'default'} detail="Conta de Portal">{portalSituation}</LeadValue>
          {portalQuery.isSuccess && (!portalRow || !portalLooksReadyForBilling(portalRow, recoveryEmailVisible)) ? (
            <FactList columns={1}>
              <Fact label="Liberação sem Portal">
                {releaseQuery.isLoading ? 'Carregando…'
                  : releaseQuery.isError ? 'Erro ao carregar'
                  : releaseState === 'vigente' ? `Vigente até ${formatDate(release!.review_at)}`
                  : releaseState === 'vencida' ? `Vencida em ${formatDate(release!.review_at)}`
                  : releaseState === 'revogada' ? 'Revogada'
                  : 'Não concedida'}
              </Fact>
            </FactList>
          ) : null}
          {/* Conta não ativa: o dado principal já diz a situação; fica o motivo e os caminhos. */}
          <Pendencies items={portalItems} onNavigateTab={onNavigateTab} hideTitle={portalRow ? hasPortalPendency(portalRow) : portalQuery.isSuccess} />
        </Block>

        <Block title="Contato principal">
          {primaryContact ? (
            <LeadValue detail={primaryContact.email}>{primaryContact.name ?? <NoValue label="Contato sem nome" />}</LeadValue>
          ) : (
            <LeadValue tone="warning">Sem e-mail</LeadValue>
          )}
          <Pendencies items={itemsOf('contato')} onNavigateTab={onNavigateTab} />
        </Block>

        {blItems.length ? (
          <Block title="B/Ls">
            <LeadValue detail="vinculados">{formatCountLabel(data.bls?.length ?? 0, 'B/L', 'B/Ls')}</LeadValue>
            <Pendencies items={blItems} onNavigateTab={onNavigateTab} />
          </Block>
        ) : null}
      </div>

      <Block
        title="Atividade recente"
        flush
        aside={(
          <Button variant="secondary" className="app-btn--sm" onClick={() => onNavigateTab('historico')}>
            Histórico completo <ArrowRight size={14} aria-hidden="true" />
          </Button>
        )}
      >
        {timelineQuery.isLoading ? <p className="app-block__body app-facts__detail" role="status">Carregando atividade…</p>
          : timelineQuery.isError ? (
            <div className="app-block__body app-customer-notice app-customer-notice--danger" role="alert">
              <span>Não foi possível carregar a atividade.</span>
              <Button variant="secondary" className="app-btn--sm" onClick={() => void timelineQuery.refetch()}>Tentar novamente</Button>
            </div>
          )
          : recent.length === 0 ? <p className="app-block__body app-facts__detail">Sem eventos registrados.</p>
          : (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact">
                <caption className="sr-only">Atividade recente do Cliente</caption>
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col" className="app-table__text-head">O que aconteceu</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((event) => (
                    <tr key={`${event.kind}-${event.sourceId}`}>
                      <td className="whitespace-nowrap tabular-nums"><time dateTime={event.at}>{formatDate(event.at)}</time></td>
                      <td className="app-table__text"><TimelineLabel label={event.label} link={event.link} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Block>
    </div>
  )
}

/** "B/L vinculado: COSU6401234501": só o identificador é link, sem sublinhado. */
export function TimelineLabel({ label, link }: { label: string; link: string | null }) {
  if (!link) return <>{label}</>
  const cut = label.lastIndexOf(': ')
  if (cut < 0) return <Link className="app-customer-link" to={link}>{label}</Link>
  return <>{label.slice(0, cut + 2)}<Link className="app-customer-link" to={link}>{label.slice(cut + 2)}</Link></>
}

function Pendencies({ items, onNavigateTab, hideTitle = false }: { items: OverviewItem[]; onNavigateTab: (tab: FichaTabId) => void; hideTitle?: boolean }) {
  if (!items.length) return null
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li key={item.key} className="grid gap-2">
          <p className={hideTitle && item.tone !== 'info' ? 'sr-only' : undefined}>
            <span className="sr-only">{item.tone === 'danger' ? 'Urgente: ' : item.tone === 'warning' ? 'Atenção: ' : 'Informação: '}</span>
            <StatusText tone={item.tone === 'info' ? 'default' : 'warning'}>{item.title}</StatusText>
          </p>
          {item.detail ? <p className="app-facts__detail">{item.detail}</p> : null}
          <div className="flex flex-wrap gap-2">
            {item.actions.map((action) => <PendencyAction key={action.label} action={action} onNavigateTab={onNavigateTab} />)}
          </div>
        </li>
      ))}
    </ul>
  )
}
function PendencyAction({ action, onNavigateTab }: { action: OverviewAction; onNavigateTab: (tab: FichaTabId) => void }) {
  if ('to' in action) {
    return <Link className="app-btn app-btn--secondary app-btn--sm" to={action.to}>{action.label} <ArrowRight size={14} aria-hidden="true" /></Link>
  }
  return (
    <Button variant="secondary" className="app-btn--sm" onClick={() => onNavigateTab(action.tab)}>
      {action.label} <ArrowRight size={14} aria-hidden="true" />
    </Button>
  )
}
