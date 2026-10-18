import { useRef, useState } from 'react'
import { ArrowLeft, Paperclip, Send, X } from 'lucide-react'
import { usePortalAddDisputeMessage, usePortalRequestDisputeReopen } from '../../hooks/usePortalDisputes'
import { portalCheckDisputeAttachmentEligibility, portalUploadDisputeAttachment } from '../../services/portalBilling'
import { usePortalScope } from '../../hooks/usePortalScope'
import type { PortalDemurrageInvoice, PortalDispute, PortalDisputeMessage } from '../../services/portalBilling'
import { formatDate } from '../../lib/utils'
import { portalErrorMessage } from '../../lib/portalErrorMessage'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { InlineError, PageHeader } from '../ui/Card'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { Textarea } from '../ui/Input'
import { isPortalReadOnly } from '../../services/portalScope'
import { useConfirm } from '../ui/ConfirmDialog'

const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain']
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

// Equipamentos é a equipe de Containers para o Cliente (Central de Informações).
const AUTHOR_LABELS: Record<PortalDisputeMessage['author_type'], string> = {
  cliente: 'Você',
  equipamentos: 'Equipe de Containers',
  administrativo: 'Administrativo',
  sistema: 'Sistema',
}

function authorLabel(message: PortalDisputeMessage) {
  return AUTHOR_LABELS[message.author_type] ?? 'Sistema'
}

/**
 * Situação da disputa numa frase, para a faixa do bloco: "aberta em
 * 05/10/2026 · aguarda a equipe de Containers". Âmbar só quando a resposta é
 * do Cliente (regra 5).
 */
export function DisputeSummary({ dispute }: { dispute: PortalDispute }) {
  const opened = `aberta em ${formatDate(dispute.created_at)}`
  if (dispute.state === 'resolvida') return <span>{opened} · resolvida</span>
  if (dispute.state === 'cancelada') return <span>{opened} · cancelada</span>
  if (dispute.next_responder === 'cliente') return <span>{opened} · <StatusText tone="warning">aguarda a sua resposta</StatusText></span>
  if (dispute.next_responder === 'equipamentos') return <span>{opened} · aguarda a equipe de Containers</span>
  return <span>{opened} · sem resposta pendente</span>
}

/** Coluna Aguarda da lista de disputas em aberto. */
function DisputeWaiting({ dispute }: { dispute: PortalDispute }) {
  if (dispute.next_responder === 'cliente') return <StatusText tone="warning">Você</StatusText>
  if (dispute.next_responder === 'equipamentos') return <>Equipe de Containers</>
  return <>Ninguém</>
}

/** Situação da disputa encerrada, em texto: cancelada em cinza. */
function DisputeClosedState({ dispute }: { dispute: PortalDispute }) {
  return dispute.state === 'cancelada' ? <StatusText tone="muted">Cancelada</StatusText> : <StatusText>Resolvida</StatusText>
}

/** Última mensagem numa linha: autor, data e o texto (a célula corta com "…"). */
function lastMessageText(dispute: PortalDispute) {
  const last = dispute.messages[dispute.messages.length - 1]
  if (!last) return null
  return `${authorLabel(last)}, ${formatDate(last.created_at)}: “${last.body.replace(/\s+/g, ' ').trim()}”`
}

type ScreenProps = {
  disputes: PortalDispute[]
  loading: boolean
  error: boolean
  /** Lista de Demurrage do Cliente, para o B/L de cada disputa. */
  invoices: PortalDemurrageInvoice[]
  /** Disputa aberta na conversa (`?disputa=` da URL). */
  selectedDisputeId: number | null
  onOpenDispute: (disputeId: number) => void
  onBackToList: () => void
  onBackToInvoices: () => void
  onOpenInvoice: (invoiceId: number) => void
}

/**
 * Tela Disputas de Demurrage, dentro de Faturas (lote 4 da identidade,
 * 2026-10-18): as disputas em aberto e, fechado, o histórico das encerradas.
 * O número da fatura abre a conversa daquela disputa, com a volta à lista e
 * o botão que abre a Invoice.
 */
