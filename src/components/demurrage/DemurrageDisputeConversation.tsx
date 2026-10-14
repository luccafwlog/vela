import { useEffect, useMemo, useState } from 'react'
import { MessageSquare, Paperclip, Send } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState, InlineError } from '../ui/Card'
import { Textarea } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { formatDateTime } from '../../lib/utils'
import { portalErrorMessage } from '../../lib/portalErrorMessage'
import { useAuth } from '../../hooks/useAuth'
import { useConfirm } from '../ui/ConfirmDialog'
import { canAnswerDemurrageDispute } from './demurrageFormRules'
import { afterFaturaDemurrageAlterada } from '../../services/cacheEffects'
import { addDemurrageDisputeMessage, listDemurrageDisputes, reopenDemurrageDispute, uploadDemurrageDisputeAttachment, type DemurrageDispute } from '../../services/demurrage/demurrageDisputes'

const DISPUTE_AUTHOR_LABELS: Record<string, string> = {
  cliente: 'Cliente',
  equipamentos: 'Equipamentos',
  administrativo: 'Administrativo',
  sistema: 'Sistema',
}

const STATE_LABELS: Record<DemurrageDispute['state'], string> = {
  aberta: 'Aberta',
  resolvida: 'Resolvida',
  cancelada: 'Cancelada',
}

const NEXT_LABELS: Record<DemurrageDispute['next_responder'], string> = {
  equipamentos: 'Aguarda a nossa resposta',
  cliente: 'Aguarda o Cliente',
  ninguem: 'Sem pendência de resposta',
}

type Filter = 'abertas' | 'resolvidas' | 'todas'

type Props = {
  /** Disputa em foco (alerta "Disputa aberta no Portal" manda `?dispute=`). */
  focusDisputeId?: number | null
  /** Invoice cuja conversa foi pedida no detalhe. */
  focusInvoiceId?: number | null
  onOpenInvoice?: (invoiceId: number) => void
}

export function DemurrageDisputeConversation(props: Props) {
  const { effectiveRole } = useAuth()
  if (!canAnswerDemurrageDispute(effectiveRole)) return null
  return <DemurrageDisputeConversationContent {...props} />
}

