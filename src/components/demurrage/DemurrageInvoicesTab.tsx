import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, FileText } from 'lucide-react'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { FilterBar } from '../ui/FilterBar'
import { Switch } from '../ui/Switch'
import { SummaryStrip } from '../ui/SummaryStrip'
import { QueryStateGate } from '../shared/QueryStateGate'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import { InvoiceStatusBadge } from './DemurrageBadges'
import { demurrageInvoiceNotices, fmtBRL, fmtUSD, invoiceNetUsd, type DemurrageInvoiceRow } from '../../services/demurrage/demurragePresentation'
import { formatDate } from '../../lib/utils'
import type { DemurrageInvoiceListItem } from '../../services/demurrage/demurrageInvoices'
import {
  EMPTY_INVOICE_FILTERS,
  activeInvoiceFilterCount,
  daysOpen,
  daysToPay,
  destinationText,
  fetchDemurrageInvoiceDetails,
  invoiceFilterOptions,
  matchesInvoiceFilters,
  paymentMethodLabel,
  type DemurrageInvoiceDetails,
  type InvoiceQuickFilters,
} from '../../services/demurrage/demurrageInvoiceView'
import { fetchDemurrageDunningStatuses, getDemurrageDunningDisplay, type DemurrageDunningDisplay } from '../../services/demurrageDunning'
import { queryKeys } from '../../services/queryKeys'
import { DemurrageDunningStatus } from './DemurrageDunningStatus'
import { matchesAnyToken } from '../../lib/searchTerms'

type InvoiceTab = 'emitidas' | 'pagas' | 'canceladas'

type Props = {
  tab: InvoiceTab
  invoices: DemurrageInvoiceListItem[] | undefined
  search: string
  loading: boolean
  error: unknown
  onRetry: () => void
  onSearchChange: (value: string) => void
  onOpenDetail: (invoiceId: number) => void
  /** Exportar (ADR 0112, D14): as Invoices da tela, com o que a tela leu delas. */
  onExport?: (invoices: DemurrageInvoiceListItem[], details: ReadonlyMap<number, DemurrageInvoiceDetails>) => void
}

const EMPTY_TEXT: Record<InvoiceTab, { title: string; description: string }> = {
  emitidas: { title: 'Nenhuma Invoice aguardando pagamento', description: 'As Invoices emitidas pela aba Containers aparecem aqui até a baixa.' },
  pagas: { title: 'Nenhuma Invoice paga', description: 'As Invoices baixadas pelo PIX, pelo extrato ou à mão aparecem aqui.' },
  canceladas: { title: 'Nenhuma Invoice cancelada', description: 'Invoices canceladas à mão ou substituídas por reemissão aparecem aqui.' },
}

/** "USD a cobrar" só em Faturas (lote 4 da repaginação). */
const USD_LABEL: Record<InvoiceTab, string> = { emitidas: 'USD a cobrar', pagas: 'USD pago', canceladas: 'USD cancelado' }

function matchesSearch(invoice: DemurrageInvoiceListItem, query: string) {
  if (!query) return true
  const term = query.toLowerCase()
  const digits = term.replace(/\D/g, '')
  return (
    invoice.doc_number.toLowerCase().includes(term)
    || invoice.bl_id.toLowerCase().includes(term)
    || matchesAnyToken(term, [invoice.bl_id, invoice.doc_number])
    || (invoice.customer?.name ?? '').toLowerCase().includes(term)
    || (digits.length >= 3 && (invoice.customer?.cnpj_cpf ?? '').replace(/\D/g, '').includes(digits))
  )
}

/** Situação curta para o cartão do celular: o que impede ou pausa a cobrança. */
function rowFlags(invoice: DemurrageInvoiceRow): string[] {
  const flags: string[] = demurrageInvoiceNotices(invoice)
    .filter((notice) => notice.key !== 'roe-cache')
    .map((notice) => (notice.key === 'dispute' ? 'Disputa aberta' : notice.key === 'suspended' ? 'Fora da Régua' : notice.title))
  if (Number(invoice.discount_value ?? 0) > 0) flags.push('Com desconto')
  return flags
}

/**
 * Situação na tabela (regra 5, tabela limpa): disputa aberta vira "Em disputa"
 * em âmbar. Fora da Régua fica na coluna da Régua; sem essa coluna (Pagas e
 * Canceladas), aparece ao lado da situação.
 */
