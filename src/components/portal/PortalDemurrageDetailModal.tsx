import { Printer } from 'lucide-react'
import { Block } from '../ui/Block'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { Modal } from '../ui/Modal'
import { ComplementMark, StatusText } from '../ui/StatusText'
import { demurrageSituation, formatUsd, isDemurragePayable } from '../../lib/portalInvoiceStatus'
import { formatBRL, formatDate } from '../../lib/utils'
import { joinDemurrageDocNumbers, type PortalDemurrageInvoice, type PortalDemurrageInvoiceDetail, type PortalDispute } from '../../services/portalBilling'
import { invoiceNetUsd } from '../../services/demurrage/demurragePresentation'
import { PortalPaymentBlock } from './PortalPixPaymentBlock'
import { DisputeSummary } from './PortalDisputeConversation'
import { Button } from '../ui/Button'

type PortalDemurrageDetailModalProps = {
  open: boolean
  invoiceId: number | null
  detail: PortalDemurrageInvoiceDetail | undefined
  loading: boolean
  /** Disputa aberta desta fatura, quando houver. */
  dispute?: PortalDispute | null
  /** Invoices anteriores do mesmo B/L que esta completa (Invoice complementar). */
  complementOf?: Array<Pick<PortalDemurrageInvoice, 'id' | 'doc_number'>>
  onClose: () => void
  /** Imprime a Invoice em aberto ou o recibo da paga. */
  onPrint: () => void
  onDispute: (invoiceId: number, docNumber: string) => void
  onShowDispute: () => void
  onOpenInvoice: (invoiceId: number) => void
}

/** Período (P1 ou P2) do contêiner numa linha: dias × diária (tabela limpa, 2026-10-15); o valor fica na coluna US$. */
function periodValue(days: number | null | undefined, rate: number | null | undefined) {
  const count = Number(days ?? 0)
  if (count <= 0) return <NoValue label="Sem dias neste período" />
  return `${count} × ${formatUsd(Number(rate ?? 0))}`
}

