// Helpers puros para rótulos, métricas e resumos da tela de Viagens.
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { formatDate } from '../lib/utils'
import { formatMetric, formatPortDisplayName, normalizePortName, stripFileExtension } from '../lib/voyageFormat'
import { normalizePortCode } from './portCode'
import { TIMELINE_ROLE_LABELS } from './voyageTimeline'

export function summarizeContainerTypes(
  containers:
    | Array<{
        container_number?: string | null
        type?: string | null
      }>
    | null
    | undefined,
) {
  const groups = new Map<string, Array<{ container_number?: string | null }>>()

  for (const container of containers ?? []) {
    const type = String(container.type ?? '').trim() || 'Não informado'
    const current = groups.get(type)

    if (current) {
      current.push(container)
    } else {
      groups.set(type, [container])
    }
  }

  return Array.from(groups.entries())
    .map(([type, items]) => ({ type, count: countDistinctContainerNumbers(items) }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type, 'pt-BR'))
    .map(({ type, count }) => `${type}: ${count}`)
    .join(' | ')
}

export function summarizeUniqueValues(values: Array<string | null | undefined>) {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return normalized.join(' | ')
}

export function summarizeOccurrences<T>(
  items: T[] | null | undefined,
  getLabel: (item: T) => string | null | undefined,
  fallbackLabel: string,
) {
  const counts = new Map<string, number>()

  for (const item of items ?? []) {
    const label = String(getLabel(item) ?? '').trim() || fallbackLabel
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'pt-BR'))
    .map(([label, count]) => `${label}: ${count}`)
    .join(' | ')
}

export function normalizeVoyageStatus(status: string | null): 'active' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status
  return 'active'
}

// Estatísticas de módulos da viagem.

export type VoyageBl = {
  id: string
  batch_id?: number | null
  cargo_mode: 'container' | 'carga_solta' | 'misto' | null
  ce_mercante: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_packages_total: number | null
  bb_weight_ton: number | null
  shipper: string | null
  consignee: string | null
  notify_party: string | null
  pol: string | null
  pod: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  bl_containers?: Array<{
    id: number
    container_number: string
    type?: string | null
    is_oog?: boolean | null
    is_imo?: boolean | null
  }> | null
  bl_breakbulk_items?: Array<{
    id: number
    gross_weight_kg?: number | null
    cbm?: number | null
  }> | null
}

export type VoyageGraniteManifest = {
  id: string
  voyage_id: number | null
  loading_port: string | null
  discharge_port: string | null
  total_bls: number | null
  total_weight_kg: number | null
  granite_bls?: Array<{
    id: string
    charge_status: 'not_calculated' | 'calculated' | 'ready_for_billing' | 'invoiced' | null
  }> | null
}

export type VoyageVaziosManifest = {
  id: string
  voyage_id: number | null
  description: string | null
  total_bookings: number | null
  vazios_bookings?: Array<{
    id: string
    container_number: string | null
    container_type: string | null
    local_id: string
    condition: string
    operation?: {
      id: string
      embark_port: string | null
    } | null
    local?: {
      id: string
      code: string
      name: string | null
      tipo: string
    } | null
  }> | null
}

export function splitVoyageBls(bls: VoyageBl[] | null | undefined) {
  const containerBls: VoyageBl[] = []
  const breakbulkBls: VoyageBl[] = []

  for (const bl of bls ?? []) {
    if (bl.cargo_mode === 'carga_solta') {
      breakbulkBls.push(bl)
    } else if (bl.cargo_mode === 'misto') {
      containerBls.push(bl)
      breakbulkBls.push(bl)
    } else {
      containerBls.push(bl)
    }
  }

  return { containerBls, breakbulkBls }
}

export function countDistinctBatchIds(bls: VoyageBl[] | null | undefined) {
  return new Set((bls ?? []).map((bl) => bl.batch_id).filter((batchId): batchId is number => Number.isInteger(batchId))).size
}

/** Agrupa B/Ls por batch e rota, preservando a contagem usada pela timeline. */
export function groupBlsByRoute(bls: VoyageBl[] | null | undefined) {
  const grouped = new Map<number, Map<string, { pol: string; pod: string; blCount: number }>>()
  for (const bl of bls ?? []) {
    if (bl.batch_id == null) continue
    const pol = formatPortDisplayName(bl.pol?.trim() || '-')
    const pod = formatPortDisplayName(bl.pod?.trim() || '-')
    const routes = grouped.get(bl.batch_id) ?? new Map()
    const key = `${pol}\u0000${pod}`
    const current = routes.get(key)
    routes.set(key, { pol, pod, blCount: (current?.blCount ?? 0) + 1 })
    grouped.set(bl.batch_id, routes)
  }
  return new Map(Array.from(grouped, ([batchId, routes]) => [batchId, Array.from(routes.values())]))
}

/**
 * Conta rotas distintas (par POL/POD normalizado) de um conjunto de B/Ls. A
 * "quantidade de manifestos" de uma viagem passa a ser o número de rotas, não
 * de arquivos importados: uma viagem pode nascer só de B/Ls (sem batch de
 * manifesto), e dois arquivos da mesma rota são uma rota só (ADR 0017).
 */
export function countDistinctRoutes(bls: Array<{ pol?: string | null; pod?: string | null }> | null | undefined) {
  const routes = new Set<string>()
  for (const bl of bls ?? []) {
    const pol = String(bl.pol ?? '').trim().toUpperCase() || '-'
    const pod = String(bl.pod ?? '').trim().toUpperCase() || '-'
    routes.add(`${pol}__${pod}`)
  }
  return routes.size
}

export function getGraniteModuleStats(manifests: VoyageGraniteManifest[] | null | undefined) {
  const totalManifests = manifests?.length ?? 0
  const totalBls = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_bls ?? manifest.granite_bls?.length ?? 0),
    0,
  )
  const totalWeightTon = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_weight_kg ?? 0) / 1000,
    0,
  )
  const graniteBls = (manifests ?? []).flatMap((manifest) => manifest.granite_bls ?? [])

  return {
    totalManifests,
    totalBls,
    totalWeightTon,
    readyForBillingCount: graniteBls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
    invoicedCount: graniteBls.filter((bl) => bl.charge_status === 'invoiced').length,
    dischargePorts: summarizeUniqueValues((manifests ?? []).map((manifest) => manifest.discharge_port)),
  }
}

