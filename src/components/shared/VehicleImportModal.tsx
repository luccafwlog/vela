import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { userFacingErrorMessage } from '../../lib/errors'
import { afterCargaAlterada } from '../../services/cacheEffects'
import { rowErrorsToImportIssues } from '../../services/importValidation'
import {
  importVehicleRows,
  parseVehicleImportFile,
  vehicleUnpackingConfirmOptions,
  type ParsedVehicleImport,
  type VehicleImportResult,
} from '../../services/vehicleImport'
import type { FixedImportVoyage } from './BreakbulkManifestImportModal'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import {
  ImportContext,
  ImportFileBlock,
  ImportFilePicker,
  ImportFootnote,
  ImportGuide,
  ImportNotice,
  ImportSection,
  ImportSteps,
  ImportTemplateLinks,
} from './ImportParts'
import { ImportReadProgress } from './ImportReadProgress'
import { TruncationNote } from './TruncationNote'
import { VoyageCombobox } from './VoyageCombobox'
import { plural } from './importPresentation'

const PREVIEW_LIMIT = 20

/**
 * Importar veículos: o mesmo modal em /veiculos (viagem escolhida aqui) e na
 * aba da Viagem (viagem fixa), A1 do lote 6a.
 *
 * Regra de 2026-10-19 (ADR 0092): linha com erro na planilha recusa a
 * planilha inteira; linha que a conferência com o que já está gravado recusa
 * (chassi repetido, B/L fora da viagem, lacre divergente, container ausente)
 * também: nada é gravado e a tela lista todas as recusadas.
 */
