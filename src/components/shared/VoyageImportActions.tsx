import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterCargaAlterada, afterManifestoImportado, afterBaplieImportado } from '../../services/cacheEffects'
import { useNavigate } from 'react-router-dom'
import { Box, Car, FileText, Mountain, Package, PackageOpen, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useCancellableFileRead } from '../../hooks/useCancellableFileRead'
import { FileImportModal } from './FileImportModal'
import { BlImportModal } from './BlImportModal'
import { BlDocumentImportModal } from './BlDocumentImportModal'
import { CeMercanteImportModal } from './CeMercanteImportModal'
import {
  hasBlockingRowErrors,
  importBreakbulkManifest,
  parseBreakbulkManifestFile,
  type BreakbulkNumberFormat,
  type ParseBreakbulkOptions,
} from '../../services/breakbulkImport'
import { importGraniteManifest, parseGraniteManifestFile } from '../../services/graniteImport'
import { importVaziosImportacaoManifest, parseVaziosImportacaoFile, resolveVaziosManifestNumbers } from '../../services/vaziosImportacaoImport'
import { VaziosImportacaoGuide, VaziosImportacaoManifestNumbers } from './VaziosImportacaoImportParts'
import { importVehicleRows, parseVehicleImportFile } from '../../services/vehicleImport'
import { parseBaplieFile } from '../../services/baplieParser'
import { baplieImportToast, baplieReplacementConfirmOptions, reimportBaplie } from '../../services/baplieImport'
import { useConfirm } from '../ui/ConfirmDialog'
import { canImportPreview, rowErrorsToImportIssues } from '../../services/importValidation'
import { inspectImportUpload } from '../../services/importText'
import { queryKeys } from '../../services/queryKeys'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'
import { ImportContext, ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice, ImportSection, ImportTemplateLinks } from './ImportParts'
import { plural } from './importPresentation'
import { SummaryStrip } from '../ui/SummaryStrip'

type ImportType = 'bb' | 'granite' | 'ceMercanteGranite' | 'vaziosImp' | 'vaziosExp' | 'vehicles' | 'baplie' | 'blFreight' | 'blBreakbulk' | 'ceMercante'

type ImportGroup = 'baplie' | 'bls' | 'importEquipment' | 'exportManifest' | 'exportVazios'

const IMPORT_LABELS: Record<ImportType, string> = {
  bb: 'Manifesto BB',
  granite: 'Manifesto Granito',
  ceMercanteGranite: 'CE Mercante (Granito)',
  vaziosImp: 'Vazios IMP',
  vaziosExp: 'Novo embarque de vazios',
  vehicles: 'Veículos',
  baplie: 'Baplie EDI',
  blFreight: 'B/L container',
  blBreakbulk: 'B/L carga solta',
  ceMercante: 'CE Mercante',
}

const IMPORT_ORDER: ImportType[] = ['baplie', 'blFreight', 'blBreakbulk', 'ceMercante', 'bb', 'vehicles', 'vaziosImp', 'granite', 'ceMercanteGranite', 'vaziosExp']

const IMPORT_GROUP_BY_TYPE: Record<ImportType, ImportGroup> = {
  baplie: 'baplie',
  blFreight: 'bls',
  blBreakbulk: 'bls',
  ceMercante: 'bls',
  bb: 'bls',
  vehicles: 'importEquipment',
  vaziosImp: 'importEquipment',
  granite: 'exportManifest',
  ceMercanteGranite: 'exportManifest',
  vaziosExp: 'exportVazios',
}

const IMPORT_ICONS: Record<ImportType, LucideIcon> = {
  baplie: Package,
  blFreight: Box,
  blBreakbulk: FileText,
  ceMercante: ShieldCheck,
  bb: FileText,
  vehicles: Car,
  vaziosImp: PackageOpen,
  granite: Mountain,
  ceMercanteGranite: ShieldCheck,
  vaziosExp: PackageOpen,
}

