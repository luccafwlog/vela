import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { useConfirm } from '../ui/ConfirmDialog'
import {
  ImportFileBlock,
  ImportFilePicker,
  ImportFootnote,
  ImportGuide,
  ImportNotice,
  ImportSection,
  ImportSteps,
  ImportTemplateLinks,
  type ImportStep,
} from '../shared/ImportParts'
import { ImportIssuesPanel } from '../shared/ImportIssuesPanel'
import type { ImportIssue } from '../../services/importValidation'
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
  /** Lançamentos zerados ou negativos (tarifas e saídas) ignorados (D3). */
  ignored: number
  /** Valor pago ou data ilegível: recusa o extrato inteiro; nada é lido nem salvo (ADR 0092). */
  errors: ImportIssue[]
}

type Outcome = { sent: UnifiedPixMatch[]; result: UnifiedPixConfirmationResult; exceptions: number }

const sourceLabel = (source: 'local' | 'demurrage' | 'unmatched') => (source === 'demurrage' ? 'Demurrage' : 'Taxas Locais')

/**
 * Conciliação pelo extrato "QR Codes recebidos" do Itaú, na janela de
 * importação (molde do lote 6a: Arquivo · Prévia · Resultado): escolher o
 * arquivo, ler (nada é baixado), conferir o que entra no lote e o que fica como
 * exceção, confirmar o lote (tudo ou nada) e ver o resultado que o banco
 * devolveu. Desde 2026-11-04 abre pelo botão Conciliar extrato da aba Pix
 * recebidos; antes era uma aba própria. Quem abre é o Financeiro ou a conta
 * Dev: a página desativa o botão para os demais, e as RPCs recusam
 * (decisão do dono de 2026-11-04; migration 583).
 */
