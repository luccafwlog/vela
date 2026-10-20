import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, Check, DollarSign, Printer, RotateCcw, Undo2, X } from 'lucide-react'
import { StaleInvoiceResolutionPanel } from './StaleInvoiceResolutionPanel'
import { FinancialRefundsPanel } from './FinancialRefundsPanel'
import { InvoiceCorrectionPanel } from './InvoiceCorrectionPanel'
import { InvoiceDocumentLocal } from './InvoiceDocumentLocal'
import { describeInvoiceBalance, invoiceStatusTag, paymentMethodLabel } from './invoiceDetailPresentation'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { ConsolidatedMark, StatusText } from '../ui/StatusText'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { Button } from '../ui/Button'
import { RowActionButton } from '../ui/RowActionButton'
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
import { buildInvoiceFileBaseName, describeUsdConversionNote } from '../shared/invoiceFormat'
import { formatValidationError, paymentFormSchema } from '../../services/financialValidation'
import { logOperationalEvent } from '../../services/operationalEvents'
import { formatBRL, formatCnpjCpf, formatDate, stripBlPrefix } from '../../lib/utils'
import { classifyDbError, userFacingErrorMessage } from '../../lib/errors'
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
 * e pela Conciliação. Um bloco por assunto (ADR 0081): Saldo, Fatura
 * desatualizada, B/Ls (consolidada), Itens, Pagamentos, Restituições, Ajustes
 * pela correção do B/L e Cancelar fatura (só o Administrativo); a
 * impressão troca o conteúdo do mesmo modal (sem modal sobre modal) e as
 * confirmações de devolução e de cancelamento de baixa abrem dentro da seção.
 * As ações que o banco restringe por perfil aparecem só para quem pode: baixa
 * para Financeiro e Administrativo; cancelamento da fatura e da baixa só para o
 * Administrativo (matriz de permissões; migration 247). Os demais leem o motivo.
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
  const [paymentFormOpen, setPaymentFormOpen] = useState(false)
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
    setPaymentFormOpen(false)
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
  // Financeiro e Administrativo: devolução confirmada e baixa manual (ADR 0085, D4).
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
  const balance = detail ? describeInvoiceBalance(detail, refunds) : null
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
      setPaymentFormOpen(false)
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

  function closePaymentForm() {
    setPaymentFormOpen(false)
    setPaymentError('')
  }

  const number = detailInvoice?.invoice_number ?? (invoiceId ? String(invoiceId) : '')
  const title = view === 'detail' ? `Fatura ${number}` : `${view === 'receipt' ? 'Recibo' : 'Imprimir fatura'} ${number}`
  const notFound = classifyDbError(detailQuery.error).kind === 'nao_encontrado'

  // Um B/L só: o B/L e o trecho vão no Saldo. Mais de um (consolidada): bloco B/Ls e coluna B/L nos itens.
  const singleBl = detail && detail.bls.length === 1 ? detail.bls[0] : null
  const showBlsBlock = Boolean(detail && (detailInvoice?.invoice_type === 'consolidated' || detail.bls.length > 1) && detail.bls.length > 0)
  const items = detail?.items ?? []
  const showItemBl = new Set(items.map((item) => item.bl_id).filter(Boolean)).size > 1
  const usdNotes = items.map((item) => describeUsdConversionNote(item))
  const showUsd = usdNotes.some(Boolean)
  const showRegistrar = payments.some((payment) => payment.registered_by_name)
  const showPaymentNotes = payments.some((payment) => payment.notes?.trim())
  const showRefundNotes = refunds.some((refund) => refund.notes?.trim() || refund.bank_reference)
  const mayRegisterPayment = !enablePaymentReversal && canRegisterPayment && canSettleRefund
  const paymentFormVisible = mayRegisterPayment && (paymentFormOpen || Boolean(paymentAttempt))
  const customerLink = detailInvoice?.customer_cnpj_cpf ? `/clientes/${encodeURIComponent(detailInvoice.customer_cnpj_cpf)}` : null
  const paymentsNote = enablePaymentReversal
    ? (!isAdmin && payments.length > 0 ? 'Somente o Administrativo cancela a baixa de um pagamento.' : null)
    : !canRegisterPayment
      ? 'Esta fatura não aceita registro de pagamento na situação atual.'
      : !canSettleRefund ? 'Somente o Financeiro e o Administrativo registram recebimentos. Pix com identificador entra pela Conciliação.' : null

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
              <p>{notFound ? 'Fatura não encontrada.' : `Não foi possível abrir esta fatura. ${userFacingErrorMessage(detailQuery.error, '')}`}</p>
              {notFound ? null : <Button variant="secondary" onClick={() => void detailQuery.refetch?.()}>Tentar novamente</Button>}
            </div>
          ) : null}
          {detail && !detailInvoice && !detailQuery.isLoading ? <p className="app-invoice-detail__note">Fatura não encontrada.</p> : null}
          {detail && detailInvoice ? (
            <>
              <div className="app-invoice-detail__actions">
                {detailInvoice.invoice_type === 'consolidated' ? <ConsolidatedMark /> : null}
                <Button variant="secondary" onClick={() => setView('invoice')}><Printer size={16} />Imprimir fatura</Button>
                {showReceipt ? <Button variant="secondary" onClick={() => setView('receipt')}><Printer size={16} />Imprimir recibo</Button> : null}
              </div>

              <Block title="Saldo" headingLevel={3} aside={`${invoiceTypeLabel(detailInvoice.invoice_type)}${detailInvoice.issued_at ? ` · emitida em ${formatDate(detailInvoice.issued_at)}` : ''}`}>
                {balance ? (
                  <LeadValue tone={balance.tone} detail={balance.detail}>
                    {balance.paid ? <StatusText tone="paid">{balance.value}</StatusText> : balance.value}
                  </LeadValue>
                ) : null}
                <FactList columns={2}>
                  {balance?.paid || balance?.tone === 'muted' ? null : <Fact label="Situação"><StatusText tone={status.tone}>{status.label}</StatusText></Fact>}
                  <Fact label="Cliente">
                    {customerLink
                      ? <Link className="app-link" to={customerLink}>{detailInvoice.customer_name ?? 'Cliente não identificado'}</Link>
                      : detailInvoice.customer_name ?? <NoValue label="Cliente não identificado" />}
                  </Fact>
                  <Fact label="CNPJ">{detailInvoice.customer_cnpj_cpf ? <CopyValue value={formatCnpjCpf(detailInvoice.customer_cnpj_cpf)} label="CNPJ/CPF" /> : <NoValue label="CNPJ não informado" />}</Fact>
                  {voyageParts ? <Fact label="Navio / Viagem">{voyageParts}</Fact> : null}
                  {singleBl && !showBlsBlock ? (
                    <>
                      <Fact label="B/L"><CopyValue value={singleBl.bl_id} label="número do B/L"><Link className="app-link app-invoice-detail__code" to={`/bls/${encodeURIComponent(singleBl.bl_id)}`}>{singleBl.bl_id}</Link></CopyValue></Fact>
                      <Fact label="Trecho">{singleBl.pol ?? <NoValue label="Sem porto de origem" />} → {singleBl.pod ?? <NoValue label="Sem porto de destino" />}</Fact>
                    </>
                  ) : null}
                  {detailIsManual && detailInvoice.notes ? <Fact label="Descrição da cobrança">{detailInvoice.notes}</Fact> : null}
                </FactList>
                {reissueLinks && (reissueLinks.replaces || reissueLinks.replaced_by || reissueLinks.reissue_pending || reissueLinks.reissue_closed_reason) ? (
                  <div className="app-invoice-detail__links" data-testid="invoice-reissue-links">
                    {reissueLinks.replaces ? <p>Substitui a fatura <strong>{reissueLinks.replaces.invoice_number}</strong>, cancelada para correção.</p> : null}
                    {reissueLinks.replaced_by ? <p>Substituída pela fatura <strong>{reissueLinks.replaced_by.invoice_number}</strong>.</p> : null}
                    {reissueLinks.reissue_pending ? <p><StatusText tone="warning">Reemissão pendente.</StatusText> A nova emissão travou; o alerta financeiro desta fatura diz o motivo.</p> : null}
                    {reissueLinks.reissue_closed_reason ? <p>{reissueLinks.reissue_closed_reason}</p> : null}
                  </div>
                ) : null}
              </Block>

              <StaleInvoiceResolutionPanel key={`stale-${invoiceId}`} invoiceId={Number(invoiceId)} hasPayment={Number(detailInvoice.total_paid_brl ?? 0) > 0} />

              {showBlsBlock ? (
                <Block title="B/Ls" headingLevel={3} aside={detail.bls.length} flush>
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact app-invoice-detail__table">
                      <thead><tr><th scope="col">B/L</th><th scope="col">Trecho</th><th scope="col">Itens</th><th scope="col">Subtotal</th></tr></thead>
                      <tbody>{detail.bls.map((row) => (
                        <tr key={row.id}>
                          <td><CopyValue value={row.bl_id} label="número do B/L"><Link className="app-link app-invoice-detail__code" to={`/bls/${encodeURIComponent(row.bl_id)}`}>{row.bl_id}</Link></CopyValue></td>
                          <td>{row.pol ?? <NoValue label="Sem porto de origem" />} → {row.pod ?? <NoValue label="Sem porto de destino" />}</td>
                          <td className="tabular-nums">{items.filter((item) => item.bl_id === row.bl_id).length}</td>
                          <td className="whitespace-nowrap tabular-nums">{formatBRL(row.subtotal_brl)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </Block>
              ) : null}

              <Block title="Itens da fatura" headingLevel={3} aside={`${items.length} ${items.length === 1 ? 'item' : 'itens'} · valores congelados na emissão`} flush>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact app-invoice-detail__table">
                    <thead>
                      <tr>
                        {showItemBl ? <th scope="col">B/L</th> : null}
                        <th scope="col" className="app-table__text-head">Descrição</th>
                        <th scope="col">Origem</th>
                        <th scope="col">Qtd.</th>
                        <th scope="col">Unitário</th>
                        {showUsd ? <th scope="col">Em US$</th> : null}
                        <th scope="col">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr><td colSpan={5 + Number(showItemBl) + Number(showUsd)} className="app-invoice-detail__empty">Nenhum item registrado nesta fatura.</td></tr>
                      ) : items.map((item, index) => (
                        // Itens em USD convertem para BRL na emissão (ADR 0038, decisão 6):
                        // o valor devido é o BRL congelado; USD e ROE ficam na coluna "Em US$".
                        <tr key={item.id}>
                          {showItemBl ? <td className="app-invoice-detail__code">{item.bl_id ?? <NoValue label="Sem B/L" />}</td> : null}
                          <td className="app-table__text app-table__text--wrap">{stripBlPrefix(item.description, item.bl_id)}</td>
                          <td>{item.source === 'manual' ? 'Manual' : 'Calculado'}</td>
                          <td className="tabular-nums">{String(item.quantity ?? 1).replace('.', ',')}</td>
                          <td className="whitespace-nowrap tabular-nums">{formatBRL(item.unit_value_brl)}</td>
                          {showUsd ? <td className="whitespace-nowrap tabular-nums">{usdNotes[index] ?? <NoValue label={item.currency === 'USD' ? 'ROE não registrado' : 'Item em reais'} />}</td> : null}
                          <td className="whitespace-nowrap tabular-nums">{formatBRL(item.total_value_brl)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {items.length > 0 ? (
                      <tfoot>
                        <tr>
                          <th scope="row" className="app-table__text" colSpan={4 + Number(showItemBl) + Number(showUsd)}>Total da fatura</th>
                          <td className="whitespace-nowrap font-semibold tabular-nums">{formatBRL(detailInvoice.total_brl)}</td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
              </Block>

              <Block
                title="Pagamentos"
                headingLevel={3}
                aside={<>
                  <span>{payments.length === 0 ? 'Nenhum recebimento' : payments.length === 1 ? '1 recebimento' : `${payments.length} recebimentos`}</span>
                  {mayRegisterPayment && !paymentFormVisible ? <Button className="app-btn--sm" onClick={() => setPaymentFormOpen(true)}><DollarSign size={16} />Registrar pagamento</Button> : null}
                </>}
              >
                {payments.length > 0 ? (
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact app-invoice-detail__table">
                      <thead>
                        <tr>
                          <th scope="col">Recebido em</th>
                          <th scope="col">Método</th>
                          <th scope="col">Referência bancária</th>
                          {showRegistrar ? <th scope="col">Registrado por</th> : null}
                          {showPaymentNotes ? <th scope="col" className="app-table__text-head">Observação</th> : null}
                          <th scope="col">Valor</th>
                          {isAdmin ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((payment) => (
                          <tr key={payment.id} aria-current={reversalFormVisible && payment.id === reversalPaymentId ? 'true' : undefined} className={reversalFormVisible && payment.id === reversalPaymentId ? 'app-invoice-detail__row--selected' : undefined}>
                            <td className="tabular-nums">{formatDate(payment.paid_at)}</td>
                            <td>{paymentMethodLabel(payment.payment_method)}</td>
                            <td><span className="app-invoice-detail__wrap">{payment.bank_reference || <NoValue label="Sem referência bancária" />}</span></td>
                            {showRegistrar ? <td>{payment.registered_by_name || <NoValue label="Sem responsável pelo registro" />}</td> : null}
                            {showPaymentNotes ? <td className="app-table__text app-table__text--wrap">{payment.notes || <NoValue label="Sem observação" />}</td> : null}
                            <td className="whitespace-nowrap tabular-nums">{formatBRL(payment.amount_brl)}</td>
                            {isAdmin ? (
                              <td className="app-invoice-detail__row-action">
                                <RowActionButton variant="ghost" label={`Cancelar baixa de ${formatBRL(payment.amount_brl)} em ${formatDate(payment.paid_at)}`} icon={Undo2} onClick={() => openReversal(payment.id)} />
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="app-invoice-detail__note">Nenhum pagamento registrado.</p>}
                {paymentsNote ? <p className="app-invoice-detail__note">{paymentsNote}</p> : null}
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
                {paymentFormVisible ? (
                  <div className="app-invoice-detail__form" role="group" aria-label="Registrar pagamento">
                    <Field label="Valor recebido (R$)" required hint={isLedgerPayable ? 'Aceita valor parcial.' : undefined}>
                      <Input inputMode="decimal" disabled={Boolean(paymentAttempt)} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                    </Field>
                    <Field label="Recebido em" required>
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
                    <Field label="Referência bancária" required>
                      <Input disabled={Boolean(paymentAttempt)} placeholder="Do extrato ou comprovante" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
                    </Field>
                    <div className="app-invoice-detail__form-wide">
                      <Field label="Observação">
                        <Input disabled={Boolean(paymentAttempt)} placeholder="Opcional" value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} />
                      </Field>
                    </div>
                    {isLedgerPayable ? (
                      <p className="app-invoice-detail__note app-invoice-detail__form-wide">
                        Saldo depois desta baixa: {formatBRL(Math.max(ledgerBalance - typedPayment, 0))}.
                        {' '}Com pagamento, a correção do B/L não reemite a fatura: aumento vira fatura avulsa e redução abate o saldo antes de restituir.
                      </p>
                    ) : null}
                    {paymentError ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{paymentError}</p> : null}
                    <div className="app-invoice-detail__form-actions">
                      {paymentAttempt
                        ? <Button variant="secondary" disabled={paymentPending} onClick={handleReleasePaymentAttempt}>Encerrar tentativa após conferir</Button>
                        : <Button variant="ghost" onClick={closePaymentForm}>Voltar</Button>}
                      <Button loading={paymentPending} loadingLabel="Registrando…" onClick={handleRegisterPayment}>
                        <DollarSign size={16} />{paymentAttempt ? 'Tentar novamente' : 'Registrar pagamento'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Block>

              {refunds.length > 0 || refundsQuery.error ? (
                <Block title="Restituições ao Cliente" headingLevel={3} aside={refunds.length || null}>
                  {refundsQuery.error ? <p role="alert" className="app-invoice-detail__alert">Não foi possível consultar as restituições desta fatura.</p> : null}
                  {refunds.length > 0 ? (
                    <div className="app-table-scroll">
                      <table className="app-table app-table--compact app-invoice-detail__table">
                        <thead>
                          <tr>
                            <th scope="col">Valor</th>
                            <th scope="col">Situação</th>
                            <th scope="col">Registrada em</th>
                            {showRefundNotes ? <th scope="col" className="app-table__text-head">Observação</th> : null}
                            <th scope="col"><span className="sr-only">Ações</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {refunds.map((refund) => (
                            <tr key={refund.id} className={refund.status === 'cancelled' ? 'app-table__row--muted' : undefined}>
                              <td className="whitespace-nowrap tabular-nums">{formatBRL(refund.amount_brl)}</td>
                              <td>
                                {refund.status === 'pending' ? <StatusText tone="warning">A devolver</StatusText>
                                  : refund.status === 'settled' ? <StatusText>Devolvida{refund.settled_at ? ` em ${formatDate(refund.settled_at)}` : ''}</StatusText>
                                    : <StatusText tone="muted">Cancelada</StatusText>}
                              </td>
                              <td className="tabular-nums">{formatDate(refund.created_at)}</td>
                              {showRefundNotes ? (
                                <td className="app-table__text app-table__text--wrap">
                                  {[refund.notes, refund.bank_reference ? `Comprovante ${refund.bank_reference} · Favorecido ${refund.beneficiary}` : null].filter(Boolean).join('\n') || <NoValue label="Sem observação" />}
                                </td>
                              ) : null}
                              <td className="app-invoice-detail__row-action">
                                {refund.status === 'pending' && refundToConfirm !== refund.id && authorizationToCancel !== refund.id ? (
                                  <>
                                    {canSettleRefund ? <RowActionButton variant="ghost" label="Confirmar devolução" icon={Check} onClick={() => { setRefundToConfirm(refund.id); setAuthorizationToCancel(null); setRefundReference(''); setRefundBeneficiary(''); setRefundDate(''); setRefundError('') }} /> : null}
                                    {authorizationIds.has(refund.id) ? <RowActionButton variant="ghost" label="Cancelar autorização" icon={X} onClick={() => { setAuthorizationToCancel(refund.id); setRefundToConfirm(null); setAuthorizationReason(''); setRefundError('') }} /> : null}
                                  </>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {refunds.some((refund) => refund.status === 'pending') && !canSettleRefund ? <p className="app-invoice-detail__note">Aguardando o Financeiro devolver e confirmar.</p> : null}
                  {refundToConfirm !== null ? (
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
                  {authorizationToCancel !== null ? (
                    <div className="app-invoice-detail__form" role="group" aria-label="Cancelar autorização de restituição">
                      <div className="app-invoice-detail__form-wide"><Field label="Motivo para cancelar autorização" required hint="Pelo menos 10 caracteres. Confirme que o dinheiro ainda não foi devolvido."><Textarea value={authorizationReason} onChange={(event) => setAuthorizationReason(event.target.value)} /></Field></div>
                      {refundError ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{refundError}</p> : null}
                      <div className="app-invoice-detail__form-actions">
                        <Button variant="ghost" onClick={() => { setAuthorizationToCancel(null); setAuthorizationReason('') }}>Voltar</Button>
                        <Button variant="danger" onClick={handleCancelAuthorization} loading={cancelAuthorizationMutation.isPending} disabled={authorizationReason.trim().length < 10}>Cancelar autorização</Button>
                      </div>
                    </div>
                  ) : null}
                </Block>
              ) : null}

              {['individual', 'consolidated'].includes(detailInvoice.invoice_type ?? '') && Number(detailInvoice.total_paid_brl ?? 0) > 0 && ['paid', 'partially_paid'].includes(detailInvoice.status ?? '') ? (
                <InvoiceCorrectionPanel key={invoiceId} invoiceId={Number(invoiceId)} />
              ) : null}
              {detailIsManual ? <FinancialRefundsPanel source="manual" invoiceId={Number(invoiceId)} variant="authorization" /> : null}

              {!enablePaymentReversal && !isCancelled && isAdmin ? (
                <Block title="Cancelar fatura" headingLevel={3}>
                  {payments.length > 0 ? (
                    <p className="app-invoice-detail__note">Fatura com pagamento não se cancela. Para recebimento lançado por engano, cancele a baixa; para devolver dinheiro, use a restituição.</p>
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
                </Block>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
