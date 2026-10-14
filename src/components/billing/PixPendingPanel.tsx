import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Field, Textarea } from '../ui/Input'
import { ImportNotice } from '../shared/ImportParts'
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
  exceptionKindLabel,
  formatBrasiliaInstant,
  formatExtractDay,
  itauChargeState,
  pendingExceptionDoc,
  pendingExceptionReason,
  pluralize,
  sortItauCharges,
} from './pixReconciliationPresentation'

const HANDLED_NOTE_MIN = 5 // itau_pix_mark_receipt_handled (migration 154)

type OpenInvoice = (source: 'local' | 'demurrage', invoiceId: number) => void

/**
 * Pendências da Conciliação PIX: Pix que entrou no Itaú e não deu baixa,
 * linhas de extrato sem baixa segura e cobranças que ainda esperam o banco.
 * Cada lista diz o que falta e o caminho; nada aqui baixa por semelhança.
 */
export function PixPendingPanel({ onOpenExtract, onOpenInvoice }: { onOpenExtract: () => void; onOpenInvoice: OpenInvoice }) {
  const monitorQuery = useItauPixMonitor()
  const exceptionsQuery = usePixExceptions()
  const monitor = monitorQuery.data

  return (
    <div className="app-pix-panel">
      <ItauStatus query={monitorQuery} onOpenExtract={onOpenExtract} />
      {monitor?.provider === 'itau' || monitor?.receipts.length ? <ReceiptsSection monitor={monitor} /> : null}
      <ExceptionsSection query={exceptionsQuery} onOpenExtract={onOpenExtract} />
      {monitor?.provider === 'itau' || monitor?.charges.length ? <ChargesSection monitor={monitor} onOpenInvoice={onOpenInvoice} /> : null}
    </div>
  )
}

function ItauStatus({ query, onOpenExtract }: { query: ReturnType<typeof useItauPixMonitor>; onOpenExtract: () => void }) {
  const monitor = query.data
  if (query.isLoading) return <p className="app-pix-status app-pix-muted" role="status">Consultando a cobrança Pix Itaú…</p>
  if (query.error || !monitor) {
    return (
      <div className="app-pix-status app-pix-status--error" role="alert">
        <p>Não foi possível consultar a cobrança Pix Itaú: {extractErrorText(query.error)}. Os Pix sem baixa e a fila do banco não estão nesta tela agora.</p>
        <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
      </div>
    )
  }
  if (monitor.provider !== 'itau') {
    return (
      <div className="app-pix-status">
        <p><strong>Cobrança Itaú desligada.</strong> As faturas usam o QR estático e a baixa vem do extrato.</p>
        <Button variant="secondary" className="app-btn--sm" onClick={onOpenExtract}>Conciliar extrato</Button>
      </div>
    )
  }
  const poll = describeItauPoll(monitor.polledUntil, new Date())
  return (
    <>
      <dl className="app-pix-status app-pix-facts" aria-label="Cobrança Pix Itaú">
        <div><dt>Baixa automática</dt><dd>Ligada</dd></div>
        <div>
          <dt>Recebimentos consultados até</dt>
          <dd className={poll.stale ? 'app-pix-warning' : undefined}>
            {monitor.polledUntil ? `${formatBrasiliaInstant(monitor.polledUntil)} (${poll.text})` : 'ainda não consultados'}
          </dd>
        </div>
        <div><dt>Cobranças ativas</dt><dd className="tabular-nums">{(monitor.counts.active ?? 0).toLocaleString('pt-BR')}</dd></div>
      </dl>
      {poll.stale ? (
        <ImportNotice tone="warning" role="status" title="A consulta de recebimentos do Itaú não está avançando">
          <p>
            {monitor.polledUntil
              ? `Pix pagos depois de ${formatBrasiliaInstant(monitor.polledUntil)} ainda não foram consultados e não deram baixa automática.`
              : 'Nenhum recebimento foi consultado ainda; Pix pagos não deram baixa automática.'}{' '}
            Avise quem cuida da integração Itaú antes de baixar à mão.
          </p>
        </ImportNotice>
      ) : null}
    </>
  )
}

