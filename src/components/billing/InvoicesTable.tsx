import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { SkeletonTable } from '../ui/Skeleton'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import {
  getInvoiceBls,
  getInvoicePaymentDate,
  isConsolidatedInvoice,
  invoiceTypeLabel,
  type InvoiceListBl,
  type InvoiceListRow,
} from '../../services/billing'
import { formatCnpjCpf, formatDate } from '../../lib/utils'
import { describeInvoiceRowAmount, invoiceStatusTag } from './invoiceDetailPresentation'
import { InvoiceCommunicationStatusCell } from './InvoiceCommunicationStatusCell'

type InvoicesTableProps = {
  invoices: InvoiceListRow[]
  isLoading: boolean
  error: unknown
  totalCount: number
  emptyState: { title: string; description?: string }
  emptyAction?: ReactNode
  /** Faixa de resumo e ações da barra da tabela. */
  summary?: ReactNode
  actions?: ReactNode
  onRetry?: () => void
  page: number
  pageSize?: number
  totalPages: number
  onPageChange: (page: number) => void
  onSelectInvoice: (invoiceId: number) => void
  showCommunication?: boolean
}

/**
 * Lista de faturas de Taxas Locais. O número abre o detalhe (sem botão
 * "Detalhes" repetido); a coluna Valores mostra primeiro o que decide (saldo
 * em aberto ou total pago). Abaixo de 640 px vira cartões.
 */
