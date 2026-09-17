import type { QueryClient } from '@tanstack/react-query'
import type { Json } from '../types/database'
import { fetchExportSchedulesByVoyageIds, type VoyageExportSchedule } from './voyageExportSchedules'
import { listDepots } from './depots'
import { normalizePortCode, portCodeVariants } from './portCode'
import { queryKeys } from './queryKeys'
import { listVoyageEscalaSchedulesByVoyageIds } from './voyageRouteSchedules'
import { supabase } from './supabase'

export type OperationFrontKind =
  | 'carga_cheia'
  | 'carga_solta'
  | 'vazio'
  | 'veiculo'
  | 'granito'

export type OperationFrontDirection = 'importacao' | 'exportacao'

export type OperationFront = {
  id?: string | null
  sentido: OperationFrontDirection
  modalidade: OperationFrontKind
  terminalId: string | null
  source: 'operational_data' | 'export_declaration'
  hasData: boolean
  section: 'carga_descarregada' | 'carga_carregada' | 'veiculos' | 'vazios_descarregados' | 'vazios_embarcados' | null
}

export type TerminalDateState = {
  terminalId: string | null
  terminalCode?: string | null
  etb?: string | null
  atb: string | null
  etd?: string | null
  atd: string | null
  restow: number | null
  reportId?: string | null
}

export type TerminalOption = {
  id: string
  code: string
  name: string | null
  active: boolean
  portId: number | null
  historical: boolean
}

export type AgencyReportByTerminal = {
  reportId: string
  voyageId: number
  port: string
  terminalId: string | null
  terminalCode?: string | null
  terminalAtb?: string | null
  terminal: string | null
  status: string
  sections: Array<{
    section: string
    state: 'operated' | 'nothing_operated'
    fronts: OperationFrontKind[]
    frontKeys: string[]
  }>
}

export type TerminalScaleState = {
  voyageId: number
  port: string
  portId: number | null
  revision: number
  fronts: OperationFront[]
  tbcFronts: OperationFront[]
  terminals: TerminalDateState[]
  activeTerminals: TerminalOption[]
  historicalTerminals: TerminalOption[]
  agencyReports: AgencyReportByTerminal[]
}

export type SaveEscalaTerminalStatePayload = {
  voyageId: number
  port: string
  expectedRevision: number
  fronts: Array<{
    sentido: OperationFrontDirection
    modalidade: OperationFrontKind
    terminalId: string | null
    source?: OperationFront['source']
  }>
  terminals: Array<{
    terminalId: string | null
    etb?: string | null
    atb: string | null
    etd?: string | null
    atd: string | null
    restow: number | null
  }>
  exportExpectation: Record<string, unknown>
  justification?: string | null
  queryClient?: Pick<QueryClient, 'invalidateQueries'>
}

export type ClosedAdrBlocker = {
  reportId: string | null
  terminalId: string | null
  terminalCode: string | null
  reason: string | null
}

export type SaveEscalaTerminalStateResult = {
  revision: number
  fronts: OperationFront[]
  terminals: TerminalDateState[]
  closedBlockers: ClosedAdrBlocker[]
  blocked: boolean
}

export class EscalaTerminalBlockedError extends Error {
  readonly code = 'ADR_CLOSED_BLOCKED'
  readonly blockers: ClosedAdrBlocker[]

  constructor(blockers: ClosedAdrBlocker[]) {
    const labels = blockers.map((blocker) => blocker.terminalCode ?? blocker.reportId ?? 'terminal sem código')
    super(`A alteração está bloqueada por ADR fechado: ${labels.join(', ')}. Reabra o ADR antes de continuar.`)
    this.name = 'EscalaTerminalBlockedError'
    this.blockers = blockers
  }
}

type JsonRecord = Record<string, unknown>
type QueryResult = { data: unknown; error: unknown | null }
type SupabaseTable = {
  select: (columns?: string) => SupabaseTable
  eq: (column: string, value: unknown) => SupabaseTable
  in: (column: string, values: unknown[]) => SupabaseTable
  order: (column: string, options?: { ascending?: boolean }) => SupabaseTable
  range: (from: number, to: number) => SupabaseTable
  maybeSingle: () => Promise<QueryResult>
  then: Promise<QueryResult>['then']
}

