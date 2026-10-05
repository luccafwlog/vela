import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, DollarSign, Printer, RotateCcw } from 'lucide-react'
import { StaleInvoiceResolutionPanel } from './StaleInvoiceResolutionPanel'
import { FinancialRefundsPanel } from './FinancialRefundsPanel'
import { InvoiceCorrectionPanel } from './InvoiceCorrectionPanel'
import { InvoiceDocumentLocal } from './InvoiceDocumentLocal'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
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
import { invoiceTypeLabel, isManualInvoice } from '../../services/billing'
import { parseImportNumber } from '../../lib/importNumber'
import { buildInvoiceFileBaseName, describeInvoiceItemsFreezeNote, describeUsdConversionNote } from '../shared/invoiceFormat'
import { formatValidationError, paymentFormSchema } from '../../services/financialValidation'
import { logOperationalEvent } from '../../services/operationalEvents'
import { formatBRL, formatDate, stripBlPrefix } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { isLedgerInvoicePayable } from '../../pages/faturamentoLedgerPayment'
import { invoiceStatusLabel } from '../../pages/faturamentoInvoiceStatus'
import { printDocumentElement } from '../../lib/printDocument'

type PaymentMethod = 'pix' | 'ted' | 'doc' | 'boleto' | 'outros'

type InvoiceDetailModalProps = {
  invoiceId: number | null
  onClose: () => void
  enablePaymentReversal?: boolean
  paymentId?: number | null
}

