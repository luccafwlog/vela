import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { SummaryStrip } from '../ui/SummaryStrip'
import { ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice } from '../shared/ImportParts'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import { afterPendenciaPixAlterada, afterPixConciliado } from '../../services/cacheEffects'
import { parsePixExtractFile } from '../../services/demurrage/demurrageKpis'
import { readSpreadsheetNotices } from '../../services/importCore'
import {
  confirmUnifiedPixReconciliation,
  createPixImportKey,
  getPixLineIdentity,
  matchUnifiedPixTransactions,
  persistUnresolvedPixMatches,
  type UnifiedPixConfirmationResult,
  type UnifiedPixMatch,
} from '../../services/reconciliacao'
import { extractErrorText } from '../../lib/errors'
import { formatBRL, formatCnpjCpf } from '../../lib/utils'
import {
  describeConfirmation,
  exceptionKindLabel,
  extractLineKind,
  formatExtractDay,
  pluralize,
  readyAmountNote,
  splitExtractLines,
} from './pixReconciliationPresentation'

type OpenInvoice = (source: 'local' | 'demurrage', invoiceId: number) => void

type ReadResult = {
  matches: UnifiedPixMatch[]
  /** Linhas ocultas da aba que o parser PIX lê (a primeira visível): só elas tiram linhas da conciliação. */
  firstSheetHiddenRows: number
}

const sourceLabel = (source: 'local' | 'demurrage' | 'unmatched') => (source === 'demurrage' ? 'Demurrage' : source === 'local' ? 'Taxas Locais' : '—')

/**
 * Conciliação pelo extrato "QR Codes recebidos" do Itaú: escolher o arquivo,
 * ler (nada é baixado), conferir o que entra no lote e o que fica como exceção,
 * confirmar o lote (tudo ou nada) e ver o resultado que o banco devolveu.
 */
export function PixExtractPanel({ onOpenPending, onOpenInvoice }: { onOpenPending: () => void; onOpenInvoice: OpenInvoice }) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [read, setRead] = useState<ReadResult | null>(null)
  const [outcome, setOutcome] = useState<{ sent: UnifiedPixMatch[]; result: UnifiedPixConfirmationResult; exceptions: number } | null>(null)

  const readMutation = useMutation({
    mutationFn: async (chosen: File): Promise<ReadResult> => {
      const [transactions, notices] = await Promise.all([parsePixExtractFile(chosen), readSpreadsheetNotices(chosen)])
      if (!transactions.length) throw new Error('Nenhuma transação Pix encontrada no extrato. Confira se é o relatório "QR Codes recebidos" e se as linhas estão visíveis.')
      const [importKey, found] = await Promise.all([createPixImportKey(chosen), matchUnifiedPixTransactions(transactions)])
      // As linhas sem baixa segura ficam salvas já na leitura: sair da tela não as perde.
      const persisted = await persistUnresolvedPixMatches(importKey, found)
      const idsByLine = new Map(persisted.map((item) => [item.lineNumber, item.id]))
      return {
        matches: found.map((match) => ({ ...match, exceptionId: idsByLine.get(getPixLineIdentity(match.transaction)) })),
        firstSheetHiddenRows: notices.firstSheetHiddenRows,
      }
    },
    onSuccess: async (result) => {
      setRead(result)
      if (result.matches.some((match) => extractLineKind(match) !== 'ready')) {
        await afterPendenciaPixAlterada(queryClient)
      }
    },
  })

  const confirmMutation = useMutation({
    mutationFn: (ready: UnifiedPixMatch[]) => confirmUnifiedPixReconciliation(ready),
    onSuccess: async (result, ready) => {
      setOutcome({ sent: ready, result, exceptions: read ? splitExtractLines(read.matches).exceptions.length : 0 })
      setRead(null)
      await afterPixConciliado(queryClient)
    },
  })

  function chooseFile(chosen: File) {
    setFile(chosen)
    setRead(null)
    setOutcome(null)
    confirmMutation.reset()
    readMutation.mutate(chosen)
  }

  function reset() {
    setFile(null)
    setRead(null)
    setOutcome(null)
    readMutation.reset()
    confirmMutation.reset()
  }

  const busy = readMutation.isPending || confirmMutation.isPending

  return (
    <div className="app-pix-panel">
      <section className="app-pix-section" aria-labelledby="pix-extract-title">
        <div className="app-pix-section__head">
          <h2 id="pix-extract-title" className="app-pix-section__title">Extrato Pix do Itaú</h2>
          <p className="app-pix-section__hint">Para Pix que não deu baixa automática ou faturas com QR estático. O casamento é só pelo TXID; CNPJ e valor não localizam fatura.</p>
        </div>
        <ImportGuide
          requiredLabel="Colunas lidas"
          required={<>Identificador (TXID) e Valor pago</>}
          optional={<>CPF/CNPJ e Pago em</>}
          details={(
            <p>
              Use o relatório "QR Codes recebidos" (.xlsx ou .xls). A leitura começa na linha que tem a coluna Identificador e
              ignora valores zerados ou negativos. Linhas e abas ocultas ficam de fora.
            </p>
          )}
        />
        <ImportFilePicker
          accept=".xlsx,.xls"
          label="Extrato"
          files={file ? [file] : []}
          onFiles={([chosen]) => chooseFile(chosen)}
          disabled={busy}
          disabledReason={readMutation.isPending ? 'Aguarde a leitura terminar.' : confirmMutation.isPending ? 'Aguarde a baixa do lote terminar.' : undefined}
        />
        {readMutation.isPending ? (
          <div className="app-import-reading" role="status" aria-live="polite">
            <Loader2 size={18} className="app-import-reading__spinner animate-spin" aria-hidden="true" />
            <div className="app-import-reading__body">
              <p className="app-import-reading__title">Lendo o extrato e procurando as faturas pelo TXID</p>
              <p className="app-import-reading__meta">Nada é baixado nesta fase. Linhas sem fatura segura ficam salvas como exceção.</p>
              <div role="progressbar" aria-label="Lendo o extrato" className="app-import-reading__bar app-import-reading__bar--indeterminate"><span /></div>
            </div>
          </div>
        ) : null}
        {readMutation.error ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o extrato">
            <p>{extractErrorText(readMutation.error)} Nada foi baixado.</p>
          </ImportNotice>
        ) : null}
      </section>

      {read ? (
        <ExtractReview
          read={read}
          confirming={confirmMutation.isPending}
          confirmError={confirmMutation.error ? extractErrorText(confirmMutation.error) : null}
          onConfirm={(ready) => confirmMutation.mutate(ready)}
          onDiscard={reset}
          onOpenPending={onOpenPending}
        />
      ) : null}

      {outcome ? (
        <ConfirmationResult
          outcome={outcome}
          onOpenInvoice={onOpenInvoice}
          onOpenPending={onOpenPending}
          onReset={reset}
        />
      ) : null}
    </div>
  )
}

