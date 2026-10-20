import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterDatasContainerAlteradas } from '../../services/cacheEffects'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'
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
import { TruncationNote } from './TruncationNote'
import { plural } from './importPresentation'
import {
  importContainerDates,
  readContainerDatesFile,
  type ContainerDatesImportResult,
  type ContainerDatesImportRow,
  type ParsedContainerDatesImport,
} from '../../services/containerDatesImport'
import { classifyDbError } from '../../lib/errors'
import { formatDate } from '../../lib/utils'
import type { ImportIssue } from '../../services/importValidation'

const SAMPLE_SIZE = 25

/**
 * Planilha de datas de descarga e devolução (Demurrage e Containers). Molde do
 * lote 6a: Arquivo → Prévia → Resultado. Qualquer erro recusa o arquivo
 * inteiro, e a gravação é uma chamada só (migration 333): se o banco recusa um
 * B/L, nada é gravado e o Resultado lista o que foi recusado.
 */
export function ContainerDatesImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { file, preview, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedContainerDatesImport>(readContainerDatesFile)
  const [refused, setRefused] = useState<ContainerDatesImportResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const sampleRows = useMemo(() => preview?.rows.slice(0, SAMPLE_SIZE) ?? [], [preview?.rows])
  const issues = useMemo<ImportIssue[]>(() => (preview?.rowErrors ?? []).map((item) => ({
    row: item.row,
    field: 'row',
    code: 'invalid_group' as const,
    severity: 'error' as const,
    message: item.message,
  })), [preview?.rowErrors])

  async function handleFiles(files: File[]) {
    setRefused(null)
    setReadError(null)
    setSubmitError(null)
    try {
      await readFile(files[0] ?? null)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.')
    }
  }

  async function handleImport() {
    if (!preview?.rows.length || issues.length) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await importContainerDates(preview.rows)
      if (!result.ok) {
        setRefused(result)
        return
      }
      await afterDatasContainerAlteradas(queryClient)
      showToast(`${plural(result.updated, 'container atualizado', 'containers atualizados')}.`, 'success')
      resetAndClose()
    } catch (error) {
      setSubmitError(classifyDbError(error).message)
    } finally {
      setSubmitting(false)
    }
  }

  function resetAndClose() {
    cancelReading()
    setRefused(null)
    setReadError(null)
    setSubmitError(null)
    onClose()
  }

  const rows = preview?.rows.length ?? 0
  const hasErrors = issues.length > 0
  const canImport = rows > 0 && !hasErrors && !parsing && !refused
  const changing = preview?.rows.filter((row) => rowSituation(row) !== 'Sem alteração').length ?? 0

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  let footnoteTone: 'default' | 'warning' = 'default'
  if (refused) { footnote = 'Nada foi gravado. Corrija o arquivo e escolha-o de novo.'; footnoteTone = 'warning' }
  else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (hasErrors) { footnote = 'Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.'; footnoteTone = 'warning' }
  else if (rows) footnote = 'Prévia pronta. Nada foi gravado ainda.'

  const step = refused ? 'resultado' : preview || readError ? 'previa' : 'arquivo'

  return (
    <Modal open={open} onClose={resetAndClose} title="Importar datas de descarga e devolução">
      <div className="app-import">
        <ImportSteps current={step} />

        <ImportFileBlock templates={<ImportTemplateLinks baseName="datas-container-modelo" />}>
          <ImportGuide
            required={<><strong>B/L</strong>, <strong>Container</strong> e <strong>Descarga</strong> (coluna Discharge).</>}
            optional={<><strong>Devolução</strong> (coluna Return), que pode faltar ou ficar em branco.</>}
            details={(
              <>
                <p>Datas em DD/MM/AAAA ou AAAA-MM-DD. Cada linha atualiza o container do B/L informado.</p>
                <p>Devolução em branco mantém a data gravada. Container que não está no B/L, data ilegível ou o mesmo container com datas diferentes impedem a importação do arquivo inteiro.</p>
              </>
            )}
          />
          <ImportFilePicker
            accept=".xlsx,.xls,.csv"
            files={file ? [file] : []}
            onFiles={(files) => void handleFiles(files)}
            disabled={submitting}
          />
        </ImportFileBlock>

        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira o formato e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}

        {preview && !refused ? (
          <ImportSection
            title="Prévia"
            aside={(
              <SummaryStrip
                label="Resumo da planilha"
                items={[
                  { label: rows === 1 ? 'container' : 'containers', value: rows },
                  { label: 'com data nova', value: changing },
                  { label: issues.length === 1 ? 'linha com erro' : 'linhas com erro', value: issues.length, tone: issues.length ? 'danger' : 'default' },
                ]}
              />
            )}
          >
            {rows ? (
              <>
                <div className="app-table-scroll app-import-table">
                  <table className="app-table app-table--compact w-full">
                    <caption className="sr-only">Prévia das datas lidas</caption>
                    <thead>
                      <tr>
                        <th scope="col">B/L</th>
                        <th scope="col">Container</th>
                        <th scope="col">Descarga</th>
                        <th scope="col">Devolução</th>
                        <th scope="col">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleRows.map((row: ContainerDatesImportRow) => {
                        const situation = rowSituation(row)
                        return (
                          <tr key={`${row.bl_id}-${row.container_number}`}>
                            <td className="app-import-code">{row.bl_id}</td>
                            <td className="app-import-code">{row.container_number}</td>
                            <td className="tabular-nums">{beforeAfter(row.before_discharge, row.discharge_date)}</td>
                            <td className="tabular-nums">{beforeAfter(row.before_return, row.after_return ?? row.return_date)}</td>
                            <td className={situation === 'Atualiza' ? 'app-import-tone--warning' : situation === 'Sem alteração' ? 'app-import-tone--muted' : undefined}>
                              {situation}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <TruncationNote shown={sampleRows.length} total={rows} noun="linha" />
              </>
            ) : null}
          </ImportSection>
        ) : null}

        {!refused ? <ImportIssuesPanel issues={issues} filename="datas-container-erros.csv" /> : null}

        {refused ? (
          <ImportSection title="Resultado" aside={plural(refused.errors.length, 'B/L recusado', 'B/Ls recusados')}>
            <ImportNotice tone="danger" role="alert" title="Nada foi gravado: o arquivo foi recusado">
              <p>Com um B/L recusado, nenhuma data do arquivo é gravada. Corrija as linhas abaixo e importe o arquivo de novo.</p>
            </ImportNotice>
            <div className="app-table-scroll app-import-table">
              <table className="app-table app-table--compact w-full">
                <caption className="sr-only">B/Ls recusados</caption>
                <thead>
                  <tr>
                    <th scope="col">B/L</th>
                    <th scope="col">Container</th>
                    <th scope="col" className="app-table__text-head">Motivo da recusa</th>
                  </tr>
                </thead>
                <tbody>
                  {refused.errors.map((row) => (
                    <tr key={`${row.bl_id}-${row.container_number}`}>
                      <td className="app-import-code">{row.bl_id}</td>
                      <td className="app-import-code">{row.container_number || <NoValue label="Todos os containers do B/L" />}</td>
                      <td className="app-table__text app-import-tone--danger" title={row.message}>{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ImportSection>
        ) : null}

        {submitError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>Nada foi gravado: {submitError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}

        <div className="app-modal__actions">
          <ImportFootnote tone={footnoteTone}>{footnote}</ImportFootnote>
          {refused ? (
            <Button onClick={resetAndClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : resetAndClose}>
                {parsing ? 'Interromper leitura' : 'Voltar'}
              </Button>
              <Button disabled={!canImport} loading={submitting} loadingLabel="Importando…" onClick={() => void handleImport()}>
                {rows ? `Importar ${plural(rows, 'container', 'containers')}` : 'Importar datas'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

type Situation = 'Grava' | 'Atualiza' | 'Sem alteração'

/** Data nova num container sem data é "Grava"; trocar uma data gravada pede atenção. */
function rowSituation(row: ContainerDatesImportRow): Situation {
  const after = row.after_return ?? row.return_date
  const dischargeChanges = (row.before_discharge ?? null) !== row.discharge_date
  const returnChanges = (row.before_return ?? null) !== (after ?? null)
  if (!dischargeChanges && !returnChanges) return 'Sem alteração'
  const overwrites = (dischargeChanges && row.before_discharge) || (returnChanges && row.before_return)
  return overwrites ? 'Atualiza' : 'Grava'
}

// "antes → depois" da prévia; sem mudança, só a data. Devolução vazia na
// planilha mantém a gravada (ADR 0078, item 19).
function beforeAfter(before: string | null | undefined, after: string | null | undefined): string {
  const show = (value: string | null | undefined) => (value ? formatDate(value) : '—')
  if (before === undefined) return show(after)
  return (before ?? null) === (after ?? null) ? show(after) : `${show(before)} → ${show(after)}`
}
