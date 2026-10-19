import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileImportModal, type FilePreviewEntry } from './FileImportModal'
import { VoyageCombobox } from './VoyageCombobox'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useToast } from '../ui/Toast'
import { ImportGuide, ImportNotice, ImportSection } from './ImportParts'
import { plural } from './importPresentation'
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
  describeCancelledBl,
  describeOtherVoyage,
  NO_BREAKBULK_APPROVAL,
  type BreakbulkApproval,
  type BreakbulkReimportCheck,
} from '../../services/breakbulkImport'
import { BreakbulkReimportReview } from './BreakbulkReimportReview'

/** Documento lido e conferido com o B/L já gravado na viagem escolhida. */
type CheckedBlDocument = ParsedBlDocument & { reimport?: BreakbulkReimportCheck }

function isOtherVoyage(document: CheckedBlDocument) {
  return Boolean(document.reimport?.otherVoyage.length)
}

/**
 * B/L cancelado é somente leitura: o arquivo não é tocado, como a linha do
 * Manifesto BB. É aviso (D1 da regra de 2026-10-19), não erro: os demais
 * arquivos do lote entram.
 */
function isCancelled(document: CheckedBlDocument) {
  return Boolean(document.reimport?.cancelled?.length)
}

/** Erro do arquivo: recusa o lote inteiro (regra de 2026-10-19, ADR 0091). */
function hasDocumentError(document: CheckedBlDocument, voyage: BlDocumentVoyage | null) {
  return document.errors.length > 0 || Boolean(describeVoyageMismatch(document, voyage)) || isOtherVoyage(document)
}

function hasDocumentWarning(document: CheckedBlDocument) {
  return document.warnings.length > 0 || isCancelled(document)
}

/**
 * Importação de B/L avulso de carga solta: um arquivo por conhecimento, no
 * documento que o armador emite (.pdf ou .docx). A importação de manifesto BB
 * continua na mesma tela — este caminho existe para quando a viagem chega em
 * B/Ls soltos, e não em uma planilha consolidada.
 *
 * Regra de 2026-10-19 (ADR 0091): um arquivo com erro (sem número de B/L, de
 * outro navio ou de outra viagem) recusa todos os do lote; aviso (leitura
 * incerta, B/L cancelado) pede o aceite e não impede os demais.
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
  const [approval, setApproval] = useState<BreakbulkApproval>(NO_BREAKBULK_APPROVAL)
  // B26 (ADR 0018, decisão 2): a viagem de contexto semeia o campo, que continua editável.
  const contextVoyage = voyageId != null

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
    setSelectedVoyageId(contextVoyage ? String(voyageId) : '')
    setApproval(NO_BREAKBULK_APPROVAL)
    onClose()
  }

  return (
    <FileImportModal<CheckedBlDocument>
      multiple
      title="Importar B/Ls de carga solta"
      accept=".pdf,.docx"
      ready={Boolean(selectedVoyageId && user)}
      notReadyReason="Escolha a viagem de destino para ler os arquivos: a prévia confere os B/Ls já gravados nela."
      confirmLabel={(entries) => {
        const count = entries.filter((entry) => !isCancelled(entry.preview)).length
        return count ? `Importar ${plural(count, 'B/L', 'B/Ls')}` : 'Importar B/Ls'
      }}
      overrideHint="Os arquivos com aviso entram como foram lidos; o B/L cancelado não é tocado e os demais entram."
      reparseKey={selectedVoyageId}
      prerequisite={
        <VoyageCombobox
          required
          label="Viagem de destino"
          initialValue={voyageLabel}
          selectedVoyageId={selectedVoyageId}
          onSelect={(id) => setSelectedVoyageId(id == null ? '' : String(id))}
        />
      }
      parser={parseDocument}
      batchImporter={async (entries, acceptWarnings) => {
        if (!user || !selectedVoyageId) return
        const result = await importBlDocuments({
          filename: entries.map((entry) => entry.file.name).join(', '),
          voyageId: Number(selectedVoyageId),
          documents: entries.map((entry) => entry.preview),
          uploadedBy: user.id,
          acceptWarnings: Boolean(acceptWarnings),
          approval,
        })
        await afterManifestoImportado(queryClient, { voyageId: selectedVoyageId })
        const pending = describeBreakbulkPending(result)
        const imported = result.inserted.length + result.updated.length + result.unchanged.length
        showToast(
          pending.length
            ? `${plural(imported, 'B/L importado', 'B/Ls importados')} como carga solta, com pendências: ${pending.join(' | ')}`
            : `${plural(imported, 'B/L importado', 'B/Ls importados')} como carga solta.`,
          pending.length ? 'info' : 'success',
        )
      }}
      canImport={(document, acceptWarnings) => (
        !hasDocumentError(document, selectedVoyage) &&
        (!hasDocumentWarning(document) || Boolean(acceptWarnings))
      )}
      renderBatchSummary={(entries) => (
        <>
          <BatchSummary entries={entries} voyage={selectedVoyage} />
          {/* A Troca de Consignatário e a confirmação de faturamento valem para o
              lote inteiro: a prévia lista os B/Ls de TODOS os arquivos que podem
              entrar, não só o do arquivo aberto. */}
          <BreakbulkReimportReview
            check={mergeReimportChecks(entries.map((entry) => entry.preview).filter((document) => (
              !hasDocumentError(document, selectedVoyage) && !isCancelled(document)
            )))}
            approval={approval}
            onApprovalChange={setApproval}
          />
        </>
      )}
      renderPreview={(document) => <BlDocumentPreview document={document} voyage={selectedVoyage} />}
      helper={
        <ImportGuide
          requiredLabel="Formato"
          required={<>o B/L do armador em PDF (campos numerados) ou DOCX (caixas de texto). Cada arquivo vira um B/L.</>}
          details={
            <p>
              O CE Mercante não vem no B/L: ele entra depois por Importar CE Mercante. Reimportar o B/L corrige só o
              que o documento traz e não apaga CE, Cliente vinculado nem observações. Com um arquivo com erro, nenhum
              arquivo do lote é importado.
            </p>
          }
        />
      }
      onClose={close}
    />
  )
}

