import type { ReactNode } from 'react'
import { Printer, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { Block } from '../ui/Block'
import { ConsolidatedMark, StatusText } from '../ui/StatusText'
import { Modal } from '../ui/Modal'
import { paymentMethodLabel } from '../billing/invoiceDetailPresentation'
import { formatBRL, formatDate, splitIsoDateTime, stripBlPrefix } from '../../lib/utils'
import { invoiceItemUnit } from '../../lib/invoiceItemUnit'
import { invoiceSituation } from '../../lib/invoiceSituation'
import { formatPortalPaymentDate } from '../../lib/portalInvoiceStatus'
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

type Invoice = NonNullable<PortalInvoiceDetail['invoice']>
type Bl = PortalInvoiceDetail['bls'][number]

const PAYABLE = ['issued', 'partially_paid', 'overdue']
const CANCELLED = ['cancelled', 'obsolete']

const voyageOf = (vessel?: string | null, voyage?: string | null) => [vessel, voyage].filter(Boolean).join(' / ')
const countLabel = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`

/**
 * Detalhe da fatura de Taxas Locais no Portal (lote 4 da identidade,
 * 2026-10-18). O bloco Pagamento vem primeiro e diz o que fazer: "R$ … a
 * pagar" em âmbar com o Pix ao lado; "Paga", "Coberta" ou "Cancelada" nos
 * demais estados. Na fatura de um B/L, o B/L, o navio e o trecho são dados do
 * Pagamento; na consolidada, a tabela B/Ls e a coluna B/L nos itens e nos
 * contêineres. Pagamentos recebidos aparecem quando há pagamento.
 */
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
  const bls = detail?.bls ?? []
  const items = detail?.items ?? []
  const containers = detail?.containers ?? []
  const payments = [...(detail?.payments ?? [])].sort((a, b) => String(a.paid_at ?? '').localeCompare(String(b.paid_at ?? '')))
  const isConsolidated = invoice?.invoice_type === 'consolidated'
  // A coluna B/L dos itens e dos contêineres e a tabela B/Ls só na fatura de mais de um B/L.
  const multipleBls = isConsolidated || bls.length > 1
  const cancelled = CANCELLED.includes(invoice?.status ?? '')
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount_brl ?? 0), 0)

  return (
    <Modal open={open} onClose={onClose} title={`Fatura ${invoice?.invoice_number ?? invoiceId ?? ''}`}>
      <div className="grid gap-5">
        {loading ? <div className="text-sm text-[var(--app-muted)]">Carregando detalhe...</div> : null}
        {error ? <div className="text-sm text-[var(--app-red)]">Falha ao carregar detalhe da fatura.</div> : null}
        {invoice ? (
          <>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isConsolidated ? <ConsolidatedMark /> : null}
              {canObsolete && isConsolidated ? (
                <Button variant="secondary" loading={obsoleteLoading} onClick={onObsolete}>
                  <RotateCcw size={16} />
                  Refazer consolidada
                </Button>
              ) : null}
              <Button variant="secondary" onClick={onPrint}>
                <Printer size={16} />
                Imprimir fatura
              </Button>
              {invoice.status === 'paid' ? (
                <Button variant="secondary" onClick={onPrintReceipt}>
                  <Printer size={16} />
                  Imprimir recibo
                </Button>
              ) : null}
            </div>

            <PaymentSummary invoice={invoice} bls={bls} multipleBls={multipleBls} payments={payments} onOpenInvoice={onOpenInvoice} />

            {detail?.corrections?.length ? (
              <Block title="Ajustes por correção" headingLevel={3}>
                <p className="text-sm">O total e os itens originais da fatura foram preservados. O saldo a pagar considera os abatimentos abaixo.</p>
                {detail.corrections.map((correction, index) => <p key={index} className="text-sm">B/L {correction.bl_id}: redução de {formatBRL(correction.amount_brl)}, com {formatBRL(correction.offset_brl)} abatidos do saldo e {formatBRL(correction.refund_brl)} registrados para restituição.</p>)}
              </Block>
            ) : null}

            {payments.length > 0 ? (
              <DetailSection title="Pagamentos recebidos" aside={`total pago ${formatBRL(paidTotal)}`}>
                <table className="app-table app-table--compact text-sm">
                  <caption className="sr-only">Pagamentos recebidos nesta fatura</caption>
                  <thead>
                    <tr>
                      <th scope="col">Recebido em</th>
                      <th scope="col">Forma de pagamento</th>
                      <th scope="col">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="whitespace-nowrap tabular-nums">{formatPortalPaymentDate(payment.paid_at) || <NoValue label="Sem data do pagamento" />}</td>
                        <td>{paymentMethodLabel(payment.payment_method)}</td>
                        <td className="whitespace-nowrap tabular-nums">{formatBRL(payment.amount_brl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DetailSection>
            ) : null}

            {multipleBls && bls.length > 0 ? (
              <DetailSection title="B/Ls" aside={bls.length}>
                <table className="app-table app-table--compact text-sm">
                  <caption className="sr-only">B/Ls incluídos na fatura</caption>
                  <thead>
                    <tr>
                      <th scope="col">B/L</th>
                      <th scope="col">Trecho</th>
                      <th scope="col">Itens</th>
                      <th scope="col">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bls.map((row) => (
                      <tr key={row.id}>
                        <td><CopyValue value={row.bl_id} label="número do B/L" /></td>
                        <td className="whitespace-nowrap"><Route bl={row} /></td>
                        <td className="tabular-nums">{items.filter((item) => item.bl_id === row.bl_id).length}</td>
                        <td className="whitespace-nowrap tabular-nums">{formatBRL(row.subtotal_brl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DetailSection>
            ) : null}

            {items.length > 0 ? (
              <DetailSection
                title="Itens da fatura"
                aside={`${countLabel(items.length, 'item', 'itens')}${invoice.status === 'covered' ? ' · valores levados para a consolidada' : ''}`}
              >
                <table className="app-table app-table--compact text-sm">
                  <caption className="sr-only">Itens cobrados na fatura</caption>
                  <thead>
                    <tr>
                      {multipleBls ? <th scope="col">B/L</th> : null}
                      <th scope="col" className="app-table__text-head">Descrição</th>
                      <th scope="col">Qtd.</th>
                      <th scope="col">Unitário</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className={cancelled ? 'app-table__row--muted' : undefined}>
                        {multipleBls ? <td className="whitespace-nowrap">{item.bl_id ?? <NoValue label="Sem B/L" />}</td> : null}
                        <td className="app-table__text app-table__text--wrap">{stripBlPrefix(item.description, item.bl_id)}</td>
                        <td className="tabular-nums">{String(Number(item.quantity ?? 1)).replace('.', ',')}</td>
                        <td className="whitespace-nowrap tabular-nums">{invoiceItemUnit(item) ?? <NoValue label="Sem valor unitário" />}</td>
                        <td className="whitespace-nowrap tabular-nums">{formatBRL(item.total_value_brl)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {/* O total no pé, fora das linhas de item; a cancelada não cobra e um item só já é o total. */}
                  {!cancelled && items.length > 1 ? (
                    <tfoot>
                      <tr>
                        <th scope="row" className="app-table__text" colSpan={3 + Number(multipleBls)}>Total da fatura</th>
                        <td className="whitespace-nowrap font-semibold tabular-nums">{formatBRL(invoice.total_brl)}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </DetailSection>
            ) : null}

            {containers.length > 0 ? (
              <DetailSection title="Contêineres" aside={containers.length}>
                <table className="app-table app-table--compact text-sm">
                  <caption className="sr-only">Contêineres da fatura</caption>
                  <thead>
                    <tr>
                      <th scope="col">Contêiner</th>
                      <th scope="col">Tipo</th>
                      {multipleBls ? <th scope="col">B/L</th> : null}
                      <th scope="col">Lacre</th>
                      <th scope="col">Peso bruto (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containers.map((cont) => (
                      <tr key={cont.id}>
                        <td><CopyValue value={cont.container_number} label="número do contêiner" /></td>
                        <td>{cont.type ?? <NoValue label="Sem tipo" />}</td>
                        {multipleBls ? <td className="whitespace-nowrap">{cont.bl_id ?? <NoValue label="Sem B/L" />}</td> : null}
                        <td>{cont.seal_number ?? <NoValue label="Sem lacre" />}</td>
                        <td className="tabular-nums">{cont.gross_weight_kg != null ? Number(cont.gross_weight_kg).toLocaleString('pt-BR') : <NoValue label="Sem peso bruto" />}</td>
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

/**
 * Bloco Pagamento: o dado principal conforme a situação e, como fatos, o que
 * identifica a cobrança (B/L, navio, trecho; na avulsa, a descrição).
 */
function PaymentSummary({ invoice, bls, multipleBls, payments, onOpenInvoice }: {
  invoice: Invoice
  bls: Bl[]
  multipleBls: boolean
  payments: PortalInvoiceDetail['payments']
  onOpenInvoice?: (invoiceId: number) => void
}) {
  const status = invoice.status ?? 'issued'
  const payable = PAYABLE.includes(status)
  const cancelled = CANCELLED.includes(status)
  const balance = Number(invoice.balance_brl ?? 0)
  const received = Number(invoice.total_paid_brl ?? 0)
  const isManual = invoice.invoice_type === 'manual'
  const singleBl = !multipleBls && bls.length === 1 ? bls[0] : null
  const voyage = voyageOf(invoice.vessel_name, invoice.voyage_number)
    || Array.from(new Set(bls.map((row) => voyageOf(row.vessel_name, row.voyage_number)).filter(Boolean))).join(', ')
  // O código Pix guardado continua na fatura depois do pagamento: só aparece enquanto ela pede pagamento.
  const showPix = payable && Boolean(invoice.pix_payload || Number(invoice.balance_brl ?? invoice.total_brl) > 0)

  const issued = invoice.issued_at ? `emitida em ${formatDate(invoice.issued_at)}` : null
  const situation = [
    multipleBls ? `${invoiceTypeLabel(invoice.invoice_type)} · ${countLabel(bls.length, 'B/L', 'B/Ls')}` : invoiceTypeLabel(invoice.invoice_type),
    issued,
    // Paga, Coberta e Cancelada já são o dado principal.
    payable ? invoiceSituation(status).label : null,
  ].filter(Boolean).join(' · ')

  const facts: Array<{ label: string; value: ReactNode; wide?: boolean; className?: string }> = []
  if (isManual && invoice.notes) facts.push({ label: 'Descrição', value: invoice.notes, wide: true })
  // No celular o B/L ocupa a linha: o número não cabe em meia coluna com o ícone de copiar.
  if (singleBl) facts.push({ label: 'B/L', value: <CopyValue value={singleBl.bl_id} label="número do B/L" />, className: 'max-sm:col-span-2' })
  if (voyage || !isManual) facts.push({ label: 'Navio / Viagem', value: voyage || <NoValue label="Sem navio e viagem" /> })
  if (singleBl) facts.push({ label: 'Trecho', value: <Route bl={singleBl} /> })
  if (multipleBls) facts.push({ label: 'B/Ls', value: bls.length })
  if (payable) facts.push({ label: 'Recebido', value: formatBRL(received) })
  if (cancelled) facts.push({ label: 'Total cancelado', value: formatBRL(invoice.total_brl) })

  let amount: ReactNode
  let tone: 'default' | 'warning' | 'muted' = 'default'
  let leadAction: ReactNode = null
  if (status === 'paid') {
    const lastPaidAt = payments.map((payment) => payment.paid_at).filter(Boolean).sort().at(-1)
    const paidDay = lastPaidAt ? splitIsoDateTime(lastPaidAt).date : ''
    amount = <><StatusText tone="paid">Paga</StatusText> <span className="app-lead__unit">{formatBRL(received)} recebidos{paidDay ? ` em ${formatDate(paidDay)}` : ''}</span></>
  } else if (status === 'covered') {
    const coveredBy = invoice.covered_by_invoice_number
    amount = <>Coberta <span className="app-lead__unit">{coveredBy ? `pela consolidada ${coveredBy}` : 'por uma fatura consolidada'}</span></>
    leadAction = (
      <div className="flex flex-wrap items-center gap-2">
        {invoice.covered_by_invoice_id && onOpenInvoice ? (
          <Button className="app-btn--sm" onClick={() => onOpenInvoice(invoice.covered_by_invoice_id!)}>
            Abrir {coveredBy ?? 'a consolidada'}
          </Button>
        ) : null}
        {/* Coberta = a consolidada foi paga e quitou este B/L (faturamento.md). */}
        <span className="text-xs text-[var(--app-muted)]">O pagamento e o recibo são os da consolidada.</span>
      </div>
    )
  } else if (status === 'obsolete') {
    // Consolidada substituída (ADR 0093, decisão 8): sem QR; a sucessora cobra o restante.
    const replacedBy = invoice.replaced_by_invoice_number
    amount = <>Substituída <span className="app-lead__unit">{replacedBy ? `pela ${replacedBy}` : 'por outra fatura'}</span></>
    tone = 'muted'
    leadAction = invoice.replaced_by_invoice_id && onOpenInvoice ? (
      <Button className="app-btn--sm" onClick={() => onOpenInvoice(invoice.replaced_by_invoice_id!)}>
        Abrir {replacedBy ?? 'a fatura nova'}
      </Button>
    ) : null
  } else if (cancelled) {
    amount = 'Cancelada'
    tone = 'muted'
  } else {
    const partial = received > 0 && balance > 0
    amount = <>{formatBRL(balance)} a pagar{partial ? <> <span className="app-lead__unit">de {formatBRL(invoice.total_brl)}</span></> : null}</>
    tone = balance > 0 ? 'warning' : 'default'
  }

  return (
    <PortalPaymentBlock
      situation={situation}
      amount={amount}
      amountTone={tone}
      facts={facts}
      factColumns={4}
      leadAction={leadAction}
      pix={showPix ? invoice.pix_payload : undefined}
      pixNote={showPix && received > 0 && balance > 0 ? `o QR cobra o saldo, ${formatBRL(balance)}` : undefined}
    />
  )
}

function Route({ bl }: { bl: Bl }) {
  return <>{bl.pol ?? <NoValue label="Sem porto de origem" />} → {bl.pod ?? <NoValue label="Sem porto de destino" />}</>
}

function DetailSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Block title={title} aside={aside} headingLevel={3} flush>
      <div className="app-table-scroll">{children}</div>
    </Block>
  )
}
