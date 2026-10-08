import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileImportModal } from '../shared/FileImportModal'
import { ImportGuide, ImportTemplateLinks } from '../shared/ImportParts'
import { VoyageCombobox } from '../shared/VoyageCombobox'
import { TruncationNote } from '../shared/TruncationNote'
import { Field, Select } from '../ui/Input'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  hasBlockingRowErrors,
  importBreakbulkManifest,
  parseBreakbulkManifestFile,
  type BreakbulkNumberFormat,
  type ParseBreakbulkOptions,
  type ParsedBreakbulkManifest,
} from '../../services/breakbulkImport'
import { afterManifestoImportado } from '../../services/cacheEffects'
import { inspectImportUpload } from '../../services/importText'
import { rowErrorsToImportIssues } from '../../services/importValidation'

/**
 * Importar Manifesto BB (carga solta), aberto pelo menu Importar de /bls. A
 * leitura, os erros por linha e o resultado são do `FileImportModal` (etapa
 * 04); aqui ficam a viagem de destino, o formato numérico e a prévia.
 */
export function BreakbulkManifestUploadModal({
  open,
  onClose,
  defaultVoyageId,
}: {
  open: boolean
  onClose: () => void
  defaultVoyageId?: string
}) {
  const [voyageId, setVoyageId] = useState(defaultVoyageId ?? '')
  // 'auto' lê pela evidência do arquivo e BLOQUEIA o que a evidência não
  // resolve; declarar o formato é o que desfaz a ambiguidade de vez. Ver
  // `readNumericColumns` em breakbulkManifestParser.ts.
  const [numberFormat, setNumberFormat] = useState<'auto' | BreakbulkNumberFormat>('auto')
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const parseOptions = useMemo<ParseBreakbulkOptions>(
    () => (numberFormat === 'auto' ? {} : { numberFormat }),
    [numberFormat],
  )
  const parseManifest = useCallback(
    (file: File) => parseBreakbulkManifestFile(file, parseOptions),
    [parseOptions],
  )

  if (!open) return null

  return (
    <FileImportModal
      title="Importar manifesto de carga solta (BB)"
      accept=".xlsx,.xls,.csv"
      parser={parseManifest}
      reparseKey={numberFormat}
      inspectFile={inspectImportUpload}
      importer={async (nextManifest, file, override) => {
        if (!user || !voyageId) return
        await importBreakbulkManifest({
          filename: file.name,
          voyageId: Number(voyageId),
          manifest: nextManifest,
          uploadedBy: user.id,
          allowRowErrors: Boolean(override),
        })
        await afterManifestoImportado(queryClient, { voyageId })
        showToast('Manifesto de carga solta importado.', 'success')
        setVoyageId('')
        setNumberFormat('auto')
        onClose()
      }}
      canImport={(nextManifest, override) =>
        nextManifest.bls.length > 0 && (!hasBlockingRowErrors(nextManifest.rowErrors) || Boolean(override))
      }
      getIssues={(nextManifest) => rowErrorsToImportIssues(nextManifest.rowErrors)}
      ready={Boolean(voyageId && user)}
      notReadyReason="Escolha a viagem de destino para liberar o arquivo."
      confirmLabel="Importar manifesto"
      prerequisite={
        <div className="grid gap-3 sm:grid-cols-2">
          <VoyageCombobox
            required
            label="Viagem de destino"
            selectedVoyageId={voyageId}
            onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
          />
          <Field
            label="Formato numérico do arquivo"
            hint={numberFormat === 'auto'
              ? 'Valores como "259.312" (259 mil ou 259,312) são recusados até você declarar o formato.'
              : 'Se o arquivo contradisser o formato declarado, a importação é recusada.'}
          >
            <Select value={numberFormat} onChange={(event) => setNumberFormat(event.target.value as typeof numberFormat)}>
              <option value="auto">Detectar pelo arquivo</option>
              <option value="pt-BR">Vírgula decimal — 259,312</option>
              <option value="en-US">Ponto decimal — 259.312</option>
            </Select>
          </Field>
        </div>
      }
      renderPreview={(nextManifest) => <BreakbulkPreview manifest={nextManifest} />}
      helper={
        <ImportGuide
          required="BL, CE, MAQUINAS, PACKAGES, PACKAGES TOTAL, WEIGHT (TON), CBM (M3), SHIPPER, CONSIGNEE, NOTIFY."
          optional="CNPJ, POL, POD."
          details={
            <p>
              Cada linha cria ou atualiza um B/L de carga solta da viagem escolhida; um B/L que já tem contêineres
              passa a misto. Os CEs podem vir na planilha ou depois, pela importação de CE Mercante.
            </p>
          }
          templates={<ImportTemplateLinks baseName="carga-solta-modelo" />}
        />
      }
      onClose={() => {
        setVoyageId('')
        setNumberFormat('auto')
        onClose()
      }}
    />
  )
}