function ReceiptsSection({ monitor }: { monitor: ItauPixMonitor | undefined }) {
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
    <section className="app-pix-section" aria-labelledby="pix-receipts-title">
      <div className="app-pix-section__head">
        <h2 id="pix-receipts-title" className="app-pix-section__title">
          Pix recebidos sem baixa <span className="app-pix-count">{receipts.length}</span>
        </h2>
        <p className="app-pix-section__hint">O dinheiro entrou no Itaú e a fatura não foi baixada. Baixe pela fatura ou pelo extrato; sem baixa a fazer (fatura cancelada a restituir, TXID sem fatura), marque como tratado com o motivo.</p>
      </div>
      {done ? <p className="app-pix-done" role="status">{done}</p> : null}
      {receipts.length ? (
        <ul className="app-pix-list">
          {receipts.map((receipt) => {
            const open = form?.endToEndId === receipt.endToEndId
            const noteLength = form?.note.trim().length ?? 0
            return (
              <li key={receipt.endToEndId} className="app-pix-row">
                <div className="app-pix-row__main">
                  <p className="app-pix-row__title">
                    <span className="app-pix-amount">{formatBRL(receipt.amount)}</span>
                    <span className="app-pix-muted">recebido em {formatBrasiliaInstant(receipt.paidAt)}</span>
                  </p>
                  <p className="app-pix-row__reason">{receipt.reason ?? 'Em análise.'}</p>
                  <p className="app-pix-row__meta"><span>TXID</span> <span className="app-pix-code" title={`endToEndId ${receipt.endToEndId}`}>{receipt.txid || '—'}</span></p>
                </div>
                {open && form ? (
                  <div className="app-pix-row__form">
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
                    <div className="app-pix-row__actions">
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
                ) : canReconcile ? (
                  <div className="app-pix-row__side">
                    <Button
                      ref={(node) => { if (node) triggerRefs.current.set(receipt.endToEndId, node); else triggerRefs.current.delete(receipt.endToEndId) }}
                      variant="secondary"
                      onClick={() => { setDone(null); setForm({ endToEndId: receipt.endToEndId, note: '', error: null }) }}
                    >
                      Marcar como tratado…
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="app-pix-empty">Nenhum Pix recebido sem baixa.</p>
      )}
    </section>
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

function ExceptionsSection({ query, onOpenExtract }: { query: ReturnType<typeof usePixExceptions>; onOpenExtract: () => void }) {
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const canReconcile = can('settle_financial_adjustments')
  const [openId, setOpenId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<ExceptionFeedback | null>(null)
  // Exceções com baixa gravada e encerramento recusado. A fatura já não está
  // aberta, então Tentar de novo e Escolher fatura não a acham mais; só falta
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
        throw new Error(`Ainda não há uma fatura segura para esta linha: ${match?.ambiguityReason ?? 'nenhum documento aberto usa este TXID.'}`)
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
    <section className="app-pix-section" aria-labelledby="pix-exceptions-title">
      <div className="app-pix-section__head">
        <h2 id="pix-exceptions-title" className="app-pix-section__title">
          Exceções do extrato <span className="app-pix-count">{query.data ? exceptions.length : '…'}</span>
        </h2>
        <p className="app-pix-section__hint">Linhas de extrato sem baixa segura (sem documento, TXID repetido, valor diferente). Ficam salvas por arquivo e linha até a baixa; Pix sem fatura segura se investiga com o banco ou o Cliente.</p>
      </div>
      {successElsewhere && feedback ? <p className="app-pix-done" role="status">{feedback.text}</p> : null}
      {query.isLoading ? <p className="app-pix-muted" role="status">Carregando as exceções…</p> : null}
      {query.error ? (
        <div className="app-pix-status app-pix-status--error" role="alert">
          <p>Não foi possível carregar as exceções do extrato: {extractErrorText(query.error)}</p>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {query.data && !exceptions.length ? (
        <p className="app-pix-empty">
          Nenhuma exceção pendente.{' '}
          <button type="button" className="app-pix-link" onClick={onOpenExtract}>Conciliar um extrato</button>
        </p>
      ) : null}
      {exceptions.length ? (
        <ul className="app-pix-list">
          {exceptions.map((exception) => {
            const kind = exception.reason === 'unmatched' ? 'unmatched' : 'ambiguous'
            const doc = pendingExceptionDoc(exception)
            const open = openId === exception.id
            const rowFeedback = feedback?.id === exception.id ? feedback : null
            const busy = busyId === exception.id
            const pendingClose = unclosed.get(exception.id)
            return (
              <li key={exception.id} className="app-pix-row">
                <div className="app-pix-row__main">
                  <p className="app-pix-row__title">
                    <span className="app-pix-amount">{formatBRL(exception.amount)}</span>
                    <span className="app-pix-muted">pago em {formatExtractDay(exception.paidAt)}</span>
                    <Badge tone={kind === 'unmatched' ? 'neutral' : 'warning'}>{exceptionKindLabel(kind)}</Badge>
                  </p>
                  <p className="app-pix-row__reason">{pendingExceptionReason(exception)}{doc ? ` Documento indicado: ${doc}.` : ''}</p>
                  <p className="app-pix-row__meta">
                    <span>TXID</span> <span className="app-pix-code">{exception.txid || 'ausente'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Linha {exception.lineNumber}</span>
                    {exception.cnpj ? <><span aria-hidden="true">·</span><span className="tabular-nums">{formatCnpjCpf(exception.cnpj)}</span></> : null}
                    <span aria-hidden="true">·</span>
                    <span>importada em {formatBrasiliaInstant(exception.createdAt)}</span>
                  </p>
                  {rowFeedback ? (
                    <p className={rowFeedback.tone === 'danger' ? 'app-pix-row__error' : 'app-pix-done'} role={rowFeedback.tone === 'danger' ? 'alert' : 'status'}>{rowFeedback.text}</p>
                  ) : null}
                </div>
                {pendingClose && canReconcile ? (
                  <div className="app-pix-row__side">
                    <Button
                      variant="secondary"
                      loading={busy && closeMutation.isPending}
                      loadingLabel="Encerrando…"
                      disabled={busy}
                      onClick={() => closeMutation.mutate({ exception, ...pendingClose })}
                    >
                      Encerrar exceção
                    </Button>
                  </div>
                ) : (
                  <div className="app-pix-row__side">
                    {canReconcile ? (
                      <Button
                        variant="secondary"
                        loading={busy && retryMutation.isPending}
                        loadingLabel="Conferindo…"
                        disabled={busy}
                        onClick={() => retryMutation.mutate(exception)}
                      >
                        Tentar de novo
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      aria-expanded={open}
                      aria-controls={`pix-candidates-${exception.id}`}
                      disabled={busy}
                      onClick={() => setOpenId((current) => (current === exception.id ? null : exception.id))}
                    >
                      {open ? 'Fechar faturas' : 'Escolher fatura…'}
                    </Button>
                  </div>
                )}
                {open && !pendingClose ? (
                  <div id={`pix-candidates-${exception.id}`} className="app-pix-candidates">
                    <p className="app-pix-section__hint">Faturas abertas que aceitam este TXID. A baixa só é gravada se o banco aceitar o TXID e o valor da fatura escolhida.</p>
                    {candidatesQuery.isLoading ? <p className="app-pix-muted" role="status">Procurando faturas…</p> : null}
                    {candidatesQuery.error ? (
                      <p className="app-pix-row__error" role="alert">Não foi possível procurar as faturas: {extractErrorText(candidatesQuery.error)}</p>
                    ) : null}
                    {candidatesQuery.data && !candidatesQuery.data.length ? (
                      <p className="app-pix-muted">Nenhuma fatura aberta aceita o TXID desta linha. Investigue com o banco ou o Cliente antes de qualquer baixa.</p>
                    ) : null}
                    {candidatesQuery.data?.length ? (
                      <ul className="app-pix-candidates__list">
                        {candidatesQuery.data.map((candidate) => {
                          const sameAmount = Math.abs(candidate.amount - exception.amount) <= 0.01
                          const linking = linkMutation.isPending && linkMutation.variables?.candidate.invoiceId === candidate.invoiceId
                          return (
                            <li key={`${candidate.source}-${candidate.invoiceId}`} className="app-pix-candidate">
                              <span className="app-pix-candidate__doc">{candidate.docNumber}</span>
                              <span className="app-pix-muted">{candidate.source === 'demurrage' ? 'Demurrage' : 'Taxas Locais'}</span>
                              <span className="app-pix-amount">{formatBRL(candidate.amount)}</span>
                              <span className={sameAmount ? 'app-pix-muted' : 'app-pix-warning'}>{sameAmount ? 'mesmo valor do Pix' : `Pix de ${formatBRL(exception.amount)}`}</span>
                              {canReconcile ? (
                                <Button
                                  variant="secondary"
                                  className="app-btn--sm"
                                  loading={linking}
                                  loadingLabel="Baixando…"
                                  disabled={busy}
                                  onClick={() => linkMutation.mutate({ exception, candidate })}
                                >
                                  Baixar nesta fatura
                                </Button>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

function ChargesSection({ monitor, onOpenInvoice }: { monitor: ItauPixMonitor | undefined; onOpenInvoice: OpenInvoice }) {
  const charges = sortItauCharges(monitor?.charges ?? [])
  const withProblem = charges.filter((charge) => itauChargeState(charge).needsAction).length
  return (
    <section className="app-pix-section" aria-labelledby="pix-charges-title">
      <div className="app-pix-section__head">
        <h2 id="pix-charges-title" className="app-pix-section__title">
          Cobranças aguardando o Itaú <span className="app-pix-count">{charges.length}</span>
        </h2>
        <p className="app-pix-section__hint">
          Emissão, alteração, conferência de vencimento e cancelamento ainda não confirmados pelo banco. A fila tenta de novo sozinha; resposta incerta é consultada antes de repetir. Enquanto aguarda, a fatura mostra "QR em preparação".
          {withProblem ? ` ${pluralize(withProblem, 'cobrança está', 'cobranças estão')} com erro ou resposta incerta.` : ''}
        </p>
      </div>
      {charges.length ? (
        <ul className="app-pix-list">
          {charges.map((charge) => {
            const state = itauChargeState(charge)
            return (
              <li key={charge.id} className="app-pix-row">
                <div className="app-pix-row__main">
                  <p className="app-pix-row__title">
                    {charge.docNumber && charge.invoiceId != null ? (
                      <button type="button" className="app-pix-link app-pix-doc" onClick={() => onOpenInvoice(charge.source, charge.invoiceId!)}>{charge.docNumber}</button>
                    ) : (
                      <span className="app-pix-doc">{charge.docNumber ?? 'Fatura removida'}</span>
                    )}
                    <span className="app-pix-muted">{charge.source === 'demurrage' ? 'Demurrage' : 'Taxas Locais'}</span>
                    <span className="app-pix-amount">{formatBRL(charge.amount)}</span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </p>
                  {charge.lastError ? <p className="app-pix-row__error">{charge.lastError}</p> : null}
                  <p className="app-pix-row__meta">
                    <span>TXID</span> <span className="app-pix-code">{charge.txid}</span>
                    {charge.attempts > 1 ? <><span aria-hidden="true">·</span><span>{charge.attempts} tentativas</span></> : null}
                    {charge.nextAttemptAt ? <><span aria-hidden="true">·</span><span>próxima tentativa {formatBrasiliaInstant(charge.nextAttemptAt)}</span></> : null}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="app-pix-empty">Nenhuma cobrança aguardando o Itaú.</p>
      )}
    </section>
  )
}
