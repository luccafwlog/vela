import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileImportModal } from './FileImportModal'
import { ImportContext, ImportGuide, ImportSection, ImportTemplateLinks } from './ImportParts'
import { VoyageCombobox } from './VoyageCombobox'
import { TruncationNote } from './TruncationNote'
import { BreakbulkImportOutcome, BreakbulkReimportReview } from './BreakbulkReimportReview'
import { plural } from './importPresentation'
import { Field, Select } from '../ui/Input'
import { SummaryStrip } from '../ui/SummaryStrip'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  hasBlockingRowErrors,
  importBreakbulkManifest,
  parseBreakbulkManifestFile,
  NO_BREAKBULK_APPROVAL,
  withBreakbulkReimportCheck,
  type BreakbulkApproval,
  type BreakbulkImportResult,
  type BreakbulkNumberFormat,
  type ParseBreakbulkOptions,
  type ParsedBreakbulkManifest,
} from '../../services/breakbulkImport'
import { afterManifestoImportado } from '../../services/cacheEffects'
import { rowErrorsToImportIssues } from '../../services/importValidation'

/** Viagem fixa de quem abre pela Viagem (aba Importação/Exportação). */
export type FixedImportVoyage = { id: number; label: string }

/**
 * Importar manifesto BB (carga solta): o mesmo modal no menu Importar de /bls
 * (viagem escolhida aqui) e na aba da Viagem (viagem fixa). A leitura, o
 * bloqueio por erro e o resultado são do `FileImportModal`; aqui ficam a
 * viagem, o formato numérico e a prévia com a situação de cada B/L.
 *
 * Regra de 2026-10-19 (ADR 0091): qualquer linha com erro recusa o arquivo
 * inteiro. B/L cancelado é aviso (D1): a linha não é tocada e o resto entra.
 */
