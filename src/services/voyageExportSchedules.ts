import { supabase } from './supabase'
import { normalizePortCode } from './portCode'
import type { Json, VoyageExportCeStatus, VoyageExportSchedule as VoyageExportScheduleRow } from '../types/database'

export type ExportCeStatus = VoyageExportCeStatus

export type VoyageExportSchedule = {
  id: string
  voyageId: number
  pol: string | null
  temExportacao: boolean
  hasGranite: boolean
  /** Sempre booleano para consumidores; linhas legadas sem a coluna viram false na leitura. */
  hasEmpty: boolean
  containersQty: number | null
  movementsQty: number | null
  ceStatus: ExportCeStatus | null
  linked: boolean
  /** Ausente nas linhas gravadas antes da migration 254; leia como lista vazia. */
  dischargePorts?: string[]
}

export type VoyageExportSchedulesByPort = Map<string, VoyageExportSchedule>

type EscalaOperationFront = {
  sentido: string
  modalidade: string
  terminal_id: string | null
  source: string
}

type EscalaTerminalState = {
  terminal_id: string
  terminal_atb: string | null
  terminal_atd: string | null
  terminal_rtw: number | null
}

type ClosedBlocker = {
  terminal_code?: string
  report_id?: string
  reason?: string
}

export type VoyageExportScheduleSaveResult = {
  revision: number
  fronts: EscalaOperationFront[]
  terminals: EscalaTerminalState[]
  closed_blockers: ClosedBlocker[]
  blocked: boolean
}

export class VoyageExportScheduleBlockedError extends Error {
  readonly result: VoyageExportScheduleSaveResult

  constructor(result: VoyageExportScheduleSaveResult) {
    super('A exportação está bloqueada por ADR fechado.')
    this.name = 'VoyageExportScheduleBlockedError'
    this.result = result
  }
}

type ExportSchedulePickedRow = Pick<
  VoyageExportScheduleRow,
  'id' | 'voyage_id' | 'pol' | 'tem_exportacao' | 'has_granite' | 'has_empty' | 'containers_qty' | 'movements_qty' | 'ce_status' | 'linked' | 'discharge_ports'
>

export async function fetchExportSchedulesByVoyageIds(voyageIds: number[]): Promise<Map<number, VoyageExportSchedulesByPort>> {
  if (!voyageIds.length) return new Map()

  const { data, error } = await supabase
    .from('voyage_export_schedules')
    .select('id, voyage_id, pol, tem_exportacao, has_granite, has_empty, containers_qty, movements_qty, ce_status, linked, discharge_ports')
    .in('voyage_id', voyageIds)

  if (error) throw error

  const grouped = new Map<number, Array<{ portKey: string; schedule: VoyageExportSchedule }>>()
  for (const row of (data ?? []) as ExportSchedulePickedRow[]) {
    const schedule = {
      id: row.id,
      voyageId: row.voyage_id,
      pol: row.pol,
      temExportacao: row.tem_exportacao,
      hasGranite: row.has_granite,
      // Compatibilidade somente na leitura: linhas anteriores à migration 306
      // podem não trazer a coluna, mas o domínio nunca propaga undefined.
      hasEmpty: row.has_empty === true,
      containersQty: row.containers_qty,
      movementsQty: row.movements_qty,
      ceStatus: (row.ce_status as ExportCeStatus | null) ?? 'waiting',
      linked: row.linked,
      dischargePorts: row.discharge_ports ?? [],
    }
    const current = grouped.get(row.voyage_id) ?? []
    current.push({ portKey: buildExportSchedulePortKey(schedule), schedule })
    grouped.set(row.voyage_id, current)
  }

  const result = new Map<number, VoyageExportSchedulesByPort>()
  for (const [voyageId, schedules] of grouped) {
    const byPort = new Map<string, VoyageExportSchedule>()
    for (const { portKey, schedule } of schedules.sort((left, right) => left.portKey.localeCompare(right.portKey, 'pt-BR') || left.schedule.id.localeCompare(right.schedule.id))) {
      byPort.set(portKey, schedule)
    }
    result.set(voyageId, byPort)
  }
  return result
}