export function getVaziosModuleStats(manifests: VoyageVaziosManifest[] | null | undefined) {
  const totalManifests = manifests?.length ?? 0
  const totalUnits = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_bookings ?? manifest.vazios_bookings?.length ?? 0),
    0,
  )
  const bookings = (manifests ?? []).flatMap((manifest) => manifest.vazios_bookings ?? [])

  return {
    totalManifests,
    totalUnits,
    distinctContainers: countDistinctContainerNumbers(bookings),
    containerTypes: summarizeOccurrences(bookings, (booking) => booking.container_type, 'Não informado'),
    origins: summarizeUniqueValues(bookings.map((booking) => booking.local?.name ?? booking.local?.code)),
  }
}

export function summarizeModuleAvailability({
  hasCntrs,
  hasBreakbulk,
  hasVehicles,
  hasGranite,
  hasVazios,
}: {
  hasCntrs: boolean
  hasBreakbulk: boolean
  hasVehicles: boolean
  hasGranite: boolean
  hasVazios: boolean
}) {
  const modules = []
  if (hasCntrs) modules.push('CNTRS')
  if (hasBreakbulk) modules.push('BB')
  if (hasVehicles) modules.push('VEICULOS')
  if (hasGranite) modules.push('GRANITO')
  if (hasVazios) modules.push('VAZIOS')
  return modules.join('/') || '-'
}

export function collectVoyagePorts(
  bls: Array<{ pol: string | null; pod: string | null }> | null | undefined,
  field: 'pol' | 'pod',
  fallback: string | null,
  extraPorts: Array<string | { port?: string | null; pol?: string | null; pod?: string | null } | null | undefined> = [],
) {
  const ports = Array.from(new Set(
    [
      ...(bls ?? []).map((bl) => bl[field]),
      ...extraPorts.map((value) => normalizeCollectedPort(value, field)),
    ]
      .map((value) => normalizePortCode(value))
      .filter((value): value is string => Boolean(value)),
  )).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  if (!ports.length && fallback) {
    return [normalizePortCode(fallback) ?? fallback]
  }

  return ports
}

function normalizeCollectedPort(
  value: string | { port?: string | null; pol?: string | null; pod?: string | null } | null | undefined,
  field: 'pol' | 'pod',
) {
  if (typeof value === 'object' && value !== null) {
    return String(value.port ?? value[field] ?? '').trim()
  }
  return String(value ?? '').trim()
}

export function countPlannedPodRows(rows: Array<{ pod: string | null | undefined }> | null | undefined) {
  return new Set(
    (rows ?? [])
      .map((row) => normalizePortCode(row.pod))
      .filter(Boolean),
  ).size
}

function canonicalPort(value: string | null | undefined) {
  return normalizePortCode(value) ?? normalizePortName(value)
}

export type AdrEscalaPod = { pod: string; omitted: boolean }

/**
 * Escalas que compõem o ADR (Task 2 do ADR 2026-07-31): as não omitidas mais
 * as omitidas que já têm ADR fechado — o fechamento é um registro imutável e
 * não pode virar inalcançável por causa de uma omissão registrada depois. Uma
 * escala omitida sem ADR fechado continua fora: o navio não atracou lá.
 */
export function computeAdrEscalaPods(
  podRows: Array<{ pod: string; omitted?: boolean }> | null | undefined,
  closedAdrPorts: Iterable<string> | null | undefined,
): AdrEscalaPod[] {
  const closedSet = new Set(Array.from(closedAdrPorts ?? []).map((port) => normalizePortCode(port) ?? normalizePortName(port)))
  const byPort = new Map<string, AdrEscalaPod>()
  for (const row of podRows ?? []) {
    const pod = normalizePortCode(row.pod) ?? normalizePortName(row.pod)
    if (!pod || (row.omitted && !closedSet.has(pod))) continue
    const current = byPort.get(pod)
    byPort.set(pod, { pod, omitted: Boolean(current?.omitted || row.omitted) })
  }
  return [...byPort.values()]
}

// --- Estado de Conciliação da Viagem (ver CONTEXT.md) -----------------------

export type EstadoConciliacao = 'divergente' | 'incompleto' | 'conciliado'

/** Cobertura de CE Mercante: quantos B/Ls têm ce_mercante preenchido. */
export function voyageCeCoverage(bls: Array<{ ce_mercante: string | null }> | null | undefined) {
  const list = bls ?? []
  return {
    filled: list.filter((bl) => String(bl.ce_mercante ?? '').trim()).length,
    total: list.length,
  }
}

/**
 * Deriva o Estado de Conciliação a partir de sinais já computados. Pura e
 * desacoplada da consulta de divergências (que é por viagem e cara): o
 * chamador decide como obter `hasOpenDivergences`. Viagem sem carga (CE total
 * 0 e sem B/Ls) resulta em 'conciliado' (nada pendente).
 *
 * A ausência de manifesto NÃO é mais sinal de incompletude: uma viagem pode
 * nascer só de B/Ls (ADR 0017), fonte comercial co-primária. O que ainda torna
 * a viagem incompleta é cobertura de CE parcial.
 */
export function deriveEstadoConciliacao({
  hasOpenDivergences,
  ceFilled,
  ceTotal,
}: {
  hasOpenDivergences: boolean
  ceFilled: number
  ceTotal: number
}): EstadoConciliacao {
  if (hasOpenDivergences) return 'divergente'
  if (ceTotal > 0 && ceFilled < ceTotal) return 'incompleto'
  return 'conciliado'
}

/** Próxima escala: menor ETA entre PODs com ETA definido e sem ATA registrado. */
export function getProximaEscala(
  podRows: Array<{ pod?: string; port?: string; eta: string | null; etb?: string | null; ata: string | null; omitted?: boolean }> | null | undefined,
) {
  const pending = (podRows ?? []).filter((row) => row.eta && !row.ata && !row.omitted && getEscalaPort(row))
  if (!pending.length) return null
  const next = pending.reduce((earliest, row) => (String(row.eta) < String(earliest.eta) ? row : earliest))
  const pod = getEscalaPort(next)
  if (!pod) return null
  return { pod, eta: next.eta as string, etb: next.etb ?? null }
}

function getEscalaPort(row: { pod?: string; port?: string }) {
  return row.port ?? row.pod ?? null
}

export function isEtaOverdue(eta: string | null, now: Date = new Date()): boolean {
  if (!eta) return false
  return new Date(`${eta}T23:59:59`) < now
}

