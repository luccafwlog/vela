import { Fragment, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ChevronDown, ChevronRight, CircleSlash, Link2, RotateCw } from 'lucide-react'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { RowActionButton } from '../ui/RowActionButton'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { Field, Textarea } from '../ui/Input'
import { TxidCell } from './PixTxidCell'
import { afterPendenciaPixAlterada, afterPixConciliado } from '../../services/cacheEffects'
import { useItauPixMonitor, usePixExceptions } from '../../hooks/usePixReconciliation'
import { useAuth } from '../../hooks/useAuth'
import { extractErrorText } from '../../lib/errors'
import { formatBRL, formatCnpjCpf } from '../../lib/utils'
import {
  confirmUnifiedPixReconciliation,
  linkPixReconciliationCandidate,
  listPixReconciliationCandidates,
  markItauPixReceiptHandled,
  matchUnifiedPixTransactions,
  resolvePixReconciliationException,
  type ItauPixMonitor,
  type PixExceptionResolution,
  type PixReconciliationCandidate,
  type PixReconciliationException,
  type UnifiedPixMatch,
} from '../../services/reconciliacao'
import {
  describeItauPoll,
  formatBrasiliaInstant,
  formatExtractDay,
  itauChargeState,
  pendingExceptionDoc,
  pendingExceptionReason,
  extractLineReason,
  sortItauCharges,
} from './pixReconciliationPresentation'

const HANDLED_NOTE_MIN = 5 // itau_pix_mark_receipt_handled (migration 154)

type OpenInvoice = (source: 'local' | 'demurrage', invoiceId: number) => void

const sourceLabel = (source: 'local' | 'demurrage') => (source === 'demurrage' ? 'Demurrage' : 'Taxas Locais')

/** Data e hora de Brasília na célula da tabela, sem o "às" da frase. */
const cellInstant = (value: string | null | undefined) => formatBrasiliaInstant(value).replace(' às', '')