export function InvoiceDetailModal({ invoiceId, onClose, enablePaymentReversal, paymentId }: InvoiceDetailModalProps) {
  const { user, isAdmin, can } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [printOpen, setPrintOpen] = useState(false)
  const [printType, setPrintType] = useState<'invoice' | 'receipt'>('invoice')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [ledgerPaymentRequestId, setLedgerPaymentRequestId] = useState<string | null>(null)
  const [paymentAttempt, setPaymentAttempt] = useState<{ invoiceId: number; amountBrl: number; method: PaymentMethod; paidAt: string; notes: string | null; requestId: string; bankReference: string } | null>(null)
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [reversalReason, setReversalReason] = useState('')
  const [reversalLoading, setReversalLoading] = useState(false)
  const [refundToConfirm, setRefundToConfirm] = useState<number | null>(null)
  const [refundReference, setRefundReference] = useState('')
  const [refundBeneficiary, setRefundBeneficiary] = useState('')
  const [refundDate, setRefundDate] = useState('')

  const [previousInvoiceId, setPreviousInvoiceId] = useState(invoiceId)
  if (previousInvoiceId !== invoiceId) {
    setPreviousInvoiceId(invoiceId)
    setPaymentAttempt(null)
    setLedgerPaymentRequestId(null)
    setSelectedPaymentId(null)
    setPaymentAmount('')
    setPaymentDate('')
    setPaymentNotes('')
    setPaymentReference('')
    setRefundToConfirm(null)
    setRefundReference('')
    setRefundBeneficiary('')
    setRefundDate('')
  }

  const detailQuery = useInvoiceDetail(invoiceId)
  const refundsQuery = useInvoiceRefunds(invoiceId)
  const refunds = refundsQuery.data ?? []
  const pendingRefund = refunds
    .filter((refund) => refund.status === 'pending')
    .reduce((sum, refund) => sum + Number(refund.amount_brl ?? 0), 0)
  const settleRefundMutation = useSettleInvoiceRefund()
  const canSettleRefund = typeof can === 'function' ? can('settle_financial_adjustments') : isAdmin
  const detailInvoice = detailQuery.data?.invoice ?? null
  const detailIsManual = isManualInvoice(detailInvoice)
  const voyageParts = [detailInvoice?.vessel_name, detailInvoice?.voyage_number].filter(Boolean).join(' · ')
    || Array.from(new Set((detailQuery.data?.bls ?? []).map((b) => [b.vessel_name, b.voyage_number].filter(Boolean).join(' · ')).filter(Boolean))).join(', ')
  const detailVoyageLabel = voyageParts || '-'
  const hasDetailVoyage = Boolean(voyageParts)
  const isLedgerPayable = isLedgerInvoicePayable(detailInvoice)
  const registerPaymentMutation = useRegisterInvoicePayment()
  const registerLedgerPaymentMutation = useRegisterLedgerInvoicePayment()
  const cancelInvoiceMutation = useCancelInvoice()
  const reissueLinksQuery = useInvoiceReissueLinks(invoiceId)
  const reissueLinks = reissueLinksQuery.data ?? null

  const ledgerBalance = Number(detailInvoice?.balance_brl ?? detailInvoice?.total_brl ?? 0)
  const reversalPayment = detailQuery.data?.payments.find((payment) => payment.id === (selectedPaymentId ?? paymentId))
  const reversalPaymentId = reversalPayment?.id ?? null
  // Valor em pt-BR ("1.234,56"), como no registro do pagamento.
  const parsedPayment = parseImportNumber(paymentAmount, 'pt-BR')
  const typedPayment = parsedPayment.kind === 'value' ? Number(parsedPayment.decimal) : 0
  // Ajuste durante o render (em vez de useEffect) quando o alvo do prefill muda.
  const ledgerPrefill = isLedgerPayable ? `${invoiceId}:${ledgerBalance}` : null
  const [prevLedgerPrefill, setPrevLedgerPrefill] = useState<string | null>(null)
  if (ledgerPrefill !== prevLedgerPrefill) {
    setPrevLedgerPrefill(ledgerPrefill)
    if (ledgerPrefill !== null && (!paymentAttempt || paymentAttempt.invoiceId !== invoiceId)) {
      setPaymentAmount(ledgerBalance ? String(ledgerBalance) : '')
    }
  }

  async function handleRegisterPayment() {
    if (!invoiceId) return
    if (paymentReference.trim().length < 3) { showToast('Informe a referência do recebimento no extrato bancário.', 'error'); return }
    const paymentValidation = paymentFormSchema.safeParse({
      amountBrl: paymentAmount,
      paymentMethod,
      paidAt: paymentDate,
    })
    if (!paymentValidation.success) {
      showToast(formatValidationError(paymentValidation.error, 'Valor de pagamento invalido.'), 'error')
      return
    }
    const payment = paymentValidation.data
    const retryAttempt = paymentAttempt?.invoiceId === invoiceId ? paymentAttempt : null
    const amountBrl = retryAttempt?.amountBrl ?? payment.amountBrl
    const duplicates = !retryAttempt && detailQuery.data?.payments.some((existing) =>
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
  }

  async function handleCancelInvoice() {
    if (!invoiceId) return
    const reason = cancelReason.trim()
    if (!reason) {
      showToast('Informe a justificativa para cancelar a fatura.', 'error')
      return
    }
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
      showToast(msg, 'error')
      void logOperationalEvent({ code: 'invoice_cancel_blocked', message: msg, changedBy: user?.id ?? null, entityId: String(invoiceId ?? '') })
    }
  }

  async function handleReversePayment() {
    if (!reversalPaymentId) return
    const reason = reversalReason.trim()
    if (!reason) {
      showToast('Informe a justificativa para cancelar a baixa.', 'error')
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
      showToast(userFacingErrorMessage(error, 'Falha ao cancelar a baixa.'), 'error')
    } finally {
      setReversalLoading(false)
    }
  }

  async function handleSettleRefund() {
    const refund = refunds.find((row) => row.id === refundToConfirm)
    if (!refund || !canSettleRefund) return
    if (refundReference.trim().length < 3 || refundBeneficiary.trim().length < 3 || !refundDate) {
      showToast('Informe a referência bancária, o favorecido e a data da devolução.', 'error')
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
      showToast(userFacingErrorMessage(error, 'Falha ao confirmar a devolução.'), 'error')
    }
  }

  function handlePrintInvoice(type: 'invoice' | 'receipt' = 'invoice') {
    if (!detailQuery.data) return
    setPrintType(type)
    setPrintOpen(true)
  }

  return (
    <>
      <Modal open={Boolean(invoiceId)} onClose={onClose} title={`Detalhe da fatura ${detailQuery.data?.invoice?.invoice_number ?? invoiceId ?? ''}`}>
        <div className="grid gap-5">
          {detailQuery.isLoading ? <div className="p-4"><SkeletonTable rows={3} cols={3} /></div> : null}
          {detailQuery.error ? <div className="text-sm text-red-200">Falha ao carregar detalhe.</div> : null}
          {detailQuery.data?.invoice ? (
            <>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => handlePrintInvoice()}>
                  <Printer size={16} />Imprimir PDF
                </Button>
                {(['paid', 'covered'].includes(detailQuery.data.invoice.status ?? '') || detailQuery.data.invoice.status === 'cancelled' && Number(detailQuery.data.invoice.total_paid_brl ?? 0) > 0) ? (
                  <Button variant="secondary" onClick={() => handlePrintInvoice('receipt')}>
                    <Printer size={16} />Imprimir recibo
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                <MetricCard label="Status" value={statusLabel(detailQuery.data.invoice.status)} />
                <MetricCard label="Tipo" value={invoiceTypeLabel(detailQuery.data.invoice.invoice_type)} />
                <MetricCard label="Total" value={formatBRL(detailQuery.data.invoice.total_brl)} />
                <MetricCard label="Pago" value={formatBRL(detailQuery.data.invoice.total_paid_brl)} />
                <MetricCard label="Saldo" value={formatBRL(detailQuery.data.invoice.balance_brl)} />
                {pendingRefund > 0.01 ? (
                  <MetricCard label="A estornar" value={formatBRL(pendingRefund)} />
                ) : null}
                {!detailIsManual || detailQuery.data.bls.length > 0 ? (
                  <MetricCard label="B/Ls" value={String(detailQuery.data.bls.length)} />
                ) : null}
              </div>
              <Card>
                <h2 className="text-base font-semibold text-white">Informações da Fatura</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <SelectionMetric label="Cliente" value={detailQuery.data.invoice.customer_name ?? '-'} />
                  <SelectionMetric label="CNPJ" value={detailQuery.data.invoice.customer_cnpj_cpf ?? '-'} />
                  <SelectionMetric label="Emissão" value={formatDate(detailQuery.data.invoice.issued_at)} />
                  <SelectionMetric label="Status" value={statusLabel(detailQuery.data.invoice.status)} />
                  <SelectionMetric label="Tipo" value={invoiceTypeLabel(detailQuery.data.invoice.invoice_type)} />
                  {!detailIsManual || hasDetailVoyage ? (
                    <SelectionMetric label="Navio / Viagem" value={detailVoyageLabel} />
                  ) : null}
                  {detailIsManual ? <SelectionMetric label="Descrição da cobrança" value={detailQuery.data.invoice.notes ?? '-'} /> : null}
                  <SelectionMetric label="Itens" value={String(detailQuery.data.items.length)} />
                  <SelectionMetric label="Pagamentos" value={String(detailQuery.data.payments.length)} />
                  <SelectionMetric label="Total BRL" value={formatBRL(detailQuery.data.invoice.total_brl)} />
                  <SelectionMetric label="Saldo BRL" value={formatBRL(detailQuery.data.invoice.balance_brl)} />
                </div>
              </Card>
              {reissueLinks && (reissueLinks.replaces || reissueLinks.replaced_by || reissueLinks.reissue_pending || reissueLinks.reissue_closed_reason) ? (
                <Card>
                  <div className="grid gap-1 text-sm text-slate-200" data-testid="invoice-reissue-links">
                    {reissueLinks.replaces ? <div>Substitui a fatura <strong>{reissueLinks.replaces.invoice_number}</strong>, cancelada para correção.</div> : null}
                    {reissueLinks.replaced_by ? <div>Substituída pela fatura <strong>{reissueLinks.replaced_by.invoice_number}</strong>.</div> : null}
                    {reissueLinks.reissue_pending ? <div><Badge tone="yellow">Reemissão pendente</Badge> A nova emissão travou; o alerta da fatura diz o motivo.</div> : null}
                    {reissueLinks.reissue_closed_reason ? <div>{reissueLinks.reissue_closed_reason}</div> : null}
                  </div>
                </Card>
              ) : null}
              {detailQuery.data.bls.length > 0 ? <Card className="overflow-hidden p-0">
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[620px] text-left text-sm"><thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th scope="col" className="px-3 py-2">B/L</th><th scope="col" className="px-3 py-2">Trecho</th><th scope="col" className="px-3 py-2">Subtotal BRL</th></tr></thead><tbody className="divide-y divide-[#30363d]">{detailQuery.data.bls.map((row) => <tr key={row.id}><td className="px-3 py-2 font-semibold text-[#58a6ff]"><Link className="hover:underline" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link></td><td className="px-3 py-2">{row.pol ?? '-'} - {row.pod ?? '-'}</td><td className="px-3 py-2">{formatBRL(row.subtotal_brl)}</td></tr>)}</tbody></table>
                </div>
              </Card> : null}
              <Card className="overflow-hidden p-0">
                <div className="border-b border-[#30363d] px-4 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Itens da fatura</h2>
                  <p className="mt-1 text-xs text-slate-500">{describeInvoiceItemsFreezeNote(detailQuery.data.invoice)}</p>
                </div>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th scope="col" className="px-3 py-2">Descrição</th>
                        <th scope="col" className="px-3 py-2">Qtd</th>
                        <th scope="col" className="px-3 py-2">Origem</th>
                        <th scope="col" className="px-3 py-2">Unitário</th>
                        <th scope="col" className="px-3 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {detailQuery.data.items.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-400" colSpan={5}>
                            Nenhum item encontrado nesta invoice.
                          </td>
                        </tr>
                      ) : (
                        detailQuery.data.items.map((item) => {
                          // Etapa 11 do plano de faturamento (ADR 0038 decisao 6, achado 7):
                          // itens em USD convertem para BRL na emissao e o valor devido na
                          // invoice e sempre o BRL congelado; o USD original + ROE aparece
                          // como nota, nao como o valor principal (senao a coluna Total
                          // desta tela nao bateria com invoice.total_brl).
                          const usdNote = describeUsdConversionNote(item)
                          return (
                          <tr key={item.id}>
                            <td className="px-3 py-2">
                              {stripBlPrefix(item.description, item.bl_id)}
                              {usdNote && <div className="text-xs text-slate-500">{usdNote}</div>}
                            </td>
                            <td className="px-3 py-2">{item.quantity ?? 1}</td>
                            <td className="px-3 py-2">{item.source === 'manual' ? <Badge tone="yellow">Manual</Badge> : <Badge tone="blue">Auto</Badge>}</td>
                            <td className="px-3 py-2">{formatBRL(item.unit_value_brl)}</td>
                            <td className="px-3 py-2">{formatBRL(item.total_value_brl)}</td>
                          </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="overflow-hidden p-0">
                <div className="border-b border-[#30363d] px-4 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Pagamentos registrados</h2>
                </div>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th scope="col" className="px-3 py-2">Data</th>
                        <th scope="col" className="px-3 py-2">Metodo</th>
                        <th scope="col" className="px-3 py-2">Valor</th>
                        <th scope="col" className="px-3 py-2">Observações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {detailQuery.data.payments.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-400" colSpan={4}>
                            Nenhum pagamento registrado.
                          </td>
                        </tr>
                      ) : (
                        detailQuery.data.payments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="px-3 py-2">{formatDate(payment.paid_at)}</td>
                            <td className="px-3 py-2">{renderPaymentMethod(payment.payment_method)}</td>
                            <td className="px-3 py-2">{formatBRL(payment.amount_brl)}</td>
                            <td className="px-3 py-2"><span className="app-table__truncate app-table__truncate--lg" title={payment.notes ?? '-'}>{payment.notes ?? '-'}</span></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              <StaleInvoiceResolutionPanel key={`stale-${invoiceId}`} invoiceId={Number(invoiceId)} hasPayment={Number(detailInvoice?.total_paid_brl ?? 0) > 0} canResolve={isAdmin} />
              {detailInvoice && ['individual', 'consolidated'].includes(detailInvoice.invoice_type ?? '') && Number(detailInvoice.total_paid_brl ?? 0) > 0 && ['paid', 'partially_paid'].includes(detailInvoice.status ?? '') ? (
                <InvoiceCorrectionPanel key={invoiceId} invoiceId={Number(invoiceId)} />
              ) : null}
              {detailIsManual ? <FinancialRefundsPanel source="manual" invoiceId={Number(invoiceId)} /> : null}
              {refunds.length > 0 ? (
                <Card className="overflow-hidden p-0">
                  <div className="border-b border-[#30363d] px-4 py-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Estornos ao cliente (valor pago a maior)</h2>
                  </div>
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact min-w-[640px] text-left text-sm">
                      <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                        <tr>
                          <th scope="col" className="px-3 py-2">Registrada</th>
                          <th scope="col" className="px-3 py-2">Valor</th>
                          <th scope="col" className="px-3 py-2">Status</th>
                          <th scope="col" className="px-3 py-2">Efetuada</th>
                          <th scope="col" className="px-3 py-2">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#30363d]">
                        {refunds.map((refund) => (
                          <tr key={refund.id}>
                            <td className="px-3 py-2">{formatDate(refund.created_at)}</td>
                            <td className="px-3 py-2">{formatBRL(refund.amount_brl)}{refund.notes ? <p className="text-xs">{refund.notes}</p> : null}</td>
                            <td className="px-3 py-2">
                              {refund.status === 'pending' && canSettleRefund ? (
                                <Badge tone="yellow">Pendente</Badge>
                              ) : refund.status === 'settled' ? (
                                <Badge tone="green">Efetuada</Badge>
                              ) : refund.status === 'pending' ? (
                                <span className="text-xs text-slate-500">Aguardando Financeiro</span>
                              ) : (
                                <Badge tone="red">Cancelada</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2">{refund.settled_at ? formatDate(refund.settled_at) : '—'}{refund.bank_reference ? <p className="text-xs">{refund.bank_reference} · {refund.beneficiary}</p> : null}</td>
                            <td className="px-3 py-2">
                              {refund.status === 'pending' && canSettleRefund ? (
                                <Button
                                  variant="secondary"
                                  type="button"
                                  onClick={() => { setRefundToConfirm(refund.id); setRefundReference(''); setRefundBeneficiary(''); setRefundDate('') }}
                                  disabled={settleRefundMutation.isPending}
                                >
                                  Confirmar devolução
                                </Button>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : null}
              {enablePaymentReversal || detailQuery.data.payments.length > 0 ? (
                <Card>
                  <h2 className="mb-3 text-base font-semibold text-white">Cancelar baixa</h2>
                  {detailQuery.data.payments.length > 0 ? (
                    isAdmin ? (
                      <>
                        <Field label="Baixa a cancelar">
                          <Select value={reversalPaymentId ?? ''} onChange={(event) => setSelectedPaymentId(Number(event.target.value))}>
                            <option value="" disabled>Selecione o recebimento</option>
                            {detailQuery.data.payments.map((payment) => <option key={payment.id} value={payment.id}>{formatDate(payment.paid_at)} · {formatBRL(payment.amount_brl)} · {renderPaymentMethod(payment.payment_method)} · #{payment.id}</option>)}
                          </Select>
                        </Field>
                        <Field label="Justificativa (obrigatória)">
                          <Textarea
                            value={reversalReason}
                            onChange={(event) => setReversalReason(event.target.value)}
                            placeholder="Descreva o motivo do cancelamento desta baixa."
                          />
                        </Field>
                        <div className="mt-2 text-xs text-slate-400">
                          Use para corrigir um lançamento que não corresponde a recebimento verdadeiro. A ação não devolve dinheiro; restituições e correções podem impedir o cancelamento para preservar o lastro.
                        </div>
                        <div className="mt-4 flex justify-end">
                          <Button
                            variant="danger"
                            onClick={handleReversePayment}
                            loading={reversalLoading}
                            disabled={!reversalReason.trim() || !reversalPaymentId}
                          >
                            <RotateCcw size={16} />Cancelar baixa
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-slate-400">
                        Apenas administradores podem cancelar a baixa de um pagamento.
                      </div>
                    )
                  ) : (
                    <div className="text-sm text-slate-400">
                      Esta fatura não possui um pagamento registrado para cancelar a baixa.
                    </div>
                  )}
                </Card>
              ) : null}
              {!enablePaymentReversal ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <h2 className="mb-3 text-base font-semibold text-white">Registrar pagamento</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label={isLedgerPayable ? 'Valor BRL (aceita parcial)' : 'Valor BRL'}>
                      <Input disabled={Boolean(paymentAttempt)} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                    </Field>
                    <Field label="Metodo">
                      <Select disabled={Boolean(paymentAttempt)} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                        <option value="pix">PIX</option>
                        <option value="ted">TED</option>
                        <option value="doc">DOC</option>
                        <option value="boleto">Boleto</option>
                        <option value="outros">Outros</option>
                      </Select>
                    </Field>
                    <Field label="Data">
                      <Input disabled={Boolean(paymentAttempt)} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
                    </Field>
                    <Field label="Referência do recebimento bancário"><Input disabled={Boolean(paymentAttempt)} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Identificador do extrato ou comprovante" /></Field>
                    <Field label="Notas">
                      <Input disabled={Boolean(paymentAttempt)} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} />
                    </Field>
                  </div>
                  {isLedgerPayable ? (
                    <div className="mt-2 text-xs text-slate-400">
                      Saldo aberto: {formatBRL(ledgerBalance)}. Informe somente o valor recebido.
                      {typedPayment > 0 ? <> Após esta baixa: {formatBRL(Math.max(ledgerBalance - typedPayment, 0))} em aberto.</> : null}
                      {' '}Com pagamento, a correção do B/L não reemite a fatura: aumento vira fatura avulsa e redução abate o saldo antes de restituir.
                    </div>
                  ) : null}
                  <div className="mt-4 flex justify-end gap-2">
                    {paymentAttempt ? <Button variant="secondary" disabled={registerPaymentMutation.isPending || registerLedgerPaymentMutation.isPending} onClick={handleReleasePaymentAttempt}>Encerrar tentativa após conferir</Button> : null}
                    <Button loading={registerPaymentMutation.isPending || registerLedgerPaymentMutation.isPending} onClick={handleRegisterPayment}>
                      <DollarSign size={16} />{paymentAttempt ? 'Tentar novamente' : 'Registrar pagamento'}
                    </Button>
                  </div>
                </Card>
                <Card><h2 className="mb-3 text-base font-semibold text-white">Cancelar fatura</h2><Field label="Motivo"><Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field><div className="mt-4 flex justify-end"><Button variant="danger" loading={cancelInvoiceMutation.isPending} disabled={detailQuery.data.payments.length > 0 || !cancelReason.trim()} onClick={handleCancelInvoice}><Ban size={16} />Cancelar fatura</Button></div></Card>
              </div>
              ) : null}
            </>
          ) : null}
        </div>
      </Modal>

      <Modal open={refundToConfirm !== null} onClose={() => setRefundToConfirm(null)} title="Registrar devolução bancária">
        <div className="grid gap-4">
          <p className="text-sm">Confirme somente depois de devolver ao Cliente original. Valor: {formatBRL(refunds.find((row) => row.id === refundToConfirm)?.amount_brl ?? 0)}.</p>
          <Field label="Referência do comprovante bancário"><Input value={refundReference} onChange={(event) => setRefundReference(event.target.value)} /></Field>
          <Field label="Favorecido (Cliente original / CNPJ)"><Input value={refundBeneficiary} onChange={(event) => setRefundBeneficiary(event.target.value)} /></Field>
          <Field label="Data da devolução"><Input type="date" value={refundDate} onChange={(event) => setRefundDate(event.target.value)} /></Field>
          <Button onClick={handleSettleRefund} loading={settleRefundMutation.isPending} disabled={!canSettleRefund || !refundReference.trim() || !refundBeneficiary.trim() || !refundDate}>Confirmar devolução realizada</Button>
        </div>
      </Modal>

      {printOpen && detailQuery.data && (
        <Modal open onClose={() => setPrintOpen(false)} title={`${printType === 'receipt' ? 'Recibo' : 'Imprimir'} ${detailQuery.data.invoice?.invoice_number ?? ''}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPrintOpen(false)}>Fechar</Button>
            <Button onClick={() => {
              const element = document.querySelector<HTMLElement>('.invoice-print-content')
              if (element) printDocumentElement(element, buildInvoiceFileBaseName(detailQuery.data!))
            }}><Printer size={16} />Imprimir</Button>
          </div>
          <div className="invoice-print-content">
            <InvoiceDocumentLocal detail={detailQuery.data} type={printType} />
          </div>
        </Modal>
      )}
    </>
  )
}

function SelectionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[var(--app-surface-muted)] px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-100">{value}</div>
    </div>
  )
}

function statusLabel(status: string | null) {
  return invoiceStatusLabel(status)
}

function renderPaymentMethod(method: PaymentMethod | string | null) {
  if (method === 'pix') return 'PIX'
  if (method === 'ted') return 'TED'
  if (method === 'doc') return 'DOC'
  if (method === 'boleto') return 'Boleto'
  return 'Outros'
}