function table(name: string): SupabaseTable {
  return (supabase.from as unknown as (tableName: string) => SupabaseTable)(name)
}

const SUPABASE_PAGE_SIZE = 1000

async function fetchAllRows<T>(
  queryFactory: (from: number, to: number) => PromiseLike<QueryResult>,
): Promise<{ data: T[]; error: unknown | null }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const result = await queryFactory(from, from + SUPABASE_PAGE_SIZE - 1)
    if (result.error) return { data: [], error: result.error }
    const page = Array.isArray(result.data) ? result.data as T[] : []
    rows.push(...page)
    if (page.length < SUPABASE_PAGE_SIZE) return { data: rows, error: null }
    from += SUPABASE_PAGE_SIZE
  }
}

/**
 * Frente de Operação de importação a que um B/L pertence, derivada do seu
 * `cargo_mode`. É a regra que liga a carga do cliente ao terminal atribuído —
 * logo, ao NOB daquela Atracação. Dono único no lado TypeScript; o espelho SQL
 * é `public.bl_operation_front_modalidade`, e
 * `escalaOperationFrontKind.test.ts` prende os dois à mesma tabela de casos.
 */
export function operationFrontKindForCargoMode(
  cargoMode: string | null | undefined,
): Exclude<OperationFrontKind, 'granito'> {
  const normalized = (cargoMode ?? '').trim().toLowerCase()
  if (normalized === 'carga_solta') return 'carga_solta'
  if (normalized === 'veiculo' || normalized === 'veiculos') return 'veiculo'
  if (normalized === 'misto') {
    // A assinatura legada aceita apenas uma frente; o chamador correto deve
    // usar operationFrontKindsForCargoMode para cobrir as duas frentes.
    return 'carga_cheia'
  }
  // Compatibilidade para chamadores antigos que aceitam uma única frente.
  return 'carga_cheia'
}

/**
 * Retorna todas as frentes de importação cobertas pelo B/L.
 * Um B/L misto ocupa simultaneamente as frentes de contêiner e carga solta;
 * reduzi-lo a uma delas faz o NOB manual depender da primeira frente encontrada.
 */
export function operationFrontKindsForCargoMode(
  cargoMode: string | null | undefined,
): Array<Exclude<OperationFrontKind, 'granito'>> {
  const normalized = (cargoMode ?? '').trim().toLowerCase()
  if (normalized === 'misto') return ['carga_cheia', 'carga_solta']
  return [operationFrontKindForCargoMode(cargoMode)]
}

const IMPORT_SECTION_BY_KIND: Record<Exclude<OperationFrontKind, 'granito'>, OperationFront['section']> = {
  carga_cheia: 'carga_descarregada',
  carga_solta: 'carga_descarregada',
  vazio: 'vazios_descarregados',
  veiculo: 'veiculos',
}

const EXPORT_SECTION_BY_KIND: Record<'granito' | 'vazio', OperationFront['section']> = {
  granito: 'carga_carregada',
  vazio: 'vazios_embarcados',
}

function normalizePort(port: string) {
  return normalizePortCode(port) ?? port.trim().toUpperCase()
}

function frontKey(front: Pick<OperationFront, 'sentido' | 'modalidade'>) {
  return `${front.sentido}:${front.modalidade}`
}

function makeFront(
  sentido: OperationFrontDirection,
  modalidade: OperationFrontKind,
  terminalId: string | null,
  source: OperationFront['source'],
  hasData: boolean,
  id?: string | null,
): OperationFront {
  return {
    id: id ?? null,
    sentido,
    modalidade,
    terminalId,
    source,
    hasData,
    section: sentido === 'importacao' ? IMPORT_SECTION_BY_KIND[modalidade as Exclude<OperationFrontKind, 'granito'>] : EXPORT_SECTION_BY_KIND[modalidade as 'granito' | 'vazio'],
  }
}

export type DeriveOperationFrontInput = {
  existing?: Array<Pick<OperationFront, 'id' | 'sentido' | 'modalidade' | 'terminalId' | 'source'>>
  importKinds?: Iterable<Exclude<OperationFrontKind, 'granito'>>
  exportSchedule?: Pick<VoyageExportSchedule, 'temExportacao' | 'hasGranite' | 'hasEmpty'> | null
}

