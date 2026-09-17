import {
  deriveAutomaticVoyagePodCeStatus,
  listVoyageEscalaSchedulesByVoyageIds,
  listVoyageTerminalScaleStatesByVoyageIds,
  compareAtracacoes,
  sortAtracacoes,
  type VoyagePodCeStatus,
} from './voyageRouteSchedules'
import type { ExportCeStatus } from './voyageExportSchedules'
import { supabase } from './supabase'
import { chunkArray, isDateOnly } from '../lib/utils'
import { normalizePortCode } from './portCode'
import { listDepots } from './depots'

type VoyageStatus = 'active' | 'completed' | 'cancelled' | null

type LineUpVoyageRow = {
  id: number
  voyage_number: string
  status: VoyageStatus
  vessel: { name: string | null } | null
  pol: { name: string | null; locode: string | null } | null
}

type LineUpBlRow = {
  id: string
  voyage_id: number
  pod: string | null
  cargo_mode: 'container' | 'carga_solta' | 'misto' | null
  ce_mercante: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bl_containers?: LineUpContainerRow[] | null
}

type LineUpContainerRow = {
  id: number
  bl_id: string | null
  container_number: string | null
  tare_weight_kg: number | null
  gross_weight_kg: number | null
}

type LineUpVehicleRow = {
  voyage_id: number
  bl_id: string
  container_id: number
}

export type LineUpRow = {
  id: string
  voyageId: number
  voyageNumber: string
  voyageStatus: VoyageStatus
  vesselName: string
  pod: string
  eta: string | null
  etb: string | null
  ata: string | null
  atb: string | null
  rowType: 'import' | 'export'
  omitted: boolean
  importTerminal: string
  exportTerminal: string
  vin: number
  car: number
  cg: number
  total: number
  mty: number
  rtw: number | null
  bbMachines: number
  bbPackages: number
  bbTotal: number
  atd: string | null
  ceStatus: VoyagePodCeStatus
  linked: boolean
  exportHasGranite: boolean | null
  exportContainersQty: number | null
  exportMovementsQty: number | null
  exportCeStatus: ExportCeStatus | null
  exportLinked: boolean | null
}

export type LineUpSnapshot = {
  rows: LineUpRow[]
  lastChangedAt: string | null
  /** True when the panel can request an older window of voyages. */
  hasMore?: boolean
  totalVoyages?: number
}

export type LineUpTerminalFront = {
  voyageId: number
  port: string
  sentido: 'importacao' | 'exportacao'
  terminalId: string | null
}

export type LineUpTerminalCode = {
  id: string
  code: string
}

/**
 * Projects terminal assignments into the single import/export row of a scale.
 * TBC is a display value only: this function never creates or persists a row.
 */
/** Rótulo exibido quando um terminal atribuído não tem código cadastrado. */
export const TERMINAL_CODE_UNKNOWN = '—'

export function projectLineUpTerminals({
  fronts,
  terminalStates,
  terminalCodes,
  direction,
}: {
  fronts: Array<Pick<LineUpTerminalFront, 'sentido' | 'terminalId'>>
  terminalStates: Array<{
    terminalId: string | null
    terminalCode?: string | null
    terminalEtb?: string | null
    terminalAtb?: string | null
    terminalEtd?: string | null
    terminalAtd?: string | null
    terminalRtw?: number | null
  }>
  terminalCodes: ReadonlyMap<string, string>
  direction: LineUpTerminalFront['sentido']
}) {
  const directionFronts = fronts.filter((front) => front.sentido === direction)
  if (!directionFronts.length) return 'TBC'

  const stateByTerminal = new Map(terminalStates.filter((state) => state.terminalId).map((state) => [state.terminalId, state]))
  const assigned = new Map<string, { id: string; code: string; atb: string | null; etb: string | null }>()
  let hasTbc = false

  for (const front of directionFronts) {
    if (!front.terminalId) {
      hasTbc = true
      continue
    }
    if (assigned.has(front.terminalId)) continue
    assigned.set(front.terminalId, {
      id: front.terminalId,
      // Sem código cadastrado, mostrar o UUID do terminal não informa nada a
      // quem lê o Line Up. A FK validada torna o caso improvável, mas o
      // fallback existe — então que seja legível.
      code: terminalCodes.get(front.terminalId) ?? TERMINAL_CODE_UNKNOWN,
      etb: stateByTerminal.get(front.terminalId)?.terminalEtb ?? null,
      atb: stateByTerminal.get(front.terminalId)?.terminalAtb ?? null,
    })
  }

  const labels = [...assigned.entries()]
    .sort(([, left], [, right]) => compareAtracacoes(
      { terminalId: left.id, terminalCode: left.code, etb: left.etb, atb: left.atb },
      { terminalId: right.id, terminalCode: right.code, etb: right.etb, atb: right.atb },
    ))
    .map(([, terminal]) => terminal.code)
  if (hasTbc) labels.push('TBC')
  return labels.length ? labels.join(' / ') : 'TBC'
}