function DemurrageDisputeConversationContent({ focusDisputeId = null, focusInvoiceId = null, onOpenInvoice }: Props) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [nextResponders, setNextResponders] = useState<Record<number, 'cliente' | 'ninguem'>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [attachments, setAttachments] = useState<Record<number, File | null>>({})
  // O campo de arquivo não é controlado: trocar a chave o recria vazio depois do envio.
  const [fileInputKeys, setFileInputKeys] = useState<Record<number, number>>({})
  // Mensagem gravada cujo anexo falhou: o arquivo fica para reenviar só ele.
  const [failedUploads, setFailedUploads] = useState<Record<number, { messageId: number; file: File } | null>>({})
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [sentId, setSentId] = useState<number | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['demurrage-disputes'],
    queryFn: () => listDemurrageDisputes(),
    staleTime: 30_000,
  })
  const disputes = useMemo(() => data ?? [], [data])
  const messageMutation = useMutation({
    mutationFn: ({ id, body, nextResponder }: { id: number; body: string; nextResponder: 'cliente' | 'ninguem' }) =>
      addDemurrageDisputeMessage(id, body, nextResponder),
  })
  const reopenMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => reopenDemurrageDispute(id, body),
  })

  const focused = disputes.find((dispute) => dispute.id === focusDisputeId)
    ?? disputes.find((dispute) => dispute.demurrage_invoice_id === focusInvoiceId)
  const [filter, setFilter] = useState<Filter | null>(null)
  const counts = {
    abertas: disputes.filter((dispute) => dispute.state === 'aberta').length,
    resolvidas: disputes.filter((dispute) => dispute.state === 'resolvida').length,
    todas: disputes.length,
  }
  // Começa nas abertas quando há alguma; a Disputa em foco fora delas abre em Todas.
  const defaultFilter: Filter = counts.abertas && (!focused || focused.state === 'aberta') ? 'abertas' : 'todas'
  const effectiveFilter: Filter = filter ?? defaultFilter
  // A que espera a nossa resposta vem primeiro; depois, a atualizada mais recente.
  const visible = disputes
    .filter((dispute) => effectiveFilter === 'todas' || (effectiveFilter === 'abertas' ? dispute.state === 'aberta' : dispute.state === 'resolvida'))
    .slice()
    .sort((left, right) => {
      const waitLeft = left.state === 'aberta' && left.next_responder === 'equipamentos' ? 0 : 1
      const waitRight = right.state === 'aberta' && right.next_responder === 'equipamentos' ? 0 : 1
      return waitLeft - waitRight || right.updated_at.localeCompare(left.updated_at)
    })

  // Rola só quando a Disputa em foco muda, não a cada releitura da lista.
  const focusedId = focused?.id ?? null
  useEffect(() => {
    if (focusedId == null) return
    document.getElementById(`dispute-${focusedId}`)?.scrollIntoView?.({ block: 'start' })
  }, [focusedId])

  async function retryUpload(dispute: DemurrageDispute) {
    const failed = failedUploads[dispute.id]
    if (!failed) return
    setPendingId(dispute.id)
    try {
      await uploadDemurrageDisputeAttachment(failed.messageId, dispute.id, dispute.customer_id, failed.file)
      setFailedUploads((current) => ({ ...current, [dispute.id]: null }))
      setErrors((current) => ({ ...current, [dispute.id]: '' }))
      setSentId(dispute.id)
      await afterFaturaDemurrageAlterada(queryClient)
    } catch (cause) {
      setErrors((current) => ({ ...current, [dispute.id]: `O anexo ainda não foi enviado: ${portalErrorMessage(cause, 'falha no envio do arquivo.')}` }))
    } finally {
      setPendingId(null)
    }
  }

  async function submit(dispute: DemurrageDispute) {
    const body = (drafts[dispute.id] ?? '').trim()
    if (!body) {
      setErrors((current) => ({ ...current, [dispute.id]: dispute.state === 'resolvida' ? 'Escreva a justificativa da reabertura.' : 'Escreva a resposta antes de enviar.' }))
      return
    }
    setErrors((current) => ({ ...current, [dispute.id]: '' }))
    const isReopen = dispute.state === 'resolvida'
    const nextResponder = nextResponders[dispute.id] ?? 'cliente'
    const file = attachments[dispute.id]
    const confirmed = await confirm({
      title: isReopen ? 'Confirmar reabertura da Disputa' : 'Confirmar resposta ao cliente',
      message: isReopen
        ? `Reabrir a Disputa ${dispute.doc_number} com esta justificativa?`
        : `Enviar resposta ao cliente na Disputa ${dispute.doc_number}?`,
      confirmLabel: isReopen ? 'Reabrir Disputa' : 'Enviar resposta',
      affected: {
        summary: isReopen ? 'Reabertura da Disputa' : 'Resposta da Disputa',
        items: [
          `Cliente: ${dispute.customer_name}`,
          `Documento: ${dispute.doc_number}`,
          `Mensagem: ${body}`,
          ...(!isReopen ? [`Próximo responsável: ${nextResponder === 'cliente' ? 'Cliente' : 'Ninguém'}`] : []),
          ...(file ? [`Anexo: ${file.name} (${Math.ceil(file.size / 1024)} KB)`] : []),
        ],
      },
      consequence: isReopen
        ? 'A Disputa volta à fila aberta com a justificativa registrada, a Régua de Cobrança pausa e o cliente poderá responder.'
        : `A resposta fica visível ao cliente no Portal${nextResponder === 'cliente' ? ' e aguarda retorno do cliente' : ' e encerra a pendência de resposta'}.`,
      reversibility: 'Mensagens e anexos enviados ficam no histórico e não podem ser editados ou removidos.',
    })
    if (!confirmed) return
    setPendingId(dispute.id)
    setSentId(null)
    try {
      if (isReopen) {
        await reopenMutation.mutateAsync({ id: dispute.id, body })
      } else {
        const result = await messageMutation.mutateAsync({ id: dispute.id, body, nextResponder }) as { message_id?: number }
        if (file && result.message_id) {
          try {
            await uploadDemurrageDisputeAttachment(result.message_id, dispute.id, dispute.customer_id, file)
          } catch (cause) {
            // A mensagem já foi gravada: a falha é só do anexo, que pode ser reenviado.
            setFailedUploads((current) => ({ ...current, [dispute.id]: { messageId: result.message_id!, file } }))
            setErrors((current) => ({ ...current, [dispute.id]: `A resposta foi enviada, mas o anexo não: ${portalErrorMessage(cause, 'falha no envio do arquivo.')}` }))
          }
        }
      }
      setDrafts((current) => ({ ...current, [dispute.id]: '' }))
      setAttachments((current) => ({ ...current, [dispute.id]: null }))
      setFileInputKeys((current) => ({ ...current, [dispute.id]: (current[dispute.id] ?? 0) + 1 }))
      setSentId(dispute.id)
      await afterFaturaDemurrageAlterada(queryClient)
    } catch (cause) {
      setErrors((current) => ({ ...current, [dispute.id]: portalErrorMessage(cause, 'Falha ao atualizar a Disputa.') }))
    } finally {
      setPendingId(null)
    }
  }

  if (isLoading) return <p className="app-dem-meta" role="status">Carregando Disputas…</p>
  if (error) {
    return (
      <div className="app-dem-tab">
        <InlineError message="Não foi possível carregar as Disputas." />
        <Button variant="secondary" className="app-btn--sm" onClick={() => void refetch()}>Tentar novamente</Button>
      </div>
    )
  }

  return (
    <div className="app-dem-tab">
      <div className="app-dem-toolbar">
        <SegmentedControl
          label="Disputas por situação"
          value={effectiveFilter}
          onChange={setFilter}
          options={[
            { value: 'abertas', label: `Abertas (${counts.abertas})` },
            { value: 'resolvidas', label: `Resolvidas (${counts.resolvidas})` },
            { value: 'todas', label: `Todas (${counts.todas})` },
          ]}
        />
        <p className="app-dem-note">Cada resposta fica visível ao Cliente no Portal e define quem age em seguida.</p>
      </div>
      {!visible.length ? (
        <EmptyState icon={MessageSquare} title={disputes.length ? 'Nenhuma Disputa nesta situação' : 'Nenhuma Disputa'} description={disputes.length ? undefined : 'As contestações abertas pelo Cliente no Portal aparecem aqui.'} />
      ) : (
        <div className="app-dem-disputes">
          {visible.map((dispute) => {
            const messages = dispute.messages ?? []
            const showAll = expanded[dispute.id] || messages.length <= 3
            const shown = showAll ? messages : messages.slice(-3)
            const waiting = dispute.state === 'aberta' && dispute.next_responder === 'equipamentos'
            return (
              <article
                key={dispute.id}
                id={`dispute-${dispute.id}`}
                className={`app-dem-dispute${focused?.id === dispute.id ? ' app-dem-dispute--focused' : ''}`}
                aria-labelledby={`dispute-${dispute.id}-title`}
              >
                <header className="app-dem-dispute__head">
                  <div className="app-table__cell-stack">
                    <h3 id={`dispute-${dispute.id}-title`} className="app-dem-dispute__title">
                      {onOpenInvoice ? (
                        <button type="button" className="app-dem-link app-dem-code" onClick={() => onOpenInvoice(dispute.demurrage_invoice_id)}>{dispute.doc_number}</button>
                      ) : <span className="app-dem-code">{dispute.doc_number}</span>}
                      {' '}<span>· {dispute.customer_name}</span>
                    </h3>
                    {dispute.subject ? <span className="app-dem-dispute__subject">{dispute.subject}</span> : null}
                    <span className="app-dem-meta">Atualizada em {formatDateTime(dispute.updated_at)}</span>
                  </div>
                  <div className="app-dem-dispute__state">
                    <Badge tone={dispute.state === 'aberta' ? 'warning' : dispute.state === 'resolvida' ? 'success' : 'neutral'}>{STATE_LABELS[dispute.state] ?? dispute.state}</Badge>
                    {dispute.state === 'aberta' ? <span className={waiting ? 'app-dem-state app-dem-state--warning' : 'app-dem-meta'}>{NEXT_LABELS[dispute.next_responder] ?? dispute.next_responder}</span> : null}
                  </div>
                </header>

                {messages.length ? (
                  <ol className="app-dem-messages" aria-label={`Conversa da Disputa ${dispute.doc_number}`}>
                    {!showAll ? (
                      <li className="app-dem-messages__more">
                        <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => setExpanded((current) => ({ ...current, [dispute.id]: true }))}>
                          Ver {messages.length - 3} {messages.length - 3 === 1 ? 'mensagem anterior' : 'mensagens anteriores'}
                        </Button>
                      </li>
                    ) : null}
                    {shown.map((message) => (
                      <li key={message.id} className={`app-dem-message${message.author_type === 'cliente' ? ' app-dem-message--customer' : ''}`}>
                        <div className="app-dem-message__meta">
                          <span className="app-dem-strong">{DISPUTE_AUTHOR_LABELS[message.author_type] ?? message.author_type}</span>
                          <span>{formatDateTime(message.created_at)}</span>
                        </div>
                        <p className="app-dem-message__body">{message.body}</p>
                        {message.attachments?.length ? (
                          <p className="app-dem-meta"><Paperclip size={12} aria-hidden="true" /> {message.attachments.map((attachment) => attachment.file_name).join(', ')}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : <p className="app-dem-meta">Sem mensagens.</p>}

                {dispute.state !== 'cancelada' ? (
                  <div className="app-dem-dispute__reply">
                    <label className="app-field__label" htmlFor={`dispute-${dispute.id}-body`}>{dispute.state === 'resolvida' ? 'Justificativa da reabertura' : 'Resposta ao Cliente'}</label>
                    <Textarea
                      id={`dispute-${dispute.id}-body`}
                      rows={2}
                      value={drafts[dispute.id] ?? ''}
                      aria-invalid={errors[dispute.id] ? true : undefined}
                      onChange={(event) => setDrafts((current) => ({ ...current, [dispute.id]: event.target.value }))}
                      placeholder={dispute.state === 'resolvida' ? 'Justifique a reabertura...' : 'Responder ao cliente...'}
                    />
                    {dispute.state === 'aberta' ? (
                      <div className="app-dem-dispute__options">
                        <label className="app-dem-file">
                          <span className="app-field__label">Anexo (PDF, JPG, PNG ou TXT até 10 MB)</span>
                          <input key={fileInputKeys[dispute.id] ?? 0} type="file" accept="application/pdf,image/jpeg,image/png,text/plain" onChange={(event) => setAttachments((current) => ({ ...current, [dispute.id]: event.target.files?.[0] ?? null }))} aria-label="Anexo da Disputa" />
                        </label>
                        <label className="app-dem-file">
                          <span className="app-field__label">Depois de enviar</span>
                          <select
                            aria-label="Próxima ação"
                            className="app-input app-select"
                            value={nextResponders[dispute.id] ?? 'cliente'}
                            onChange={(event) => setNextResponders((current) => ({ ...current, [dispute.id]: event.target.value as 'cliente' | 'ninguem' }))}
                          >
                            <option value="cliente">Aguardar Cliente</option>
                            <option value="ninguem">Encerrar pendência (Ninguém)</option>
                          </select>
                        </label>
                      </div>
                    ) : null}
                    {errors[dispute.id] ? <InlineError message={errors[dispute.id]} /> : null}
                    {failedUploads[dispute.id] ? (
                      <Button variant="secondary" className="app-btn--sm" loading={pendingId === dispute.id} loadingLabel="Enviando anexo…" onClick={() => void retryUpload(dispute)}>
                        <Paperclip size={14} aria-hidden="true" />
                        Reenviar o anexo {failedUploads[dispute.id]!.file.name}
                      </Button>
                    ) : null}
                    {sentId === dispute.id && !errors[dispute.id] ? <p className="app-dem-state app-dem-state--success" role="status">{dispute.state === 'aberta' ? 'Resposta registrada.' : 'Disputa atualizada.'}</p> : null}
                    <div className="app-dem-form__actions">
                      <Button loading={pendingId === dispute.id} loadingLabel="Enviando…" disabled={pendingId != null && pendingId !== dispute.id} onClick={() => void submit(dispute)}>
                        <Send size={14} aria-hidden="true" />
                        {dispute.state === 'resolvida' ? 'Reabrir Disputa' : 'Enviar resposta'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
