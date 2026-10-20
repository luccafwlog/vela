import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { userFacingErrorMessage } from '../../lib/errors'
import { afterManifestoImportado } from '../../services/cacheEffects'
import { formatGraniteTons, graniteLegLabel, graniteWeightKg } from '../../services/graniteCargo'
import {
  describeGraniteImport,
  graniteRemovalConfirmOptions,
  importGraniteManifest,
  parseGraniteManifestFile,
  type GraniteImportResult,
  type ParsedGraniteManifest,
} from '../../services/graniteImport'
import { rowErrorsToImportIssues } from '../../services/importValidation'
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

const PREVIEW_LIMIT = 50

/**
 * Importar manifesto Granito (planilha COSCO "Relatório de Cargas/Booking"):
 * o mesmo modal em /granito (viagem escolhida aqui) e na aba da Viagem (viagem
 * fixa), A1 do lote 6a. O arquivo pode ser lido antes da viagem; a viagem
 * libera o botão Importar. O Granito só totaliza carga (lote 5b): não há
 * Cliente nem CNPJ por B/L, e o peso é o peso real da planilha.
 *
 * Regra de 2026-10-19 (ADR 0091): qualquer linha com erro recusa o arquivo
 * inteiro; não há aceite que grave só as válidas.
 */
export function GraniteImportModal({
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
  const { file, preview: manifest, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<ParsedGraniteManifest>(parseGraniteManifestFile)
  const [readError, setReadError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [result, setResult] = useState<GraniteImportResult | null>(null)

  async function handleFiles(files: File[]) {
    setReadError(null)
    setImportError(null)
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

  const errors = manifest?.rowErrors.length ?? 0
  const blCount = manifest?.bls.length ?? 0
  const blocks = manifest?.bls.reduce((sum, bl) => sum + Number(bl.blocks_qty ?? 0), 0) ?? 0
  const weightKg = manifest?.bls.reduce((sum, bl) => sum + (graniteWeightKg(bl) ?? 0), 0) ?? 0
  const canImport = Boolean(manifest && blCount > 0 && errors === 0 && voyageId && uploadedBy && !result)

  async function handleImport() {
    if (!canImport || !manifest || !uploadedBy) return
    setImporting(true)
    setImportError(null)
    try {
      const nextResult = await importGraniteManifest({
        filename: file?.name ?? 'granito.xlsx',
        voyageId: Number(voyageId),
        manifest,
        uploadedBy,
        confirmRemoval: (missing) => confirm(graniteRemovalConfirmOptions(missing, manifest.hidden)),
      })
      // Inclui a lista e os totais do Granito, a Viagem e o ADR (G6).
      await afterManifestoImportado(queryClient, { voyageId })
      showToast(`Granito importado: ${describeGraniteImport(nextResult)}.`, 'success')
      setResult(nextResult)
    } catch (err) {
      // O erro do PostgREST não é `Error`: a mensagem de negócio da RPC vem
      // pela classificação compartilhada (src/lib/errors.ts); erro
      // desconhecido não mostra o texto cru do banco (achado G7 do 5b).
      setImportError(err instanceof Error ? err.message : userFacingErrorMessage(err, 'Não foi possível importar a planilha do Granito. Tente novamente.'))
    } finally {
      setImporting(false)
    }
  }

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  let footnoteTone: 'default' | 'warning' | 'success' = 'default'
  if (result) {
    footnote = 'Importação gravada.'
    footnoteTone = 'success'
  } else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (readError) {
    footnote = 'Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.'
    footnoteTone = 'warning'
  } else if (manifest && errors) {
    footnote = 'Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.'
    footnoteTone = 'warning'
  } else if (manifest && !blCount) {
    footnote = 'Nenhum B/L no arquivo.'
    footnoteTone = 'warning'
  } else if (manifest && !voyageId) {
    footnote = 'Escolha a viagem de destino para importar.'
    footnoteTone = 'warning'
  } else if (manifest) footnote = `${plural(blCount, 'B/L será gravado', 'B/Ls serão gravados')}. Nada foi gravado ainda.`

  const step = result ? 'resultado' : manifest || readError ? 'previa' : 'arquivo'

  return (
    <Modal open onClose={handleClose} title="Importar manifesto Granito">
      <div className="app-import">
        <ImportSteps current={step} />
        {voyage ? (
          <ImportContext label="Viagem">{voyage.label}</ImportContext>
        ) : (
          <VoyageCombobox
            required
            label="Viagem de destino"
            disabled={importing || Boolean(result)}
            selectedVoyageId={chosenVoyageId}
            onSelect={(id) => setChosenVoyageId(id == null ? '' : String(id))}
          />
        )}
        <ImportFileBlock templates={<ImportTemplateLinks baseName="granito-modelo" extensions={['xlsx']} />}>
          <ImportGuide
            required="BL e Real Weight."
            optional="Shipper, Navio/Viagem, L/Port, D/Port, Blocks Qtty, Fase e as demais colunas do relatório."
            details={
              <p>
                É o "Relatório de Cargas/Booking" que a COSCO exporta. O Granito só totaliza a carga da Viagem:
                não há Cliente nem faturamento por B/L.
              </p>
            }
          />
          <ImportFilePicker accept=".xlsx,.xls" files={file ? [file] : []} onFiles={(files) => void handleFiles(files)} disabled={importing || Boolean(result)} />
        </ImportFileBlock>
        {parsing ? <ImportReadProgress progress={progress} /> : null}
        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira se é o relatório da COSCO e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}
        {manifest && !result ? (
          <ImportSection
            title="Prévia"
            aside={
              <SummaryStrip
                label="Resumo do manifesto"
                items={[
                  { label: blCount === 1 ? 'B/L' : 'B/Ls', value: blCount },
                  { label: 'blocos', value: blocks.toLocaleString('pt-BR') },
                  { label: 'peso', value: formatGraniteTons(weightKg) },
                  { label: errors === 1 ? 'erro' : 'erros', value: errors, tone: errors ? 'danger' : 'default' },
                ]}
              />
            }
          >
            <ImportContext label="Navio/viagem na planilha">{manifest.vesselVoyage || 'Não informado'}</ImportContext>
            {blCount ? (
              <>
                <div className="app-table-scroll max-h-80">
                  <table className="app-table app-table--compact min-w-[720px] whitespace-nowrap">
                    <caption className="sr-only">Prévia do manifesto Granito</caption>
                    <thead>
                      <tr>
                        <th scope="col">B/L</th>
                        <th scope="col" className="app-table__text-head">Shipper</th>
                        <th scope="col">Trecho</th>
                        <th scope="col">Blocos</th>
                        <th scope="col">Peso</th>
                        <th scope="col">Fase</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifest.bls.slice(0, PREVIEW_LIMIT).map((bl) => {
                        const blWeight = graniteWeightKg(bl)
                        return (
                          <tr key={bl.bl_number}>
                            <td className="font-medium text-[var(--app-text-strong)]">{bl.bl_number}</td>
                            <td className="app-table__text" title={bl.shipper_name ?? undefined}>{bl.shipper_name ?? <NoValue label="Sem shipper" />}</td>
                            <td>{graniteLegLabel(bl) ?? <NoValue label="Sem trecho" />}</td>
                            <td className="tabular-nums">{bl.blocks_qty != null ? bl.blocks_qty.toLocaleString('pt-BR') : <NoValue label="Sem blocos" />}</td>
                            <td className="tabular-nums">{blWeight != null ? formatGraniteTons(blWeight) : <NoValue label="Sem peso" />}</td>
                            <td>{bl.phase ?? <NoValue label="Sem fase" />}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <TruncationNote shown={PREVIEW_LIMIT} total={blCount} noun="B/L" nounPlural="B/Ls" />
              </>
            ) : null}
          </ImportSection>
        ) : null}
        {manifest && !result ? <ImportIssuesPanel issues={rowErrorsToImportIssues(manifest.rowErrors)} filename="granito-issues.csv" /> : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{importError}</p>
            <p>A prévia continua aqui; ajuste o que for preciso e confirme de novo.</p>
          </ImportNotice>
        ) : null}
        {result ? (
          <ImportSection title="Resultado">
            <ImportNotice tone="success" role="status" title="Manifesto gravado">
              <p>{describeGraniteImport(result).replace(/^./, (first) => first.toUpperCase())}.</p>
            </ImportNotice>
          </ImportSection>
        ) : null}
        <div className="app-modal__actions">
          <ImportFootnote tone={footnoteTone}>{footnote}</ImportFootnote>
          {result ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={importing} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
              <Button disabled={!canImport || parsing} loading={importing} loadingLabel="Importando…" onClick={() => void handleImport()}>
                {blCount ? `Importar ${plural(blCount, 'B/L', 'B/Ls')}` : 'Importar B/Ls'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