// --- Rail (lista master-detail) ----------------------------------------------

export type VoyageRailItem = {
  id: number
  carrierName: string
  vesselName: string
  voyageNumber: string
  status: 'active' | 'completed' | 'cancelled'
  /** Mantidos só para a busca do rail (`viagensFilters.ts`); o card não os exibe. */
  originPorts: string[]
  destinationPorts: string[]
  estado: EstadoConciliacao
  proximaEscala: { pod: string; eta: string; etb: string | null } | null
  /** Totais compactos exibidos no rodapé do card do rail. */
  blCount?: number
  containerCount?: number
  ceCoverage?: { filled: number; total: number }
  /** Escalas brasileiras (não omitidas) com seus ETAs, ordenadas por ETA ascendente. */
  escalasBrasileiras: Array<{ port: string; eta: string | null; modules?: Partial<VoyageRailItem['modules']> }>
  /** Presença de cada tipo de carga/módulo na viagem, para os selos do card do rail. */
  modules: {
    container: boolean
    cargaSolta: boolean
    veiculos: boolean
    vazios: boolean
    vaziosExp?: boolean
    granito: boolean
  }
}

type VoyageRailSource = {
  id: number
  voyage_number: string
  status: string | null
  vessel?: { name: string | null; carrier?: { name: string | null } | null } | null
  pol?: { name: string | null } | null
  pod?: { name: string | null } | null
  bls?: VoyageBl[] | null
  import_batches?: Array<{ id: number }> | null
  routes?: Array<{
    pol: string | null
    pod: string | null
    blCount: number
    containerBlCount?: number
    breakbulkBlCount?: number
    ceFilled?: number
    ceTotal?: number
  }> | null
  blCount?: number
  containerBlCount?: number
  breakbulkBlCount?: number
  containerCount?: number
  ceCoverage?: { filled: number; total: number }
}

type PodScheduleRow = { pod: string; eta: string | null; etb: string | null; ata: string | null; omitted?: boolean }
type EscalaScheduleRow = {
  port: string
  eta: string | null
  etb: string | null
  ata: string | null
  omitted?: boolean
  temExportacao?: boolean
  hasGranite?: boolean
  temGranito?: boolean
  temVazios?: boolean
  containersQty?: number | null
  movementsQty?: number | null
}

/**
 * Monta os itens do rail. Estado de Conciliação usa apenas sinais baratos do
 * payload (CE + manifesto faltando); divergências (estado 'divergente') ficam
 * a cargo da view de detalhe, que consulta uma viagem por vez.
 */
/** Presença de módulos por viagem, calculada fora do payload de B/Ls (veículos, vazios de importação e granito vêm de consultas próprias). */
export type VoyageRailModuleStats = {
  hasVehicles?: boolean
  vehicleContainerNumbers?: string[]
  vehiclePorts?: string[]
  hasVaziosImportacao?: boolean
  hasGranite?: boolean
  hasVaziosExportacao?: boolean
}

/** Escalas brasileiras (não omitidas) por porto, com o menor ETA quando o porto aparece mais de uma vez, ordenadas por ETA ascendente (sem ETA vai ao final). */
function collectEscalasBrasileiras(
  escalaRows: Array<PodScheduleRow | EscalaScheduleRow>,
): Array<{ port: string; eta: string | null; modules?: Partial<VoyageRailItem['modules']> }> {
  const byPort = new Map<string, { eta: string | null; modules: Partial<VoyageRailItem['modules']> }>()

  for (const row of escalaRows) {
    if (row.omitted) continue
    const port = getEscalaPort(row)
    if (!port) continue
    const current = byPort.get(port)
    const modules = 'temExportacao' in row
      ? {
          ...(row.temExportacao === true && (row.temVazios || (row.temVazios === undefined && ((row.containersQty ?? 0) > 0 || (row.movementsQty ?? 0) > 0))) ? { vaziosExp: true } : {}),
          ...(row.hasGranite || row.temGranito ? { granito: true } : {}),
        }
      : {}
    if (!current) byPort.set(port, { eta: row.eta ?? null, modules })
    else {
      if (row.eta && (!current.eta || row.eta < current.eta)) current.eta = row.eta
      current.modules = { ...current.modules, ...modules }
    }
  }

  return Array.from(byPort.entries())
    .map(([port, value]) => ({ port, eta: value.eta, modules: value.modules }))
    .sort((left, right) => (left.eta ?? '￿').localeCompare(right.eta ?? '￿'))
}

