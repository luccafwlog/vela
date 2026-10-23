import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronDown, ChevronRight, Pencil, Plus } from 'lucide-react'
import { Block } from '../ui/Block'
import { Field, Input, Select } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { ConsolidatedMark, StatusText } from '../ui/StatusText'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { InvoiceSituation } from '../billing/InvoiceSituation'
import { buildCustomerInvoiceLines, filterCustomerInvoiceLines, type FichaInvoiceFilter } from '../../services/customerFicha'
import { isConsolidatedInvoice } from '../../services/billing'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { CopyValue } from '../ui/CopyValue'
import { useCustomerDemurrageInvoices, useCustomerInvoices, useCustomerManualChargeBls, useCustomerPayments, useCustomerRateOverrides, useCustomerReceivables } from '../../hooks/useCustomerFicha'
import { useCustomerDemurrageAgreements } from '../../hooks/useCustomerDemurrageAgreements'
import { formatBRL, formatCountLabel, formatDate, formatUSD } from '../../lib/utils'
import { CustomerDemurrageAgreementModal } from '../demurrage/CustomerDemurrageAgreementModal'
import { AgreementSituationBadge } from '../demurrage/CustomerDemurrageAgreementsTab'
import { agreementPeriodText, agreementRatesText } from '../demurrage/demurrageFormRules'
import { demurrageInvoiceHref } from '../../pages/demurrageListState'
import { invoiceNetUsd } from '../../services/demurrage/demurrageNetUsd'
import { useAuth } from '../../hooks/useAuth'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { isPortalReadyForBilling } from '../../lib/portalProvisioningViewModel'
import { BillingPortalReleaseCard } from './BillingPortalReleaseCard'
import type { CustomerDemurrageAgreementListItem } from '../../types/customerDemurrageAgreements'
import { matchesAnyToken } from '../../lib/searchTerms'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>

type QueryLike = { isLoading?: boolean; isError?: boolean; refetch?: () => unknown }

/** Carregando, erro e restrito antes de qualquer "nenhum": nunca um vazio falso. */
function QueryBody({ query, restricted, children }: { query: QueryLike; restricted?: boolean; children: ReactNode }) {
  if (query.isLoading) return <p className="app-customer-muted app-customer-empty-line" role="status">Carregando…</p>
  if (query.isError) {
    return (
      <div className="app-customer-notice app-customer-notice--danger app-customer-empty-line" role="alert">
        <span>Erro ao carregar dados financeiros.</span>
        {query.refetch ? <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch?.()}>Tentar novamente</Button> : null}
      </div>
    )
  }
  if (restricted) return <p className="app-customer-muted app-customer-empty-line">Visualização financeira restrita ao perfil autorizado.</p>
  return <>{children}</>
}

function Section({ title, count, links, children }: { title: string; count?: number; links?: ReactNode; children: ReactNode }) {
  return (
    <Block title={title} headingLevel={2} flush aside={(<>{count ? <span>{count}</span> : null}{links}</>)}>
      {children}
    </Block>
  )
}

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="app-btn app-btn--secondary app-btn--sm" to={to}>{children} <ArrowRight size={14} aria-hidden="true" /></Link>
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="app-block__body app-facts__detail">{children}</p>
}

/**
 * Termo que acha só este Cliente nas buscas de Demurrage: o CNPJ (as duas
 * buscas comparam os dígitos). Pelo nome, "ACME" traria também "ACME LOGISTICA".
 */
function customerSearchTerm(data: { name: string; cnpj_cpf?: string | null }): string {
  const digits = (data.cnpj_cpf ?? '').replace(/\D/g, '')
  return digits.length >= 11 ? digits : data.name
}

const PAGE_SIZE = 20

// Demurrage na ficha (lote 1): a disputa tem coluna própria, então a
// situação fala só da fatura. Demurrage não vence (ADR 0014; B29): o estado
// legado `overdue` aparece como em aberto.
function demurrageSituation(row: { status: string | null }) {
  if (row.status === 'paid') return <StatusText tone="paid">Paga</StatusText>
  if (row.status === 'cancelled') return <StatusText tone="muted">Cancelada</StatusText>
  if (row.status === 'draft') return <StatusText tone="muted">Rascunho</StatusText>
  return <StatusText>Emitida</StatusText>
}

