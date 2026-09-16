import { useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { usePortalAddDisputeMessage, usePortalRequestDisputeReopen } from '../../hooks/usePortalDisputes'
import { portalUploadDisputeAttachment } from '../../services/portalBilling'
import { usePortalScope } from '../../hooks/usePortalScope'
import type { PortalDispute } from '../../services/portalBilling'
import { formatDate } from '../../lib/utils'
import { portalErrorMessage } from '../../lib/portalErrorMessage'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, InlineError } from '../ui/Card'
import { Textarea } from '../ui/Input'
import { isPortalReadOnly } from '../../services/portalScope'

function stateLabel(state: PortalDispute['state']) {
  return state === 'aberta' ? 'Aberta' : state === 'resolvida' ? 'Resolvida' : 'Cancelada'
}

function stateTone(state: PortalDispute['state']) {
  return state === 'aberta' ? 'yellow' : state === 'resolvida' ? 'green' : 'slate'
}

export function PortalDisputeConversation({ disputes }: { disputes: PortalDispute[] }) {
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  const addMessage = usePortalAddDisputeMessage()
  const requestReopen = usePortalRequestDisputeReopen()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [files, setFiles] = useState<Record<number, File | null>>({})

  if (!disputes.length) return null

  async function submit(dispute: PortalDispute) {
    const body = (drafts[dispute.id] ?? '').trim()
    if (!body) {
      setErrors((current) => ({ ...current, [dispute.id]: 'Escreva uma mensagem antes de enviar.' }))
      return
    }
    setErrors((current) => ({ ...current, [dispute.id]: '' }))
    try {
      if (dispute.state === 'resolvida') {
        await requestReopen.mutateAsync({ disputeId: dispute.id, body })
      } else {
        const result = await addMessage.mutateAsync({ demurrageInvoiceId: dispute.demurrage_invoice_id, body })
        const file = files[dispute.id]
        if (file && result?.message_id && scope.customerId) await portalUploadDisputeAttachment(result.message_id, dispute.id, scope.customerId, file, scope)
      }
      setDrafts((current) => ({ ...current, [dispute.id]: '' }))
      setFiles((current) => ({ ...current, [dispute.id]: null }))
    } catch (error) {
      setErrors((current) => ({ ...current, [dispute.id]: portalErrorMessage(error, 'Falha ao enviar a mensagem.') }))
    }
  }

  return (
    <Card className="mb-4">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare size={18} />
        <div>
          <h2 className="font-semibold text-[var(--app-text-strong)]">Conversas de Dispute</h2>
          <p className="text-xs text-[var(--app-muted)]">Mensagens imutáveis, com o próximo responsável explícito.</p>
        </div>
      </div>
      <div className="grid gap-4">
        {disputes.map((dispute) => (
          <article key={dispute.id} className="rounded-xl border border-[var(--app-border)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-[var(--app-text-strong)]">{dispute.doc_number}</div>
                <div className="text-xs text-[var(--app-muted)]">Atualizada em {formatDate(dispute.updated_at)}</div>
              </div>
              <Badge tone={stateTone(dispute.state) as 'yellow' | 'green' | 'slate'}>{stateLabel(dispute.state)}</Badge>
            </div>
            <div className="grid gap-2">
              {dispute.messages.map((message) => (
                <div key={message.id} className="rounded-lg bg-[var(--app-surface-muted)] px-3 py-2 text-sm">
                  <div className="mb-1 flex justify-between gap-2 text-xs text-[var(--app-muted)]">
                    <span>{message.author_type === 'cliente' ? 'Você' : message.author_type === 'equipamentos' ? 'Equipamentos' : 'Sistema'}</span>
                    <span>{formatDate(message.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{message.body}</p>
                </div>
              ))}
            </div>
            {dispute.state !== 'cancelada' ? (
              <div className="mt-3 grid gap-2">
                <Textarea
                  rows={2}
                  value={drafts[dispute.id] ?? ''}
                  onChange={(event) => setDrafts((current) => ({ ...current, [dispute.id]: event.target.value }))}
                  placeholder={dispute.state === 'resolvida' ? 'Explique por que a disputa deve ser reaberta...' : 'Responda à conversa...'}
                  disabled={readOnly}
                />
                {dispute.state === 'aberta' ? <input type="file" accept="application/pdf,image/jpeg,image/png,text/plain" onChange={(event) => setFiles((current) => ({ ...current, [dispute.id]: event.target.files?.[0] ?? null }))} disabled={readOnly} /> : null}
                {errors[dispute.id] ? <InlineError message={errors[dispute.id]} /> : null}
                <div className="flex justify-end">
                  <Button
                    loading={addMessage.isPending || requestReopen.isPending}
                    disabled={readOnly}
                    onClick={() => void submit(dispute)}
                    title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}
                  >
                    <Send size={14} />
                    {dispute.state === 'resolvida' ? 'Solicitar reabertura' : 'Enviar mensagem'}
                  </Button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </Card>
  )
}
