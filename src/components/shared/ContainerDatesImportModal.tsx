import { useMemo, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { PreviewBox } from '../ui/PreviewBox'
import { useToast } from '../ui/Toast'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'
import {
  importContainerDates,
  parseContainerDatesFile,
  type ContainerDatesImportResult,
  type ContainerDatesImportRow,
  type ParsedContainerDatesImport,
} from '../../services/containerDatesImport'
import { classifyDbError } from '../../lib/errors'

export function ContainerDatesImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { file, preview, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedContainerDatesImport>(parseContainerDatesFile)
  const [report, setReport] = useState<ContainerDatesImportResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const sampleRows = useMemo(() => preview?.rows.slice(0, 25) ?? [], [preview?.rows])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setReport(null)
    try {
      await readFile(nextFile)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.', 'error')
    }
  }

  async function handleImport() {
    if (!preview?.rows.length) return
    setSubmitting(true)
    try {
      const result = await importContainerDates(preview.rows)
      setReport(result)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['demurrage-containers'] }),
        queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      ])
      // Erros de estrutura vem do parse; os de gravacao vem do lote parcial.
      // Somar os dois evita fechar o modal escondendo linhas que nao entraram.
      const errors = preview.rowErrors.length + result.errors.length
      if (errors === 0) {
        showToast(`${result.updated} container(s) atualizado(s).`, 'success')
        resetAndClose()
        return
      }
      showToast(`${result.updated} atualizacao(oes) e ${errors} erro(s).`, 'info')
    } catch (error) {
      showToast(`Falha ao importar datas. Motivo: ${classifyDbError(error).message}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function resetAndClose() {
    cancelReading()
    setReport(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar Datas de Descarga e Devolução">
      <div className="grid gap-5">
        <div className="app-panel app-panel--padded text-sm">
          <div className="app-panel__title">Estrutura obrigatoria da planilha</div>
          <div className="mt-2">BL, Container, Discharge (data descarga), Return (data devolucao — opcional).</div>
          <div className="app-panel__meta mt-2">
            Formatos de data aceitos: DD/MM/AAAA ou AAAA-MM-DD. A coluna Return pode ser omitida ou deixada em branco.
          </div>
        </div>

        <Field label="Arquivo .xlsx, .xls ou .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
        </Field>

        {file ? <div className="app-panel__meta">Arquivo: {file.name}</div> : null}
        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {preview ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <PreviewBox label="Linhas validas" value={preview.rows.length} variant="metric-centered" />
              <PreviewBox label="Erros de estrutura" value={preview.rowErrors.length} variant="metric-centered" />
              {report ? <PreviewBox label="Não encontrados" value={report.missing} variant="metric-centered" /> : null}
            </div>

            {report?.errors.length ? (
              <div className="app-table-scroll max-h-40 rounded-xl border border-[var(--app-border)]">
                <table className="app-table app-table--compact min-w-[540px] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">BL</th>
                      <th scope="col" className="px-3 py-2">Container</th>
                      <th scope="col" className="px-3 py-2">Falha ao gravar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.map((row) => (
                      <tr key={`${row.bl_id}-${row.container_number}`}>
                        <td className="px-3 py-2">{row.bl_id}</td>
                        <td className="px-3 py-2">{row.container_number || '—'}</td>
                        <td className="px-3 py-2">{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="app-table-scroll max-h-64 rounded-xl border border-[var(--app-border)]">
              <table className="app-table app-table--compact min-w-[540px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">BL</th>
                    <th scope="col" className="px-3 py-2">Container</th>
                    <th scope="col" className="px-3 py-2">Descarga</th>
                    <th scope="col" className="px-3 py-2">Devolução</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row: ContainerDatesImportRow) => (
                    <tr key={`${row.bl_id}-${row.container_number}`}>
                      <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{row.bl_id}</td>
                      <td className="px-3 py-2">{row.container_number}</td>
                      <td className="px-3 py-2">{row.discharge_date}</td>
                      <td className="px-3 py-2 text-[var(--app-muted)]">{row.return_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ImportIssuesPanel
              issues={preview.rowErrors.map((item) => ({
                row: item.row,
                field: 'row',
                code: 'invalid_group' as const,
                severity: 'error' as const,
                message: item.message,
              }))}
              filename="container-dates-issues.csv"
            />
          </div>
        ) : null}

        <div className="app-modal__actions">
          <Button variant="secondary" onClick={resetAndClose}>Voltar</Button>
          <Button disabled={!preview?.rows.length} loading={submitting} onClick={() => void handleImport()}>
            Importar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