export function PortalDisputesScreen({ disputes, loading, error, invoices, selectedDisputeId, onOpenDispute, onBackToList, onBackToInvoices, onOpenInvoice }: ScreenProps) {
  const selected = selectedDisputeId == null ? undefined : disputes.find((dispute) => dispute.id === selectedDisputeId)
  if (selected) {
    return (
      <>
        <PageHeader
          title={`Disputa da ${selected.doc_number}`}
          action={(
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onOpenInvoice(selected.demurrage_invoice_id)}>Abrir {selected.doc_number}</Button>
              <Button variant="secondary" onClick={onBackToList}><ArrowLeft size={16} aria-hidden="true" />Voltar às disputas</Button>
            </div>
          )}
        />
        <PortalDisputeConversation key={selected.id} dispute={selected} />
      </>
    )
  }
  return (
    <DisputesList
      disputes={disputes}
      loading={loading}
      error={error}
      invoices={invoices}
      onOpenDispute={onOpenDispute}
      onBackToInvoices={onBackToInvoices}
    />
  )
}

function DisputesList({ disputes, loading, error, invoices, onOpenDispute, onBackToInvoices }: Pick<ScreenProps, 'disputes' | 'loading' | 'error' | 'invoices' | 'onOpenDispute' | 'onBackToInvoices'>) {
  const open = disputes
    .filter((dispute) => dispute.state === 'aberta')
    // A que espera a resposta do Cliente vem primeiro; depois, a mais recente.
    .sort((left, right) => Number(right.next_responder === 'cliente') - Number(left.next_responder === 'cliente') || right.updated_at.localeCompare(left.updated_at))
  const closed = disputes
    .filter((dispute) => dispute.state !== 'aberta')
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  // Sem disputa em aberto, o histórico das encerradas já vem aberto.
  const [closedShown, setClosedShown] = useState<boolean | null>(null)
  const showClosed = closedShown ?? (!loading && open.length === 0)
  const blOf = new Map(invoices.map((invoice) => [invoice.id, invoice.bl_id]))

  return (
    <>
      <PageHeader
        title="Disputas de Demurrage"
        action={<Button variant="secondary" onClick={onBackToInvoices}><ArrowLeft size={16} aria-hidden="true" />Voltar às faturas</Button>}
      />
      <div className="grid gap-4">
        {error ? <InlineError message="Não foi possível consultar as disputas. Tente de novo em instantes." /> : null}
        <Block title="Em aberto" aside={loading ? null : open.length} flush>
          <DisputesTable
            disputes={open}
            kind="open"
            loading={loading}
            blOf={blOf}
            onOpenDispute={onOpenDispute}
            empty="Nenhuma disputa em aberto."
          />
        </Block>
        <Block
          title="Encerradas"
          aside={loading ? null : (
            <>
              <span>{closed.length}</span>
              <Button variant="secondary" className="app-btn--sm" aria-expanded={showClosed} onClick={() => setClosedShown(!showClosed)}>
                {showClosed ? 'Ocultar' : 'Mostrar'}
              </Button>
            </>
          )}
          flush
        >
          {showClosed ? (
            <DisputesTable
              disputes={closed}
              kind="closed"
              loading={false}
              blOf={blOf}
              onOpenDispute={onOpenDispute}
              empty="Nenhuma disputa encerrada."
            />
          ) : null}
        </Block>
      </div>
    </>
  )
}