export async function saveVoyageExportSchedule(data: {
  existingId?: string | null
  voyageId: number
  pol: string | null
  temExportacao: boolean
  hasGranite: boolean
  hasEmpty: boolean
  containersQty: number | null
  movementsQty: number | null
  ceStatus: ExportCeStatus | null
  linked: boolean
  // Obrigatorio: o upsert sempre grava a coluna, entao omitir apagaria o que ja
  // esta la.
  dischargePorts: string[]
}): Promise<void> {
  const normalizedPol = normalizeExportSchedulePol(data.pol)
  // A exportação é de uma escala; sem porto não há escala a que pertencer.
  if (!normalizedPol) throw new Error('A exportação exige o porto da escala.')

  const payload = {
    voyage_id: data.voyageId,
    pol: normalizedPol,
    tem_exportacao: data.temExportacao,
    has_granite: data.hasGranite,
    has_empty: data.hasEmpty,
    containers_qty: data.containersQty,
    movements_qty: data.movementsQty,
    ce_status: data.ceStatus,
    linked: data.linked,
    discharge_ports: normalizeDischargePorts(data.dischargePorts),
    updated_at: new Date().toISOString(),
  } satisfies Partial<VoyageExportScheduleRow>

  if (data.existingId) {
    const { error } = await supabase
      .from('voyage_export_schedules')
      .update(payload)
      .eq('id', data.existingId)

    if (error) throw error
    return
  }

  const { error } = await supabase
    .from('voyage_export_schedules')
    .upsert(
      payload,
      { onConflict: 'voyage_id,pol' },
    )

  if (error) throw error
}

export type SaveVoyageExportScheduleTransactionalInput = {
  existingId?: string | null
  voyageId: number
  pol: string
  temExportacao: boolean
  hasGranite: boolean
  hasEmpty: boolean
  containersQty: number | null
  movementsQty: number | null
  dischargePorts: string[]
  ceStatus: ExportCeStatus | null
  linked: boolean
  /** Revisão capturada pelo editor antes da edição; não é relida aqui. */
  expectedRevision: number
  justification?: string | null
}

/**
 * Atualiza somente as frentes exportadoras pela RPC terminalizada. A leitura
 * completa antes da escrita é obrigatória: importar apenas as frentes novas
 * faria a RPC apagar importação, atribuições ou estado de terminal existentes.
 */
