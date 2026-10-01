import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileImportModal, type FilePreviewEntry } from './FileImportModal'
import { VoyageCombobox } from './VoyageCombobox'
import { PreviewBox } from '../ui/PreviewBox'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageOptions } from '../../hooks/useBls'
import { formatCnpj } from '../../lib/cnpj'
import { formatNcm } from '../../lib/ncm'
import { afterManifestoImportado } from '../../services/cacheEffects'
import { describeVoyageMismatch, importBlDocuments, type BlDocumentVoyage } from '../../services/blDocumentImport'
import { parseBlDocumentFile, type ParsedBlDocument } from '../../services/blDocumentParser'

/**
 * Importação de B/L avulso de carga solta: um arquivo por conhecimento, no
 * documento que o armador emite (.pdf ou .docx). A importação de manifesto BB
 * continua na mesma tela — este caminho existe para quando a viagem chega em
 * B/Ls soltos, e não em uma planilha consolidada.
 */
export function BlDocumentImportModal({
  onClose,
  voyageId = null,
  voyageLabel,
}: {
  onClose: () => void
  voyageId?: number | null
  voyageLabel?: string
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: voyages } = useVoyageOptions()
  const [selectedVoyageId, setSelectedVoyageId] = useState(voyageId == null ? '' : String(voyageId))
  const lockedVoyage = voyageId != null

  const selectedVoyage = useMemo(
    () => (voyages ?? []).find((voyage) => String(voyage.id) === selectedVoyageId) ?? null,
    [voyages, selectedVoyageId],
  )

  function close() {
    setSelectedVoyageId(lockedVoyage ? String(voyageId) : '')
    onClose()
  }

  return (
    <FileImportModal<ParsedBlDocument>
      multiple
      title="Importar B/Ls de carga solta"
      accept=".pdf,.docx"
      ready={Boolean(selectedVoyageId && user)}
      prerequisite={
        <VoyageCombobox
          required
          label="Viagem de destino"
          initialValue={voyageLabel}
          selectedVoyageId={selectedVoyageId}
          disabled={lockedVoyage}
          onSelect={(id) => setSelectedVoyageId(id == null ? '' : String(id))}
        />
      }
      parser={parseBlDocumentFile}
      batchImporter={async (entries, allowOverride) => {
        if (!user || !selectedVoyageId) return
        await importBlDocuments({
          filename: entries.map((entry) => entry.file.name).join(', '),
          voyageId: Number(selectedVoyageId),
          documents: entries.map((entry) => entry.preview),
          uploadedBy: user.id,
          allowRowErrors: Boolean(allowOverride),
        })
        await afterManifestoImportado(queryClient, { voyageId: selectedVoyageId })
        showToast(`${entries.length} B/L(s) importado(s) como carga solta.`, 'success')
      }}
      canImport={(document, allowOverride) => (
        document.errors.length === 0 &&
        !describeVoyageMismatch(document, selectedVoyage) &&
        (document.warnings.length === 0 || Boolean(allowOverride))
      )}
      renderBatchSummary={(entries) => (
        <BatchSummary
          entries={entries}
          canImport={(document) => (
            document.errors.length === 0 &&
            !describeVoyageMismatch(document, selectedVoyage) &&
            document.warnings.length === 0
          )}
        />
      )}
      renderPreview={(document) => <BlDocumentPreview document={document} voyage={selectedVoyage} />}
      helper={
        <div className="app-panel app-panel--padded text-sm">
          <div className="app-panel__title">Formatos aceitos</div>
          <div className="mt-2">
            O B/L do armador em <strong>.pdf</strong> (formulário com os campos numerados) ou em{' '}
            <strong>.docx</strong> (formulário preenchido em caixas de texto). Vários arquivos podem ser
            enviados de uma vez — cada um vira um B/L.
          </div>
          <div className="app-panel__meta mt-2">
            O CE Mercante não vem no B/L: continua entrando pela importação de CE Mercante, e uma
            reimportação do B/L não apaga o CE já gravado.
          </div>
        </div>
      }
      onClose={close}
    />
  )
}