export function VehicleImportModal({
  voyage,
  defaultVoyageId,
  onClose,
}: {
  voyage?: FixedImportVoyage
  defaultVoyageId?: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [chosenVoyageId, setChosenVoyageId] = useState(defaultVoyageId ?? '')
  const voyageId = voyage ? String(voyage.id) : chosenVoyageId
  const { file, preview, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedVehicleImport>(parseVehicleImportFile)
  const [importing, setImporting] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  // Recusa da conferência com o que já está gravado: nada foi gravado.
  const [refused, setRefused] = useState<VehicleImportResult | null>(null)

  async function handleFiles(files: File[]) {
    setReadError(null)
    setImportError(null)
    setRefused(null)
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

  const rowErrors = preview?.rowErrors.length ?? 0
  const vehicleCount = preview?.rows.length ?? 0
  const canImport = Boolean(voyageId) && vehicleCount > 0 && rowErrors === 0 && !refused

  async function handleImport() {
    if (!canImport || !preview) return
    setImporting(true)
    setImportError(null)
    try {
      const result = await importVehicleRows({ voyageId: Number(voyageId), rows: preview.rows, confirmUnpacking: (items) => confirm(vehicleUnpackingConfirmOptions(items)) })
      if (result.errorCount) {
        // Nada foi gravado: o modal fica aberto com a lista do que foi recusado.
        setRefused(result)
        return
      }
      await afterCargaAlterada(queryClient)
      showToast(`${plural(result.successCount, 'veículo importado', 'veículos importados')}.`, 'success')
      onClose()
    } catch (err) {
      // A recusa do servidor (B/L cancelado, chassi em outra Viagem, desova
      // divergente) chega como erro do banco, não como Error: a mensagem de
      // negócio vem de userFacingErrorMessage. A gravação é uma transação só.
      setImportError(userFacingErrorMessage(err, 'Falha ao importar veículos.'))
    } finally {
      setImporting(false)
    }
  }

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  let footnoteTone: 'default' | 'warning' = 'default'
  if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (refused) {
    footnote = 'Nada foi gravado. Corrija as linhas recusadas e escolha a planilha de novo.'
    footnoteTone = 'warning'
  } else if (readError || (preview && rowErrors)) {
    footnote = 'Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.'
    footnoteTone = 'warning'
  } else if (preview && !vehicleCount) {
    footnote = 'Nenhum veículo no arquivo.'
    footnoteTone = 'warning'
  } else if (preview && !voyageId) {
    footnote = 'Escolha a viagem de destino para importar.'
    footnoteTone = 'warning'
  } else if (preview) footnote = `${plural(vehicleCount, 'veículo será gravado', 'veículos serão gravados')}. Nada foi gravado ainda.`

  return (
    <Modal open onClose={handleClose} title="Importar veículos">
      <div className="app-import">
        <ImportSteps current={preview || readError ? 'previa' : 'arquivo'} />
        {voyage ? (
          <ImportContext label="Viagem">{voyage.label}</ImportContext>
        ) : (
          <VoyageCombobox
            required
            label="Viagem de destino"
            disabled={importing}
            selectedVoyageId={chosenVoyageId}
            onSelect={(id) => { setRefused(null); setChosenVoyageId(id == null ? '' : String(id)) }}
          />
        )}
        <ImportFileBlock templates={<ImportTemplateLinks baseName="veiculos-modelo" />}>
          <ImportGuide
            required="CHASSI, MARCA, MODELO, PESO, CUBAGEM, CONTAINER, TIPO_CONTAINER, LACRE e BL."
            optional="LOCAL DE DESOVA."
            details={<p>Também aceita o Daily Report de veículos do armador (uma linha por chassi) e cabeçalhos em chinês. Cada linha precisa de um B/L da viagem e de um container que case por número, tipo e lacre.</p>}
          />
          <ImportFilePicker accept=".xlsx,.xls,.csv" files={file ? [file] : []} onFiles={(files) => void handleFiles(files)} disabled={importing} />
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
                  { label: vehicleCount === 1 ? 'veículo' : 'veículos', value: vehicleCount },
                  { label: rowErrors === 1 ? 'erro' : 'erros', value: rowErrors, tone: rowErrors ? 'danger' : 'default' },
                  ...(refused ? [{ label: refused.errorCount === 1 ? 'recusado' : 'recusados', value: refused.errorCount, tone: 'danger' as const }] : []),
                ]}
              />
            }
          >
            {vehicleCount ? (
              <>
                <div className="app-table-scroll max-h-72">
                  <table className="app-table app-table--compact min-w-[720px] whitespace-nowrap">
                    <caption className="sr-only">Prévia da importação de veículos</caption>
                    <thead>
                      <tr>
                        <th scope="col">Chassi</th>
                        <th scope="col">Marca e modelo</th>
                        <th scope="col">Container</th>
                        <th scope="col">Tipo</th>
                        <th scope="col">Lacre</th>
                        <th scope="col">B/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                        <tr key={`${row.rowNumber}-${row.chassis}`}>
                          <td className="font-medium text-[var(--app-text-strong)]">{row.chassis}</td>
                          <td>{[row.brand, row.model].filter(Boolean).join(' ')}</td>
                          <td>{row.container_number}</td>
                          <td>{row.container_type}</td>
                          <td>{row.seal_number || <NoValue label="Sem lacre" />}</td>
                          <td>{row.bl_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TruncationNote shown={PREVIEW_LIMIT} total={vehicleCount} noun="veículo" nounPlural="veículos" />
              </>
            ) : (
              <p className="app-panel__meta">Nenhum veículo lido da planilha.</p>
            )}
          </ImportSection>
        ) : null}
        {preview && !refused ? <ImportIssuesPanel issues={rowErrorsToImportIssues(preview.rowErrors)} filename="veiculos-issues.csv" /> : null}
        {refused?.errors.length ? (
          <ImportIssuesPanel
            issues={rowErrorsToImportIssues(refused.errors)}
            filename="veiculos-recusados.csv"
            title={`Nada foi gravado: ${plural(refused.errors.length, 'linha recusada', 'linhas recusadas')} na conferência com o que já está gravado`}
            hint="Com uma linha recusada, a planilha inteira fica de fora. Corrija estas linhas e escolha a planilha de novo."
          />
        ) : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="Nada foi gravado">
            <p>{importError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}
        <div className="app-modal__actions">
          <ImportFootnote tone={footnoteTone}>{footnote}</ImportFootnote>
          <Button variant="secondary" disabled={importing} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
          <Button disabled={!canImport || parsing} loading={importing} loadingLabel="Importando…" onClick={() => void handleImport()}>
            {vehicleCount ? `Importar ${plural(vehicleCount, 'veículo', 'veículos')}` : 'Importar veículos'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