export function BreakbulkManifestImportModal({
  voyage,
  defaultVoyageId,
  userId,
  onClose,
}: {
  voyage?: FixedImportVoyage
  defaultVoyageId?: string
  /** Quem grava; sem ele, o usuário da sessão. */
  userId?: string
  onClose: () => void
}) {
  const [chosenVoyageId, setChosenVoyageId] = useState(defaultVoyageId ?? '')
  const voyageId = voyage ? String(voyage.id) : chosenVoyageId
  // 'auto' lê pela evidência do arquivo e BLOQUEIA o que a evidência não
  // resolve; declarar o formato é o que desfaz a ambiguidade de vez. Ver
  // `readNumericColumns` em breakbulkManifestParser.ts.
  const [numberFormat, setNumberFormat] = useState<'auto' | BreakbulkNumberFormat>('auto')
  const [approval, setApproval] = useState<BreakbulkApproval>(NO_BREAKBULK_APPROVAL)
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const uploadedBy = userId ?? user?.id ?? null
  const { showToast } = useToast()
  const parseOptions = useMemo<ParseBreakbulkOptions>(
    () => (numberFormat === 'auto' ? {} : { numberFormat }),
    [numberFormat],
  )
  // A prévia confere o arquivo com os B/Ls já gravados da viagem.
  const parseManifest = useCallback(
    async (file: File) => {
      const manifest = await (numberFormat === 'auto' ? parseBreakbulkManifestFile(file) : parseBreakbulkManifestFile(file, parseOptions))
      return voyageId ? withBreakbulkReimportCheck(manifest, Number(voyageId)) : manifest
    },
    [numberFormat, parseOptions, voyageId],
  )

  return (
    <FileImportModal<ParsedBreakbulkManifest, BreakbulkImportResult>
      issuesFilename="manifesto-bb-issues.csv"
      title="Importar manifesto BB (carga solta)"
      subtitle={voyage ? <ImportContext label="Viagem">{voyage.label}</ImportContext> : undefined}
      accept=".xlsx,.xls,.csv"
      parser={parseManifest}
      reparseKey={`${numberFormat}:${voyageId}`}
      importer={async (manifest, file) => {
        if (!uploadedBy || !voyageId) throw new Error('Escolha a viagem de destino.')
        const result = await importBreakbulkManifest({
          filename: file.name,
          voyageId: Number(voyageId),
          manifest,
          uploadedBy,
          approval,
        })
        await afterManifestoImportado(queryClient, { voyageId })
        showToast(`Manifesto BB importado: ${plural(manifest.bls.length, 'B/L', 'B/Ls')}.`, 'success')
        return result
      }}
      renderImportResult={(result) => (
        <ImportSection title="Resultado">
          <BreakbulkImportOutcome result={result} />
        </ImportSection>
      )}
      canImport={(manifest) => !hasBlockingRowErrors(manifest.rowErrors)}
      // Só B/Ls cancelados (aviso): nada a gravar, mas não é erro no arquivo.
      nothingToImport={(entries) => (entries.every((entry) => entry.preview.bls.length === 0) ? 'Nenhum B/L a importar.' : null)}
      getIssues={(manifest) => rowErrorsToImportIssues(manifest.rowErrors)}
      ready={Boolean(voyageId && uploadedBy)}
      notReadyReason="Escolha a viagem de destino para ler o arquivo: a prévia confere os B/Ls já gravados nela."
      confirmLabel={(entries) => entries[0]?.preview.bls.length ? `Importar ${plural(entries[0].preview.bls.length, 'B/L', 'B/Ls')}` : 'Importar B/Ls'}
      // Travados na gravação e depois do resultado: trocar a viagem ou o
      // formato relia o arquivo e reabria o Importar para outro destino.
      prerequisite={({ locked }) => (
        <div className="grid gap-3 sm:grid-cols-2">
          {voyage ? null : (
            <VoyageCombobox
              required
              label="Viagem de destino"
              disabled={locked}
              selectedVoyageId={chosenVoyageId}
              onSelect={(id) => setChosenVoyageId(id == null ? '' : String(id))}
            />
          )}
          <Field
            label="Formato numérico do arquivo"
            hint={numberFormat === 'auto'
              ? 'Valores como "259.312" (259 mil ou 259,312) são recusados até você declarar o formato.'
              : 'Se o arquivo contradisser o formato declarado, a importação é recusada.'}
          >
            <Select value={numberFormat} disabled={locked} onChange={(event) => setNumberFormat(event.target.value as typeof numberFormat)}>
              <option value="auto">Detectar pelo arquivo</option>
              <option value="pt-BR">1.234,56 (vírgula decimal)</option>
              <option value="en-US">1,234.56 (ponto decimal)</option>
            </Select>
          </Field>
        </div>
      )}
      renderPreview={(manifest) => (
        <>
          <BreakbulkReimportReview
            check={manifest.reimport}
            approval={approval}
            onApprovalChange={setApproval}
          />
          <BreakbulkPreview manifest={manifest} />
        </>
      )}
      templates={<ImportTemplateLinks baseName="carga-solta-modelo" />}
      helper={
        <ImportGuide
          required="BL, MAQUINAS, PACKAGES, PACKAGES TOTAL, WEIGHT (TON), CBM (M3), SHIPPER, CONSIGNEE, NOTIFY."
          optional="CNPJ, POL, POD."
          details={
            <p>
              Aceita o layout resumido, o legado e o do armador. Cada linha cria ou corrige um B/L de carga solta da
              viagem; um B/L que já tem containers passa a misto. O CE Mercante não vem no manifesto: entra pela
              importação de CE Mercante (uma coluna CE num arquivo antigo é ignorada, com aviso). Reimportar não apaga
              CE, Cliente vinculado nem observações. B/L cancelado não é tocado: aparece como aviso e o resto do arquivo
              entra.
            </p>
          }
        />
      }
      onClose={onClose}
    />
  )
}

const sum = (manifest: ParsedBreakbulkManifest, pick: (bl: ParsedBreakbulkManifest['bls'][number]) => number | null | undefined) =>
  manifest.bls.reduce((total, bl) => total + Number(pick(bl) ?? 0), 0)

