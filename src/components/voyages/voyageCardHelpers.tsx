import {
  buildVoyagePolEntityId,
  buildVoyageRouteCeMasterKey,
  getVoyagePodCeStatusLabel,
  type VoyagePodCeStatus,
} from '../../services/voyageRouteSchedules'
import { formatPortDisplayName } from '../../lib/voyageFormat'
import { normalizePortCode } from '../../services/portCode'
import { collectVoyagePorts, type VoyageBl } from '../../services/voyageSummaries'
import type { ManifestoMercante } from '../../services/manifestosMercanteService'

type ManifestRouteRef = { pol: string; pod: string; isVazios: boolean; ceMaster: string | null; cargoMode?: ManifestRowCargoMode }

/** Natureza da linha de Rotas e Manifestos: cada uma tem os seus Manifestos Mercante. */
export type ManifestRowCargoMode = 'container' | 'carga_solta' | 'vazios'

/**
 * Natureza do Manifesto Mercante de um B/L (migration 592): o B/L misto vai no
 * Manifesto de carga solta, como no EDI Mercante (ADR 0116, item 8).
 */
export function manifestoCargoModeOfBl(cargoMode: string | null | undefined): 'container' | 'carga_solta' {
  return cargoMode === 'carga_solta' || cargoMode === 'misto' ? 'carga_solta' : 'container'
}

// A rota de vazios compartilha POL/POD com a de carga (ex.: Taicang -> Vitória),
// mas o manifesto Mercante é outro: casar só por POL/POD exibia o número da carga.
// Desde a migration 592, contêiner e carga solta da mesma rota também têm
// Manifestos próprios: cada linha mostra só os da sua natureza.
export function manifestosOfRoute(row: ManifestRouteRef, manifestos: ManifestoMercante[] | undefined) {
  const natureza = row.isVazios ? 'vazio' : 'carga'
  const cargoMode = row.isVazios ? null : (row.cargoMode === 'carga_solta' ? 'carga_solta' : 'container')
  const pol = normalizePortCode(row.pol) ?? row.pol
  const pod = normalizePortCode(row.pod) ?? row.pod
  return (manifestos ?? []).filter((m) =>
    (normalizePortCode(m.pol) ?? m.pol) === pol &&
    (normalizePortCode(m.pod) ?? m.pod) === pod && m.natureza === natureza &&
    (cargoMode === null || (m.cargo_mode ?? 'container') === cargoMode),
  )
}

/** Quantos números de manifesto a aba Rotas e Manifestos exibe para a rota. */
export function countRouteManifestNumbers(row: ManifestRouteRef, manifestos: ManifestoMercante[] | undefined) {
  const registered = manifestosOfRoute(row, manifestos).length
  if (registered > 0) return registered
  return String(row.ceMaster ?? '').trim() ? 1 : 0
}

export function renderEscalaNumber(value: string | null) {
  if (!value) return <span className="text-[var(--app-muted-soft)]">-</span>
  return <span className="font-mono text-xs text-[var(--app-text-strong)]">{value}</span>
}

export function formatPolDeparture(etd: string | null, atd: string | null) {
  return atd ? { value: atd, isActual: true as const } : { value: etd, isActual: false as const }
}

export function renderCeStatusLabel(status: VoyagePodCeStatus | null) {
  return getVoyagePodCeStatusLabel(status)
}

export function renderLinkedLabel(linked: boolean | null) {
  return linked ? 'Sim' : 'Não'
}

export type VoyageImportBatch = {
  id: number
  voyage_id: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  filename: string
  uploaded_at: string | null
  status: 'processing' | 'completed' | 'partial' | 'failed' | null
  total_bls: number | null
  ce_master: string | null
  route_summary?: string | null
}

export type VoyageRouteOmission = {
  id?: number
  omittedPod: string
  dischargePod: string
}

export type VoyageBlTransshipmentLink = {
  blId: string
  omissionId: number
}

export type OmissionRouteRole = 'omitted' | 'transshipment' | 'final'