export function VoyageImportActions({
  voyageId,
  voyageLabel,
  userId,
  types,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  types: ImportType[]
}) {
  const [activeType, setActiveType] = useState<ImportType | null>(null)
  const [bbNumberFormat, setBbNumberFormat] = useState<'auto' | BreakbulkNumberFormat>('auto')
  const [vaziosManifestNumbers, setVaziosManifestNumbers] = useState<Record<string, string>>({})
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { profile } = useAuth()
  const canEditVazios = Boolean(profile || userId)
  const canEditVehicles = Boolean(profile || userId)
  const allowedTypes = IMPORT_ORDER.filter((type) => {
    if (!types.includes(type)) return false
    if (type === 'vaziosExp') return canEditVazios
    if (type === 'vehicles') return canEditVehicles
    return Boolean(profile || userId)
  })
  const bbParseOptions = useMemo<ParseBreakbulkOptions>(
    () => (bbNumberFormat === 'auto' ? {} : { numberFormat: bbNumberFormat }),
    [bbNumberFormat],
  )
  const parseBbManifest = useCallback(
    (file: File) => (bbNumberFormat === 'auto' ? parseBreakbulkManifestFile(file) : parseBreakbulkManifestFile(file, bbParseOptions)),
    [bbNumberFormat, bbParseOptions],
  )
  const actionGroups: Array<{ group: ImportGroup; types: ImportType[] }> = []
  for (const type of allowedTypes) {
    const group = IMPORT_GROUP_BY_TYPE[type]
    const current = actionGroups[actionGroups.length - 1]
    if (current?.group === group) current.types.push(type)
    else actionGroups.push({ group, types: [type] })
  }

  const invalidateAfterBLImport = () => afterManifestoImportado(queryClient, { voyageId })

  return (
    <>
      <div className="app-import-actions" role="group" aria-label="Importações da viagem">
        {actionGroups.map(({ group, types: groupTypes }, groupIndex) => (
          <div key={group} className="app-import-actions__group">
            {groupIndex > 0 ? <span aria-hidden="true" className="app-import-actions__sep mx-1 h-6 w-px self-center bg-[var(--app-border)]" /> : null}
            {groupTypes.map((type) => {
              const Icon = IMPORT_ICONS[type]
              return (
                <Button key={type} variant="secondary" onClick={() => type === 'vaziosExp' ? navigate(`/embarquevazios?voyage=${voyageId}`) : setActiveType(type)}>
                  <Icon size={14} aria-hidden="true" />
                  {IMPORT_LABELS[type]}
                </Button>
              )
            })}
          </div>
        ))}
      </div>

      {activeType === 'bb' ? (
        <FileImportModal
          title="Importar manifesto BB (carga solta)"
          subtitle={<ImportContext label="Viagem">{voyageLabel}</ImportContext>}
          confirmLabel="Importar manifesto"
          accept=".xlsx,.xls,.csv"
          parser={parseBbManifest}
          reparseKey={bbNumberFormat}
          inspectFile={inspectImportUpload}
          prerequisite={
            <Field
              label="Formato numérico do arquivo"
              hint={bbNumberFormat === 'auto'
                ? 'Detectar usa a evidência do próprio arquivo e recusa a linha quando ela não basta — "259.312" pode ser 259 mil ou 259,312. Declarar o formato resolve.'
                : 'A leitura inteira usa este separador decimal. Se o arquivo contradisser, a importação é recusada em vez de corrigir sozinha.'}
            >
              <Select value={bbNumberFormat} onChange={(event) => setBbNumberFormat(event.target.value as typeof bbNumberFormat)}>
                <option value="auto">Detectar pelo arquivo</option>
                <option value="pt-BR">Vírgula decimal — 259,312 (pt-BR)</option>
                <option value="en-US">Ponto decimal — 259.312 (en-US)</option>
              </Select>
            </Field>
          }
          helper={<ImportGuide requiredLabel="Formato" required="planilha do manifesto BB (layout resumido, legado ou do armador)." templates={<ImportTemplateLinks baseName="manifesto-bb-modelo" />} />}
          canImport={(p, override) => p.bls.length > 0 && (!hasBlockingRowErrors(p.rowErrors) || Boolean(override))}
          getIssues={(p) => rowErrorsToImportIssues(p.rowErrors)}
          importer={async (preview, file, override) => {
            await importBreakbulkManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId, allowRowErrors: Boolean(override) })
            await invalidateAfterBLImport()
            showToast(`Manifesto BB importado: ${preview.bls.length} B/L(s).`, 'success')
          }}
          renderPreview={(preview) => {
            const errors = preview.rowErrors.filter((e) => (e.severity ?? 'error') === 'error').length
            return (
              <SummaryStrip
                label="Resumo do manifesto"
                items={[
                  { label: preview.bls.length === 1 ? 'B/L lido' : 'B/Ls lidos', value: preview.bls.length },
                  { label: errors === 1 ? 'linha com erro' : 'linhas com erro', value: errors, tone: errors ? 'danger' : 'default' },
                  { label: 'avisos', value: preview.rowErrors.length - errors, tone: preview.rowErrors.length - errors ? 'warning' : 'default' },
                ]}
              />
            )
          }}
          onClose={() => {
            setBbNumberFormat('auto')
            setActiveType(null)
          }}
        />
      ) : null}

      {activeType === 'granite' ? (
        <FileImportModal<Awaited<ReturnType<typeof parseGraniteManifestFile>>, Awaited<ReturnType<typeof importGraniteManifest>>>
          title="Importar manifesto Granito"
          subtitle={<ImportContext label="Viagem">{voyageLabel}</ImportContext>}
          confirmLabel="Importar manifesto"
          accept=".xlsx,.xls"
          parser={parseGraniteManifestFile}
          inspectFile={inspectImportUpload}
          canImport={(p, override) => p.bls.length > 0 && (p.rowErrors.length === 0 || Boolean(override))}
          getIssues={(p) => rowErrorsToImportIssues(p.rowErrors)}
          importer={async (preview, file, override) => {
            const result = await importGraniteManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId, allowRowErrors: Boolean(override) })
            await Promise.all([
              invalidateAfterBLImport(),
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
              queryClient.invalidateQueries({ queryKey: queryKeys.voyages.detail(voyageId) }),
              queryClient.invalidateQueries({ queryKey: ['granite-manifests'] }),
              // P0-4: alimenta "Carga carregada" no ADR.
              queryClient.invalidateQueries({ queryKey: ['agency-report'] }),
            ])
            showToast(`Manifesto Granito importado: ${preview.bls.length} B/L(s).`, 'success')
            return result
          }}
          renderPreview={(preview) => {
            const pending = preview.bls.filter((bl) => bl.reconciliationStatus !== 'matched').length
            return (
              <div className="grid gap-3">
                <ImportContext label="Declarado na planilha">
                  <span className="app-import-code">{preview.vesselVoyage || 'Não informado'}</span>
                </ImportContext>
                <SummaryStrip
                  label="Resumo do manifesto"
                  items={[
                    { label: preview.bls.length === 1 ? 'B/L' : 'B/Ls', value: preview.bls.length },
                    { label: 'blocos', value: preview.bls.reduce((sum, bl) => sum + Number(bl.blocks_qty ?? 0), 0).toLocaleString('pt-BR') },
                    { label: 't', value: (preview.bls.reduce((sum, bl) => sum + Number(bl.real_weight_kg ?? 0), 0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
                    { label: preview.rowErrors.length === 1 ? 'erro' : 'erros', value: preview.rowErrors.length, tone: preview.rowErrors.length ? 'danger' : 'default' },
                  ]}
                />
                {pending ? (
                  <ImportNotice tone="warning" title={`${plural(pending, 'B/L entra pendente', 'B/Ls entram pendentes')} de reconciliação`}>
                    O consignatário ainda não casou com um Cliente; o vínculo é revisado depois, antes de faturar.
                  </ImportNotice>
                ) : null}
              </div>
            )
          }}
          renderImportResult={(result) => result.pendingCount > 0 ? (
            <ImportNotice tone="warning" role="status" title={`Manifesto gravado; ${plural(result.pendingCount, 'B/L ficou pendente', 'B/Ls ficaram pendentes')} de reconciliação`}>
              Revise o vínculo do consignatário antes de faturar.
            </ImportNotice>
          ) : (
            <ImportNotice tone="success" role="status" title="Manifesto gravado">
              Nenhuma pendência de reconciliação.
            </ImportNotice>
          )}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'vaziosImp' ? (
        <FileImportModal
          title="Importar manifesto de vazios (importação)"
          subtitle={<ImportContext label="Viagem">{voyageLabel}</ImportContext>}
          confirmLabel="Importar manifesto"
          accept=".xlsx,.xls,.csv"
          parser={parseVaziosImportacaoFile}
          inspectFile={inspectImportUpload}
          helper={<VaziosImportacaoGuide />}
          canImport={(p, override) => resolveVaziosManifestNumbers(p, vaziosManifestNumbers).manifestos !== null && (p.rowErrors.length === 0 || Boolean(override))}
          getIssues={(p) => rowErrorsToImportIssues(p.rowErrors)}
          importer={async (preview, _file, override) => {
            await importVaziosImportacaoManifest({ manifest: preview, uploadedBy: userId, voyageId, manifestNumbers: vaziosManifestNumbers, allowRowErrors: Boolean(override) })
            setVaziosManifestNumbers({})
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
              queryClient.invalidateQueries({ queryKey: queryKeys.voyages.detail(voyageId) }),
              queryClient.invalidateQueries({ queryKey: ['vazios-importacao-stats'] }),
              queryClient.invalidateQueries({ queryKey: ['vazios-importacao-manifests'] }),
              queryClient.invalidateQueries({ queryKey: queryKeys.manifestosMercante.byVoyage(voyageId) }),
              queryClient.invalidateQueries({ queryKey: ['vazios-importacao-containers'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
              // P0-4: alimenta "Vazios descarregados" no ADR.
              queryClient.invalidateQueries({ queryKey: ['agency-report'] }),
            ])
            showToast(`Manifesto Vazios Imp. importado: ${preview.containers.length} container(s).`, 'success')
          }}
          renderPreview={(preview) => (
            <div className="grid gap-3">
              <SummaryStrip
                label="Resumo do manifesto"
                items={[
                  { label: preview.containers.length === 1 ? 'container' : 'containers', value: preview.containers.length },
                  { label: preview.rowErrors.length === 1 ? 'linha com erro' : 'linhas com erro', value: preview.rowErrors.length, tone: preview.rowErrors.length ? 'danger' : 'default' },
                ]}
              />
              <VaziosImportacaoManifestNumbers manifest={preview} values={vaziosManifestNumbers} onChange={setVaziosManifestNumbers} />
            </div>
          )}
          onClose={() => { setVaziosManifestNumbers({}); setActiveType(null) }}
        />
      ) : null}

      {activeType === 'baplie' ? (
        <BaplieImportModal
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          userId={userId}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'vehicles' && canEditVehicles ? (
        <VehiclesImportModal voyageId={voyageId} voyageLabel={voyageLabel} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'blFreight' ? (
        <BlImportModal
          open
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'blBreakbulk' ? (
        <BlDocumentImportModal
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'ceMercante' ? (
        <CeMercanteImportModal open lockedVoyageId={voyageId} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'ceMercanteGranite' ? (
        <CeMercanteImportModal open target="granite" lockedVoyageId={voyageId} onClose={() => setActiveType(null)} />
      ) : null}
    </>
  )
}

function BaplieImportModal({
  voyageId,
  voyageLabel,
  userId,
  onClose,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { file, preview: parsed, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<Awaited<ReturnType<typeof parseBaplieFile>>>(parseBaplieFile)
  const [importing, setImporting] = useState(false)
  const [excludedPods, setExcludedPods] = useState<Set<string>>(new Set())
  const [readError, setReadError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

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

  const pods = parsed?.pods ?? []
  const filteredContainers = (parsed?.containers ?? []).filter((c) => !c.pod || !excludedPods.has(c.pod))
  const includedPods = pods.filter((pod) => !excludedPods.has(pod)).length
  const issues = parsed?.issues ?? []
  const canImport = canImportPreview(filteredContainers.length > 0, issues)

  async function handleImport() {
    if (!canImport) return
    setImporting(true)
    setImportError(null)
    try {
      const result = await reimportBaplie({
        voyageId,
        containers: filteredContainers,
        actorId: userId,
        confirmReplacement: (plan) => confirm(baplieReplacementConfirmOptions(plan, filteredContainers.length)),
      })
      if (result.status === 'cancelled') return
      await afterBaplieImportado(queryClient, { voyageId: String(voyageId) })
      showToast(baplieImportToast(result), 'success')
      handleClose()
    } catch (err) {
      await afterBaplieImportado(queryClient, { voyageId: String(voyageId) })
      setImportError(err instanceof Error ? err.message : 'Falha ao importar Baplie EDI.')
    } finally {
      setImporting(false)
    }
  }

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (parsed && !canImport) footnote = filteredContainers.length ? 'Há erro na prévia; corrija o arquivo e escolha de novo.' : 'Nenhum container selecionado para importar.'
  else if (parsed) footnote = `${plural(filteredContainers.length, 'container será gravado', 'containers serão gravados')}. Se a viagem já tem Baplie, você confirma a substituição antes.`

  return (
    <Modal open onClose={handleClose} title="Importar Baplie EDI">
      <div className="app-import">
        <ImportContext label="Viagem">{voyageLabel}</ImportContext>
        <ImportFilePicker accept=".edi,.txt,.edi2,.bpl" files={file ? [file] : []} onFiles={(files) => void handleFiles(files)} disabled={importing} />
        {parsing ? <ImportReadProgress progress={progress} /> : null}
        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira se é o Baplie EDIFACT da viagem e escolha de novo.</p>
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
                  { label: includedPods === 1 ? 'porto de descarga' : 'portos de descarga', value: includedPods },
                ]}
              />
            }
          >
            <p className="app-import-inspection app-import-inspection__line">
              {parsed.vessel_name || parsed.voyage_number ? (
                <span>Navio/viagem no arquivo: <strong>{parsed.vessel_name ?? '—'} / {parsed.voyage_number ?? '—'}</strong></span>
              ) : null}
              <span>Encoding: <strong>{parsed.encoding}</strong></span>
            </p>
            {pods.length > 0 ? (
              <fieldset className="app-import-pods">
                <legend>Portos de descarga a importar (desmarque os que não são desta operação)</legend>
                {pods.map((pod) => (
                  <label key={pod}>
                    <input
                      type="checkbox"
                      checked={!excludedPods.has(pod)}
                      onChange={() => togglePod(pod)}
                    />
                    {pod}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <ImportIssuesPanel issues={issues} filename="baplie-issues.csv" />
          </ImportSection>
        ) : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{importError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}
        <div className="app-modal__actions">
          <ImportFootnote tone={parsed && !canImport ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          <Button variant="secondary" disabled={importing} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
          <Button disabled={!canImport || parsing} loading={importing} loadingLabel="Importando…" onClick={() => void handleImport()}>
            {canImport ? `Importar Baplie (${plural(filteredContainers.length, 'container', 'containers')})` : 'Importar Baplie'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function VehiclesImportModal({
  voyageId,
  voyageLabel,
  onClose,
}: {
  voyageId: number
  voyageLabel: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { file, preview, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<Awaited<ReturnType<typeof parseVehicleImportFile>>>(parseVehicleImportFile)
  const [importing, setImporting] = useState(false)
  const [allowOverride, setAllowOverride] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof importVehicleRows>> | null>(null)

  async function handleFiles(files: File[]) {
    setAllowOverride(false)
    setReadError(null)
    setImportError(null)
    setResult(null)
    try {
      await readFile(files[0] ?? null)
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Falha ao ler o arquivo.')
    }
  }

  function handleClose() {
    cancelReading()
    onClose()
  }

  const rowErrors = preview?.rowErrors.length ?? 0
  const canConfirm = Boolean(preview?.rows.length) && (rowErrors === 0 || allowOverride)

  async function handleImport() {
    if (!preview?.rows.length || (preview.rowErrors.length > 0 && !allowOverride)) return
    setImporting(true)
    setImportError(null)
    try {
      const nextResult = await importVehicleRows({ voyageId, rows: preview.rows })
      await afterCargaAlterada(queryClient)
      showToast(`Veículos importados: ${nextResult.successCount} gravado(s), ${nextResult.errorCount} recusado(s).`, nextResult.errorCount ? 'info' : 'success')
      // Com recusas o modal fica aberto e lista o que não entrou.
      if (nextResult.errorCount) setResult(nextResult)
      else onClose()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Falha ao importar veículos.')
    } finally {
      setImporting(false)
    }
  }

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (result) footnote = 'Importação gravada em parte. As linhas recusadas estão acima.'
  else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (preview && rowErrors && !allowOverride) footnote = 'Há linhas com erro: corrija a planilha ou marque o aceite para importar só as válidas.'
  else if (preview?.rows.length) footnote = `${plural(preview.rows.length, 'veículo será gravado', 'veículos serão gravados')}. Nada foi gravado ainda.`

  return (
    <Modal open onClose={handleClose} title="Importar planilha de veículos">
      <div className="app-import">
        <ImportContext label="Viagem">{voyageLabel}</ImportContext>
        <ImportGuide requiredLabel="Formato" required="Daily Report de veículos do armador (uma linha por chassi)." templates={<ImportTemplateLinks baseName="veiculos-modelo" />} />
        <ImportFilePicker accept=".xlsx,.xls,.csv" files={file ? [file] : []} onFiles={(files) => void handleFiles(files)} disabled={importing || Boolean(result)} />
        {parsing ? <ImportReadProgress progress={progress} /> : null}
        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira o formato e escolha o arquivo de novo.</p>
          </ImportNotice>
        ) : null}
        {preview ? (
          <ImportSection
            title={result ? 'Resultado' : 'Prévia'}
            aside={
              <SummaryStrip
                label={result ? 'Resultado da importação' : 'Resumo da planilha'}
                items={result ? [
                  { label: 'gravados', value: result.successCount },
                  { label: 'recusados', value: result.errorCount, tone: result.errorCount ? 'danger' : 'default' },
                ] : [
                  { label: preview.rows.length === 1 ? 'veículo' : 'veículos', value: preview.rows.length },
                  { label: rowErrors === 1 ? 'linha com erro' : 'linhas com erro', value: rowErrors, tone: rowErrors ? 'danger' : 'default' },
                ]}
              />
            }
          >
            {result?.errors.length ? (
              <ImportIssuesPanel
                issues={rowErrorsToImportIssues(result.errors)}
                filename="veiculos-recusados.csv"
                title={`${plural(result.errors.length, 'linha recusada', 'linhas recusadas')} ao gravar`}
                hint="Os demais veículos foram gravados. Corrija estas linhas e importe uma planilha só com elas."
              />
            ) : (
              <ImportIssuesPanel issues={rowErrorsToImportIssues(preview.rowErrors)} filename="veiculos-issues.csv" />
            )}
          </ImportSection>
        ) : null}
        {!result && preview && preview.rows.length > 0 && rowErrors > 0 ? (
          <label className="app-import-override">
            <input
              type="checkbox"
              checked={allowOverride}
              onChange={(e) => setAllowOverride(e.target.checked)}
            />
            <span>
              <span className="app-import-override__title">Estou ciente das divergências/erros encontrados e desejo forçar a importação</span>
              <span className="app-import-override__hint">Só as linhas válidas são gravadas; as linhas com erro ficam de fora e continuam no relatório.</span>
            </span>
          </label>
        ) : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{importError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}
        <div className="app-modal__actions">
          <ImportFootnote tone={result || (preview && rowErrors && !allowOverride) ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          {result ? (
            <Button onClick={onClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={importing} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
              <Button disabled={!canConfirm || parsing} loading={importing} loadingLabel="Importando…" onClick={() => void handleImport()}>
                {preview?.rows.length ? `Importar ${plural(preview.rows.length, 'veículo', 'veículos')}` : 'Importar veículos'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