/** Pure projection used by the reader and by tests. Existing persisted fronts win over source absence. */
export function deriveOperationFronts(input: DeriveOperationFrontInput): OperationFront[] {
  const fronts = new Map<string, OperationFront>()
  for (const existing of input.existing ?? []) {
    // A persisted front is already a declaration that the operation exists.
    // Keeping hasData=true here is important for export_declaration fronts:
    // otherwise a terminalized ADR is projected as "nothing operated" after
    // the export schedule has been saved.
    fronts.set(frontKey(existing), makeFront(existing.sentido, existing.modalidade, existing.terminalId, existing.source, true, existing.id))
  }
  for (const kind of new Set(input.importKinds ?? [])) {
    const key = frontKey({ sentido: 'importacao', modalidade: kind })
    if (!fronts.has(key)) fronts.set(key, makeFront('importacao', kind, null, 'operational_data', true))
  }
  const exportSchedule = input.exportSchedule
  if (exportSchedule?.temExportacao) {
    if (exportSchedule.hasGranite && !fronts.has('exportacao:granito')) fronts.set('exportacao:granito', makeFront('exportacao', 'granito', null, 'export_declaration', true))
    if (exportSchedule.hasEmpty && !fronts.has('exportacao:vazio')) fronts.set('exportacao:vazio', makeFront('exportacao', 'vazio', null, 'export_declaration', true))
  }
  return [...fronts.values()].sort((left, right) => left.sentido.localeCompare(right.sentido) || left.modalidade.localeCompare(right.modalidade))
}

function parseFront(row: JsonRecord): OperationFront | null {
  const sentido = row.sentido === 'importacao' || row.sentido === 'exportacao' ? row.sentido : null
  const modalidade = typeof row.modalidade === 'string' ? row.modalidade as OperationFrontKind : null
  if (!sentido || !modalidade) return null
  const source = row.source === 'export_declaration' ? 'export_declaration' : 'operational_data'
  return makeFront(sentido, modalidade, typeof row.terminal_id === 'string' ? row.terminal_id : null, source, true, typeof row.id === 'string' ? row.id : null)
}

function parseTerminal(row: JsonRecord): TerminalDateState | null {
  return {
    terminalId: typeof row.terminal_id === 'string' ? row.terminal_id : null,
    terminalCode: typeof row.code === 'string' ? row.code : null,
    etb: typeof row.terminal_etb === 'string' ? row.terminal_etb : null,
    atb: typeof row.terminal_atb === 'string' ? row.terminal_atb : null,
    etd: typeof row.terminal_etd === 'string' ? row.terminal_etd : null,
    atd: typeof row.terminal_atd === 'string' ? row.terminal_atd : null,
    restow: typeof row.terminal_rtw === 'number' ? row.terminal_rtw : row.terminal_rtw == null ? null : Number(row.terminal_rtw),
    reportId: typeof row.report_id === 'string' ? row.report_id : null,
  }
}

function parseBlockers(value: unknown): ClosedAdrBlocker[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as JsonRecord
    return [{
      reportId: typeof row.report_id === 'string' ? row.report_id : null,
      terminalId: typeof row.terminal_id === 'string' ? row.terminal_id : null,
      terminalCode: typeof row.terminal_code === 'string' ? row.terminal_code : null,
      reason: typeof row.reason === 'string' ? row.reason : null,
    }]
  })
}

function parseSaveResult(value: unknown): SaveEscalaTerminalStateResult {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
  const fronts = Array.isArray(record.fronts) ? record.fronts.flatMap((row) => row && typeof row === 'object' ? [parseFront(row as JsonRecord)].filter(Boolean) as OperationFront[] : []) : []
  const terminals = Array.isArray(record.terminals) ? record.terminals.flatMap((row) => row && typeof row === 'object' ? [parseTerminal(row as JsonRecord)].filter(Boolean) as TerminalDateState[] : []) : []
  const closedBlockers = parseBlockers(record.closed_blockers)
  return {
    revision: typeof record.revision === 'number' ? record.revision : 0,
    fronts,
    terminals,
    closedBlockers,
    blocked: record.blocked === true || closedBlockers.length > 0,
  }
}

