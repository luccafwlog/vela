import { useId, type ReactNode } from 'react'
import { Block } from '../ui/Block'
import { ConsolidatedMark, StatusText } from '../ui/StatusText'
import { InvoiceSituation } from '../billing/InvoiceSituation'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { formatResultCount } from '../../lib/operationalState'
import { EMPTY_PORTAL_BILLING_FILTERS, type PortalBillingFilters } from '../../lib/portalBillingFilters'
import { formatBRL, formatDate } from '../../lib/utils'
import { demurrageSituation, formatUsd, isDemurragePayable } from '../../lib/portalInvoiceStatus'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from '../../services/portalBilling'
import { invoiceNetUsd } from '../../services/demurrage/demurragePresentation'

type Filters = PortalBillingFilters
const BILLING_PAGE_SIZE = 25

function countActive(f: Filters) {
  return [f.status, f.vessel, f.bl, f.pod, f.dateFrom || f.dateTo].filter(Boolean).length
}

type LocalTabProps = {
  invoices: PortalInvoiceSummary[]
  totalCount: number
  page: number
  onPageChange: (page: number) => void
  loading: boolean
  error: boolean
  filters: Filters
  onFilters: (f: Filters) => void
  vesselOptions: string[]
  pods: string[]
  onOpenDetail: (id: number) => void
}

/**
 * Faturas de Taxas Locais do Portal em tabela limpa (lote 1 da identidade,
 * 2026-10-14): Fatura, B/L, Emissão, Navio / Viagem, Total, Saldo e Situação,
 * nada embaixo do valor. O número abre o detalhe; o POD fica no filtro e no
 * detalhe.
 */
export function LocalFeesTab({ invoices, totalCount, page, onPageChange, loading, error, filters, onFilters, vesselOptions, pods, onOpenDetail }: LocalTabProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / BILLING_PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)

  return (
    <Block title="Faturas de taxas locais e avulsas" aside={formatResultCount(totalCount, 'fatura', 'faturas')} flush>
      <div className="px-5 pt-4">
        <FiltersControls filters={filters} onFilters={onFilters} vesselOptions={vesselOptions} pods={pods} />
      </div>

      {error ? <div className="px-5 py-4 text-sm text-[var(--app-red)]">Falha ao consultar faturas.</div> : null}

      <div className="hidden app-table-scroll lg:block">
        <table className="app-table app-table--compact text-sm">
          <caption className="sr-only">Faturas de taxas locais e avulsas do cliente</caption>
          <thead>
            <tr>
              <th scope="col">Fatura</th>
              <th scope="col">B/L</th>
              <th scope="col">Emissão</th>
              <th scope="col" className="app-table__text-head">Navio / Viagem</th>
              <th scope="col">Total</th>
              <th scope="col">Saldo</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={7}>Carregando faturas...</td></tr>
            ) : null}
            {!loading && invoices.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={7}>Nenhuma fatura para os filtros atuais.</td></tr>
            ) : null}
            {invoices.map((invoice) => {
              const voyage = (invoice.vessel_voyages ?? []).join(' / ')
              return (
                <tr key={invoice.id} className={isCancelled(invoice.status) ? 'app-table__row--muted' : undefined}>
                  <td className="whitespace-nowrap"><LocalInvoiceNumber invoice={invoice} onOpen={onOpenDetail} /></td>
                  <td className="whitespace-nowrap">{renderBlList(invoice.bls, true)}</td>
                  <td className="whitespace-nowrap tabular-nums">{invoice.issued_at ? formatDate(invoice.issued_at) : <NoValue label="Sem data de emissão" />}</td>
                  <td className="app-table__text" title={voyage || undefined}>{voyage || <NoValue label="Sem navio/viagem" />}</td>
                  <td className="whitespace-nowrap tabular-nums">{formatBRL(invoice.total_brl)}</td>
                  <td className="whitespace-nowrap tabular-nums"><LocalBalance invoice={invoice} /></td>
                  <td className="whitespace-nowrap"><InvoiceSituation status={invoice.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-4 lg:hidden">
        {!loading && invoices.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--app-muted)]">Nenhuma fatura para os filtros atuais.</div>
        ) : null}
        {invoices.map((invoice) => (
          <article key={invoice.id} className="app-invoice-card" aria-label={`Fatura ${invoice.invoice_number ?? invoice.id}`}>
            <div className="app-invoice-card__head">
              <span><LocalInvoiceNumber invoice={invoice} onOpen={onOpenDetail} /></span>
              <InvoiceSituation status={invoice.status} />
            </div>
            <div className="app-invoice-card__amount">Saldo <LocalBalance invoice={invoice} /> · Total {formatBRL(invoice.total_brl)}</div>
            <div className="text-sm text-[var(--app-muted)]">{(invoice.vessel_voyages ?? []).join(' / ') || <NoValue label="Sem navio/viagem" />}</div>
            <div className="text-sm text-[var(--app-muted)]">B/L: {renderBlList(invoice.bls, false)}</div>
          </article>
        ))}
      </div>
      {totalCount > 0 ? (
        <TableFooterPagination
          page={safePage}
          pageBase={0}
          pageSize={BILLING_PAGE_SIZE}
          totalCount={totalCount}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      ) : null}
    </Block>
  )
}

