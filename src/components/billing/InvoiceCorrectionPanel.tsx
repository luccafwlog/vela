import { useState } from 'react'
import { useConfirm } from '../ui/ConfirmDialog'
import { Field, Select, Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import { useInvoiceCorrectionSummary, useRetryInvoiceBasisChanges, usePrepareBlFinancialCancellation } from '../../hooks/useBillingLedger'
import { formatBRL } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'

// ADR 0077: reduções pela base do B/L seguem automáticas. Quando a
// correção do B/L reduz uma fatura com pagamento, o sistema abate o saldo e
// registra a restituição do excedente. O retry recupera falha da mesma operação.
export function InvoiceCorrectionPanel({ invoiceId }: { invoiceId: number }) {
  const summary = useInvoiceCorrectionSummary(invoiceId)
  const cancellation = usePrepareBlFinancialCancellation()
  const confirm = useConfirm()
  const [cancelBlId, setCancelBlId] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const retry = useRetryInvoiceBasisChanges()
  const { isAdmin } = useAuth()
  const pending = summary.data?.pending_bl_ids ?? []
  const corrections = summary.data?.corrections ?? []
  const customerChanges = summary.data?.customer_changes ?? []
  const cancelCandidates = (summary.data?.receivables ?? []).filter((row) => row.corrected_brl > 0 && row.paid_brl > 0 && !customerChanges.some((change) => change.bl_id === row.bl_id && change.status !== 'completed'))
  if (!summary.error && corrections.length === 0 && pending.length === 0 && customerChanges.length === 0 && (!isAdmin || cancelCandidates.length === 0)) return null
  async function prepareCancellation() {
    const target = cancelCandidates.find((row) => row.bl_id === cancelBlId)
    if (!target || cancelReason.trim().length < 10) return
    if (!await confirm({ title: 'Preparar cancelamento da cobrança do B/L?',
      message: `B/L ${target.bl_id}. Cobrança vigente: ${formatBRL(target.corrected_brl)}. Motivo: ${cancelReason.trim()}.`,
      consequence: 'O saldo desta cobrança será abatido e o recebido será separado para restituição. Os demais B/Ls da consolidada serão preservados.',
      reversibility: 'Após devolver e confirmar, o Administrativo deve cancelar o B/L na ficha. Esta ação não cancela o B/L operacionalmente.', confirmLabel: 'Preparar cancelamento' })) return
    try { await cancellation.mutateAsync({ invoiceId, blId: target.bl_id, reason: cancelReason }); setCancelBlId(''); setCancelReason('') }
    catch { /* O erro permanece visível no painel da operação. */ }
  }
  return <Card>
    <h2 className="mb-3 text-base font-semibold">Ajustes pela correção do B/L</h2>
    <p>A fatura emitida preserva total e itens. A redução abate primeiro o saldo aberto; o que passar dele é restituído ao Cliente.</p>
    {summary.error ? <p role="alert">Não foi possível consultar os ajustes. Recarregue a página.</p> : null}
    {customerChanges.map((change) => <div key={change.bl_id} className="mt-3 rounded border p-3">
      <strong>Troca de CNPJ · B/L {change.bl_id}</strong>
      <p>{change.status === 'pending_refund' ? 'Devolva ao Cliente original e confirme com comprovante. A nova cobrança aguarda a devolução.' : change.status === 'reissue_pending' ? 'Devolução concluída; nova emissão pendente. Corrija a pendência cadastral e tente novamente.' : `Troca concluída. Nova fatura: ${change.new_invoice_id ?? 'B/L isento ou cancelado'}.`}</p>
      {change.status === 'reissue_pending' && isAdmin ? <Button onClick={() => retry.mutate(change.bl_id)} loading={retry.isPending}>Tentar emitir para o novo Cliente</Button> : null}
    </div>)}
    {pending.map((blId) => <div key={blId} className="mt-3 rounded border p-3">
      <p>A correção financeira do B/L {blId} não foi concluída. Revise as pendências antes de tentar novamente.</p>
      {isAdmin ? <button type="button" disabled={retry.isPending} onClick={() => retry.mutate(blId)}>
        Tentar aplicar correção
      </button> : null}
    </div>)}
    {retry.error ? <p role="alert">Não foi possível aplicar a correção. A pendência foi preservada.</p> : null}
    {isAdmin && cancelCandidates.length > 0 ? <div className="mt-3 grid gap-3">
      <p>Para cancelar cobrança com recebimento verdadeiro, prepare a restituição. Para erro de tarifa ou quantidade, corrija a base do B/L.</p>
      <Field label="B/L para cancelamento financeiro"><Select value={cancelBlId} onChange={(event) => setCancelBlId(event.target.value)}><option value="">Selecione o B/L</option>{cancelCandidates.map((row) => <option key={row.bl_id} value={row.bl_id}>{row.bl_id} · {formatBRL(row.corrected_brl)}</option>)}</Select></Field>
      <Field label="Motivo do cancelamento financeiro"><Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field>
      <Button variant="danger" onClick={prepareCancellation} loading={cancellation.isPending} disabled={!cancelBlId || cancelReason.trim().length < 10}>Preparar cancelamento financeiro</Button>
      {cancellation.error ? <p role="alert">Não foi possível preparar o cancelamento. Confira o recebível e a pendência financeira.</p> : null}
    </div> : null}
    {corrections.map((item) => <div key={item.id} className="mt-3 rounded border p-3">
      <strong>B/L {item.bl_id} · redução de {formatBRL(item.amount_brl)}</strong>
      <p>Abatido do saldo: {formatBRL(item.offset_brl)} · Restituição: {formatBRL(item.refund_brl)}.</p>
      <p>{item.reason}</p>
    </div>)}
  </Card>
}