export const OMISSION_ROUTE_ROLE_LABELS: Record<OmissionRouteRole, string> = {
  omitted: 'Omitida',
  transshipment: 'Transbordo',
  final: 'Destino Final',
}

/**
 * Trechos da rota com omissão (reunião de testes de 2026-10-26). A rota cujo
 * POD é o porto omitido é carga em transbordo: segue em navio de terceiro do
 * Porto de Transbordo até o destino final original,
 * `CNNSA → BRSSA (Omitida) → BRVIX (Transbordo) → BRSSA (Destino Final)`. A
 * rota cujo POD é o Porto de Transbordo é COD: o destino final passou a ser
 * ele (`set_bl_cod` grava o POD novo no B/L),
 * `CNNSA → BRSSA (Omitida) → BRVIX (Destino Final)`.
 */
export function omissionRouteParts(pol: string, pod: string, omission: VoyageRouteOmission): Array<{ port: string; role: OmissionRouteRole | null }> {
  const omitted = omission.omittedPod.trim().toUpperCase()
  const discharge = omission.dischargePod.trim().toUpperCase()
  const head = [{ port: pol, role: null }, { port: omitted, role: 'omitted' as const }]
  if (pod.trim().toUpperCase() === omitted) {
    return [...head, { port: discharge, role: 'transshipment' }, { port: omitted, role: 'final' }]
  }
  return [...head, { port: discharge, role: 'final' }]
}