function ExtractReview({
  read,
  confirming,
  confirmError,
  onConfirm,
  onDiscard,
  onOpenPending,
}: {
  read: ReadResult
  confirming: boolean
  confirmError: string | null
  onConfirm: (ready: UnifiedPixMatch[]) => void
  onDiscard: () => void
  onOpenPending: () => void
}) {
  const lines = splitExtractLines(read.matches)
  const readyCount = lines.ready.length
  const exceptionCount = lines.exceptions.length

  return (
    <section className="app-pix-section app-pix-review" aria-labelledby="pix-review-title">
      <div className="app-pix-section__head">
        <h2 id="pix-review-title" className="app-pix-section__title">Conferência do extrato</h2>
        <SummaryStrip
          label="Resumo da leitura"
          items={[
            { label: readyCount === 1 ? 'pronta para baixa' : 'prontas para baixa', value: readyCount.toLocaleString('pt-BR') },
            ...(readyCount ? [{ label: 'no lote', value: formatBRL(lines.readyTotal) }] : []),
            { label: exceptionCount === 1 ? 'fica como exceção' : 'ficam como exceção', value: exceptionCount.toLocaleString('pt-BR'), tone: exceptionCount ? 'warning' as const : 'default' as const },
            { label: read.matches.length === 1 ? 'linha lida' : 'linhas lidas', value: read.matches.length.toLocaleString('pt-BR') },
          ]}
        />
      </div>

      {read.firstSheetHiddenRows > 0 ? (
        <ImportNotice tone="warning" role="status" title="Parte do extrato ficou de fora">
          <p>
            {pluralize(read.firstSheetHiddenRows, 'linha oculta', 'linhas ocultas')} da aba lida não {read.firstSheetHiddenRows === 1 ? 'entrou' : 'entraram'}.
            Só as linhas visíveis entram na conciliação. Reexiba as ocultas e envie de novo se elas também devem entrar.
          </p>
        </ImportNotice>
      ) : null}

      <div className="app-pix-block">
        <h3 className="app-pix-block__title">Prontas para baixa <span className="app-pix-count">{readyCount}</span></h3>
        {readyCount ? (
          <ExtractLines lines={lines.ready} variant="ready" />
        ) : (
          <p className="app-pix-empty">Nenhuma linha tem uma fatura aberta com o mesmo TXID e um valor aceito.</p>
        )}
      </div>

      {exceptionCount ? (
        <div className="app-pix-block">
          <h3 className="app-pix-block__title">Ficam como exceção pendente <span className="app-pix-count">{exceptionCount}</span></h3>
          <p className="app-pix-section__hint">
            Não entram no lote. Já estão salvas em{' '}
            <button type="button" className="app-pix-link" onClick={onOpenPending}>Pendências</button>, onde podem ser conciliadas depois.
          </p>
          <ExtractLines lines={lines.exceptions} variant="exception" />
        </div>
      ) : null}

      {confirmError ? (
        <ImportNotice tone="danger" role="alert" title="Nenhuma baixa foi gravada">
          <p>{confirmError}</p>
          <p>O lote é tudo ou nada: uma linha recusada impede as demais. Confira a linha no histórico de baixas antes de enviar de novo.</p>
        </ImportNotice>
      ) : null}

      <div className="app-pix-footer">
        <ImportFootnote tone={readyCount ? 'default' : 'warning'}>
          {readyCount > 1
            ? `Nada foi baixado ainda. As ${readyCount.toLocaleString('pt-BR')} baixas são gravadas juntas: se uma for recusada, nenhuma é gravada.`
            : readyCount ? 'Nada foi baixado ainda.' : 'Nada para baixar neste extrato.'}
        </ImportFootnote>
        <div className="app-pix-footer__actions">
          <Button variant="ghost" disabled={confirming} onClick={onDiscard}>Descartar leitura</Button>
          <Button
            disabled={!readyCount}
            loading={confirming}
            loadingLabel="Baixando…"
            onClick={() => onConfirm(lines.ready)}
          >
            {readyCount ? `Confirmar ${pluralize(readyCount, 'baixa', 'baixas')}` : 'Confirmar baixas'}
          </Button>
        </div>
      </div>
    </section>
  )
}

