import { DEFAULT_CARRIER_NAME, DEFAULT_CARRIER_SCAC } from './voyageForm'
import { supabase } from './supabase'
import {
  createVoyage,
  findVoyageByNumberAndVessel,
  setVoyageShowOnPortal,
} from './voyages'
import { canonicalizeVesselName, normalizeVesselImo } from '../lib/vesselAlias'
import {
  buildVoyagePodEntityId,
  buildVoyagePodScheduleChanges,
  buildVoyagePolEntityId,
  buildVoyagePolScheduleChanges,
  deleteVoyagePodSchedule,
  listVoyagePodSchedules,
  listVoyagePolSchedules,
  makeEmptyPodSchedule as emptyPod,
  makeEmptyPolSchedule as emptyPol,
  saveVoyagePodSchedule,
  saveVoyagePolSchedule,
} from './voyageRouteSchedules'

export type ScheduleLaneInput = {
  /** Code canonico do porto (de portalLaneCode). */
  code: string
  kind: 'pol' | 'pod'
  /** Data ISO (YYYY-MM-DD) ou null/'' quando o porto nao escala. */
  date: string | null
}

export type VoyageScheduleInput = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  lanes: ScheduleLaneInput[]
}

export type ScheduleWriteMode = 'form' | 'bulk'

export type ScheduleWriteOptions = {
  mode?: ScheduleWriteMode
  /** Viagem alvo conhecida (edicao): pula a deduplicacao por VOY+navio. */
  voyageId?: number
  /**
   * "Nao escala" so retira a escala para o Administrativo, e o banco ainda
   * aplica a trava do CE (migration 090; ADR 0071). Para os demais, a data
   * prevista e limpa e a escala continua.
   */
  canRemoveEscala?: boolean
}

export function partitionScheduleLanes(lanes: ScheduleLaneInput[]) {
  const pols: Array<{ code: string; etd: string }> = []
  const pods: Array<{ pod: string; eta: string }> = []
  for (const lane of lanes) {
    const date = (lane.date ?? '').trim()
    if (!date) continue
    if (lane.kind === 'pol') pols.push({ code: lane.code, etd: date })
    else pods.push({ pod: lane.code, eta: date })
  }
  return { pols, pods }
}

function collectClearedLanes(lanes: ScheduleLaneInput[]) {
  const pols: string[] = []
  const pods: string[] = []
  for (const lane of lanes) {
    if ((lane.date ?? '').trim()) continue
    if (lane.kind === 'pol') pols.push(lane.code)
    else pods.push(lane.code)
  }
  return { pols, pods }
}

async function podHasOperationalAnchor(
  voyageId: number,
  podCode: string,
  current: { ata: string | null; atd: string | null; linked: boolean | null },
): Promise<boolean> {
  const { data, error } = await supabase
    .from('voyage_escala_revision_state')
    .select('revision')
    .eq('voyage_id', voyageId)
    .eq('port', podCode)
    .maybeSingle()
  if (error) throw error
  if (Number((data as { revision?: number } | null)?.revision ?? 0) > 0) return true
  if (current.ata || current.atd || current.linked) return true

  const { count, error: blError } = await supabase
    .from('bls')
    .select('id', { count: 'exact', head: true })
    .eq('voyage_id', voyageId)
    .eq('pod', podCode)
  if (blError) throw blError
  return (count ?? 0) > 0
}

async function cancelClearedLanes(
  voyageId: number,
  lanes: ScheduleLaneInput[],
  changedBy: string | null,
  canRemoveEscala: boolean,
) {
  const cleared = collectClearedLanes(lanes)

  const clearedPolIds = cleared.pols.map((code) => buildVoyagePolEntityId(voyageId, code))
  const currentPols = await listVoyagePolSchedules(clearedPolIds)
  await Promise.all(cleared.pols.map((code) => {
    const current = currentPols.get(buildVoyagePolEntityId(voyageId, code))
    if (!current?.etd) return Promise.resolve()
    return saveVoyagePolSchedule({ voyageId, pol: code, etd: null, changedBy })
  }))

  const clearedPodIds = cleared.pods.map((code) => buildVoyagePodEntityId(voyageId, code))
  const currentPods = await listVoyagePodSchedules(clearedPodIds)
  await Promise.all(cleared.pods.map(async (code) => {
    const current = currentPods.get(buildVoyagePodEntityId(voyageId, code))
    if (!current) return
    const anchored = !canRemoveEscala || await podHasOperationalAnchor(voyageId, code, current)
    if (anchored) {
      if (current.eta === null) return
      await saveVoyagePodSchedule({
        voyageId,
        pod: code,
        eta: null,
        ata: current.ata ?? null,
        ceStatus: current.ceStatus ?? null,
        linked: current.linked ?? false,
        changedBy,
      })
      return
    }
    await deleteVoyagePodSchedule({ voyageId, pod: code, changedBy })
  }))
}