export function projectLineUpTerminalDates({
  fronts,
  terminalStates,
  direction,
}: {
  fronts: Array<Pick<LineUpTerminalFront, 'sentido' | 'terminalId'>>
  terminalStates: Array<{
    terminalId: string | null
    terminalEtb?: string | null
    terminalAtb?: string | null
    terminalEtd?: string | null
    terminalAtd?: string | null
    terminalRtw?: number | null
  }>
  direction: LineUpTerminalFront['sentido']
}) {
  const assignedIds = new Set(fronts.filter((front) => front.sentido === direction && front.terminalId).map((front) => front.terminalId as string))
  const assignedStates = terminalStates.filter((state) => state.terminalId && assignedIds.has(state.terminalId))
  const first = sortAtracacoes(assignedStates
    .map((state) => ({ terminalId: state.terminalId, etb: state.terminalEtb ?? null, atb: state.terminalAtb ?? null })))
    .at(0)
  const state = first?.terminalId
    ? terminalStates.find((candidate) => candidate.terminalId === first.terminalId)
    : undefined
  const restow = assignedStates
    .reduce((total, candidate) => total + (candidate.terminalRtw ?? 0), 0)
  // A linha e do grao (escala, sentido): a sua saida e a da ultima Atracacao
  // que hospeda uma frente deste sentido, e so existe quando todas elas
  // desatracaram. Sem terminal atribuido nao ha o que derivar aqui e o
  // chamador recai no ATD derivado da Escala.
  const atd = assignedStates.length > 0 && assignedStates.every((candidate) => candidate.terminalAtd)
    ? assignedStates.reduce<string | null>((latest, candidate) => (
      latest === null || (candidate.terminalAtd ?? '') > latest ? candidate.terminalAtd ?? latest : latest
    ), null)
    : null
  return {
    etb: state?.terminalEtb ?? null,
    atb: state?.terminalAtb ?? null,
    atd,
    hasAssignedTerminal: assignedStates.length > 0,
    rtw: restow > 0 ? restow : null,
  }
}

export function lineUpScheduleDates(schedule: { ata?: string | null; atb?: string | null; atd?: string | null } | undefined) {
  return {
    ata: schedule?.ata ?? null,
    atb: schedule?.atb ?? null,
    atd: schedule?.atd ?? null,
  }
}

