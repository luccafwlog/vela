import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { releaseDemurrageManualRoe } from '../../services/demurrage/demurrageInvoices'
import { afterFaturaDemurrageAlterada } from '../../services/cacheEffects'
import { userFacingErrorMessage } from '../../lib/errors'

// ADR 0094, B10: a Invoice com ROE manual não acompanha a PTAX; o Financeiro
// ou o Administrativo tira o ROE manual, com motivo, e ela volta ao câmbio do dia.
export function ManualRoeRelease({ invoiceId, docNumber }: { invoiceId: number; docNumber: string }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () => releaseDemurrageManualRoe(invoiceId, reason),
    onSuccess: () => afterFaturaDemurrageAlterada(queryClient),
  })

  async function release() {
    setError('')
    if (!await confirm({
      title: 'Tirar o ROE manual?',
      message: `A Invoice ${docNumber} passa a usar o câmbio de referência de hoje.`,
      consequence: 'O valor em reais muda e a Invoice volta ao recálculo diário pela PTAX até o pagamento.',
      reversibility: 'O ROE manual não volta por esta tela; o motivo fica no histórico.',
      confirmLabel: 'Tirar ROE manual',
    })) return
    try {
      await mutation.mutateAsync()
      showToast('ROE manual retirado: a Invoice segue a PTAX.', 'success')
      setOpen(false)
      setReason('')
    } catch (caught) {
      const message = userFacingErrorMessage(caught, 'Falha ao tirar o ROE manual.')
      setError(message)
      showToast(message, 'error')
    }
  }

  if (!open) {
    return <Button variant="secondary" onClick={() => setOpen(true)}>Tirar ROE manual…</Button>
  }
  return (
    <div className="app-invoice-detail__form">
      <div className="app-invoice-detail__form-wide">
        <Field label="Motivo para tirar o ROE manual" required hint="Mínimo de 10 caracteres; fica no histórico da Invoice.">
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
      {error ? <p role="alert" className="app-invoice-detail__alert app-invoice-detail__form-wide">{error}</p> : null}
      <div className="app-invoice-detail__form-actions">
        <Button variant="secondary" onClick={() => { setOpen(false); setError('') }}>Voltar</Button>
        <Button disabled={reason.trim().length < 10} loading={mutation.isPending} onClick={() => void release()}>Tirar ROE manual</Button>
      </div>
    </div>
  )
}