export function buildVoyageRailItems(
  voyages: VoyageRailSource[] | null | undefined,
  escalaRowsByVoyageId: ReadonlyMap<number, Array<PodScheduleRow | EscalaScheduleRow>> = new Map(),
  moduleStatsByVoyageId: ReadonlyMap<number, VoyageRailModuleStats> = new Map(),
): VoyageRailItem[] {
  return (voyages ?? []).map((voyage) => {
    const escalaRows = escalaRowsByVoyageId.get(voyage.id) ?? []
    const exportEscalas = escalaRows.filter((row) => 'port' in row && row.temExportacao)
    const { containerBls, breakbulkBls } = splitVoyageBls(voyage.bls)
    const routeRows = voyage.routes ?? voyage.bls ?? []
    const detailedBls = Array.isArray(voyage.bls)
    const { filled: derivedFilled, total: derivedTotal } = voyageCeCoverage(voyage.bls)
    const filled = voyage.ceCoverage?.filled ?? derivedFilled
    const total = voyage.ceCoverage?.total ?? voyage.blCount ?? derivedTotal
    const moduleStats = moduleStatsByVoyageId.get(voyage.id)
    const containerBlCount = voyage.containerBlCount ?? containerBls.length
    const breakbulkBlCount = voyage.breakbulkBlCount ?? breakbulkBls.length
    const blCount = voyage.blCount ?? voyage.bls?.length ?? 0
    const containerCount = voyage.containerCount ?? countDistinctContainerNumbers(containerBls.flatMap((bl) => bl.bl_containers ?? []))

    return {
      id: voyage.id,
      carrierName: voyage.vessel?.carrier?.name ?? '',
      vesselName: voyage.vessel?.name ?? 'Navio',
      voyageNumber: voyage.voyage_number,
      status: normalizeVoyageStatus(voyage.status),
      originPorts: collectVoyagePorts(routeRows, 'pol', voyage.pol?.name ?? null, exportEscalas),
      destinationPorts: collectVoyagePorts(
        routeRows,
        'pod',
        null,
        escalaRows,
      ),
      estado: deriveEstadoConciliacao({
        hasOpenDivergences: false,
        ceFilled: filled,
        ceTotal: total,
      }),
      proximaEscala: getProximaEscala(escalaRows),
      blCount,
      containerCount,
      ceCoverage: { filled, total },
      escalasBrasileiras: collectEscalasBrasileiras(escalaRows).map((escala) => {
        const vehicleContainers = new Set((moduleStats?.vehicleContainerNumbers ?? []).map((number) => String(number).trim().toUpperCase()))
        const vehiclePorts = new Set((moduleStats?.vehiclePorts ?? []).map((p) => canonicalPort(p)))
        const hasVehiclesAtPort = detailedBls
          ? containerBls
              .filter((bl) => canonicalPort(bl.pod) === canonicalPort(escala.port))
              .flatMap((bl) => bl.bl_containers ?? [])
              .some((container) => vehicleContainers.has(String(container.container_number ?? '').trim().toUpperCase()))
          : vehiclePorts.size > 0
            ? vehiclePorts.has(canonicalPort(escala.port))
            : Boolean(moduleStats?.hasVehicles)
        const modules: Partial<VoyageRailItem['modules']> = { ...(escala.modules ?? {}) }
        if (moduleStats?.hasVehicles) modules.veiculos = hasVehiclesAtPort
        if (moduleStats?.hasVaziosExportacao) modules.vaziosExp = Boolean(modules.vaziosExp)
        if (moduleStats?.hasGranite) modules.granito = Boolean(modules.granito)
        return Object.keys(modules).length ? { ...escala, modules } : { port: escala.port, eta: escala.eta }
      }),
      modules: {
        container: containerBlCount > 0,
        cargaSolta: breakbulkBlCount > 0,
        veiculos: moduleStats?.hasVehicles ?? false,
    vazios: moduleStats?.hasVaziosImportacao ?? false,
    ...(moduleStats?.hasVaziosExportacao ? { vaziosExp: true } : {}),
        granito: moduleStats?.hasGranite ?? false,
      },
    }
  })
}

// --- Linha do tempo da viagem ------------------------------------------------

export type VoyageTimelineEventKind =
  | 'import'
  | 'baplie-import'
  | 'escala-date'
  | 'escala-terminal'
  | 'escala-number'
  | 'manifestos-linked'
  | 'ce-status'
  | 'restow'
  | 'pod-added'
  | 'divergence-resolved'
  | 'divergence-opened'
  | 'pod-removed'
  | 'voyage-completed'
  | 'ce-master'
  | 'voyage-data'
  | 'ce-coverage'
  | 'omission'
  | 'transshipment-info'

export type VoyageTimelineEvent = {
  id: string
  kind: VoyageTimelineEventKind
  at: string
  title: string
  detail: string
}

type TimelineAuditEvent = {
  entity_type?: string | null
  entity_id: string
  field_name: string
  old_value?: string | null
  new_value: string | null
  changed_by?: string | null
  actor_role?: string | null
  actor_department?: string | null
  changed_at: string | null
  justification?: string | null
}

type TimelineImportBatch = {
  id: number
  filename: string
  cargo_mode: 'container' | 'carga_solta' | null
  uploaded_at: string | null
  uploaded_by?: string | null
  route_summary?: string | null
  route?: string | null
  routes?: Array<{ pol: string; pod: string; blCount: number }>
  total_bls?: number | null
  ce_master?: string | null
}
type TimelineBaplieImport = {
  imported_at?: string | null
  created_at?: string | null
  container_count?: number | null
}
type VoyageTimelineInput = {
  importBatches?: TimelineImportBatch[] | null
  scheduleEvents?: TimelineAuditEvent[] | null
  auditEvents?: TimelineAuditEvent[] | null
  resolutions?: Array<{ field_name: string | null; resolved_at: string | null }> | null
  baplieImports?: TimelineBaplieImport[] | null
  openDivergenceCount?: number | null
  voyageStatus?: string | null
  ceCoverage?: { filled: number; total: number } | null
  actorNames?: Record<string, string> | null
  actorDepartments?: Record<string, string> | null
}

const TIMELINE_SCHEDULE_DATE_LABELS: Record<string, string> = { etd: 'ETD', eta: 'ETA', etb: 'ETB', ata: 'ATA', atd: 'ATD' }
const TIMELINE_CE_STATUS_LABELS: Record<string, string> = {
  waiting: 'Aguardando',
  received: 'Recebido',
  launching: 'Lançando',
  approving: 'Em aprovação',
  approved: 'Aprovado',
  partial: 'Lançando',
  missing: 'Aguardando',
}
const TIMELINE_OPERATION_DIRECTION_LABELS: Record<string, string> = {
  importacao: 'importação',
  exportacao: 'exportação',
}
const TIMELINE_OPERATION_KIND_LABELS: Record<string, string> = {
  carga_cheia: 'carga cheia',
  carga_solta: 'carga solta',
  veiculo: 'veículos',
  vazio: 'vazios',
  granito: 'granito',
}
const TIMELINE_VOYAGE_FIELD_LABELS: Record<string, string> = {
  created: 'Viagem',
  voyage_number: 'Nº da viagem',
  vessel_id: 'Navio',
  status: 'Status',
}
const TIMELINE_KIND_ORDER: Record<VoyageTimelineEventKind, number> = {
  'voyage-completed': 0,
  'ce-master': 1,
  'ce-coverage': 2,
  import: 3,
  'divergence-opened': 4,
  'baplie-import': 5,
  'pod-added': 6,
  restow: 7,
  'ce-status': 8,
  'manifestos-linked': 9,
  'escala-number': 10,
  'escala-date': 11,
  'escala-terminal': 12,
  'divergence-resolved': 13,
  'voyage-data': 14,
  'pod-removed': 15,
  omission: 16,
  'transshipment-info': 17,
}