function DisputesTable({ disputes, kind, loading, blOf, onOpenDispute, empty }: {
  disputes: PortalDispute[]
  kind: 'open' | 'closed'
  loading: boolean
  blOf: Map<number, string>
  onOpenDispute: (disputeId: number) => void
  empty: string
}) {
  const bl = (dispute: PortalDispute) => {
    const value = blOf.get(dispute.demurrage_invoice_id)
    return value ? <CopyValue value={value} label="número do B/L" /> : <NoValue label="Sem B/L" />
  }
  const last = (dispute: PortalDispute) => lastMessageText(dispute) ?? <NoValue label="Sem mensagens" />
  const state = (dispute: PortalDispute) => (kind === 'open' ? <DisputeWaiting dispute={dispute} /> : <DisputeClosedState dispute={dispute} />)

  return (
    <>
      <div className="hidden app-table-scroll lg:block">
        <table className="app-table app-table--compact text-sm">
          <caption className="sr-only">{kind === 'open' ? 'Disputas de Demurrage em aberto' : 'Disputas de Demurrage encerradas'}</caption>
          <thead>
            <tr>
              <th scope="col">Fatura</th>
              <th scope="col">B/L</th>
              <th scope="col">Aberta em</th>
              <th scope="col" className="app-table__text-head">Última mensagem</th>
              <th scope="col">{kind === 'open' ? 'Aguarda' : 'Situação'}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={5}>Carregando…</td></tr> : null}
            {!loading && disputes.length === 0 ? <tr><td className="px-4 py-6 text-center text-[var(--app-muted)]" colSpan={5}>{empty}</td></tr> : null}
            {disputes.map((dispute) => (
              <tr key={dispute.id}>
                <td className="whitespace-nowrap"><DisputeNumber dispute={dispute} onOpen={onOpenDispute} /></td>
                <td className="whitespace-nowrap">{bl(dispute)}</td>
                <td className="whitespace-nowrap tabular-nums">{formatDate(dispute.created_at)}</td>
                <td className="app-table__text" title={lastMessageText(dispute) ?? undefined}>{last(dispute)}</td>
                <td className="whitespace-nowrap">{state(dispute)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-4 lg:hidden">
        {loading ? <p className="text-sm text-[var(--app-muted)]">Carregando…</p> : null}
        {!loading && disputes.length === 0 ? <p className="text-sm text-[var(--app-muted)]">{empty}</p> : null}
        {disputes.map((dispute) => (
          <article key={dispute.id} className="app-invoice-card" aria-label={`Disputa da ${dispute.doc_number}`}>
            <div className="app-invoice-card__head">
              <span><DisputeNumber dispute={dispute} onOpen={onOpenDispute} /></span>
              {state(dispute)}
            </div>
            <div className="text-sm text-[var(--app-muted)]">B/L {bl(dispute)}</div>
            <div className="text-sm text-[var(--app-muted)]">Aberta em {formatDate(dispute.created_at)}</div>
            <div className="text-sm">{last(dispute)}</div>
          </article>
        ))}
      </div>
    </>
  )
}

function DisputeNumber({ dispute, onOpen }: { dispute: PortalDispute; onOpen: (disputeId: number) => void }) {
  return (
    <button type="button" className="app-invoices__number" aria-label={`Abrir a disputa da ${dispute.doc_number}`} onClick={() => onOpen(dispute.id)}>
      {dispute.doc_number}
    </button>
  )
}

/**
 * Conversa de uma disputa: mensagens imutáveis, a resposta do Cliente com
 * anexo opcional e, na resolvida, o pedido de reabertura. O campo de arquivo
 * do navegador fica escondido atrás do botão "Anexar arquivo".
 */
export function PortalDisputeConversation({ dispute }: { dispute: PortalDispute }) {
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)
  const addMessage = usePortalAddDisputeMessage()
  const requestReopen = usePortalRequestDisputeReopen()
  const confirm = useConfirm()
  const fileInput = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // Mensagem gravada cujo anexo falhou: o arquivo fica para reenviar só ele.
  const [pendingMessageId, setPendingMessageId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)

  function clearFile() {
    setFile(null)
    setPendingMessageId(null)
    // O campo escondido guarda o arquivo: limpa para a mesma escolha disparar de novo.
    if (fileInput.current) fileInput.current.value = ''
  }

  async function submit() {
    const body = draft.trim()

    // V-A2: anexo retido de uma mensagem já gravada, sem texto novo: reenvia só o anexo.
    if (pendingMessageId && file && !body) {
      setError('')
      const confirmed = await confirm({
        title: 'Confirmar envio do anexo',
        message: `Enviar o anexo ${file.name} para a disputa ${dispute.doc_number}?`,
        confirmLabel: 'Enviar anexo',
        affected: { summary: '1 anexo', items: [`${file.name} (${Math.ceil(file.size / 1024)} KB)`] },
        consequence: 'O arquivo será anexado à mensagem já registrada e ficará disponível na conversa da disputa.',
        reversibility: 'Depois de enviado, o anexo não pode ser removido pelo Portal.',
      })
      if (!confirmed) return
      setUploading(true)
      try {
        await portalUploadDisputeAttachment(pendingMessageId, dispute.id, file, scope)
        clearFile()
      } catch (uploadError) {
        setError(`Não foi possível enviar o anexo: ${portalErrorMessage(uploadError, 'Falha ao enviar anexo.')}`)
      } finally {
        setUploading(false)
      }
      return
    }

    if (!body) {
      setError('Escreva uma mensagem antes de enviar.')
      return
    }
    setError('')

    if (file) {
      if (file.size > ATTACHMENT_MAX_BYTES) {
        setError('O anexo excede o limite de 10 MB.')
        return
      }
      if (!ATTACHMENT_TYPES.includes(file.type)) {
        setError('Tipo de anexo não permitido. Use PDF, JPG, PNG ou TXT.')
        return
      }

      // V-A2: pré-validação de cota e taxa no servidor ANTES de gravar a mensagem.
      setUploading(true)
      try {
        await portalCheckDisputeAttachmentEligibility(dispute.id, file.size, scope)
      } catch (checkError) {
        setError(portalErrorMessage(checkError, 'Não é possível anexar o arquivo (cota ou limite excedido).'))
        return
      } finally {
        setUploading(false)
      }
    }

    const isReopenRequest = dispute.state === 'resolvida'
    const confirmed = await confirm({
      title: isReopenRequest ? 'Confirmar pedido de reabertura' : 'Confirmar envio da mensagem',
      message: isReopenRequest
        ? `Enviar à equipe um pedido para reabrir a disputa ${dispute.doc_number}?`
        : `Enviar mensagem à equipe na disputa ${dispute.doc_number}?`,
      confirmLabel: isReopenRequest ? 'Solicitar reabertura' : 'Enviar mensagem',
      affected: {
        summary: isReopenRequest ? 'Pedido de reabertura' : 'Mensagem da disputa',
        items: [
          `Disputa: ${dispute.doc_number}`,
          `Mensagem: ${body}`,
          ...(file ? [`Anexo: ${file.name} (${Math.ceil(file.size / 1024)} KB)`] : []),
        ],
      },
      consequence: isReopenRequest
        ? 'A equipe receberá o pedido para análise. A disputa continua resolvida até a equipe decidir reabri-la.'
        : 'A mensagem ficará visível para a equipe na conversa da disputa e poderá gerar uma notificação.',
      reversibility: 'Mensagens e anexos enviados ficam no histórico e não podem ser editados ou removidos pelo Portal.',
    })
    if (!confirmed) return

    try {
      if (isReopenRequest) {
        await requestReopen.mutateAsync({ disputeId: dispute.id, body })
        setDraft('')
        clearFile()
        return
      }
      const result = await addMessage.mutateAsync({ demurrageInvoiceId: dispute.demurrage_invoice_id, body })
      // Limpa o texto logo depois de gravar a mensagem, para não duplicar.
      setDraft('')
      if (file && result?.message_id) {
        try {
          await portalUploadDisputeAttachment(result.message_id, dispute.id, file, scope)
          clearFile()
        } catch (uploadError) {
          setPendingMessageId(result.message_id)
          setError(`Sua mensagem foi registrada, mas o anexo não pôde ser enviado: ${portalErrorMessage(uploadError, 'Falha ao enviar anexo.')}`)
        }
      }
    } catch (sendError) {
      setError(portalErrorMessage(sendError, 'Falha ao enviar a mensagem.'))
    }
  }

  const sendLabel = pendingMessageId && file && !draft.trim()
    ? 'Reenviar anexo'
    : dispute.state === 'resolvida' ? 'Solicitar reabertura' : 'Enviar mensagem'

  return (
    <Block title="Conversa" aside={<DisputeSummary dispute={dispute} />}>
      {dispute.messages.length ? (
        <ol className="grid gap-2" aria-label={`Mensagens da disputa da ${dispute.doc_number}`}>
          {dispute.messages.map((message) => {
            const mine = message.author_type === 'cliente'
            return (
              <li
                key={message.id}
                className={`grid max-w-[46rem] gap-1 rounded-lg px-3 py-2 text-sm ${mine ? 'justify-self-end bg-[var(--app-strip)]' : 'justify-self-start bg-[var(--app-surface-muted)]'}`}
              >
                <span className="text-xs text-[var(--app-muted)]">{authorLabel(message)} · {formatDate(message.created_at)}</span>
                <p className="whitespace-pre-wrap">{message.body}</p>
                {message.attachments?.length ? (
                  <span className="flex items-center gap-1 text-xs text-[var(--app-muted)]">
                    <Paperclip size={12} aria-hidden="true" />
                    {message.attachments.map((attachment) => attachment.file_name).join(', ')}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : <p className="text-sm text-[var(--app-muted)]">Sem mensagens.</p>}

      {dispute.state !== 'cancelada' ? (
        <div className="grid gap-2">
          <Textarea
            rows={3}
            aria-label={dispute.state === 'resolvida' ? 'Motivo da reabertura' : 'Sua resposta'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={dispute.state === 'resolvida' ? 'Explique por que a disputa deve ser reaberta…' : 'Responda à conversa…'}
            disabled={readOnly}
          />
          {error ? <InlineError message={error} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            {dispute.state === 'aberta' ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept={ATTACHMENT_TYPES.join(',')}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null)
                    setPendingMessageId(null)
                  }}
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
              </>
            ) : null}
            <Button
              className="ml-auto"
              loading={addMessage.isPending || requestReopen.isPending || uploading}
              disabled={readOnly}
              onClick={() => void submit()}
              title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}
            >
              <Send size={14} aria-hidden="true" />
              {sendLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </Block>
  )
}