async function readAgencyReports(voyageId: number, port: string): Promise<JsonRecord[]> {
  const result = await table('agency_departure_reports')
    .select('id, voyage_id, port, terminal, terminal_id, status')
    .eq('voyage_id', voyageId)
    .eq('port', port)
  if (result.error) throw result.error
  return (result.data ?? []) as JsonRecord[]
}

function reportSections(fronts: OperationFront[], terminalId: string | null): AgencyReportByTerminal['sections'] {
  const bySection = new Map<string, OperationFrontKind[]>()
  const assigned = fronts.filter((item) => item.terminalId === terminalId)
  for (const front of assigned) {
    if (!front.section) continue
    const kinds = bySection.get(front.section) ?? []
    if (!kinds.includes(front.modalidade)) kinds.push(front.modalidade)
    bySection.set(front.section, kinds)
  }
  const sections = ['datas', 'carga_descarregada', 'carga_carregada', 'veiculos', 'vazios_embarcados', 'vazios_descarregados']
  return sections.map((section) => ({
    section,
    state: assigned.some((front) => front.section === section && front.hasData) ? 'operated' : 'nothing_operated',
    fronts: (bySection.get(section) ?? []).sort((left, right) => left.localeCompare(right, 'pt-BR')),
    frontKeys: assigned
      .filter((front) => front.section === section)
      .map((front) => frontKey(front))
      .sort((left, right) => left.localeCompare(right, 'pt-BR')),
  }))
}

export type AgencyReportProjectionInput = Pick<AgencyReportByTerminal, 'reportId' | 'voyageId' | 'port' | 'terminalId' | 'terminal' | 'status' | 'terminalCode' | 'terminalAtb'>

export function groupAgencyReportsByTerminal(reports: AgencyReportProjectionInput[], fronts: OperationFront[]): AgencyReportByTerminal[] {
  return reports.map((report) => ({
    ...report,
    sections: reportSections(fronts, report.terminalId),
  })).sort(compareAgencyReports)
}

function compareNullableAtb(left: string | null | undefined, right: string | null | undefined) {
  if (left === right) return 0
  if (left == null) return 1
  if (right == null) return -1
  return left.localeCompare(right)
}

function compareAgencyReports(left: AgencyReportByTerminal, right: AgencyReportByTerminal) {
  return compareNullableAtb(left.terminalAtb, right.terminalAtb)
    || (left.terminalCode ?? '').localeCompare(right.terminalCode ?? '', 'pt-BR')
    || (left.terminalId ?? '').localeCompare(right.terminalId ?? '')
    || left.reportId.localeCompare(right.reportId)
}

function compareTerminalStates(left: TerminalDateState, right: TerminalDateState) {
  return compareNullableAtb(left.atb, right.atb)
    || (left.terminalCode ?? '').localeCompare(right.terminalCode ?? '', 'pt-BR')
    || (left.terminalId ?? '').localeCompare(right.terminalId ?? '')
}

function compareTerminalOptions(left: TerminalOption, right: TerminalOption) {
  return (left.code ?? '').localeCompare(right.code ?? '', 'pt-BR') || left.id.localeCompare(right.id)
}