export function collectVoyageManifestBatchRows({
  voyageId,
  batches,
  bls,
  polSchedules,
  routeCeMasters,
  omissions,
  transshipments,
  vaziosRoutes,
}: {
  voyageId: number
  batches: VoyageImportBatch[] | null | undefined
  bls: VoyageBl[] | null | undefined
  polSchedules?: Map<string, { etd: string | null; atd?: string | null; escalaNumber?: string | null }> | undefined
  /** CE Master por rota (#322): fallback para viagens só-B/L sem batch. Chave `${voyageId}::${POL}__${POD}`. */
  routeCeMasters?: Map<string, string> | undefined
  omissions?: VoyageRouteOmission[] | null | undefined
  transshipments?: VoyageBlTransshipmentLink[] | null | undefined
  vaziosRoutes?: Array<{ pol?: string | null; pod?: string | null; containerCount?: number }> | null | undefined
}) {
  const batchesById = new Map<number, VoyageImportBatch>()
  for (const batch of batches ?? []) {
    batchesById.set(batch.id, batch)
  }

  // A linha nasce da rota dos B/Ls; batches entram como metadados quando existem.
  // Assim importacoes de B/L sem arquivo de manifesto tambem aparecem na tela.
  type ManifestGroup = {
    routeKey: string
    pol: string
    pod: string
    routeLabel: string
    batchIds: number[]
    modes: Set<'container' | 'carga_solta' | 'misto'>
    etd: string | null
    atd: string | null
    blCount: number
    containerCount?: number
    ceFilled: number
    ceTotal: number
    ceMaster: string | null
    blIds: Set<string>
    sortDate: number
    cargoMode: ManifestRowCargoMode
    isVazios?: boolean
  }

  const groups = new Map<string, ManifestGroup>()

  function normalizeManifestPort(value: string | null | undefined) {
    return normalizePortCode(value) ?? (String(value ?? '').trim().toUpperCase() || '-')
  }

  // Uma linha por rota e natureza (migration 592): contêiner e carga solta da
  // mesma rota têm Manifestos e EDI próprios. A chave da linha de contêiner
  // continua `POL__POD`; a de carga solta ganha `__BB`.
  function getGroup(polValue: string | null | undefined, podValue: string | null | undefined, cargoMode: 'container' | 'carga_solta') {
    const pol = normalizeManifestPort(polValue)
    const pod = normalizeManifestPort(podValue)
    const routeKey = cargoMode === 'carga_solta' ? `${pol}__${pod}__BB` : `${pol}__${pod}`
    const existing = groups.get(routeKey)
    if (existing) return existing

    const polEntity = polSchedules?.get(buildVoyagePolEntityId(voyageId, pol))

    const group: ManifestGroup = {
      routeKey,
      pol,
      pod,
      routeLabel: `${formatPortDisplayName(pol)} → ${formatPortDisplayName(pod)}`,
      batchIds: [],
      modes: new Set(),
      etd: polEntity?.etd ?? null,
      atd: polEntity?.atd ?? null,
      blCount: 0,
      ceFilled: 0,
      ceTotal: 0,
      ceMaster: null,
      blIds: new Set(),
      sortDate: Number.POSITIVE_INFINITY,
      cargoMode,
    }

    groups.set(routeKey, group)
    return group
  }

  function attachBatchMetadata(group: ManifestGroup, batch: VoyageImportBatch) {
    // O arquivo de outra natureza (o B/L de contêiner que virou misto) não dá
    // o Nº nem recebe o Nº desta linha.
    if (batch.cargo_mode && batch.cargo_mode !== group.cargoMode) return
    if (!group.batchIds.includes(batch.id)) {
      group.batchIds.push(batch.id)
    }
    if (batch.cargo_mode) group.modes.add(batch.cargo_mode)
    if (!group.ceMaster && batch.ce_master) group.ceMaster = batch.ce_master
    const sortDate = Date.parse(batch.uploaded_at ?? '')
    if (Number.isFinite(sortDate)) group.sortDate = Math.min(group.sortDate, sortDate)
  }

  function findRouteOmission(pod: string, blIds: Set<string>) {
    const normalizedPod = pod.trim().toUpperCase()
    const linkedOmissionIds = new Set(
      (transshipments ?? [])
        .filter((link) => blIds.has(link.blId))
        .map((link) => link.omissionId),
    )
    return (omissions ?? []).find((omission) => {
      if (omission.id === undefined || !linkedOmissionIds.has(omission.id)) return false
      const omittedPod = omission.omittedPod.trim().toUpperCase()
      const dischargePod = omission.dischargePod.trim().toUpperCase()
      return normalizedPod === omittedPod || normalizedPod === dischargePod
    }) ?? null
  }

  for (const bl of bls ?? []) {
    const group = getGroup(bl.pol, bl.pod, manifestoCargoModeOfBl(bl.cargo_mode))
    group.blIds.add(bl.id)
    group.blCount += 1
    group.ceTotal += 1
    if (String(bl.ce_mercante ?? '').trim()) group.ceFilled += 1
    group.modes.add(bl.cargo_mode === 'misto' ? 'misto' : bl.cargo_mode === 'carga_solta' ? 'carga_solta' : 'container')

    if (bl.batch_id !== null && bl.batch_id !== undefined) {
      const batch = batchesById.get(bl.batch_id)
      if (batch) attachBatchMetadata(group, batch)
    }
  }

  for (const vazio of vaziosRoutes ?? []) {
    const pol = normalizeManifestPort(vazio.pol)
    const pod = normalizeManifestPort(vazio.pod)
    if (pol === '-' && pod === '-') continue
    const routeKey = `${pol}__${pod}__vazios`
    const polEntity = polSchedules?.get(buildVoyagePolEntityId(voyageId, pol))

    const group: ManifestGroup = {
      routeKey,
      pol,
      pod,
      routeLabel: `${formatPortDisplayName(pol)} → ${formatPortDisplayName(pod)}`,
      batchIds: [],
      modes: new Set(['container']),
      etd: polEntity?.etd ?? null,
      atd: polEntity?.atd ?? null,
      blCount: 0,
      containerCount: vazio.containerCount ?? 0,
      ceFilled: 0,
      ceTotal: 0,
      ceMaster: routeCeMasters?.get(`${voyageId}::${pol}__${pod}__VAZIOS`) ?? null,
      blIds: new Set(),
      sortDate: Number.POSITIVE_INFINITY,
      cargoMode: 'vazios',
      isVazios: true,
    }
    groups.set(routeKey, group)
  }

  return Array.from(groups.values())
    .map((group) => ({
      routeKey: group.routeKey,
      pol: group.pol,
      pod: group.pod,
      routeLabel: (() => {
        const omission = findRouteOmission(group.pod, group.blIds)
        if (!omission) return group.routeLabel
        return omissionRouteParts(group.pol, group.pod, omission)
          .map((part) => `${formatPortDisplayName(part.port)}${part.role ? ` (${OMISSION_ROUTE_ROLE_LABELS[part.role]})` : ''}`)
          .join(' → ')
      })(),
      omission: findRouteOmission(group.pod, group.blIds),
      modeLabel: group.isVazios ? 'VAZIOS' : group.cargoMode === 'carga_solta' ? 'BB' : 'CNTR',
      hasMisto: group.modes.has('misto'),
      cargoMode: group.cargoMode,
      containerCount: group.containerCount,
      isVazios: group.isVazios ?? false,
      batchIds: group.batchIds,
      etd: group.etd,
      atd: group.atd,
      blCount: group.blCount,
      ceFilled: group.ceFilled,
      ceTotal: group.ceTotal,
      // O espelho por rota é separado por natureza (migration 592) e vem antes da
      // cópia antiga gravada no lote: um lote editado na linha CNTR/BB podia
      // guardar o Nº da outra natureza.
      ceMaster: routeCeMasters?.get(buildVoyageRouteCeMasterKey(voyageId, group.pol, group.pod, group.cargoMode)) ?? group.ceMaster ?? null,
      sortDate: group.sortDate,
    }))
    .sort((left, right) => {
      if (Number.isFinite(left.sortDate) && Number.isFinite(right.sortDate) && left.sortDate !== right.sortDate) {
        return left.sortDate - right.sortDate
      }
      return left.routeLabel.localeCompare(right.routeLabel, 'pt-BR')
    })
}