const PREVIEW_LIMIT = 25

function BreakbulkPreview({ manifest }: { manifest: ParsedBreakbulkManifest }) {
  const existing = new Set(manifest.reimport?.existing ?? [])
  const updates = manifest.bls.filter((bl) => existing.has(bl.bl_id)).length
  return (
    <ImportSection
      title="Prévia"
      aside={
        <SummaryStrip
          label="Resumo do manifesto"
          items={[
            { label: manifest.bls.length === 1 ? 'B/L' : 'B/Ls', value: manifest.bls.length },
            { label: updates === 1 ? 'atualiza' : 'atualizam', value: updates, tone: updates ? 'warning' : 'default' },
            { label: 'máquinas', value: formatBBNumber(sum(manifest, (bl) => bl.bb_machine_qty)) },
            { label: 'packages', value: formatBBNumber(sum(manifest, (bl) => bl.bb_packages_total ?? bl.bb_packages_qty)) },
            { label: 't', value: formatBBNumber(sum(manifest, (bl) => bl.bb_weight_ton)) },
            { label: 'm³', value: formatBBNumber(sum(manifest, (bl) => bl.bb_cbm)) },
          ]}
        />
      }
    >
      <div className="app-table-scroll max-h-72">
        <table className="app-table app-table--compact min-w-[1100px] whitespace-nowrap">
          <caption className="sr-only">Prévia do manifesto BB</caption>
          <thead>
            <tr>
              <th scope="col">Situação</th>
              <th scope="col">B/L</th>
              <th scope="col">Máquinas</th>
              <th scope="col">Packages</th>
              <th scope="col">Total de packages</th>
              <th scope="col">Peso (t)</th>
              <th scope="col">CBM (m³)</th>
              <th scope="col" className="app-table__text-head">Shipper</th>
              <th scope="col" className="app-table__text-head">Consignee</th>
              <th scope="col" className="app-table__text-head">Notify</th>
            </tr>
          </thead>
          <tbody>
            {manifest.bls.slice(0, PREVIEW_LIMIT).map((bl) => (
              <tr key={bl.bl_id}>
                <td>{existing.has(bl.bl_id) ? <StatusText tone="warning">Atualiza</StatusText> : <StatusText>Cria</StatusText>}</td>
                <td className="font-medium text-[var(--app-text-strong)]">{bl.bl_id}</td>
                <td className="tabular-nums">{bl.bb_machine_qty == null ? <NoValue label="Sem máquinas" /> : formatBBNumber(bl.bb_machine_qty)}</td>
                <td className="tabular-nums">{bl.bb_packages_qty == null ? <NoValue label="Sem packages" /> : formatBBNumber(bl.bb_packages_qty)}</td>
                <td className="tabular-nums">{bl.bb_packages_total == null ? <NoValue label="Sem total de packages" /> : formatBBNumber(bl.bb_packages_total)}</td>
                <td className="tabular-nums">{bl.bb_weight_ton == null ? <NoValue label="Sem peso" /> : formatBBNumber(bl.bb_weight_ton)}</td>
                <td className="tabular-nums">{bl.bb_cbm == null ? <NoValue label="Sem CBM" /> : formatBBNumber(bl.bb_cbm)}</td>
                <td className="app-table__text" title={bl.shipper ?? undefined}>{bl.shipper ?? <NoValue label="Sem shipper" />}</td>
                <td className="app-table__text" title={bl.consignee ?? undefined}>{bl.consignee ?? <NoValue label="Sem consignee" />}</td>
                <td className="app-table__text" title={bl.notify_party ?? undefined}>{bl.notify_party ?? <NoValue label="Sem notify" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationNote shown={PREVIEW_LIMIT} total={manifest.bls.length} noun="B/L" nounPlural="B/Ls" />
    </ImportSection>
  )
}

function formatBBNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('pt-BR')
}