export function buildVoyageTimeline({
  importBatches,
  scheduleEvents,
  auditEvents,
  resolutions,
  baplieImports,
  openDivergenceCount,
  voyageStatus,
  ceCoverage,
  actorNames,
  actorDepartments,
}: VoyageTimelineInput): VoyageTimelineEvent[] {
  const imports = buildImportTimeline(importBatches, actorNames, actorDepartments)
  const events = [...imports.events]
  const appendActor = (detail: string, row: { changed_by?: string | null; actor_role?: string | null; actor_department?: string | null }) =>
    appendTimelineActor(
      detail,
      row.changed_by,
      actorNames,
      row.actor_department
        ? TIMELINE_ROLE_LABELS[row.actor_department] ?? row.actor_department
        : row.actor_role ? TIMELINE_ROLE_LABELS[row.actor_role] ?? row.actor_role : null,
    )
  events.push(...buildCeCoverageTimeline(ceCoverage, imports.latestImportAt))

  events.push(...buildBaplieTimeline(baplieImports, openDivergenceCount))

  events.push(...buildScheduleTimeline(scheduleEvents, appendActor))

  events.push(...buildVoyageCompletionTimeline(voyageStatus, events))

  events.push(...buildAuditTimeline(auditEvents, appendActor))

  events.push(...buildResolutionTimeline(resolutions))

  return events.sort((left, right) => {
    if (left.at < right.at) return 1
    if (left.at > right.at) return -1
    return TIMELINE_KIND_ORDER[left.kind] - TIMELINE_KIND_ORDER[right.kind]
  })
}

// O import é o único evento da linha do tempo cujo autor não vem de
// `audit_logs`: o batch guarda `uploaded_by`, e o departamento é resolvido à
// parte (`fetchVoyageTimelineSources` casa o batch com a linha `criado` da
// auditoria). Sem receber esse par aqui, a viagem exibia "por Fulano
// (Departamento)" em toda mudança de escala e deixava anônimo justamente o
// evento que originou os dados.
function buildImportTimeline(
  importBatches: TimelineImportBatch[] | null | undefined,
  actorNames?: Record<string, string> | null,
  actorDepartments?: Record<string, string> | null,
) {
  const events: VoyageTimelineEvent[] = []
  let latestImportAt: string | null = null

  for (const batch of importBatches ?? []) {
    if (!batch.uploaded_at) continue
    if (!latestImportAt || batch.uploaded_at > latestImportAt) latestImportAt = batch.uploaded_at
    const appendUploader = (detail: string) =>
      appendTimelineActor(detail, batch.uploaded_by, actorNames, batch.uploaded_by ? actorDepartments?.[batch.uploaded_by] : null)

    const ceMaster = String(batch.ce_master ?? '').trim()
    if (ceMaster) {
      events.push({
        id: `ce-master-batch-${batch.id}`,
        kind: 'ce-master',
        at: batch.uploaded_at,
        title: 'Nº de Manifesto Mercante definido',
        detail: ceMaster,
      })
    }

    if (batch.routes?.length) {
      const grouped = new Map<string, { pol: string; pod: string; count: number }>()
      for (const route of batch.routes) {
        const key = `${route.pol}\u0000${route.pod}`
        const current = grouped.get(key)
        grouped.set(key, { pol: route.pol, pod: route.pod, count: (current?.count ?? 0) + route.blCount })
      }
      for (const [key, route] of grouped) {
        const plural = route.count === 1 ? '' : 's'
        events.push({
          id: `import-${batch.id}-${key}`,
          kind: 'import',
          at: batch.uploaded_at,
          title: `${route.count} B/L${plural} importado${plural} · ${route.pol} → ${route.pod}`,
          detail: appendUploader(batch.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'),
        })
      }
    } else {
      const count = Number(batch.total_bls ?? 0)
      const route = String(batch.route ?? '').trim()
      const countLabel = count > 0 ? `${formatMetric(count)} B/L${count === 1 ? '' : 's'} importado${count === 1 ? '' : 's'}` : 'Manifesto importado'
      events.push({
        id: `import-${batch.id}`,
        kind: 'import',
        at: batch.uploaded_at,
        title: route ? `${countLabel} · ${route}` : countLabel,
        detail: appendUploader(`${batch.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'} · ${route || stripFileExtension(batch.filename)}`),
      })
    }
  }

  return { events, latestImportAt }
}

function buildCeCoverageTimeline(
  ceCoverage: VoyageTimelineInput['ceCoverage'],
  latestImportAt: string | null,
): VoyageTimelineEvent[] {
  if (!ceCoverage || !(ceCoverage.total > 0 && ceCoverage.filled >= ceCoverage.total) || !latestImportAt) return []
  return [{
    id: 'ce-coverage-complete',
    kind: 'ce-coverage',
    at: latestImportAt,
    title: 'Cobertura de CE Mercante completa',
    detail: `${ceCoverage.filled}/${ceCoverage.total} B/Ls com CE`,
  }]
}

function buildBaplieTimeline(
  baplieImports: TimelineBaplieImport[] | null | undefined,
  openDivergenceCount: number | null | undefined,
): VoyageTimelineEvent[] {
  const firstBaplieImport = (baplieImports ?? [])
    .map((row) => ({
      at: row.imported_at ?? row.created_at ?? null,
      count: Number(row.container_count ?? 0),
    }))
    .filter((row): row is { at: string; count: number } => Boolean(row.at))
    .sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))[0]

  if (!firstBaplieImport) return []

  const events: VoyageTimelineEvent[] = [{
    id: 'baplie-import',
    kind: 'baplie-import',
    at: firstBaplieImport.at,
    title: 'Baplie EDI importado',
    detail: firstBaplieImport.count > 0 ? `${formatMetric(firstBaplieImport.count)} containers` : 'Staging Baplie',
  }]
  if (Number(openDivergenceCount ?? 0) > 0) {
    events.push({
      id: 'divergence-opened',
      kind: 'divergence-opened',
      at: firstBaplieImport.at,
      title: 'Divergência detectada',
      detail: `${formatMetric(openDivergenceCount)} divergência${openDivergenceCount === 1 ? '' : 's'} aberta${openDivergenceCount === 1 ? '' : 's'}`,
    })
  }
  return events
}

const TIMELINE_SPECIAL_SCHEDULE_FIELDS = [
  'front_created',
  'front_removed',
  'terminal_assignment',
  'front_source',
  'terminal_dates',
  'export_expectation',
  'adr_created',
  'adr_removed',
  'adr_preserved',
]