export type VoyageRouteLegs = {
  importLeg: { originPorts: string[]; destinationPorts: string[] } | null
  exportLeg: { originPorts: string[]; destinationPorts: string[] } | null
}

/**
 * Rota do cabeçalho da viagem, uma linha por perna (ADR 0035, escala unificada):
 * importação = POL da carga -> escalas que descarregam; exportação = escalas que
 * embarcam -> portos de descarga declarados no cadastro da escala, somados aos
 * dos manifestos de exportação já importados. A perna de importação some só
 * quando não há nada que importe (nem carga, nem escala que descarrega) e a de
 * exportação existe; sem exportação ela aparece mesmo vazia, como
 * "Origem/Destino a definir".
 */
export function buildVoyageRouteLegs({
  bls,
  fallbackPol,
  escalas,
  exportDischargePorts,
}: {
  bls: Array<{ pol: string | null; pod: string | null }> | null | undefined
  fallbackPol: string | null
  escalas: Array<{ port: string; temImportacao: boolean; temExportacao: boolean; dischargePorts?: string[] }>
  exportDischargePorts: Array<string | null | undefined>
}): VoyageRouteLegs {
  const importEscalas = escalas.filter((escala) => escala.temImportacao || !escala.temExportacao)
  const exportEscalas = escalas.filter((escala) => escala.temExportacao)

  const importLeg = {
    originPorts: collectVoyagePorts(bls, 'pol', fallbackPol),
    destinationPorts: collectVoyagePorts(bls, 'pod', null, importEscalas),
  }
  const exportLeg = {
    originPorts: collectVoyagePorts(null, 'pol', null, exportEscalas),
    destinationPorts: collectVoyagePorts(null, 'pod', null, [
      ...exportEscalas.flatMap((escala) => escala.dischargePorts ?? []),
      ...exportDischargePorts,
    ]),
  }

  const hasExport = exportLeg.originPorts.length > 0 || exportLeg.destinationPorts.length > 0
  // `originPorts` cai no POL da viagem quando não há B/L, então ele não serve de
  // prova de importação: numa viagem que só embarca isso desenharia
  // "POL -> Destino a definir" sem nada a descarregar.
  const hasImport = importEscalas.length > 0 || (bls ?? []).length > 0 || !hasExport

  return {
    importLeg: hasImport ? importLeg : null,
    exportLeg: hasExport ? exportLeg : null,
  }
}