/**
 * Junta a conferência de reimportação dos arquivos do lote: o aceite de Troca
 * de Consignatário e a confirmação de faturamento são do lote inteiro, então a
 * prévia precisa listar cada B/L afetado, de qualquer arquivo.
 */
function mergeReimportChecks(documents: CheckedBlDocument[]): BreakbulkReimportCheck | undefined {
  const checks = documents.map((document) => document.reimport).filter((check): check is BreakbulkReimportCheck => Boolean(check))
  if (!checks.length) return undefined
  return {
    existing: [...new Set(checks.flatMap((check) => check.existing))],
    otherVoyage: [],
    cancelled: [],
    customerChanges: checks.flatMap((check) => check.customerChanges),
    billedRouteChanges: checks.flatMap((check) => check.billedRouteChanges),
    codPodKept: [...new Set(checks.flatMap((check) => check.codPodKept))],
  }
}

function BatchSummary({
  entries,
  voyage,
}: {
  entries: FilePreviewEntry<CheckedBlDocument>[]
  voyage: BlDocumentVoyage | null
}) {
  const withError = entries.filter((entry) => hasDocumentError(entry.preview, voyage)).length
  const withWarnings = entries.filter((entry) => !hasDocumentError(entry.preview, voyage) && hasDocumentWarning(entry.preview)).length

  return (
    <SummaryStrip
      label="Resumo dos arquivos lidos"
      items={[
        { label: entries.length === 1 ? 'arquivo lido' : 'arquivos lidos', value: entries.length },
        { label: 'com erro', value: withError, tone: withError ? 'danger' : 'default' },
        { label: 'com aviso', value: withWarnings, tone: withWarnings ? 'warning' : 'default' },
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
  const cancelled = document.reimport?.cancelled ?? []

  return (
    <ImportSection
      title="Prévia"
      aside={
        <SummaryStrip
          label="Resumo do B/L"
          items={[
            { label: 'packages', value: formatNumber(document.packages_qty) },
            { label: 'kg', value: formatNumber(document.gross_weight_kg) },
            { label: 'm³', value: formatNumber(document.total_cbm) },
          ]}
        />
      }
    >
      {document.errors.length || mismatch || otherVoyage.length ? (
        <ImportNotice tone="danger" role="alert" title="Este arquivo tem erro: nenhum arquivo do lote é importado">
          <ul className="app-import-notice__list">
            {document.errors.map((message) => <li key={message}>{message}</li>)}
            {mismatch ? <li>{mismatch}</li> : null}
            {otherVoyage.map((entry) => <li key={entry.blId}>{describeOtherVoyage(entry)}</li>)}
          </ul>
          <p>Corrija ou tire este arquivo e escolha os arquivos de novo.</p>
        </ImportNotice>
      ) : null}

      {cancelled.length ? (
        <ImportNotice tone="warning" title="B/L cancelado: este arquivo não é tocado">
          <ul className="app-import-notice__list">
            {cancelled.map((blId) => <li key={blId}>{describeCancelledBl(blId)}</li>)}
          </ul>
        </ImportNotice>
      ) : null}

      <dl className="app-import-facts">
        <PreviewField label="B/L" value={document.bl_id || null} />
        <PreviewField label="Navio / viagem" value={formatVessel(document)} />
        <PreviewField label="Rota" value={`${document.pol ?? '—'} → ${document.pod ?? '—'}`} />
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
        <ImportNotice tone="warning" title={plural(document.warnings.length, 'aviso de leitura', 'avisos de leitura')}>
          <ul className="app-import-notice__list">
            {document.warnings.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </ImportNotice>
      ) : null}
    </ImportSection>
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
