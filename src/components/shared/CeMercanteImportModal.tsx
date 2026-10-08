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
  importCeMercanteRows,
  parseCeMercanteFile,
  partitionRowsByVoyage,
  type CeMercanteImportResult,
  type ParsedCeMercanteFile,
  type CeMercanteImportTarget,
} from '../../services/ceMercanteImport'
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

  const validCount = preview?.rows.length ?? 0
  const sampleRows = useMemo(() => preview?.rows.slice(0, 25) ?? [], [preview?.rows])

  function resetPreviewState() {
    setPreview(null)
    setReport(null)
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
      if (result) setPreview(result)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.')
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
        manifestoNumero: target === 'bls' ? numeroManifesto.trim() : undefined,
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

  // Planilha é "tudo ou nada" (migration 082): erro de estrutura na prévia
  // bloqueia a confirmação.
  const sheetBlocked = Boolean(preview && preview.rowErrors.length > 0)
  // Cada importação de B/L é um manifesto (migration 164): o número vem antes.
  const missingManifesto = target === 'bls' && !numeroManifesto.trim()
  const canSubmit = (preview?.rows.length ?? 0) > 0 && !sheetBlocked && !missingManifesto

  const sheetReportErrors = report?.errors ?? []
  const rejectedAfterSubmit = sheetReportErrors.length > 0
  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (rejectedAfterSubmit) footnote = 'Nada foi gravado. Corrija o arquivo e escolha de novo.'
  else if (sheetBlocked) footnote = 'Há erro na prévia: nada pode ser gravado. Corrija o arquivo e escolha de novo.'
  else if (preview && missingManifesto) footnote = 'Informe o Nº de Manifesto Mercante para importar.'
  else if (preview) footnote = 'Tudo ou nada: se algum B/L falhar, nada é gravado.'
  const submitCount = preview?.rows.length ?? 0

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar CE Mercante">
      <div className="app-import">
        {target === 'bls' ? (
          <Field
            label="Nº de Manifesto Mercante"
            required
            hint="Cada importação é um manifesto: todos os B/Ls da planilha precisam ser da mesma rota (POL → POD). Para outro manifesto da mesma rota, importe outra planilha com o número dele; repetir um número já cadastrado junta os B/Ls a ele."
          >
            <Input
              required
              value={numeroManifesto}
              onChange={(e) => setNumeroManifesto(e.target.value)}
              placeholder="Ex.: 26BR000001"
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

        {submitError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{submitError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={rejectedAfterSubmit || sheetBlocked ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : resetAndClose}>
            {parsing ? 'Interromper leitura' : 'Voltar'}
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
