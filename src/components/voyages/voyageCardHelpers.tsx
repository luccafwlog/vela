import {
  buildVoyagePolEntityId,
  getVoyagePodCeStatusLabel,
  type VoyagePodCeStatus,
} from '../../services/voyageRouteSchedules'
import { formatPortDisplayName } from '../../lib/voyageFormat'
import { normalizePortCode } from '../../services/portCode'
import { collectVoyagePorts, type VoyageBl } from '../../services/voyageSummaries'

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

export function renderCeCoverage(filled: number, total: number) {
  if (total === 0) return <span className="text-[var(--app-muted-soft)]">-</span>
  const color = filled >= total ? 'var(--app-green)' : filled > 0 ? 'var(--app-gold-strong)' : 'var(--app-red)'
  const percentage = Math.min(100, Math.round((filled / total) * 100))
  return (
    <span className="inline-flex items-center justify-center gap-1.5" aria-label={`Cobertura CE Mercante: ${filled} de ${total}`}>
      <span aria-hidden="true" className="h-[5px] w-9 overflow-hidden rounded-full bg-[var(--app-panel-strong)]">
        <span className="block h-full" style={{ width: `${percentage}%`, backgroundColor: color }} />
      </span>
      <span className="font-mono text-xs font-semibold" style={{ color }}>{filled}/{total}</span>
    </span>
  )
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

  const blsByBatch = new Map<number, VoyageBl[]>()
  for (const bl of bls ?? []) {
    if (bl.batch_id === null || bl.batch_id === undefined) continue
    const current = blsByBatch.get(bl.batch_id) ?? []
    current.push(bl)
    blsByBatch.set(bl.batch_id, current)
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
    cargoMode?: 'container' | 'vazios' | 'carga_solta'
    isVazios?: boolean
  }

  const groups = new Map<string, ManifestGroup>()

  function normalizeManifestPort(value: string | null | undefined) {
    return normalizePortCode(value) ?? (String(value ?? '').trim().toUpperCase() || '-')
  }

  function getGroup(polValue: string | null | undefined, podValue: string | null | undefined) {
    const pol = normalizeManifestPort(polValue)
    const pod = normalizeManifestPort(podValue)
    const routeKey = `${pol}__${pod}`
    const existing = groups.get(routeKey)
    if (existing) return existing

    const polEntity = polSchedules?.get(buildVoyagePolEntityId(voyageId, pol))

    const group: ManifestGroup = {
      routeKey,
      pol,
      pod,
      routeLabel: `${formatPortDisplayName(pol)} -> ${formatPortDisplayName(pod)}`,
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
    }

    groups.set(routeKey, group)
    return group
  }

  function attachBatchMetadata(group: ManifestGroup, batch: VoyageImportBatch) {
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
    const group = getGroup(bl.pol, bl.pod)
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

  for (const batch of batches ?? []) {
    if (Array.from(groups.values()).some((group) => group.batchIds.includes(batch.id))) continue

    const batchBls = blsByBatch.get(batch.id) ?? []
    const group = getGroup(batchBls[0]?.pol, batchBls[0]?.pod)
    attachBatchMetadata(group, batch)
    group.blCount += Number(batch.total_bls ?? batchBls.length)
    group.ceFilled += batchBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
    group.ceTotal += batchBls.length
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
      routeLabel: `${formatPortDisplayName(pol)} -> ${formatPortDisplayName(pod)}`,
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
        return `${formatPortDisplayName(group.pol)} → ${formatPortDisplayName(omission.omittedPod)} → ${formatPortDisplayName(omission.dischargePod)}`
      })(),
      omission: findRouteOmission(group.pod, group.blIds),
      modeLabel: group.isVazios
        ? 'VAZIOS'
        : (group.modes.has('container') || group.modes.has('misto')) && (group.modes.has('carga_solta') || group.modes.has('misto'))
          ? 'CNTR/BB'
          : group.modes.has('carga_solta') || group.modes.has('misto')
            ? 'BB'
            : 'CNTR',
      cargoMode: group.cargoMode,
      containerCount: group.containerCount,
      isVazios: group.isVazios ?? false,
      batchIds: group.batchIds,
      etd: group.etd,
      atd: group.atd,
      blCount: group.blCount,
      ceFilled: group.ceFilled,
      ceTotal: group.ceTotal,
      ceMaster: group.ceMaster ?? (group.isVazios ? (routeCeMasters?.get(`${voyageId}::${group.pol}__${group.pod}__VAZIOS`) ?? null) : (routeCeMasters?.get(`${voyageId}::${group.routeKey}`) ?? null)),
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