function parseTimelineObject(value: string): Record<string, unknown> {
  try {
    const candidate = JSON.parse(value)
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function stableTimelineValue(value: string): string {
  try {
    const sortValue = (candidate: unknown): unknown => {
      if (Array.isArray(candidate)) return candidate.map(sortValue)
      if (candidate && typeof candidate === 'object') {
        return Object.fromEntries(
          Object.entries(candidate as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, sortValue(nested)]),
        )
      }
      return candidate
    }
    return JSON.stringify(sortValue(JSON.parse(value)))
  } catch {
    return value
  }
}

function timelineOperationLabel(parsed: Record<string, unknown>): string | null {
  const front = typeof parsed.modalidade === 'string' ? parsed.modalidade : null
  if (!front) return null

  const direction = typeof parsed.sentido === 'string'
    ? TIMELINE_OPERATION_DIRECTION_LABELS[parsed.sentido] ?? parsed.sentido
    : parsed.source === 'export_declaration' || front === 'granito' ? 'exportação' : 'importação'
  const frontLabel = TIMELINE_OPERATION_KIND_LABELS[front] ?? front.replaceAll('_', ' ')
  return `${frontLabel} de ${direction}`
}

function capitalizeTimelineLabel(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value
}

function timelineTerminalLabel(parsed: Record<string, unknown>): string {
  if (typeof parsed.terminal_code === 'string' && parsed.terminal_code.trim()) {
    const code = parsed.terminal_code.trim()
    return code.toUpperCase() === 'TBC' ? 'TBC (pendente de atribuição)' : code
  }
  return parsed.terminal_id ? 'terminal atribuído' : 'TBC (pendente de atribuição)'
}

function timelineExportExpectationLabel(parsed: Record<string, unknown>): string {
  if (parsed.tem_exportacao === false) return 'Não declarada'

  const cargo: string[] = []
  if (parsed.granito === true || parsed.has_granite === true) cargo.push('granito')
  if (parsed.has_empty === true || parsed.vazios === true) {
    const quantity = Number(parsed.containers_qty ?? parsed.vazios_qty ?? 0)
    cargo.push(quantity > 0 ? `vazios (${formatMetric(quantity)})` : 'vazios')
  }
  if (!cargo.length) cargo.push('carga não especificada')

  const destinations = Array.isArray(parsed.discharge_ports)
    ? parsed.discharge_ports.filter((port): port is string => typeof port === 'string' && Boolean(port.trim())).join(', ')
    : ''
  return `${cargo.map(capitalizeTimelineLabel).join(' · ')}${destinations ? ` · destino: ${destinations}` : ''}`
}

function timelineTerminalDatesLabel(parsed: Record<string, unknown>): string {
  const dates = [
    ['ETB', parsed.terminal_etb],
    ['ATB', parsed.terminal_atb],
    ['ETD', parsed.terminal_etd],
    ['ATD', parsed.terminal_atd],
    ['Restow', parsed.terminal_rtw],
  ]
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([label, value]) => `${label}: ${label === 'Restow' ? value : formatDate(String(value))}`)

  return dates.length ? dates.join(' · ') : 'Datas operacionais atualizadas'
}

function buildScheduleTimeline(
  scheduleEvents: TimelineAuditEvent[] | null | undefined,
  appendActor: (detail: string, row: TimelineAuditEvent) => string,
): VoyageTimelineEvent[] {
  const events: VoyageTimelineEvent[] = []
  for (const [index, row] of (scheduleEvents ?? []).entries()) {
    const at = row.changed_at
    if (!at) continue
    const port = row.entity_id.split('::')[1] || '-'
    const value = (row.new_value ?? '').trim()
    const oldValue = (row.old_value ?? '').trim()

    // Auditoria histórica pode conter linhas repetidas ou a inicialização
    // implícita do editor (`NULL -> waiting`). Nenhuma delas representa uma
    // ação do operador na linha do tempo.
    if (stableTimelineValue(oldValue) === stableTimelineValue(value) || (row.field_name === 'ces' && !oldValue && value === 'waiting')) continue

    if (TIMELINE_SPECIAL_SCHEDULE_FIELDS.includes(row.field_name)) {
      const parsed = parseTimelineObject(value || oldValue)
      const previous = parseTimelineObject(oldValue)
      const operation = timelineOperationLabel(parsed) ?? timelineOperationLabel(previous)
      let title: string
      let detail: string

      if (row.field_name === 'front_created') {
        const terminal = timelineTerminalLabel(parsed)
        const hasTerminal = Boolean(parsed.terminal_id || (parsed.terminal_code && String(parsed.terminal_code).toUpperCase() !== 'TBC'))
        title = hasTerminal && operation ? `Terminal definido para ${operation}` : `${capitalizeTimelineLabel(operation ?? 'Operação operacional')} registrada`
        detail = `Terminal: ${terminal}`
      } else if (row.field_name === 'front_removed') {
        title = `${capitalizeTimelineLabel(operation ?? 'Operação operacional')} removida`
        detail = 'Frente removida do planejamento'
      } else if (row.field_name === 'terminal_assignment') {
        title = 'Terminal da operação alterado'
        detail = `Anterior: ${timelineTerminalLabel(previous)} · atual: ${timelineTerminalLabel(parsed)}`
      } else if (row.field_name === 'front_source') {
        const sourceLabel = (source: string) => source === 'export_declaration' ? 'declaração de exportação' : source === 'operational_data' ? 'dados operacionais' : source || 'não informado'
        title = 'Origem da operação alterada'
        detail = `De ${sourceLabel(oldValue)} para ${sourceLabel(value)}`
      } else if (row.field_name === 'terminal_dates') {
        const terminal = parsed.terminal_code ? ` ${parsed.terminal_code}` : ''
        title = `Datas do terminal${terminal} alteradas`
        detail = timelineTerminalDatesLabel(parsed)
      } else if (row.field_name === 'export_expectation') {
        title = 'Exportação atualizada'
        detail = timelineExportExpectationLabel(parsed)
      } else if (row.field_name === 'adr_created' || row.field_name === 'adr_removed' || row.field_name === 'adr_preserved') {
        title = row.field_name === 'adr_created'
          ? 'ADR terminalizado criado'
          : row.field_name === 'adr_removed' ? 'ADR terminalizado removido' : 'ADR terminalizado preservado'
        const terminal = typeof parsed.terminal_code === 'string' ? parsed.terminal_code : 'terminal não identificado'
        detail = row.field_name === 'adr_preserved'
          ? `Terminal: ${terminal} · dependentes ou histórico preservados`
          : `Terminal: ${terminal}`
      } else {
        title = 'Alteração operacional registrada'
        detail = 'Dados da operação atualizados'
      }

      events.push({
        id: `sched-${index}`,
        kind: 'escala-terminal',
        at,
        title: `${title} · ${port}`,
        detail: appendActor(detail, row),
      })
      continue
    }

    if (TIMELINE_SCHEDULE_DATE_LABELS[row.field_name]) {
      if (!value) continue
      const changed = Boolean(oldValue && oldValue !== value)
      events.push({
        id: `sched-${index}`,
        kind: 'escala-date',
        at,
        title: `${TIMELINE_SCHEDULE_DATE_LABELS[row.field_name]} ${changed ? 'alterado' : 'registrado'} · ${port}`,
        detail: appendActor(changed ? `${formatDate(oldValue)} -> ${formatDate(value)}` : formatDate(value), row),
      })
    } else if (row.field_name === 'escala_number' && value) {
      events.push({
        id: `sched-${index}`,
        kind: 'escala-number',
        at,
        title: `Escala criada no Mercante · ${port}`,
        detail: appendActor(`Nº ${value}`, row),
      })
    } else if (row.field_name === 'linked' && value === 'true') {
      events.push({
        id: `sched-${index}`,
        kind: 'manifestos-linked',
        at,
        title: `Manifestos vinculados · ${port}`,
        detail: appendActor('ESCALA = SIM', row),
      })
    } else if (row.field_name === 'ces' && value) {
      events.push({
        id: `sched-${index}`,
        kind: 'ce-status',
        at,
        title: `CE atualizado · ${port}`,
        detail: appendActor(oldValue ? `${formatTimelineCeStatus(oldValue)} → ${formatTimelineCeStatus(value)}` : formatTimelineCeStatus(value), row),
      })
    } else if (row.field_name === 'rtw' && value) {
      events.push({
        id: `sched-${index}`,
        kind: 'restow',
        at,
        title: `Restow registrado · ${port}`,
        detail: appendActor(`RTW ${value}`, row),
      })
    } else if (row.field_name === 'deleted' && value === 'false') {
      events.push({
        id: `sched-${index}`,
        kind: 'pod-added',
        at,
        title: `Escala adicionada ao planejamento · ${port}`,
        detail: appendActor('POD ativo', row),
      })
    } else if (row.field_name === 'deleted' && value === 'true') {
      events.push({
        id: `sched-${index}`,
        kind: 'pod-removed',
        at,
        title: `Escala removida do planejamento · ${port}`,
        detail: appendActor('Planejamento removido', row),
      })
    }
  }
  return events
}

