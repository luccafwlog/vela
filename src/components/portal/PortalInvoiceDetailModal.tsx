import { Printer, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { Block } from '../ui/Block'
import { InvoiceSituation } from '../billing/InvoiceSituation'
import { Modal } from '../ui/Modal'
import { formatBRL, stripBlPrefix } from '../../lib/utils'
import { invoiceTypeLabel } from '../../services/billing'
import type { PortalInvoiceDetail } from '../../services/portalBilling'
import { PortalPaymentBlock } from './PortalPixPaymentBlock'

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
  onOpenInvoice?: (invoiceId: number) => void
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
  onOpenInvoice,
}: PortalInvoiceDetailModalProps) {
  const invoice = detail?.invoice
  const isManual = invoice?.invoice_type === 'manual'
  const voyageLabel = [invoice?.vessel_name, invoice?.voyage_number].filter(Boolean).join(' / ')
  const blCount = new Set([...(detail?.bls ?? []).map((row) => row.bl_id), ...(detail?.items ?? []).map((item) => item.bl_id).filter(Boolean)]).size
  // A coluna B/L dos itens e dos contêineres só aparece com mais de um B/L na fatura.
  const multipleBls = blCount > 1
  const hasItemBls = multipleBls
  const payable = ['issued', 'partially_paid', 'overdue'].includes(invoice?.status ?? 'issued')
  const showPix = payable && Boolean(invoice?.pix_payload || Number(invoice?.balance_brl ?? invoice?.total_brl) > 0)

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
              {invoice.status === 'paid' ? (
                <Button variant="secondary" onClick={onPrintReceipt}>Imprimir recibo</Button>
              ) : null}
            </div>
            {invoice.status === 'covered' ? (
              <Card>
                <h3 className="font-semibold">
                  Coberta{invoice.covered_by_invoice_number ? ` pela ${invoice.covered_by_invoice_number}` : ' por uma fatura consolidada'}
                </h3>
                <p className="mt-1 text-sm text-[var(--app-muted)]">
                  O pagamento foi feito na fatura consolidada, que quitou este B/L. O recibo é o da consolidada.
                </p>
                {invoice.covered_by_invoice_id && onOpenInvoice ? (
                  <Button className="mt-3" variant="secondary" onClick={() => onOpenInvoice(invoice.covered_by_invoice_id!)}>
                    Abrir {invoice.covered_by_invoice_number}
                  </Button>
                ) : null}
              </Card>
            ) : null}
            <PortalPaymentBlock
              situation={<InvoiceSituation status={invoice.status} />}
              amountLabel="Saldo a pagar"
              amount={formatBRL(invoice.balance_brl)}
              amountTone={payable && Number(invoice.balance_brl ?? 0) > 0 ? 'warning' : 'default'}
              facts={[
                { label: 'Total', value: formatBRL(invoice.total_brl) },
                { label: 'Pago', value: formatBRL(invoice.total_paid_brl) },
                ...(payable ? [{ label: 'Como pagar', value: 'Pix' }] : []),
              ]}
              pix={showPix ? invoice.pix_payload : undefined}
            />

            {detail?.corrections?.length ? <Card>
              <h3 className="font-semibold">Ajustes por correção</h3>
              <p>O total e os itens originais da fatura foram preservados. O saldo a pagar considera os abatimentos abaixo.</p>
              {detail.corrections.map((correction, index) => <p key={index}>B/L {correction.bl_id}: redução de {formatBRL(correction.amount_brl)}, com {formatBRL(correction.offset_brl)} abatidos do saldo e {formatBRL(correction.refund_brl)} registrados para restituição.</p>)}
            </Card> : null}
            {detail?.bls.length ? <DetailSection title="B/Ls" aside={`${invoiceTypeLabel(invoice.invoice_type)} · ${detail.bls.length === 1 ? '1 B/L' : `${detail.bls.length} B/Ls`}`}>
              <table className="app-table app-table--compact text-sm">
                <caption className="sr-only">B/Ls incluídos na invoice</caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">B/L</th>
                    <th scope="col" className="app-table__text-head px-3 py-2">Navio/Viagem</th>
                    <th scope="col" className="px-3 py-2">Trecho</th>
                    <th scope="col" className="px-3 py-2">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.bls ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-semibold"><CopyValue value={row.bl_id} label="número do B/L" /></td>
                      <td className="app-table__text px-3 py-2">{[row.vessel_name, row.voyage_number].filter(Boolean).join(' / ') || <NoValue label="Sem navio/viagem" />}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.pol ?? <NoValue label="Sem POL" />} → {row.pod ?? <NoValue label="Sem POD" />}</td>
                      <td className="px-3 py-2">{formatBRL(row.subtotal_brl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DetailSection> : null}

            {isManual && (invoice.notes || voyageLabel) ? (
              <Block title="Contexto da cobrança" headingLevel={3}>
                <div className="grid gap-3 sm:grid-cols-2">
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
              </Block>
            ) : null}

            {(detail?.items?.length ?? 0) > 0 ? (
              <DetailSection title="Itens cobrados" aside={detail!.items.length === 1 ? '1 item' : `${detail!.items.length} itens`}>
                <table className="app-table app-table--compact text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="app-table__text-head px-3 py-2">Descrição</th>
                      {hasItemBls ? <th scope="col" className="px-3 py-2">B/L</th> : null}
                      <th scope="col" className="px-3 py-2">Qtd.</th>
                      <th scope="col" className="px-3 py-2">Valor unit.</th>
                      <th scope="col" className="px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.items ?? []).map((item) => (
                      <tr key={item.id}>
                        <td className="app-table__text app-table__text--wrap px-3 py-2">{stripBlPrefix(item.description, item.bl_id)}</td>
                        {hasItemBls ? <td className="px-3 py-2">{item.bl_id ? <CopyValue value={item.bl_id} label="número do B/L" /> : <NoValue label="Sem B/L" />}</td> : null}
                        <td className="px-3 py-2">{item.quantity ?? <NoValue label="Sem quantidade" />}</td>
                        <td className="px-3 py-2">{item.unit_value_brl != null ? formatBRL(item.unit_value_brl) : <NoValue label="Sem valor unitário" />}</td>
                        <td className="px-3 py-2 font-semibold">{formatBRL(item.total_value_brl)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="app-table__text px-3 py-2 font-semibold">Total</td>
                      {hasItemBls ? <td /> : null}
                      <td />
                      <td />
                      <td className="px-3 py-2 font-semibold">{formatBRL(invoice.total_brl)}</td>
                    </tr>
                  </tbody>
                </table>
              </DetailSection>
            ) : null}

            {(detail?.containers?.length ?? 0) > 0 ? (
              <DetailSection title="Contêineres" aside={detail!.containers.length === 1 ? '1 contêiner' : `${detail!.containers.length} contêineres`}>
                <table className="app-table app-table--compact text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Contêiner</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      {multipleBls ? <th scope="col" className="px-3 py-2">B/L</th> : null}
                      <th scope="col" className="px-3 py-2">Lacre</th>
                      <th scope="col" className="px-3 py-2">Peso bruto (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.containers ?? []).map((cont) => (
                      <tr key={cont.id}>
                        <td className="px-3 py-2 font-semibold"><CopyValue value={cont.container_number} label="número do contêiner" /></td>
                        <td className="px-3 py-2">{cont.type ?? <NoValue label="Sem tipo" />}</td>
                        {multipleBls ? <td className="px-3 py-2">{cont.bl_id ? <CopyValue value={cont.bl_id} label="número do B/L" /> : <NoValue label="Sem B/L" />}</td> : null}
                        <td className="px-3 py-2">{cont.seal_number ?? <NoValue label="Sem lacre" />}</td>
                        <td className="px-3 py-2">{cont.gross_weight_kg != null ? cont.gross_weight_kg.toLocaleString('pt-BR') : <NoValue label="Sem peso bruto" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DetailSection>
            ) : null}

          </>
        ) : null}
      </div>
    </Modal>
  )
}

function DetailSection({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <Block title={title} aside={aside} headingLevel={3} flush>
      <div className="app-table-scroll">{children}</div>
    </Block>
  )
}
