import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { ConsolidatedMark, StatusText } from '../ui/StatusText'
import { InvoiceSituation } from './InvoiceSituation'
import { SkeletonTable } from '../ui/Skeleton'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import {
  getInvoiceBls,
  isConsolidatedInvoice,
  invoiceTypeLabel,
  type InvoiceListBl,
  type InvoiceListRow,
} from '../../services/billing'
import { formatBRL, formatDate } from '../../lib/utils'

type InvoicesTableProps = {
  invoices: InvoiceListRow[]
  isLoading: boolean
  error: unknown
  totalCount: number
  emptyState: { title: string; description?: string }
  emptyAction?: ReactNode
  onRetry?: () => void
  page: number
  pageSize?: number
  totalPages: number
  onPageChange: (page: number) => void
  onSelectInvoice: (invoiceId: number) => void
}

/**
 * Lista de faturas de Taxas Locais, em tabela limpa (lote 1 da identidade,
 * 2026-10-14): uma linha de título e oito colunas — Fatura, B/L, Emissão,
 * Cliente, Navio / Viagem, Total, Saldo e Situação —, nada escrito embaixo do
 * valor. O número abre o detalhe; consolidada leva o ícone de pilha; saldo
 * maior que zero em âmbar; cancelada inteira em cinza. Abaixo de 640 px vira
 * cartões.
 */