export async function fetchLineUpSnapshot(voyageLimit = 60): Promise<LineUpSnapshot> {
  const voyageResult = await fetchVoyages(voyageLimit)
  const voyages = voyageResult.rows
  const pageMeta = voyageResult.totalCount > voyages.length
    ? { hasMore: true, totalVoyages: voyageResult.totalCount }
    : {}
  const voyageIds = voyages.map((voyage) => voyage.id)
  if (!voyageIds.length) return { rows: [], lastChangedAt: null, ...pageMeta }

  // Uma unica leitura de `depots` alimenta o mapa de codigos daqui e a
  // resolucao de codigo dentro das duas projecoes de Atracacao; sem
  // compartilhar a promise seriam tres leituras por atualizacao do Line-Up.
  const depotsPromise = listDepots()
  const [bls, vehicles, vaziosImportacaoMtyByVoyage, escalaSchedulesByVoyage, terminalStatesByVoyage, terminalFrontsByVoyage, depots] = await Promise.all([
    fetchBlsByVoyageIds(voyageIds),
    fetchVehiclesByVoyageIds(voyageIds),
    fetchVaziosImportacaoMtyByVoyageIds(voyageIds),
    listVoyageEscalaSchedulesByVoyageIds(voyageIds, depotsPromise),
    listVoyageTerminalScaleStatesByVoyageIds(voyageIds, depotsPromise),
    fetchTerminalFrontsByVoyageIds(voyageIds),
    depotsPromise,
  ])

  const terminalCodes = new Map(
    depots.flatMap((depot) => depot.id && depot.code ? [[String(depot.id), depot.code.trim()]] as const : []),
  )

  const blIds = bls.map((bl) => bl.id)
  // Os containers necessários para a projeção já vêm no mesmo read-model dos
  // B/Ls. Isso elimina a segunda fase `bl_ids -> bl_containers` a cada refresh
  // do Line Up, sem carregar frete ou outros detalhes que a tabela não usa.
  const containers = bls.flatMap((bl) => bl.bl_containers ?? [])

  const blsByVoyage = new Map<number, LineUpBlRow[]>()
  for (const bl of bls) {
    const current = blsByVoyage.get(bl.voyage_id) ?? []
    current.push(bl)
    blsByVoyage.set(bl.voyage_id, current)
  }

  const containersByBl = new Map<string, LineUpContainerRow[]>()
  for (const container of containers) {
    const blId = String(container.bl_id ?? '')
    if (!blId) continue
    const current = containersByBl.get(blId) ?? []
    current.push(container)
    containersByBl.set(blId, current)
  }

  const vehiclesByVoyage = new Map<number, LineUpVehicleRow[]>()
  for (const vehicle of vehicles) {
    const current = vehiclesByVoyage.get(vehicle.voyage_id) ?? []
    current.push(vehicle)
    vehiclesByVoyage.set(vehicle.voyage_id, current)
  }

  const rows: LineUpRow[] = []

  for (const voyage of voyages) {
    const voyageBls = blsByVoyage.get(voyage.id) ?? []
    const voyageEscalas = escalaSchedulesByVoyage.get(voyage.id) ?? []
    const voyageTerminalStates = terminalStatesByVoyage.get(voyage.id) ?? []
    const voyageTerminalFronts = terminalFrontsByVoyage.get(voyage.id) ?? []
    const escalasByPort = new Map(voyageEscalas.map((schedule) => [normalizePort(schedule.port), schedule]))
    const scheduledPorts = voyageEscalas
      .filter((schedule) => hasActiveEscalaScheduleData(schedule))
      .map((schedule) => normalizePort(schedule.port))
    const routePods = Array.from(new Set([...voyageBls.map((bl) => normalizePort(bl.pod)), ...scheduledPorts]))
    const voyageVehicles = vehiclesByVoyage.get(voyage.id) ?? []

    for (const pod of routePods) {
      const routeBls = voyageBls.filter((bl) => normalizePort(bl.pod) === pod)
      const routeBlIds = new Set(routeBls.map((bl) => bl.id))
      const schedule = escalasByPort.get(pod)
      const terminalFronts = voyageTerminalFronts.filter((front) => normalizePort(front.port) === pod)
      const terminalStates = voyageTerminalStates.filter((state) => normalizePort(state.port) === pod)
      const importTerminal = projectLineUpTerminals({
        fronts: terminalFronts,
        terminalStates,
        terminalCodes,
        direction: 'importacao',
      })
      const exportTerminal = projectLineUpTerminals({
        fronts: terminalFronts,
        terminalStates,
        terminalCodes,
        direction: 'exportacao',
      })
      const importDates = projectLineUpTerminalDates({ fronts: terminalFronts, terminalStates, direction: 'importacao' })
      const exportDates = projectLineUpTerminalDates({ fronts: terminalFronts, terminalStates, direction: 'exportacao' })
      const hasExportSchedule = Boolean(schedule?.temExportacao)
      const isExportOnly = !routeBls.length && hasExportSchedule && !schedule?.temImportacao

      const distinctContainers = new Map<string, { id: number }>()

      for (const bl of routeBls) {
        for (const container of containersByBl.get(bl.id) ?? []) {
          const key = normalizeContainerKey(container.container_number, container.id)
          if (!key || distinctContainers.has(key)) continue
          distinctContainers.set(key, { id: container.id })
        }
      }

      const routeContainerIds = new Set(Array.from(distinctContainers.values()).map((container) => container.id))
      const containerKeyById = new Map(
        Array.from(distinctContainers.entries()).map(([containerKey, container]) => [container.id, containerKey]),
      )
      const routeVehicles = voyageVehicles.filter(
        (vehicle) => routeBlIds.has(vehicle.bl_id) || routeContainerIds.has(vehicle.container_id),
      )

      const vehicleContainerKeys = new Set<string>()
      for (const vehicle of routeVehicles) {
        const containerKey = containerKeyById.get(vehicle.container_id)
        if (containerKey) vehicleContainerKeys.add(containerKey)
      }

      const totalContainers = distinctContainers.size
      const carContainers = vehicleContainerKeys.size
      const ceFilledCount = routeBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
      const autoCeStatus = deriveAutomaticVoyagePodCeStatus(ceFilledCount, routeBls.length) ?? 'missing'

      const bbMachines = routeBls.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0)
      const bbPackages = routeBls.reduce((sum, bl) => sum + Number(bl.bb_packages_qty ?? 0), 0)

      if (!isExportOnly) {
        rows.push({
          id: `${voyage.id}::${pod}`,
          voyageId: voyage.id,
          voyageNumber: voyage.voyage_number,
          voyageStatus: voyage.status,
          vesselName: voyage.vessel?.name ?? '-',
          pod,
          eta: schedule?.eta ?? null,
          etb: importDates.etb,
          ...lineUpScheduleDates({ ata: schedule?.ata, atb: importDates.atb, atd: importDates.hasAssignedTerminal ? importDates.atd : schedule?.atd }),
          rowType: 'import',
          omitted: schedule?.omitted ?? false,
          importTerminal,
          exportTerminal: 'TBC',
          vin: routeVehicles.length,
          car: carContainers,
          cg: Math.max(totalContainers - carContainers, 0),
          total: totalContainers,
          mty: 0,
          rtw: importDates.rtw,
          bbMachines,
          bbPackages,
          bbTotal: bbMachines + bbPackages,
          ceStatus: (schedule?.ceStatus as VoyagePodCeStatus | null) ?? autoCeStatus,
          linked: schedule?.linked ?? false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: null,
          exportLinked: null,
        })
      }

      if (hasExportSchedule) {
        rows.push({
          id: `exp::${voyage.id}::${pod}`,
          voyageId: voyage.id,
          voyageNumber: voyage.voyage_number,
          voyageStatus: voyage.status,
          vesselName: voyage.vessel?.name ?? '-',
          pod,
          eta: schedule?.eta ?? null,
          etb: exportDates.etb,
          ...lineUpScheduleDates({ ata: schedule?.ata, atb: exportDates.atb, atd: exportDates.hasAssignedTerminal ? exportDates.atd : schedule?.atd }),
          rowType: 'export',
          omitted: schedule?.omitted ?? false,
          importTerminal: 'TBC',
          exportTerminal,
          vin: 0,
          car: 0,
          cg: 0,
          total: 0,
          mty: 0,
          rtw: null,
          bbMachines: 0,
          bbPackages: 0,
          bbTotal: 0,
          ceStatus: 'missing',
          linked: false,
          exportHasGranite: schedule?.temGranito ?? null,
          exportContainersQty: schedule?.containersQty ?? null,
          exportMovementsQty: schedule?.movementsQty ?? null,
          exportCeStatus: schedule?.exportCeStatus ?? null,
          exportLinked: schedule?.linked ?? null,
        })
      }
    }
  }

  const sortedRows = rows.sort((left, right) => {
    const etaComparison = compareDateValues(left.eta, right.eta)
    if (etaComparison !== 0) return etaComparison
    const etbComparison = compareDateValues(left.etb, right.etb)
    if (etbComparison !== 0) return etbComparison
    if (left.vesselName !== right.vesselName) return left.vesselName.localeCompare(right.vesselName, 'pt-BR')
    if (left.voyageNumber !== right.voyageNumber) return left.voyageNumber.localeCompare(right.voyageNumber, 'pt-BR')
    return left.pod.localeCompare(right.pod, 'pt-BR')
  })

  // MTY = exclusively Vazios Importacao containers, credited to the first route of each voyage
  const creditedVoyageIds = new Set<number>()
  for (const row of sortedRows) {
    if (creditedVoyageIds.has(row.voyageId)) continue
    const vaziosImportacaoCount = vaziosImportacaoMtyByVoyage.get(row.voyageId) ?? 0
    row.mty = vaziosImportacaoCount
    creditedVoyageIds.add(row.voyageId)
  }

  const scheduleEntityIds = Array.from(escalaSchedulesByVoyage.values())
    .flatMap((schedules) => schedules.map((schedule) => schedule.entityId))
  const lastChangedAt = await fetchLastLineUpChangeAt(voyageIds, blIds, scheduleEntityIds)

  return {
    rows: sortedRows,
    lastChangedAt,
    ...pageMeta,
  }
}

