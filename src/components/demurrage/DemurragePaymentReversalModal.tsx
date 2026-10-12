import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { ImportNotice } from '../shared/ImportParts'

/**
 * O que acontece com a Invoice suspensa por datas alteradas depois do
 * pagamento quando a baixa é cancelada (migrations 191 e 203; ADR 0079,
 * decisão 2): o operador vê a consequência antes de confirmar.
 */
export type DemurrageReversalDatesNotice = { negotiated: boolean }

export function DemurragePaymentReversalModal({
  open,
  docNumber,
  datesChanged = null,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean
  /**
   * Numero do documento da invoice (`demurrage_invoices.doc_number`). O id da
   * linha nao entra no titulo: o operador nao reconhece "Demurrage #37" numa
   * conversa com o cliente.
   */
  docNumber: string | null
  /** Invoice suspensa porque as datas do container mudaram depois do pagamento. */
  datesChanged?: DemurrageReversalDatesNotice | null
  loading: boolean
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  const trimmedReason = reason.trim()

  return (
    <Modal open={open} onClose={onClose} title={`Cancelar baixa de Demurrage${docNumber ? ` ${docNumber}` : ''}`}>
      <div className="space-y-4 p-4">
        {datesChanged ? (
          <ImportNotice tone="warning" role="status" title="As datas do container mudaram depois do pagamento">
            {datesChanged.negotiated ? (
              <p>
                Sem a baixa, a Invoice fica emitida e com a Régua suspensa, porque tem desconto ou disputa aberta: cancele,
                gere de novo e refaça o desconto ou responda a disputa. Se as datas voltaram às faturadas, a suspensão sai.
              </p>
            ) : (
              <p>
                Sem a baixa, a Invoice é cancelada e reemitida com as datas atuais (ou só cancelada, se o valor novo for
                zero). Se as datas voltaram às faturadas, a suspensão sai e a Invoice segue emitida.
              </p>
            )}
          </ImportNotice>
        ) : null}
        <Field label="Justificativa para cancelar a baixa" required>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Descreva o motivo do cancelamento desta baixa."
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
          <Button
            variant="danger"
            loading={loading}
            disabled={!trimmedReason}
            onClick={() => onSubmit(trimmedReason)}
          >
            Cancelar baixa
          </Button>
        </div>
      </div>
    </Modal>
  )
}
