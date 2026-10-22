import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { importErrorMessage } from '../../lib/errors'
import { afterManifestoImportado } from '../../services/cacheEffects'
import { hasBlockingIssues, rowErrorsToImportIssues } from '../../services/importValidation'
import {
  importVaziosImportacaoManifest,
  listVoyageVaziosImportacao,
  parseVaziosImportacaoFile,
  resolveVaziosManifestNumbers,
  vaziosImportacaoHiddenConfirmOptions,
  vaziosPlanilhaConflicts,
  type ParsedVaziosImportacaoManifest,
} from '../../services/vaziosImportacaoImport'
import type { FixedImportVoyage } from './BreakbulkManifestImportModal'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportContext, ImportFileBlock, ImportFilePicker, ImportFootnote, ImportNotice, ImportSection, ImportSteps, PreviousImportNotice } from './ImportParts'
import { useImportFileReceipt } from '../../hooks/useImportFileReceipt'
import { importFilesSha256 } from '../../services/importFileReceipt'
import { ImportReadProgress } from './ImportReadProgress'
import { TruncationNote } from './TruncationNote'
import { VaziosImportacaoGuide, VaziosImportacaoManifestNumbers, VaziosImportacaoTemplates } from './VaziosImportacaoImportParts'
import { VoyageCombobox } from './VoyageCombobox'
import { countIssues, plural } from './importPresentation'

const PREVIEW_LIMIT = 25

/**
 * Importar vazios de importação (containers vazios que descarregam): o mesmo
 * modal em /vaziosimportacao (viagem escolhida aqui) e na aba da Viagem
 * (viagem fixa), A1 do lote 6a. O arquivo pode ser lido antes da viagem (A2);
 * a viagem e o Nº do manifesto Mercante de cada rota (POL → POD) liberam o
 * botão Importar.
 *
 * Regra de 2026-10-19 (ADR 0092): qualquer linha com erro recusa o arquivo
 * inteiro; aviso não impede e pede o aceite.
 */