/** ROE com quatro casas: "R$ 5,7734". */
function formatRoe(roe: number) {
  return `R$ ${roe.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
}

/** "o contêiner X" ou "os contêineres X e Y". */
function containersPhrase(numbers: string[]) {
  if (numbers.length === 0) return 'só os contêineres que ainda não tinham sido cobrados neste B/L'
  if (numbers.length === 1) return `o contêiner ${numbers[0]}, que entrou no B/L depois`
  return `os contêineres ${numbers.slice(0, -1).join(', ')} e ${numbers[numbers.length - 1]}, que entraram no B/L depois`
}

/**
 * Detalhe da Invoice de Demurrage no Portal (lote 4 da identidade, 2026-10-18):
 * Pagamento primeiro ("R$ X a pagar hoje", o dólar, o ROE de hoje, o B/L, o
 * trecho e o Pix; na paga, "✓ Paga" com o valor e o dia), depois a Disputa
 * aberta com "Ver conversa", as Restituições, o aviso de Invoice complementar
 * e os contêineres. "Abrir disputa" fica no fim enquanto a Invoice está em
 * aberto e sem disputa.
 */
export function PortalDemurrageDetailModal({
  open,
  invoiceId,
  detail,
  loading,
  dispute,
  complementOf = [],
  onClose,
  onPrint,
  onDispute,
  onShowDispute,
  onOpenInvoice,
}: PortalDemurrageDetailModalProps) {
  const invoice = detail?.invoice

  return (
    <Modal open={open} onClose={onClose} title={(
      <>
        {`Fatura ${invoice?.doc_number ?? invoiceId ?? ''}`}
        {complementOf.length > 0 ? <> <ComplementMark of={joinDemurrageDocNumbers(complementOf.map((other) => other.doc_number))} /></> : null}
      </>
    )}>
      <div className="grid gap-5">
        {loading ? <div className="text-sm text-[var(--app-muted)]">Carregando…</div> : null}
        {detail ? (() => {
          const invoice = detail.invoice
          const situation = demurrageSituation(invoice)
          const payable = isDemurragePayable(invoice)
          const paid = situation.tone === 'paid'
          // O código Pix guardado continua na fatura depois do pagamento (Pix
          // estático): só aparece enquanto a fatura pede pagamento.
          const showPix = payable && (Boolean(invoice.pix_payload) || (['issued', 'overdue'].includes(invoice.status) && Number(invoice.current_total_brl) > 0))
          const brl = invoice.current_total_brl
          const roe = invoice.current_roe != null ? Number(invoice.current_roe) : null
          const issuedOn = invoice.billed_at ?? invoice.doc_date
          const issuedText = issuedOn ? `emitida em ${formatDate(issuedOn)}` : null
          const refunds = detail.refund_summary?.refunds ?? []
          const hasDispute = Boolean(invoice.dispute_open || dispute)
          const earlier = complementOf.map((other) => other.doc_number)
          const earlierText = joinDemurrageDocNumbers(earlier)
          const containerNumbers = detail.items.map((item) => item.container_number)

          return (
            <>
            {payable || paid ? (
              <div className="flex justify-end">
                <Button variant="secondary" onClick={onPrint}><Printer size={16} aria-hidden="true" />{paid ? 'Imprimir recibo' : 'Imprimir Invoice'}</Button>
              </div>
            ) : null}
            <PortalPaymentBlock
              situation={paid ? issuedText : <span>{issuedText ? `${issuedText} · ` : null}<StatusText tone={situation.tone}>{situation.label}</StatusText></span>}
              amount={paid
                ? <StatusText tone="paid">Paga</StatusText>
                : brl == null ? <NoValue label="Sem total em R$" />
                  : payable ? `${formatBRL(brl)} a pagar hoje` : formatBRL(brl)}
              amountLabel={paid
                ? [
                    brl != null ? `${formatBRL(brl)}${invoice.paid_at ? ` em ${formatDate(invoice.paid_at)}` : ''}` : null,
                    roe != null ? `${formatUsd(invoiceNetUsd(invoice).netUsd)} × ${formatRoe(roe)}` : null,
                  ].filter(Boolean).join(' · ')
                : payable ? 'O valor em reais acompanha a cotação do dia até o pagamento.' : 'Total em reais'}
              amountTone={payable && Number(brl ?? 0) > 0 ? 'warning' : 'default'}
              facts={[
                { label: 'Total em dólar', value: formatUsd(invoice.total_usd) },
                { label: payable ? 'ROE de hoje' : 'ROE aplicado', value: roe != null ? formatRoe(roe) : <NoValue label="Sem ROE" /> },
                { label: 'B/L', value: <CopyValue value={invoice.bl_id} label="número do B/L" /> },
                { label: 'Trecho', value: invoice.pol || invoice.pod ? `${invoice.pol ?? '—'} → ${invoice.pod ?? '—'}` : <NoValue label="Sem trecho" /> },
              ]}
              factColumns={4}
              pix={showPix ? invoice.pix_payload : undefined}
            />

            {hasDispute ? (
              <Block
                title="Disputa"
                headingLevel={3}
                aside={(
                  <>
                    {dispute ? <DisputeSummary dispute={dispute} /> : <span>aberta</span>}
                    <Button variant="secondary" className="app-btn--sm" onClick={onShowDispute}>Ver conversa</Button>
                  </>
                )}
                flush
              >
                {null}
              </Block>
            ) : null}

            {refunds.length ? (
              <Block title="Restituições" aside={refunds.length} headingLevel={3} flush>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact text-sm">
                    <caption className="sr-only">Restituições ao Cliente desta Invoice</caption>
                    <thead>
                      <tr>
                        <th scope="col">Valor</th>
                        <th scope="col">Situação</th>
                        <th scope="col">Devolvido em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refunds.map((refund) => (
                        <tr key={refund.id}>
                          <td className="whitespace-nowrap tabular-nums">{formatBRL(refund.amount_brl)}</td>
                          <td className="whitespace-nowrap">{refund.status === 'settled' ? 'Devolvida' : 'A devolver'}</td>
                          <td className="whitespace-nowrap tabular-nums">{refund.status === 'settled' && refund.settled_at ? formatDate(refund.settled_at) : <NoValue label="Ainda não devolvida" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Block>
            ) : null}

            {earlier.length ? (
              <Block
                title="Invoice complementar"
                headingLevel={3}
                aside={(
                  <>
                    <span>do mesmo B/L</span>
                    {complementOf.map((other) => (
                      <Button key={other.id} variant="secondary" className="app-btn--sm" onClick={() => onOpenInvoice(other.id)}>Abrir {other.doc_number}</Button>
                    ))}
                  </>
                )}
              >
                <p className="text-sm text-[var(--app-muted)]">
                  Completa a <strong className="text-[var(--app-text-strong)]">{earlierText}</strong>: cobra {containersPhrase(containerNumbers)}
                  {containerNumbers.length ? (earlier.length === 1 ? ' da primeira Invoice' : ' dessas Invoices') : ''}.{' '}
                  {earlier.length === 1 ? `A ${earlierText} continua valendo e é paga à parte.` : 'Elas continuam valendo e são pagas à parte.'}
                  {' '}O documento impresso traz o mesmo aviso.
                </p>
              </Block>
            ) : null}

            <Block title="Contêineres" aside={detail.items.length} headingLevel={3} flush>
              <div className="app-table-scroll">
                <table className="app-table app-table--compact text-sm">
                  <caption className="sr-only">Contêineres e valores da Invoice de Demurrage</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Contêiner</th>
                      <th scope="col" className="px-3 py-2">Tipo</th>
                      <th scope="col" className="px-3 py-2">Descarga</th>
                      <th scope="col" className="px-3 py-2">Devolução</th>
                      <th scope="col" className="px-3 py-2">Dias</th>
                      <th scope="col" className="px-3 py-2">Free time</th>
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
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{periodValue(item.days_p1, item.rate_p1_usd)}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{periodValue(item.days_p2, item.rate_p2_usd)}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatUsd(item.subtotal_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Block>

            {payable && !hasDispute ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" className="app-btn--sm" onClick={() => onDispute(invoice.id, invoice.doc_number)}>Abrir disputa</Button>
                <span className="text-sm text-[var(--app-muted)]">se discordar de algum valor</span>
              </div>
            ) : null}
            </>
          )
        })() : null}
      </div>
    </Modal>
  )
}