export async function createOrAttachVoyageFromSchedule(
  input: VoyageScheduleInput,
  changedBy: string | null,
  options: ScheduleWriteOptions = {},
) {
  const mode = options.mode ?? 'bulk'
  const { pols, pods } = partitionScheduleLanes(input.lanes)
  const existingId = options.voyageId
    ?? await findVoyageByNumberAndVessel(input.voyageNumber, input.vesselImo, input.vesselName)
  const voyageId = existingId ?? (await createVoyage({
    carrierName: DEFAULT_CARRIER_NAME,
    carrierScac: DEFAULT_CARRIER_SCAC,
    vesselName: input.vesselName,
    vesselImo: input.vesselImo,
    voyageNumber: input.voyageNumber,
    status: 'active',
  }, changedBy)).id

  await setVoyageShowOnPortal(voyageId, true)

  await Promise.all(pols.map((pol) => saveVoyagePolSchedule({
    voyageId,
    pol: pol.code,
    etd: pol.etd,
    changedBy,
  })))

  const entityIds = pods.map((pod) => buildVoyagePodEntityId(voyageId, pod.pod))
  const currentSchedules = await listVoyagePodSchedules(entityIds)

  await Promise.all(pods.map((pod) => {
    const current = currentSchedules.get(buildVoyagePodEntityId(voyageId, pod.pod))
    return saveVoyagePodSchedule({
      voyageId,
      pod: pod.pod,
      eta: pod.eta,
      ata: current?.ata ?? null,
      ceStatus: current?.ceStatus ?? null,
      linked: current?.linked ?? false,
      changedBy,
    })
  }))

  if (mode === 'form') {
    await cancelClearedLanes(voyageId, input.lanes, changedBy, options.canRemoveEscala ?? false)
  }

  return { voyageId, created: existingId === null }
}

// ── Programação por planilha: prévia e gravação atômica (migration 187) ──────

export type ScheduleSheetChange = {
  entity_type: string
  port: string
  field_name: string
  old_value: string | null
  new_value: string | null
  justification: string
}

export type ScheduleSheetPlanRow = {
  label: string
  vesselName: string
  vesselImo: string | null
  voyageNumber: string
  voyageId: number | null
  /** Viagem nova: criada na gravação, com o navio pelo IMO ou nome. */
  createsVoyage: boolean
  changes: ScheduleSheetChange[]
  error: string | null
}

const portOf = (entityId: string) => entityId.split('::').slice(1).join('::')

/**
 * Prévia da planilha: para cada linha, a Viagem (existente ou nova) e as datas
 * que mudam, pelas mesmas regras da gravação individual. Nada é gravado.
 */
export async function planScheduleSheet(rows: VoyageScheduleInput[], changedBy: string | null): Promise<ScheduleSheetPlanRow[]> {
  const plan: ScheduleSheetPlanRow[] = []
  for (const row of rows) {
    const base = {
      label: `${row.vesselName} / ${row.voyageNumber}`,
      vesselName: canonicalizeVesselName(row.vesselName.trim()),
      vesselImo: normalizeVesselImo(row.vesselImo),
      voyageNumber: row.voyageNumber.trim(),
    }
    try {
      const voyageId = await findVoyageByNumberAndVessel(row.voyageNumber, row.vesselImo, row.vesselName)
      const { pols, pods } = partitionScheduleLanes(row.lanes)
      const prefix = voyageId ?? 0
      const polIds = pols.map((pol) => buildVoyagePolEntityId(prefix, pol.code))
      const podIds = pods.map((pod) => buildVoyagePodEntityId(prefix, pod.pod))
      const [currentPols, currentPods] = voyageId
        ? await Promise.all([listVoyagePolSchedules(polIds), listVoyagePodSchedules(podIds)])
        : [new Map(), new Map()]
      const changes: ScheduleSheetChange[] = []
      const push = (list: Array<{ entity_type: string; entity_id: string; field_name: string; old_value: string | null; new_value: string | null; justification: string | null }>) => {
        for (const item of list) changes.push({ entity_type: item.entity_type, port: portOf(item.entity_id), field_name: item.field_name, old_value: item.old_value, new_value: item.new_value, justification: item.justification ?? '' })
      }
      pols.forEach((pol, index) => {
        const id = polIds[index]
        push(buildVoyagePolScheduleChanges(id, currentPols.get(id) ?? emptyPol(id), { etd: pol.etd, changedBy }))
      })
      pods.forEach((pod, index) => {
        const id = podIds[index]
        const current = currentPods.get(id) ?? emptyPod(id)
        push(buildVoyagePodScheduleChanges(id, current, {
          eta: pod.eta, ata: current.ata ?? null, ceStatus: current.ceStatus ?? null, linked: current.linked ?? false, changedBy,
        }))
      })
      plan.push({ ...base, voyageId, createsVoyage: voyageId === null, changes, error: null })
    } catch (error) {
      plan.push({ ...base, voyageId: null, createsVoyage: false, changes: [], error: error instanceof Error ? error.message : 'falha inesperada' })
    }
  }
  return plan
}

/** Grava a prévia numa transação: se uma linha falha, nada é gravado. */
export async function applyScheduleSheetPlan(plan: ScheduleSheetPlanRow[]): Promise<{ created: number; updated: number; changes: number }> {
  const rows = plan.filter((row) => !row.error && (row.createsVoyage || row.changes.length))
  if (!rows.length) return { created: 0, updated: 0, changes: 0 }
  const { data, error } = await supabase.rpc('apply_schedule_sheet_atomic' as never, {
    p_rows: rows.map((row) => ({
      voyage_id: row.voyageId,
      vessel_name: row.vesselName,
      vessel_imo: row.vesselImo,
      voyage_number: row.voyageNumber,
      changes: row.changes,
    })),
    p_carrier_name: DEFAULT_CARRIER_NAME,
    p_carrier_scac: DEFAULT_CARRIER_SCAC,
  } as never)
  if (error) throw error
  return data as unknown as { created: number; updated: number; changes: number }
}
