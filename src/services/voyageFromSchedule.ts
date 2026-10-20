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

// ── Programação por planilha: prévia e gravação atômica (migrations 188 e 193) ──

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
  /** IMO que identifica o navio: 7 dígitos, ou null (a busca é pelo nome). */
  vesselImo: string | null
  /** IMO da planilha que não identifica navio ("TBA", "-"): a busca foi pelo nome. */
  ignoredImo: string | null
  voyageNumber: string
  voyageId: number | null
  /** Viagem nova: criada na gravação, com o navio pelo IMO ou nome. */
  createsVoyage: boolean
  /** Viagem existente oculta no Portal: a gravação a publica, mesmo sem data que mude. */
  publishes: boolean
  changes: ScheduleSheetChange[]
  error: string | null
}

const portOf = (entityId: string) => entityId.split('::').slice(1).join('::')

/**
 * IMO que identifica o navio na planilha: 7 dígitos, com ou sem o prefixo
 * "IMO". "TBA", "-" e afins não casam com navio nenhum (migration 193).
 */
export function scheduleSheetImo(value: string | null | undefined): string | null {
  const imo = normalizeVesselImo(value)
  return imo && /^\d{7}$/.test(imo) ? imo : null
}

/** Linha que a gravação envia: Viagem nova, Viagem a publicar ou data que muda. */
export function isScheduleSheetWrite(row: ScheduleSheetPlanRow): boolean {
  return !row.error && (row.createsVoyage || row.publishes || row.changes.length > 0)
}

/**
 * Navio que a gravação usará para a Viagem nova, pelas mesmas regras do
 * servidor (migration 193): IMO de 7 dígitos primeiro, depois o nome
 * canônico; nome igual com outro IMO cadastrado é conflito, nunca fusão.
 */
/**
 * Navio de uma Viagem nova: o problema que a gravação recusaria e se o IMO já
 * acha um navio cadastrado (`byImo`). Sem isso a gravação acha pelo nome.
 */
async function newVoyageVesselProblem(name: string, imo: string | null): Promise<{ problem: string | null; byImo: boolean }> {
  if (imo) {
    // ponytail: no máximo 20 candidatos pelo trecho do IMO, igualdade conferida
    // em memória (o servidor compara todos); upgrade = IMO canônico indexado.
    const { data, error } = await supabase.from('vessels').select('id, imo').ilike('imo', `%${imo}%`).limit(20)
    if (error) throw error
    const byImo = (data ?? []).filter((vessel) => normalizeVesselImo(vessel.imo) === imo)
    if (byImo.length > 1) return { problem: `Navio com IMO ${imo} ambíguo: mais de um cadastro. Corrija antes de importar.`, byImo: false }
    if (byImo.length === 1) return { problem: null, byImo: true }
  }
  const { data, error } = await supabase.from('vessels').select('id, imo').eq('name', name).limit(2)
  if (error) throw error
  if ((data ?? []).length > 1) return { problem: `Navio ${name} ambíguo: mais de um cadastro. Corrija antes de importar.`, byImo: false }
  const registeredImo = normalizeVesselImo(data?.[0]?.imo)
  if (imo && registeredImo && registeredImo !== imo) {
    return { problem: `Navio ${name} com IMO conflitante (${registeredImo} vs ${imo}). Corrija antes de importar.`, byImo: false }
  }
  return { problem: null, byImo: false }
}

/**
 * Mesma Viagem e porto em mais de uma linha com datas diferentes: a data
 * vigente dependeria da ordem do arquivo, então as linhas são recusadas.
 */
function conflictingRepeatedLanes(rows: VoyageScheduleInput[]): string | null {
  const dates = new Map<string, Set<string>>()
  for (const row of rows) {
    for (const lane of row.lanes) {
      const date = (lane.date ?? '').trim()
      if (!date) continue
      const key = `${lane.code} ${lane.kind === 'pol' ? 'ETD' : 'ETA'}`
      const seen = dates.get(key) ?? new Set<string>()
      seen.add(date)
      dates.set(key, seen)
    }
  }
  const conflicts = [...dates].filter(([, seen]) => seen.size > 1).map(([key, seen]) => `${key}: ${[...seen].join(', ')}`)
  return conflicts.length ? conflicts.join('; ') : null
}

/**
 * Prévia da planilha: para cada linha, a Viagem (existente ou nova) e as datas
 * que mudam, pelas mesmas regras da gravação individual. Nada é gravado.
 */