const sum = (manifest: ParsedBreakbulkManifest, pick: (bl: ParsedBreakbulkManifest['bls'][number]) => number | null | undefined) =>
  manifest.bls.reduce((total, bl) => total + Number(pick(bl) ?? 0), 0)

function BreakbulkPreview({ manifest }: { manifest: ParsedBreakbulkManifest }) {
  const numeric = ['Máquinas', 'Packages', 'Total de packages', 'Peso (t)', 'CBM (m³)']
  return (
    <section className="app-import-section" aria-label="Prévia do manifesto">
      <div className="app-import-section__head">
        <h3 className="app-import-section__title">Prévia</h3>
        <SummaryStrip
          label="Resumo do manifesto"
          items={[
            { label: manifest.bls.length === 1 ? 'B/L válido' : 'B/Ls válidos', value: manifest.bls.length },
            { label: 'máquinas', value: formatBBNumber(sum(manifest, (bl) => bl.bb_machine_qty)) },
            { label: 'packages', value: formatBBNumber(sum(manifest, (bl) => bl.bb_packages_total ?? bl.bb_packages_qty)) },
            { label: 't', value: formatBBNumber(sum(manifest, (bl) => bl.bb_weight_ton)) },
            { label: 'm³', value: formatBBNumber(sum(manifest, (bl) => bl.bb_cbm)) },
          ]}
        />
      </div>
      <div className="app-table-scroll max-h-72">
        <table className="app-table app-table--compact min-w-[1100px] text-left whitespace-nowrap">
          <thead>
            <tr>
              {['B/L', 'CE', ...numeric, 'Shipper', 'Consignee', 'Notify'].map((label) => (
                <th key={label} scope="col" className={numeric.includes(label) ? 'text-right' : undefined}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {manifest.bls.slice(0, 25).map((bl) => (
              <tr key={bl.bl_id}>
                <td className="font-medium text-[var(--app-text-strong)]">{bl.bl_id}</td>
                <td className="app-bl-code">{bl.ce_mercante ?? '—'}</td>
                <td className="text-right tabular-nums">{formatBBNumber(bl.bb_machine_qty)}</td>
                <td className="text-right tabular-nums">{formatBBNumber(bl.bb_packages_qty)}</td>
                <td className="text-right tabular-nums">{formatBBNumber(bl.bb_packages_total)}</td>
                <td className="text-right tabular-nums">{formatBBNumber(bl.bb_weight_ton)}</td>
                <td className="text-right tabular-nums">{formatBBNumber(bl.bb_cbm)}</td>
                <td>{bl.shipper ?? '—'}</td>
                <td>{bl.consignee ?? '—'}</td>
                <td>{bl.notify_party ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationNote shown={25} total={manifest.bls.length} noun="B/L" nounPlural="B/Ls" />
    </section>
  )
}

function formatBBNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('pt-BR')
}