type TerminalFrontQuery = {
  select: (columns: string) => TerminalFrontQuery
  in: (column: string, values: number[]) => TerminalFrontQuery
  then: Promise<{ data: unknown; error: unknown | null }>['then']
}

async function fetchTerminalFrontsByVoyageIds(voyageIds: number[]) {
  const result = new Map<number, LineUpTerminalFront[]>()
  if (!voyageIds.length) return result

  for (const voyageChunk of chunkArray(voyageIds, 25)) {
    const { data, error } = await (supabase.from as unknown as (table: string) => TerminalFrontQuery)('voyage_escala_operation_fronts')
      .select('voyage_id, port, sentido, terminal_id')
      .in('voyage_id', voyageChunk)
    if (error) throw error

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (typeof row.voyage_id !== 'number' || typeof row.port !== 'string') continue
      if (row.sentido !== 'importacao' && row.sentido !== 'exportacao') continue
      const fronts = result.get(row.voyage_id) ?? []
      fronts.push({
        voyageId: row.voyage_id,
        port: row.port,
        sentido: row.sentido,
        terminalId: typeof row.terminal_id === 'string' ? row.terminal_id : null,
      })
      result.set(row.voyage_id, fronts)
    }
  }
  return result
}

function hasActiveEscalaScheduleData(schedule: {
  eta?: string | null
  etb?: string | null
  ata?: string | null
  atb?: string | null
  etd?: string | null
  atd?: string | null
  rtw?: number | null
  ceStatus?: VoyagePodCeStatus | null
  linked?: boolean | null
  temExportacao?: boolean
}) {
  if (schedule.temExportacao) return true
  if (schedule.eta || schedule.etb || schedule.ata || schedule.atb || schedule.etd || schedule.atd) return true
  if (schedule.linked === true) return true
  if (schedule.ceStatus && schedule.ceStatus !== 'waiting' && schedule.ceStatus !== 'missing') return true
  return false
}