function demurrageDispute(row: { dispute_open?: boolean | null; dispute_status?: string | null }) {
  if (row.dispute_open || row.dispute_status === 'aberto') return <StatusText tone="warning">Aberta</StatusText>
  if (row.dispute_status === 'resolvido') return 'Resolvida'
  if (row.dispute_status === 'cancelado') return <StatusText tone="muted">Cancelada</StatusText>
  return <NoValue label="Sem disputa" />
}

function money(value: number | null | undefined, balance = false) {
  if (value == null) return <NoValue label="Valor não informado" />
  return balance && value > 0 ? <StatusText tone="warning">{formatBRL(value)}</StatusText> : formatBRL(value)
}

function BlList({ ids }: { ids: string[] }) {
  if (!ids.length) return <NoValue label="Sem B/L" />
  return (
    <span className="whitespace-nowrap">
      <Link className="app-customer-link app-customer-code" to={`/bls/${ids[0]}`}>{ids[0]}</Link>
      {ids.length > 1 ? <span className="app-facts__detail" title={ids.join(', ')}> +{ids.length - 1}</span> : null}
    </span>
  )
}

export function FinanceiroTab({ data }: { data: Data }) {
  const dem = useCustomerDemurrageInvoices(data.id)
  const rec = useCustomerReceivables(data.id)
  const inv = useCustomerInvoices(data.id)
  const pay = useCustomerPayments(data.id)
  const overrides = useCustomerRateOverrides(data.id)
  const manual = useCustomerManualChargeBls(data.id)
  const agreements = useCustomerDemurrageAgreements({ customerId: data.id })
  const { data: portalRow, isSuccess: portalLoaded } = usePortalProvisioningForCustomer(data.id)
  // Acordo de Demurrage: qualquer Departamento cria e edita (ADR 0085, D6; migration 254).
  const { effectiveRole } = useAuth()
  const canEditAgreement = effectiveRole != null

  const [agreementModalOpen, setAgreementModalOpen] = useState(false)
  const [selectedAgreement, setSelectedAgreement] = useState<CustomerDemurrageAgreementListItem | null>(null)
  const [kind, setKind] = useState<'local' | 'demurrage'>('local')
  const [filter, setFilter] = useState<FichaInvoiceFilter>({ search: '', situation: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [paymentPage, setPaymentPage] = useState(1)
  const [openLine, setOpenLine] = useState<string | null>(null)

  const restricted = (value?: boolean) => Boolean(data.invoices_access_denied || value)
  const billingHref = `/taxas-locais?customer=${data.id}`

  const lines = useMemo(() => buildCustomerInvoiceLines(inv.data?.rows ?? [], rec.data?.rows ?? []), [inv.data, rec.data])
  const invoiceBls = useMemo(() => new Map((inv.data?.rows ?? []).map((row) => [row.id, row.bl_ids])), [inv.data])
  const localLines = filterCustomerInvoiceLines(lines, filter)
  const term = filter.search.trim().toUpperCase()
  const demurrageRows = (dem.data?.rows ?? []).filter((row) => {
    if (term && !row.bl_id.toUpperCase().includes(term) && !(row.doc_number ?? '').toUpperCase().includes(term) && !matchesAnyToken(term, [row.bl_id, row.doc_number])) return false
    const status = row.status ?? 'issued'
    if (filter.situation === 'paid' && status !== 'paid') return false
    if (filter.situation === 'cancelled' && status !== 'cancelled') return false
    if (filter.situation === 'open' && (status === 'paid' || status === 'cancelled')) return false
    if (filter.situation === 'no_invoice') return false
    const issued = (row.billed_at ?? '').slice(0, 10)
    if (filter.from && issued < filter.from) return false
    if (filter.to && issued > filter.to) return false
    return true
  })
  const shownCount = kind === 'local' ? localLines.length : demurrageRows.length
  const totalPages = Math.max(1, Math.ceil(shownCount / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageSlice = <T,>(rows: T[]) => rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  // Resumo da faixa do título = o recorte filtrado (proposta: "total do recorte").
  // Cada B/L uma vez, como no Portal (ADR 0093, decisão 10): a consolidada
  // aberta conta no lugar das individuais que agrupa.
  const isOpen = (status: string) => status === 'issued' || status === 'partially_paid' || status === 'overdue'
  const openConsolidatedBls = new Set(localLines.flatMap((line) => line.kind !== 'no_invoice' && line.invoice.invoice_type === 'consolidated'
    && isOpen(line.invoice.status ?? 'issued') ? invoiceBls.get(line.invoice.id) ?? [] : []))
  const openLocalBrl = localLines.reduce((sum, line) => {
    if (line.kind === 'no_invoice') return sum + Number(line.receivable.balance_brl ?? 0)
    const status = line.invoice.status ?? 'issued'
    if (!isOpen(status)) return sum
    const bls = invoiceBls.get(line.invoice.id) ?? []
    if (line.invoice.invoice_type === 'individual' && bls.length > 0 && bls.every((bl) => openConsolidatedBls.has(bl))) return sum
    return sum + Number(line.invoice.balance_brl ?? 0)
  }, 0)
  const invoiceCount = (inv.data?.rows ?? []).length
  const openDemurrageUsd = demurrageRows.reduce((sum, row) => (row.status === 'issued' || row.status === 'overdue' ? sum + invoiceNetUsd(row).netUsd : sum), 0)

  const payments = (pay.data?.rows ?? []).filter((row) => {
    if (!term) return true
    const ids = row.invoice ? invoiceBls.get(row.invoice.id) ?? [] : []
    return ids.some((id) => id.toUpperCase().includes(term)) || (row.invoice?.invoice_number ?? '').toUpperCase().includes(term)
  })
  const paymentPages = Math.max(1, Math.ceil(payments.length / PAGE_SIZE))
  const currentPaymentPage = Math.min(paymentPage, paymentPages)

  function updateFilter(patch: Partial<FichaInvoiceFilter>) {
    setFilter((current) => ({ ...current, ...patch }))
    setPage(1)
    setPaymentPage(1)
  }

  function handleOpenNewAgreement() {
    setSelectedAgreement(null)
    setAgreementModalOpen(true)
  }

  function handleOpenEditAgreement(ag: CustomerDemurrageAgreementListItem) {
    setSelectedAgreement(ag)
    setAgreementModalOpen(true)
  }

  return (
    <div className="grid gap-4">
      {/* Sem linha na fila do Portal = sem conta: o Portal não está pronto. */}
      <BillingPortalReleaseCard customerId={data.id} portalReady={portalRow ? isPortalReadyForBilling(portalRow) : portalLoaded ? false : undefined} />

      <Block
        title="Faturas"
        headingLevel={2}
        flush
        aside={(
          <>
            {kind === 'local' && !restricted(inv.data?.denied) && inv.data ? (
              <span>
                {formatCountLabel(localLines.length, 'fatura', 'faturas')}
                {openLocalBrl > 0 ? <> · <StatusText tone="warning">{formatBRL(openLocalBrl)} em aberto</StatusText></> : null}
              </span>
            ) : null}
            {kind === 'demurrage' && !restricted(dem.data?.denied) && dem.data ? (
              <span>
                {formatCountLabel(demurrageRows.length, 'fatura', 'faturas')}
                {openDemurrageUsd > 0 ? <> · <StatusText tone="warning">{formatUSD(openDemurrageUsd)} em aberto</StatusText></> : null}
              </span>
            ) : null}
            {kind === 'local'
              ? <SectionLink to={billingHref}>Abrir em Taxas Locais</SectionLink>
              : <SectionLink to={`/demurrage?tab=faturas&busca=${encodeURIComponent(customerSearchTerm(data))}`}>Abrir em Demurrage</SectionLink>}
          </>
        )}
      >
        <div className="app-block__body">
          <div className="app-filter-grid">
            <div className="self-end">
              <SegmentedControl
                label="Tipo de fatura"
                value={kind}
                onChange={(value) => { setKind(value); setPage(1); setOpenLine(null) }}
                options={[
                  { value: 'local', label: `Taxas Locais · ${restricted(inv.data?.denied) ? '—' : invoiceCount}` },
                  { value: 'demurrage', label: `Demurrage · ${restricted(dem.data?.denied) ? '—' : dem.data?.rows.length ?? '…'}` },
                ]}
              />
            </div>
            <Field label="Buscar B/L">
              <Input placeholder="Ex.: COSU6401234501" value={filter.search} onChange={(event) => updateFilter({ search: event.target.value })} />
            </Field>
            <Field label="Situação">
              <Select value={filter.situation} onChange={(event) => updateFilter({ situation: event.target.value as FichaInvoiceFilter['situation'] })}>
                <option value="">Todas</option>
                <option value="open">Em aberto</option>
                <option value="paid">Pagas</option>
                <option value="cancelled">Canceladas</option>
                {kind === 'local' ? <option value="no_invoice">Sem fatura ativa</option> : null}
              </Select>
            </Field>
            <Field label="Emissão de">
              <Input type="date" value={filter.from} onChange={(event) => updateFilter({ from: event.target.value })} />
            </Field>
            <Field label="até">
              <Input type="date" value={filter.to} onChange={(event) => updateFilter({ to: event.target.value })} />
            </Field>
          </div>
        </div>

        {kind === 'local' ? (
          <QueryBody query={inv.isError ? inv : rec} restricted={restricted(inv.data?.denied) || restricted(rec.data?.denied)}>
            {inv.isLoading ? <Empty>Carregando…</Empty> : localLines.length ? (
              <div className="app-table-scroll">
                <table className="app-table app-table--compact">
                  <caption className="sr-only">Faturas de Taxas Locais do Cliente, com o saldo por B/L</caption>
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr-only">Abrir saldo por B/L</span></th>
                      <th scope="col">Fatura</th>
                      <th scope="col">B/Ls</th>
                      <th scope="col">Emissão</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Total</th>
                      <th scope="col">Pago</th>
                      <th scope="col">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice(localLines).map((line) => {
                      const key = line.kind === 'invoice' ? `inv-${line.invoice.id}` : `bl-${line.blId}`
                      const open = openLine === key
                      const cancelled = line.kind === 'invoice' && (line.invoice.status === 'cancelled' || line.invoice.status === 'obsolete')
                      const receivables = line.kind === 'invoice' ? line.receivables : [line.receivable]
                      return (
                        <Fragment key={key}>
                          <tr className={cancelled ? 'app-table__row--muted' : undefined}>
                            <td>
                              {receivables.length ? (
                                <button
                                  type="button"
                                  className="app-table__icon-button"
                                  aria-expanded={open}
                                  aria-controls={`${key}-detail`}
                                  aria-label={`${open ? 'Recolher' : 'Ver'} saldo por B/L`}
                                  onClick={() => setOpenLine(open ? null : key)}
                                >
                                  {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                                </button>
                              ) : null}
                            </td>
                            <td className="whitespace-nowrap">
                              {line.kind === 'invoice' ? (
                                <>
                                  <Link className="app-customer-link" to={`${billingHref}&invoice=${line.invoice.id}`}>{line.invoice.invoice_number ?? `INV-${line.invoice.id}`}</Link>
                                  {isConsolidatedInvoice(line.invoice) ? <ConsolidatedMark /> : null}
                                </>
                              ) : <StatusText tone="warning">Sem fatura ativa</StatusText>}
                            </td>
                            <td><BlList ids={line.kind === 'invoice' ? line.invoice.bl_ids : [line.blId]} /></td>
                            <td className="whitespace-nowrap tabular-nums">{line.kind === 'invoice' && line.invoice.issued_at ? formatDate(line.invoice.issued_at) : <NoValue label="Sem emissão" />}</td>
                            <td className="whitespace-nowrap">{line.kind === 'invoice' ? <InvoiceSituation status={line.invoice.status} /> : <NoValue label="Sem fatura" />}</td>
                            <td className="whitespace-nowrap tabular-nums">{money(line.kind === 'invoice' ? line.invoice.total_brl : line.receivable.original_amount_brl)}</td>
                            <td className="whitespace-nowrap tabular-nums">
                              {line.kind === 'invoice'
                                ? money(line.invoice.total_paid_brl ?? null)
                                : money(line.receivable.settled_amount_brl)}
                            </td>
                            <td className="whitespace-nowrap tabular-nums">{money(line.kind === 'invoice' ? (cancelled ? 0 : line.invoice.balance_brl) : line.receivable.balance_brl, !cancelled)}</td>
                          </tr>
                          {open ? (
                            <tr id={`${key}-detail`} data-row-detail>
                              <td colSpan={8}>
                                <table className="app-table app-table--dense">
                                  <caption className="sr-only">Saldo por B/L</caption>
                                  <thead><tr><th scope="col">B/L</th><th scope="col">Original</th><th scope="col">Liquidado</th><th scope="col">Saldo do B/L</th></tr></thead>
                                  <tbody>
                                    {receivables.map((row) => (
                                      <tr key={row.id}>
                                        <td><CopyValue value={row.bl_id} label="número do B/L"><Link className="app-customer-link app-customer-code" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link></CopyValue></td>
                                        <td className="tabular-nums">{formatBRL(row.original_amount_brl)}</td>
                                        <td className="tabular-nums">{formatBRL(row.settled_amount_brl)}</td>
                                        <td className="tabular-nums">{money(row.balance_brl, true)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty>{lines.length ? 'Nenhuma fatura com esses filtros.' : 'Nenhuma fatura de Taxas Locais.'}</Empty>}
          </QueryBody>
        ) : (
          <QueryBody query={dem} restricted={restricted(dem.data?.denied)}>
            {demurrageRows.length ? (
              <div className="app-table-scroll">
                <table className="app-table app-table--compact">
                  <caption className="sr-only">Faturas de Demurrage do Cliente</caption>
                  <thead><tr><th scope="col">Fatura</th><th scope="col">B/L</th><th scope="col">Total US$</th><th scope="col">Total R$</th><th scope="col">Situação</th><th scope="col">Disputa</th></tr></thead>
                  <tbody>
                    {pageSlice(demurrageRows).map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap"><Link className="app-customer-link app-customer-code" to={demurrageInvoiceHref(row.id)} title={row.dispute_subject ?? undefined}>{row.doc_number}</Link></td>
                        <td className="whitespace-nowrap"><CopyValue value={row.bl_id} label="número do B/L"><Link className="app-customer-link app-customer-code" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link></CopyValue></td>
                        <td className="whitespace-nowrap tabular-nums">{formatUSD(invoiceNetUsd(row).netUsd)}</td>
                        <td className="whitespace-nowrap tabular-nums">{row.current_total_brl == null ? <NoValue label="Sem valor atual em R$" /> : money(row.current_total_brl, row.status === 'issued' || row.status === 'overdue')}</td>
                        <td className="whitespace-nowrap">{demurrageSituation(row)}</td>
                        <td className="whitespace-nowrap">{demurrageDispute(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>{dem.data?.rows.length ? 'Nenhuma fatura com esses filtros.' : 'Nenhuma fatura de Demurrage.'}</Empty>}
          </QueryBody>
        )}
        {totalPages > 1 ? (
          <TableFooterPagination page={currentPage} pageSize={PAGE_SIZE} totalCount={shownCount} totalPages={totalPages} onPageChange={setPage} pageSizes={[PAGE_SIZE]} />
        ) : null}
      </Block>

      <Block title="Pagamentos" headingLevel={2} flush aside={term ? 'Mesma busca por B/L' : null}>
        <QueryBody query={pay} restricted={restricted(pay.data?.denied)}>
          {payments.length ? (
            <>
              <div className="app-table-scroll">
                <table className="app-table app-table--compact">
                  <caption className="sr-only">Pagamentos registrados para o Cliente</caption>
                  <thead><tr><th scope="col">Data</th><th scope="col">Fatura</th><th scope="col">B/Ls</th><th scope="col">Valor</th><th scope="col">Forma</th><th scope="col">Registrado por</th></tr></thead>
                  <tbody>
                    {payments.slice((currentPaymentPage - 1) * PAGE_SIZE, currentPaymentPage * PAGE_SIZE).map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap tabular-nums">{row.paid_at ? formatDate(row.paid_at) : <NoValue label="Sem data" />}</td>
                        <td className="whitespace-nowrap">{row.invoice ? <Link className="app-customer-link" to={`${billingHref}&invoice=${row.invoice.id}`}>{row.invoice.invoice_number ?? `INV-${row.invoice.id}`}</Link> : <NoValue label="Sem fatura vinculada" />}</td>
                        <td><BlList ids={row.invoice ? invoiceBls.get(row.invoice.id) ?? [] : []} /></td>
                        <td className="whitespace-nowrap tabular-nums">{formatBRL(row.amount_brl)}</td>
                        <td className="whitespace-nowrap">{row.payment_method ?? <NoValue label="Sem forma informada" />}</td>
                        <td className="whitespace-nowrap">{row.registered_by_name || <NoValue label="Sem registro de quem lançou" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {paymentPages > 1 ? (
                <TableFooterPagination page={currentPaymentPage} pageSize={PAGE_SIZE} totalCount={payments.length} totalPages={paymentPages} onPageChange={setPaymentPage} pageSizes={[PAGE_SIZE]} />
              ) : null}
            </>
          ) : <Empty>{pay.data?.rows.length ? 'Nenhum pagamento com essa busca.' : 'Nenhum pagamento registrado.'}</Empty>}
        </QueryBody>
      </Block>

      <div className="grid items-start gap-4 lg:grid-cols-2">
      <Section
        title="Acordos de Demurrage"
        count={agreements.data?.length || undefined}
        links={(
          <>
            {canEditAgreement ? (
              <Button variant="secondary" onClick={handleOpenNewAgreement}>
                <Plus size={14} aria-hidden="true" />
                Novo acordo
              </Button>
            ) : null}
            <SectionLink to={`/demurrage/taxas?tab=acordos&cliente=${encodeURIComponent(customerSearchTerm(data))}`}>Ver em Tarifas</SectionLink>
          </>
        )}
      >
        <QueryBody query={agreements}>
          {agreements.data?.length ? (
            <ul className="app-customer-rows">
              {agreements.data.map((ag) => (
                <li key={ag.id}>
                  <div className="app-customer-rows__main">
                    <span className="app-customer-rows__title">
                      <strong>{ag.free_days} dias de free time</strong>
                      <AgreementSituationBadge agreement={ag} />
                    </span>
                    <span className="app-customer-muted">
                      {agreementRatesText(ag)} · Vigência {agreementPeriodText(ag)}
                      {ag.notes ? ` · ${ag.notes}` : ''}
                    </span>
                  </div>
                  {canEditAgreement ? (
                    <Button variant="ghost" className="app-btn--sm" onClick={() => handleOpenEditAgreement(ag)} aria-label={`Editar acordo de ${ag.free_days} dias`}>
                      <Pencil size={14} aria-hidden="true" />
                      Editar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum acordo de Demurrage cadastrado para este Cliente.</Empty>}
        </QueryBody>
      </Section>

      <Section
        title="Tarifas do cliente"
        links={<SectionLink to={`/taxas-locais/tabelas?tab=overrides&cliente=${encodeURIComponent(data.name)}`}>Gerenciar em Tabelas</SectionLink>}
      >
        <div className="app-customer-subsections">
          <div>
            <h3 className="app-customer-subsection-title">Regras gerais (overrides)</h3>
            <QueryBody query={overrides}>
              {overrides.data?.length ? (
                <ul className="app-customer-rows">
                  {overrides.data.map((row) => (
                    <li key={row.id}>
                      <div className="app-customer-rows__main">
                        <strong>{row.charge_item?.name ?? <NoValue label="Sem item de cobrança" />}</strong>
                        <span className="app-customer-muted">{row.charge_item?.charge_table?.name ?? <NoValue label="Sem tabela" />} · desde {row.valid_from ? formatDate(row.valid_from) : <NoValue label="Sem data de início" />}</span>
                      </div>
                      <span className="app-customer-money">{row.charge_item?.currency === 'USD' ? formatUSD(row.override_value) : formatBRL(row.override_value)}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>Nenhum override cadastrado.</Empty>}
            </QueryBody>
          </div>
          <div>
            <h3 className="app-customer-subsection-title">B/Ls com cobrança manual</h3>
            <QueryBody query={manual}>
              {manual.data?.length ? (
                <ul className="app-customer-rows">
                  {manual.data.map((row) => (
                    <li key={row.bl_id}>
                      <CopyValue value={row.bl_id} label="número do B/L"><Link className="app-customer-link app-customer-code" to={`/bls/${row.bl_id}?tab=faturamento`}>{row.bl_id}</Link></CopyValue>
                      <span className="app-customer-muted">{formatCountLabel(row.manual_count, 'item manual', 'itens manuais')}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>Nenhum B/L com cobrança manual.</Empty>}
            </QueryBody>
          </div>
        </div>
      </Section>

      </div>

      {agreementModalOpen ? (
        <CustomerDemurrageAgreementModal
          open={agreementModalOpen}
          onClose={() => setAgreementModalOpen(false)}
          initialAgreement={selectedAgreement}
          initialCustomer={{ id: data.id, name: data.name, cnpj_cpf: data.cnpj_cpf }}
        />
      ) : null}
    </div>
  )
}
