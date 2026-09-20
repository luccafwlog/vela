import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { Modal } from '../ui/Modal'
import { portalInvoiceStatusLabel } from '../../lib/portalInvoiceStatus'
import { formatBRL, formatDate } from '../../lib/utils'
import type { PortalDemurrageInvoiceDetail } from '../../services/portalBilling'
import { PortalPixPaymentBlock } from './PortalPixPaymentBlock'
import { Button } from '../ui/Button'

type PortalDemurrageDetailModalProps = {
  open: boolean
  invoiceId: number | null
  detail: PortalDemurrageInvoiceDetail | undefined
  loading: boolean
  onClose: () => void
  onPrint: () => void
}

export function PortalDemurrageDetailModal({
  open,
  invoiceId,
  detail,
  loading,
  onClose,
  onPrint,
}: PortalDemurrageDetailModalProps) {
  const invoice = detail?.invoice

  return (
    <Modal open={open} onClose={onClose} title={`Demurrage ${invoice?.doc_number ?? invoiceId ?? ''}`}>
      <div className="grid gap-5">
        {loading ? <div className="text-sm text-[var(--app-muted)]">Carregando...</div> : null}
        {detail ? (() => {
          const invoice = detail.invoice
          return (
            <>
            {invoice.status === 'paid' ? <div className="flex justify-end"><Button variant="secondary" onClick={onPrint}>Imprimir recibo</Button></div> : null}
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <MetricCard label="Status" value={portalInvoiceStatusLabel(invoice.status)} />
              <MetricCard label="Total USD" value={`$ ${Number(invoice.total_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
              <MetricCard label="Total BRL" value={invoice.current_total_brl != null ? formatBRL(invoice.current_total_brl) : '-'} />
              <MetricCard label="ROE aplicado" value={invoice.current_roe != null ? formatBRL(invoice.current_roe) : '-'} />
            </div>
            <p className="text-xs text-[var(--app-muted)]">
              Valores atualizados em {formatDate(invoice.updated_at) ?? '-'} · fonte {portalRoeSourceLabel(invoice.roe_source)}.
              O valor em BRL acompanha a cotação cambial diária até o pagamento.
            </p>

            <Card className="overflow-hidden p-0">
              <div className="app-table-scroll">
                <table className="app-table app-table--compact min-w-[720px] text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">Descarga</th>
                      <th scope="col" className="px-3 py-2">Devolucao</th>
                      <th scope="col" className="px-3 py-2">Dias</th>
                      <th scope="col" className="px-3 py-2">USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 font-semibold">{item.container_number}</td>
                        <td className="px-3 py-2">{item.container_type}</td>
                        <td className="px-3 py-2">{formatDate(item.discharge_date)}</td>
                        <td className="px-3 py-2">{formatDate(item.return_date)}</td>
                        <td className="px-3 py-2">{item.total_days}</td>
                        <td className="px-3 py-2">$ {Number(item.subtotal_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {invoice.pix_payload ? <PortalPixPaymentBlock pixPayload={invoice.pix_payload} /> : null}
            </>
          )
        })() : null}
      </div>
    </Modal>
  )
}

function portalRoeSourceLabel(source: string | null): string {
  if (source === 'cached') return 'BCB (cache)'
  if (source === 'manual') return 'informada manualmente'
  return 'BCB'
}
