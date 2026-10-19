import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useBaplieVoyageContext } from '../../hooks/useBaplieVoyageContext'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { userFacingErrorMessage } from '../../lib/errors'
import { afterBaplieImportado } from '../../services/cacheEffects'
import { parseBaplieFile } from '../../services/baplieParser'
import {
  applyBaplieVoyageRules,
  baplieFootnoteForPendency,
  baplieImportToast,
  baplieReplacementConfirmOptions,
  baplieVoyageContextBlock,
  hasBapliePendency,
  reimportBaplie,
  type BaplieImportDone,
} from '../../services/baplieImport'
import { canImportPreview, hasBlockingIssues } from '../../services/importValidation'
import { BaplieImportPartialNotice } from './BaplieImportPartialNotice'
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
import { VoyageCombobox } from './VoyageCombobox'
import { plural } from './importPresentation'

/**
 * Importar Baplie EDI: o mesmo modal em /baplie (viagem escolhida aqui) e na
 * aba da Viagem (viagem fixa), A1 do lote 6a. As regras que dependem da Viagem
 * (ADR 0078, item 21) só rodam com a Viagem conferida; sem ela, nada grava.
 * Erro no arquivo recusa a importação inteira. IMO/OOG e vazios são passos
 * depois da gravação (D2): se falharem, o Baplie fica gravado e o aviso diz o
 * que falta.
 */
