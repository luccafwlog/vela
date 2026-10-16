import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice } from '../shared/ImportParts'
import { useAuth } from '../../hooks/useAuth'
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
import { formatBRL } from '../../lib/utils'
import { TxidCell } from './PixTxidCell'
import {
  describeConfirmation,
  extractLineKind,
  extractLineReason,
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

const sourceLabel = (source: 'local' | 'demurrage' | 'unmatched') => (source === 'demurrage' ? 'Demurrage' : 'Taxas Locais')

/**
 * Conciliação pelo extrato "QR Codes recebidos" do Itaú: escolher o arquivo,
 * ler (nada é baixado), conferir o que entra no lote e o que fica como exceção,
 * confirmar o lote (tudo ou nada) e ver o resultado que o banco devolveu.
 */
export function PixExtractPanel({ onOpenPending, onOpenInvoice }: { onOpenPending: () => void; onOpenInvoice: OpenInvoice }) {
  const { can } = useAuth()
  const canReconcile = can('settle_financial_adjustments')
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

  // Ler o extrato já grava as exceções e confirmar baixa: conciliar é do
  // Financeiro e do Administrativo (ADR 0085, D5; migration 247).
  if (!canReconcile) {
    return (
      <div className="grid min-w-0 gap-4 pt-1">
        <Block title="Extrato Pix do Itaú">
          <ImportNotice tone="info" role="status" title="Conciliar extrato é do Financeiro e do Administrativo">
            <p>Você acompanha as pendências e o histórico de baixas; a leitura do extrato registra exceções e baixa faturas.</p>
          </ImportNotice>
        </Block>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-4 pt-1">
      <Block title="Extrato Pix do Itaú" aside={'Relatório "QR Codes recebidos", .xlsx ou .xls'} bodyClassName="grid gap-3">
        <p>Para Pix que não deu baixa automática ou faturas com QR estático. A fatura é encontrada só pelo identificador do Pix; CNPJ e valor não localizam fatura.</p>
        <ImportGuide
          requiredLabel="Colunas lidas"
          required={<>Identificador do Pix e Valor pago</>}
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
              <p className="app-import-reading__title">Lendo o extrato e procurando as faturas pelo identificador do Pix</p>
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
      </Block>

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
  const hidden = read.firstSheetHiddenRows

  return (
    <Block title="Conferência do extrato" aside={pluralize(read.matches.length, 'linha lida', 'linhas lidas')} bodyClassName="grid gap-4">
      <LeadValue detail={readyCount ? `${formatBRL(lines.readyTotal)} no lote` : 'Nenhuma linha tem uma fatura aberta com o mesmo identificador e um valor aceito.'}>
        {readyCount ? `${readyCount.toLocaleString('pt-BR')} ${readyCount === 1 ? 'pronta' : 'prontas'} para baixa` : 'Nenhuma pronta para baixa'}
      </LeadValue>
      <FactList columns={2}>
        <Fact label="Ficam como exceção">
          {exceptionCount ? <StatusText tone="warning">{exceptionCount.toLocaleString('pt-BR')}</StatusText> : 'Nenhuma'}
        </Fact>
        <Fact
          label="Linhas ocultas fora da leitura"
          detail={hidden ? 'Só as linhas visíveis entram. Reexiba as ocultas e envie de novo se elas também devem entrar.' : undefined}
        >
          {hidden ? <StatusText tone="warning">{hidden.toLocaleString('pt-BR')}</StatusText> : 'Nenhuma'}
        </Fact>
      </FactList>

      {readyCount ? (
        <Block title={`Prontas para baixa · ${readyCount.toLocaleString('pt-BR')}`} headingLevel={3} flush>
          <ReadyLines lines={lines.ready} />
        </Block>
      ) : null}

      {exceptionCount ? (
        <Block title={`Ficam como exceção · ${exceptionCount.toLocaleString('pt-BR')}`} headingLevel={3} flush aside="Já estão salvas em Pendências">
          <ExceptionLines lines={lines.exceptions} />
        </Block>
      ) : null}

      {confirmError ? (
        <ImportNotice tone="danger" role="alert" title="Nenhuma baixa foi gravada">
          <p>{confirmError}</p>
          <p>O lote é tudo ou nada: uma linha recusada impede as demais. Confira a linha no histórico de baixas antes de enviar de novo.</p>
        </ImportNotice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ImportFootnote tone={readyCount ? 'default' : 'warning'}>
          {readyCount > 1
            ? `Nada foi baixado ainda. As ${readyCount.toLocaleString('pt-BR')} baixas são gravadas juntas: se uma for recusada, nenhuma é gravada.`
            : readyCount ? 'Nada foi baixado ainda.' : 'Nada para baixar neste extrato.'}
          {exceptionCount ? ' As exceções já estão em Pendências.' : ''}
        </ImportFootnote>
        <div className="flex flex-wrap gap-2">
          {exceptionCount ? <Button variant="secondary" disabled={confirming} onClick={onOpenPending}>Ver Pendências</Button> : null}
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
    </Block>
  )
}

const lineKey = (prefix: string, match: UnifiedPixMatch, index: number) => `${prefix}-${getPixLineIdentity(match.transaction)}-${index}`

function LineNumber({ match }: { match: UnifiedPixMatch }) {
  return <>{match.transaction.lineNumber ?? <NoValue label="Sem número de linha" />}</>
}

function ReadyLines({ lines }: { lines: UnifiedPixMatch[] }) {
  // A coluna Conferência só aparece quando alguma linha tem nota (valor diferente da cobrança).
  const notes = lines.map(readyAmountNote)
  const withNotes = notes.some(Boolean)
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact">
        <caption className="sr-only">Linhas do extrato prontas para baixa</caption>
        <thead>
          <tr>
            <th scope="col">Linha</th>
            <th scope="col">Pago em</th>
            <th scope="col">Valor do Pix</th>
            <th scope="col">Identificador do Pix</th>
            <th scope="col">Fatura</th>
            <th scope="col">Origem</th>
            <th scope="col" className="app-table__text-head">Cliente</th>
            {withNotes ? <th scope="col" className="app-table__text-head">Conferência</th> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((match, index) => (
            <tr key={lineKey('ready', match, index)}>
              <td className="whitespace-nowrap tabular-nums"><LineNumber match={match} /></td>
              <td className="whitespace-nowrap tabular-nums">{formatExtractDay(match.transaction.date)}</td>
              <td className="whitespace-nowrap tabular-nums">{formatBRL(match.transaction.amount)}</td>
              <td className="whitespace-nowrap"><TxidCell txid={match.transaction.txid} /></td>
              <td className="whitespace-nowrap">{match.docNumber}</td>
              <td className="whitespace-nowrap">{sourceLabel(match.source)}</td>
              <td className="app-table__text" title={match.customerName || undefined}>{match.customerName || <NoValue label="Sem Cliente" />}</td>
              {withNotes ? <td className="app-table__text app-table__text--wrap">{notes[index] ?? <NoValue label="Sem observação" />}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExceptionLines({ lines }: { lines: UnifiedPixMatch[] }) {
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact">
        <caption className="sr-only">Linhas do extrato que ficam como exceção pendente</caption>
        <thead>
          <tr>
            <th scope="col">Linha</th>
            <th scope="col">Pago em</th>
            <th scope="col">Valor do Pix</th>
            <th scope="col">Identificador do Pix</th>
            <th scope="col" className="app-table__text-head">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((match, index) => {
            const reason = extractLineReason(match)
            const ambiguous = extractLineKind(match) === 'ambiguous'
            return (
              <tr key={lineKey('exception', match, index)}>
                <td className="whitespace-nowrap tabular-nums"><LineNumber match={match} /></td>
                <td className="whitespace-nowrap tabular-nums">{formatExtractDay(match.transaction.date)}</td>
                <td className="whitespace-nowrap tabular-nums">{formatBRL(match.transaction.amount)}</td>
                <td className="whitespace-nowrap"><TxidCell txid={match.transaction.txid} /></td>
                <td className="app-table__text app-table__text--wrap">{ambiguous ? <StatusText tone="warning">{reason}</StatusText> : reason}</td>
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
    <Block title="Resultado da baixa" bodyClassName="grid gap-4">
      <div role="status">
        <LeadValue
          tone={missing ? 'warning' : 'default'}
          detail={(
            <>
              {items.length ? `Total de ${formatBRL(total)}. As faturas já aparecem no histórico de baixas.` : 'O banco não devolveu nenhuma baixa.'}
              {missing ? ` ${pluralize(missing, 'linha enviada não voltou', 'linhas enviadas não voltaram')} na resposta: confira o histórico antes de enviar o extrato de novo.` : ''}
            </>
          )}
        >
          {`${pluralize(items.length, 'baixa confirmada', 'baixas confirmadas')} pelo banco`}
        </LeadValue>
      </div>
      {items.length ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Baixas confirmadas</caption>
            <thead>
              <tr>
                <th scope="col">Fatura</th>
                <th scope="col">Origem</th>
                <th scope="col" className="app-table__text-head">Cliente</th>
                <th scope="col">Pago em</th>
                <th scope="col">Valor do Pix</th>
                <th scope="col">Identificador do Pix</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <td className="whitespace-nowrap"><button type="button" className="app-link" onClick={() => onOpenInvoice(item.source, item.invoiceId)}>{item.docNumber}</button></td>
                  <td className="whitespace-nowrap">{sourceLabel(item.source)}</td>
                  <td className="app-table__text" title={item.customerName || undefined}>{item.customerName || <NoValue label="Sem Cliente" />}</td>
                  <td className="whitespace-nowrap tabular-nums">{item.paidAt ? formatExtractDay(item.paidAt) : <NoValue label="Sem data de pagamento" />}</td>
                  <td className="whitespace-nowrap tabular-nums">{item.amount != null ? formatBRL(item.amount) : <NoValue label="Sem valor" />}</td>
                  <td className="whitespace-nowrap"><TxidCell txid={item.txid} /></td>
                  <td className="whitespace-nowrap"><StatusText tone="paid">Baixa confirmada</StatusText></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          {outcome.exceptions
            ? `${pluralize(outcome.exceptions, 'linha não entrou no lote e está', 'linhas não entraram no lote e estão')} em Pendências.`
            : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {outcome.exceptions ? <Button variant="secondary" onClick={onOpenPending}>Ver Pendências</Button> : null}
          <Button variant="secondary" onClick={onReset}>Conciliar outro extrato</Button>
        </div>
      </div>
    </Block>
  )
}