function buildVoyageCompletionTimeline(
  voyageStatus: string | null | undefined,
  events: VoyageTimelineEvent[],
): VoyageTimelineEvent[] {
  if (voyageStatus !== 'completed') return []
  const latestAtd = events
    .filter((event) => event.kind === 'escala-date' && event.title.startsWith('ATD '))
    .map((event) => event.at)
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))[0]
  if (!latestAtd) return []
  return [{
    id: 'voyage-completed',
    kind: 'voyage-completed',
    at: latestAtd,
    title: 'Viagem concluída',
    detail: 'Todos os PODs com ATD',
  }]
}

function buildAuditTimeline(
  auditEvents: TimelineAuditEvent[] | null | undefined,
  appendActor: (detail: string, row: TimelineAuditEvent) => string,
): VoyageTimelineEvent[] {
  const events: VoyageTimelineEvent[] = []
  for (const [index, row] of (auditEvents ?? []).entries()) {
    const at = row.changed_at
    const value = (row.new_value ?? '').trim()
    if (!at || !value) continue
    const oldValue = (row.old_value ?? '').trim()

    if (row.field_name === 'ce_master') {
      events.push({
        id: `audit-ce-master-${index}`,
        kind: 'ce-master',
        at,
        title: oldValue ? 'Nº de Manifesto Mercante alterado' : 'Nº de Manifesto Mercante definido',
        detail: appendActor(oldValue ? `${oldValue} -> ${value}` : value, row),
      })
      continue
    }

    if (row.field_name === 'omissao_revertida') {
      const omittedPod = oldValue || '—'
      events.push({
        id: `audit-omission-reverted-${index}`,
        kind: 'omission',
        at,
        title: `Omissão de ${omittedPod} revertida · correção — Porto de Transbordo — ${value || '—'}`,
        detail: appendActor('Correção de omissão', row),
      })
      continue
    }

    if (row.field_name === 'escala_omitida') {
      const omittedPod = oldValue || '—'
      const reason = String(row.justification ?? '').trim()
      const suffix = reason && reason !== 'Omissao de escala' ? ` · motivo: ${reason}` : ''
      events.push({
        id: `audit-omission-${index}`,
        kind: 'omission',
        at,
        title: `Escala de ${omittedPod} omitida · Porto de Transbordo — ${value}${suffix}`,
        detail: appendActor('Omissão registrada', row),
      })
      continue
    }

    if (row.field_name === 'transshipment_info') {
      events.push({
        id: `audit-transshipment-${index}`,
        kind: 'transshipment-info',
        at,
        title: 'Informações de Transbordo complementadas',
        detail: appendActor('Registro global atualizado', row),
      })
      continue
    }

    if (row.entity_type === 'voyages' || row.entity_type === 'voyage') {
      const label = TIMELINE_VOYAGE_FIELD_LABELS[row.field_name] ?? row.field_name
      events.push({
        id: `audit-voyage-${index}`,
        kind: 'voyage-data',
        at,
        title: oldValue ? 'Dados da viagem alterados' : 'Viagem criada',
        detail: appendActor(oldValue ? `${label}: ${oldValue} -> ${value}` : `${label}: ${value}`, row),
      })
    }
  }
  return events
}

function buildResolutionTimeline(resolutions: VoyageTimelineInput['resolutions']): VoyageTimelineEvent[] {
  return (resolutions ?? []).flatMap((resolution, index) => {
    if (!resolution.resolved_at) return []
    return [{
      id: `res-${index}`,
      kind: 'divergence-resolved' as const,
      at: resolution.resolved_at,
      title: 'Divergência conciliada',
      detail: resolution.field_name ? `Campo ${resolution.field_name}` : 'Baplie -> Manifesto',
    }]
  })
}

function appendTimelineActor(
  detail: string,
  changedBy: string | null | undefined,
  actorNames: Record<string, string> | null | undefined,
  department: string | null | undefined,
) {
  const actor = String(changedBy ?? '').trim()
  if (!actor) return detail
  const name = actorNames?.[actor]?.trim()
  const trimmedDepartment = department?.trim()
  if (name && trimmedDepartment) return `${detail} · por ${name} (${trimmedDepartment})`
  if (name) return `${detail} · por ${name}`
  return isUuid(actor) ? detail : `${detail} · por ${actor}`
}