export function BaplieImportModal({
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
  const actorId = userId ?? user?.id ?? null
  const [chosenVoyageId, setChosenVoyageId] = useState(defaultVoyageId ?? '')
  const voyageId = voyage ? String(voyage.id) : chosenVoyageId
  const { file, preview: parsed, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<Awaited<ReturnType<typeof parseBaplieFile>>>(parseBaplieFile)
  const [importing, setImporting] = useState(false)
  const [excludedPods, setExcludedPods] = useState<Set<string>>(new Set())
  const [readError, setReadError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const voyageContext = useBaplieVoyageContext(voyageId ? Number(voyageId) : null)
  // Baplie gravado com IMO/OOG ou vazios pendentes: falha parcial que fica à vista.
  const [partial, setPartial] = useState<BaplieImportDone | null>(null)

  async function handleFiles(files: File[]) {
    setExcludedPods(new Set())
    setReadError(null)
    setImportError(null)
    try {
      await readFile(files[0] ?? null)
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo. Verifique o formato EDI.')
    }
  }

  function handleClose() {
    cancelReading()
    onClose()
  }

  function togglePod(pod: string) {
    setExcludedPods((prev) => {
      const next = new Set(prev)
      if (next.has(pod)) next.delete(pod)
      else next.add(pod)
      return next
    })
  }

  // Regras que dependem da Viagem (ADR 0078, item 21): TDT de outro navio ou
  // viagem bloqueia; POD fora das escalas é ignorado com aviso.
  const ruled = useMemo(() => (parsed ? applyBaplieVoyageRules(parsed, voyageContext.data) : null), [parsed, voyageContext.data])
  const pods = ruled?.pods ?? []
  const filteredContainers = (ruled?.containers ?? []).filter((c) => !c.pod || !excludedPods.has(c.pod))
  const includedPods = pods.filter((pod) => !excludedPods.has(pod)).length
  const issues = ruled?.issues ?? []
  const hasErrors = hasBlockingIssues(issues)
  // Sem a Viagem conferida (carregando ou com falha), as regras acima não
  // rodaram: importar fica bloqueado.
  const contextBlock = voyageId ? baplieVoyageContextBlock(voyageContext) : null
  const canImport = Boolean(parsed && voyageId && actorId && !contextBlock && canImportPreview(filteredContainers.length > 0, issues))

  async function handleImport() {
    if (!canImport || !actorId) return
    setImporting(true)
    setImportError(null)
    try {
      const result = await reimportBaplie({
        voyageId: Number(voyageId),
        containers: filteredContainers,
        actorId,
        confirmReplacement: (plan) => confirm(baplieReplacementConfirmOptions(plan, filteredContainers.length)),
      })
      if (result.status === 'cancelled') return
      await afterBaplieImportado(queryClient, { voyageId })
      if (hasBapliePendency(result)) {
        setPartial(result)
        return
      }
      showToast(baplieImportToast(result), 'success')
      handleClose()
    } catch (err) {
      await afterBaplieImportado(queryClient, { voyageId })
      setImportError(err instanceof Error ? err.message : userFacingErrorMessage(err, 'Falha ao importar o Baplie EDI.'))
    } finally {
      setImporting(false)
    }
  }

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (partial) footnote = baplieFootnoteForPendency(partial)
  else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (readError || (parsed && hasErrors)) footnote = 'Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.'
  else if (parsed && !voyageId) footnote = 'Escolha a viagem de destino para importar.'
  else if (parsed && contextBlock) footnote = contextBlock.state === 'loading' ? contextBlock.message : 'Importação bloqueada até a Viagem ser conferida.'
  else if (parsed && !canImport) footnote = 'Nenhum container selecionado para importar.'
  else if (parsed) footnote = `${plural(filteredContainers.length, 'container será gravado', 'containers serão gravados')}. Se a viagem já tem Baplie, você confere a diferença antes de substituir.`
  const footnoteTone = partial ? (hasBapliePendency(partial) ? 'warning' : 'success') : (readError || (parsed && !canImport)) ? 'warning' : 'default'
  const step = partial ? 'resultado' : parsed || readError ? 'previa' : 'arquivo'

  return (
    <Modal open onClose={handleClose} title="Importar Baplie EDI">
      <div className="app-import">
        <ImportSteps current={step} />
        {voyage ? (
          <ImportContext label="Viagem">{voyage.label}</ImportContext>
        ) : (
          <VoyageCombobox
            required
            label="Viagem de destino"
            disabled={importing || Boolean(partial)}
            selectedVoyageId={chosenVoyageId}
            onSelect={(id) => setChosenVoyageId(id == null ? '' : String(id))}
          />
        )}
        <ImportFileBlock templates={<ImportTemplateLinks baseName="baplie-modelo" extensions={['edi']} />}>
          <ImportGuide
            requiredLabel="Formato"
            required="Baplie EDIFACT do plano de estiva da viagem."
            details={<p>Reimportar substitui o Baplie inteiro da viagem. Com diferença, a lista do que entra, sai ou muda aparece antes de confirmar; sem diferença, o arquivo é aceito direto e os vazios ficam como estão.</p>}
          />
          <ImportFilePicker accept=".edi,.txt,.edi2,.bpl" files={file ? [file] : []} onFiles={(files) => void handleFiles(files)} disabled={importing || Boolean(partial)} />
        </ImportFileBlock>
        {parsing ? <ImportReadProgress progress={progress} /> : null}
        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira se é o Baplie EDIFACT da viagem e escolha de novo.</p>
          </ImportNotice>
        ) : null}
        {contextBlock?.state === 'error' && !partial ? (
          <ImportNotice tone="danger" role="alert" title="Importação bloqueada">
            <p>{contextBlock.message}</p>
            <p>Sem essa conferência, o navio, a viagem e as escalas do arquivo não são checados.</p>
            <Button variant="secondary" className="app-btn--sm" onClick={() => void voyageContext.refetch()}>Tentar novamente</Button>
          </ImportNotice>
        ) : null}
        {parsed ? (
          <ImportSection
            title="Prévia"
            aside={
              <SummaryStrip
                label="Resumo do Baplie"
                items={[
                  { label: filteredContainers.length === 1 ? 'container' : 'containers', value: filteredContainers.length },
                  { label: 'cheios', value: filteredContainers.filter((c) => c.status === 'full').length },
                  { label: 'IMO', value: filteredContainers.filter((c) => c.is_imo).length },
                  { label: 'OOG', value: filteredContainers.filter((c) => c.is_oog).length },
                  { label: includedPods === 1 ? 'porto de descarga' : 'portos de descarga', value: includedPods },
                ]}
              />
            }
          >
            <ImportContext label="Navio/viagem no arquivo">
              {parsed.vessel_name || parsed.voyage_number ? `${parsed.vessel_name ?? '—'} / ${parsed.voyage_number ?? '—'}` : 'Não informados'}
            </ImportContext>
            {pods.length > 0 ? (
              <fieldset className="app-import-pods">
                <legend>Portos de descarga a importar (desmarque os que não são desta operação)</legend>
                {pods.map((pod) => (
                  <label key={pod}>
                    <input type="checkbox" checked={!excludedPods.has(pod)} onChange={() => togglePod(pod)} disabled={Boolean(partial)} />
                    {pod}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </ImportSection>
        ) : null}
        {parsed ? <ImportIssuesPanel issues={issues} filename="baplie-issues.csv" /> : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{importError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}
        {partial && actorId ? (
          <ImportSection title="Resultado">
            <BaplieImportPartialNotice
              result={partial}
              voyageId={Number(voyageId)}
              actorId={actorId}
              onVaziosRetried={async () => {
                setPartial((current) => current && { ...current, vaziosError: null, vaziosReplaced: true })
                await afterBaplieImportado(queryClient, { voyageId })
              }}
            />
          </ImportSection>
        ) : null}
        <div className="app-modal__actions">
          <ImportFootnote tone={footnoteTone}>{footnote}</ImportFootnote>
          {partial ? (
            <Button onClick={handleClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={importing} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
              <Button disabled={!canImport || parsing} loading={importing} loadingLabel="Importando…" onClick={() => void handleImport()}>
                {canImport ? `Importar ${plural(filteredContainers.length, 'container', 'containers')}` : 'Importar containers'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