export function InvoicesTable({
  invoices,
  isLoading,
  error,
  totalCount,
  emptyState,
  emptyAction,
  onRetry,
  page,
  pageSize = 20,
  totalPages,
  onPageChange,
  onSelectInvoice,
}: InvoicesTableProps) {
  const narrow = useNarrowViewport()
  const columns = 8
  const failed = Boolean(error)

  return (
    <section className="app-invoices" aria-label="Faturas">
      {failed ? (
        <div role="alert" className="app-invoices__error">
          <p>Não foi possível carregar as faturas. A lista abaixo não está atualizada.</p>
          {onRetry ? <Button variant="secondary" onClick={onRetry}>Tentar novamente</Button> : null}
        </div>
      ) : null}
      {narrow ? (
        <div className="app-invoice-cards">
          {isLoading ? <SkeletonTable rows={4} cols={2} /> : null}
          {!isLoading && !failed && invoices.length === 0 ? <EmptyState title={emptyState.title} description={emptyState.description} action={emptyAction} /> : null}
          {invoices.map((invoice) => <InvoiceCard key={invoice.id} invoice={invoice} onSelect={onSelectInvoice} />)}
        </div>
      ) : (
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Faturas de Taxas Locais filtradas</caption>
            <thead>
              <tr>
                <th scope="col">Fatura</th>
                <th scope="col">B/L</th>
                <th scope="col">Emissão</th>
                <th scope="col" className="app-table__text-head">Cliente</th>
                <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                <th scope="col">Total</th>
                <th scope="col">Saldo</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? <tr><td colSpan={columns} className="p-0"><SkeletonTable rows={6} cols={columns} /></td></tr> : null}
              {!isLoading && !failed && invoices.length === 0 ? <tr><td colSpan={columns} className="p-0"><EmptyState title={emptyState.title} description={emptyState.description} action={emptyAction} /></td></tr> : null}
              {invoices.map((invoice) => {
                const bls = getInvoiceBls(invoice)
                const cancelled = isCancelledStatus(invoice.status)
                const voyage = formatVesselVoyage(bls, invoice)
                return (
                  <tr key={invoice.id} className={cancelled ? 'app-table__row--muted' : undefined}>
                    <td className="whitespace-nowrap"><InvoiceNumberButton invoice={invoice} onSelect={onSelectInvoice} /></td>
                    <td className="whitespace-nowrap"><BlLinks bls={bls} manual={invoice.invoice_type === 'manual'} /></td>
                    <td className="whitespace-nowrap tabular-nums">{invoice.issued_at ? formatDate(invoice.issued_at) : <NoValue label="Sem emissão" />}</td>
                    <td className="app-table__text" title={invoice.customer?.name ?? undefined}>{invoice.customer?.name ?? <NoValue label="Cliente não identificado" />}</td>
                    <td className="app-table__text" title={voyage ?? undefined}>{voyage ?? <NoValue label="Sem navio e viagem" />}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatBRL(invoice.total_brl)}</td>
                    <td className="whitespace-nowrap tabular-nums"><Balance invoice={invoice} /></td>
                    <td className="whitespace-nowrap"><InvoiceSituation status={invoice.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <TableFooterPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </section>
  )
}

function isCancelledStatus(status: string | null | undefined) {
  return status === 'cancelled' || status === 'obsolete'
}

/** Saldo maior que zero em âmbar (pede ação); cancelada não tem saldo a cobrar. */
function Balance({ invoice }: { invoice: InvoiceListRow }) {
  if (isCancelledStatus(invoice.status)) return <NoValue label="Sem saldo: fatura cancelada" />
  const balance = Number(invoice.balance_brl ?? 0)
  return balance > 0 ? <StatusText tone="warning">{formatBRL(balance)}</StatusText> : <>{formatBRL(balance)}</>
}

function InvoiceNumberButton({ invoice, onSelect }: { invoice: InvoiceListRow; onSelect: (id: number) => void }) {
  const number = invoice.invoice_number ?? `Fatura ${invoice.id}`
  return (
    <>
      <button type="button" className="app-invoices__number" aria-label={`Abrir fatura ${number}`} onClick={() => onSelect(invoice.id)}>
        {number}
      </button>
      {isConsolidatedInvoice(invoice) ? <ConsolidatedMark /> : null}
    </>
  )
}

function InvoiceCard({ invoice, onSelect }: { invoice: InvoiceListRow; onSelect: (id: number) => void }) {
  const bls = getInvoiceBls(invoice)
  return (
    <article className="app-invoice-card" aria-label={`Fatura ${invoice.invoice_number ?? invoice.id}`}>
      <div className="app-invoice-card__head">
        <span><InvoiceNumberButton invoice={invoice} onSelect={onSelect} /></span>
        <InvoiceSituation status={invoice.status} />
      </div>
      <div className="app-invoice-card__amount">
        Saldo <Balance invoice={invoice} /> · Total {formatBRL(invoice.total_brl)}
      </div>
      <div>{invoice.customer?.name ?? <NoValue label="Cliente não identificado" />}</div>
      <p className="app-invoices__meta">{typeText(invoice, bls)} · emitida em {formatDate(invoice.issued_at)}</p>
      <div className="app-invoice-card__bls"><BlLinks bls={bls} manual={invoice.invoice_type === 'manual'} /></div>
    </article>
  )
}

function typeText(invoice: InvoiceListRow, bls: InvoiceListBl[]) {
  const label = invoiceTypeLabel(invoice.invoice_type)
  return isConsolidatedInvoice(invoice) && bls.length > 0 ? `${label} · ${bls.length} B/Ls` : label
}

function BlLinks({ bls, manual }: { bls: InvoiceListBl[]; manual: boolean }) {
  if (bls.length === 0) return <NoValue label={manual ? 'Sem B/L' : 'Sem B/L vinculado'} />
  const visible = bls.slice(0, 1)
  const remaining = bls.length - visible.length
  return (
    <span className="app-invoices__bls">
      {visible.map((bl) => (
        <CopyValue key={bl.bl_id} value={bl.bl_id} label="número do B/L"><Link className="app-invoices__bl" to={`/bls/${encodeURIComponent(bl.bl_id)}`}>{bl.bl_id}</Link></CopyValue>
      ))}
      {remaining > 0 ? <span className="app-invoices__meta" title={bls.map((bl) => bl.bl_id).join(', ')}> +{remaining}</span> : null}
    </span>
  )
}

function formatVesselVoyage(bls: InvoiceListBl[], invoice?: InvoiceListRow): string | null {
  const labels = Array.from(
    new Set(
      bls
        .map((bl) => [bl.vessel_name, bl.voyage_number].filter(Boolean).join(' / '))
        .filter((label) => label.length > 0),
    ),
  )
  if (labels.length === 0 && invoice) {
    const voyage = invoice.voyage ?? invoice.bl?.voyage ?? null
    const directLabel = [voyage?.vessel?.name, voyage?.voyage_number].filter(Boolean).join(' / ')
    if (directLabel) return directLabel
  }
  if (labels.length === 0) return null
  if (labels.length === 1) return labels[0]
  return `${labels[0]} +${labels.length - 1}`
}