function formatTimelineCeStatus(value: string) {
  return TIMELINE_CE_STATUS_LABELS[value] ?? value
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

// --- Importação por POD ------------------------------------------------------

export type PodImportSummary = {
  pod: string
  containers: { distinct: number; imo: number; oog: number; types: string }
  generalCargo: { distinct: number; imo: number; oog: number }
  vehicles: { distinctContainers: number }
  breakbulk: { bls: number; machines: number; packages: number; weightTon: number; cbm: number }
}

/**
 * Resume as métricas de importação segmentadas por POD de descarga.
 * `vehicleContainerNumbers` (de useVoyageVehicleStats) identifica quais
 * containers carregam veículos, para separar carga geral de veículos sem
 * embutir regra de porto.
 */
export function summarizeImportByPod(
  bls: VoyageBl[] | null | undefined,
  vehicleContainerNumbers: string[] | null | undefined,
): PodImportSummary[] {
  const { containerBls, breakbulkBls } = splitVoyageBls(bls)
  const vehicleSet = new Set((vehicleContainerNumbers ?? []).map((n) => String(n).trim().toUpperCase()))

  const pods = Array.from(
    new Set([
      ...containerBls.map((bl) => canonicalPort(bl.pod)),
      ...breakbulkBls.map((bl) => canonicalPort(bl.pod)),
    ]),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return pods.map((pod) => {
    const flat = containerBls
      .filter((bl) => canonicalPort(bl.pod) === pod)
      .flatMap((bl) => bl.bl_containers ?? [])
    const isVehicle = (container: { container_number?: string | null }) =>
      vehicleSet.has(String(container.container_number ?? '').trim().toUpperCase())
    const general = flat.filter((container) => !isVehicle(container))
    const vehicles = flat.filter(isVehicle)
    const podBreakbulk = breakbulkBls.filter((bl) => canonicalPort(bl.pod) === pod)

    return {
      pod,
      containers: {
        distinct: countDistinctContainerNumbers(flat),
        imo: countDistinctContainerNumbersBy(flat, (container) => Boolean(container.is_imo)),
        oog: countDistinctContainerNumbersBy(flat, (container) => Boolean(container.is_oog)),
        types: summarizeContainerTypes(flat),
      },
      generalCargo: {
        distinct: countDistinctContainerNumbers(general),
        imo: countDistinctContainerNumbersBy(general, (container) => Boolean(container.is_imo)),
        oog: countDistinctContainerNumbersBy(general, (container) => Boolean(container.is_oog)),
      },
      vehicles: { distinctContainers: countDistinctContainerNumbers(vehicles) },
      breakbulk: {
        bls: podBreakbulk.length,
        machines: podBreakbulk.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0),
        packages: podBreakbulk.reduce((sum, bl) => sum + Number(bl.bb_packages_qty ?? 0), 0),
        weightTon: podBreakbulk.reduce(
          (sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
          0,
        ),
        cbm: podBreakbulk.reduce((sum, bl) => sum + Number(bl.total_cbm ?? 0), 0),
      },
    }
  })
}

// --- Exportação por terminal de embarque -------------------------------------

export type EmbarkPortExportSummary = {
  embarkPort: string
  granite: { manifests: number; bls: number; weightTon: number; readyForBilling: number; invoiced: number }
  vazios: {
    units: number
    distinctContainers: number
    types: string
    depots: Array<{ code: string; name: string | null; units: number; types: string }>
  }
}

/** Resume Granito e Vazios de exportação pelo embark_port real da operação. */
export function summarizeExportByEmbarkPort(
  graniteManifests: VoyageGraniteManifest[] | null | undefined,
  vaziosManifests: VoyageVaziosManifest[] | null | undefined,
): EmbarkPortExportSummary[] {
  const groups = new Map<string, {
    granite: VoyageGraniteManifest[]
    bookings: NonNullable<VoyageVaziosManifest['vazios_bookings']>
  }>()

  const ensureGroup = (embarkPort: string) => {
    const current = groups.get(embarkPort)
    if (current) return current
    const created = { granite: [], bookings: [] }
    groups.set(embarkPort, created)
    return created
  }

  for (const manifest of graniteManifests ?? []) {
    ensureGroup(canonicalPort(manifest.loading_port)).granite.push(manifest)
  }

  for (const manifest of vaziosManifests ?? []) {
    for (const booking of manifest.vazios_bookings ?? []) {
      ensureGroup(canonicalPort(booking.operation?.embark_port)).bookings.push(booking)
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'pt-BR'))
    .map(([embarkPort, group]) => {
    const graniteBls = group.granite.flatMap((manifest) => manifest.granite_bls ?? [])
    const depots = new Map<string, { code: string; name: string | null; bookings: typeof group.bookings }>()

    for (const booking of group.bookings) {
      const depotId = booking.local_id || booking.local?.id || booking.local?.code || 'unknown'
      const current = depots.get(depotId)
      if (current) {
        current.bookings.push(booking)
      } else {
        depots.set(depotId, {
          code: booking.local?.code ?? booking.local_id,
          name: booking.local?.name ?? null,
          bookings: [booking],
        })
      }
    }

    return {
      embarkPort,
      granite: {
        manifests: group.granite.length,
        bls: group.granite.reduce((sum, manifest) => sum + Number(manifest.total_bls ?? manifest.granite_bls?.length ?? 0), 0),
        weightTon: group.granite.reduce((sum, manifest) => sum + Number(manifest.total_weight_kg ?? 0) / 1000, 0),
        readyForBilling: graniteBls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
        invoiced: graniteBls.filter((bl) => bl.charge_status === 'invoiced').length,
      },
      vazios: {
        units: group.bookings.length,
        distinctContainers: countDistinctContainerNumbers(group.bookings),
        types: summarizeOccurrences(group.bookings, (booking) => booking.container_type, 'Não informado'),
        depots: [...depots.values()]
          .sort((left, right) => (left.code || '').localeCompare(right.code || '', 'pt-BR'))
          .map((depot) => ({
            code: depot.code,
            name: depot.name,
            units: depot.bookings.length,
            types: summarizeOccurrences(depot.bookings, (booking) => booking.container_type, 'Não informado'),
          })),
      },
    }
  })
}