function InvoiceSituation({ invoice, withDunning }: { invoice: DemurrageInvoiceRow; withDunning: boolean }) {
  const open = invoice.status === 'issued' || invoice.status === 'overdue'
  if (open && invoice.dispute_open) return <StatusText tone="warning">Em disputa</StatusText>
  const outOfDunning = !withDunning && demurrageInvoiceNotices(invoice).some((notice) => notice.key === 'dates-paid' || notice.key === 'dates-negotiated' || notice.key === 'suspended')
  return (
    <>
      <InvoiceStatusBadge status={invoice.status} />
      {outOfDunning ? <> · <StatusText tone="warning">Fora da Régua</StatusText></> : null}
    </>
  )
}

/** ROE comum a todas as Invoices do recorte (o da PTAX do dia, nas em aberto); null quando variam. */
function sharedRoe(invoices: readonly DemurrageInvoiceListItem[]): number | null {
  const values = new Set(invoices.map((invoice) => (invoice.current_roe ? Number(invoice.current_roe) : null)))
  if (values.size !== 1) return null
  const [value] = values
  return value ?? null
}

function fmtRoe(value: number | null | undefined) {
  return value ? value.toFixed(4).replace('.', ',') : null
}

function daysText(days: number | null) {
  if (days == null) return <NoValue label="Sem data" />
  return days === 1 ? '1 dia' : `${days} dias`
}

function DiscountCell({ invoice }: { invoice: DemurrageInvoiceListItem }) {
  const net = invoiceNetUsd(invoice)
  if (net.discountUsd <= 0) return <NoValue label="Sem desconto" />
  const reason = invoice.discount_justification?.trim()
  return <span title={reason ? `Motivo: ${reason}` : undefined}>{fmtUSD(net.discountUsd)}</span>
}

function Destinations({ details, onOpenDetail }: { details: DemurrageInvoiceDetails | undefined; onOpenDetail: (invoiceId: number) => void }) {
  if (!details) return <NoValue label="Não carregado" />
  if (!details.destinations.length) return <NoValue label="Sem containers" />
  return (
    <ul className="m-0 list-none p-0">
      {details.destinations.map((destination) => (
        <li key={`${destination.kind}-${destination.invoice_id ?? ''}`}>
          {destination.invoice_id != null ? (
            <button type="button" className="app-dem-link" onClick={() => onOpenDetail(destination.invoice_id!)}>{destinationText(destination)}</button>
          ) : destinationText(destination)}
        </li>
      ))}
    </ul>
  )
}

function CancelledBy({ details }: { details: DemurrageInvoiceDetails | undefined }) {
  if (!details?.cancelledBy) return <NoValue label="Sem registro" />
  return <>{details.cancelledBy}{details.cancelledAt ? <span className="app-dem-meta"> · {formatDate(details.cancelledAt)}</span> : null}</>
}