export function InvoicesTable({
  invoices,
  isLoading,
  error,
  totalCount,
  emptyState,
  emptyAction,
  summary,
  actions,
  onRetry,
  page,
  pageSize = 20,
  totalPages,
  onPageChange,
  onSelectInvoice,
  showCommunication = false,
}: InvoicesTableProps) {
  const narrow = useNarrowViewport()
  const columns = showCommunication ? 8 : 7
  const failed = Boolean(error)

  return (
    <section className="app-invoices" aria-label="Faturas">
      {summary || actions ? (
        <div className="app-invoices__bar">
          <div className="app-invoices__summary">{summary}</div>
          {actions ? <div className="app-invoices__actions">{actions}</div> : null}
        </div>
      ) : null}
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
          {invoices.map((invoice) => <InvoiceCard key={invoice.id} invoice={invoice} onSelect={onSelectInvoice} showCommunication={showCommunication} />)}
        </div>
      ) : (
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className={`app-table app-table--compact app-invoices__table${showCommunication ? ' app-invoices__table--comm' : ''}`}>
            <caption className="sr-only">Faturas de Taxas Locais filtradas</caption>
            <thead>
              <tr>
                <th scope="col">Fatura</th>
                <th scope="col">Cliente</th>
                <th scope="col">B/Ls</th>
                <th scope="col">Navio / Viagem · POD</th>
                <th scope="col">Emissão</th>
                <th scope="col" className="app-invoices__num">Valores</th>
                <th scope="col">Situação</th>
                {showCommunication ? <th scope="col">Comunicado de CE Mercante</th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? <tr><td colSpan={columns} className="p-0"><SkeletonTable rows={6} cols={columns} /></td></tr> : null}
              {!isLoading && !failed && invoices.length === 0 ? <tr><td colSpan={columns} className="p-0"><EmptyState title={emptyState.title} description={emptyState.description} action={emptyAction} /></td></tr> : null}
              {invoices.map((invoice) => {
                const bls = getInvoiceBls(invoice)
                const paymentDate = getInvoicePaymentDate(invoice)
                const amount = describeInvoiceRowAmount(invoice)
                const status = invoiceStatusTag(invoice.status)
                return (
                  <tr key={invoice.id}>
                    <td>
                      <InvoiceNumberButton invoice={invoice} onSelect={onSelectInvoice} />
                      <span className="app-invoices__meta">{typeText(invoice, bls)}</span>
                    </td>
                    <td><CustomerCell invoice={invoice} /></td>
                    <td><BlLinks bls={bls} manual={invoice.invoice_type === 'manual'} /></td>
                    <td>
                      <span className="app-invoices__clamp">{formatVesselVoyage(bls, invoice)}</span>
                      <span className="app-invoices__meta">POD {formatPodList(bls, invoice)}</span>
                    </td>
                    <td className="app-invoices__date">
                      {formatDate(invoice.issued_at)}
                      {paymentDate ? <span className="app-invoices__meta">pago em {formatDate(paymentDate)}</span> : null}
                    </td>
                    <td className="app-invoices__num">
                      <span className={`app-invoices__amount app-invoices__amount--${amount.tone}`}>{amount.main}</span>
                      <span className="app-invoices__meta">{amount.detail}</span>
                    </td>
                    <td><Badge tone={status.tone}>{status.label}</Badge></td>
                    {showCommunication ? <td><InvoiceCommunicationStatusCell invoice={invoice} /></td> : null}
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

function InvoiceNumberButton({ invoice, onSelect }: { invoice: InvoiceListRow; onSelect: (id: number) => void }) {
  const number = invoice.invoice_number ?? `Fatura ${invoice.id}`
  return (
    <button type="button" className="app-invoices__number" aria-label={`Abrir fatura ${number}`} onClick={() => onSelect(invoice.id)}>
      {number}
    </button>
  )
}

function CustomerCell({ invoice }: { invoice: InvoiceListRow }) {
  if (!invoice.customer) return <span className="app-invoices__meta">Cliente não identificado</span>
  return (
    <>
      <span className="app-invoices__clamp app-invoices__customer">{invoice.customer.name}</span>
      <span className="app-invoices__meta">{formatCnpjCpf(invoice.customer.cnpj_cpf)}</span>
    </>
  )
}

function InvoiceCard({ invoice, onSelect, showCommunication }: { invoice: InvoiceListRow; onSelect: (id: number) => void; showCommunication: boolean }) {
  const bls = getInvoiceBls(invoice)
  const amount = describeInvoiceRowAmount(invoice)
  const status = invoiceStatusTag(invoice.status)
  return (
    <article className="app-invoice-card" aria-label={`Fatura ${invoice.invoice_number ?? invoice.id}`}>
      <div className="app-invoice-card__head">
        <InvoiceNumberButton invoice={invoice} onSelect={onSelect} />
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="app-invoice-card__amount">
        <span className={`app-invoices__amount app-invoices__amount--${amount.tone}`}>{amount.main}</span>
        <span className="app-invoices__meta">{amount.detail}</span>
      </div>
      <div><CustomerCell invoice={invoice} /></div>
      <p className="app-invoices__meta">{typeText(invoice, bls)} · emitida em {formatDate(invoice.issued_at)}</p>
      <div className="app-invoice-card__bls"><BlLinks bls={bls} manual={invoice.invoice_type === 'manual'} /></div>
      {showCommunication ? <InvoiceCommunicationStatusCell invoice={invoice} /> : null}
    </article>
  )
}

function typeText(invoice: InvoiceListRow, bls: InvoiceListBl[]) {
  const label = invoiceTypeLabel(invoice.invoice_type)
  return isConsolidatedInvoice(invoice) && bls.length > 0 ? `${label} · ${bls.length} B/Ls` : label
}

function BlLinks({ bls, manual }: { bls: InvoiceListBl[]; manual: boolean }) {
  if (bls.length === 0) return <span className="app-invoices__meta">{manual ? 'Sem B/L' : 'Sem B/L vinculado'}</span>
  const visible = bls.slice(0, 2)
  const remaining = bls.length - visible.length
  return (
    <span className="app-invoices__bls">
      {visible.map((bl) => (
        <Link key={bl.bl_id} className="app-invoices__bl" to={`/bls/${encodeURIComponent(bl.bl_id)}`}>{bl.bl_id}</Link>
      ))}
      {remaining > 0 ? <span className="app-invoices__meta">+{remaining}</span> : null}
    </span>
  )
}

function formatVesselVoyage(bls: InvoiceListBl[], invoice?: InvoiceListRow) {
  const labels = Array.from(
    new Set(
      bls
        .map((bl) => [bl.vessel_name, bl.voyage_number].filter(Boolean).join(' · '))
        .filter((label) => label.length > 0),
    ),
  )
  if (labels.length === 0 && invoice) {
    const voyage = invoice.voyage ?? invoice.bl?.voyage ?? null
    const directLabel = [voyage?.vessel?.name, voyage?.voyage_number].filter(Boolean).join(' · ')
    if (directLabel) return directLabel
  }
  if (labels.length === 0) return '—'
  if (labels.length === 1) return labels[0]
  return `${labels[0]} +${labels.length - 1}`
}

function formatPodList(bls: InvoiceListBl[], invoice?: InvoiceListRow) {
  const pods = Array.from(new Set(bls.map((bl) => bl.pod).filter((pod): pod is string => Boolean(pod))))
  if (pods.length === 0 && invoice?.bl?.pod) return invoice.bl.pod
  if (pods.length === 0) return '—'
  if (pods.length === 1) return pods[0]
  return `${pods[0]} +${pods.length - 1}`
}
