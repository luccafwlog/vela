import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useInvoiceCorrectionSummary, useResolveStaleInvoice } from '../../hooks/useBillingLedger'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { Field, Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import { userFacingErrorMessage } from '../../lib/errors'

// Aviso de Fatura desatualizada no topo do detalhe: diz o que fazer com a
// diferença e, para o Administrativo, fecha o alerta com justificativa.
export function StaleInvoiceResolutionPanel({ invoiceId, hasPayment, canResolve }: { invoiceId: number; hasPayment: boolean; canResolve: boolean }) {
  const query = useInvoiceCorrectionSummary(invoiceId)
  const mutation = useResolveStaleInvoice()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  if (!query.data?.stale) return null
  async function resolve() {
    setError('')
    if (!await confirm({ title: 'Resolver Fatura desatualizada?', message: 'Confirma que a diferença já foi tratada?',
      consequence: `O alerta será resolvido com a justificativa: ${reason.trim()}. Esta ação não emite avulsa nem registra correção.`,
      reversibility: 'Uma nova correção do B/L pode reabrir o alerta.', confirmLabel: 'Resolver alerta' })) return
    try { await mutation.mutateAsync({ invoiceId, reason: reason.trim() }); showToast('Alerta resolvido com justificativa.', 'success') }
    catch (caught) { const message = userFacingErrorMessage(caught, 'Falha ao resolver alerta.'); setError(message); showToast(message, 'error') }
  }
  return <section className="app-invoice-detail__callout" aria-labelledby={`stale-${invoiceId}`}>
    <h3 id={`stale-${invoiceId}`} className="app-invoice-detail__heading"><AlertTriangle size={16} aria-hidden="true" />Fatura desatualizada</h3>
    <p>{hasPayment ? 'Com pagamento: a diferença a maior vai em fatura avulsa. Reduções o sistema já abate do saldo e restitui o excedente.' : 'A correção do B/L reemite esta fatura sozinha; se o alerta continuar, a nova emissão travou e o motivo está no alerta financeiro.'}</p>
    {canResolve ? <div className="app-invoice-detail__form">
      <div className="app-invoice-detail__form-wide"><Field label="Justificativa da resolução" required hint="Informe a avulsa emitida ou como a diferença foi tratada."><Textarea aria-label="Justificativa da resolução" value={reason} onChange={(event) => setReason(event.target.value)} /></Field></div>
      {error ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{error}</p> : null}
      <div className="app-invoice-detail__form-actions"><Button variant="secondary" disabled={reason.trim().length < 3} loading={mutation.isPending} onClick={() => void resolve()}>Resolver alerta com justificativa</Button></div>
    </div> : null}
  </section>
}
