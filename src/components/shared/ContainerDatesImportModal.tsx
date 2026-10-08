import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterDatasContainerAlteradas } from '../../services/cacheEffects'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'
import { ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice } from './ImportParts'
import { TruncationNote } from './TruncationNote'
import { plural } from './importPresentation'
import {
  importContainerDates,
  parseContainerDatesFile,
  type ContainerDatesImportResult,
  type ContainerDatesImportRow,
  type ParsedContainerDatesImport,
} from '../../services/containerDatesImport'
import { classifyDbError } from '../../lib/errors'
import { formatDate } from '../../lib/utils'

const SAMPLE_SIZE = 25

export function ContainerDatesImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { file, preview, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedContainerDatesImport>(parseContainerDatesFile)
  const [report, setReport] = useState<ContainerDatesImportResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const sampleRows = useMemo(() => preview?.rows.slice(0, SAMPLE_SIZE) ?? [], [preview?.rows])

  async function handleFiles(files: File[]) {
    setReport(null)
    setReadError(null)
    setSubmitError(null)
    try {
      await readFile(files[0] ?? null)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.')
    }
  }

  async function handleImport() {
    if (!preview?.rows.length) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await importContainerDates(preview.rows)
      setReport(result)
      await afterDatasContainerAlteradas(queryClient)
      // Erros de estrutura vêm do parse; os de gravação vêm do lote parcial.
      // Somar os dois evita fechar o modal escondendo linhas que não entraram.
      const errors = preview.rowErrors.length + result.errors.length
      if (errors === 0) {
        showToast(`${plural(result.updated, 'container atualizado', 'containers atualizados')}.`, 'success')
        resetAndClose()
      }
    } catch (error) {
      setSubmitError(classifyDbError(error).message)
    } finally {
      setSubmitting(false)
    }
  }

  function resetAndClose() {
    cancelReading()
    setReport(null)
    setReadError(null)
    setSubmitError(null)
    onClose()
  }

  const structureErrors = preview?.rowErrors.length ?? 0
  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (report) footnote = 'Lote gravado em parte. As linhas recusadas estão acima.'
  else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (preview?.rows.length) footnote = structureErrors
    ? `${plural(preview.rows.length, 'linha válida será gravada', 'linhas válidas serão gravadas')}; ${plural(structureErrors, 'linha com erro fica', 'linhas com erro ficam')} de fora.`
    : `${plural(preview.rows.length, 'linha será gravada', 'linhas serão gravadas')}. Nada foi gravado ainda.`

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar datas de descarga e devolução">
      <div className="app-import">
        <ImportGuide
          required={<><strong>BL</strong>, <strong>Container</strong> e <strong>Discharge</strong> (data de descarga).</>}
          optional={<><strong>Return</strong> (data de devolução), que pode faltar ou ficar em branco.</>}
          details={<p>Datas em DD/MM/AAAA ou AAAA-MM-DD. Cada linha atualiza o container do B/L informado; container não encontrado é listado no resultado.</p>}
        />

        <ImportFilePicker
          accept=".xlsx,.xls,.csv"
          files={file ? [file] : []}
          onFiles={(files) => void handleFiles(files)}
          disabled={submitting || Boolean(report)}
        />

        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira o formato e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}

        {preview ? (
          <section className="app-import-section" aria-label="Prévia das datas">
            <div className="app-import-section__head">
              <h3 className="app-import-section__title">{report ? 'Resultado' : 'Prévia'}</h3>
              <SummaryStrip
                label={report ? 'Resultado da importação' : 'Resumo da planilha'}
                items={report ? [
                  { label: report.updated === 1 ? 'atualizado' : 'atualizados', value: report.updated },
                  { label: 'não encontrados', value: report.missing, tone: report.missing ? 'warning' : 'default' },
                  { label: 'recusados ao gravar', value: report.errors.length, tone: report.errors.length ? 'danger' : 'default' },
                ] : [
                  { label: preview.rows.length === 1 ? 'linha válida' : 'linhas válidas', value: preview.rows.length },
                  { label: structureErrors === 1 ? 'linha com erro' : 'linhas com erro', value: structureErrors, tone: structureErrors ? 'danger' : 'default' },
                ]}
              />
            </div>

            {report?.errors.length ? (
              <div className="app-table-scroll app-import-table">
                <table className="app-table app-table--compact w-full text-left">
                  <caption className="sr-only">Linhas recusadas ao gravar</caption>
                  <thead>
                    <tr>
                      <th scope="col">B/L</th>
                      <th scope="col">Container</th>
                      <th scope="col">Motivo da recusa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.map((row) => (
                      <tr key={`${row.bl_id}-${row.container_number}`}>
                        <td className="app-import-code">{row.bl_id}</td>
                        <td className="app-import-code">{row.container_number || '—'}</td>
                        <td className="app-import-tone--danger">{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {report ? null : (
              <>
                <div className="app-table-scroll app-import-table">
                  <table className="app-table app-table--compact w-full text-left">
                    <caption className="sr-only">Prévia das datas lidas</caption>
                    <thead>
                      <tr>
                        <th scope="col">B/L</th>
                        <th scope="col">Container</th>
                        <th scope="col">Descarga</th>
                        <th scope="col">Devolução</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleRows.map((row: ContainerDatesImportRow) => (
                        <tr key={`${row.bl_id}-${row.container_number}`}>
                          <td className="app-import-code font-semibold text-[var(--app-text-strong)]">{row.bl_id}</td>
                          <td className="app-import-code">{row.container_number}</td>
                          <td className="tabular-nums">{formatDate(row.discharge_date)}</td>
                          <td className="tabular-nums app-import-tone--muted">{row.return_date ? formatDate(row.return_date) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TruncationNote shown={sampleRows.length} total={preview.rows.length} noun="linha" />
              </>
            )}

            <ImportIssuesPanel
              issues={preview.rowErrors.map((item) => ({
                row: item.row,
                field: 'row',
                code: 'invalid_group' as const,
                severity: 'error' as const,
                message: item.message,
              }))}
              filename="container-dates-issues.csv"
              title={`${plural(structureErrors, 'linha com erro fica', 'linhas com erro ficam')} de fora`}
              hint="As demais linhas podem ser gravadas. Para incluir estas, corrija a planilha e importe de novo."
            />
          </section>
        ) : null}

        {submitError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{submitError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={report ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          {report ? (
            <Button onClick={resetAndClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : resetAndClose}>
                {parsing ? 'Interromper leitura' : 'Voltar'}
              </Button>
              <Button disabled={!preview?.rows.length || parsing} loading={submitting} loadingLabel="Importando…" onClick={() => void handleImport()}>
                {preview?.rows.length ? `Importar ${plural(preview.rows.length, 'linha', 'linhas')}` : 'Importar datas'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
