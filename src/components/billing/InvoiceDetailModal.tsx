import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, DollarSign, Printer, RotateCcw } from 'lucide-react'
import { StaleInvoiceResolutionPanel } from './StaleInvoiceResolutionPanel'
import { FinancialRefundsPanel } from './FinancialRefundsPanel'
import { InvoiceCorrectionPanel } from './InvoiceCorrectionPanel'
import { InvoiceDocumentLocal } from './InvoiceDocumentLocal'
import { describeInvoiceAmounts, invoiceStatusTag, paymentMethodLabel } from './invoiceDetailPresentation'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { SkeletonTable } from '../ui/Skeleton'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import {
  useCancelInvoice,
  useInvoiceDetail,
  useInvoiceReissueLinks,
  useRegisterInvoicePayment,
} from '../../hooks/useBilling'
import {
  reverseLocalPaymentAndInvalidate,
  useInvoiceRefunds,
  useRegisterLedgerInvoicePayment,
  useSettleInvoiceRefund,
} from '../../hooks/useBillingLedger'
import { useCancelFinancialRefundAuthorization, useFinancialRefunds } from '../../hooks/useFinancialRefunds'
import { invoiceTypeLabel, isManualInvoice } from '../../services/billing'
import { parseImportNumber } from '../../lib/importNumber'
import { buildInvoiceFileBaseName, describeInvoiceItemsFreezeNote, describeUsdConversionNote } from '../shared/invoiceFormat'
import { formatValidationError, paymentFormSchema } from '../../services/financialValidation'
import { logOperationalEvent } from '../../services/operationalEvents'
import { formatBRL, formatCnpjCpf, formatDate, stripBlPrefix } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { canRegisterInvoicePayment, isLedgerInvoicePayable } from '../../pages/faturamentoLedgerPayment'
import { printDocumentElement } from '../../lib/printDocument'

type PaymentMethod = 'pix' | 'ted' | 'doc' | 'boleto' | 'outros'

type InvoiceDetailModalProps = {
  invoiceId: number | null
  onClose: () => void
  /** Aberto pela Conciliação para cancelar uma baixa: esconde registro de pagamento e cancelamento da fatura. */
  enablePaymentReversal?: boolean
  paymentId?: number | null
}

/**
 * Detalhe interno da fatura de Taxas Locais (Vela), usado por `/taxas-locais`
 * e pela Conciliação. Uma superfície com seções separadas por filete; a
 * impressão troca o conteúdo do mesmo modal (sem modal sobre modal) e as
 * confirmações de devolução e de cancelamento de baixa abrem dentro da seção.
 * As ações que o banco restringe ao Administrativo (baixa, cancelamento da
 * fatura e da baixa) aparecem só para ele; os demais leem o motivo.
 */
