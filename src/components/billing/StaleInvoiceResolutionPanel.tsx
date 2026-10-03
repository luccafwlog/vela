import { useState } from 'react'
import { useInvoiceCorrectionSummary, useResolveStaleInvoice } from '../../hooks/useBillingLedger'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { Card } from '../ui/Card'
import { Field, Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import { userFacingErrorMessage } from '../../lib/errors'

export function StaleInvoiceResolutionPanel({ invoiceId, hasPayment, canResolve }: { invoiceId: number; hasPayment: boolean; canResolve: boolean }) {
  const query = useInvoiceCorrectionSummary(invoiceId)
  const mutation = useResolveStaleInvoice()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [reason, setReason] = useState('')
  if (!query.data?.stale) return null
  async function resolve() {
    if (!await confirm({ title: 'Resolver Fatura desatualizada?', message: 'Confirma que a diferença já foi tratada?',
      consequence: `O alerta será resolvido com a justificativa: ${reason.trim()}. Esta ação não emite avulsa nem registra correção.`,
      reversibility: 'Uma nova correção do B/L pode reabrir o alerta.', confirmLabel: 'Resolver alerta' })) return
    try { await mutation.mutateAsync({ invoiceId, reason: reason.trim() }); showToast('Alerta resolvido com justificativa.', 'success') }
    catch (error) { showToast(userFacingErrorMessage(error, 'Falha ao resolver alerta.'), 'error') }
  }
  return <Card><h2 className="font-semibold">Fatura desatualizada</h2>
    <p>{hasPayment ? 'Com pagamento: a diferença a maior vai em fatura avulsa. Reduções o sistema já abate do saldo e restitui o excedente.' : 'A correção do B/L reemite esta fatura sozinha; se o alerta continuar, a nova emissão travou e o motivo está acima.'}</p>
    {canResolve ? <div className="mt-3 grid gap-3">
      <Field label="Justificativa da resolução"><Textarea aria-label="Justificativa da resolução" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Informe a avulsa emitida ou como a diferença foi tratada." /></Field>
      <Button disabled={reason.trim().length < 3} loading={mutation.isPending} onClick={() => void resolve()}>Resolver alerta com justificativa</Button>
    </div> : null}
  </Card>
}