export function PixExtractModal({ onClose, onOpenInvoice }: { onClose: () => void; onOpenInvoice: OpenInvoice }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [file, setFile] = useState<File | null>(null)
  const [read, setRead] = useState<ReadResult | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const readMutation = useMutation({
    mutationFn: async (chosen: File): Promise<ReadResult> => {
      const [extract, notices] = await Promise.all([parsePixExtractFile(chosen), readSpreadsheetNotices(chosen)])
      const { transactions, ignored } = extract
      // Valor ou data ilegível recusa o extrato inteiro antes de procurar faturas ou
      // salvar exceções: nada é gravado.
      if (extract.errors.length) {
        return {
          matches: [],
          firstSheetHiddenRows: notices.firstSheetHiddenRows,
          ignored,
          errors: extract.errors.map((error) => ({ row: error.row, field: error.field, code: error.field === 'date' ? 'invalid_date' as const : 'invalid_number' as const, severity: 'error' as const, message: error.message })),
        }
      }
      if (!transactions.length) {
        throw new Error(`Nenhuma transação Pix encontrada no extrato${ignored ? ` (${pluralize(ignored, 'lançamento zerado ou negativo ignorado', 'lançamentos zerados ou negativos ignorados')})` : ''}. Confira se é o relatório "QR Codes recebidos" e se as linhas estão visíveis.`)
      }
      const [importKey, found] = await Promise.all([createPixImportKey(chosen), matchUnifiedPixTransactions(transactions)])
      // As linhas sem baixa segura ficam salvas já na leitura: fechar a janela não as perde.
      const persisted = await persistUnresolvedPixMatches(importKey, found)
      const idsByLine = new Map(persisted.map((item) => [item.lineNumber, item.id]))
      return {
        matches: found.map((match) => ({ ...match, exceptionId: idsByLine.get(getPixLineIdentity(match.transaction)) })),
        firstSheetHiddenRows: notices.firstSheetHiddenRows,
        ignored,
        errors: [],
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
  const lines = read && !read.errors.length ? splitExtractLines(read.matches) : null
  const readyCount = lines?.ready.length ?? 0
  const exceptionCount = lines?.exceptions.length ?? 0
  const step: ImportStep = outcome ? 'resultado' : read || readMutation.error ? 'previa' : 'arquivo'

  // Leitura ou baixa em andamento: X, Escape e Voltar não fecham, como nas
  // outras importações (fechar desmontaria a janela com a gravação seguindo sem
  // tela). Com linhas prontas ainda não baixadas, fechar pede confirmação; as
  // exceções já estão salvas e continuam na aba.
  async function requestClose() {
    if (busy) return
    if (readyCount) {
      const discard = await confirm({
        title: 'Descartar a leitura?',
        message: `${pluralize(readyCount, 'linha pronta para baixa não será baixada', 'linhas prontas para baixa não serão baixadas')}. Para baixar depois, leia o extrato de novo.`,
        consequence: exceptionCount ? 'As exceções do extrato já estão salvas e continuam na aba Pix recebidos.' : undefined,
        confirmLabel: 'Descartar leitura',
        cancelLabel: 'Continuar conferindo',
        tone: 'danger',
      })
      if (!discard) return
    }
    onClose()
  }

  let footnote: { text: string; tone: 'default' | 'warning' | 'success' } | null = null
  if (outcome) {
    footnote = outcome.exceptions
      ? { text: `${pluralize(outcome.exceptions, 'linha não entrou no lote e está', 'linhas não entraram no lote e estão')} em Exceções do extrato.`, tone: 'default' }
      : null
  } else if (read?.errors.length) {
    footnote = { text: 'Com valor ou data ilegível no extrato, nada é baixado nem salvo. Corrija e escolha o arquivo de novo.', tone: 'warning' }
  } else if (lines) {
    const base = readyCount > 1
      ? `Nada foi baixado ainda. As ${readyCount.toLocaleString('pt-BR')} baixas são gravadas juntas: se uma for recusada, nenhuma é gravada.`
      : readyCount ? 'Nada foi baixado ainda.' : 'Nada para baixar neste extrato.'
    footnote = { text: `${base}${exceptionCount ? ' As exceções já estão salvas em Exceções do extrato.' : ''}`, tone: readyCount ? 'default' : 'warning' }
  }

  return (
    <Modal open onClose={() => void requestClose()} title="Conciliar extrato Pix do Itaú">
      <div className="app-import">
        <ImportSteps current={step} />
        <ImportFileBlock templates={<ImportTemplateLinks baseName="extrato-pix-exemplo" extensions={['xlsx']} />}>
          <p>Relatório "QR Codes recebidos" (.xlsx ou .xls), para Pix que não deu baixa automática ou faturas com QR estático. A fatura é encontrada só pelo identificador do Pix; CNPJ e valor não localizam fatura.</p>
          <ImportGuide
            requiredLabel="Colunas lidas"
            required={<>Identificador do Pix e Valor pago</>}
            optional={<>CPF/CNPJ e Pago em</>}
            details={(
              <p>
                A leitura começa na linha que tem a coluna Identificador e ignora lançamentos zerados ou negativos
                (tarifas e saídas, inclusive em forma contábil, como "(10,00)" ou "10,00 D"), com a contagem na
                conferência. Valor pago ou data de pagamento ilegível impede a leitura do extrato inteiro. Linhas e abas
                ocultas ficam de fora.
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
        </ImportFileBlock>

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

        {read ? <ExtractReview read={read} /> : null}

        {confirmMutation.error ? (
          <ImportNotice tone="danger" role="alert" title="Nenhuma baixa foi gravada">
            <p>{extractErrorText(confirmMutation.error)}</p>
            <p>O lote é tudo ou nada: uma linha recusada impede as demais. Confira a linha no histórico de baixas antes de enviar de novo.</p>
          </ImportNotice>
        ) : null}

        {outcome ? <ConfirmationResult outcome={outcome} onOpenInvoice={onOpenInvoice} /> : null}

        <div className="app-modal__actions">
          {footnote ? <ImportFootnote tone={footnote.tone}>{footnote.text}</ImportFootnote> : null}
          {outcome ? (
            <>
              <Button variant="secondary" onClick={reset}>Conciliar outro extrato</Button>
              <Button onClick={onClose}>Concluir</Button>
            </>
          ) : (
            <>
              {read ? (
                <Button variant="secondary" disabled={busy} onClick={reset}>Descartar leitura</Button>
              ) : (
                <Button variant="secondary" disabled={busy} onClick={() => void requestClose()}>Voltar</Button>
              )}
              {read?.errors.length ? null : (
                <Button
                  disabled={!readyCount}
                  loading={confirmMutation.isPending}
                  loadingLabel="Baixando…"
                  onClick={() => lines && confirmMutation.mutate(lines.ready)}
                >
                  {readyCount ? `Confirmar ${pluralize(readyCount, 'baixa', 'baixas')}` : 'Confirmar baixas'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ExtractReview({ read }: { read: ReadResult }) {
  const lines = splitExtractLines(read.matches)
  const readyCount = lines.ready.length
  const exceptionCount = lines.exceptions.length
  const hidden = read.firstSheetHiddenRows

  if (read.errors.length) {
    return (
      <ImportSection title="Prévia" aside="Nada foi lido nem salvo">
        <ImportIssuesPanel issues={read.errors} filename="extrato-pix-erros.csv" />
      </ImportSection>
    )
  }

  return (
    <>
      <ImportSection title="Prévia" aside={pluralize(read.matches.length, 'linha lida', 'linhas lidas')}>
        <LeadValue detail={readyCount ? `${formatBRL(lines.readyTotal)} no lote` : 'Nenhuma linha tem uma fatura aberta com o mesmo identificador e um valor aceito.'}>
          {readyCount ? `${readyCount.toLocaleString('pt-BR')} ${readyCount === 1 ? 'pronta' : 'prontas'} para baixa` : 'Nenhuma pronta para baixa'}
        </LeadValue>
        <FactList columns={2}>
          <Fact label="Ficam como exceção">
            {exceptionCount ? <StatusText tone="warning">{exceptionCount.toLocaleString('pt-BR')}</StatusText> : 'Nenhuma'}
          </Fact>
          <Fact label="Lançamentos zerados ou negativos ignorados" detail={read.ignored ? 'Tarifas e saídas não são recebimentos: ficam fora da conciliação.' : undefined}>
            {read.ignored ? read.ignored.toLocaleString('pt-BR') : 'Nenhum'}
          </Fact>
          <Fact
            label="Linhas ocultas fora da leitura"
            detail={hidden ? 'Só as linhas visíveis entram. Reexiba as ocultas e envie de novo se elas também devem entrar.' : undefined}
          >
            {hidden ? <StatusText tone="warning">{hidden.toLocaleString('pt-BR')}</StatusText> : 'Nenhuma'}
          </Fact>
        </FactList>
      </ImportSection>

      {readyCount ? (
        <Block title={`Prontas para baixa · ${readyCount.toLocaleString('pt-BR')}`} headingLevel={3} flush>
          <ReadyLines lines={lines.ready} />
        </Block>
      ) : null}

      {exceptionCount ? (
        <Block title={`Ficam como exceção · ${exceptionCount.toLocaleString('pt-BR')}`} headingLevel={3} flush aside="Já estão salvas em Exceções do extrato">
          <ExceptionLines lines={lines.exceptions} />
        </Block>
      ) : null}
    </>
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
            const indicated = match.source !== 'unmatched' && match.docNumber ? ` · Fatura indicada: ${match.docNumber} (${formatBRL(match.amount)})` : ''
            const reason = `${extractLineReason(match)}${indicated}`
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


function ConfirmationResult({ outcome, onOpenInvoice }: { outcome: Outcome; onOpenInvoice: OpenInvoice }) {
  const { items, missing } = describeConfirmation(outcome.sent, outcome.result)
  const total = items.reduce((sum, item) => sum + (item.amount ?? 0), 0)

  return (
    <ImportSection title="Resultado">
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
    </ImportSection>
  )
}