export async function saveVoyageExportScheduleTransactional(
  input: SaveVoyageExportScheduleTransactionalInput,
): Promise<VoyageExportScheduleSaveResult> {
  const normalizedPol = normalizeExportSchedulePol(input.pol)
  if (!normalizedPol) throw new Error('A exportação exige o porto da escala.')
  if (input.temExportacao && !input.hasGranite && !input.hasEmpty && !input.existingId) {
    throw new Error('Uma nova declaração de exportação exige granito ou vazios.')
  }

  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('Revisão esperada inválida.')
  }

  const [frontsResult, terminalsResult] = await Promise.all([
    supabase
      .from('voyage_escala_operation_fronts')
      .select('sentido, modalidade, terminal_id, source')
      .eq('voyage_id', input.voyageId)
      .eq('port', normalizedPol),
    supabase
      .from('voyage_escala_terminal_state')
      .select('terminal_id, terminal_atb, terminal_atd, terminal_rtw')
      .eq('voyage_id', input.voyageId)
      .eq('port', normalizedPol),
  ])

  if (frontsResult.error) throw frontsResult.error
  if (terminalsResult.error) throw terminalsResult.error

  const currentFronts = (frontsResult.data ?? []) as EscalaOperationFront[]
  const currentExportFronts = currentFronts.filter(
    (front) => front.sentido === 'exportacao' && (front.modalidade === 'granito' || front.modalidade === 'vazio'),
  )
  const currentExportByKind = new Map(currentExportFronts.map((front) => [front.modalidade, front]))
  const hasExplicitExportKinds = input.hasGranite || input.hasEmpty
  const exportFronts = input.temExportacao && !hasExplicitExportKinds
    ? currentExportFronts
    : [
        input.temExportacao && input.hasGranite
          ? currentExportByKind.get('granito') ?? { sentido: 'exportacao', modalidade: 'granito', terminal_id: null, source: 'export_declaration' }
          : null,
        input.temExportacao && input.hasEmpty
          ? currentExportByKind.get('vazio') ?? { sentido: 'exportacao', modalidade: 'vazio', terminal_id: null, source: 'export_declaration' }
          : null,
      ].filter((front): front is EscalaOperationFront => front !== null)
  const fronts = [
    ...currentFronts.filter((front) => front.sentido !== 'exportacao'),
    ...exportFronts,
  ]

  const exportExpectation = {
    tem_exportacao: input.temExportacao,
    granito: input.hasGranite,
    vazios: input.hasEmpty,
    has_empty: input.hasEmpty,
    containers_qty: input.containersQty,
    movements_qty: input.movementsQty,
    discharge_ports: normalizeDischargePorts(input.dischargePorts),
    ce_status: input.ceStatus,
    linked: input.linked,
    // A RPC terminalizada também precisa reutilizar a linha legada que o
    // editor abriu; sem esse identificador, um POL histórico não canônico
    // gera uma segunda linha ao fazer upsert pelo POL normalizado.
    existing_id: input.existingId ?? null,
  } satisfies Json

  const { data, error } = await supabase.rpc('save_voyage_escala_terminal_state', {
    p_voyage_id: input.voyageId,
    p_port: normalizedPol,
    p_expected_revision: input.expectedRevision,
    p_fronts: fronts,
    p_terminals: terminalsResult.data ?? [],
    p_export_expectation: exportExpectation,
    p_justification: input.justification ?? '',
  })

  if (error) throw error
  const result = parseVoyageExportScheduleSaveResult(data)
  if (result.blocked || result.closed_blockers.length > 0) {
    throw new VoyageExportScheduleBlockedError(result)
  }
  return result
}

function parseVoyageExportScheduleSaveResult(value: Json | null): VoyageExportScheduleSaveResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Resposta inválida ao salvar a declaração de exportação.')
  }
  const record = value as Record<string, Json | undefined>
  const closedBlockers: ClosedBlocker[] = Array.isArray(record.closed_blockers)
    ? record.closed_blockers.flatMap((blocker) => {
        if (!blocker || typeof blocker !== 'object' || Array.isArray(blocker)) return []
        const object = blocker as Record<string, Json | undefined>
        return [{
          terminal_code: typeof object.terminal_code === 'string' ? object.terminal_code : undefined,
          report_id: typeof object.report_id === 'string' ? object.report_id : undefined,
          reason: typeof object.reason === 'string' ? object.reason : undefined,
        }]
      })
    : []
  return {
    revision: typeof record.revision === 'number' ? record.revision : 0,
    fronts: Array.isArray(record.fronts) ? record.fronts as unknown as EscalaOperationFront[] : [],
    terminals: Array.isArray(record.terminals) ? record.terminals as unknown as EscalaTerminalState[] : [],
    closed_blockers: closedBlockers,
    blocked: record.blocked === true,
  }
}

function buildExportSchedulePortKey(schedule: Pick<VoyageExportSchedule, 'id' | 'pol'>) {
  return normalizeExportSchedulePol(schedule.pol) ?? `__missing_pol__::${schedule.id}`
}

function normalizeExportSchedulePol(value: string | null | undefined) {
  const normalized = normalizePortCode(value)
  if (normalized) return normalized
  const trimmed = String(value ?? '').trim().toUpperCase()
  return trimmed || null
}

/**
 * Portos de descarga da carga embarcada na escala: codigos em caixa alta, sem
 * duplicatas e sem vazios. Estrangeiros sao validos — o destino da exportacao
 * quase sempre esta fora do Brasil.
 */
export function normalizeDischargePorts(values: Array<string | null | undefined> | null | undefined): string[] {
  const seen = new Set<string>()
  for (const value of values ?? []) {
    const port = normalizePortCode(value)
    if (port) seen.add(port)
  }
  return Array.from(seen).sort((left, right) => left.localeCompare(right, 'pt-BR'))
}