async function fetchVoyages(limit: number) {
  const { data, error, count } = await supabase
    .from('voyages')
    .select('id, voyage_number, status, vessel:vessels(name), pol:ports!pol_id(name, locode)', { count: 'exact' })
    .in('status', ['active', 'completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .range(0, Math.max(0, Math.min(limit, 500)) - 1)
    .overrideTypes<LineUpVoyageRow[], { merge: false }>()

  if (error) throw error
  return { rows: data ?? [], totalCount: count ?? data?.length ?? 0 }
}

async function fetchBlsByVoyageIds(voyageIds: number[]) {
  const rows: LineUpBlRow[] = []

  for (const voyageChunk of chunkArray(voyageIds, 25)) {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('bls')
        .select('id, voyage_id, pod, cargo_mode, ce_mercante, bb_machine_qty, bb_packages_qty, bl_containers(id, bl_id, container_number, tare_weight_kg, gross_weight_kg)')
        .in('voyage_id', voyageChunk)
        .order('id', { ascending: true })
        .range(from, from + 999)
        .overrideTypes<LineUpBlRow[], { merge: false }>()

      if (error) throw error
      const batch = data ?? []
      if (!batch.length) break
      rows.push(...batch)
      if (batch.length < 1000) break
      from += 1000
    }
  }

  return rows
}

async function fetchVehiclesByVoyageIds(voyageIds: number[]) {
  const rows: LineUpVehicleRow[] = []

  for (const voyageChunk of chunkArray(voyageIds, 25)) {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('vehicles')
        .select('voyage_id, bl_id, container_id')
        .in('voyage_id', voyageChunk)
        .order('id', { ascending: true })
        .range(from, from + 999)
        .overrideTypes<LineUpVehicleRow[], { merge: false }>()

      if (error) throw error
      const batch = data ?? []
      if (!batch.length) break
      rows.push(...batch)
      if (batch.length < 1000) break
      from += 1000
    }
  }

  return rows
}