export function DemurrageInvoicesTab({ tab, invoices, search, loading, error, onRetry, onSearchChange, onOpenDetail, onExport }: Props) {
  const narrow = useNarrowViewport()
  const [filters, setFilters] = useState<InvoiceQuickFilters>(EMPTY_INVOICE_FILTERS)
  // A Régua é lida para a aba inteira, não para o recorte da busca: digitar
  // não refaz a consulta a cada tecla.
  const allInvoices = useMemo(() => invoices ?? [], [invoices])
  const invoiceIds = useMemo(() => allInvoices.map((invoice) => invoice.id), [allInvoices])
  const showDunning = tab === 'emitidas'
  const dunningQuery = useQuery({
    queryKey: queryKeys.demurrage.dunning(invoiceIds),
    enabled: showDunning && invoiceIds.length > 0,
    queryFn: () => fetchDemurrageDunningStatuses(allInvoices),
  })
  const dunningStatuses = dunningQuery.data ?? new Map()
  const needsDetails = tab !== 'emitidas'
  const detailsQuery = useQuery({
    queryKey: queryKeys.demurrage.invoiceDetails(invoiceIds),
    enabled: needsDetails && invoiceIds.length > 0,
    queryFn: () => fetchDemurrageInvoiceDetails(invoiceIds),
  })
  const details = detailsQuery.data ?? new Map<number, DemurrageInvoiceDetails>()

  function dunningDisplay(invoice: DemurrageInvoiceListItem): DemurrageDunningDisplay | undefined {
    const status = dunningStatuses.get(invoice.id)
    return status ? getDemurrageDunningDisplay(invoice as DemurrageInvoiceRow, status) : undefined
  }

  const options = useMemo(() => invoiceFilterOptions(allInvoices), [allInvoices])
  const filterCount = showDunning ? activeInvoiceFilterCount(filters) : 0
  // Os filtros só existem em Faturas: nas outras abas a lista é a da busca.
  const visible = allInvoices.filter((invoice) => matchesSearch(invoice, search.trim())
    && (!showDunning || matchesInvoiceFilters(invoice, filters, dunningDisplay(invoice))))
  const totals = visible.reduce((sum, invoice) => ({
    usd: sum.usd + invoiceNetUsd(invoice).netUsd,
    brl: sum.brl + Number(invoice.current_total_brl ?? 0),
  }), { usd: 0, brl: 0 })
  const filtering = Boolean(search.trim()) || filterCount > 0
  const roe = sharedRoe(visible)
  const setFilter = <K extends keyof InvoiceQuickFilters>(key: K, value: InvoiceQuickFilters[K]) => setFilters((current) => ({ ...current, [key]: value }))
  const clearAll = () => { setFilters(EMPTY_INVOICE_FILTERS); onSearchChange('') }

  function dunningCell(invoice: DemurrageInvoiceListItem) {
    return <DemurrageDunningStatus display={dunningDisplay(invoice)} loading={dunningQuery.isLoading} error={Boolean(dunningQuery.error)} />
  }

  return (
    <div className="app-dem-tab">
      <div className="app-dem-toolbar">
        <div className="app-dem-toolbar__search">
          <label className="sr-only" htmlFor="demurrage-invoice-search">Buscar Invoice, B/L, Cliente ou CNPJ</label>
          <Input
            id="demurrage-invoice-search"
            type="search"
            placeholder="Invoice, B/L, Cliente ou CNPJ"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        {showDunning ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros rápidos">
            <Switch checked={filters.dispute} onChange={(next) => setFilter('dispute', next)}>Em disputa</Switch>
            <Switch checked={filters.outOfDunning} onChange={(next) => setFilter('outOfDunning', next)}>Fora da Régua</Switch>
            <Switch checked={filters.discount} onChange={(next) => setFilter('discount', next)}>Com desconto</Switch>
          </div>
        ) : null}
      </div>
      {showDunning ? (
        <FilterBar title="Cliente e Navio / Viagem" activeCount={(filters.customerId != null ? 1 : 0) + (filters.voyageId != null ? 1 : 0)} onClear={() => setFilters((current) => ({ ...current, customerId: null, voyageId: null }))}>
          <div className="app-filter-grid">
            <Field label="Cliente">
              <Select value={filters.customerId ?? ''} onChange={(event) => setFilter('customerId', event.target.value ? Number(event.target.value) : null)}>
                <option value="">Todos</option>
                {options.customers.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </Select>
            </Field>
            <Field label="Navio / Viagem">
              <Select value={filters.voyageId ?? ''} onChange={(event) => setFilter('voyageId', event.target.value ? Number(event.target.value) : null)}>
                <option value="">Todas</option>
                {options.voyages.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </Select>
            </Field>
          </div>
        </FilterBar>
      ) : null}

      <QueryStateGate
        isLoading={loading}
        isError={Boolean(error)}
        hasData={invoices !== undefined}
        errorMessage="Não foi possível carregar as Invoices de Demurrage."
        onRetry={onRetry}
        loadingLabel="Carregando Invoices…"
      >
        <div className="app-dem-tablebar">
          <SummaryStrip
            label="Resumo das Invoices"
            items={[
              { label: visible.length === 1 ? 'Invoice' : 'Invoices', value: String(visible.length) },
              { label: USD_LABEL[tab], value: fmtUSD(totals.usd) },
              { label: tab === 'pagas' ? 'BRL recebido' : tab === 'emitidas' ? 'BRL hoje' : 'BRL no cancelamento', value: fmtBRL(totals.brl) },
              ...(roe && tab === 'emitidas' ? [{ label: 'ROE', value: fmtRoe(roe)! }] : []),
            ]}
          />
          {onExport && visible.length ? (
            <Button variant="secondary" className="app-btn--sm" onClick={() => onExport(visible, details)}>
              <Download size={14} aria-hidden="true" />
              Exportar
            </Button>
          ) : null}
          {tab === 'emitidas' ? <p className="app-dem-note">O USD fica travado na emissão; o BRL acompanha a PTAX até o pagamento.</p> : null}
          {needsDetails && detailsQuery.error ? <p className="app-dem-note app-dem-note--warning" role="status">Não foi possível carregar {tab === 'pagas' ? 'o ROE do pagamento' : 'o motivo e o destino das caixas'}.</p> : null}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filterCount > 0 ? 'Nenhuma Invoice neste recorte' : filtering ? 'Nenhuma Invoice nesta busca' : EMPTY_TEXT[tab].title}
            description={filterCount > 0
              ? (search.trim() ? `Nada encontrado para "${search.trim()}" com os filtros escolhidos.` : 'Nenhuma Invoice com os filtros escolhidos.')
              : filtering ? `Nada encontrado para "${search.trim()}".` : EMPTY_TEXT[tab].description}
            action={filtering ? <Button variant="secondary" onClick={clearAll}>{filterCount > 0 ? 'Limpar busca e filtros' : 'Limpar busca'}</Button> : undefined}
          />
        ) : narrow ? (
          <div className="app-dem-cards">
            {visible.map((invoice) => {
              const net = invoiceNetUsd(invoice)
              const flags = rowFlags(invoice as DemurrageInvoiceRow)
              const detail = details.get(invoice.id)
              return (
                <article key={invoice.id} className="app-dem-card" aria-label={`Invoice ${invoice.doc_number}`}>
                  <div className="app-dem-card__head">
                    <button type="button" className="app-dem-link app-dem-code app-dem-strong" onClick={() => onOpenDetail(invoice.id)}>{invoice.doc_number}</button>
                    <InvoiceStatusBadge status={invoice.status} />
                  </div>
                  <p className="app-dem-card__customer">{invoice.customer?.name ?? 'Cliente não identificado'}</p>
                  <p className="app-dem-meta">
                    B/L <CopyValue value={invoice.bl_id} label="número do B/L"><Link className="app-dem-link app-dem-code" to={`/bls/${encodeURIComponent(invoice.bl_id)}?tab=faturamento`}>{invoice.bl_id}</Link></CopyValue>
                    {' · '}Emitida em {invoice.billed_at ? formatDate(invoice.billed_at) : <NoValue label="Sem data de emissão" />}
                    {tab === 'emitidas' ? <> · Em aberto há {daysText(daysOpen(invoice.billed_at))}</> : null}
                  </p>
                  {tab === 'pagas' ? (
                    <p className="app-dem-meta">
                      {paymentMethodLabel(invoice.payment_method) ?? 'Meio não registrado'} · Paga em {invoice.paid_at ? formatDate(invoice.paid_at) : <NoValue label="Sem data de pagamento" />} ({daysText(daysToPay(invoice.billed_at, invoice.paid_at))})
                    </p>
                  ) : null}
                  {tab === 'canceladas' ? (
                    <div className="app-dem-meta">
                      {detail?.cancelReason ? <p>Motivo: {detail.cancelReason}</p> : null}
                      <Destinations details={detail} onOpenDetail={onOpenDetail} />
                    </div>
                  ) : null}
                  <div className="app-dem-card__foot">
                    <div className="app-table__cell-stack">
                      <span className="app-dem-amount">{fmtUSD(net.netUsd)}</span>
                      <span className="app-dem-meta">{fmtBRL(invoice.current_total_brl)}</span>
                    </div>
                    {flags.length ? <span className="app-dem-state app-dem-state--warning">{flags.join(' · ')}</span> : null}
                  </div>
                  {showDunning ? dunningCell(invoice) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="app-surface app-dem-table-surface">
            <div className="app-table-scroll app-table-scroll--sticky">
              <table className="app-table app-table--compact app-dem-table">
                <caption className="sr-only">Invoices de Demurrage</caption>
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">B/L</th>
                    <th scope="col">Emissão</th>
                    {tab === 'emitidas' ? <th scope="col">Em aberto há</th> : null}
                    {tab === 'pagas' ? <th scope="col">Pagamento</th> : null}
                    {tab === 'pagas' ? <th scope="col">Dias até pagar</th> : null}
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col">{USD_LABEL[tab]}</th>
                    {tab === 'emitidas' ? <th scope="col">Desconto</th> : null}
                    <th scope="col">{tab === 'pagas' ? 'BRL pago' : tab === 'emitidas' ? 'BRL hoje' : 'BRL'}</th>
                    {tab === 'pagas' ? <th scope="col">ROE do pagamento</th> : null}
                    {tab === 'pagas' ? <th scope="col" className="app-table__text-head">Meio de pagamento</th> : null}
                    {tab === 'canceladas' ? <th scope="col" className="app-table__text-head">Motivo</th> : null}
                    {tab === 'canceladas' ? <th scope="col" className="app-table__text-head">Cancelada por</th> : null}
                    {tab === 'canceladas' ? <th scope="col" className="app-table__text-head">Destino dos containers</th> : null}
                    {tab !== 'canceladas' ? <th scope="col" className="app-table__text-head">Situação</th> : null}
                    {showDunning ? <th scope="col" className="app-table__text-head">Régua de cobrança</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((invoice) => {
                    const net = invoiceNetUsd(invoice)
                    const cancelled = invoice.status === 'cancelled'
                    const brlPending = tab === 'emitidas' && Number(invoice.current_total_brl ?? 0) > 0
                    const detail = details.get(invoice.id)
                    const detailsLoading = needsDetails && detailsQuery.isLoading
                    return (
                      <tr key={invoice.id} className={cancelled ? 'app-table__row--muted' : undefined}>
                        <td data-testid="demurrage-invoice-context"><button type="button" className="app-dem-link app-dem-code app-dem-strong" onClick={() => onOpenDetail(invoice.id)}>{invoice.doc_number}</button></td>
                        <td className="app-dem-code"><CopyValue value={invoice.bl_id} label="número do B/L"><Link className="app-dem-link" to={`/bls/${encodeURIComponent(invoice.bl_id)}?tab=faturamento`}>{invoice.bl_id}</Link></CopyValue></td>
                        <td className="tabular-nums">{invoice.billed_at ? formatDate(invoice.billed_at) : <NoValue label="Sem data de emissão" />}</td>
                        {tab === 'emitidas' ? <td className="tabular-nums">{daysText(daysOpen(invoice.billed_at))}</td> : null}
                        {tab === 'pagas' ? <td className="tabular-nums">{invoice.paid_at ? formatDate(invoice.paid_at) : <NoValue label="Sem data de pagamento" />}</td> : null}
                        {tab === 'pagas' ? <td className="tabular-nums">{daysText(daysToPay(invoice.billed_at, invoice.paid_at))}</td> : null}
                        <td className="app-table__text" title={invoice.customer?.name ?? undefined}>{invoice.customer?.name ?? 'Cliente não identificado'}</td>
                        <td className="tabular-nums" data-testid="demurrage-invoice-financial" title={net.discountUsd > 0 ? `${fmtUSD(net.totalUsd)} − desconto de ${fmtUSD(net.discountUsd)}` : undefined}>{fmtUSD(net.netUsd)}</td>
                        {tab === 'emitidas' ? <td className="tabular-nums"><DiscountCell invoice={invoice} /></td> : null}
                        <td className="tabular-nums">{brlPending ? <StatusText tone="warning">{fmtBRL(invoice.current_total_brl)}</StatusText> : fmtBRL(invoice.current_total_brl)}</td>
                        {tab === 'pagas' ? <td className="tabular-nums">{detailsLoading ? '…' : fmtRoe(detail?.paymentRoe) ?? <NoValue label="Sem foto do pagamento" />}</td> : null}
                        {tab === 'pagas' ? <td className="app-table__text">{paymentMethodLabel(invoice.payment_method) ?? <NoValue label="Meio não registrado" />}</td> : null}
                        {tab === 'canceladas' ? <td className="app-table__text" title={detail?.cancelReason ?? undefined}>{detailsLoading ? '…' : detail?.cancelReason ?? <NoValue label="Sem motivo registrado" />}</td> : null}
                        {tab === 'canceladas' ? <td className="app-table__text">{detailsLoading ? '…' : <CancelledBy details={detail} />}</td> : null}
                        {tab === 'canceladas' ? <td className="app-table__text">{detailsLoading ? '…' : <Destinations details={detail} onOpenDetail={onOpenDetail} />}</td> : null}
                        {tab !== 'canceladas' ? <td className="app-table__text"><InvoiceSituation invoice={invoice as DemurrageInvoiceRow} withDunning={showDunning} /></td> : null}
                        {showDunning ? <td className="app-table__text">{dunningCell(invoice)}</td> : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </QueryStateGate>
    </div>
  )
}
