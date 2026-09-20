import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { SkeletonTable } from '../ui/Skeleton'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import {
  getInvoiceBls,
  getInvoicePaymentDate,
  isConsolidatedInvoice,
  type InvoiceListBl,
  type InvoiceListRow,
} from '../../services/billing'
import { invoiceStatusLabel, invoiceStatusTone } from '../../pages/faturamentoInvoiceStatus'
import { formatBRL, formatDate } from '../../lib/utils'
import { InvoiceCommunicationStatusCell } from './InvoiceCommunicationStatusCell'

type InvoicesTableProps = {
  invoices: InvoiceListRow[]
  isLoading: boolean
  error: unknown
  totalCount: number
  filterDescription: string
  emptyState: { title: string; description?: string }
  emptyAction?: React.ReactNode
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onSelectInvoice: (invoiceId: number) => void
  showCommunication?: boolean
}

export function InvoicesTable({
  invoices,
  isLoading,
  error,
  totalCount,
  filterDescription,
  emptyState,
  emptyAction,
  page,
  totalPages,
  onPageChange,
  onSelectInvoice,
  showCommunication = false,
}: InvoicesTableProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="billing-table__head flex flex-col gap-1 border-b px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-white">{totalCount} fatura(s) retornada(s)</span>
        <span className="text-xs">{filterDescription || 'Ordenado por emissão (recente)'}</span>
      </div>
      {error ? <InlineError message="Erro ao carregar faturamento." /> : null}
      <div className="app-table-scroll app-table-scroll--sticky">
        <table className={`app-table app-table--compact ${showCommunication ? 'min-w-[1440px]' : 'min-w-[1200px]'} text-left text-sm`}>
          <thead><tr><th scope="col" className="px-4 py-3">Número do BL</th><th scope="col" className="px-4 py-3">Fatura</th><th scope="col" className="px-4 py-3">Tipo</th><th scope="col" className="px-4 py-3">Navio / Viagem · POD</th><th scope="col" className="px-4 py-3">Emissão</th><th scope="col" className="px-4 py-3">Pagamento</th><th scope="col" className="px-4 py-3 text-right">Financeiro</th><th scope="col" className="px-4 py-3">Status</th>{showCommunication ? <th scope="col" className="px-4 py-3">Comunicação financeira</th> : null}<th scope="col" className="px-4 py-3">Ações</th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={showCommunication ? 10 : 9} className="p-0"><SkeletonTable rows={6} cols={showCommunication ? 10 : 9} /></td></tr> : null}
            {!isLoading && invoices.length === 0 ? <tr><td colSpan={showCommunication ? 10 : 9} className="p-0"><EmptyState title={emptyState.title} description={emptyState.description} action={emptyAction} /></td></tr> : null}
            {invoices.map((invoice) => {
              const bls = getInvoiceBls(invoice)
              const consolidated = isConsolidatedInvoice(invoice)
              const paymentDate = getInvoicePaymentDate(invoice)
              return (
              <tr key={invoice.id}>
                <td className="px-4 py-3">
                  <div className="app-table__cell-stack">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#58a6ff]">{renderBlLinks(bls)}</span>
                      <Badge tone={consolidated ? 'blue' : 'slate'}>{bls.length} B/L{bls.length === 1 ? '' : 's'}</Badge>
                    </div>
                    {consolidated ? <div className="app-table__cell-meta">Consolidada · {bls.length} BLs agrupados</div> : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="app-table__cell-stack">
                    <div className="font-semibold text-white">{invoice.invoice_number ?? `INV-${invoice.id}`}</div>
                    <div className="app-table__cell-value">
                      <span className="app-table__truncate app-table__truncate--xl" title={invoice.customer?.name ?? '-'}>
                        {invoice.customer?.name ?? '-'}
                      </span>
                    </div>
                    <div className="app-table__cell-meta">{invoice.customer?.cnpj_cpf ?? 'Cliente não identificado'}</div>
                  </div>
                </td>
                <td className="px-4 py-3"><Badge tone={consolidated ? 'blue' : 'slate'}>{consolidated ? 'Consolidada' : 'Único BL'}</Badge></td>
                <td className="px-4 py-3">
                  <div className="app-table__cell-stack">
                    <div className="app-table__cell-value">
                      <span className="app-table__truncate app-table__truncate--xl" title={formatVesselVoyage(bls)}>{formatVesselVoyage(bls)}</span>
                    </div>
                    <div className="app-table__cell-meta">POD {formatPodList(bls)}</div>
                  </div>
                </td>
                <td className="px-4 py-3">{formatDate(invoice.issued_at)}</td>
                <td className="px-4 py-3">{paymentDate ? formatDate(paymentDate) : <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <div className="app-table__cell-stack">
                    <div className="app-table__cell-value app-table__cell-value--financial">Total {formatBRL(invoice.total_brl)}</div>
                    <div className="app-table__cell-meta">Pago {formatBRL(invoice.total_paid_brl)}</div>
                    {invoice.status !== 'cancelled' ? (
                      <div className="app-table__cell-meta">Saldo {formatBRL(invoice.balance_brl)}</div>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3">{renderInvoiceStatus(invoice.status)}</td>
                {showCommunication ? <td className="px-4 py-3"><InvoiceCommunicationStatusCell invoice={invoice} /></td> : null}
                <td className="px-4 py-3"><Button variant="secondary" onClick={() => onSelectInvoice(invoice.id)}>Detalhes</Button></td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <TableFooterPagination
        page={page}
        pageSize={20}
        totalCount={totalCount}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </Card>
  )
}

function renderInvoiceStatus(status: string | null) {
  return <Badge tone={invoiceStatusTone(status)}>{invoiceStatusLabel(status)}</Badge>
}

function renderBlLinks(bls: InvoiceListBl[]) {
  if (bls.length === 0) return 'Sem B/L'
  const visible = bls.slice(0, 2)
  const remaining = bls.length - 2
  return (
    <>
      {visible.map((bl, index) => (
        <span key={bl.bl_id}>
          {index > 0 ? ' • ' : null}
          <Link
            className="hover:underline"
            to={`/bls/${encodeURIComponent(bl.bl_id)}`}
          >
            {bl.bl_id}
          </Link>
        </span>
      ))}
      {remaining > 0 ? ` +${remaining}` : null}
    </>
  )
}

function formatVesselVoyage(bls: InvoiceListBl[]) {
  const labels = Array.from(
    new Set(
      bls
        .map((bl) => [bl.vessel_name, bl.voyage_number].filter(Boolean).join(' · '))
        .filter((label) => label.length > 0),
    ),
  )
  if (labels.length === 0) return '—'
  if (labels.length === 1) return labels[0]
  return `${labels[0]} +${labels.length - 1}`
}

function formatPodList(bls: InvoiceListBl[]) {
  const pods = Array.from(new Set(bls.map((bl) => bl.pod).filter((pod): pod is string => Boolean(pod))))
  if (pods.length === 0) return '—'
  if (pods.length === 1) return pods[0]
  return `${pods[0]} +${pods.length - 1}`
}
