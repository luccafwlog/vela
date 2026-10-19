import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { CNPJ_INPUT_MAX_LENGTH, canonicalizeDocument, normalizeCnpj } from '../../lib/cnpj'
import { userFacingErrorMessage } from '../../lib/errors'
import { afterManifestoImportado } from '../../services/cacheEffects'
import { findMatchedCustomer, loadCustomerMaps, resolveCustomerLink, withoutDeactivatedCustomer } from '../../services/customerReconciliation'
import {
  describeGraniteImport,
  graniteRemovalConfirmOptions,
  importGraniteManifest,
  parseGraniteManifestFile,
  type GraniteImportResult,
  type ParsedGraniteManifest,
  type ReconciliationStatus,
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
 * libera o botão Importar. CNPJ que falta pode ser resolvido na prévia.
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
  const { file, preview: manifest, parsing, progress, readFile, cancel: cancelReading, updatePreview } = useCancellableFileRead<ParsedGraniteManifest>(parseGraniteManifestFile)
  // CNPJ digitado na prévia, por linha da tabela.
  const [cnpjOverrides, setCnpjOverrides] = useState<Record<number, string>>({})
  const [readError, setReadError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [result, setResult] = useState<GraniteImportResult | null>(null)

  async function handleFiles(files: File[]) {
    setCnpjOverrides({})
    setReadError(null)
    setImportError(null)
    try {
      await readFile(files[0] ?? null)
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.')
    }
  }

  function handleClose() {
    cancelReading()
    onClose()
  }

  async function handleCnpjOverride(rowIndex: number, cnpj: string) {
    setCnpjOverrides((prev) => ({ ...prev, [rowIndex]: cnpj }))
    if (!manifest) return
    if (canonicalizeDocument(cnpj).length < 14) return
    const maps = await loadCustomerMaps()
    const bl = manifest.bls[rowIndex]
    const match = findMatchedCustomer({ cnpjCpf: cnpj, consignee: bl.shipper_name ?? '' }, maps)
    const link = resolveCustomerLink(withoutDeactivatedCustomer(match))
    // CNPJ sem Cliente ativo: o vínculo do CNPJ anterior não fica na linha.
    const next = link.status === 'missing_customer'
      ? { shipper_cnpj: cnpj, clientId: null, suggestedClientId: null, reconciliationStatus: 'not_found' as ReconciliationStatus }
      : {
          shipper_cnpj: cnpj,
          clientId: link.customerId,
          suggestedClientId: link.suggestedCustomerId,
          reconciliationStatus: (link.status === 'matched_document' ? 'matched' : 'suggested_name') as ReconciliationStatus,
        }
    updatePreview((current) => ({
      ...current,
      bls: current.bls.map((row, index) => (index === rowIndex ? { ...row, ...next } : row)),
    }))
  }

  const errors = manifest?.rowErrors.length ?? 0
  const blCount = manifest?.bls.length ?? 0
  const pending = manifest?.bls.filter((bl) => bl.reconciliationStatus !== 'matched').length ?? 0
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
      await Promise.all([
        afterManifestoImportado(queryClient, { voyageId }),
        queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['granite-manifests'] }),
      ])
      showToast(
        nextResult.pendingCount
          ? `Granito importado: ${describeGraniteImport(nextResult)}. ${nextResult.pendingCount} com reconciliação pendente.`
          : `Granito importado: ${describeGraniteImport(nextResult)}.`,
        'success',
      )
      setResult(nextResult)
    } catch (err) {
      // O erro do PostgREST não é `Error`: a mensagem de negócio da RPC vem
      // pela classificação compartilhada (src/lib/errors.ts).
      setImportError(err instanceof Error ? err.message : userFacingErrorMessage(err, 'Falha ao importar.'))
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
            optional="CNPJ, Shipper, Navio/Viagem, L/Port, D/Port, Blocks Qtty, Fase e as demais colunas do relatório."
            details={
              <p>
                É o "Relatório de Cargas/Booking" que a COSCO exporta. O CNPJ pode vir vazio: na prévia, digite o CNPJ
                do B/L sem Cliente; o que ficar sem Cliente entra pendente de reconciliação e é revisado antes de faturar.
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
                  { label: 'blocos', value: manifest.bls.reduce((sum, bl) => sum + Number(bl.blocks_qty ?? 0), 0).toLocaleString('pt-BR') },
                  { label: 't', value: (manifest.bls.reduce((sum, bl) => sum + Number(bl.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) },
                  { label: errors === 1 ? 'erro' : 'erros', value: errors, tone: errors ? 'danger' : 'default' },
                ]}
              />
            }
          >
            <ImportContext label="Navio/viagem na planilha">{manifest.vesselVoyage || 'Não informado'}</ImportContext>
            {pending > 0 ? (
              <ImportNotice tone="warning" title={plural(pending, 'B/L sem Cliente resolvido', 'B/Ls sem Cliente resolvido')}>
                Digite o CNPJ na tabela para vincular o Cliente, ou importe assim: o B/L entra pendente de reconciliação
                e o vínculo é revisado antes de faturar.
              </ImportNotice>
            ) : null}
            {blCount ? (
              <>
                <div className="app-table-scroll max-h-80">
                  <table className="app-table app-table--compact min-w-[900px] whitespace-nowrap">
                    <caption className="sr-only">Prévia do manifesto Granito</caption>
                    <thead>
                      <tr>
                        <th scope="col">Cliente</th>
                        <th scope="col">B/L</th>
                        <th scope="col" className="app-table__text-head">Shipper</th>
                        <th scope="col">CNPJ</th>
                        <th scope="col">Peso real (kg)</th>
                        <th scope="col">Fase</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifest.bls.slice(0, PREVIEW_LIMIT).map((bl, index) => (
                        <tr key={bl.bl_number}>
                          <td><ReconciliationText status={bl.reconciliationStatus} /></td>
                          <td className="font-medium text-[var(--app-text-strong)]">{bl.bl_number}</td>
                          <td className="app-table__text" title={bl.shipper_name ?? undefined}>{bl.shipper_name ?? <NoValue label="Sem shipper" />}</td>
                          <td>
                            {bl.reconciliationStatus !== 'matched' ? (
                              <Input
                                aria-label={`CNPJ do B/L ${bl.bl_number}`}
                                placeholder="Digite o CNPJ"
                                className="w-44"
                                value={cnpjOverrides[index] ?? ''}
                                maxLength={CNPJ_INPUT_MAX_LENGTH}
                                onChange={(event) => void handleCnpjOverride(index, normalizeCnpj(event.target.value))}
                              />
                            ) : (
                              bl.shipper_cnpj ?? <NoValue label="Sem CNPJ" />
                            )}
                          </td>
                          <td className="tabular-nums">{Number(bl.real_weight_kg).toLocaleString('pt-BR')}</td>
                          <td>{bl.phase ?? <NoValue label="Sem fase" />}</td>
                        </tr>
                      ))}
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
            {result.pendingCount > 0 ? (
              <ImportNotice tone="warning" role="status" title={`Manifesto gravado; ${plural(result.pendingCount, 'B/L ficou pendente', 'B/Ls ficaram pendentes')} de reconciliação`}>
                <p>{describeGraniteImport(result)}.</p>
                <p>Revise o vínculo do consignatário antes de faturar.</p>
              </ImportNotice>
            ) : (
              <ImportNotice tone="success" role="status" title="Manifesto gravado">
                <p>{describeGraniteImport(result)}. Nenhuma pendência de reconciliação.</p>
              </ImportNotice>
            )}
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

/** Situação do vínculo com Cliente, em texto: âmbar no que pede ação. */
function ReconciliationText({ status }: { status: ReconciliationStatus }) {
  switch (status) {
    case 'matched': return <StatusText>Vinculado</StatusText>
    case 'suggested_name': return <StatusText tone="warning">Sugestão pelo nome</StatusText>
    case 'missing_cnpj': return <StatusText tone="warning">Sem CNPJ</StatusText>
    case 'not_found': return <StatusText tone="warning">CNPJ sem Cliente</StatusText>
  }
}
