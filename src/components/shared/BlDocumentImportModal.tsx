import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileImportModal, type FilePreviewEntry } from './FileImportModal'
import { VoyageCombobox } from './VoyageCombobox'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { ImportGuide, ImportNotice } from './ImportParts'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageOptions } from '../../hooks/useBls'
import { formatCnpj } from '../../lib/cnpj'
import { formatNcm } from '../../lib/ncm'
import { afterManifestoImportado } from '../../services/cacheEffects'
import { describeVoyageMismatch, importBlDocuments, type BlDocumentVoyage } from '../../services/blDocumentImport'
import { blDocumentToManifest, parseBlDocumentFile, type ParsedBlDocument } from '../../services/blDocumentParser'
import {
  checkBreakbulkReimport,
  describeBreakbulkPending,
  describeOtherVoyage,
  type BreakbulkReimportCheck,
} from '../../services/breakbulkImport'
import { BreakbulkReimportReview } from './BreakbulkReimportReview'

/** Documento lido e conferido com o B/L já gravado na viagem escolhida. */
type CheckedBlDocument = ParsedBlDocument & { reimport?: BreakbulkReimportCheck }

function isOtherVoyage(document: CheckedBlDocument) {
  return Boolean(document.reimport?.otherVoyage.length)
}

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
  const [acceptCustomerChanges, setAcceptCustomerChanges] = useState(false)
  const [overrideBilling, setOverrideBilling] = useState(false)
  const lockedVoyage = voyageId != null

  const selectedVoyage = useMemo(
    () => (voyages ?? []).find((voyage) => String(voyage.id) === selectedVoyageId) ?? null,
    [voyages, selectedVoyageId],
  )

  const parseDocument = useCallback(
    async (file: File): Promise<CheckedBlDocument> => {
      const document = await parseBlDocumentFile(file)
      if (!selectedVoyageId || !document.bl_id) return document
      return { ...document, reimport: await checkBreakbulkReimport(Number(selectedVoyageId), blDocumentToManifest(document)) }
    },
    [selectedVoyageId],
  )

  function close() {
    setSelectedVoyageId(lockedVoyage ? String(voyageId) : '')
    setAcceptCustomerChanges(false)
    setOverrideBilling(false)
    onClose()
  }

  return (
    <FileImportModal<CheckedBlDocument>
      multiple
      title="Importar B/Ls de carga solta"
      accept=".pdf,.docx"
      ready={Boolean(selectedVoyageId && user)}
      notReadyReason="Escolha a viagem de destino para liberar o arquivo."
      confirmLabel="Importar B/Ls"
      overrideHint="Os arquivos com aviso também entram, como foram lidos. Arquivos com erro ou de outra viagem continuam de fora."
      reparseKey={selectedVoyageId}
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
      parser={parseDocument}
      batchImporter={async (entries, allowOverride) => {
        if (!user || !selectedVoyageId) return
        const result = await importBlDocuments({
          filename: entries.map((entry) => entry.file.name).join(', '),
          voyageId: Number(selectedVoyageId),
          documents: entries.map((entry) => entry.preview),
          uploadedBy: user.id,
          allowRowErrors: Boolean(allowOverride),
          acceptCustomerChanges,
          overrideBilling,
        })
        await afterManifestoImportado(queryClient, { voyageId: selectedVoyageId })
        const pending = describeBreakbulkPending(result)
        showToast(
          pending.length
            ? `${entries.length} B/L(s) importado(s) como carga solta, com pendências: ${pending.join(' | ')}`
            : `${entries.length} B/L(s) importado(s) como carga solta.`,
          pending.length ? 'info' : 'success',
        )
      }}
      canImport={(document, allowOverride) => (
        document.errors.length === 0 &&
        !describeVoyageMismatch(document, selectedVoyage) &&
        !isOtherVoyage(document) &&
        (document.warnings.length === 0 || Boolean(allowOverride))
      )}
      renderBatchSummary={(entries) => (
        <BatchSummary
          entries={entries}
          canImport={(document) => (
            document.errors.length === 0 &&
            !describeVoyageMismatch(document, selectedVoyage) &&
            !isOtherVoyage(document) &&
            document.warnings.length === 0
          )}
        />
      )}
      renderPreview={(document) => (
        <>
          <BlDocumentPreview document={document} voyage={selectedVoyage} />
          <BreakbulkReimportReview
            check={document.reimport ? { ...document.reimport, otherVoyage: [] } : undefined}
            acceptCustomerChanges={acceptCustomerChanges}
            onAcceptCustomerChanges={setAcceptCustomerChanges}
            overrideBilling={overrideBilling}
            onOverrideBilling={setOverrideBilling}
          />
        </>
      )}
      helper={
        <ImportGuide
          requiredLabel="Formato"
          required={<>o B/L do armador em PDF (campos numerados) ou DOCX (caixas de texto). Cada arquivo vira um B/L.</>}
          details={
            <p>
              O CE Mercante não vem no B/L: ele entra depois por Importar CE Mercante. Reimportar o B/L corrige só o
              que o documento traz e não apaga CE, Cliente vinculado nem observações.
            </p>
          }
        />
      }
      onClose={close}
    />
  )
}