function BatchSummary({
  entries,
  canImport,
}: {
  entries: FilePreviewEntry<ParsedBlDocument>[]
  canImport: (document: ParsedBlDocument, allowOverride?: boolean) => boolean
}) {
  const ready = entries.filter((entry) => canImport(entry.preview))
  const withWarnings = entries.filter((entry) => entry.preview.warnings.length > 0 && canImport(entry.preview, true))

  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      <PreviewBox label="Arquivos lidos" value={entries.length} variant="metric-strip" />
      <PreviewBox label="Prontos para importar" value={ready.length} variant="metric-strip" />
      <PreviewBox label="Com pendência" value={entries.length - ready.length} variant="metric-strip" />
      <PreviewBox label="Com aviso" value={withWarnings.length} variant="metric-strip" />
    </div>
  )
}

function BlDocumentPreview({
  document,
  voyage,
}: {
  document: ParsedBlDocument
  voyage: BlDocumentVoyage | null
}) {
  const mismatch = describeVoyageMismatch(document, voyage)

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        <PreviewBox label="B/L" value={document.bl_id || '-'} variant="metric-strip" />
        <PreviewBox label="Navio / Viagem" value={formatVessel(document)} variant="metric-strip" />
        <PreviewBox label="Rota" value={`${document.pol ?? '-'} → ${document.pod ?? '-'}`} variant="metric-strip" />
        <PreviewBox label="Packages" value={formatNumber(document.packages_qty)} variant="metric-strip" />
        <PreviewBox label="Peso (kg)" value={formatNumber(document.gross_weight_kg)} variant="metric-strip" />
        <PreviewBox label="CBM (M3)" value={formatNumber(document.total_cbm)} variant="metric-strip" />
      </div>

      {document.errors.length ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {document.errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
          <div className="mt-1">Este arquivo não será importado.</div>
        </div>
      ) : null}

      {mismatch ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {mismatch}
          <div className="mt-1">Este arquivo não será importado.</div>
        </div>
      ) : null}

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <PreviewField label="Shipper" value={document.shipper} />
        <PreviewField label="Consignee" value={document.consignee} />
        <PreviewField label="Notify" value={document.notify_party} />
        <PreviewField label="CNPJ do consignatário" value={document.cnpj_cpf ? formatCnpj(document.cnpj_cpf) : null} />
        <PreviewField label="Marcas" value={document.marks} />
        <PreviewField label="Máquinas" value={formatNullable(document.machine_qty)} />
        <PreviewField label="Frete" value={document.freight_terms} />
        <PreviewField label="Vias originais" value={formatNullable(document.originals)} />
        <PreviewField label="NCM" value={document.ncm_codes.map(formatNcm).join(', ') || null} />
        <PreviewField label="Local e data de emissão" value={document.place_and_date_of_issue} />
      </dl>

      <PreviewBlock label="Descrição da carga" value={document.cargo_description} />
      <PreviewBlock label="Ressalvas do navio" value={document.remarks} />

      {document.warnings.length ? (
        <div className="max-h-44 overflow-auto rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {document.warnings.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PreviewField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-[var(--app-border)] px-3 py-2">
      <dt className="text-xs uppercase tracking-wider text-[var(--app-muted)]">{label}</dt>
      <dd className="mt-0.5 text-[var(--app-text-strong)]">{value || '-'}</dd>
    </div>
  )
}

function PreviewBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm">
      <div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">{label}</div>
      <div className="mt-1 whitespace-pre-line text-[var(--app-text-strong)]">{value}</div>
    </div>
  )
}


function formatVessel(document: ParsedBlDocument) {
  if (!document.vessel_name) return '-'
  return document.voyage_number ? `${document.vessel_name} / ${document.voyage_number}` : document.vessel_name
}

function formatNumber(value: number | null) {
  return value === null ? '-' : Number(value).toLocaleString('pt-BR')
}

function formatNullable(value: number | null) {
  return value === null ? null : Number(value).toLocaleString('pt-BR')
}
