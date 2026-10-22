// Persistência do B/L avulso de carga solta. Não há caminho próprio: o
// documento vira um manifesto BB de uma linha e segue pela mesma RPC
// transacional do manifesto, com a mesma reconciliação de cliente, a mesma
// trilha de lote e o mesmo disparo de taxas locais.
import { canonicalizeVesselName } from '../lib/vesselAlias'
import { supabase } from './supabase'
import { importBreakbulkManifest, type BreakbulkApproval, type BreakbulkImportManifest, type BreakbulkImportResult } from './breakbulkImport'
import { blDocumentToManifest, type ParsedBlDocument } from './blDocumentParser'

/** Viagem escolhida na tela, no formato que `useVoyageOptions` devolve. */
export type BlDocumentVoyage = {
  voyage_number: string
  vessel?: { name: string } | null
}

export async function importBlDocument({
  filename,
  voyageId,
  document,
  uploadedBy,
  acceptWarnings,
}: {
  filename: string
  voyageId: number
  document: ParsedBlDocument
  uploadedBy: string
  acceptWarnings?: boolean
}) {
  return importBlDocuments({
    filename,
    voyageId,
    documents: [document],
    uploadedBy,
    acceptWarnings,
  })
}

export async function importBlDocuments({
  filename,
  voyageId,
  documents,
  uploadedBy,
  acceptWarnings = false,
  approval,
  fileHash = null,
}: {
  filename: string
  voyageId: number
  documents: ParsedBlDocument[]
  uploadedBy: string
  /**
   * Aceite dos avisos de leitura. Erro nunca é aceito: um arquivo com erro
   * recusa o lote inteiro (regra de 2026-10-19, ADR 0092).
   */
  acceptWarnings?: boolean
  /** Trocas de Consignatário e rotas de B/L faturado confirmadas na prévia do lote. */
  approval?: BreakbulkApproval
  /** SHA-256 do arquivo (ADR 0095, decisão 3): gravado no lote; o reenvio só avisa na prévia. */
  fileHash?: string | null
}): Promise<BreakbulkImportResult> {
  const invalidDocument = documents.find((document) => document.errors.length > 0)
  if (invalidDocument) {
    throw new Error(`${filename}: ${invalidDocument.errors.join(' ')}`)
  }

  const warnedDocument = documents.find((document) => document.warnings.length > 0)
  if (warnedDocument && !acceptWarnings) {
    throw new Error(`${filename}: os avisos do documento pedem o aceite antes de importar: ${warnedDocument.warnings.join(' ')}`)
  }

  const voyage = await fetchVoyage(voyageId)
  const mismatch = documents
    .map((document) => describeVoyageMismatch(document, voyage))
    .find((reason): reason is string => Boolean(reason))
  if (mismatch) throw new Error(`${filename}: ${mismatch}`)

  const parsedManifests = documents.map((document, index) => {
    const manifest = blDocumentToManifest(document)
    return {
      ...manifest,
      bls: manifest.bls.map((bl) => ({ ...bl, rowNumber: index + 1 })),
      rowErrors: manifest.rowErrors.map((error) => ({ ...error, row: index + 1 })),
    }
  })
  const manifest: BreakbulkImportManifest = {
    layout: 'bl_document',
    bls: parsedManifests.flatMap((item) => item.bls),
    rowErrors: parsedManifests.flatMap((item) => item.rowErrors),
  }

  return importBreakbulkManifest({
    filename, voyageId, manifest, uploadedBy, approval, fileHash,
  })
}

async function fetchVoyage(voyageId: number): Promise<BlDocumentVoyage> {
  const { data, error } = await supabase
    .from('voyages')
    .select('voyage_number, vessel:vessels(name)')
    .eq('id', voyageId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Viagem selecionada não encontrada.')

  const voyage = data as unknown as {
    voyage_number: string | null
    vessel?: { name?: string | null } | null
  }
  return {
    voyage_number: voyage.voyage_number ?? '',
    vessel: voyage.vessel?.name ? { name: voyage.vessel.name } : null,
  }
}

/**
 * O B/L diz em que navio e viagem a carga embarcou; a viagem de destino é
 * escolhida na tela. Divergir é sinal de arquivo trocado, e a importação
 * documental de B/L de container já trata isso como bloqueio
 * (`blFreightImport.getDeclaredVoyageMismatchReason`) — carga solta segue o
 * mesmo contrato, inclusive no alias de prefixo do nome do navio.
 */
export function describeVoyageMismatch(document: ParsedBlDocument, voyage: BlDocumentVoyage | null) {
  if (!voyage) return null

  const documentVessel = canonicalizeVesselName(document.vessel_name ?? '')
  const selectedVessel = canonicalizeVesselName(voyage.vessel?.name ?? '')
  const vesselMismatch = Boolean(documentVessel && selectedVessel && documentVessel !== selectedVessel)
  const voyageMismatch = Boolean(
    document.voyage_number &&
      voyage.voyage_number &&
      normalizeVoyageNumber(document.voyage_number) !== normalizeVoyageNumber(voyage.voyage_number),
  )

  if (!vesselMismatch && !voyageMismatch) return null

  return `Arquivo é da viagem ${formatVoyageRef(document.vessel_name, document.voyage_number)}, mas você apontou ${formatVoyageRef(voyage.vessel?.name, voyage.voyage_number)}.`
}

// "V.33", "33" e "033" são a mesma viagem no papel do armador.
function normalizeVoyageNumber(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')
}

function formatVoyageRef(vessel?: string | null, voyage?: string | null) {
  const vesselLabel = String(vessel ?? '').trim() || 'Navio não informado'
  const voyageLabel = String(voyage ?? '').trim() || 'viagem não informada'
  return `${vesselLabel} / ${voyageLabel}`
}
