import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterCargaAlterada } from '../../services/cacheEffects'
import { Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice, ImportTemplateLinks } from './ImportParts'
import { plural } from './importPresentation'
import { TruncationNote } from './TruncationNote'
import { useAuth } from '../../hooks/useAuth'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import {
  importCeMercanteEdi,
  importCeMercanteRows,
  parseCeMercanteFile,
  partitionRowsByVoyage,
  type CeMercanteEdiImportResult,
  type CeMercanteImportResult,
  type ParsedCeMercanteFile,
  type CeMercanteImportTarget,
} from '../../services/ceMercanteImport'
import {
  parseCeMercanteEdiFile,
  type ParsedCeMercanteEdi,
} from '../../services/ceMercanteEdiParser'
import { queryKeys } from '../../services/queryKeys'
import { ImportReadProgress } from './ImportReadProgress'

const SHEET_EXTENSIONS = /\.(xlsx|xls|csv)$/i

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
  const { file, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<
    { kind: 'sheet'; preview: ParsedCeMercanteFile } | { kind: 'edi'; preview: ParsedCeMercanteEdi }
  >(async (nextFile) => {
    if (SHEET_EXTENSIONS.test(nextFile.name)) {
      const parsed = await parseCeMercanteFile(nextFile)
      if (lockedVoyageId == null) return { kind: 'sheet', preview: parsed }
      const partition = target === 'bls'
        ? await partitionRowsByVoyage(parsed.rows, lockedVoyageId)
        : await partitionRowsByVoyage(parsed.rows, lockedVoyageId, target)
      return {
        kind: 'sheet',
        preview: {
          rows: partition.rows,
          rowErrors: [
            ...parsed.rowErrors,
            ...partition.blocked.map((item) => ({ row: item.row, message: item.message, raw: item.bl_id })),
          ],
        },
      }
    }

    const parsed = await parseCeMercanteEdiFile(nextFile)
    if (lockedVoyageId == null) return { kind: 'edi', preview: parsed }
    const partition = target === 'bls'
      ? await partitionRowsByVoyage(parsed.rows, lockedVoyageId)
      : await partitionRowsByVoyage(parsed.rows, lockedVoyageId, target)
    return {
      kind: 'edi',
      preview: {
        ...parsed,
        rows: partition.rows,
        rowErrors: [
          ...parsed.rowErrors,
          ...partition.blocked.map((item) => ({ line: item.row, message: item.message, raw: item.bl_id })),
        ],
      },
    }
  })
  const [preview, setPreview] = useState<ParsedCeMercanteFile | null>(null)
  const [report, setReport] = useState<CeMercanteImportResult | null>(null)
  const [ediPreview, setEdiPreview] = useState<ParsedCeMercanteEdi | null>(null)
  const [ediErrors, setEdiErrors] = useState<CeMercanteEdiImportResult | null>(null)
  const [numeroManifesto, setNumeroManifesto] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const validCount = preview?.rows.length ?? 0
  const sampleRows = useMemo(() => preview?.rows.slice(0, 25) ?? [], [preview?.rows])
  const ediSampleRows = useMemo(() => ediPreview?.rows.slice(0, 25) ?? [], [ediPreview?.rows])
  const ediReportErrors = ediErrors && !ediErrors.ok ? ediErrors.errors : []

  function resetPreviewState() {
    setPreview(null)
    setReport(null)
    setEdiPreview(null)
    setEdiErrors(null)
    setReadError(null)
    setSubmitError(null)
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
      if (!result) return
      if (result.kind === 'sheet') setPreview(result.preview)
      else setEdiPreview(result.preview)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.')
    }
  }

  async function handleImport() {
    if (preview) {
      await handleSheetImport()
      return
    }
    if (ediPreview) {
      await handleEdiImport()
    }
  }

  async function handleSheetImport() {
    if (!preview?.rows.length) return

    setSubmitting(true)
    try {
      const result = await importCeMercanteRows(preview.rows, {
        changedBy: user?.id ?? null,
        target,
        voyageId: lockedVoyageId,
        manifestoNumero: target === 'bls' ? numeroManifesto.trim() || undefined : undefined,
      })
      setReport(result)

      await invalidateBls()

      if ((preview.rowErrors.length ?? 0) === 0 && result.errorCount === 0) {
        showToast(`CE Mercante atualizado em ${result.updated} B/L(s).`, 'success')
        resetAndClose()
        return
      }

      showToast(
        `Nada foi gravado: ${result.errorCount} erro(s). Corrija a planilha e envie de novo.`,
        'error',
      )
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Falha ao importar CE Mercante.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEdiImport() {
    if (!ediPreview?.rows.length) return

    setSubmitting(true)
    setEdiErrors(null)
    try {
      if (target === 'granite') {
        const result = await importCeMercanteRows(
          ediPreview.rows.map((row) => ({
            rowNumber: row.lineNumber,
            bl_id: row.bl_id,
            ce_mercante: row.ce_mercante,
          })),
          {
            changedBy: user?.id ?? null,
            target,
            voyageId: lockedVoyageId,
            manifestoNumero: undefined,
          },
        )
        if (result.errorCount > 0) {
          setEdiErrors({
            ok: false,
            errors: result.errors.map((error) => ({ bl_id: error.bl_id, ce: undefined, message: error.message })),
          })
          await invalidateBls()
          showToast(`Nada foi gravado: ${result.errorCount} pendência(s). Corrija o arquivo e envie de novo.`, 'error')
          return
        }
        await invalidateBls()
        showToast(`CE Mercante cadastrado em ${result.updated} B/L(s) de Granito.`, 'success')
        resetAndClose()
        return
      }

      const result = await importCeMercanteEdi(ediPreview.rows, {
        changedBy: user?.id ?? null,
        manifestoNumero: numeroManifesto.trim() || undefined,
        voyageId: lockedVoyageId,
      })

      if (result.ok) {
        await invalidateBls()
        showToast(
          `CE Mercante cadastrado em ${result.inserted + result.overwritten} B/L(s) do manifesto.`,
          'success',
        )
        resetAndClose()
        return
      }

      setEdiErrors(result)
      showToast(
        result.partial
          ? `CE Mercante gravado, mas o manifesto não foi vinculado: ${result.errors.length} pendência(s).`
          : `Importação bloqueada: ${result.errors.length} pendência(s). Nada foi gravado.`,
        'error',
      )
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Falha ao importar CE Mercante (EDI).')
    } finally {
      setSubmitting(false)
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

  const ediBlocked = Boolean(ediPreview && ediPreview.rowErrors.length > 0)
  // Planilha também é "tudo ou nada" (migration 082): erro de estrutura na
  // prévia bloqueia a confirmação, como no EDI.
  const sheetBlocked = Boolean(preview && preview.rowErrors.length > 0)
  const canSubmit = ((preview?.rows.length ?? 0) > 0 && !sheetBlocked) || ((ediPreview?.rows.length ?? 0) > 0 && !ediBlocked)

  const sheetReportErrors = report?.errors ?? []
  const ediPartial = Boolean(ediErrors && !ediErrors.ok && ediErrors.partial)
  const rejectedAfterSubmit = sheetReportErrors.length > 0 || ediReportErrors.length > 0
  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (ediPartial) footnote = 'CE gravado; o manifesto ficou sem vínculo. Veja as pendências.'
  else if (rejectedAfterSubmit) footnote = 'Nada foi gravado. Corrija o arquivo e escolha de novo.'
  else if (sheetBlocked || ediBlocked) footnote = 'Há erro na prévia: nada pode ser gravado. Corrija o arquivo e escolha de novo.'
  else if (preview || ediPreview) footnote = 'Tudo ou nada: se algum B/L falhar, nada é gravado.'
  const submitCount = preview?.rows.length ?? ediPreview?.rows.length ?? 0

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar CE Mercante">
      <div className="app-import">
        {target === 'bls' ? (
          <Field label="Nº de Manifesto Mercante (opcional)" hint="Vincula os B/Ls importados ao manifesto de carga da viagem. Não é o CE de cada B/L.">
            <Input
              value={numeroManifesto}
              onChange={(e) => setNumeroManifesto(e.target.value)}
              placeholder="Ex.: 26BR000001"
            />
          </Field>
        ) : null}

        <ImportGuide
          requiredLabel="Formato"
          required={<>planilha com as colunas <strong>BL</strong> e <strong>CE MERCANTE</strong>, ou o EDI do manifesto Mercante.</>}
          details={
            <p>
              No EDI o sistema lê os registros C (CE ↔ B/L), confere que todos os B/Ls do manifesto têm CE e que não
              há CE ou B/L repetido. Planilha ou EDI, a gravação é tudo ou nada: se algo falhar, nada é gravado.
            </p>
          }
          templates={<ImportTemplateLinks baseName="ce-mercante-modelo" />}
        />

        <ImportFilePicker
          accept=".xlsx,.xls,.csv,.edi,.txt"
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
                    <li key={`preview-${item.row}-${index}`}>Linha {item.row}: {item.message}</li>
                  ))}
                  {sheetReportErrors.map((item, index) => (
                    <li key={`report-${item.row}-${item.bl_id ?? 'sem-bl'}-${index}`}>
                      Linha {item.row}: {item.message}
                    </li>
                  ))}
                </ul>
                <p>Corrija a planilha e escolha o arquivo de novo.</p>
              </ImportNotice>
            ) : null}
          </section>
        ) : null}

        {ediPreview ? (
          <section className="app-import-section" aria-label="Prévia do EDI">
            <div className="app-import-section__head">
              <h3 className="app-import-section__title">Prévia</h3>
              <SummaryStrip
                label="Resumo do EDI"
                items={[
                  { label: ediPreview.rows.length === 1 ? 'registro CE ↔ B/L' : 'registros CE ↔ B/L', value: ediPreview.rows.length },
                  { label: ediPreview.rowErrors.length === 1 ? 'erro de estrutura' : 'erros de estrutura', value: ediPreview.rowErrors.length, tone: ediPreview.rowErrors.length ? 'danger' : 'default' },
                  ...(ediErrors ? [{ label: 'pendências de validação', value: ediReportErrors.length, tone: ediReportErrors.length ? 'danger' as const : 'default' as const }] : []),
                ]}
              />
            </div>

            {ediPreview.encoding ? (
              <p className="app-import-inspection__line app-import-inspection">
                <span>Encoding detectado: <strong>{ediPreview.encoding}</strong></span>
              </p>
            ) : null}

            <PreviewTable rows={ediSampleRows.map((row) => ({ ref: row.lineNumber, bl: row.bl_id, ce: row.ce_mercante }))} refLabel="Linha EDI" />
            <TruncationNote shown={ediSampleRows.length} total={ediPreview.rows.length} noun="registro" />

            {ediPreview.rowErrors.length || ediReportErrors.length ? (
              <ImportNotice
                tone={ediPartial ? 'warning' : 'danger'}
                role="alert"
                title={ediPartial ? 'CE gravado; o manifesto não foi vinculado' : ediReportErrors.length ? 'Nada foi gravado' : 'Corrija antes de importar'}
              >
                <ul className="app-import-notice__list">
                  {ediPreview.rowErrors.map((item, index) => (
                    <li key={`edi-parse-${item.line}-${index}`}>Linha {item.line}: {item.message}</li>
                  ))}
                  {ediReportErrors.map((item, index) => (
                    <li key={`edi-report-${item.bl_id ?? item.ce ?? 'geral'}-${index}`}>{item.message}</li>
                  ))}
                </ul>
              </ImportNotice>
            ) : null}
          </section>
        ) : null}

        {submitError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{submitError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={rejectedAfterSubmit || ediPartial || sheetBlocked || ediBlocked ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : resetAndClose}>
            {parsing ? 'Interromper leitura' : 'Voltar'}
          </Button>
          <Button disabled={!canSubmit || parsing} loading={submitting} loadingLabel="Importando…" onClick={handleImport}>
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
