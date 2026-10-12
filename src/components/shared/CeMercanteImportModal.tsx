import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterCargaAlterada } from '../../services/cacheEffects'
import { Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice, ImportTemplateLinks } from './ImportParts'
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
  type CeServerPreview,
  type ParsedCeMercanteFile,
  type CeMercanteImportTarget,
} from '../../services/ceMercanteImport'
import { userFacingErrorMessage } from '../../lib/errors'
import { queryKeys } from '../../services/queryKeys'
import { ImportReadProgress } from './ImportReadProgress'

export function CeMercanteImportModal({
  open,
  onClose,
  lockedVoyageId,
  target = 'bls',
}: {
  open: boolean
  onClose: () => void
  lockedVoyageId?: number
  target?: CeMercanteImportTarget
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { user } = useAuth()
  const { file, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedCeMercanteFile>(async (nextFile) => {
    const parsed = await parseCeMercanteFile(nextFile)
    if (lockedVoyageId == null) return parsed
    const partition = target === 'bls'
      ? await partitionRowsByVoyage(parsed.rows, lockedVoyageId)
      : await partitionRowsByVoyage(parsed.rows, lockedVoyageId, target)
    return {
      rows: partition.rows,
      rowErrors: [
        ...parsed.rowErrors,
        ...partition.blocked.map((item) => ({ row: item.row, message: item.message, raw: item.bl_id })),
      ],
    }
  })
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
  }

  async function handleFiles(files: File[]) {
    const nextFile = files[0] ?? null
    resetPreviewState()
    try {
      const result = await readFile(nextFile)
      if (result) setPreview(result)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.')
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
      if (target === 'bls' && !current) {
        current = await previewCeMercanteRows(preview.rows, { manifestoNumero: numeroManifesto.trim(), voyageId: lockedVoyageId })
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
      if (target === 'bls' && needsConfirmation && current) {
        const fresh = await previewCeMercanteRows(preview.rows, { manifestoNumero: numeroManifesto.trim(), voyageId: lockedVoyageId })
        if (confirmationKey(fresh) !== confirmationKey(current)) {
          showChangedPreview(fresh)
          return
        }
      }

      const result = await importCeMercanteRows(preview.rows, {
        changedBy: user?.id ?? null,
        target,
        voyageId: lockedVoyageId,
        manifestoNumero: target === 'bls' ? numeroManifesto.trim() : undefined,
        confirmChanges: needsConfirmation,
        reason: needsConfirmation ? reason.trim() : undefined,
        deferBilling: target === 'bls',
      })

      // Outra planilha gravou CE ou Manifesto destes B/Ls depois da prévia: o
      // servidor pede confirmação. A prévia é refeita e mostra a troca a
      // confirmar, em vez de repetir a recusa a cada clique (K9).
      if (target === 'bls' && result.needsConfirmation) {
        showChangedPreview(await previewCeMercanteRows(preview.rows, { manifestoNumero: numeroManifesto.trim(), voyageId: lockedVoyageId }))
        return
      }
      setReport(result)

      await invalidateBls()

      if ((preview.rowErrors.length ?? 0) === 0 && result.errorCount === 0) {
        showToast(`CE Mercante atualizado em ${result.updated} B/L(s).`, 'success')
        if (result.billingPendingBlIds?.length) {
          await runBilling(result.billingPendingBlIds)
          return
        }
        resetAndClose()
        return
      }

      showToast(
        `Nada foi gravado: ${result.errorCount} erro(s). Corrija a planilha e envie de novo.`,
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
    const invalidations = [
      afterCargaAlterada(queryClient),
      queryClient.invalidateQueries({ queryKey: queryKeys.manifestosMercante.all() }),
    ]
    if (target === 'granite') {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['charges'] }),
      )
    }
    return Promise.all(invalidations)
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

  // Planilha é "tudo ou nada" (migration 082): erro de estrutura na prévia
  // bloqueia a confirmação.
  const sheetBlocked = Boolean(preview && preview.rowErrors.length > 0)
  // Cada importação de B/L é um manifesto (migration 164): o número vem antes.
  const missingManifesto = target === 'bls' && !numeroManifesto.trim()
  const serverBlocked = Boolean(serverPreview?.errors.length)
  const awaitingConfirmation = Boolean(serverPreview?.needs_confirmation) && (!confirmed || !reason.trim())
  const canSubmit = (preview?.rows.length ?? 0) > 0 && !sheetBlocked && !missingManifesto && !serverBlocked && !awaitingConfirmation && !billing

  const sheetReportErrors = report?.errors ?? []
  const rejectedAfterSubmit = sheetReportErrors.length > 0
  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (rejectedAfterSubmit) footnote = 'Nada foi gravado. Corrija o arquivo e escolha de novo.'
  else if (sheetBlocked) footnote = 'Há erro na prévia: nada pode ser gravado. Corrija o arquivo e escolha de novo.'
  else if (preview && missingManifesto) footnote = 'Informe o Nº de Manifesto Mercante para importar.'
  else if (serverBlocked) footnote = 'O servidor recusou o lote: nada foi gravado. Corrija o arquivo ou o Nº de Manifesto.'
  else if (awaitingConfirmation) footnote = 'Confirme a troca de CE ou de Manifesto e informe o motivo.'
  else if (preview) footnote = 'Tudo ou nada: se algum B/L falhar, nada é gravado.'
  const submitCount = preview?.rows.length ?? 0

  return (
    <Modal open={open} onClose={requestClose} title="Importar CE Mercante">
      <div className="app-import">
        {target === 'bls' ? (
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
        ) : null}

        <ImportGuide
          requiredLabel="Formato"
          required={<>planilha com as colunas <strong>BL</strong> e <strong>CE MERCANTE</strong>.</>}
          details={
            <p>
              O CE de 15 dígitos é conferido e não pode haver B/L repetido. A gravação é tudo ou nada: se algo falhar,
              nada é gravado, nem o vínculo com o manifesto.
            </p>
          }
          templates={<ImportTemplateLinks baseName="ce-mercante-modelo" />}
        />

        <ImportFilePicker
          accept=".xlsx,.xls,.csv"
          files={file ? [file] : []}
          onFiles={(files) => void handleFiles(files)}
          disabled={submitting}
        />

        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira o formato e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}

        {preview ? (
          <section className="app-import-section" aria-label="Prévia da planilha">
            <div className="app-import-section__head">
              <h3 className="app-import-section__title">Prévia</h3>
              <SummaryStrip
                label="Resumo da planilha"
                items={[
                  { label: validCount === 1 ? 'linha válida' : 'linhas válidas', value: validCount },
                  { label: preview.rowErrors.length === 1 ? 'erro de estrutura' : 'erros de estrutura', value: preview.rowErrors.length, tone: preview.rowErrors.length ? 'danger' : 'default' },
                  ...(report ? [{ label: 'recusados ao gravar', value: report.errorCount, tone: report.errorCount ? 'danger' as const : 'default' as const }] : []),
                ]}
              />
            </div>

            <PreviewTable rows={sampleRows.map((row) => ({ ref: row.rowNumber, bl: row.bl_id, ce: row.ce_mercante }))} refLabel="Linha" />
            <TruncationNote shown={sampleRows.length} total={preview.rows.length} noun="linha" />

            {preview.rowErrors.length || sheetReportErrors.length ? (
              <ImportNotice
                tone="danger"
                role="alert"
                title={sheetReportErrors.length ? 'Nada foi gravado' : 'Corrija antes de importar'}
              >
                <ul className="app-import-notice__list">
                  {preview.rowErrors.map((item, index) => (
                    <li key={`preview-${item.row}-${index}`}>{lineLabel(item.row)}{item.message}</li>
                  ))}
                  {sheetReportErrors.map((item, index) => (
                    <li key={`report-${item.row}-${item.bl_id ?? 'sem-bl'}-${index}`}>
                      {lineLabel(item.row)}{item.message}
                    </li>
                  ))}
                </ul>
                <p>Corrija a planilha e escolha o arquivo de novo.</p>
              </ImportNotice>
            ) : null}
          </section>
        ) : null}

        {serverPreview ? (
          <ServerPreviewSection
            preview={serverPreview}
            confirmed={confirmed}
            reason={reason}
            onConfirmedChange={setConfirmed}
            onReasonChange={setReason}
            disabled={submitting || Boolean(billing)}
          />
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
          <ImportFootnote tone={rejectedAfterSubmit || sheetBlocked ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          <Button variant="secondary" disabled={busy} onClick={parsing ? cancelReading : requestClose}>
            {parsing ? 'Interromper leitura' : billing ? 'Fechar' : 'Voltar'}
          </Button>
          <Button disabled={!canSubmit || parsing} loading={submitting} loadingLabel="Importando…" onClick={handleSheetImport}>
            <Upload size={16} aria-hidden="true" />
            {submitCount > 0 && canSubmit ? `Importar ${plural(submitCount, 'CE', 'CEs')}` : 'Importar CEs'}
          </Button>
        </div>
      </div>
    </Modal>
  )
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
      <table className="app-table app-table--compact w-full text-left">
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
              <td className="app-import-code font-semibold text-[var(--app-text-strong)]">{row.bl}</td>
              <td className="app-import-code">{row.ce}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Erro do lote, sem linha, não vira "Linha 0" (etapa 8.2).
/** As trocas que a confirmação cobre: B/L, CE e Manifesto antes → depois. */
function confirmationKey(preview: CeServerPreview): string {
  return preview.rows
    .filter((row) => row.status === 'change' || row.manifesto_change)
    .map((row) => [row.bl_id, row.current_ce ?? '', row.new_ce ?? '', row.current_manifesto ?? '', row.target_manifesto ?? ''].join('|'))
    .sort()
    .join('\n')
}

function lineLabel(row: number | undefined): string {
  return row && row > 0 ? `Linha ${row}: ` : ''
}

const STATUS_LABEL: Record<string, string> = {
  new: 'CE novo',
  same: 'Sem mudança',
  change: 'Troca de CE',
  cancelled: 'Cancelado — ignorado',
}

function ServerPreviewSection({
  preview,
  confirmed,
  reason,
  onConfirmedChange,
  onReasonChange,
  disabled,
}: {
  preview: CeServerPreview
  confirmed: boolean
  reason: string
  onConfirmedChange: (value: boolean) => void
  onReasonChange: (value: string) => void
  disabled: boolean
}) {
  const rows = preview.rows.slice(0, 50)
  return (
    <section className="app-import-section" aria-label="Conferência no servidor">
      <div className="app-import-section__head">
        <h3 className="app-import-section__title">Conferência no servidor</h3>
        <SummaryStrip
          label="Resumo da conferência"
          items={[
            { label: 'trocas de CE', value: preview.changes, tone: preview.changes ? 'warning' : 'default' },
            { label: 'mudanças de Manifesto', value: preview.moves, tone: preview.moves ? 'warning' : 'default' },
            { label: 'erros', value: preview.errors.length, tone: preview.errors.length ? 'danger' : 'default' },
          ]}
        />
      </div>
      <div className="app-table-scroll app-import-table">
        <table className="app-table app-table--compact w-full text-left">
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
                <td className="app-import-code font-semibold text-[var(--app-text-strong)]">{row.bl_id}</td>
                <td className="app-import-code">
                  {row.status === 'change' ? `${row.current_ce} → ${row.new_ce}` : row.new_ce ?? '—'}
                </td>
                <td className="app-import-code">
                  {row.manifesto_change ? `${row.current_manifesto} → ${row.target_manifesto}` : row.target_manifesto ?? '—'}
                </td>
                <td>
                  {STATUS_LABEL[row.status] ?? row.status}
                  {row.live_invoices?.length ? ` · fatura ${row.live_invoices.join(', ')} (não muda)` : ''}
                  {row.status === 'change' && row.comunicado_sent ? ' · Comunicado será reenviado' : ''}
                  {row.status === 'change' && row.unlock_confirmed ? ' · Desbloqueio já conferido' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationNote shown={rows.length} total={preview.rows.length} noun="B/L" />

      {preview.warnings.length ? (
        <ImportNotice tone="warning" title="Avisos">
          <ul className="app-import-notice__list">
            {preview.warnings.map((item, index) => <li key={`warn-${index}`}>{lineLabel(item.row)}{item.message}</li>)}
          </ul>
        </ImportNotice>
      ) : null}

      {preview.errors.length ? (
        <ImportNotice tone="danger" role="alert" title="O servidor recusou o lote">
          <ul className="app-import-notice__list">
            {preview.errors.map((item, index) => <li key={`err-${index}`}>{lineLabel(item.row)}{item.message}</li>)}
          </ul>
        </ImportNotice>
      ) : null}

      {preview.needs_confirmation && !preview.errors.length ? (
        <ImportNotice tone="warning" title="Confirme a troca">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} disabled={disabled} onChange={(event) => onConfirmedChange(event.target.checked)} />
            <span>
              Confirmo trocar o CE de {plural(preview.changes, 'B/L', 'B/Ls')} e mudar o Manifesto de {plural(preview.moves, 'B/L', 'B/Ls')}.
              A fatura emitida não muda.
            </span>
          </label>
          <Field label="Motivo" required>
            <Textarea value={reason} disabled={disabled} onChange={(event) => onReasonChange(event.target.value)} />
          </Field>
        </ImportNotice>
      ) : null}
    </section>
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
    <section className="app-import-section" aria-label="Emissão das faturas">
      <div className="app-import-section__head">
        <h3 className="app-import-section__title">Emissão das faturas</h3>
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
      </div>
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
    </section>
  )
}