export function VaziosImportacaoImportModal({
  voyage,
  defaultVoyageId,
  userId,
  onClose,
}: {
  voyage?: FixedImportVoyage
  defaultVoyageId?: string
  userId?: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const uploadedBy = userId ?? user?.id ?? null
  const [chosenVoyageId, setChosenVoyageId] = useState(defaultVoyageId ?? '')
  const voyageId = voyage ? String(voyage.id) : chosenVoyageId
  const [description, setDescription] = useState('')
  const [manifestNumbers, setManifestNumbers] = useState<Record<string, string>>({})
  const { file, preview: manifest, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedVaziosImportacaoManifest>(parseVaziosImportacaoFile)
  const receipt = useImportFileReceipt('vazios_importacao', voyageId ? Number(voyageId) : null, file ? [file] : [])
  const [readError, setReadError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [acceptWarnings, setAcceptWarnings] = useState(false)

  async function handleFiles(files: File[]) {
    setReadError(null)
    setImportError(null)
    setAcceptWarnings(false)
    setManifestNumbers({})
    try {
      await readFile(files[0] ?? null)
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.')
    }
  }

  // Gravação em andamento: X, Escape e Voltar não fecham (como no CE
  // Mercante); fechar no meio deixava a gravação seguindo sem tela.
  function handleClose() {
    if (importing) {
      showToast('Aguarde: a gravação ainda está em andamento.', 'info')
      return
    }
    cancelReading()
    onClose()
  }

  const issues = manifest ? rowErrorsToImportIssues(manifest.rowErrors) : []
  const { errors, warnings } = countIssues(issues)
  const hasErrors = hasBlockingIssues(issues)
  const containerCount = manifest?.containers.length ?? 0
  const numbers = manifest ? resolveVaziosManifestNumbers(manifest, manifestNumbers) : null
  const numbersReady = Boolean(numbers?.manifestos)
  // ADR 0095, decisão 21: um vazio de importação por Viagem. A prévia mostra o
  // que vem do Baplie (a planilha vale) e recusa o que outra planilha gravou
  // noutra rota; o servidor confere de novo (migration 398).
  const existingVazios = useQuery({
    queryKey: ['vazios-importacao-containers', 'voyage-keys', voyageId],
    enabled: Boolean(voyageId && manifest && containerCount > 0),
    queryFn: () => listVoyageVaziosImportacao(Number(voyageId)),
  })
  const conflicts = manifest && existingVazios.data ? vaziosPlanilhaConflicts(manifest.containers, existingVazios.data) : null
  const conflictsReady = Boolean(conflicts) || !voyageId
  const canImport = Boolean(
    manifest && containerCount > 0 && !hasErrors && numbersReady && voyageId && uploadedBy && (warnings === 0 || acceptWarnings)
      && conflictsReady && !conflicts?.blocking.length,
  )

  async function handleImport() {
    if (!canImport || !manifest || !uploadedBy) return
    const hiddenQuestion = vaziosImportacaoHiddenConfirmOptions(manifest.hidden)
    if (hiddenQuestion && !(await confirm(hiddenQuestion))) return
    setImporting(true)
    setImportError(null)
    try {
      await importVaziosImportacaoManifest({
        manifest,
        uploadedBy,
        voyageId: Number(voyageId),
        manifestNumbers,
        description: description.trim() || undefined,
        filename: file?.name ?? null,
        fileHash: receipt.fileHash ?? (file ? await importFilesSha256([file]).catch(() => null) : null),
      })
      await afterManifestoImportado(queryClient, { voyageId })
      showToast(`Vazios de importação gravados: ${plural(containerCount, 'container', 'containers')}.`, 'success')
      onClose()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : importErrorMessage(err, 'Falha ao importar os vazios.'))
    } finally {
      setImporting(false)
    }
  }

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  let footnoteTone: 'default' | 'warning' = 'default'
  if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (readError || (manifest && hasErrors)) {
    footnote = 'Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.'
    footnoteTone = 'warning'
  } else if (manifest && !containerCount) {
    footnote = 'Nenhum container no arquivo.'
    footnoteTone = 'warning'
  } else if (manifest && !voyageId) {
    footnote = 'Escolha a viagem de destino: é ela que libera o botão Importar.'
    footnoteTone = 'warning'
  } else if (manifest && conflicts?.blocking.length) {
    footnote = 'Há container que já está em outra rota desta Viagem: nada é importado.'
    footnoteTone = 'warning'
  } else if (manifest && voyageId && existingVazios.isError) {
    footnote = 'Não foi possível conferir os vazios já gravados nesta Viagem. Escolha o arquivo de novo.'
    footnoteTone = 'warning'
  } else if (manifest && voyageId && !conflictsReady) {
    footnote = 'Conferindo os vazios já gravados nesta Viagem…'
  } else if (manifest && !numbersReady) {
    footnote = 'Informe o Nº do manifesto Mercante de cada rota (POL → POD) para importar.'
    footnoteTone = 'warning'
  } else if (manifest && warnings && !acceptWarnings) {
    footnote = 'Confira os avisos e confirme o aceite para importar.'
    footnoteTone = 'warning'
  } else if (manifest) footnote = `${plural(containerCount, 'container será gravado', 'containers serão gravados')}. Nada foi gravado ainda.`

  return (
    <Modal open onClose={handleClose} title="Importar vazios de importação">
      <div className="app-import">
        <ImportSteps current={manifest || readError ? 'previa' : 'arquivo'} />
        {voyage ? (
          <ImportContext label="Viagem">{voyage.label}</ImportContext>
        ) : (
          <VoyageCombobox
            required
            label="Viagem de destino"
            disabled={importing}
            selectedVoyageId={chosenVoyageId}
            onSelect={(id) => setChosenVoyageId(id == null ? '' : String(id))}
          />
        )}
        <Field label="Descrição (opcional)">
          <Input placeholder="Ex.: Importação da semana 15" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <ImportFileBlock templates={<VaziosImportacaoTemplates />}>
          <VaziosImportacaoGuide />
          <ImportFilePicker accept=".xlsx,.xls,.csv" files={file ? [file] : []} onFiles={(files) => void handleFiles(files)} disabled={importing} />
        </ImportFileBlock>
        {parsing ? <ImportReadProgress progress={progress} /> : null}
        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira o formato e o conteúdo e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}
        {manifest ? (
          <ImportSection
            title="Prévia"
            aside={
              <SummaryStrip
                label="Resumo da planilha"
                items={[
                  { label: containerCount === 1 ? 'container' : 'containers', value: containerCount },
                  { label: errors === 1 ? 'erro' : 'erros', value: errors, tone: errors ? 'danger' : 'default' },
                  { label: warnings === 1 ? 'aviso' : 'avisos', value: warnings, tone: warnings ? 'warning' : 'default' },
                ]}
              />
            }
          >
            <PreviousImportNotice message={receipt.previousImportMessage} />
            {containerCount ? (
              <>
                <div className="app-table-scroll max-h-64">
                  <table className="app-table app-table--compact min-w-[560px] whitespace-nowrap">
                    <caption className="sr-only">Prévia dos vazios de importação</caption>
                    <thead>
                      <tr>
                        <th scope="col">Container</th>
                        <th scope="col">Tipo</th>
                        <th scope="col">Tara (kg)</th>
                        <th scope="col">POL</th>
                        <th scope="col">POD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifest.containers.slice(0, PREVIEW_LIMIT).map((container, index) => (
                        <tr key={`${container.container_number}-${index}`}>
                          <td className="font-medium text-[var(--app-text-strong)]">{container.container_number}</td>
                          <td>{container.container_type ?? <NoValue label="Sem tipo" />}</td>
                          <td className="tabular-nums">{container.tare_kg != null ? Number(container.tare_kg).toLocaleString('pt-BR') : <NoValue label="Sem tara" />}</td>
                          <td>{container.pol ?? <NoValue label="Sem POL" />}</td>
                          <td>{container.pod ?? <NoValue label="Sem POD" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TruncationNote shown={PREVIEW_LIMIT} total={containerCount} noun="container" nounPlural="containers" />
              </>
            ) : (
              <p className="app-panel__meta">Nenhum container lido do arquivo.</p>
            )}
          </ImportSection>
        ) : null}
        {manifest ? <ImportIssuesPanel issues={issues} filename="vazios-importacao-issues.csv" /> : null}
        {conflicts?.blocking.length ? (
          <ImportNotice tone="danger" role="alert" title="Container já está em outra rota desta Viagem">
            {conflicts.blocking.slice(0, 10).map((message) => <p key={message}>{message}</p>)}
            {conflicts.blocking.length > 10 ? <p>… e mais {conflicts.blocking.length - 10}.</p> : null}
            <p>Um vazio de importação existe uma vez por Viagem. Nada é importado.</p>
          </ImportNotice>
        ) : null}
        {conflicts?.fromBaplie.length ? (
          <ImportNotice tone="info" title={`${plural(conflicts.fromBaplie.length, 'container veio', 'containers vieram')} do Baplie`}>
            <p>A planilha vale sobre o Baplie: {conflicts.fromBaplie.slice(0, 10).join(', ')}{conflicts.fromBaplie.length > 10 ? ` e mais ${conflicts.fromBaplie.length - 10}` : ''} passam a valer pela planilha.</p>
          </ImportNotice>
        ) : null}
        {manifest && !hasErrors ? (
          <VaziosImportacaoManifestNumbers manifest={manifest} values={manifestNumbers} onChange={setManifestNumbers} disabled={importing} />
        ) : null}
        {manifest && !hasErrors && warnings > 0 ? (
          <label className="app-import-override">
            <input type="checkbox" checked={acceptWarnings} onChange={(event) => setAcceptWarnings(event.target.checked)} />
            <span>
              <span className="app-import-override__title">Conferi os avisos e quero importar o arquivo</span>
              <span className="app-import-override__hint">Os avisos não impedem a gravação; o arquivo inteiro é importado.</span>
            </span>
          </label>
        ) : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{importError}</p>
            <p>A prévia continua aqui; ajuste o que for preciso e confirme de novo.</p>
          </ImportNotice>
        ) : null}
        <div className="app-modal__actions">
          <ImportFootnote tone={footnoteTone}>{footnote}</ImportFootnote>
          <Button variant="secondary" disabled={importing} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
          <Button disabled={!canImport || parsing} loading={importing} loadingLabel="Importando…" onClick={() => void handleImport()}>
            {containerCount ? `Importar ${plural(containerCount, 'container', 'containers')}` : 'Importar containers'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