export async function fetchEscalaTerminalState(voyageId: number, port: string): Promise<TerminalScaleState> {
  const normalizedPort = normalizePort(port)
  const [frontsResult, terminalsResult, revisionResult, portResult, depots, exportsByVoyage, schedules, reports] = await Promise.all([
    table('voyage_escala_operation_fronts').select('id, sentido, modalidade, terminal_id, source').eq('voyage_id', voyageId).eq('port', normalizedPort),
    table('voyage_escala_terminal_state').select('terminal_id, terminal_etb, terminal_atb, terminal_etd, terminal_atd, terminal_rtw').eq('voyage_id', voyageId).eq('port', normalizedPort),
    table('voyage_escala_revision_state').select('revision, port_id').eq('voyage_id', voyageId).eq('port', normalizedPort).maybeSingle(),
    table('ports').select('id, locode'),
    listDepots(),
    fetchExportSchedulesByVoyageIds([voyageId]),
    listVoyageEscalaSchedulesByVoyageIds([voyageId]),
    readAgencyReports(voyageId, normalizedPort),
  ])
  for (const result of [frontsResult, terminalsResult, revisionResult, portResult]) if (result.error) throw result.error

  const existing = (frontsResult.data ?? []) as JsonRecord[]
  const existingFronts = existing.flatMap((row) => {
    const front = parseFront(row)
    return front ? [front] : []
  })
  const exportSchedule = exportsByVoyage.get(voyageId)?.get(normalizedPort) ?? null
  const importKinds = new Set<Exclude<OperationFrontKind, 'granito'>>()
  const operationalScale = schedules.get(voyageId)?.find((schedule) => normalizePort(schedule.port) === normalizedPort)
  if (operationalScale?.temImportacao) importKinds.add('carga_cheia')
  const bls = await fetchAllRows<JsonRecord>((from, to) =>
    table('bls').select('id, cargo_mode, pod').eq('voyage_id', voyageId).in('pod', portCodeVariants(normalizedPort)).order('id', { ascending: true }).range(from, to),
  )
  if (bls.error) throw bls.error
  for (const row of bls.data) {
    for (const kind of operationFrontKindsForCargoMode(typeof row.cargo_mode === 'string' ? row.cargo_mode : null)) {
      importKinds.add(kind)
    }
  }
  const emptyImports = await fetchAllRows<JsonRecord>((from, to) =>
    table('vazios_importacao_containers')
      .select('pod, manifest:vazios_importacao_manifests!inner(voyage_id)')
      .eq('manifest.voyage_id', voyageId)
      .in('pod', portCodeVariants(normalizedPort))
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (emptyImports.error) throw emptyImports.error
  if (emptyImports.data.length) importKinds.add('vazio')

  const fronts = deriveOperationFronts({ existing: existingFronts, importKinds, exportSchedule })
  const depotRows = depots as unknown as Array<{ id: string; code: string; name: string | null; active: boolean; tipo: string; port_id?: number | null }>
  const stateRows = (terminalsResult.data ?? []) as JsonRecord[]
  const historicalIds = new Set(stateRows.flatMap((row) => typeof row.terminal_id === 'string' ? [row.terminal_id] : []))
  const revisionRow = revisionResult.data && typeof revisionResult.data === 'object' ? revisionResult.data as JsonRecord : {}
  const portRows = Array.isArray(portResult.data) ? portResult.data as JsonRecord[] : []
  const scalePortId = typeof revisionRow.port_id === 'number'
    ? revisionRow.port_id
    : portRows.find((row) => normalizePort(String(row.locode ?? '')) === normalizedPort)?.id
  const options = depotRows.filter((depot) => depot.tipo === 'terminal_portuario' && scalePortId != null && Number(depot.port_id) === Number(scalePortId))
  const toOption = (depot: (typeof depotRows)[number], historical: boolean): TerminalOption => ({ id: depot.id, code: depot.code, name: depot.name, active: depot.active, portId: depot.port_id ?? null, historical })
  const activeTerminals = options.filter((depot) => depot.active).map((depot) => toOption(depot, false)).sort(compareTerminalOptions)
  const historicalTerminals = [...historicalIds].map((id) => {
    const depot = depotRows.find((row) => row.id === id)
    return depot ? toOption(depot, true) : { id, code: id, name: null, active: false, portId: null, historical: true }
  }).sort(compareTerminalOptions)
  const depotById = new Map(depotRows.map((depot) => [depot.id, depot]))
  const terminalStates = stateRows.flatMap((row) => {
    const state = parseTerminal({ ...row, code: depotById.get(String(row.terminal_id))?.code })
    return state ? [state] : []
  }).sort(compareTerminalStates)
  const reportInputs = reports.map((report) => ({
    reportId: String(report.id),
    voyageId,
    port: String(report.port ?? normalizedPort),
    terminalId: typeof report.terminal_id === 'string' ? report.terminal_id : null,
    terminalCode: typeof report.terminal_id === 'string' ? depotById.get(report.terminal_id)?.code ?? null : null,
    terminalAtb: typeof report.terminal_id === 'string' ? terminalStates.find((state) => state.terminalId === report.terminal_id)?.atb ?? null : null,
    terminal: typeof report.terminal === 'string' ? report.terminal : null,
    status: typeof report.status === 'string' ? report.status : 'open',
  }))
  const agencyReports = groupAgencyReportsByTerminal(reportInputs, fronts)
  return {
    voyageId,
    port: normalizedPort,
    portId: typeof revisionRow.port_id === 'number' ? revisionRow.port_id : null,
    revision: typeof revisionRow.revision === 'number' ? revisionRow.revision : 0,
    fronts,
    tbcFronts: fronts.filter((front) => front.terminalId === null),
    terminals: terminalStates,
    activeTerminals,
    historicalTerminals,
    agencyReports,
  }
}

/** Captura a revisão quando o editor legado não carregou o state terminalizado. */
export async function fetchEscalaTerminalRevision(voyageId: number, port: string): Promise<number> {
  const result = await table('voyage_escala_revision_state')
    .select('revision')
    .eq('voyage_id', voyageId)
    .eq('port', normalizePort(port))
    .maybeSingle()
  if (result.error) throw result.error
  const row = result.data && typeof result.data === 'object' ? result.data as JsonRecord : {}
  return typeof row.revision === 'number' && row.revision >= 0 ? row.revision : 0
}

export function invalidateEscalaTerminalQueries(queryClient: Pick<QueryClient, 'invalidateQueries'>, voyageId: number, port: string) {
  const normalizedPort = normalizePort(port)
  void queryClient.invalidateQueries({ queryKey: queryKeys.voyages.escalaSchedules() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.voyages.timeline(voyageId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.agencyReports.byScale(voyageId, normalizedPort) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.agencyReports.ownByScale(voyageId, normalizedPort) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.agencyReports.terminalState(voyageId, normalizedPort) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.agencyReports.all() })
  void queryClient.invalidateQueries({ queryKey: ['agency-report-own'] })
  void queryClient.invalidateQueries({ queryKey: ['agency-report-closed-ports', voyageId] })
  void queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] })
  void queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] })
  void queryClient.invalidateQueries({ queryKey: ['painel'] })
  void queryClient.invalidateQueries({ queryKey: ['tv'] })
}