function ExtractLines({ lines, variant }: { lines: UnifiedPixMatch[]; variant: 'ready' | 'exception' }) {
  const narrow = useNarrowViewport()
  const caption = variant === 'ready' ? 'Linhas do extrato prontas para baixa' : 'Linhas do extrato que ficam como exceção pendente'

  if (narrow) {
    return (
      <ul className="app-pix-list" aria-label={caption}>
        {lines.map((match, index) => {
          const kind = extractLineKind(match)
          const note = variant === 'ready' ? readyAmountNote(match) : match.ambiguityReason
          return (
            <li key={`${variant}-${getPixLineIdentity(match.transaction)}-${index}`} className="app-pix-row">
              <div className="app-pix-row__main">
                <p className="app-pix-row__title">
                  <span className="app-pix-amount">{formatBRL(match.transaction.amount)}</span>
                  <span className="app-pix-muted">pago em {formatExtractDay(match.transaction.date)}</span>
                  {kind !== 'ready' ? <Badge tone={kind === 'unmatched' ? 'neutral' : 'warning'}>{exceptionKindLabel(kind)}</Badge> : null}
                </p>
                {match.source !== 'unmatched' ? (
                  <p className="app-pix-row__reason">
                    <span className="app-pix-doc">{match.docNumber}</span> · {sourceLabel(match.source)}
                    {match.customerName ? ` · ${match.customerName}` : ''}
                    {variant === 'exception' ? ` · documento ${formatBRL(match.amount)}` : ''}
                  </p>
                ) : null}
                {note ? <p className={variant === 'ready' ? 'app-pix-row__meta' : 'app-pix-row__reason'}>{note}</p> : null}
                <p className="app-pix-row__meta"><span>TXID</span> <span className="app-pix-code">{match.transaction.txid || 'ausente'}</span></p>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact app-pix-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="app-pix-num">Linha</th>
            <th scope="col">Pago em</th>
            <th scope="col" className="app-pix-num">Valor do Pix</th>
            <th scope="col">TXID</th>
            <th scope="col">{variant === 'ready' ? 'Fatura' : 'Situação'}</th>
            <th scope="col">{variant === 'ready' ? 'Cliente' : 'Documento indicado'}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((match, index) => {
            const kind = extractLineKind(match)
            const note = readyAmountNote(match)
            return (
              <tr key={`${variant}-${getPixLineIdentity(match.transaction)}-${index}`}>
                <td className="app-pix-num">{match.transaction.lineNumber ?? '—'}</td>
                <td className="tabular-nums">{formatExtractDay(match.transaction.date)}</td>
                <td className="app-pix-num">
                  <span className="app-pix-amount">{formatBRL(match.transaction.amount)}</span>
                  {variant === 'ready' && note ? <span className="app-pix-meta">{note}</span> : null}
                </td>
                <td><span className="app-pix-code">{match.transaction.txid || 'ausente'}</span></td>
                {variant === 'ready' ? (
                  <>
                    <td>
                      <span className="app-pix-doc">{match.docNumber}</span>
                      <span className="app-pix-meta">{sourceLabel(match.source)}</span>
                    </td>
                    <td>
                      <span className="app-pix-clamp">{match.customerName || '—'}</span>
                      {match.customerCnpj ? <span className="app-pix-meta tabular-nums">{formatCnpjCpf(match.customerCnpj)}</span> : null}
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      <Badge tone={kind === 'unmatched' ? 'neutral' : 'warning'}>{exceptionKindLabel(kind === 'unmatched' ? 'unmatched' : 'ambiguous')}</Badge>
                      <span className="app-pix-meta">{match.ambiguityReason ?? '—'}</span>
                    </td>
                    <td>
                      {match.source === 'unmatched' ? '—' : (
                        <>
                          <span className="app-pix-doc">{match.docNumber}</span>
                          <span className="app-pix-meta">{sourceLabel(match.source)} · {formatBRL(match.amount)}</span>
                        </>
                      )}
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ConfirmationResult({
  outcome,
  onOpenInvoice,
  onOpenPending,
  onReset,
}: {
  outcome: { sent: UnifiedPixMatch[]; result: UnifiedPixConfirmationResult; exceptions: number }
  onOpenInvoice: OpenInvoice
  onOpenPending: () => void
  onReset: () => void
}) {
  const { items, missing } = describeConfirmation(outcome.sent, outcome.result)
  const total = items.reduce((sum, item) => sum + (item.amount ?? 0), 0)

  return (
    <section className="app-pix-section" aria-labelledby="pix-result-title">
      <div className="app-pix-section__head">
        <h2 id="pix-result-title" className="app-pix-section__title">Resultado da baixa</h2>
      </div>
      <ImportNotice tone={missing ? 'warning' : 'success'} role="status" title={`${pluralize(items.length, 'baixa confirmada', 'baixas confirmadas')} pelo banco`}>
        <p>
          {items.length ? `Total de ${formatBRL(total)}. As faturas já aparecem no histórico de baixas.` : 'O banco não devolveu nenhuma baixa.'}
          {missing ? ` ${pluralize(missing, 'linha enviada não voltou', 'linhas enviadas não voltaram')} na resposta: confira o histórico antes de enviar o extrato de novo.` : ''}
        </p>
      </ImportNotice>
      {items.length ? (
        <ul className="app-pix-list" aria-label="Baixas confirmadas">
          {items.map((item) => (
            <li key={item.key} className="app-pix-row">
              <div className="app-pix-row__main">
                <p className="app-pix-row__title">
                  <button type="button" className="app-pix-link app-pix-doc" onClick={() => onOpenInvoice(item.source, item.invoiceId)}>{item.docNumber}</button>
                  <span className="app-pix-muted">{sourceLabel(item.source)}</span>
                  {item.amount != null ? <span className="app-pix-amount">{formatBRL(item.amount)}</span> : null}
                  <Badge tone="success">Baixa confirmada</Badge>
                </p>
                <p className="app-pix-row__meta">
                  {item.customerName ? <span>{item.customerName}</span> : null}
                  {item.paidAt ? <><span aria-hidden="true">·</span><span>pago em {formatExtractDay(item.paidAt)}</span></> : null}
                  {item.txid ? <><span aria-hidden="true">·</span><span>TXID</span> <span className="app-pix-code">{item.txid}</span></> : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {outcome.exceptions ? (
        <p className="app-pix-section__hint">
          {pluralize(outcome.exceptions, 'linha não entrou no lote e está', 'linhas não entraram no lote e estão')} em{' '}
          <button type="button" className="app-pix-link" onClick={onOpenPending}>Pendências</button>.
        </p>
      ) : null}
      <div className="app-pix-footer">
        <span />
        <div className="app-pix-footer__actions">
          <Button variant="secondary" onClick={onReset}>Conciliar outro extrato</Button>
        </div>
      </div>
    </section>
  )
}
