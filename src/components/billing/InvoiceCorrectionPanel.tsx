import { useState } from 'react'
import { useInvoiceCorrectionSummary, useRegisterInvoiceCorrection } from '../../hooks/useBillingLedger'
import { previewInvoiceCorrection } from '../../services/invoiceCorrection'
import { formatBRL } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { Card } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'

export function InvoiceCorrectionPanel({ invoiceId, canCorrect }: { invoiceId: number; canCorrect: boolean }) {
  const summary = useInvoiceCorrectionSummary(invoiceId)
  const mutation = useRegisterInvoiceCorrection()
  const confirm = useConfirm()
  const { showToast } = useToast()
  const [receivableId, setReceivableId] = useState('')
  const [correctedTotal, setCorrectedTotal] = useState('')
  const [reason, setReason] = useState('')
  const row = summary.data?.receivables.find((item) => item.id === Number(receivableId))
  const total = correctedTotal.trim() ? Number(correctedTotal.replace(',', '.')) : NaN
  const preview = row ? previewInvoiceCorrection(Number(row.corrected_brl), Number(row.balance_brl), total) : null
  async function submit() {
    if (!row || !preview || reason.trim().length < 3) return
    const accepted = await confirm({ title: 'Registrar correção da cobrança?',
      message: `B/L ${row.bl_id}: reduzir a cobrança vigente de ${formatBRL(row.corrected_brl)} para ${formatBRL(total)}?`,
      consequence: `Abatimento do saldo: ${formatBRL(preview.offset)}. Restituição a registrar: ${formatBRL(preview.refund)}. Saldo restante deste B/L: ${formatBRL(preview.balance)}. O total original e os itens da fatura serão preservados.`,
      reversibility: 'A correção fica registrada no histórico. A restituição só é liquidada após a devolução efetiva do dinheiro.',
      confirmLabel: 'Registrar correção' })
    if (!accepted) return
    try {
      const result = await mutation.mutateAsync({ invoiceId, receivableId: row.id, correctedTotalBrl: total, reason: reason.trim() })
      showToast(`Correção registrada: ${formatBRL(result.offset_brl)} abatidos; ${formatBRL(result.refund_brl)} a restituir.`, 'success')
      setCorrectedTotal(''); setReason('')
    } catch (error) { showToast(userFacingErrorMessage(error, 'Falha ao registrar correção.'), 'error') }
  }
  return <Card>
    <h2 className="mb-3 text-base font-semibold">Correção após pagamento</h2>
    <p>Com pagamento parcial ou integral, a fatura permanece emitida. Para acrescentar uma taxa ou aumentar o valor, emita uma fatura avulsa vinculada ao B/L.</p>
    {summary.error ? <p role="alert">Não foi possível consultar as correções. Recarregue antes de continuar.</p> : null}
    {(summary.data?.corrections ?? []).map((item) => <div key={item.id} className="mt-3 rounded border p-3">
      <strong>B/L {item.bl_id} · redução de {formatBRL(item.amount_brl)}</strong>
      <p>Abatido do saldo: {formatBRL(item.offset_brl)} · Restituição registrada: {formatBRL(item.refund_brl)}.</p>
      <p>Motivo: {item.reason}</p>
    </div>)}
    {canCorrect ? <div className="mt-4 grid gap-3">
      <p><strong>Para reduzir a cobrança:</strong> selecione o B/L e informe o valor total correto da cobrança desse B/L. O sistema calcula a diferença, abate primeiro o saldo aberto e registra como restituição somente o que já foi recebido a mais.</p>
      <Field label="B/L da correção" required><Select aria-label="B/L da correção" value={receivableId} onChange={(event) => { setReceivableId(event.target.value); setCorrectedTotal('') }}>
        <option value="">Selecione o B/L</option>
        {(summary.data?.receivables ?? []).map((item) => <option key={item.id} value={item.id}>{item.bl_id}</option>)}
      </Select></Field>
      {row ? <p>Cobrança vigente: {formatBRL(row.corrected_brl)} · Pago neste B/L: {formatBRL(row.paid_brl)} · Saldo aberto: {formatBRL(row.balance_brl)}.</p> : null}
      <Field label="Valor total corrigido do B/L (BRL)" required><Input aria-label="Valor total corrigido do B/L (BRL)" inputMode="decimal" value={correctedTotal} onChange={(event) => setCorrectedTotal(event.target.value)} /></Field>
      <Field label="Motivo da correção" required><Textarea aria-label="Motivo da correção" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      {preview ? <div role="status" className="rounded border p-3">
        <p>Redução da cobrança: <strong>{formatBRL(preview.difference)}</strong></p>
        <p>Abater do saldo aberto: <strong>{formatBRL(preview.offset)}</strong></p>
        <p>Registrar restituição por correção: <strong>{formatBRL(preview.refund)}</strong></p>
        <p>Saldo a pagar deste B/L após a correção: <strong>{formatBRL(preview.balance)}</strong></p>
        <p>A restituição não é um novo pagamento. Depois de devolver o dinheiro, marque a restituição como efetuada.</p>
      </div> : correctedTotal && row ? <p role="alert">Informe um valor menor que a cobrança vigente. Para aumento, use Nova fatura avulsa.</p> : null}
      <Button disabled={!preview || reason.trim().length < 3 || summary.isFetching} loading={mutation.isPending} onClick={() => void submit()}>Registrar correção da cobrança</Button>
    </div> : null}
  </Card>
}
