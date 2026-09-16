import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/Input'
import { InlineError } from '../ui/Card'
import { Modal } from '../ui/Modal'
import { usePortalOpenDispute } from '../../hooks/usePortalDisputes'
import { portalErrorMessage } from '../../lib/portalErrorMessage'
import { usePortalScope } from '../../hooks/usePortalScope'
import { isPortalReadOnly } from '../../services/portalScope'

type Props = {
  demurrageInvoiceId: number | null
  docNumber: string
  onClose: () => void
}

export function DisputeModal({ demurrageInvoiceId, docNumber, onClose }: Props) {
  const open = Boolean(demurrageInvoiceId)

  return (
    <Modal open={open} onClose={onClose} title={`Disputar ${docNumber}`}>
      {open ? (
        <DisputeModalContent demurrageInvoiceId={demurrageInvoiceId!} docNumber={docNumber} onClose={onClose} />
      ) : null}
    </Modal>
  )
}

function DisputeModalContent({ demurrageInvoiceId, docNumber, onClose }: { demurrageInvoiceId: number; docNumber: string; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const openDispute = usePortalOpenDispute()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  async function handleSubmit() {
    if (!reason.trim()) {
      setError('Informe o motivo da disputa.')
      return
    }
    setError('')
    try {
      await openDispute.mutateAsync({ demurrageInvoiceId, reason: reason.trim() })
      setReason('')
      onClose()
    } catch (err: unknown) {
      setError(portalErrorMessage(err, 'Falha ao abrir disputa. Tente novamente em instantes.'))
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-[var(--app-muted)]">
        Descreva o motivo da disputa para a fatura de demurrage <strong>{docNumber}</strong>.
        Sua solicitação será analisada pela equipe Transhipping.
      </p>

      <Field label="Motivo da disputa">
        <Textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Descreva detalhadamente o motivo da disputa (dias, valores, condicoes)..."
        />
      </Field>

      {error ? <InlineError message={error} /> : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={openDispute.isPending} onClick={handleSubmit} disabled={readOnly} title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}>Abrir disputa</Button>
      </div>
    </div>
  )
}