function isCancelled(status: string | null | undefined) {
  return status === 'cancelled' || status === 'obsolete'
}

function LocalInvoiceNumber({ invoice, onOpen }: { invoice: PortalInvoiceSummary; onOpen: (id: number) => void }) {
  const number = invoice.invoice_number ?? `INV-${invoice.id}`
  return (
    <>
      <button type="button" className="app-invoices__number" aria-label={`Abrir fatura ${number}`} onClick={() => onOpen(invoice.id)}>{number}</button>
      {invoice.invoice_type === 'consolidated' ? <ConsolidatedMark /> : null}
    </>
  )
}

/** Saldo maior que zero em âmbar: é o que o Cliente ainda precisa pagar. */
function LocalBalance({ invoice }: { invoice: PortalInvoiceSummary }) {
  if (isCancelled(invoice.status)) return <NoValue label="Sem saldo: fatura cancelada" />
  const balance = Number(invoice.balance_brl ?? 0)
  return balance > 0 ? <StatusText tone="warning">{formatBRL(balance)}</StatusText> : <>{formatBRL(balance)}</>
}

type DemTabProps = {
  invoices: PortalDemurrageInvoice[]
  totalCount: number
  page: number
  onPageChange: (page: number) => void
  loading: boolean
  error: boolean
  filters: Filters
  onFilters: (f: Filters) => void
  vesselOptions: string[]
  pods: string[]
  onOpenDetail: (id: number) => void
  /** Cotação do dia, numa linha só no topo do bloco (a mesma para todas as faturas). */
  roe?: { roe: number; updatedAt: string } | null
}

/**
 * Faturas de Demurrage do Portal em tabela limpa: Fatura, B/L, Emissão, Navio /
 * Viagem, Total US$, Total R$ e Situação. A disputa sai da lista e fica no fim
 * do detalhe da fatura (decisão de 2026-10-14).
 */
export function DemurrageTab({ invoices, totalCount, page, onPageChange, loading, error, filters, onFilters, vesselOptions, pods, onOpenDetail, roe }: DemTabProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / BILLING_PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  // ponytail: o total em aberto soma só a página carregada; com mais de uma
  // página o resumo mostra só a contagem. Somar todas pede um total no RPC.
  const openUsd = totalCount === invoices.length
    ? invoices.filter(isDemurragePayable).reduce((sum, inv) => sum + invoiceNetUsd(inv).netUsd, 0)
    : null

  return (
    <Block
      title="Faturas de Demurrage"
      aside={(
        <>
          {formatResultCount(totalCount, 'fatura', 'faturas')}
          {openUsd ? <> · <StatusText tone="warning">{formatUsd(openUsd)} em aberto</StatusText></> : null}
        </>
      )}
      flush
    >
      {roe ? (
        <p className="border-b border-[var(--app-border)] px-5 py-3 text-sm text-[var(--app-muted)]">
          Total em R$ pelo ROE vigente:{' '}
          <strong className="text-[var(--app-text-strong)]">R$ {roe.roe.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</strong>
          {' · atualizado em '}
          {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(roe.updatedAt))}
        </p>
      ) : null}

      <div className="px-5 pt-4">
        <FiltersControls filters={filters} onFilters={onFilters} vesselOptions={vesselOptions} pods={pods} />
      </div>

      {error ? <div className="px-5 py-4 text-sm text-[var(--app-red)]">Falha ao consultar faturas de demurrage.</div> : null}

      <div className="hidden app-table-scroll lg:block">
        <table className="app-table app-table--compact text-sm">
          <caption className="sr-only">Faturas de demurrage do cliente</caption>
          <thead>
            <tr>
              <th scope="col">Fatura</th>
              <th scope="col">B/L</th>
              <th scope="col">Emissão</th>
              <th scope="col" className="app-table__text-head">Navio / Viagem</th>
              <th scope="col">Total US$</th>
              <th scope="col">Total R$</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={7}>Carregando...</td></tr>
            ) : null}
            {!loading && !error && invoices.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={7}>Nenhuma fatura de demurrage para os filtros atuais.</td></tr>
            ) : null}
            {invoices.map((inv) => {
              const voyage = [inv.vessel_name, inv.voyage_number].filter(Boolean).join(' / ')
              return (
                <tr key={inv.id} className={isCancelled(inv.status) ? 'app-table__row--muted' : undefined}>
                  <td className="whitespace-nowrap"><DemurrageNumber invoice={inv} onOpen={onOpenDetail} /></td>
                  <td className="whitespace-nowrap"><CopyValue value={inv.bl_id} label="número do B/L" /></td>
                  <td className="whitespace-nowrap tabular-nums">{inv.billed_at ? formatDate(inv.billed_at) : <NoValue label="Sem data de emissão" />}</td>
                  <td className="app-table__text" title={voyage || undefined}>{voyage || <NoValue label="Sem navio/viagem" />}</td>
                  <td className="whitespace-nowrap tabular-nums">{formatUsd(inv.total_usd)}</td>
                  <td className="whitespace-nowrap tabular-nums"><DemurrageBrl invoice={inv} /></td>
                  <td className="whitespace-nowrap"><DemurrageSituation invoice={inv} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-4 lg:hidden">
        {!loading && !error && invoices.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--app-muted)]">Nenhuma fatura de demurrage para os filtros atuais.</div>
        ) : null}
        {invoices.map((inv) => (
          <article key={inv.id} className="app-invoice-card" aria-label={`Fatura ${inv.doc_number}`}>
            <div className="app-invoice-card__head">
              <span><DemurrageNumber invoice={inv} onOpen={onOpenDetail} /></span>
              <DemurrageSituation invoice={inv} />
            </div>
            <div className="app-invoice-card__amount">{formatUsd(inv.total_usd)} · <DemurrageBrl invoice={inv} /></div>
            <div className="text-sm text-[var(--app-muted)]">B/L <CopyValue value={inv.bl_id} label="número do B/L" /></div>
          </article>
        ))}
      </div>
      {totalCount > 0 ? (
        <TableFooterPagination
          page={safePage}
          pageBase={0}
          pageSize={BILLING_PAGE_SIZE}
          totalCount={totalCount}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      ) : null}
    </Block>
  )
}

