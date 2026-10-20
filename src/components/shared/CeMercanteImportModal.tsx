import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterCargaAlterada } from '../../services/cacheEffects'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import {
  ImportFileBlock,
  ImportFilePicker,
  ImportFootnote,
  ImportGuide,
  ImportNotice,
  ImportSection,
  ImportSteps,
  ImportTemplateLinks,
} from './ImportParts'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { plural } from './importPresentation'
import { TruncationNote } from './TruncationNote'
import { useAuth } from '../../hooks/useAuth'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import {
  emitCeMercanteBilling,
  importCeMercanteRows,
  parseCeMercanteFile,
  partitionRowsByVoyage,
  previewCeMercanteRows,
  type CeBillingResult,
  type CeMercanteImportResult,
  type CePreviewRow,
  type CeServerPreview,
  type ParsedCeMercanteFile,
} from '../../services/ceMercanteImport'
import { userFacingErrorMessage } from '../../lib/errors'
import { queryKeys } from '../../services/queryKeys'
import type { ImportIssue } from '../../services/importValidation'
import { ImportReadProgress } from './ImportReadProgress'
import { VoyageCombobox } from './VoyageCombobox'

export function CeMercanteImportModal({
  open,
  onClose,
  initialVoyageId,
}: {
  open: boolean
  onClose: () => void
  /**
   * Viagem de contexto (página da viagem, filtro da lista). B26 (ADR 0018,
   * decisão 2): semeia o campo Viagem, que continua editável; sem viagem, o
   * arquivo entra inteiro.
   */
  initialVoyageId?: number
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { user } = useAuth()
  const [voyageId, setVoyageId] = useState<number | null>(initialVoyageId ?? null)
  // B26: viagem atual e contador de requisição; resposta atrasada de outra viagem/arquivo é descartada.
  const voyageIdRef = useRef<number | null>(initialVoyageId ?? null)
  const previewRequestRef = useRef(0)
  const [parsedFile, setParsedFile] = useState<ParsedCeMercanteFile | null>(null)
  const { file, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedCeMercanteFile>(parseCeMercanteFile)

  async function restrictToVoyage(parsed: ParsedCeMercanteFile, selectedVoyageId: number | null): Promise<ParsedCeMercanteFile> {
    if (selectedVoyageId == null) return parsed
    const partition = await partitionRowsByVoyage(parsed.rows, selectedVoyageId)
    return {
      rows: partition.rows,
      rowErrors: [
        ...parsed.rowErrors,
        ...partition.blocked.map((item) => ({ row: item.row, message: item.message, raw: item.bl_id })),
      ],
    }
  }
  const [preview, setPreview] = useState<ParsedCeMercanteFile | null>(null)
  const [report, setReport] = useState<CeMercanteImportResult | null>(null)
  const [numeroManifesto, setNumeroManifesto] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Prévia do servidor (migration 181): antes → depois por B/L; a troca de CE
  // ou de Manifesto pede confirmação com motivo antes de gravar.
  const [serverPreview, setServerPreview] = useState<CeServerPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  // Emissão em lotes depois da gravação, com progresso e Retomar.
  const [billing, setBilling] = useState<{ total: number; results: CeBillingResult[]; remaining: string[]; error: string | null; running: boolean } | null>(null)

  const validCount = preview?.rows.length ?? 0
  const sampleRows = useMemo(() => preview?.rows.slice(0, 25) ?? [], [preview?.rows])

  function resetPreviewState() {
    setPreview(null)
    setReport(null)
    setReadError(null)
    setSubmitError(null)
    resetServerPreview()
    setBilling(null)
  }

  function resetServerPreview() {
    setServerPreview(null)
    setConfirmed(false)
    setReason('')
  }

  function resetState() {
    resetPreviewState()
    setNumeroManifesto('')
    setParsedFile(null)
    previewRequestRef.current += 1
    voyageIdRef.current = initialVoyageId ?? null
    setVoyageId(initialVoyageId ?? null)
  }

  async function handleFiles(files: File[]) {
    const nextFile = files[0] ?? null
    const request = ++previewRequestRef.current
    resetPreviewState()
    setParsedFile(null)
    try {
      const result = await readFile(nextFile)
      if (request !== previewRequestRef.current) return
      if (result) {
        setParsedFile(result)
        const restricted = await restrictToVoyage(result, voyageIdRef.current)
        if (request === previewRequestRef.current) setPreview(restricted)
      }
    } catch (error) {
      if (request === previewRequestRef.current) setReadError(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.')
    }
  }

  async function handleVoyageSelect(nextVoyageId: number | null) {
    voyageIdRef.current = nextVoyageId
    setVoyageId(nextVoyageId)
    if (!parsedFile) return
    const request = ++previewRequestRef.current
    resetPreviewState()
    try {
      const restricted = await restrictToVoyage(parsedFile, nextVoyageId)
      if (request === previewRequestRef.current) setPreview(restricted)
    } catch (error) {
      if (request === previewRequestRef.current) setReadError(error instanceof Error ? error.message : 'Não foi possível conferir a viagem dos B/Ls.')
    }
  }

  function showChangedPreview(fresh: CeServerPreview) {
    setServerPreview(fresh)
    setConfirmed(false)
    setReport(null)
    showToast('Os B/Ls mudaram depois da prévia. Confira a prévia atualizada e confirme a troca com o motivo.', 'info')
  }

  async function handleSheetImport() {
    if (!preview?.rows.length) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      let current = serverPreview
      if (!current) {
        current = await previewCeMercanteRows(preview.rows, { manifestoNumero: numeroManifesto.trim(), voyageId: voyageId ?? undefined })
        setServerPreview(current)
        // Erro do lote ou troca a confirmar: a prévia mostra e para aqui.
        if (current.errors.length || current.needs_confirmation) return
      }
      const needsConfirmation = Boolean(current?.needs_confirmation)
      if (needsConfirmation && (!confirmed || !reason.trim())) return
      // A confirmação vale para as trocas que o operador viu: a prévia é
      // refeita e, se outra gravação mudou o CE ou o Manifesto destes B/Ls, a
      // tela mostra a troca nova em vez de gravá-la com o motivo antigo.
      // ponytail: entre esta leitura e a gravação sobra uma janela curta;
      // fechá-la exige a RPC receber o CE e o Manifesto esperados por B/L.
      if (needsConfirmation && current) {
        const fresh = await previewCeMercanteRows(preview.rows, { manifestoNumero: numeroManifesto.trim(), voyageId: voyageId ?? undefined })
        if (confirmationKey(fresh) !== confirmationKey(current)) {
          showChangedPreview(fresh)
          return
        }
      }

      const result = await importCeMercanteRows(preview.rows, {
        changedBy: user?.id ?? null,
        voyageId: voyageId ?? undefined,
        manifestoNumero: numeroManifesto.trim(),
        confirmChanges: needsConfirmation,
        reason: needsConfirmation ? reason.trim() : undefined,
        deferBilling: true,
      })

      // Outra planilha gravou CE ou Manifesto destes B/Ls depois da prévia: o
      // servidor pede confirmação. A prévia é refeita e mostra a troca a
      // confirmar, em vez de repetir a recusa a cada clique (K9).
      if (result.needsConfirmation) {
        showChangedPreview(await previewCeMercanteRows(preview.rows, { manifestoNumero: numeroManifesto.trim(), voyageId: voyageId ?? undefined }))
        return
      }
      setReport(result)

      await invalidateBls()

      if ((preview.rowErrors.length ?? 0) === 0 && result.errorCount === 0) {
        // D1 (ADR 0092): B/L cancelado na planilha não é tocado; o toast conta.
        const cancelled = result.ignored
          ? `; ${plural(result.ignored, 'B/L cancelado não foi tocado', 'B/Ls cancelados não foram tocados')}`
          : ''
        showToast(`CE Mercante atualizado em ${plural(result.updated, 'B/L', 'B/Ls')}${cancelled}.`, 'success')
        if (result.billingPendingBlIds?.length) {
          await runBilling(result.billingPendingBlIds)
          return
        }
        resetAndClose()
        return
      }

      showToast(
        `Nada foi gravado: ${plural(result.errorCount, 'erro', 'erros')}. Corrija a planilha e envie de novo.`,
        'error',
      )
    } catch (error) {
      setSubmitError(userFacingErrorMessage(error, 'Falha ao importar CE Mercante.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function runBilling(blIds: string[]) {
    const previous = billing?.results ?? []
    const total = previous.length + blIds.length
    setBilling({ total, results: previous, remaining: blIds, error: null, running: true })
    try {
      const results = await emitCeMercanteBilling(blIds, (done, _total, partial) => {
        setBilling({ total, results: [...previous, ...partial], remaining: blIds.slice(done), error: null, running: true })
      })
      setBilling({ total, results: [...previous, ...results], remaining: [], error: null, running: false })
    } catch (error) {
      const done = ((error as { done?: CeBillingResult[] }).done ?? [])
      setBilling({
        total,
        results: [...previous, ...done],
        remaining: blIds.filter((id) => !done.some((item) => item.bl_id === id)),
        error: userFacingErrorMessage(error, 'A emissão parou no meio.'),
        running: false,
      })
    } finally {
      await invalidateBls()
    }
  }

  function invalidateBls() {
    return Promise.all([
      afterCargaAlterada(queryClient),
      queryClient.invalidateQueries({ queryKey: queryKeys.manifestosMercante.all() }),
    ])
  }

  function resetAndClose() {
    cancelReading()
    resetState()
    onClose()
  }

  // Gravação ou emissão em andamento: o X e o Escape não fecham. Fechar no
  // meio deixava o laço de emissão seguindo sem tela e o lote que falhasse
  // sem "Retomar emissão".
  const busy = submitting || Boolean(billing?.running)
  function requestClose() {
    if (busy) {
      showToast('Aguarde: a gravação ou a emissão das faturas ainda está em andamento.', 'info')
      return
    }
    resetAndClose()
  }

  // Planilha é "tudo ou nada" (migration 082, ADR 0092): erro na prévia
  // bloqueia a confirmação.
  const sheetBlocked = Boolean(preview && preview.rowErrors.length > 0)
  // Cada importação de B/L é um manifesto (migration 164): o número vem antes.
  const missingManifesto = !numeroManifesto.trim()
  const serverBlocked = Boolean(serverPreview?.errors.length)
  const awaitingConfirmation = Boolean(serverPreview?.needs_confirmation) && (!confirmed || !reason.trim())
  const canSubmit = (preview?.rows.length ?? 0) > 0 && !sheetBlocked && !missingManifesto && !serverBlocked && !awaitingConfirmation && !billing

  const sheetReportErrors = report?.errors ?? []
  const rejectedAfterSubmit = sheetReportErrors.length > 0
  // Erros por linha vão para o painel comum; o erro do lote, sem linha, vira
  // "Nada foi gravado: <motivo>" (nunca "Linha 0").
  const { issues, batchErrors } = useMemo(
    () => collectIssues(preview, serverPreview, report?.errors ?? []),
    [preview, serverPreview, report],
  )
  const recorded = Boolean(billing) || Boolean(report && !rejectedAfterSubmit && !report.needsConfirmation)
  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (billing) footnote = 'CE gravado. A emissão das faturas aparece acima.'
  else if (rejectedAfterSubmit) footnote = 'Nada foi gravado. Corrija o arquivo e escolha de novo.'
  else if (sheetBlocked || serverBlocked) footnote = 'Com erro no arquivo, nada é importado. Corrija o arquivo ou o Nº de Manifesto e tente de novo.'
  else if (preview && missingManifesto) footnote = 'Informe o Nº de Manifesto Mercante para importar.'
  else if (awaitingConfirmation) footnote = 'Confirme a troca de CE ou de Manifesto e informe o motivo.'
  else if (preview) footnote = 'Tudo ou nada: se algum B/L falhar, nada é gravado.'
  const submitCount = preview?.rows.length ?? 0
  const step = recorded ? 'resultado' : preview || readError ? 'previa' : 'arquivo'

  return (
    <Modal open={open} onClose={requestClose} title="Importar CE Mercante">
      <div className="app-import">
        <ImportSteps current={step} />
        <Field
          label="Nº de Manifesto Mercante"
          required
          hint="13 caracteres, letras ou dígitos (espaços e separadores são ignorados). Cada importação é um manifesto: todos os B/Ls da planilha precisam ser da mesma rota (POL → POD). Outro número para B/L já vinculado move o B/L, com confirmação e motivo."
        >
          <Input
            required
            value={numeroManifesto}
            onChange={(e) => { setNumeroManifesto(e.target.value); resetServerPreview() }}
            placeholder="Ex.: 1226501860578"
          />
        </Field>

        {initialVoyageId != null ? (
          <VoyageCombobox
            label="Viagem"
            clearable
            selectedVoyageId={voyageId == null ? null : String(voyageId)}
            onSelect={(id) => void handleVoyageSelect(id == null ? null : Number(id))}
          />
        ) : null}

        <ImportFileBlock templates={<ImportTemplateLinks baseName="ce-mercante-modelo" />}>
          <ImportGuide
            required={<><strong>BL</strong> e <strong>CE MERCANTE</strong>.</>}
            details={
              <p>
                O CE de 15 dígitos é conferido e não pode haver B/L repetido. A gravação é tudo ou nada: se algo falhar,
                nada é gravado, nem o vínculo com o manifesto. B/L cancelado na planilha não é tocado; o resto entra.
              </p>
            }
          />
          <ImportFilePicker
            accept=".xlsx,.xls,.csv"
            files={file ? [file] : []}
            onFiles={(files) => void handleFiles(files)}
            disabled={submitting || Boolean(billing)}
          />
        </ImportFileBlock>

        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira o formato e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}

        {preview ? (
          <ImportSection
            title="Prévia"
            aside={
              <SummaryStrip
                label="Resumo da planilha"
                items={[
                  { label: validCount === 1 ? 'linha válida' : 'linhas válidas', value: validCount },
                  { label: preview.rowErrors.length === 1 ? 'linha com erro' : 'linhas com erro', value: preview.rowErrors.length, tone: preview.rowErrors.length ? 'danger' : 'default' },
                  ...(report ? [{ label: 'recusados ao gravar', value: report.errorCount, tone: report.errorCount ? 'danger' as const : 'default' as const }] : []),
                ]}
              />
            }
          >
            <PreviewTable rows={sampleRows.map((row) => ({ ref: row.rowNumber, bl: row.bl_id, ce: row.ce_mercante }))} refLabel="Linha" />
            <TruncationNote shown={sampleRows.length} total={preview.rows.length} noun="linha" />
          </ImportSection>
        ) : null}

        {serverPreview ? <ServerPreviewSection preview={serverPreview} /> : null}

        {issues.length ? <ImportIssuesPanel issues={issues} filename="ce-mercante-problemas.csv" /> : null}

        {batchErrors.length ? (
          <ImportNotice
            tone="danger"
            role="alert"
            title={batchErrors.length === 1 ? `Nada foi gravado: ${batchErrors[0]}` : 'Nada foi gravado'}
          >
            {batchErrors.length > 1 ? (
              <ul className="app-import-notice__list">
                {batchErrors.map((message) => <li key={message}>{message}</li>)}
              </ul>
            ) : null}
            <p>Corrija o arquivo ou o Nº de Manifesto e tente de novo.</p>
          </ImportNotice>
        ) : null}

        {serverPreview?.needs_confirmation && !serverPreview.errors.length && !billing ? (
          <div className="app-import-section">
            <label className="app-import-override">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={submitting}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                <span className="app-import-override__title">
                  Confirmo trocar o CE de {plural(serverPreview.changes, 'B/L', 'B/Ls')} e mudar o Manifesto de {plural(serverPreview.moves, 'B/L', 'B/Ls')}
                </span>
                <span className="app-import-override__hint">A fatura emitida não muda. O motivo fica no Histórico de cada B/L.</span>
              </span>
            </label>
            <Field label="Motivo" required>
              <Textarea value={reason} disabled={submitting} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
        ) : null}

        {billing ? (
          <BillingProgress billing={billing} onResume={() => void runBilling(billing.remaining)} />
        ) : null}

        {submitError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{submitError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={rejectedAfterSubmit || sheetBlocked || serverBlocked ? 'warning' : billing ? 'success' : 'default'}>{footnote}</ImportFootnote>
          {billing ? (
            <Button disabled={busy} onClick={requestClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={parsing ? cancelReading : requestClose}>
                {parsing ? 'Interromper leitura' : 'Voltar'}
              </Button>
              <Button disabled={!canSubmit || parsing} loading={submitting} loadingLabel="Importando…" onClick={handleSheetImport}>
                {submitCount > 0 && canSubmit ? `Importar ${plural(submitCount, 'CE', 'CEs')}` : 'Importar CEs'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

type LineMessage = { row?: number; message: string }

/**
 * Erros e avisos da planilha, da conferência e da gravação no formato do painel
 * comum. Mensagem sem linha (erro do lote) fica à parte, como "Nada foi
 * gravado: <motivo>". B/L cancelado é aviso (ADR 0092, D1): não é tocado.
 */
function collectIssues(
  preview: ParsedCeMercanteFile | null,
  serverPreview: CeServerPreview | null,
  reportErrors: LineMessage[],
): { issues: ImportIssue[]; batchErrors: string[] } {
  const issues: ImportIssue[] = []
  const batchErrors: string[] = []
  const add = (items: readonly LineMessage[], severity: ImportIssue['severity']) => {
    for (const item of items) {
      if (item.row && item.row > 0) issues.push({ row: item.row, field: 'row', code: 'invalid_group', severity, message: item.message })
      else if (severity === 'error') batchErrors.push(item.message)
      else issues.push({ row: 0, field: 'row', code: 'invalid_group', severity, message: item.message })
    }
  }
  add(preview?.rowErrors ?? [], 'error')
  add(serverPreview?.errors ?? [], 'error')
  add(reportErrors, 'error')
  add(serverPreview?.warnings ?? [], 'warning')
  add(
    (serverPreview?.rows ?? [])
      .filter((row) => row.status === 'cancelled')
      .map((row) => ({ row: row.row, message: `B/L ${row.bl_id} está cancelado: não é tocado, e o resto da planilha entra.` })),
    'warning',
  )
  return { issues, batchErrors }
}

function PreviewTable({
  rows,
  refLabel,
}: {
  rows: Array<{ ref: number; bl: string; ce: string }>
  refLabel: string
}) {
  return (
    <div className="app-table-scroll app-import-table">
      <table className="app-table app-table--compact w-full">
        <caption className="sr-only">Linhas lidas da planilha</caption>
        <thead>
          <tr>
            <th scope="col" className="app-import-num">{refLabel}</th>
            <th scope="col">B/L</th>
            <th scope="col">CE Mercante</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.ref}-${row.bl}`}>
              <td className="app-import-num">{row.ref}</td>
              <td className="app-import-code">{row.bl}</td>
              <td className="app-import-code">{row.ce}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** As trocas que a confirmação cobre: B/L, CE e Manifesto antes → depois. */
function confirmationKey(preview: CeServerPreview): string {
  return preview.rows
    .filter((row) => row.status === 'change' || row.manifesto_change)
    .map((row) => [row.bl_id, row.current_ce ?? '', row.new_ce ?? '', row.current_manifesto ?? '', row.target_manifesto ?? ''].join('|'))
    .sort()
    .join('\n')
}

/** Situação em texto (regra 5): âmbar quando pede atenção. */
const STATUS_LABEL: Record<CePreviewRow['status'], string> = {
  new: 'Grava o CE',
  same: 'Sem mudança',
  change: 'Troca o CE',
  cancelled: 'Cancelado, não é tocado',
}

function statusNote(row: CePreviewRow): string {
  return [
    STATUS_LABEL[row.status] ?? row.status,
    row.live_invoices?.length ? `fatura ${row.live_invoices.join(', ')} não muda` : null,
    row.status === 'change' && row.comunicado_sent ? 'Comunicado será reenviado' : null,
    row.status === 'change' && row.unlock_confirmed ? 'Desbloqueio já conferido' : null,
  ].filter(Boolean).join(' · ')
}

function ServerPreviewSection({ preview }: { preview: CeServerPreview }) {
  const rows = preview.rows.slice(0, 50)
  return (
    <ImportSection
      title="Conferência com o que já está gravado"
      aside={
        <SummaryStrip
          label="Resumo da conferência"
          items={[
            { label: 'trocas de CE', value: preview.changes, tone: preview.changes ? 'warning' : 'default' },
            { label: 'mudanças de Manifesto', value: preview.moves, tone: preview.moves ? 'warning' : 'default' },
            { label: 'erros', value: preview.errors.length, tone: preview.errors.length ? 'danger' : 'default' },
          ]}
        />
      }
    >
      <div className="app-table-scroll app-import-table">
        <table className="app-table app-table--compact w-full">
          <caption className="sr-only">B/Ls antes e depois da importação</caption>
          <thead>
            <tr>
              <th scope="col">B/L</th>
              <th scope="col">CE (antes → depois)</th>
              <th scope="col">Manifesto (antes → depois)</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.row}-${row.bl_id}`}>
                <td className="app-import-code">{row.bl_id}</td>
                <td className="app-import-code">
                  {row.status === 'change' ? `${row.current_ce} → ${row.new_ce}` : row.new_ce ?? <NoValue label="Sem CE Mercante" />}
                </td>
                <td className="app-import-code">
                  {row.manifesto_change ? `${row.current_manifesto} → ${row.target_manifesto}` : row.target_manifesto ?? <NoValue label="Sem Manifesto Mercante" />}
                </td>
                <td className={row.status === 'change' || row.status === 'cancelled' || row.manifesto_change ? 'app-import-tone--warning' : undefined}>
                  {statusNote(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationNote shown={rows.length} total={preview.rows.length} noun="B/L" />
    </ImportSection>
  )
}

// Frase da tela quando o servidor não manda `message`: o código cru não aparece.
const BILLING_REASON_LABEL: Record<string, string> = {
  customer_reconciliation_pending: 'Aguardando conciliação do Cliente.',
  review_pending: 'Aguardando Revisão do B/L.',
  charge_table_missing: 'Aguardando tabela de cobrança do POD.',
  nothing_to_bill: 'Nada a faturar: o cálculo do B/L não tem taxa com valor.',
  exempt: 'Nada a faturar: B/L isento das Taxas Locais.',
  not_found: 'B/L não encontrado.',
  auto_billing_failed: 'A emissão automática falhou; o Alerta de faturamento traz o detalhe.',
}

function billingResultMessage(item: Pick<CeBillingResult, 'message' | 'reason'>): string {
  const message = item.message?.trim()
  if (message) return message
  return (item.reason && BILLING_REASON_LABEL[item.reason]) || 'Motivo não informado pelo servidor.'
}

function BillingProgress({
  billing,
  onResume,
}: {
  billing: { total: number; results: CeBillingResult[]; remaining: string[]; error: string | null; running: boolean }
  onResume: () => void
}) {
  const count = (status: CeBillingResult['status']) => billing.results.filter((item) => item.status === status).length
  // Espera de negócio (Cliente, Revisão) não é falha: aparece à parte (K1).
  const waiting = billing.results.filter((item) => item.status === 'blocked' && item.waiting)
  const blocked = billing.results.filter((item) => item.status === 'blocked' && !item.waiting)
  // B/L calculado sem taxa com valor ou isento: não há fatura a emitir, nem falha (migration 204).
  const nothingToBill = billing.results.filter((item) => item.status === 'skipped' && (item.reason === 'nothing_to_bill' || item.reason === 'exempt'))
  return (
    <ImportSection
      title="Resultado: emissão das faturas"
      aside={
        <SummaryStrip
          label="Resultado da emissão"
          items={[
            { label: 'processados', value: `${billing.results.length} de ${billing.total}` },
            { label: 'faturados', value: count('invoiced') },
            { label: 'retidos', value: count('held') },
            { label: 'aguardando', value: waiting.length, tone: waiting.length ? 'warning' : 'default' },
            { label: 'nada a faturar', value: nothingToBill.length },
            { label: 'bloqueados', value: blocked.length, tone: blocked.length ? 'danger' : 'default' },
          ]}
        />
      }
    >
      {billing.running ? <p role="status">Emitindo as faturas em lotes. Não feche esta janela.</p> : null}
      {waiting.length ? (
        <ImportNotice tone="warning" title="Aguardando">
          <ul className="app-import-notice__list">
            {waiting.map((item) => <li key={item.bl_id}>{item.bl_id}: {billingResultMessage(item)}</li>)}
          </ul>
        </ImportNotice>
      ) : null}
      {nothingToBill.length ? (
        <ImportNotice tone="info" title="Nada a faturar">
          <ul className="app-import-notice__list">
            {nothingToBill.map((item) => <li key={item.bl_id}>{item.bl_id}: {billingResultMessage(item)}</li>)}
          </ul>
        </ImportNotice>
      ) : null}
      {blocked.length ? (
        <ImportNotice tone="danger" title="Bloqueados">
          <ul className="app-import-notice__list">
            {blocked.map((item) => <li key={item.bl_id}>{item.bl_id}: {billingResultMessage(item)}</li>)}
          </ul>
        </ImportNotice>
      ) : null}
      {billing.error ? (
        <ImportNotice tone="danger" role="alert" title="A emissão parou">
          <p>{billing.error}</p>
          <p>O CE já foi gravado. Retome para emitir os {plural(billing.remaining.length, 'B/L que falta', 'B/Ls que faltam')}.</p>
          <Button variant="secondary" onClick={onResume}>Retomar emissão</Button>
        </ImportNotice>
      ) : null}
    </ImportSection>
  )
}