/** Seta que abre e recolhe a linha de detalhe; também usada na aba Pix recebidos. */
export function RowToggle({ open, controls, label, onClick, disabled }: { open: boolean; controls: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="app-table__icon-button app-table__icon-button--sm"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? 'Recolher' : 'Abrir'} ${label}`}
      disabled={disabled}
      onClick={onClick}
    >
      {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
    </button>
  )
}

/**
 * Pendências da Conciliação PIX: Pix de cobrança do Vela que entrou no Itaú e
 * não deu baixa, linhas de extrato sem baixa segura e cobranças que ainda
 * esperam o banco. Os demais Pix recebidos ficam na aba Pix recebidos, sem
 * pedir ação (ADR 0100).
 * Cada assunto é um bloco com tabela limpa (lote 3 da identidade); a situação
 * vai em texto, âmbar só no que pede ação. Nada aqui baixa por semelhança.
 */
export function PixPendingPanel({ onOpenExtract, onOpenInvoice }: { onOpenExtract: () => void; onOpenInvoice: OpenInvoice }) {
  const monitorQuery = useItauPixMonitor()
  const exceptionsQuery = usePixExceptions()
  const monitor = monitorQuery.data

  return (
    <div className="grid min-w-0 gap-4 pt-1">
      <ItauBlock query={monitorQuery} onOpenExtract={onOpenExtract} />
      {monitor?.provider === 'itau' || monitor?.receipts.length ? <ReceiptsBlock monitor={monitor} /> : null}
      <ExceptionsBlock query={exceptionsQuery} onOpenExtract={onOpenExtract} />
      {monitor?.provider === 'itau' || monitor?.charges.length ? <ChargesBlock monitor={monitor} onOpenInvoice={onOpenInvoice} /> : null}
    </div>
  )
}

function ItauBlock({ query, onOpenExtract }: { query: ReturnType<typeof useItauPixMonitor>; onOpenExtract: () => void }) {
  const monitor = query.data
  return (
    <Block
      title="Cobrança Pix Itaú"
      aside={<Button variant="secondary" className="app-btn--sm" onClick={onOpenExtract}>Conciliar extrato</Button>}
    >
      <ItauStatus query={query} monitor={monitor} />
    </Block>
  )
}

function ItauStatus({ query, monitor }: { query: ReturnType<typeof useItauPixMonitor>; monitor: ItauPixMonitor | undefined }) {
  if (query.isLoading) return <p role="status">Consultando a cobrança Pix Itaú…</p>
  if (query.error || !monitor) {
    return (
      <div role="alert" className="grid justify-items-start gap-2">
        <p>Não foi possível consultar a cobrança Pix Itaú: {extractErrorText(query.error)}. Os Pix em análise e a fila do banco não estão nesta tela agora.</p>
        <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
      </div>
    )
  }
  if (monitor.provider !== 'itau') {
    return <LeadValue>Desligada: as faturas usam o QR estático e a baixa vem do extrato</LeadValue>
  }
  const poll = describeItauPoll(monitor.polledUntil, new Date())
  return (
    <div className="grid gap-4">
      {poll.stale ? (
        <div role="status">
          <LeadValue
            tone="warning"
            detail={`${monitor.polledUntil
              ? `Pix pagos depois de ${formatBrasiliaInstant(monitor.polledUntil)} não deram baixa automática.`
              : 'Nenhum recebimento foi consultado ainda; Pix pagos não deram baixa automática.'} Avise quem cuida da integração antes de baixar à mão.`}
          >
            {monitor.polledUntil ? `Consulta parada ${poll.text}` : 'Consulta de recebimentos ainda não feita'}
          </LeadValue>
        </div>
      ) : (
        <LeadValue detail={`Recebimentos consultados ${poll.text}.`}>Baixa automática ligada</LeadValue>
      )}
      <FactList columns={3}>
        <Fact label="Baixa automática">Ligada</Fact>
        <Fact label="Recebimentos consultados até">{monitor.polledUntil ? formatBrasiliaInstant(monitor.polledUntil) : 'Ainda não consultados'}</Fact>
        <Fact label="Cobranças ativas"><span className="tabular-nums">{(monitor.counts.active ?? 0).toLocaleString('pt-BR')}</span></Fact>
      </FactList>
    </div>
  )
}

function ReceiptsBlock({ monitor }: { monitor: ItauPixMonitor | undefined }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<{ endToEndId: string; note: string; error: string | null } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const receipts = monitor?.receipts ?? []
  // Ler é de todos; tratar é do Financeiro e do Administrativo (ADR 0085, D5; migration 247).
  const { can } = useAuth()
  const canReconcile = can('settle_financial_adjustments')

  const formFor = form?.endToEndId ?? null
  const returnFocus = useRef<string | null>(null)
  // Abrir o formulário leva o foco ao motivo; Voltar devolve ao botão da linha,
  // que só volta a existir depois que o formulário sai.
  useEffect(() => {
    if (formFor) {
      noteRef.current?.focus()
    } else if (returnFocus.current) {
      triggerRefs.current.get(returnFocus.current)?.focus()
      returnFocus.current = null
    }
  }, [formFor])

  const handleMutation = useMutation({
    mutationFn: ({ endToEndId, note }: { endToEndId: string; note: string; amount: number }) => markItauPixReceiptHandled(endToEndId, note),
    onSuccess: async (_data, { amount }) => {
      setForm(null)
      setDone(`Pix de ${formatBRL(amount)} marcado como tratado; o Alerta do recebimento foi encerrado.`)
      await afterPendenciaPixAlterada(queryClient)
    },
    onError: (error: Error) => setForm((current) => (current ? { ...current, error: extractErrorText(error) } : current)),
  })

  function closeForm(endToEndId: string) {
    returnFocus.current = endToEndId
    setForm(null)
  }

  return (
    <Block title="Pix em análise" flush aside={`${receipts.length.toLocaleString('pt-BR')} · Pix de cobrança do Vela que não deu baixa automática`}>
      {done ? <p className="app-block__body" role="status">{done}</p> : null}
      {receipts.length ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Pix de cobrança do Vela em análise</caption>
            <thead>
              <tr>
                <th scope="col">Recebido em</th>
                <th scope="col">Valor</th>
                <th scope="col">Identificador do Pix</th>
                <th scope="col" className="app-table__text-head">Motivo</th>
                <th scope="col"><span className="sr-only">Ação</span></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => {
                const open = form?.endToEndId === receipt.endToEndId
                const noteLength = form?.note.trim().length ?? 0
                return (
                  <Fragment key={receipt.endToEndId}>
                    <tr>
                      <td className="whitespace-nowrap tabular-nums">{cellInstant(receipt.paidAt)}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatBRL(receipt.amount)}</td>
                      <td className="whitespace-nowrap"><TxidCell txid={receipt.txid} /></td>
                      <td className="app-table__text app-table__text--wrap">{receipt.reason?.trim() || <NoValue label="Sem motivo informado" />}</td>
                      <td className="whitespace-nowrap text-right">
                        {canReconcile && !open ? (
                          <RowActionButton
                            ref={(node) => { if (node) triggerRefs.current.set(receipt.endToEndId, node); else triggerRefs.current.delete(receipt.endToEndId) }}
                            label={`Marcar como tratado o Pix de ${formatBRL(receipt.amount)} recebido em ${cellInstant(receipt.paidAt)}`}
                            title="Marcar como tratado"
                            icon={CheckCheck}
                            onClick={() => { setDone(null); setForm({ endToEndId: receipt.endToEndId, note: '', error: null }) }}
                          />
                        ) : null}
                      </td>
                    </tr>
                    {open && form ? (
                      <tr data-row-detail>
                        <td colSpan={5}>
                          <div className="grid max-w-xl gap-3">
                            <Field
                              label="Motivo do tratamento"
                              required
                              hint={`Mínimo de ${HANDLED_NOTE_MIN} caracteres. Fica registrado no recebimento e encerra o Alerta; não baixa nem devolve nada.`}
                              error={form.error ?? undefined}
                            >
                              <Textarea
                                ref={noteRef}
                                value={form.note}
                                placeholder="Ex.: restituição registrada ao Cliente"
                                onChange={(event) => setForm({ ...form, note: event.target.value, error: null })}
                              />
                            </Field>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button variant="ghost" disabled={handleMutation.isPending} onClick={() => closeForm(receipt.endToEndId)}>Voltar</Button>
                              <Button
                                loading={handleMutation.isPending}
                                loadingLabel="Marcando…"
                                disabled={noteLength < HANDLED_NOTE_MIN}
                                onClick={() => handleMutation.mutate({ endToEndId: receipt.endToEndId, note: form.note.trim(), amount: receipt.amount })}
                              >
                                Marcar como tratado
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="app-block__body">Nenhum Pix em análise.</p>
      )}
    </Block>
  )
}

class SettleError extends Error {
  readonly stage: 'link' | 'confirm' | 'resolve'
  /** Só no passo `resolve`: a baixa já existe e falta encerrar a exceção com esta resolução. */
  readonly pending: { resolution: PixExceptionResolution; docNumber: string } | null
  constructor(stage: 'link' | 'confirm' | 'resolve', cause: unknown, pending: SettleError['pending'] = null) {
    super(extractErrorText(cause))
    this.stage = stage
    this.pending = pending
  }
}

function transactionOf(exception: PixReconciliationException) {
  return { txid: exception.txid, cnpj: exception.cnpj, date: exception.paidAt ?? '', amount: exception.amount, lineNumber: exception.lineNumber }
}

/**
 * Baixa de uma exceção em três passos (vincular, baixar, encerrar), cada um com
 * a sua RPC. A falha diz até onde chegou: antes da baixa nada foi gravado;
 * depois dela, a baixa existe e só a exceção ficou aberta.
 */
async function settleException(exception: PixReconciliationException, match: UnifiedPixMatch & { source: 'local' | 'demurrage' }, link: PixReconciliationCandidate | null) {
  if (link) {
    try { await linkPixReconciliationCandidate(exception.id, link) } catch (error) { throw new SettleError('link', error) }
  }
  try { await confirmUnifiedPixReconciliation([match]) } catch (error) { throw new SettleError('confirm', error) }
  const resolution: PixExceptionResolution = {
    source: match.source,
    invoiceId: match.source === 'local' ? match.invoiceId : undefined,
    demurrageInvoiceId: match.source === 'demurrage' ? match.invoiceId : undefined,
    txid: match.transaction.txid,
  }
  try {
    await resolvePixReconciliationException(exception.id, resolution)
  } catch (error) {
    throw new SettleError('resolve', error, { resolution, docNumber: match.docNumber })
  }
  return match.docNumber
}

function settleErrorText(error: unknown, docNumber: string | null) {
  if (error instanceof SettleError && error.stage === 'resolve') {
    return `A baixa${docNumber ? ` em ${docNumber}` : ''} foi gravada, mas a exceção não foi encerrada: ${error.message} Não repita a baixa; use Encerrar exceção.`
  }
  if (error instanceof SettleError && error.stage === 'link') return `Não foi possível vincular a fatura: ${error.message} Nenhuma baixa foi gravada.`
  return `${extractErrorText(error)} Nenhuma baixa foi gravada; a exceção continua pendente.`
}

type ExceptionFeedback = { id: number; tone: 'danger' | 'success'; text: string }

function ExceptionsBlock({ query, onOpenExtract }: { query: ReturnType<typeof usePixExceptions>; onOpenExtract: () => void }) {
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const canReconcile = can('settle_financial_adjustments')
  const [openId, setOpenId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<ExceptionFeedback | null>(null)
  // Exceções com baixa gravada e encerramento recusado. A fatura já não está
  // aberta, então Tentar de novo e a lista de faturas não a acham mais; só falta
  // `resolve_pix_reconciliation_exception`, que aceita a fatura já baixada.
  // ponytail: guardado só nesta tela; depois de recarregar a página a exceção
  // volta a mostrar só Tentar de novo. Se isso ocorrer na prática, gravar a
  // fatura na exceção antes da baixa (vínculo) e encerrar a partir dela.
  const [unclosed, setUnclosed] = useState<ReadonlyMap<number, { resolution: PixExceptionResolution; docNumber: string }>>(() => new Map())
  const exceptions = query.data ?? []

  function rememberUnclosed(exceptionId: number, error: unknown) {
    if (!(error instanceof SettleError) || !error.pending) return
    const pending = error.pending
    setUnclosed((current) => new Map(current).set(exceptionId, pending))
  }

  const candidatesQuery = useQuery({
    queryKey: ['pix-reconciliation-candidates', openId],
    queryFn: () => listPixReconciliationCandidates(openId!),
    enabled: openId != null,
  })

  const retryMutation = useMutation({
    mutationFn: async (exception: PixReconciliationException) => {
      const [match] = await matchUnifiedPixTransactions([transactionOf(exception)])
      if (!match || match.ambiguous || match.source === 'unmatched') {
        throw new Error(`Ainda não há uma fatura segura para esta linha: ${match ? extractLineReason(match) : 'Nenhuma fatura aberta com este identificador'}.`)
      }
      return settleException(exception, match as UnifiedPixMatch & { source: 'local' | 'demurrage' }, null)
    },
    onMutate: () => setFeedback(null),
    onSuccess: async (docNumber, exception) => {
      setFeedback({ id: exception.id, tone: 'success', text: `${docNumber}: baixa confirmada pelo banco (Pix de ${formatBRL(exception.amount)}, linha ${exception.lineNumber}).` })
      await afterPixConciliado(queryClient)
    },
    onError: async (error, exception) => {
      setFeedback({ id: exception.id, tone: 'danger', text: error instanceof SettleError ? settleErrorText(error, error.pending?.docNumber ?? null) : extractErrorText(error) })
      rememberUnclosed(exception.id, error)
      if (error instanceof SettleError && error.stage === 'resolve') await afterPixConciliado(queryClient)
    },
  })

  const linkMutation = useMutation({
    mutationFn: ({ exception, candidate }: { exception: PixReconciliationException; candidate: PixReconciliationCandidate }) => {
      const match: UnifiedPixMatch & { source: 'local' | 'demurrage' } = {
        transaction: transactionOf(exception),
        source: candidate.source,
        invoiceId: candidate.invoiceId,
        docNumber: candidate.docNumber,
        customerName: '',
        customerCnpj: exception.cnpj,
        amount: candidate.amount,
        ambiguous: false,
        matchType: 'txid',
        exceptionId: exception.id,
      }
      return settleException(exception, match, candidate)
    },
    onMutate: () => setFeedback(null),
    onSuccess: async (docNumber, { exception }) => {
      setOpenId(null)
      setFeedback({ id: exception.id, tone: 'success', text: `${docNumber}: baixa confirmada pelo banco (Pix de ${formatBRL(exception.amount)}, linha ${exception.lineNumber}).` })
      await afterPixConciliado(queryClient)
    },
    onError: async (error, { exception, candidate }) => {
      setFeedback({ id: exception.id, tone: 'danger', text: settleErrorText(error, candidate.docNumber) })
      rememberUnclosed(exception.id, error)
      if (error instanceof SettleError && error.stage === 'resolve') {
        setOpenId(null)
        await afterPixConciliado(queryClient)
      }
    },
  })

  const closeMutation = useMutation({
    mutationFn: ({ exception, resolution }: { exception: PixReconciliationException; resolution: PixExceptionResolution; docNumber: string }) =>
      resolvePixReconciliationException(exception.id, resolution),
    onMutate: () => setFeedback(null),
    onSuccess: async (_data, { exception, docNumber }) => {
      setUnclosed((current) => { const next = new Map(current); next.delete(exception.id); return next })
      setFeedback({ id: exception.id, tone: 'success', text: `${docNumber}: exceção encerrada; a baixa já estava gravada.` })
      await afterPixConciliado(queryClient)
    },
    onError: (error, { exception, docNumber }) =>
      setFeedback({ id: exception.id, tone: 'danger', text: `A baixa em ${docNumber} continua gravada e a exceção segue aberta: ${extractErrorText(error)}` }),
  })

  const busyId = retryMutation.isPending
    ? retryMutation.variables?.id
    : linkMutation.isPending
      ? linkMutation.variables?.exception.id
      : closeMutation.isPending ? closeMutation.variables?.exception.id : null
  const successElsewhere = feedback?.tone === 'success' && !exceptions.some((exception) => exception.id === feedback.id)

  return (
    <Block
      title="Exceções do extrato"
      flush
      aside={`${query.data ? exceptions.length.toLocaleString('pt-BR') : '…'} · linhas sem fatura segura para baixar`}
    >
      {successElsewhere && feedback ? <p className="app-block__body" role="status">{feedback.text}</p> : null}
      {query.isLoading ? <p className="app-block__body" role="status">Carregando as exceções…</p> : null}
      {query.error ? (
        <div className="app-block__body grid justify-items-start gap-2" role="alert">
          <p>Não foi possível carregar as exceções do extrato: {extractErrorText(query.error)}</p>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {query.data && !exceptions.length ? (
        <div className="app-block__body flex flex-wrap items-center gap-3">
          <p>Nenhuma exceção pendente.</p>
          <Button variant="secondary" className="app-btn--sm" onClick={onOpenExtract}>Conciliar extrato</Button>
        </div>
      ) : null}
      {exceptions.length ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Exceções do extrato pendentes</caption>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Faturas candidatas</span></th>
                <th scope="col">Pago em</th>
                <th scope="col">Valor</th>
                <th scope="col">Identificador do Pix</th>
                <th scope="col">CNPJ</th>
                <th scope="col" className="app-table__text-head">Motivo</th>
                <th scope="col"><span className="sr-only">Ação</span></th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((exception) => {
                const ambiguous = exception.reason !== 'unmatched' && Boolean(exception.txid.trim())
                const indicated = pendingExceptionDoc(exception)
                const reason = `${pendingExceptionReason(exception)}${indicated ? ` · Fatura indicada: ${indicated}` : ''}`
                const pendingClose = unclosed.get(exception.id)
                const open = openId === exception.id && !pendingClose
                const rowFeedback = feedback?.id === exception.id ? feedback : null
                const busy = busyId === exception.id
                const detailId = `pix-candidates-${exception.id}`
                return (
                  <Fragment key={exception.id}>
                    <tr>
                      <td className="w-px">
                        {pendingClose ? null : (
                          <RowToggle
                            open={open}
                            controls={detailId}
                            label={`faturas candidatas da linha ${exception.lineNumber}`}
                            disabled={busy}
                            onClick={() => setOpenId((current) => (current === exception.id ? null : exception.id))}
                          />
                        )}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{formatExtractDay(exception.paidAt)}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatBRL(exception.amount)}</td>
                      <td className="whitespace-nowrap"><TxidCell txid={exception.txid} /></td>
                      <td className="whitespace-nowrap tabular-nums">{exception.cnpj ? <CopyValue value={formatCnpjCpf(exception.cnpj)} label="CNPJ" /> : <NoValue label="Sem CNPJ" />}</td>
                      <td className="app-table__text app-table__text--wrap">{ambiguous ? <StatusText tone="warning">{reason}</StatusText> : reason}</td>
                      <td className="whitespace-nowrap text-right">
                        {canReconcile && pendingClose ? (
                          <RowActionButton
                            label={`Encerrar exceção da linha ${exception.lineNumber}`}
                            title="Encerrar exceção"
                            icon={CircleSlash}
                            loading={busy && closeMutation.isPending}
                            disabled={busy}
                            onClick={() => closeMutation.mutate({ exception, ...pendingClose })}
                          />
                        ) : canReconcile ? (
                          <RowActionButton
                            label={`Tentar de novo a linha ${exception.lineNumber}`}
                            title="Tentar de novo"
                            icon={RotateCw}
                            loading={busy && retryMutation.isPending}
                            disabled={busy}
                            onClick={() => retryMutation.mutate(exception)}
                          />
                        ) : null}
                      </td>
                    </tr>
                    {rowFeedback ? (
                      <tr data-row-detail>
                        <td colSpan={7}>
                          {rowFeedback.tone === 'danger'
                            ? <p role="alert"><StatusText tone="warning">{rowFeedback.text}</StatusText></p>
                            : <p role="status">{rowFeedback.text}</p>}
                        </td>
                      </tr>
                    ) : null}
                    {open ? (
                      <tr id={detailId} data-row-detail>
                        <td colSpan={7}>
                          <div className="grid gap-3">
                            <p>
                              Faturas abertas que aceitam este Pix. A baixa só é gravada se o banco aceitar o identificador e o valor.
                              {' '}Linha {exception.lineNumber} do extrato importado em {formatBrasiliaInstant(exception.createdAt)}.
                            </p>
                            {exception.txid.trim() ? <p>Identificador do Pix: <span className="font-[var(--app-font-mono)]">{exception.txid}</span></p> : null}
                            {candidatesQuery.isLoading ? <p role="status">Procurando faturas…</p> : null}
                            {candidatesQuery.error ? (
                              <p role="alert"><StatusText tone="warning">Não foi possível procurar as faturas: {extractErrorText(candidatesQuery.error)}</StatusText></p>
                            ) : null}
                            {candidatesQuery.data && !candidatesQuery.data.length ? (
                              <p>Nenhuma fatura aberta aceita o identificador desta linha. Investigue com o banco ou o Cliente antes de qualquer baixa.</p>
                            ) : null}
                            {candidatesQuery.data?.length ? (
                              <table className="app-table app-table--compact app-table--nested">
                                <caption className="sr-only">Faturas candidatas da linha {exception.lineNumber}</caption>
                                <thead>
                                  <tr>
                                    <th scope="col">Fatura</th>
                                    <th scope="col">Origem</th>
                                    <th scope="col">Valor da fatura</th>
                                    <th scope="col">Pix</th>
                                    <th scope="col"><span className="sr-only">Ação</span></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {candidatesQuery.data.map((candidate) => {
                                    const sameAmount = Math.abs(candidate.amount - exception.amount) <= 0.01
                                    const linking = linkMutation.isPending && linkMutation.variables?.candidate.invoiceId === candidate.invoiceId
                                    return (
                                      <tr key={`${candidate.source}-${candidate.invoiceId}`}>
                                        <td className="whitespace-nowrap">{candidate.docNumber}</td>
                                        <td className="whitespace-nowrap">{sourceLabel(candidate.source)}</td>
                                        <td className="whitespace-nowrap tabular-nums">{formatBRL(candidate.amount)}</td>
                                        <td className="whitespace-nowrap tabular-nums" title={sameAmount ? 'Mesmo valor do Pix' : 'Valor diferente do Pix'}>
                                          {sameAmount ? formatBRL(exception.amount) : <StatusText tone="warning">{formatBRL(exception.amount)}</StatusText>}
                                        </td>
                                        <td className="whitespace-nowrap text-right">
                                          {canReconcile ? (
                                            <RowActionButton
                                              label={`Baixar na fatura ${candidate.docNumber}`}
                                              title="Baixar nesta fatura"
                                              icon={Link2}
                                              loading={linking}
                                              disabled={busy}
                                              onClick={() => linkMutation.mutate({ exception, candidate })}
                                            />
                                          ) : null}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Block>
  )
}

function ChargesBlock({ monitor, onOpenInvoice }: { monitor: ItauPixMonitor | undefined; onOpenInvoice: OpenInvoice }) {
  const charges = sortItauCharges(monitor?.charges ?? [])
  const [openId, setOpenId] = useState<number | null>(null)
  return (
    <Block
      title="Cobranças aguardando o Itaú"
      flush
      aside={`${charges.length.toLocaleString('pt-BR')} · a fatura mostra "QR em preparação" enquanto aguarda`}
    >
      {charges.length ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Cobranças ainda não confirmadas pelo Itaú</caption>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Resposta do banco</span></th>
                <th scope="col">Fatura</th>
                <th scope="col">Origem</th>
                <th scope="col">Valor</th>
                <th scope="col">Situação</th>
                <th scope="col">Tentativas</th>
                <th scope="col">Próxima tentativa</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((charge) => {
                const state = itauChargeState(charge)
                const open = openId === charge.id
                const detailId = `pix-charge-${charge.id}`
                return (
                  <Fragment key={charge.id}>
                    <tr>
                      <td className="w-px">
                        <RowToggle
                          open={open}
                          controls={detailId}
                          label={`resposta do banco da cobrança ${charge.docNumber ?? charge.id}`}
                          onClick={() => setOpenId((current) => (current === charge.id ? null : charge.id))}
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        {charge.docNumber && charge.invoiceId != null ? (
                          <button type="button" className="app-link" onClick={() => onOpenInvoice(charge.source, charge.invoiceId!)}>{charge.docNumber}</button>
                        ) : (
                          charge.docNumber ?? <NoValue label="Fatura removida" />
                        )}
                      </td>
                      <td className="whitespace-nowrap">{sourceLabel(charge.source)}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatBRL(charge.amount)}</td>
                      <td className="whitespace-nowrap">{state.needsAction ? <StatusText tone="warning">{state.label}</StatusText> : state.label}</td>
                      <td className="whitespace-nowrap tabular-nums">{charge.attempts.toLocaleString('pt-BR')}</td>
                      <td className="whitespace-nowrap tabular-nums">{charge.nextAttemptAt ? cellInstant(charge.nextAttemptAt) : <NoValue label="Sem tentativa marcada" />}</td>
                    </tr>
                    {open ? (
                      <tr id={detailId} data-row-detail>
                        <td colSpan={7}>
                          <FactList columns={3}>
                            <Fact label="Resposta do banco">{charge.lastError?.trim() || (charge.uncertain ? 'Sem resposta; a fila consulta o banco antes de repetir' : 'Nenhum erro')}</Fact>
                            <Fact label="Identificador do Pix"><span className="font-[var(--app-font-mono)] break-all">{charge.txid}</span></Fact>
                            <Fact label="Última tentativa">{cellInstant(charge.updatedAt)}</Fact>
                          </FactList>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="app-block__body">Nenhuma cobrança aguardando o Itaú.</p>
      )}
    </Block>
  )
}