function DemurrageNumber({ invoice, onOpen }: { invoice: PortalDemurrageInvoice; onOpen: (id: number) => void }) {
  return <button type="button" className="app-invoices__number" aria-label={`Abrir fatura ${invoice.doc_number}`} onClick={() => onOpen(invoice.id)}>{invoice.doc_number}</button>
}

/** Total em reais em âmbar enquanto há valor a pagar. */
function DemurrageBrl({ invoice }: { invoice: PortalDemurrageInvoice }) {
  if (invoice.current_total_brl == null) return <NoValue label="Sem total em R$" />
  const value = formatBRL(invoice.current_total_brl)
  return isDemurragePayable(invoice) && Number(invoice.current_total_brl) > 0 ? <StatusText tone="warning">{value}</StatusText> : <>{value}</>
}

function DemurrageSituation({ invoice }: { invoice: PortalDemurrageInvoice }) {
  const { label, tone } = demurrageSituation(invoice)
  return <StatusText tone={tone}>{label}</StatusText>
}

function FiltersControls({ filters, onFilters, vesselOptions, pods }: { filters: Filters; onFilters: (f: Filters) => void; vesselOptions: string[]; pods: string[] }) {
  const vesselListId = useId()
  return (
    <FilterBar activeCount={countActive(filters)} onClear={() => onFilters(EMPTY_PORTAL_BILLING_FILTERS)} defaultOpen>
      <div className="app-filter-grid">
        <Field label="Status">
          <Select value={filters.status} onChange={(e) => onFilters({ ...filters, status: e.target.value as PortalBillingFilters['status'] })}>
            <option value="">Em vigor (sem canceladas)</option>
            <option value="issued">Emitida</option>
            <option value="paid">Paga</option>
            <option value="cancelled">Cancelada</option>
          </Select>
        </Field>
        <Field label="Navio/Viagem">
          <Input
            list={vesselListId}
            value={filters.vessel}
            onChange={(e) => onFilters({ ...filters, vessel: e.target.value })}
            placeholder="Digite o navio ou viagem"
            disabled={vesselOptions.length === 0}
          />
          <datalist id={vesselListId}>
            {vesselOptions.map((v) => <option key={v} value={v} />)}
          </datalist>
        </Field>
        <Field label="B/L">
          <Input
            value={filters.bl}
            onChange={(e) => onFilters({ ...filters, bl: e.target.value })}
            placeholder="Número do B/L"
          />
        </Field>
        <Field label="POD">
          <Select value={filters.pod} onChange={(e) => onFilters({ ...filters, pod: e.target.value })} disabled={pods.length === 0}>
            <option value="">Todos</option>
            {pods.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Emissão (de)">
          <Input type="date" value={filters.dateFrom} onChange={(e) => onFilters({ ...filters, dateFrom: e.target.value })} />
        </Field>
        <Field label="Emissão (até)">
          <Input type="date" value={filters.dateTo} onChange={(e) => onFilters({ ...filters, dateTo: e.target.value })} />
        </Field>
      </div>
    </FilterBar>
  )
}

// Com um único B/L, a célula da tabela ganha o ícone de copiar; o cartão
// mobile é um <button> e não pode conter outro botão (copy = false).
function renderBlList(bls: string[] | null | undefined, copy: boolean): ReactNode {
  if (!bls || bls.length === 0) return <NoValue label="Sem B/L" />
  if (bls.length === 1 && copy) return <CopyValue value={bls[0]} label="número do B/L" />
  // Como em Taxas Locais · Faturas: o primeiro B/L e "+N", com todos ao passar o mouse.
  if (bls.length === 1) return bls[0]
  return <span title={bls.join(', ')}>{bls[0]} +{bls.length - 1}</span>
}