async function fetchVaziosImportacaoMtyByVoyageIds(voyageIds: number[]) {
  const countByVoyage = new Map<number, number>()
  if (!voyageIds.length) return countByVoyage

  for (const voyageChunk of chunkArray(voyageIds, 50)) {
    // A relação inner já restringe os containers ao conjunto de viagens. A
    // versão anterior lia manifestos, criava chunks de ids e então fazia uma
    // segunda cascata de páginas; em um refresh isso virava um waterfall
    // proporcional ao número de manifestos.
    let from = 0
    while (true) {
      const { data: containerRows, error: containerError } = await supabase
        .from('vazios_importacao_containers')
        .select('manifest:vazios_importacao_manifests!inner(voyage_id)')
        .in('manifest.voyage_id', voyageChunk)
        .range(from, from + 999)
        .overrideTypes<Array<{ manifest: { voyage_id: number | null } | null }>, { merge: false }>()
      if (containerError) throw containerError
      const batch = containerRows ?? []
      if (!batch.length) break
      for (const container of batch) {
        const voyageId = container.manifest?.voyage_id
        if (voyageId == null) continue
        countByVoyage.set(voyageId, (countByVoyage.get(voyageId) ?? 0) + 1)
      }
      if (batch.length < 1000) break
      from += 1000
    }
  }

  return countByVoyage
}

async function fetchLastLineUpChangeAt(voyageIds: number[], blIds: string[], scheduleEntityIds: string[]) {
  const [voyageLatest, blLatest, containerLatest, vehicleLatest, scheduleLatest] = await Promise.all([
    fetchLatestTimestampForVoyages('voyages', 'id', voyageIds, 'created_at'),
    blIds.length
      ? fetchLatestTimestamp(
          supabase
            .from('bls')
            .select('updated_at')
            .in('id', blIds)
            .order('updated_at', { ascending: false })
            .limit(1),
          'updated_at',
        )
      : Promise.resolve<string | null>(null),
    blIds.length
      ? fetchLatestTimestamp(
          supabase
            .from('bl_containers')
            .select('created_at')
            .in('bl_id', blIds)
            .order('created_at', { ascending: false })
            .limit(1),
          'created_at',
        )
      : Promise.resolve<string | null>(null),
    fetchLatestTimestampForVoyages('vehicles', 'voyage_id', voyageIds, 'created_at'),
    scheduleEntityIds.length
      ? fetchLatestTimestamp(
          supabase
            .from('audit_logs')
            .select('changed_at')
            .in('entity_type', ['voyage_pod_schedule', 'voyage_pol_schedule'])
            .in('entity_id', scheduleEntityIds)
            .order('changed_at', { ascending: false })
            .limit(1),
          'changed_at',
        )
      : Promise.resolve<string | null>(null),
  ])

  return [voyageLatest, blLatest, containerLatest, vehicleLatest, scheduleLatest]
    .filter(Boolean)
    .sort((left, right) => new Date(right!).getTime() - new Date(left!).getTime())[0] ?? null
}

async function fetchLatestTimestampForVoyages(table: string, column: string, voyageIds: number[], field: string) {
  const values = await Promise.all(chunkArray(voyageIds, 25).map((voyageChunk) => fetchLatestTimestamp(
    (supabase.from as unknown as (tableName: string) => {
      select: (columns: string) => { in: (name: string, ids: number[]) => { order: (fieldName: string, options: { ascending: boolean }) => { limit: (limit: number) => PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }> } } }
    }
    )(table).select(field).in(column, voyageChunk).order(field, { ascending: false }).limit(1),
    field,
  )))
  return values.filter(Boolean).sort((left, right) => new Date(right!).getTime() - new Date(left!).getTime())[0] ?? null
}

async function fetchLatestTimestamp<T extends Record<string, unknown>>(
  queryPromise: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  field: keyof T,
) {
  const result = await queryPromise
  if (result.error) throw result.error
  const value = result.data?.[0]?.[field]
  return typeof value === 'string' ? value : null
}

function normalizePort(value: string | null | undefined) {
  return normalizePortCode(value) ?? '-'
}

function normalizeContainerKey(containerNumber: string | null | undefined, containerId: number) {
  const number = String(containerNumber ?? '').trim().toUpperCase()
  if (number) return number
  return Number.isInteger(containerId) ? `ID-${containerId}` : ''
}



function toSortableDateValue(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY
  if (isDateOnly(value)) {
    const timestamp = Date.parse(`${value}T00:00:00`)
    return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
  }
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
}

export function compareDateValues(left: string | null, right: string | null) {
  // Subtrair os valores ordenáveis produziria NaN quando ambos são nulos
  // (Infinity - Infinity), o que faria o comparador "vazar" um NaN e pular os
  // critérios de desempate (etb/navio/viagem/pod). Comparar por igualdade evita
  // isso e mantém nulos no fim.
  const leftValue = toSortableDateValue(left)
  const rightValue = toSortableDateValue(right)
  if (leftValue === rightValue) return 0
  return leftValue < rightValue ? -1 : 1
}