export async function planScheduleSheet(rows: VoyageScheduleInput[], changedBy: string | null): Promise<ScheduleSheetPlanRow[]> {
  const plan: ScheduleSheetPlanRow[] = []
  // Linhas de Viagem nova cujo navio a gravação acha pelo nome, com IMO: a
  // primeira grava o IMO no navio (202) e outra com IMO diferente, mesmo em
  // outra viagem, seria recusada como "IMO conflitante", desfazendo o arquivo.
  const byNameImos = new Map<string, number[]>()
  for (const row of rows) {
    const imo = scheduleSheetImo(row.vesselImo)
    const rawImo = normalizeVesselImo(row.vesselImo)
    const base = {
      label: `${row.vesselName} / ${row.voyageNumber}`,
      vesselName: canonicalizeVesselName(row.vesselName.trim()),
      vesselImo: imo,
      ignoredImo: rawImo && !imo ? row.vesselImo.trim() : null,
      voyageNumber: row.voyageNumber.trim(),
      publishes: false,
    }
    try {
      const voyageId = await findVoyageByNumberAndVessel(row.voyageNumber, imo ?? '', row.vesselName)
      const vessel = voyageId === null ? await newVoyageVesselProblem(base.vesselName, imo) : null
      if (vessel && !vessel.byImo && imo) byNameImos.set(base.vesselName, [...(byNameImos.get(base.vesselName) ?? []), plan.length])
      const vesselProblem = vessel?.problem ?? null
      if (vesselProblem) {
        plan.push({ ...base, voyageId: null, createsVoyage: false, changes: [], error: vesselProblem })
        continue
      }
      const { pols, pods } = partitionScheduleLanes(row.lanes)
      const prefix = voyageId ?? 0
      const polIds = pols.map((pol) => buildVoyagePolEntityId(prefix, pol.code))
      const podIds = pods.map((pod) => buildVoyagePodEntityId(prefix, pod.pod))
      const [currentPols, currentPods] = voyageId
        // POD removido entra com as datas que tinha e volta ao planejamento
        // (`deleted=false`): a gravação confere o `old_value` contra o último
        // valor no Histórico, que é o de antes da remoção (209).
        ? await Promise.all([listVoyagePolSchedules(polIds), listVoyagePodSchedules(podIds, { includeDeleted: true })])
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

  // Viagem existente: cancelada é erro da linha (somente leitura); oculta no
  // Portal é publicada pela gravação, como no cadastro pela tela.
  const voyageIds = [...new Set(plan.flatMap((row) => (row.voyageId ? [row.voyageId] : [])))]
  if (voyageIds.length) {
    const { data, error } = await supabase.from('voyages').select('id, status, show_on_portal').in('id', voyageIds)
    if (error) throw error
    const byId = new Map((data ?? []).map((voyage) => [Number(voyage.id), voyage]))
    for (const row of plan) {
      const voyage = row.voyageId ? byId.get(row.voyageId) : undefined
      if (!voyage || row.error) continue
      if (voyage.status === 'cancelled') {
        Object.assign(row, { error: `Viagem ${row.label} cancelada: a programação dela não muda. Retire a linha da planilha.`, changes: [] })
      } else if (voyage.show_on_portal !== true) {
        row.publishes = true
      }
    }
  }

  for (const [name, indexes] of byNameImos) {
    const open = indexes.filter((index) => !plan[index].error)
    const imos = [...new Set(open.map((index) => plan[index].vesselImo))]
    if (imos.length < 2) continue
    for (const index of open) {
      Object.assign(plan[index], { error: `Navio ${name} com IMOs diferentes no arquivo (${imos.join(', ')}). Deixe um IMO por navio.`, changes: [], publishes: false, createsVoyage: false })
    }
  }

  // Mesma Viagem e porto em mais de uma linha com datas diferentes: recusa.
  // Viagem nova: a gravação acha o navio pelo IMO ou pelo nome (193), então
  // linhas com o mesmo número e o mesmo IMO ou o mesmo nome são a mesma Viagem,
  // ainda que só uma traga o IMO.
  const parent = plan.map((_, index) => index)
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])))
  const firstByKey = new Map<string, number>()
  plan.forEach((row, index) => {
    if (row.error) return
    const number = row.voyageNumber.toUpperCase()
    const keys = row.voyageId
      ? [`id:${row.voyageId}`]
      : [`nome:${row.vesselName}:${number}`, ...(row.vesselImo ? [`imo:${row.vesselImo}:${number}`] : [])]
    for (const key of keys) {
      const first = firstByKey.get(key)
      if (first === undefined) firstByKey.set(key, index)
      else parent[root(index)] = root(first)
    }
  })
  const groups = new Map<number, number[]>()
  plan.forEach((row, index) => {
    if (row.error) return
    groups.set(root(index), [...(groups.get(root(index)) ?? []), index])
  })
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue
    // Mesmo navio novo (nome e viagem) com IMOs diferentes: a gravação criaria
    // o navio pela primeira linha e recusaria a outra ("IMO conflitante"),
    // desfazendo o arquivo inteiro. A prévia recusa as linhas antes.
    const imos = [...new Set(indexes.flatMap((index) => (plan[index].vesselImo ? [plan[index].vesselImo] : [])))]
    if (imos.length > 1) {
      for (const index of indexes) {
        Object.assign(plan[index], { error: `Navio ${plan[index].vesselName} com IMOs diferentes no arquivo (${imos.join(', ')}). Deixe um IMO por navio.`, changes: [], publishes: false, createsVoyage: false })
      }
      continue
    }
    const conflict = conflictingRepeatedLanes(indexes.map((index) => rows[index]))
    if (!conflict) continue
    for (const index of indexes) {
      Object.assign(plan[index], { error: `Viagem em ${indexes.length} linhas com datas diferentes (${conflict}). Deixe uma linha por viagem.`, changes: [], publishes: false, createsVoyage: false })
    }
  }
  return plan
}

/**
 * Grava a prévia numa transação: se uma linha falha, nada é gravado. Prévia
 * com qualquer linha em erro é recusada inteira (regra de 2026-10-19).
 */
export async function applyScheduleSheetPlan(plan: ScheduleSheetPlanRow[]): Promise<{ created: number; updated: number; changes: number; voyage_ids: number[] }> {
  const refused = plan.filter((row) => row.error)
  if (refused.length) {
    throw new Error(`A planilha tem ${refused.length === 1 ? '1 linha com erro' : `${refused.length} linhas com erro`}: nada foi gravado. Corrija e importe de novo.`)
  }
  const rows = plan.filter(isScheduleSheetWrite)
  if (!rows.length) return { created: 0, updated: 0, changes: 0, voyage_ids: [] }
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
  const result = data as unknown as { created: number; updated: number; changes: number; voyage_ids?: number[] | null }
  return { ...result, voyage_ids: (result.voyage_ids ?? []).map(Number) }
}
