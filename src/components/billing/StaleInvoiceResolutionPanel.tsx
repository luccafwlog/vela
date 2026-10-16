import { useState } from 'react'
import { useInvoiceCorrectionSummary, useResolveStaleInvoice } from '../../hooks/useBillingLedger'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { Field, Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import { Block, LeadValue } from '../ui/Block'
import { userFacingErrorMessage } from '../../lib/errors'

// Bloco Fatura desatualizada, logo depois do Saldo no detalhe: diz o que fazer com a
// diferença e fecha o alerta com justificativa (qualquer Departamento; ADR 0085, D3).
export function StaleInvoiceResolutionPanel({ invoiceId, hasPayment }: { invoiceId: number; hasPayment: boolean }) {
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
  return <Block title="Fatura desatualizada" headingLevel={3} aside="o B/L foi corrigido depois da emissão">
    <LeadValue tone="warning" detail={hasPayment ? 'com pagamento, o aumento vai em fatura avulsa; reduções o sistema já abate do saldo e restitui o excedente' : 'a correção do B/L reemite esta fatura sozinha; se o alerta continuar, a nova emissão travou e o motivo está no alerta financeiro'}>
      {hasPayment ? 'Diferença a tratar' : 'Aguardando reemissão'}
    </LeadValue>
    <div className="app-invoice-detail__form">
      <div className="app-invoice-detail__form-wide"><Field label="Como a diferença foi tratada" required hint="Informe a avulsa emitida ou como a diferença foi tratada."><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field></div>
      {error ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{error}</p> : null}
      <div className="app-invoice-detail__form-actions"><Button variant="secondary" disabled={reason.trim().length < 3} loading={mutation.isPending} onClick={() => void resolve()}>Resolver com justificativa</Button></div>
    </div>
  </Block>
}