export function InvoiceDetailModal({ invoiceId, onClose, enablePaymentReversal, paymentId }: InvoiceDetailModalProps) {
  const { user, isAdmin, can } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [view, setView] = useState<'detail' | 'invoice' | 'receipt'>('detail')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [ledgerPaymentRequestId, setLedgerPaymentRequestId] = useState<string | null>(null)
  const [paymentAttempt, setPaymentAttempt] = useState<{ invoiceId: number; amountBrl: number; method: PaymentMethod; paidAt: string; notes: string | null; requestId: string; bankReference: string } | null>(null)
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null)
  const [reversalOpen, setReversalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState('')
  const [reversalReason, setReversalReason] = useState('')
  const [reversalError, setReversalError] = useState('')
  const [reversalLoading, setReversalLoading] = useState(false)
  const [refundToConfirm, setRefundToConfirm] = useState<number | null>(null)
  const [refundReference, setRefundReference] = useState('')
  const [refundBeneficiary, setRefundBeneficiary] = useState('')
  const [refundDate, setRefundDate] = useState('')
  const [refundError, setRefundError] = useState('')
  const [authorizationToCancel, setAuthorizationToCancel] = useState<number | null>(null)
  const [authorizationReason, setAuthorizationReason] = useState('')

  const [previousInvoiceId, setPreviousInvoiceId] = useState(invoiceId)
  if (previousInvoiceId !== invoiceId) {
    setPreviousInvoiceId(invoiceId)
    setView('detail')
    setPaymentAttempt(null)
    setLedgerPaymentRequestId(null)
    setSelectedPaymentId(null)
    setReversalOpen(false)
    setReversalReason('')
    setReversalError('')
    setPaymentAmount('')
    setPaymentDate('')
    setPaymentNotes('')
    setPaymentReference('')
    setPaymentError('')
    setCancelReason('')
    setCancelError('')
    setRefundToConfirm(null)
    setRefundReference('')
    setRefundBeneficiary('')
    setRefundDate('')
    setRefundError('')
    setAuthorizationToCancel(null)
    setAuthorizationReason('')
  }

  const detailQuery = useInvoiceDetail(invoiceId)
  const refundsQuery = useInvoiceRefunds(invoiceId)
  const refunds = refundsQuery.data ?? []
  const settleRefundMutation = useSettleInvoiceRefund()
  const canSettleRefund = typeof can === 'function' ? can('settle_financial_adjustments') : isAdmin
  const detail = detailQuery.data ?? null
  const detailInvoice = detail?.invoice ?? null
  const detailIsManual = isManualInvoice(detailInvoice)
  // Autorizações excepcionais da avulsa: só elas podem ser canceladas, e só esta leitura traz o request_id.
  const manualRefundsQuery = useFinancialRefunds('manual', detailIsManual ? invoiceId : null)
  const authorizationIds = new Set((manualRefundsQuery.data?.refunds ?? []).filter((row) => row.request_id).map((row) => row.id))
  const cancelAuthorizationMutation = useCancelFinancialRefundAuthorization()
  const voyageParts = [detailInvoice?.vessel_name, detailInvoice?.voyage_number].filter(Boolean).join(' · ')
    || Array.from(new Set((detail?.bls ?? []).map((b) => [b.vessel_name, b.voyage_number].filter(Boolean).join(' · ')).filter(Boolean))).join(', ')
  const isLedgerPayable = isLedgerInvoicePayable(detailInvoice)
  const canRegisterPayment = canRegisterInvoicePayment(detailInvoice)
  const isCancelled = ['cancelled', 'obsolete'].includes(detailInvoice?.status ?? '')
  const registerPaymentMutation = useRegisterInvoicePayment()
  const registerLedgerPaymentMutation = useRegisterLedgerInvoicePayment()
  const paymentPending = registerPaymentMutation.isPending || registerLedgerPaymentMutation.isPending
  const cancelInvoiceMutation = useCancelInvoice()
  const reissueLinksQuery = useInvoiceReissueLinks(invoiceId)
  const reissueLinks = reissueLinksQuery.data ?? null
  const payments = detail?.payments ?? []
  const status = invoiceStatusTag(detailInvoice?.status)
  const amounts = detail ? describeInvoiceAmounts(detail, refunds) : []
  const showReceipt = ['paid', 'covered'].includes(detailInvoice?.status ?? '') || (detailInvoice?.status === 'cancelled' && Number(detailInvoice?.total_paid_brl ?? 0) > 0)

  const ledgerBalance = Number(detailInvoice?.balance_brl ?? detailInvoice?.total_brl ?? 0)
  const reversalPayment = payments.find((payment) => payment.id === (selectedPaymentId ?? paymentId))
  const reversalPaymentId = reversalPayment?.id ?? null
  const reversalFormVisible = isAdmin && payments.length > 0 && (Boolean(enablePaymentReversal) || reversalOpen)
  // Valor em pt-BR ("1.234,56"), como no registro do pagamento.
  const parsedPayment = parseImportNumber(paymentAmount, 'pt-BR')
  const typedPayment = parsedPayment.kind === 'value' ? Number(parsedPayment.decimal) : 0
  // Ajuste durante o render (em vez de useEffect) quando o alvo do prefill muda.
  const ledgerPrefill = isLedgerPayable ? `${invoiceId}:${ledgerBalance}` : null
  const [prevLedgerPrefill, setPrevLedgerPrefill] = useState<string | null>(null)
  if (ledgerPrefill !== prevLedgerPrefill) {
    setPrevLedgerPrefill(ledgerPrefill)
    if (ledgerPrefill !== null && (!paymentAttempt || paymentAttempt.invoiceId !== invoiceId)) {
      setPaymentAmount(ledgerBalance ? String(ledgerBalance).replace('.', ',') : '')
    }
  }

  async function handleRegisterPayment() {
    if (!invoiceId) return
    setPaymentError('')
    if (paymentReference.trim().length < 3) { setPaymentError('Informe a referência do recebimento no extrato bancário.'); return }
    const paymentValidation = paymentFormSchema.safeParse({
      amountBrl: paymentAmount,
      paymentMethod,
      paidAt: paymentDate,
    })
    if (!paymentValidation.success) {
      setPaymentError(formatValidationError(paymentValidation.error, 'Valor de pagamento inválido.'))
      return
    }
    const payment = paymentValidation.data
    const retryAttempt = paymentAttempt?.invoiceId === invoiceId ? paymentAttempt : null
    const amountBrl = retryAttempt?.amountBrl ?? payment.amountBrl
    const duplicates = !retryAttempt && payments.some((existing) =>
      Number(existing.amount_brl) === amountBrl && existing.payment_method === payment.paymentMethod &&
      (!payment.paidAt || existing.paid_at?.slice(0, 10) === payment.paidAt))
    const remaining = Math.max(ledgerBalance - payment.amountBrl, 0)
    const accepted = await confirm({
      title: duplicates ? 'Possível pagamento duplicado' : remaining > 0 ? 'Registrar pagamento parcial?' : 'Registrar pagamento?',
      message: `${duplicates ? 'Já existe pagamento com valor, método e data compatíveis. Confira se são recebimentos distintos. ' : ''}Valor recebido: ${formatBRL(amountBrl)}. Saldo após o pagamento: ${formatBRL(remaining)}.${amountBrl > ledgerBalance ? ` Será registrada restituição de ${formatBRL(amountBrl - ledgerBalance)} pelo excedente.` : ''}`,
      consequence: 'Registre somente o dinheiro efetivamente recebido. Se o B/L for corrigido depois, a fatura com pagamento não é reemitida: aumento vira fatura avulsa e redução abate o saldo, com restituição do que passar dele.',
      reversibility: 'Cancelar a baixa exige justificativa e permissão. Isso registra que o dinheiro não foi recebido.',
      confirmLabel: 'Confirmar pagamento recebido',
    })
    if (!accepted) return
    try {
      const requestId = ledgerPaymentRequestId ?? crypto.randomUUID()
      setLedgerPaymentRequestId(requestId)
      const attempt = retryAttempt ?? {
        invoiceId, amountBrl: payment.amountBrl, method: payment.paymentMethod,
        paidAt: new Date(`${payment.paidAt}T12:00:00`).toISOString(),
        notes: paymentNotes.trim() || null, requestId, bankReference: paymentReference.trim(),
      }
      setPaymentAttempt(attempt)
      if (!detailIsManual) {
        await registerLedgerPaymentMutation.mutateAsync({ ...attempt, source: 'manual', actorId: user?.id ?? null })
      } else {
        await registerPaymentMutation.mutateAsync({ ...attempt, paymentMethod: attempt.method, actorId: user?.id ?? null })
      }
      setPaymentAmount('')
      setPaymentDate('')
      setPaymentNotes('')
      setPaymentReference('')
      setLedgerPaymentRequestId(null)
      setPaymentAttempt(null)
      showToast('Pagamento registrado.', 'success')
    } catch (error) {
      const msg = userFacingErrorMessage(error, 'Falha ao registrar pagamento.')
      setPaymentError(`${msg} Confira o histórico de pagamentos antes de tentar novamente.`)
      showToast(msg, 'error')
      void logOperationalEvent({ code: 'invoice_payment_invalid', message: msg, changedBy: user?.id ?? null, entityId: String(invoiceId ?? '') })
    }
  }

  async function handleReleasePaymentAttempt() {
    if (!paymentAttempt) return
    if (!await confirm({ title: 'Encerrar tentativa após conferir o histórico?',
      message: `${formatBRL(paymentAttempt.amountBrl)} · referência ${paymentAttempt.bankReference}.`,
      consequence: 'Confira primeiro se o banco e o histórico já mostram este recebimento. Encerrar a tentativa libera os campos; não cancela uma baixa nem devolve dinheiro.',
      reversibility: 'Uma nova operação terá outra chave. A referência bancária continua protegida contra duplicação.', confirmLabel: 'Conferi; liberar campos' })) return
    setPaymentAttempt(null)
    setLedgerPaymentRequestId(null)
    setPaymentError('')
  }

  async function handleCancelInvoice() {
    if (!invoiceId) return
    setCancelError('')
    const reason = cancelReason.trim()
    if (!reason) {
      setCancelError('Informe a justificativa para cancelar a fatura.')
      return
    }
    if (!await confirm({
      title: 'Cancelar esta fatura?',
      message: `Fatura ${detailInvoice?.invoice_number ?? invoiceId} · ${formatBRL(detailInvoice?.total_brl)}. Motivo: ${reason}.`,
      consequence: detailIsManual
        ? 'A avulsa deixa de ser cobrada do Cliente. O documento e o motivo ficam no histórico.'
        : 'A fatura deixa de ser cobrada e os B/Ls voltam a aguardar emissão. Cancelar a fatura não cancela o B/L.',
      reversibility: 'Fatura cancelada não é reativada; uma nova cobrança exige nova emissão.',
      confirmLabel: 'Cancelar fatura',
    })) return
    try {
      await cancelInvoiceMutation.mutateAsync({
        invoiceId,
        reason,
        actorId: user?.id ?? null,
      })
      setCancelReason('')
      showToast('Fatura cancelada.', 'success')
    } catch (error) {
      const msg = userFacingErrorMessage(error, 'Falha ao cancelar fatura.')
      setCancelError(msg)
      showToast(msg, 'error')
      void logOperationalEvent({ code: 'invoice_cancel_blocked', message: msg, changedBy: user?.id ?? null, entityId: String(invoiceId ?? '') })
    }
  }

  async function handleReversePayment() {
    if (!reversalPaymentId) return
    setReversalError('')
    const reason = reversalReason.trim()
    if (!reason) {
      setReversalError('Informe a justificativa para cancelar a baixa.')
      return
    }
    if (!await confirm({ title: 'Cancelar esta baixa?',
      message: `Baixa de ${formatBRL(reversalPayment?.amount_brl ?? 0)} em ${formatDate(reversalPayment?.paid_at)}, da fatura ${detailInvoice?.invoice_number ?? invoiceId}.`,
      consequence: 'O recebimento selecionado será desfeito e os saldos serão recalculados. Esta ação não devolve dinheiro ao Cliente.',
      reversibility: 'Se necessário, registre o pagamento correto após conferir o extrato.', confirmLabel: 'Cancelar baixa' })) return
    setReversalLoading(true)
    try {
      await reverseLocalPaymentAndInvalidate(queryClient, reversalPaymentId, reason)
      showToast('Baixa cancelada.', 'success')
      onClose()
    } catch (error) {
      const msg = userFacingErrorMessage(error, 'Falha ao cancelar a baixa.')
      setReversalError(msg)
      showToast(msg, 'error')
    } finally {
      setReversalLoading(false)
    }
  }

  async function handleSettleRefund() {
    const refund = refunds.find((row) => row.id === refundToConfirm)
    if (!refund || !canSettleRefund) return
    setRefundError('')
    if (refundReference.trim().length < 3 || refundBeneficiary.trim().length < 3 || !refundDate) {
      setRefundError('Informe a referência bancária, o favorecido e a data da devolução.')
      return
    }
    if (!await confirm({ title: 'Confirmar devolução realizada?',
      message: `${formatBRL(refund.amount_brl)} para ${refundBeneficiary.trim()}, em ${formatDate(refundDate)}. Referência: ${refundReference.trim()}.`,
      consequence: 'Esta ação registra uma transferência já realizada no banco. Confira o comprovante e o Cliente original antes de confirmar.',
      reversibility: 'A devolução confirmada fica registrada no histórico financeiro.', confirmLabel: 'Confirmar devolução' })) return
    try {
      await settleRefundMutation.mutateAsync({ refundId: refund.id, bankReference: refundReference,
        beneficiary: refundBeneficiary, paidAt: new Date(`${refundDate}T00:00:00`).toISOString() })
      setRefundToConfirm(null)
      setRefundReference('')
      setRefundBeneficiary('')
      setRefundDate('')
      showToast('Devolução confirmada.', 'success')
    } catch (error) {
      const msg = userFacingErrorMessage(error, 'Falha ao confirmar a devolução.')
      setRefundError(msg)
      showToast(msg, 'error')
    }
  }

  async function handleCancelAuthorization() {
    if (authorizationToCancel === null || authorizationReason.trim().length < 10) return
    if (!await confirm({ title: 'Cancelar autorização de restituição?', message: authorizationReason.trim(),
      consequence: 'Confirme que o dinheiro ainda não foi devolvido. O valor reservado voltará a ficar disponível.',
      reversibility: 'O motivo ficará registrado. Uma nova restituição exige nova autorização.', confirmLabel: 'Cancelar autorização' })) return
    try {
      await cancelAuthorizationMutation.mutateAsync({ source: 'manual', refundId: authorizationToCancel, reason: authorizationReason })
      setAuthorizationToCancel(null)
      setAuthorizationReason('')
    } catch (error) {
      setRefundError(userFacingErrorMessage(error, 'Falha ao cancelar autorização.'))
    }
  }

  function openReversal(id: number) {
    setSelectedPaymentId(id)
    setReversalOpen(true)
    setReversalError('')
  }

  const number = detailInvoice?.invoice_number ?? (invoiceId ? String(invoiceId) : '')
  const title = view === 'detail' ? `Fatura ${number}` : `${view === 'receipt' ? 'Recibo' : 'Imprimir fatura'} ${number}`

  return (
    <Modal open={Boolean(invoiceId)} onClose={onClose} title={title}>
      {view !== 'detail' && detail ? (
        <div className="app-invoice-detail">
          <div className="app-invoice-detail__toolbar">
            <Button variant="secondary" onClick={() => setView('detail')}><ArrowLeft size={16} />Voltar ao detalhe</Button>
            <Button onClick={() => {
              const element = document.querySelector<HTMLElement>('.invoice-print-content')
              if (element) printDocumentElement(element, buildInvoiceFileBaseName(detail))
            }}><Printer size={16} />Imprimir</Button>
          </div>
          <div className="invoice-print-content">
            <InvoiceDocumentLocal detail={detail} type={view === 'receipt' ? 'receipt' : 'invoice'} />
          </div>
        </div>
      ) : (
        <div className="app-invoice-detail">
          {detailQuery.isLoading ? <SkeletonTable rows={4} cols={4} /> : null}
          {detailQuery.error ? (
            <div role="alert" className="app-invoice-detail__error">
              <p>Não foi possível abrir esta fatura. {userFacingErrorMessage(detailQuery.error, '')}</p>
              <Button variant="secondary" onClick={() => void detailQuery.refetch?.()}>Tentar novamente</Button>
            </div>
          ) : null}
          {detail && !detailInvoice && !detailQuery.isLoading ? <p className="app-invoice-detail__note">Fatura não encontrada.</p> : null}
          {detail && detailInvoice ? (
            <>
              <header className="app-invoice-detail__head">
                <div className="app-invoice-detail__identity">
                  <p className="app-invoice-detail__tags">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <span>{invoiceTypeLabel(detailInvoice.invoice_type)}</span>
                    <span>Emitida em {formatDate(detailInvoice.issued_at)}</span>
                    <span>Nº interno {detailInvoice.id}</span>
                  </p>
                  <p className="app-invoice-detail__customer">{detailInvoice.customer_name ?? 'Cliente não identificado'}</p>
                  <p className="app-invoice-detail__meta">
                    {detailInvoice.customer_cnpj_cpf ? <span>CNPJ {formatCnpjCpf(detailInvoice.customer_cnpj_cpf)}</span> : null}
                    {voyageParts ? <span>Navio / Viagem {voyageParts}</span> : null}
                  </p>
                  {detailIsManual && detailInvoice.notes ? <p className="app-invoice-detail__description"><span className="sr-only">Descrição da cobrança: </span>{detailInvoice.notes}</p> : null}
                </div>
                <div className="app-invoice-detail__actions">
                  <Button variant="secondary" onClick={() => setView('invoice')}><Printer size={16} />Imprimir fatura</Button>
                  {showReceipt ? <Button variant="secondary" onClick={() => setView('receipt')}><Printer size={16} />Imprimir recibo</Button> : null}
                </div>
              </header>

              <dl className="app-invoice-amounts" aria-label="Valores da fatura">
                {amounts.map((line) => (
                  <div key={line.key} className={`app-invoice-amounts__item app-invoice-amounts__item--${line.key}${line.tone ? ` app-invoice-amounts__item--${line.tone}` : ''}`}>
                    <dt>{line.label}</dt>
                    <dd>
                      <span className="app-invoice-amounts__value">{line.value}</span>
                      {line.note ? <span className="app-invoice-amounts__note">{line.note}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>

              {reissueLinks && (reissueLinks.replaces || reissueLinks.replaced_by || reissueLinks.reissue_pending || reissueLinks.reissue_closed_reason) ? (
                <div className="app-invoice-detail__links" data-testid="invoice-reissue-links">
                  {reissueLinks.replaces ? <p>Substitui a fatura <strong>{reissueLinks.replaces.invoice_number}</strong>, cancelada para correção.</p> : null}
                  {reissueLinks.replaced_by ? <p>Substituída pela fatura <strong>{reissueLinks.replaced_by.invoice_number}</strong>.</p> : null}
                  {reissueLinks.reissue_pending ? <p><Badge tone="warning">Reemissão pendente</Badge> A nova emissão travou; o alerta financeiro desta fatura diz o motivo.</p> : null}
                  {reissueLinks.reissue_closed_reason ? <p>{reissueLinks.reissue_closed_reason}</p> : null}
                </div>
              ) : null}

              <StaleInvoiceResolutionPanel key={`stale-${invoiceId}`} invoiceId={Number(invoiceId)} hasPayment={Number(detailInvoice.total_paid_brl ?? 0) > 0} canResolve={isAdmin} />

              {detail.bls.length > 0 ? (
                <section className="app-invoice-detail__section" aria-labelledby="invoice-detail-bls">
                  <h3 id="invoice-detail-bls" className="app-invoice-detail__heading">B/Ls <span className="app-invoice-detail__count">{detail.bls.length}</span></h3>
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact app-invoice-detail__table">
                      <thead><tr><th scope="col">B/L</th><th scope="col">Trecho</th><th scope="col" className="app-invoice-detail__num">Subtotal</th></tr></thead>
                      <tbody>{detail.bls.map((row) => (
                        <tr key={row.id}>
                          <td><Link className="app-invoice-detail__link app-invoice-detail__code" to={`/bls/${encodeURIComponent(row.bl_id)}`}>{row.bl_id}</Link></td>
                          <td>{row.pol ?? '—'} → {row.pod ?? '—'}</td>
                          <td className="app-invoice-detail__num">{formatBRL(row.subtotal_brl)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <section className="app-invoice-detail__section" aria-labelledby="invoice-detail-items">
                <h3 id="invoice-detail-items" className="app-invoice-detail__heading">Itens da fatura</h3>
                <p className="app-invoice-detail__note">{describeInvoiceItemsFreezeNote(detailInvoice)}</p>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact app-invoice-detail__table">
                    <thead>
                      <tr>
                        <th scope="col">Descrição</th>
                        <th scope="col">Origem</th>
                        <th scope="col" className="app-invoice-detail__num">Qtd.</th>
                        <th scope="col" className="app-invoice-detail__num">Unitário</th>
                        <th scope="col" className="app-invoice-detail__num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.length === 0 ? (
                        <tr><td colSpan={5} className="app-invoice-detail__empty">Nenhum item registrado nesta fatura.</td></tr>
                      ) : detail.items.map((item) => {
                        // Itens em USD convertem para BRL na emissão (ADR 0038, decisão 6):
                        // o valor devido é o BRL congelado; USD e ROE aparecem como nota.
                        const usdNote = describeUsdConversionNote(item)
                        return (
                          <tr key={item.id}>
                            <td>
                              {stripBlPrefix(item.description, item.bl_id)}
                              {usdNote ? <span className="app-invoice-detail__cell-note">{usdNote}</span> : null}
                            </td>
                            <td>{item.source === 'manual' ? 'Manual' : 'Calculado'}</td>
                            <td className="app-invoice-detail__num">{String(item.quantity ?? 1).replace('.', ',')}</td>
                            <td className="app-invoice-detail__num">{formatBRL(item.unit_value_brl)}</td>
                            <td className="app-invoice-detail__num">{formatBRL(item.total_value_brl)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="app-invoice-detail__section" aria-labelledby="invoice-detail-payments">
                <h3 id="invoice-detail-payments" className="app-invoice-detail__heading">Pagamentos registrados <span className="app-invoice-detail__count">{payments.length}</span></h3>
                {payments.length === 0 ? <p className="app-invoice-detail__note">Nenhum pagamento registrado.</p> : (
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact app-invoice-detail__table">
                      <thead>
                        <tr>
                          <th scope="col">Data</th>
                          <th scope="col">Método</th>
                          <th scope="col">Observação</th>
                          <th scope="col" className="app-invoice-detail__num">Valor</th>
                          {isAdmin ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((payment) => (
                          <tr key={payment.id} aria-current={reversalFormVisible && payment.id === reversalPaymentId ? 'true' : undefined} className={reversalFormVisible && payment.id === reversalPaymentId ? 'app-invoice-detail__row--selected' : undefined}>
                            <td>{formatDate(payment.paid_at)}</td>
                            <td>{paymentMethodLabel(payment.payment_method)}</td>
                            <td><span className="app-invoice-detail__wrap">{payment.notes || '—'}</span></td>
                            <td className="app-invoice-detail__num">{formatBRL(payment.amount_brl)}</td>
                            {isAdmin ? (
                              <td className="app-invoice-detail__row-action">
                                <Button variant="ghost" aria-label={`Cancelar baixa de ${formatBRL(payment.amount_brl)} em ${formatDate(payment.paid_at)}`} onClick={() => openReversal(payment.id)}>Cancelar baixa…</Button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {enablePaymentReversal && !isAdmin && payments.length > 0 ? <p className="app-invoice-detail__note">Somente o Administrativo cancela a baixa de um pagamento.</p> : null}
                {reversalFormVisible ? (
                  <div className="app-invoice-detail__form app-invoice-detail__form--danger" aria-label="Cancelar baixa" role="group">
                    <p className="app-invoice-detail__form-wide app-invoice-detail__subheading">Cancelar baixa</p>
                    <Field label="Baixa a cancelar" required>
                      <Select value={reversalPaymentId ?? ''} onChange={(event) => setSelectedPaymentId(Number(event.target.value))}>
                        <option value="" disabled>Selecione o recebimento</option>
                        {payments.map((payment) => <option key={payment.id} value={payment.id}>{formatDate(payment.paid_at)} · {formatBRL(payment.amount_brl)} · {paymentMethodLabel(payment.payment_method)} · nº {payment.id}</option>)}
                      </Select>
                    </Field>
                    <div className="app-invoice-detail__form-wide">
                      <Field label="Justificativa" required hint="Use para um lançamento que não corresponde a recebimento verdadeiro. Não devolve dinheiro; restituições e correções que dependem deste recebimento podem impedir o cancelamento.">
                        <Textarea value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} />
                      </Field>
                    </div>
                    {reversalError ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{reversalError}</p> : null}
                    <div className="app-invoice-detail__form-actions">
                      {!enablePaymentReversal ? <Button variant="ghost" onClick={() => { setReversalOpen(false); setReversalReason(''); setReversalError('') }}>Voltar</Button> : null}
                      <Button variant="danger" onClick={handleReversePayment} loading={reversalLoading} loadingLabel="Cancelando baixa…" disabled={!reversalReason.trim() || !reversalPaymentId}>
                        <RotateCcw size={16} />Cancelar baixa
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>

              {refunds.length > 0 || refundsQuery.error ? (
                <section className="app-invoice-detail__section" aria-labelledby="invoice-detail-refunds">
                  <h3 id="invoice-detail-refunds" className="app-invoice-detail__heading">Restituições ao Cliente</h3>
                  {refundsQuery.error ? <p role="alert" className="app-invoice-detail__alert">Não foi possível consultar as restituições desta fatura.</p> : null}
                  {refunds.map((refund) => (
                    <div key={refund.id} className="app-invoice-detail__refund">
                      <div className="app-invoice-detail__refund-line">
                        <strong className="app-invoice-detail__num">{formatBRL(refund.amount_brl)}</strong>
                        {refund.status === 'pending' ? <Badge tone="warning">A devolver</Badge> : refund.status === 'settled' ? <Badge tone="success">Devolvida</Badge> : <Badge tone="neutral">Cancelada</Badge>}
                        <span className="app-invoice-detail__note">Registrada em {formatDate(refund.created_at)}{refund.settled_at ? ` · devolvida em ${formatDate(refund.settled_at)}` : ''}</span>
                      </div>
                      {refund.notes ? <p className="app-invoice-detail__note">{refund.notes}</p> : null}
                      {refund.bank_reference ? <p className="app-invoice-detail__note">Comprovante {refund.bank_reference} · Favorecido {refund.beneficiary}</p> : null}
                      {refund.status === 'pending' && !canSettleRefund ? <p className="app-invoice-detail__note">Aguardando o Financeiro devolver e confirmar.</p> : null}
                      {refund.status === 'pending' && (canSettleRefund || (isAdmin && authorizationIds.has(refund.id))) && refundToConfirm !== refund.id && authorizationToCancel !== refund.id ? (
                        <div className="app-invoice-detail__inline-actions">
                          {canSettleRefund ? <Button variant="secondary" onClick={() => { setRefundToConfirm(refund.id); setAuthorizationToCancel(null); setRefundReference(''); setRefundBeneficiary(''); setRefundDate(''); setRefundError('') }}>Confirmar devolução…</Button> : null}
                          {isAdmin && authorizationIds.has(refund.id) ? <Button variant="ghost" onClick={() => { setAuthorizationToCancel(refund.id); setRefundToConfirm(null); setRefundError('') }}>Cancelar autorização</Button> : null}
                        </div>
                      ) : null}
                      {refundToConfirm === refund.id ? (
                        <div className="app-invoice-detail__form" role="group" aria-label="Registrar devolução bancária">
                          <p className="app-invoice-detail__note app-invoice-detail__form-wide">Confirme somente depois de devolver ao Cliente original no banco.</p>
                          <Field label="Referência do comprovante bancário" required><Input value={refundReference} onChange={(event) => setRefundReference(event.target.value)} /></Field>
                          <Field label="Favorecido (Cliente original / CNPJ)" required><Input value={refundBeneficiary} onChange={(event) => setRefundBeneficiary(event.target.value)} /></Field>
                          <Field label="Data da devolução" required><Input type="date" value={refundDate} onChange={(event) => setRefundDate(event.target.value)} /></Field>
                          {refundError ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{refundError}</p> : null}
                          <div className="app-invoice-detail__form-actions">
                            <Button variant="ghost" onClick={() => setRefundToConfirm(null)}>Voltar</Button>
                            <Button onClick={handleSettleRefund} loading={settleRefundMutation.isPending} loadingLabel="Confirmando…" disabled={!refundReference.trim() || !refundBeneficiary.trim() || !refundDate}>Confirmar devolução realizada</Button>
                          </div>
                        </div>
                      ) : null}
                      {authorizationToCancel === refund.id ? (
                        <div className="app-invoice-detail__form" role="group" aria-label="Cancelar autorização de restituição">
                          <div className="app-invoice-detail__form-wide"><Field label="Motivo para cancelar autorização" required hint="Pelo menos 10 caracteres. Confirme que o dinheiro ainda não foi devolvido."><Textarea value={authorizationReason} onChange={(event) => setAuthorizationReason(event.target.value)} /></Field></div>
                          {refundError ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{refundError}</p> : null}
                          <div className="app-invoice-detail__form-actions">
                            <Button variant="ghost" onClick={() => setAuthorizationToCancel(null)}>Voltar</Button>
                            <Button variant="danger" onClick={handleCancelAuthorization} loading={cancelAuthorizationMutation.isPending} disabled={authorizationReason.trim().length < 10}>Cancelar autorização</Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </section>
              ) : null}

              {detailInvoice && ['individual', 'consolidated'].includes(detailInvoice.invoice_type ?? '') && Number(detailInvoice.total_paid_brl ?? 0) > 0 && ['paid', 'partially_paid'].includes(detailInvoice.status ?? '') ? (
                <InvoiceCorrectionPanel key={invoiceId} invoiceId={Number(invoiceId)} />
              ) : null}
              {detailIsManual && !enablePaymentReversal ? <FinancialRefundsPanel source="manual" invoiceId={Number(invoiceId)} variant="authorization" /> : null}

              {!enablePaymentReversal ? (
                <section className="app-invoice-detail__section" aria-labelledby="invoice-detail-register">
                  <h3 id="invoice-detail-register" className="app-invoice-detail__heading">Registrar pagamento</h3>
                  {!canRegisterPayment ? (
                    <p className="app-invoice-detail__note">Esta fatura não aceita registro de pagamento no status atual.</p>
                  ) : !isAdmin ? (
                    <p className="app-invoice-detail__note">Somente o Administrativo registra recebimentos. Pix com TXID entra pela Conciliação.</p>
                  ) : (
                    <div className="app-invoice-detail__form">
                      <Field label="Valor recebido (R$)" required hint={isLedgerPayable ? 'Aceita valor parcial.' : undefined}>
                        <Input inputMode="decimal" disabled={Boolean(paymentAttempt)} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                      </Field>
                      <Field label="Data do recebimento" required>
                        <Input disabled={Boolean(paymentAttempt)} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
                      </Field>
                      <Field label="Método" required>
                        <Select disabled={Boolean(paymentAttempt)} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                          <option value="pix">Pix</option>
                          <option value="ted">TED</option>
                          <option value="doc">DOC</option>
                          <option value="boleto">Boleto</option>
                          <option value="outros">Outros</option>
                        </Select>
                      </Field>
                      <Field label="Referência do recebimento bancário" required hint="Identificador do extrato ou comprovante.">
                        <Input disabled={Boolean(paymentAttempt)} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
                      </Field>
                      <div className="app-invoice-detail__form-wide">
                        <Field label="Observação">
                          <Input disabled={Boolean(paymentAttempt)} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} />
                        </Field>
                      </div>
                      {isLedgerPayable ? (
                        <p className="app-invoice-detail__note app-invoice-detail__form-wide">
                          Saldo em aberto: {formatBRL(ledgerBalance)}.
                          {typedPayment > 0 ? <> Após esta baixa: {formatBRL(Math.max(ledgerBalance - typedPayment, 0))} em aberto.</> : null}
                          {' '}Com pagamento, a correção do B/L não reemite a fatura: aumento vira fatura avulsa e redução abate o saldo antes de restituir.
                        </p>
                      ) : null}
                      {paymentError ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{paymentError}</p> : null}
                      <div className="app-invoice-detail__form-actions">
                        {paymentAttempt ? <Button variant="secondary" disabled={paymentPending} onClick={handleReleasePaymentAttempt}>Encerrar tentativa após conferir</Button> : null}
                        <Button loading={paymentPending} loadingLabel="Registrando…" onClick={handleRegisterPayment}>
                          <DollarSign size={16} />{paymentAttempt ? 'Tentar novamente' : 'Registrar pagamento'}
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
              ) : null}

              {!enablePaymentReversal && !isCancelled ? (
                <section className="app-invoice-detail__section" aria-labelledby="invoice-detail-cancel">
                  <h3 id="invoice-detail-cancel" className="app-invoice-detail__heading">Cancelar fatura</h3>
                  {!isAdmin ? (
                    <p className="app-invoice-detail__note">Somente o Administrativo cancela faturas.</p>
                  ) : payments.length > 0 ? (
                    <p className="app-invoice-detail__note">Fatura com pagamento não é cancelada aqui. Para recebimento falso, cancele a baixa; para devolver dinheiro recebido, use a restituição.</p>
                  ) : (
                    <div className="app-invoice-detail__form">
                      <div className="app-invoice-detail__form-wide">
                        <Field label="Motivo" required>
                          <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
                        </Field>
                      </div>
                      {cancelError ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{cancelError}</p> : null}
                      <div className="app-invoice-detail__form-actions">
                        <Button variant="danger" loading={cancelInvoiceMutation.isPending} loadingLabel="Cancelando…" disabled={!cancelReason.trim()} onClick={handleCancelInvoice}><Ban size={16} />Cancelar fatura</Button>
                      </div>
                    </div>
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
