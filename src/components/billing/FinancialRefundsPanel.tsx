import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { useCancelFinancialRefundAuthorization, useFinancialRefunds } from '../../hooks/useFinancialRefunds'
import { confirmDemurrageRefund, requestFinancialRefund, type RefundSource, type RequestFinancialRefundInput } from '../../services/financialRefunds'
import { afterBlInvoiceBasisAlterada } from '../../services/cacheEffects'
import { parseImportNumber } from '../../lib/importNumber'
import { formatBRL, formatDate } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'

/**
 * Restituição excepcional de avulsa ou Demurrage (migration 136).
 * `variant="authorization"` mostra só o recebido disponível e o formulário de
 * autorização: no detalhe da avulsa a lista de restituições já está na seção
 * Restituições do próprio detalhe (mesmas linhas de `invoice_refunds`).
 */
export function FinancialRefundsPanel({ source, invoiceId, variant = 'full' }: { source: RefundSource; invoiceId: number; variant?: 'full' | 'authorization' }) {
  const summary = useFinancialRefunds(source, invoiceId)
  const { isAdmin, can } = useAuth()
  const mayConfirm = typeof can === 'function' ? can('settle_financial_adjustments') : isAdmin
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { showToast } = useToast()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [purpose, setPurpose] = useState<'correction' | 'cancel'>('correction')
  const [attempt, setAttempt] = useState<RequestFinancialRefundInput | null>(null)
  const [requestError, setRequestError] = useState('')
  const [selectedRefundId, setSelectedRefundId] = useState<number | null>(null)
  const [bankReference, setBankReference] = useState('')
  const [beneficiary, setBeneficiary] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const invalidate = () => afterBlInvoiceBasisAlterada(queryClient)
  const request = useMutation({ mutationFn: requestFinancialRefund, onSuccess: invalidate })
  const cancelAuthorization = useCancelFinancialRefundAuthorization()
  const settle = useMutation({ mutationFn: confirmDemurrageRefund, onSuccess: invalidate })
  const refunds = summary.data?.refunds ?? []
  const reserved = refunds.filter((row) => row.status !== 'cancelled').reduce((total, row) => total + row.amount_brl, 0)
  const refunded = refunds.filter((row) => row.status === 'settled').reduce((total, row) => total + row.amount_brl, 0)
  const available = Math.max((summary.data?.received_brl ?? 0) - reserved, 0)
  const showList = variant === 'full'

  async function handleRequest() {
    setRequestError('')
    const parsed = parseImportNumber(amount, 'pt-BR')
    const value = parsed.kind === 'value' ? Number(parsed.decimal) : 0
    if (!attempt && (!(value > 0) || value > available || reason.trim().length < 10)) {
      const message = !(value > 0) || value > available
        ? `Informe um valor entre R$ 0,01 e ${formatBRL(available)}.`
        : 'Escreva a justificativa com pelo menos 10 caracteres.'
      setRequestError(message)
      showToast(message, 'error')
      return
    }
    const input = attempt ?? { source, invoiceId, amountBrl: value, reason: reason.trim(), purpose, requestId: crypto.randomUUID() }
    if (!await confirm({ title: 'Autorizar restituição excepcional?', message: `${formatBRL(input.amountBrl)}. Motivo: ${input.reason}.`,
      consequence: input.purpose === 'cancel' ? 'Após a devolução integral confirmada, a fatura será cancelada preservando o recebimento e o documento original.' : 'A fatura e o recebimento original serão preservados; o Financeiro deve devolver e confirmar o valor autorizado.',
      reversibility: 'Esta autorização não transfere dinheiro. Confira o Cliente original antes de devolver.', confirmLabel: 'Autorizar restituição' })) return
    setAttempt(input)
    try { await request.mutateAsync(input); setAttempt(null); setAmount(''); setReason(''); showToast('Restituição autorizada. Aguarde a devolução pelo Financeiro.', 'success') }
    catch (error) { const message = userFacingErrorMessage(error, 'Falha ao autorizar restituição.'); setRequestError(message); showToast(message, 'error') }
  }
  async function handleSettle() {
    const refund = refunds.find((row) => row.id === selectedRefundId)
    if (!refund || !mayConfirm || bankReference.trim().length < 3 || beneficiary.trim().length < 3 || !paidAt) return
    if (!await confirm({ title: 'Confirmar devolução realizada?', message: `${formatBRL(refund.amount_brl)} para ${beneficiary}, em ${formatDate(paidAt)}. Referência: ${bankReference}.`,
      consequence: 'Registra uma devolução já realizada no banco ao Cliente original. Confira o comprovante.', reversibility: 'A confirmação permanece no histórico financeiro.', confirmLabel: 'Confirmar devolução' })) return
    try { await settle.mutateAsync({ refundId: refund.id, bankReference, beneficiary, paidAt: new Date(`${paidAt}T00:00:00`).toISOString() }); setSelectedRefundId(null); setBankReference(''); setBeneficiary(''); setPaidAt(''); showToast('Devolução confirmada.', 'success') }
    catch (error) { showToast(userFacingErrorMessage(error, 'Falha ao confirmar devolução.'), 'error') }
  }
  async function handleCancelAuthorization() {
    if (cancelId === null || cancelReason.trim().length < 10) return
    if (!await confirm({ title: 'Cancelar autorização de restituição?', message: cancelReason.trim(),
      consequence: 'Confirme que o dinheiro ainda não foi devolvido. O valor reservado voltará a ficar disponível.',
      reversibility: 'O motivo ficará registrado. Uma nova restituição exige nova autorização.', confirmLabel: 'Cancelar autorização' })) return
    try { await cancelAuthorization.mutateAsync({ source, refundId: cancelId, reason: cancelReason }); setCancelId(null); setCancelReason('') }
    catch (error) { showToast(userFacingErrorMessage(error, 'Falha ao cancelar autorização.'), 'error') }
  }

  const body = <>
    {summary.error ? <p role="alert" className="app-invoice-detail__alert">Não foi possível consultar restituições. Recarregue antes de continuar.</p> : null}
    {summary.data
      ? <p className="app-invoice-detail__note">Recebido: {formatBRL(summary.data.received_brl)} · Devolvido: {formatBRL(refunded)} · Disponível para autorizar: {formatBRL(available)}.</p>
      : summary.error ? null : <p className="app-invoice-detail__note">Consultando recebimentos e restituições…</p>}
    {isAdmin && (available > 0 || attempt) ? <div className="app-invoice-detail__form">
      <Field label="Valor da restituição BRL" required><Input inputMode="decimal" value={amount} disabled={Boolean(attempt)} onChange={(event) => setAmount(event.target.value)} /></Field>
      <Field label="Finalidade da restituição"><Select value={purpose} disabled={Boolean(attempt)} onChange={(event) => setPurpose(event.target.value as typeof purpose)}><option value="correction">Devolução por ajuste</option><option value="cancel">Cancelamento com devolução integral</option></Select></Field>
      <div className="app-invoice-detail__form-wide"><Field label="Justificativa da restituição" required hint="Pelo menos 10 caracteres."><Textarea value={reason} disabled={Boolean(attempt)} onChange={(event) => setReason(event.target.value)} /></Field></div>
      {requestError ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{requestError}</p> : null}
      <div className="app-invoice-detail__form-actions"><Button variant="secondary" onClick={handleRequest} loading={request.isPending} loadingLabel="Autorizando…">{attempt ? 'Repetir autorização' : 'Autorizar restituição'}</Button></div>
    </div> : null}
    {showList ? refunds.map((refund) => <div key={refund.id} className="app-invoice-detail__refund">
      <p><strong className="app-invoice-detail__num">{formatBRL(refund.amount_brl)}</strong> · <Badge tone={refund.status === 'pending' ? 'warning' : refund.status === 'settled' ? 'success' : 'neutral'}>{refund.status === 'pending' ? 'A devolver' : refund.status === 'settled' ? 'Devolvida' : 'Cancelada'}</Badge>{refund.notes ? ` · ${refund.notes}` : ''}</p>
      {refund.bank_reference ? <p className="app-invoice-detail__note">Comprovante: {refund.bank_reference} · Favorecido: {refund.beneficiary} · {formatDate(refund.settled_at)}</p> : null}
      <div className="app-invoice-detail__inline-actions">
        {source === 'demurrage' && refund.status === 'pending' && mayConfirm ? <Button variant="secondary" onClick={() => { setSelectedRefundId(refund.id); setBankReference(''); setBeneficiary(''); setPaidAt('') }}>Registrar devolução</Button> : null}
        {refund.status === 'pending' && isAdmin && refund.request_id ? <Button variant="ghost" onClick={() => setCancelId(refund.id)}>Cancelar autorização</Button> : null}
      </div>
    </div>) : null}
    {showList && cancelId !== null ? <div className="app-invoice-detail__form">
      <div className="app-invoice-detail__form-wide"><Field label="Motivo para cancelar autorização" required hint="Pelo menos 10 caracteres."><Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field></div>
      <div className="app-invoice-detail__form-actions">
        <Button variant="ghost" onClick={() => setCancelId(null)}>Voltar</Button>
        <Button variant="danger" onClick={handleCancelAuthorization} loading={cancelAuthorization.isPending} disabled={cancelReason.trim().length < 10}>Confirmar cancelamento da autorização</Button>
      </div>
    </div> : null}
    {showList && selectedRefundId !== null ? <div className="app-invoice-detail__form">
      <Field label="Referência do comprovante bancário" required><Input value={bankReference} onChange={(event) => setBankReference(event.target.value)} /></Field>
      <Field label="Favorecido (Cliente original / CNPJ)" required><Input value={beneficiary} onChange={(event) => setBeneficiary(event.target.value)} /></Field>
      <Field label="Data da devolução" required><Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></Field>
      <div className="app-invoice-detail__form-actions">
        <Button variant="ghost" onClick={() => setSelectedRefundId(null)}>Voltar</Button>
        <Button onClick={handleSettle} loading={settle.isPending} disabled={!bankReference.trim() || !beneficiary.trim() || !paidAt}>Confirmar devolução realizada</Button>
      </div>
    </div> : null}
  </>

  if (variant === 'authorization') {
    return <section className="app-invoice-detail__section" aria-labelledby={`refund-auth-${invoiceId}`}>
      <h3 id={`refund-auth-${invoiceId}`} className="app-invoice-detail__heading">Restituição excepcional</h3>
      {body}
    </section>
  }
  return <Card>
    <h2 className="mb-3 text-base font-semibold">Restituição excepcional</h2>
    {body}
  </Card>
}
