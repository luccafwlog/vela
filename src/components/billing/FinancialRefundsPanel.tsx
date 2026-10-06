import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { useFinancialRefunds } from '../../hooks/useFinancialRefunds'
import { cancelFinancialRefundAuthorization, confirmDemurrageRefund, requestFinancialRefund, type RefundSource, type RequestFinancialRefundInput } from '../../services/financialRefunds'
import { afterBlInvoiceBasisAlterada } from '../../services/cacheEffects'
import { parseImportNumber } from '../../lib/importNumber'
import { formatBRL, formatDate } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'

export function FinancialRefundsPanel({ source, invoiceId }: { source: RefundSource; invoiceId: number }) {
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
  const [selectedRefundId, setSelectedRefundId] = useState<number | null>(null)
  const [bankReference, setBankReference] = useState('')
  const [beneficiary, setBeneficiary] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const invalidate = () => afterBlInvoiceBasisAlterada(queryClient)
  const request = useMutation({ mutationFn: requestFinancialRefund, onSuccess: invalidate })
  const cancelAuthorization = useMutation({ mutationFn: cancelFinancialRefundAuthorization, onSuccess: invalidate })
  const settle = useMutation({ mutationFn: confirmDemurrageRefund, onSuccess: invalidate })
  const refunds = summary.data?.refunds ?? []
  const reserved = refunds.filter((row) => row.status !== 'cancelled').reduce((total, row) => total + row.amount_brl, 0)
  const refunded = refunds.filter((row) => row.status === 'settled').reduce((total, row) => total + row.amount_brl, 0)
  const available = Math.max((summary.data?.received_brl ?? 0) - reserved, 0)

  async function handleRequest() {
    const parsed = parseImportNumber(amount, 'pt-BR')
    const value = parsed.kind === 'value' ? Number(parsed.decimal) : 0
    if (!attempt && (!(value > 0) || value > available || reason.trim().length < 10)) {
      showToast('Informe valor disponível e justificativa com pelo menos 10 caracteres.', 'error'); return
    }
    const input = attempt ?? { source, invoiceId, amountBrl: value, reason: reason.trim(), purpose, requestId: crypto.randomUUID() }
    if (!await confirm({ title: 'Autorizar restituição excepcional?', message: `${formatBRL(input.amountBrl)}. Motivo: ${input.reason}.`,
      consequence: input.purpose === 'cancel' ? 'Após a devolução integral confirmada, a fatura será cancelada preservando o recebimento e o documento original.' : 'A fatura e o recebimento original serão preservados; o Financeiro deve devolver e confirmar o valor autorizado.',
      reversibility: 'Esta autorização não transfere dinheiro. Confira o Cliente original antes de devolver.', confirmLabel: 'Autorizar restituição' })) return
    setAttempt(input)
    try { await request.mutateAsync(input); setAttempt(null); setAmount(''); setReason(''); showToast('Restituição autorizada. Aguarde a devolução pelo Financeiro.', 'success') }
    catch (error) { showToast(userFacingErrorMessage(error, 'Falha ao autorizar restituição.'), 'error') }
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
  return <Card>
    <h2 className="mb-3 text-base font-semibold">Restituição excepcional</h2>
    {summary.error ? <p role="alert">Não foi possível consultar restituições. Recarregue antes de continuar.</p> : null}
    {summary.data ? <p>Recebido: {formatBRL(summary.data.received_brl)} · Devolvido: {formatBRL(refunded)} · Disponível para autorizar: {formatBRL(available)}.</p> : <p>Consultando recebimentos e restituições...</p>}
    {isAdmin && (available > 0 || attempt) ? <div className="mt-3 grid gap-3">
      <Field label="Valor da restituição BRL"><Input value={amount} disabled={Boolean(attempt)} onChange={(event) => setAmount(event.target.value)} /></Field>
      <Field label="Finalidade da restituição"><Select value={purpose} disabled={Boolean(attempt)} onChange={(event) => setPurpose(event.target.value as typeof purpose)}><option value="correction">Devolução por ajuste</option><option value="cancel">Cancelamento com devolução integral</option></Select></Field>
      <Field label="Justificativa da restituição"><Textarea value={reason} disabled={Boolean(attempt)} onChange={(event) => setReason(event.target.value)} /></Field>
      <Button onClick={handleRequest} loading={request.isPending}>{attempt ? 'Repetir autorização' : 'Autorizar restituição'}</Button>
    </div> : null}
    {refunds.map((refund) => <div key={refund.id} className="mt-3 rounded border p-3">
      <p>{formatBRL(refund.amount_brl)} · {refund.status === 'pending' ? 'Pendente' : refund.status === 'settled' ? 'Devolvida' : 'Cancelada'} · {refund.notes}</p>
      {refund.bank_reference ? <p>Comprovante: {refund.bank_reference} · Favorecido: {refund.beneficiary} · {formatDate(refund.settled_at)}</p> : null}
      {source === 'demurrage' && refund.status === 'pending' && mayConfirm ? <Button variant="secondary" onClick={() => { setSelectedRefundId(refund.id); setBankReference(''); setBeneficiary(''); setPaidAt('') }}>Registrar devolução</Button> : null}
      {refund.status === 'pending' && isAdmin && refund.request_id ? <Button variant="ghost" onClick={() => setCancelId(refund.id)}>Cancelar autorização</Button> : null}
    </div>)}
    {source === 'manual' ? <p className="mt-2 text-sm">Confirme a devolução na lista de restituições desta fatura.</p> : null}
    {cancelId !== null ? <div className="mt-3 grid gap-3">
      <Field label="Motivo para cancelar autorização"><Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field>
      <Button variant="danger" onClick={handleCancelAuthorization} loading={cancelAuthorization.isPending} disabled={cancelReason.trim().length < 10}>Confirmar cancelamento da autorização</Button>
      <Button variant="ghost" onClick={() => setCancelId(null)}>Voltar</Button>
    </div> : null}
    {selectedRefundId !== null ? <div className="mt-3 grid gap-3">
      <Field label="Referência do comprovante bancário"><Input value={bankReference} onChange={(event) => setBankReference(event.target.value)} /></Field>
      <Field label="Favorecido (Cliente original / CNPJ)"><Input value={beneficiary} onChange={(event) => setBeneficiary(event.target.value)} /></Field>
      <Field label="Data da devolução"><Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></Field>
      <Button onClick={handleSettle} loading={settle.isPending} disabled={!bankReference.trim() || !beneficiary.trim() || !paidAt}>Confirmar devolução realizada</Button>
      <Button variant="ghost" onClick={() => setSelectedRefundId(null)}>Fechar</Button>
    </div> : null}
  </Card>
}
