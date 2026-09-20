import { useId } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { formatResultCount } from '../../lib/operationalState'
import { EMPTY_PORTAL_BILLING_FILTERS, type PortalBillingFilters } from '../../lib/portalBillingFilters'
import { formatBRL, formatDate } from '../../lib/utils'
import { renderDemurrageBadge, renderInvoiceBadge } from '../../lib/portalInvoiceStatus'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from '../../services/portalBilling'

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

export function LocalFeesTab({ invoices, totalCount, page, onPageChange, loading, error, filters, onFilters, vesselOptions, pods, onOpenDetail }: LocalTabProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / BILLING_PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[var(--app-border)] px-5 py-4">
        <h2 className="text-base font-semibold">Faturas de taxas locais</h2>
        <p className="mt-1 text-sm text-[var(--app-muted)]">{formatResultCount(totalCount, 'fatura', 'faturas')}</p>
      </div>

      <div className="px-5 pt-4">
        <FiltersControls filters={filters} onFilters={onFilters} vesselOptions={vesselOptions} pods={pods} />
      </div>

      {error ? <div className="px-5 py-4 text-sm text-[var(--app-red)]">Falha ao consultar faturas.</div> : null}

      {/* Desktop */}
      <div className="hidden app-table-scroll md:block">
        <table className="app-table app-table--compact min-w-[920px] text-left text-sm">
          <caption className="sr-only">Faturas de taxas locais do cliente</caption>
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3">B/L</th>
              <th scope="col" className="px-4 py-3">Fatura</th>
              <th scope="col" className="px-4 py-3">Tipo</th>
              <th scope="col" className="px-4 py-3">Navio / Viagem · POD</th>
              <th scope="col" className="px-4 py-3">Emissão</th>
              <th scope="col" className="px-4 py-3">Financeiro</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={8}>Carregando faturas...</td></tr>
            ) : null}
            {!loading && invoices.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={8}>Nenhuma fatura para os filtros atuais.</td></tr>
            ) : null}
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-4 py-3 font-semibold">{formatBlList(invoice.bls)}</td>
                <td className="px-4 py-3">{invoice.invoice_number ?? `INV-${invoice.id}`}</td>
                <td className="px-4 py-3">{invoice.invoice_type === 'consolidated' ? 'Consolidada' : 'Individual'}</td>
                <td className="px-4 py-3">
                  <div>{(invoice.vessel_voyages ?? []).join(' / ') || '—'}</div>
                  <div className="text-xs text-[var(--app-muted)]">{(invoice.pods ?? []).join(' / ') || '—'}</div>
                </td>
                <td className="px-4 py-3">{formatDate(invoice.issued_at)}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{formatBRL(invoice.total_brl)}</div>
                  <div className="text-xs text-[var(--app-muted)]">Saldo {formatBRL(invoice.balance_brl)}</div>
                </td>
                <td className="px-4 py-3">{renderInvoiceBadge(invoice.status)}</td>
                <td className="px-4 py-3">
                  <Button variant="secondary" onClick={() => onOpenDetail(invoice.id)}>Detalhes</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 p-4 md:hidden">
        {!loading && invoices.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--app-muted)]">Nenhuma fatura para os filtros atuais.</div>
        ) : null}
        {invoices.map((invoice) => (
          <button
            key={invoice.id}
            type="button"
            onClick={() => onOpenDetail(invoice.id)}
            className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{invoice.invoice_number ?? `INV-${invoice.id}`}</span>
              {renderInvoiceBadge(invoice.status)}
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-[var(--app-muted)]">
              <span>{invoice.invoice_type === 'consolidated' ? 'Consolidada' : 'Individual'} · {formatDate(invoice.issued_at)}</span>
              <span className="font-semibold text-[var(--app-text)]">{formatBRL(invoice.total_brl)}</span>
            </div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">B/L: {formatBlList(invoice.bls)}</div>
          </button>
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
    </Card>
  )
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
  onDispute: (id: number, docNumber: string) => void
}

export function DemurrageTab({ invoices, totalCount, page, onPageChange, loading, error, filters, onFilters, vesselOptions, pods, onOpenDetail, onDispute }: DemTabProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / BILLING_PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[var(--app-border)] px-5 py-4">
        <h2 className="text-base font-semibold">Sobreestadia de containers (D&D)</h2>
        <p className="mt-1 text-sm text-[var(--app-muted)]">{formatResultCount(totalCount, 'fatura', 'faturas')}</p>
      </div>

      <div className="px-5 pt-4">
        <FiltersControls filters={filters} onFilters={onFilters} vesselOptions={vesselOptions} pods={pods} />
      </div>

      {error ? <div className="px-5 py-4 text-sm text-[var(--app-red)]">Falha ao consultar faturas de demurrage.</div> : null}

      <div className="hidden app-table-scroll md:block">
        <table className="app-table app-table--compact min-w-[820px] text-left text-sm">
          <caption className="sr-only">Faturas de demurrage do cliente</caption>
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3">Documento</th>
              <th scope="col" className="px-4 py-3">BL / Trecho</th>
              <th scope="col" className="px-4 py-3">Emissão</th>
              <th scope="col" className="px-4 py-3">Atualizado em</th>
              <th scope="col" className="px-4 py-3">Total USD</th>
              <th scope="col" className="px-4 py-3">Total BRL</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Acao</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={8}>Carregando...</td></tr>
            ) : null}
            {!loading && !error && invoices.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={8}>Nenhuma fatura de demurrage para os filtros atuais.</td></tr>
            ) : null}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="px-4 py-3 font-semibold">{inv.doc_number}</td>
                <td className="px-4 py-3">{inv.bl_id} — {inv.pol ?? '-'} / {inv.pod ?? '-'}</td>
                <td className="px-4 py-3">{formatDate(inv.billed_at)}</td>
                <td className="px-4 py-3">{formatDate(inv.updated_at)}</td>
                <td className="px-4 py-3">$ {Number(inv.total_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-3">{inv.current_total_brl != null ? formatBRL(inv.current_total_brl) : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {renderDemurrageBadge(inv.status)}
                    {inv.dispute_open ? <Badge tone="yellow">Disputa</Badge> : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <Button variant="secondary" onClick={() => onOpenDetail(inv.id)}>Detalhes</Button>
                    {!inv.dispute_open && inv.status !== 'paid' && inv.status !== 'cancelled' ? (
                      <Button variant="ghost" onClick={() => onDispute(inv.id, inv.doc_number)}>Disputar</Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-4 md:hidden">
        {!loading && !error && invoices.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--app-muted)]">Nenhuma fatura de demurrage para os filtros atuais.</div>
        ) : null}
        {invoices.map((inv) => (
          <div
            key={inv.id}
            className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{inv.doc_number}</span>
              <div className="flex items-center gap-1">
                {renderDemurrageBadge(inv.status)}
                {inv.dispute_open ? <Badge tone="yellow">D</Badge> : null}
              </div>
            </div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">{inv.bl_id} · {inv.pol ?? '-'} / {inv.pod ?? '-'}</div>
            <div className="mt-2 text-sm">$ {Number(inv.total_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="mt-2 flex gap-1">
              <Button variant="secondary" onClick={() => onOpenDetail(inv.id)}>Detalhes</Button>
              {!inv.dispute_open && inv.status !== 'paid' && inv.status !== 'cancelled' ? (
                <Button variant="ghost" onClick={() => onDispute(inv.id, inv.doc_number)}>Disputar</Button>
              ) : null}
            </div>
          </div>
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
    </Card>
  )
}

function FiltersControls({ filters, onFilters, vesselOptions, pods }: { filters: Filters; onFilters: (f: Filters) => void; vesselOptions: string[]; pods: string[] }) {
  const vesselListId = useId()
  return (
    <FilterBar activeCount={countActive(filters)} onClear={() => onFilters(EMPTY_PORTAL_BILLING_FILTERS)}>
      <div className="app-filter-grid">
        <Field label="Status">
          <Select value={filters.status} onChange={(e) => onFilters({ ...filters, status: e.target.value as PortalBillingFilters['status'] })}>
            <option value="">Todos</option>
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
            placeholder="Numero do B/L"
          />
        </Field>
        <Field label="POD">
          <Select value={filters.pod} onChange={(e) => onFilters({ ...filters, pod: e.target.value })} disabled={pods.length === 0}>
            <option value="">Todos</option>
            {pods.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Emissao (de)">
          <Input type="date" value={filters.dateFrom} onChange={(e) => onFilters({ ...filters, dateFrom: e.target.value })} />
        </Field>
        <Field label="Emissao (ate)">
          <Input type="date" value={filters.dateTo} onChange={(e) => onFilters({ ...filters, dateTo: e.target.value })} />
        </Field>
      </div>
    </FilterBar>
  )
}

function formatBlList(bls: string[] | null | undefined) {
  if (!bls || bls.length === 0) return '—'
  if (bls.length <= 2) return bls.join(', ')
  return `${bls.slice(0, 2).join(', ')} +${bls.length - 2}`
}
