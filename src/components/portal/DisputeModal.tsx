import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/Input'
import { InlineError } from '../ui/Card'
import { Modal } from '../ui/Modal'
import { usePortalOpenDispute, usePortalUploadDisputeAttachment } from '../../hooks/usePortalDisputes'
import { portalErrorMessage } from '../../lib/portalErrorMessage'
import { usePortalScope } from '../../hooks/usePortalScope'
import { isPortalReadOnly } from '../../services/portalScope'
import { PORTAL_DISPUTE_ATTACHMENT_TYPES, portalDisputeAttachmentProblem } from '../../services/portalBilling'
import { useConfirm } from '../ui/ConfirmDialog'

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

function attachmentLabel(file: File) {
  return `${file.name} (${Math.ceil(file.size / 1024)} KB)`
}

/**
 * Abertura da disputa: o motivo vira a primeira mensagem da conversa e o
 * anexo opcional vai nela, como na resposta da conversa. O campo de arquivo
 * do navegador fica escondido atrás do botão "Anexar arquivo".
 */
function DisputeModalContent({ demurrageInvoiceId, docNumber, onClose }: { demurrageInvoiceId: number; docNumber: string; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // Disputa já aberta cujo anexo falhou: o arquivo fica para reenviar só ele.
  const [opened, setOpened] = useState<{ disputeId: number; messageId: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const openDispute = usePortalOpenDispute()
  const uploadAttachment = usePortalUploadDisputeAttachment()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  const confirm = useConfirm()

  function clearFile() {
    setFile(null)
    // O campo escondido guarda o arquivo: limpa para a mesma escolha disparar de novo.
    if (fileInput.current) fileInput.current.value = ''
  }

  async function retryAttachment(target: { disputeId: number; messageId: number }, attachment: File) {
    const confirmed = await confirm({
      title: 'Confirmar envio do anexo',
      message: `Enviar o anexo ${attachment.name} para a disputa ${docNumber}?`,
      confirmLabel: 'Enviar anexo',
      affected: { summary: '1 anexo', items: [attachmentLabel(attachment)] },
      consequence: 'O arquivo será anexado ao motivo da disputa e ficará disponível na conversa.',
      reversibility: 'Depois de enviado, o anexo não pode ser removido pelo Portal.',
    })
    if (!confirmed) return
    try {
      await uploadAttachment.mutateAsync({ ...target, file: attachment })
      onClose()
    } catch (uploadError) {
      setError(`Não foi possível enviar o anexo: ${portalErrorMessage(uploadError, 'Falha ao enviar anexo.')}`)
    }
  }

  async function handleSubmit() {
    if (opened) {
      if (!file) {
        setError('Escolha o arquivo a anexar ou feche: a disputa já foi aberta.')
        return
      }
      const retryProblem = portalDisputeAttachmentProblem(file)
      if (retryProblem) {
        setError(retryProblem)
        return
      }
      setError('')
      await retryAttachment(opened, file)
      return
    }
    if (!reason.trim()) {
      setError('Informe o motivo da disputa.')
      return
    }
    const problem = file ? portalDisputeAttachmentProblem(file) : null
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    const confirmed = await confirm({
      title: 'Confirmar abertura da disputa',
      message: `Enviar a disputa da fatura ${docNumber} para análise?`,
      confirmLabel: 'Abrir disputa',
      affected: {
        summary: '1 disputa de Demurrage',
        items: [
          `Fatura: ${docNumber}`,
          `Motivo: ${reason.trim()}`,
          ...(file ? [`Anexo: ${attachmentLabel(file)}`] : []),
        ],
      },
      consequence: 'A solicitação ficará registrada na conversa e será analisada pela equipe Transhipping.',
      reversibility: file
        ? 'A disputa aberta e o anexo não podem ser apagados pelo Portal; a equipe poderá resolver a disputa após a análise.'
        : 'A disputa aberta não pode ser apagada pelo Portal; a equipe poderá resolvê-la após a análise.',
    })
    if (!confirmed) return
    let result: Awaited<ReturnType<typeof openDispute.mutateAsync>>
    try {
      result = await openDispute.mutateAsync({ demurrageInvoiceId, reason: reason.trim() })
    } catch (err: unknown) {
      setError(portalErrorMessage(err, 'Falha ao abrir disputa. Tente novamente em instantes.'))
      return
    }
    if (file && !(result?.message_id && result.dispute_id)) {
      // Sem os ids não há onde pendurar o anexo: avisa em vez de descartá-lo.
      setError('A disputa foi aberta, mas o anexo não pôde ser enviado. Anexe depois pela conversa da disputa.')
      return
    }
    if (file && result?.message_id && result.dispute_id) {
      // ponytail: a cota e o limite diário de anexos só são conferidos depois
      // de a disputa existir (a conferência pede o id dela); se recusarem, a
      // disputa fica aberta e o modal oferece "Reenviar anexo".
      const target = { disputeId: result.dispute_id, messageId: result.message_id }
      try {
        await uploadAttachment.mutateAsync({ ...target, file })
      } catch (uploadError) {
        setOpened(target)
        setError(`A disputa foi aberta, mas o anexo não pôde ser enviado: ${portalErrorMessage(uploadError, 'Falha ao enviar anexo.')} Reenvie aqui ou anexe depois pela conversa da disputa.`)
        return
      }
    }
    setReason('')
    clearFile()
    onClose()
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-[var(--app-muted)]">
        Descreva o motivo da disputa para a fatura de demurrage <strong>{docNumber}</strong> e,
        se quiser, anexe um documento. Sua solicitação será analisada pela equipe Transhipping.
      </p>

      <Field label="Motivo da disputa">
        <Textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Descreva o motivo da disputa (dias, valores, condições)…"
          disabled={Boolean(opened)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept={PORTAL_DISPUTE_ATTACHMENT_TYPES.join(',')}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={readOnly}
        />
        <Button variant="secondary" className="app-btn--sm" onClick={() => fileInput.current?.click()} disabled={readOnly}>
          <Paperclip size={14} aria-hidden="true" />
          Anexar arquivo
        </Button>
        {file ? (
          <>
            <span className="text-sm">{file.name}</span>
            <Button variant="ghost" className="app-btn--sm" aria-label={`Tirar o anexo ${file.name}`} onClick={clearFile}>
              <X size={14} aria-hidden="true" />
            </Button>
          </>
        ) : <span className="text-xs text-[var(--app-muted)]">PDF, JPG, PNG ou TXT, até 10 MB</span>}
      </div>

      {error ? <InlineError message={error} /> : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{opened ? 'Fechar' : 'Voltar'}</Button>
        <Button
          loading={openDispute.isPending || uploadAttachment.isPending}
          onClick={handleSubmit}
          disabled={readOnly}
          title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}
        >
          {opened ? 'Reenviar anexo' : 'Abrir disputa'}
        </Button>
      </div>
    </div>
  )
}
