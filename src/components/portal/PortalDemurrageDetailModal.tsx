import { Printer } from 'lucide-react'
import { Block } from '../ui/Block'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { Modal } from '../ui/Modal'
import { StatusText } from '../ui/StatusText'
import { demurrageSituation, formatUsd, isDemurragePayable } from '../../lib/portalInvoiceStatus'
import { formatBRL, formatDate } from '../../lib/utils'
import type { PortalDemurrageInvoiceDetail, PortalDispute } from '../../services/portalBilling'
import { PortalPaymentBlock } from './PortalPixPaymentBlock'
import { roundCents } from '../../services/demurrage/demurrageNetUsd'
import { Button } from '../ui/Button'

type PortalDemurrageDetailModalProps = {
  open: boolean
  invoiceId: number | null
  detail: PortalDemurrageInvoiceDetail | undefined
  loading: boolean
  /** Disputa aberta desta fatura, quando houver. */
  dispute?: PortalDispute | null
  onClose: () => void
  onPrint: () => void
  onDispute: (invoiceId: number, docNumber: string) => void
  onShowDispute: () => void
}

/**
 * Detalhe da fatura de Demurrage no Portal (lote 1 da identidade, 2026-10-14):
 * Pagamento primeiro (total em R$ de hoje e o Pix), depois os contêineres. A
 * disputa fica no fim, discreta: "Discorda de algum valor? Abrir disputa"
 * enquanto a fatura não está paga, cancelada ou já em disputa.
 */
/** Valor de um período (P1 ou P2) do container: dias × diária, em centavos como o banco (B30). */
function periodValue(days: number | null | undefined, rate: number | null | undefined) {
  const count = Number(days ?? 0)
  if (count <= 0) return <NoValue label="Sem dias neste período" />
  const daily = Number(rate ?? 0)
  return (
    <span className="app-table__cell-stack">
      <span>{formatUsd(roundCents(count * daily))}</span>
      <span className="text-xs text-[var(--app-muted)]">{count} {count === 1 ? 'dia' : 'dias'} × {formatUsd(daily)}</span>
    </span>
  )
}

export function PortalDemurrageDetailModal({
  open,
  invoiceId,
  detail,
  loading,
  dispute,
  onClose,
  onPrint,
  onDispute,
  onShowDispute,
}: PortalDemurrageDetailModalProps) {
  const invoice = detail?.invoice

  return (
    <Modal open={open} onClose={onClose} title={`Fatura ${invoice?.doc_number ?? invoiceId ?? ''}`}>
      <div className="grid gap-5">
        {loading ? <div className="text-sm text-[var(--app-muted)]">Carregando...</div> : null}
        {detail ? (() => {
          const invoice = detail.invoice
          const situation = demurrageSituation(invoice)
          const payable = isDemurragePayable(invoice)
          // O código Pix guardado continua na fatura depois do pagamento (Pix
          // estático): só aparece enquanto a fatura pede pagamento.
          const showPix = payable && (Boolean(invoice.pix_payload) || (['issued', 'overdue'].includes(invoice.status) && Number(invoice.current_total_brl) > 0))
          const containerCount = detail.items.length === 1 ? '1 contêiner' : `${detail.items.length} contêineres`
          return (
            <>
            {invoice.status === 'paid' ? <div className="flex justify-end"><Button variant="secondary" onClick={onPrint}><Printer size={16} />Imprimir recibo</Button></div> : null}
            <PortalPaymentBlock
              situation={<StatusText tone={situation.tone}>{situation.label}</StatusText>}
              amountLabel={payable ? 'Total a pagar hoje' : 'Total em reais'}
              amount={invoice.current_total_brl != null ? formatBRL(invoice.current_total_brl) : <NoValue label="Sem total em R$" />}
              amountTone={payable && Number(invoice.current_total_brl ?? 0) > 0 ? 'warning' : 'default'}
              facts={[
                { label: 'Total em dólar', value: formatUsd(invoice.total_usd) },
                { label: payable ? 'ROE de hoje' : 'ROE aplicado', value: invoice.current_roe != null ? `R$ ${Number(invoice.current_roe).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}` : <NoValue label="Sem ROE" /> },
                ...(payable ? [{ label: 'Como pagar', value: 'Pix' }] : []),
              ]}
              pix={showPix ? invoice.pix_payload : undefined}
            />
            {payable ? (
              <p className="text-xs text-[var(--app-muted)]">
                O valor em reais acompanha a cotação diária até o pagamento (fonte {portalRoeSourceLabel(invoice.roe_source)}).
              </p>
            ) : null}

            <Block title="Contêineres" aside={[`B/L ${invoice.bl_id}`, invoice.pol || invoice.pod ? `${invoice.pol ?? '—'} → ${invoice.pod ?? '—'}` : null, containerCount].filter(Boolean).join(' · ')} headingLevel={3} flush>
              <div className="app-table-scroll">
                <table className="app-table app-table--compact text-sm">
                  <caption className="sr-only">Containers e valores da invoice de demurrage</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Contêiner</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">Descarga</th>
                      <th scope="col" className="px-3 py-2">Devolução</th>
                      <th scope="col" className="px-3 py-2">Dias</th>
                      <th scope="col" className="px-3 py-2">Free time</th>
                      <th scope="col" className="px-3 py-2">Dias cobrados</th>
                      <th scope="col" className="px-3 py-2">1º período</th>
                      <th scope="col" className="px-3 py-2">2º período</th>
                      <th scope="col" className="px-3 py-2">US$</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td className="whitespace-nowrap px-3 py-2 font-semibold"><CopyValue value={item.container_number} label="número do contêiner" /></td>
                        <td className="px-3 py-2">{item.container_type}</td>
                        <td className="whitespace-nowrap px-3 py-2">{item.discharge_date ? formatDate(item.discharge_date) : <NoValue label="Sem data de descarga" />}</td>
                        <td className="whitespace-nowrap px-3 py-2">{item.return_date ? formatDate(item.return_date) : <NoValue label="Sem data de devolução" />}</td>
                        <td className="px-3 py-2 tabular-nums">{item.total_days}</td>
                        <td className="px-3 py-2 tabular-nums">{item.free_days}</td>
                        <td className="px-3 py-2 tabular-nums">{Number(item.days_p1 ?? 0) + Number(item.days_p2 ?? 0)}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{periodValue(item.days_p1, item.rate_p1_usd)}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{periodValue(item.days_p2, item.rate_p2_usd)}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatUsd(item.subtotal_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Block>

            {invoice.dispute_open || dispute ? (
              <p className="text-right text-sm text-[var(--app-muted)]">
                Disputa aberta{dispute ? ` em ${formatDate(dispute.created_at)}` : ''} ·{' '}
                <button type="button" className="app-invoices__number" onClick={onShowDispute}>ver mensagens</button>
              </p>
            ) : payable ? (
              <p className="text-right text-sm text-[var(--app-muted)]">
                Discorda de algum valor?{' '}
                <button type="button" className="app-invoices__number" onClick={() => onDispute(invoice.id, invoice.doc_number)}>Abrir disputa</button>
              </p>
            ) : null}
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
