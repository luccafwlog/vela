import { Printer, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { Modal } from '../ui/Modal'
import { portalInvoiceStatusLabel } from '../../lib/portalInvoiceStatus'
import { formatBRL, stripBlPrefix } from '../../lib/utils'
import { invoiceTypeLabel } from '../../services/billing'
import type { PortalInvoiceDetail } from '../../services/portalBilling'
import { PortalPixPaymentBlock } from './PortalPixPaymentBlock'

type PortalInvoiceDetailModalProps = {
  open: boolean
  invoiceId: number | null
  detail: PortalInvoiceDetail | undefined
  loading: boolean
  error: unknown
  canObsolete: boolean
  obsoleteLoading: boolean
  onClose: () => void
  onObsolete: () => void
  onPrint: () => void
  onPrintReceipt: () => void
}

export function PortalInvoiceDetailModal({
  open,
  invoiceId,
  detail,
  loading,
  error,
  canObsolete,
  obsoleteLoading,
  onClose,
  onObsolete,
  onPrint,
  onPrintReceipt,
}: PortalInvoiceDetailModalProps) {
  const invoice = detail?.invoice
  const isManual = invoice?.invoice_type === 'manual'
  const voyageLabel = [invoice?.vessel_name, invoice?.voyage_number].filter(Boolean).join(' / ')
  const hasItemBls = Boolean(detail?.bls.length || detail?.items.some((item) => item.bl_id))

  return (
    <Modal open={open} onClose={onClose} title={`Fatura ${invoice?.invoice_number ?? invoiceId ?? ''}`}>
      <div className="grid gap-5">
        {loading ? <div className="text-sm text-[var(--app-muted)]">Carregando detalhe...</div> : null}
        {error ? <div className="text-sm text-[var(--app-red)]">Falha ao carregar detalhe da fatura.</div> : null}
        {invoice ? (
          <>
            <div className="flex flex-wrap justify-end gap-2">
              {canObsolete && invoice.invoice_type === 'consolidated' ? (
                <Button variant="ghost" loading={obsoleteLoading} onClick={onObsolete}>
                  <RotateCcw size={16} />
                  Refazer consolidada
                </Button>
              ) : null}
              <Button variant="secondary" onClick={onPrint}>
                <Printer size={16} />
                Imprimir PDF
              </Button>
              {invoice.status === 'paid' || invoice.status === 'covered' ? (
                <Button variant="secondary" onClick={onPrintReceipt}>Imprimir recibo</Button>
              ) : null}
            </div>
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <MetricCard label="Status" value={portalInvoiceStatusLabel(invoice.status)} />
              <MetricCard label="Tipo" value={invoiceTypeLabel(invoice.invoice_type)} />
              <MetricCard label="Total" value={formatBRL(invoice.total_brl)} />
              <MetricCard label="Pago" value={formatBRL(invoice.total_paid_brl)} />
              <MetricCard label="Saldo" value={formatBRL(invoice.balance_brl)} />
              {!isManual || (detail?.bls?.length ?? 0) > 0 ? (
                <MetricCard label="B/Ls" value={String(detail?.bls.length ?? 0)} />
              ) : null}
            </div>

            {detail?.corrections?.length ? <Card>
              <h3 className="font-semibold">Ajustes por correção</h3>
              <p>O total e os itens originais da fatura foram preservados. O saldo a pagar considera os abatimentos abaixo.</p>
              {detail.corrections.map((correction, index) => <p key={index}>B/L {correction.bl_id}: redução de {formatBRL(correction.amount_brl)}, com {formatBRL(correction.offset_brl)} abatidos do saldo e {formatBRL(correction.refund_brl)} registrados para restituição.</p>)}
            </Card> : null}
            {detail?.bls.length ? <DetailSection title="B/Ls" subtitle="Conhecimentos de embarque desta fatura">
              <table className="app-table app-table--compact min-w-[620px] text-left text-sm">
                <caption className="sr-only">B/Ls incluídos na invoice</caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">B/L</th>
                    <th scope="col" className="px-3 py-2">Navio/Viagem</th>
                    <th scope="col" className="px-3 py-2">Trecho</th>
                    <th scope="col" className="px-3 py-2">Subtotal BRL</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.bls ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-semibold">{row.bl_id}</td>
                      <td className="px-3 py-2">{[row.vessel_name, row.voyage_number].filter(Boolean).join(' / ') || '-'}</td>
                      <td className="px-3 py-2">{row.pol ?? '-'} - {row.pod ?? '-'}</td>
                      <td className="px-3 py-2">{formatBRL(row.subtotal_brl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DetailSection> : null}

            {isManual && (invoice.notes || voyageLabel) ? (
              <Card>
                <h3 className="text-sm font-semibold">Contexto da cobrança</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {invoice.notes ? (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Descrição</div>
                      <div className="mt-1 text-sm">{invoice.notes}</div>
                    </div>
                  ) : null}
                  {voyageLabel ? (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Navio / Viagem</div>
                      <div className="mt-1 text-sm">{voyageLabel}</div>
                    </div>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {(detail?.items?.length ?? 0) > 0 ? (
              <DetailSection title="Itens cobrados" subtitle="Taxas, quantidades e valores">
                <table className="app-table app-table--compact min-w-[680px] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Descricao</th>
                      {hasItemBls ? <th scope="col" className="px-3 py-2">B/L</th> : null}
                      <th scope="col" className="px-3 py-2 text-right">Qtd</th>
                      <th scope="col" className="px-3 py-2 text-right">Valor unit.</th>
                      <th scope="col" className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.items ?? []).map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">{stripBlPrefix(item.description, item.bl_id)}</td>
                        {hasItemBls ? <td className="px-3 py-2">{item.bl_id ?? '-'}</td> : null}
                        <td className="px-3 py-2 text-right">{item.quantity ?? '-'}</td>
                        <td className="px-3 py-2 text-right">{item.unit_value_brl != null ? formatBRL(item.unit_value_brl) : '-'}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatBRL(item.total_value_brl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DetailSection>
            ) : null}

            {(detail?.containers?.length ?? 0) > 0 ? (
              <DetailSection title="Containers" subtitle="Equipamentos vinculados aos B/Ls">
                <table className="app-table app-table--compact min-w-[620px] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">B/L</th>
                      <th scope="col" className="px-3 py-2">Lacre</th>
                      <th scope="col" className="px-3 py-2 text-right">Peso bruto (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.containers ?? []).map((cont) => (
                      <tr key={cont.id}>
                        <td className="px-3 py-2 font-semibold">{cont.container_number}</td>
                        <td className="px-3 py-2">{cont.type ?? '-'}</td>
                        <td className="px-3 py-2">{cont.bl_id ?? '-'}</td>
                        <td className="px-3 py-2">{cont.seal_number ?? '-'}</td>
                        <td className="px-3 py-2 text-right">{cont.gross_weight_kg != null ? cont.gross_weight_kg.toLocaleString('pt-BR') : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DetailSection>
            ) : null}

            {invoice.pix_payload && ['issued', 'partially_paid', 'overdue'].includes(invoice.status ?? 'issued') ? <PortalPixPaymentBlock pixPayload={invoice.pix_payload} /> : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}

function DetailSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[var(--app-border)] px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-[var(--app-muted)]">{subtitle}</p> : null}
      </div>
      <div className="app-table-scroll">{children}</div>
    </Card>
  )
}