export async function saveEscalaTerminalState(payload: SaveEscalaTerminalStatePayload): Promise<SaveEscalaTerminalStateResult> {
  const normalizedPort = normalizePort(payload.port)
  if (!normalizedPort) throw new Error('O porto da escala é obrigatório.')
  if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) throw new Error('A revisão esperada da escala é inválida.')
  if (!payload.exportExpectation || typeof payload.exportExpectation !== 'object' || Array.isArray(payload.exportExpectation)) {
    throw new Error('A expectativa de exportação da escala é obrigatória.')
  }
  const { data, error } = await supabase.rpc('save_voyage_escala_terminal_state_v2', {
    p_voyage_id: payload.voyageId,
    p_port: normalizedPort,
    p_expected_revision: payload.expectedRevision,
    p_fronts: payload.fronts.map((front) => ({ sentido: front.sentido, modalidade: front.modalidade, terminal_id: front.terminalId, source: front.source ?? (front.sentido === 'exportacao' ? 'export_declaration' : 'operational_data') })),
    p_terminals: payload.terminals.map((terminal) => ({ terminal_id: terminal.terminalId, terminal_etb: terminal.etb, terminal_atb: terminal.atb, terminal_etd: terminal.etd, terminal_atd: terminal.atd, terminal_rtw: terminal.restow })),
    p_export_expectation: payload.exportExpectation as Json,
    p_justification: payload.justification ?? '',
  })
  if (error) throw error
  const result = parseSaveResult(data)
  if (result.blocked) throw new EscalaTerminalBlockedError(result.closedBlockers)
  if (payload.queryClient) invalidateEscalaTerminalQueries(payload.queryClient, payload.voyageId, normalizedPort)
  return result
}

export function deriveAgencyReportSections(fronts: OperationFront[], terminalId: string | null) {
  return reportSections(fronts, terminalId)
}