function BatchSummary({
  entries,
  canImport,
}: {
  entries: FilePreviewEntry<CheckedBlDocument>[]
  canImport: (document: CheckedBlDocument, allowOverride?: boolean) => boolean
}) {
  const ready = entries.filter((entry) => canImport(entry.preview)).length
  const withWarnings = entries.filter((entry) => entry.preview.warnings.length > 0 && canImport(entry.preview, true)).length
  const blocked = entries.length - ready - withWarnings

  return (
    <SummaryStrip
      label="Resumo dos arquivos lidos"
      items={[
        { label: entries.length === 1 ? 'arquivo lido' : 'arquivos lidos', value: entries.length },
        { label: 'prontos', value: ready },
        { label: 'com aviso', value: withWarnings, tone: withWarnings ? 'warning' : 'default' },
        { label: 'não entram', value: blocked, tone: blocked ? 'danger' : 'default' },
      ]}
    />
  )
}

function BlDocumentPreview({
  document,
  voyage,
}: {
  document: CheckedBlDocument
  voyage: BlDocumentVoyage | null
}) {
  const mismatch = describeVoyageMismatch(document, voyage)
  const otherVoyage = document.reimport?.otherVoyage ?? []

  return (
    <div className="grid gap-3">
      {document.errors.length || mismatch || otherVoyage.length ? (
        <ImportNotice tone="danger" role="alert" title="Este arquivo não será importado">
          <ul className="app-import-notice__list">
            {document.errors.map((message) => <li key={message}>{message}</li>)}
            {mismatch ? <li>{mismatch}</li> : null}
            {otherVoyage.map((entry) => <li key={entry.blId}>{describeOtherVoyage(entry)}</li>)}
          </ul>
        </ImportNotice>
      ) : null}

      <SummaryStrip
        label="Resumo do B/L"
        items={[
          { label: 'B/L', value: <span className="app-import-code">{document.bl_id || '—'}</span> },
          { label: 'navio / viagem', value: formatVessel(document) },
          { label: 'rota', value: `${document.pol ?? '—'} → ${document.pod ?? '—'}` },
          { label: 'packages', value: formatNumber(document.packages_qty) },
          { label: 'kg', value: formatNumber(document.gross_weight_kg) },
          { label: 'm³', value: formatNumber(document.total_cbm) },
        ]}
      />

      <dl className="app-import-facts">
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
        {document.cargo_description ? <PreviewField label="Descrição da carga" value={document.cargo_description} /> : null}
        {document.remarks ? <PreviewField label="Ressalvas do navio" value={document.remarks} /> : null}
      </dl>

      {document.warnings.length ? (
        <ImportNotice tone="warning" title={`${document.warnings.length} ${document.warnings.length === 1 ? 'aviso de leitura' : 'avisos de leitura'}`}>
          <ul className="app-import-notice__list">
            {document.warnings.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </ImportNotice>
      ) : null}
    </div>
  )
}

function PreviewField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  )
}

function formatVessel(document: ParsedBlDocument) {
  if (!document.vessel_name) return '—'
  return document.voyage_number ? `${document.vessel_name} / ${document.voyage_number}` : document.vessel_name
}

function formatNumber(value: number | null) {
  return value === null ? '—' : Number(value).toLocaleString('pt-BR')
}

function formatNullable(value: number | null) {
  return value === null ? null : Number(value).toLocaleString('pt-BR')
}
