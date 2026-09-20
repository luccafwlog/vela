import type {
  BaplieContainer,
  Depot,
  GraniteBl,
  GraniteManifest,
  UserProfileRole,
  VaziosBooking,
  VaziosExportOperation,
  VaziosImportacaoContainer,
  Vehicle,
  Json,
} from '../types/database'
import type { AgencyDepartureReport, AgencyReportDepartmentKey, AgencyReportDepartmentSignoff, AgencyReportOccurrence, AgencyReportSignoff } from '../types/database'
import { supabase } from './supabase'
import { extractErrorText } from '../lib/errors'
import { breakbulkWeightTon } from '../lib/breakbulkWeight'
import { computeStorageTotals, type VaziosExportServiceLineWithObservation } from './vaziosExportOperations'
import { listDepots } from './depots'
import { quantidadeEfetiva, totalEmbarque, totalLinha } from './vaziosCusto'
import { buildVoyagePodEntityId, listVoyageEscalaSchedulesByVoyageIds, listVoyagePodSchedules } from './voyageRouteSchedules'
import { listVoyageRoutePorts } from './operationalLists'
import { normalizePortCode, portCodeVariants } from './portCode'
import type { AgencyReportByTerminal, OperationFront, OperationFrontKind } from './escalaTerminalAllocation'

// Seis seções assináveis (ADR 0036). 'operacao_patio' foi absorvida por
// 'vazios_embarcados' — Embarque de Vazios é UM agregado por escala
// (CONTEXT.md), e suas duas partes (unidades embarcadas e linhas de serviço)
// são subseções de conteúdo, não resoluções independentes.
export type AgencyReportSection =
  | 'datas'
  | 'carga_descarregada'
  | 'carga_carregada'
  | 'veiculos'
  | 'vazios_embarcados'
  | 'vazios_descarregados'

export const AGENCY_REPORT_SECTIONS: Record<AgencyReportSection, UserProfileRole> = {
  datas: 'operacoes',
  carga_descarregada: 'documentacao',
  carga_carregada: 'equipamentos',
  veiculos: 'equipamentos',
  vazios_embarcados: 'equipamentos',
  vazios_descarregados: 'documentacao',
}

// Labels pt-BR das seções e departamentos do ADR — espelham as funções SQL
// agency_report_section_label/agency_report_department_label (migration 258).
export const AGENCY_REPORT_SECTION_LABELS: Record<AgencyReportSection, string> = {
  datas: 'Escala',
  carga_descarregada: 'Carga descarregada',
  // ADR 0036: "A seção `carga_carregada` chama-se 'Carga carregada', com o
  // granito como seu conteúdo — não como seu nome." Renomear para "Granito"
  // foi listado como alternativa rejeitada ("vira mentira na primeira carga
  // de exportação que não for granito"). Decisão confirmada com o usuário em
  // 2026-09-19. A função SQL agency_report_section_label foi realinhada pela
  // migration 065 (supersede o CASE de 'Granito' que a migration 258 havia
  // gravado); os dois lados ficam sincronizados por
  // agencyReportGraniteOwnershipMigration.test.ts.
  carga_carregada: 'Carga carregada',
  veiculos: 'Veículos',
  vazios_embarcados: 'Embarque de vazios',
  vazios_descarregados: 'Vazios descarregados',
}

// Rótulo de uma chave de seção que pode vir de registro histórico (snapshot
// fechado, audit_log) — 'operacao_patio' e 'ocorrencias' não são mais
// assináveis, mas continuam precisando ser legíveis. Espelha o ELSE da função
// SQL agency_report_section_label.
const AGENCY_REPORT_RETIRED_SECTION_LABELS: Record<string, string> = {
  operacao_patio: 'Operação de pátio',
  ocorrencias: 'Ocorrências',
}

export function agencyReportSectionLabel(section: string): string {
  return (
    AGENCY_REPORT_SECTION_LABELS[section as AgencyReportSection] ??
    AGENCY_REPORT_RETIRED_SECTION_LABELS[section] ??
    section
  )
}

// Ordem do ciclo da escala (ADR 0036): Escala → Importação → Exportação. O
// pátio deixou de ser faixa própria — seus números vivem dentro de Embarque
// de vazios, que é exportação. Usada pelo layout em faixas.
export const AGENCY_REPORT_SECTION_ORDER: AgencyReportSection[] = [
  'datas',
  'carga_descarregada',
  'vazios_descarregados',
  'veiculos',
  'carga_carregada',
  'vazios_embarcados',
]

export type SignoffState = AgencyReportSignoff['state']

export const signoffLabels: Record<SignoffState, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  nothing_to_declare: 'Nada a declarar',
}

export const AGENCY_REPORT_DEPARTMENT_LABELS: Record<string, string> = {
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
}

export type AgencyReportOwnData = AgencyDepartureReport & {
  signoffs: AgencyReportSignoff[]
  departmentSignoffs: AgencyReportDepartmentSignoff[]
  occurrences: AgencyReportOccurrence[]
  closed_by_name?: string | null
  actor_names?: Record<string, string>
}

export async function getAgencyReportOwnData(voyageId: number, port: string) {
  const { data, error } = await supabase
    .from('agency_departure_reports')
    .select('*, signoffs:agency_departure_report_signoffs(*), departmentSignoffs:agency_departure_report_department_signoffs(*), occurrences:agency_departure_report_occurrences(*)')
    .eq('voyage_id', voyageId)
    .eq('port', port)
    .is('terminal_id', null)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const report = data as unknown as AgencyReportOwnData

  // Nomes de todos os atores (sign-offs, ocorrências, fechamento) em uma
  // chamada; absorve get_agency_report_closer_name (migration 217 → 220).
  const actorNames = await resolveActorNames('get_agency_report_actor_names', {
    p_voyage_id: voyageId,
    p_port: port,
  })

  return {
    ...report,
    actor_names: actorNames,
    closed_by_name: report.closed_by ? actorNames[report.closed_by] ?? null : null,
  }
}

type TerminalizedReportRow = Omit<AgencyReportOwnData, 'actor_names' | 'closed_by_name'> & {
  actor_names: Record<string, string>
  closed_by_name: string | null
  terminal_id?: string | null
  terminal_port_id?: number | null
}

const terminalizedReportSelect = '*, signoffs:agency_departure_report_signoffs(*), departmentSignoffs:agency_departure_report_department_signoffs(*), occurrences:agency_departure_report_occurrences(*)'

type AgencyReportQueryResult = { data: unknown; error: unknown | null }
type AgencyReportQuery = {
  select: (columns: string) => AgencyReportQuery
  eq: (column: string, value: unknown) => AgencyReportQuery
  is: (column: string, value: null) => AgencyReportQuery
  maybeSingle: () => Promise<AgencyReportQueryResult>
  then: Promise<AgencyReportQueryResult>['then']
}

function terminalizedReportsTable(): AgencyReportQuery {
  return (supabase.from as unknown as (table: string) => AgencyReportQuery)('agency_departure_reports')
}

type ActorNameRow = { user_id?: string; full_name?: string | null }

async function resolveActorNames(rpcName: string, args: Record<string, unknown>) {
  const actorNames: Record<string, string> = {}
  const { data: actorRows, error: actorError } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: ActorNameRow[] | null; error: { message?: string | null } | null }>)(rpcName, args)
  if (actorError) {
    // Uma migration antiga pode ainda não expor o resolver. O ADR continua
    // legível, apenas sem nomes resolvidos para os atores.
    console.error('[agencyDepartureReport] erro ao resolver nomes dos atores:', actorError.message)
  } else if (Array.isArray(actorRows)) {
    for (const row of actorRows) {
      if (row.user_id && row.full_name) actorNames[row.user_id] = row.full_name
    }
  }
  return actorNames
}

/** Leitura por identidade estável do ADR terminalizado. O caminho antigo acima permanece por (viagem, porto). */
export async function getAgencyReportOwnDataByReportId(reportId: string): Promise<TerminalizedReportRow | null> {
  const { data, error } = await terminalizedReportsTable()
    .select(terminalizedReportSelect)
    .eq('id', reportId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const report = data as TerminalizedReportRow
  const actorNames = await resolveActorNames('get_agency_report_actor_names_by_report_id', { p_report_id: reportId })
  return {
    ...report,
    signoffs: report.signoffs ?? [],
    departmentSignoffs: report.departmentSignoffs ?? [],
    occurrences: report.occurrences ?? [],
    actor_names: actorNames,
    closed_by_name: report.closed_by ? actorNames[report.closed_by] ?? null : null,
  }
}

/** Retorna o ADR terminalizado da escala, sem transformar terminal em chave textual. */
export async function getAgencyReportOwnDataByTerminal(voyageId: number, port: string, terminalId: string): Promise<TerminalizedReportRow | null> {
  const normalizedPort = normalizePortCode(port) ?? port.trim().toUpperCase()
  const { data, error } = await terminalizedReportsTable()
    .select(terminalizedReportSelect)
    .eq('voyage_id', voyageId)
    .eq('port', normalizedPort)
    .eq('terminal_id', terminalId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const report = data as TerminalizedReportRow
  const actorNames = await resolveActorNames('get_agency_report_actor_names_by_report_id', { p_report_id: report.id })
  return {
    ...report,
    signoffs: report.signoffs ?? [],
    departmentSignoffs: report.departmentSignoffs ?? [],
    occurrences: report.occurrences ?? [],
    actor_names: actorNames,
    closed_by_name: report.closed_by ? actorNames[report.closed_by] ?? null : null,
  }
}

/** Lista ADRs da escala; registros legados (terminal_id nulo) continuam incluídos. */
export async function listAgencyReportOwnDataByScale(voyageId: number, port: string): Promise<TerminalizedReportRow[]> {
  const normalizedPort = normalizePortCode(port) ?? port.trim().toUpperCase()
  const { data, error } = await terminalizedReportsTable()
    .select(terminalizedReportSelect)
    .eq('voyage_id', voyageId)
    .eq('port', normalizedPort)
  if (error) throw error
  return [...(data ?? []) as TerminalizedReportRow[]].sort((left, right) =>
    (left.terminal ?? '').localeCompare(right.terminal ?? '', 'pt-BR') || left.id.localeCompare(right.id),
  )
}

/**
 * Projeta as seções de um ADR terminalizado. A ausência de dados não remove a
 * frente: ela vira `nothing_operated` e continua sujeita a resolução/sign-off.
 */
export function deriveAgencyReportByTerminal(
  report: Pick<TerminalizedReportRow, 'id' | 'voyage_id' | 'port' | 'terminal_id' | 'terminal' | 'status'>,
  fronts: OperationFront[],
): AgencyReportByTerminal {
  const sections = ['datas', 'carga_descarregada', 'carga_carregada', 'veiculos', 'vazios_embarcados', 'vazios_descarregados'].map((section) => {
    const assigned = fronts.filter((front) => front.terminalId === (report.terminal_id ?? null) && front.section === section)
    return {
      section,
      state: assigned.some((front) => front.hasData) ? 'operated' as const : 'nothing_operated' as const,
      fronts: assigned.map((front) => front.modalidade as OperationFrontKind).sort((left, right) => left.localeCompare(right, 'pt-BR')),
      frontKeys: assigned.map((front) => `${front.sentido}:${front.modalidade}`).sort((left, right) => left.localeCompare(right, 'pt-BR')),
    }
  })
  return {
    reportId: report.id,
    voyageId: report.voyage_id,
    port: report.port,
    terminalId: report.terminal_id ?? null,
    terminal: report.terminal ?? null,
    status: report.status,
    sections,
  }
}

export async function setSignoff(input: {
  voyageId: number
  port: string
  section: AgencyReportSection
  state: AgencyReportSignoff['state']
  justification?: string
}) {
  const { error } = await supabase.rpc('set_agency_report_signoff', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_section: input.section,
    p_state: input.state,
    p_justification: input.justification,
  })
  if (error) throw error
}

export class TerminalizedAgencyReportRpcUnavailableError extends Error {
  readonly code = 'TERMINALIZED_ADR_RPC_UNAVAILABLE'
  readonly rpcName: string

  constructor(rpcName: string) {
    super(`A RPC ${rpcName} para ADR terminalizado não está disponível no projeto remoto. O caminho legado permanece inalterado.`)
    this.name = 'TerminalizedAgencyReportRpcUnavailableError'
    this.rpcName = rpcName
  }
}

type ReportIdRpcResult = { data: unknown; error: { code?: string; message?: string } | null }

function isMissingReportIdRpc(error: { code?: string; message?: string } | null) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return text.includes('42883')
    || text.includes('pgrst202')
    || /function .* does not exist/.test(text)
    || text.includes('could not find the function')
}

async function callReportIdAwareRpc(rpcName: string, args: Record<string, unknown>) {
  // `supabase.rpc` depende do receptor (le `this.rest`). Guardar a funcao numa
  // variavel a desliga do cliente e TODA escrita terminalizada do ADR estoura
  // "Cannot read properties of undefined (reading 'rest')" antes de sair na
  // rede — assinar seção, assinar departamento, observar, fechar e reabrir
  // ficavam silenciosamente inertes. Chamar pelo objeto preserva o receptor,
  // como ja faz resolveActorNames acima.
  const { error } = await (supabase.rpc as unknown as (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<ReportIdRpcResult>)(rpcName, args)
  if (!error) return
  if (isMissingReportIdRpc(error)) throw new TerminalizedAgencyReportRpcUnavailableError(rpcName)
  throw error
}

/** Mutação terminalizada: não cai no RPC legado quando a RPC nova não existe. */
export async function setSignoffByReportId(input: {
  reportId: string
  voyageId: number
  port: string
  section: AgencyReportSection
  state: AgencyReportSignoff['state']
  justification?: string
}) {
  await callReportIdAwareRpc('set_agency_report_signoff_by_report_id', {
    p_report_id: input.reportId,
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_section: input.section,
    p_state: input.state,
    p_justification: input.justification,
  })
}

export async function setSectionObservationByReportId(input: {
  reportId: string
  voyageId: number
  port: string
  section: AgencyReportSection
  observation: string
}) {
  await callReportIdAwareRpc('set_agency_report_section_observation_by_report_id', {
    p_report_id: input.reportId,
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_section: input.section,
    p_observation: input.observation,
  })
}

export async function setDepartmentSignoffByReportId(input: {
  reportId: string
  voyageId: number
  port: string
  department: AgencyReportDepartmentKey
  signed: boolean
  justification?: string
}) {
  await callReportIdAwareRpc('set_agency_report_department_signoff_by_report_id', {
    p_report_id: input.reportId,
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_department: input.department,
    p_signed: input.signed,
    p_justification: input.justification,
  })
}

// Observação por seção (ADR 0030): edição livre do dono da seção, sem
// justificativa nem histórico em audit_logs — não é um dado formal do ADR.
export async function setSectionObservation(input: {
  voyageId: number
  port: string
  section: AgencyReportSection
  observation: string
}) {
  const { error } = await supabase.rpc('set_agency_report_section_observation', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_section: input.section,
    p_observation: input.observation,
  })
  if (error) throw error
}

export async function setDepartmentSignoff(input: {
  voyageId: number
  port: string
  department: AgencyReportDepartmentKey
  signed: boolean
  justification?: string
}) {
  const { error } = await supabase.rpc('set_agency_report_department_signoff', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_department: input.department,
    p_signed: input.signed,
    p_justification: input.justification,
  })
  if (error) throw error
}

export type AgencyReportSignoffEvent = {
  id: number
  section: AgencyReportSection
  old_value: string | null
  new_value: string | null
  justification: string | null
  changed_by: string | null
  changed_at: string | null
}

// audit_logs é a trilha reutilizada para o histórico de sign-off (sem tabela
// nova); entity_id segue o padrão "{voyageId}::{PORT}::{section}" gravado
// pela migration 221.
export async function listSignoffEvents(voyageId: number, port: string) {
  const prefix = `${voyageId}::${port.toUpperCase()}::`
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, entity_id, old_value, new_value, justification, changed_by, changed_at')
    .eq('entity_type', 'agency_departure_report_signoff')
    .like('entity_id', `${prefix}%`)
    .order('changed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row): AgencyReportSignoffEvent => ({
    id: row.id,
    section: row.entity_id.slice(prefix.length) as AgencyReportSection,
    old_value: row.old_value,
    new_value: row.new_value,
    justification: row.justification,
    changed_by: row.changed_by,
    changed_at: row.changed_at,
  }))
}

/** Histórico de sign-off do ADR terminalizado; o legado continua por escala. */
export async function listSignoffEventsByReportId(reportId: string) {
  const prefix = `${reportId}::`
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, entity_id, old_value, new_value, justification, changed_by, changed_at')
    .eq('entity_type', 'agency_departure_report_signoff')
    .like('entity_id', `${prefix}%`)
    .order('changed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row): AgencyReportSignoffEvent => ({
    id: row.id,
    section: row.entity_id.slice(prefix.length) as AgencyReportSection,
    old_value: row.old_value,
    new_value: row.new_value,
    justification: row.justification,
    changed_by: row.changed_by,
    changed_at: row.changed_at,
  }))
}

export type AgencyReportDepartmentSignoffEvent = {
  id: number
  department: AgencyReportDepartmentKey
  old_value: string | null
  new_value: string | null
  justification: string | null
  changed_by: string | null
  changed_at: string | null
}

// Mesmo padrão de listSignoffEvents (audit_logs reaproveitado como trilha),
// para o sign-off departamental (ADR 0029/0039): entity_id
// "{voyageId}::{PORT}::{department}", gravado pela migration 223. Cada linha
// com new_value='false' é uma reabertura com justificativa (Linha do Tempo do
// ADR); new_value='true' é a (re)assinatura, sem justificativa.
export async function listDepartmentSignoffEvents(voyageId: number, port: string) {
  const prefix = `${voyageId}::${port.toUpperCase()}::`
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, entity_id, old_value, new_value, justification, changed_by, changed_at')
    .eq('entity_type', 'agency_departure_report_department_signoff')
    .like('entity_id', `${prefix}%`)
    .order('changed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row): AgencyReportDepartmentSignoffEvent => ({
    id: row.id,
    department: row.entity_id.slice(prefix.length) as AgencyReportDepartmentKey,
    old_value: row.old_value,
    new_value: row.new_value,
    justification: row.justification,
    changed_by: row.changed_by,
    changed_at: row.changed_at,
  }))
}

export async function listDepartmentSignoffEventsByReportId(reportId: string) {
  const prefix = `${reportId}::`
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, entity_id, old_value, new_value, justification, changed_by, changed_at')
    .eq('entity_type', 'agency_departure_report_department_signoff')
    .like('entity_id', `${prefix}%`)
    .order('changed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row): AgencyReportDepartmentSignoffEvent => ({
    id: row.id,
    department: row.entity_id.slice(prefix.length) as AgencyReportDepartmentKey,
    old_value: row.old_value,
    new_value: row.new_value,
    justification: row.justification,
    changed_by: row.changed_by,
    changed_at: row.changed_at,
  }))
}

// Regra única de "o que conta como reabertura" (new_value='false', ver
// comentário acima) — usada tanto pela Linha do Tempo do ADR
// (AgencyReportTimeline.tsx) quanto pelo congelamento no snapshot de
// fechamento (VoyageAgencyReportTab.tsx), para as duas leituras nunca
// divergirem se o critério mudar.
export function filterDepartmentReopeningEvents(
  events: AgencyReportDepartmentSignoffEvent[],
  department: AgencyReportDepartmentKey,
): AgencyReportDepartmentSignoffEvent[] {
  return events.filter((event) => event.department === department && event.new_value === 'false')
}

export async function addOccurrence(input: {
  voyageId: number
  port: string
  body: string
  section?: AgencyReportSection
}) {
  const { error } = await supabase.rpc('add_agency_report_occurrence', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_body: input.body,
    p_section: input.section,
  })
  if (error) throw error
}

export async function setTerminal(input: { voyageId: number; port: string; terminal: string }) {
  const { error } = await supabase.rpc('set_agency_report_terminal', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_terminal: input.terminal,
  })
  if (error) throw error
}

export async function closeReport(input: { voyageId: number; port: string; snapshot: Json }) {
  const { error } = await supabase.rpc('close_agency_departure_report', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_snapshot: input.snapshot,
  })
  if (error) {
    const detail = extractErrorText(error)
    throw new Error(detail || 'Falha ao fechar o ADR.')
  }
}

export async function closeReportByReportId(input: { reportId: string; voyageId: number; port: string; snapshot: Json }) {
  await callReportIdAwareRpc('close_agency_departure_report_by_report_id', {
    p_report_id: input.reportId,
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_snapshot: input.snapshot,
  })
}

// Portos com ADR fechado da viagem (Task 2 do ADR 2026-07-31): uma escala
// omitida DEPOIS de o ADR ter sido fechado continua reachable para consulta —
// o fechamento é um registro imutável. Só o porto (não o registro inteiro)
// interessa aqui; quem precisar do snapshot usa getAgencyReportOwnData.
export async function listClosedAgencyReportPorts(voyageId: number): Promise<string[]> {
  const { data, error } = await supabase
    .from('agency_departure_reports')
    .select('port')
    .eq('voyage_id', voyageId)
    .eq('status', 'closed')
  if (error) throw error
  return [...new Set((data ?? []).map((row) => row.port))]
}

export async function reopenReport(input: { voyageId: number; port: string; justification: string }) {
  const { error } = await supabase.rpc('reopen_agency_departure_report', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_justification: input.justification,
  })
  if (error) throw error
}

export async function reopenReportByReportId(input: { reportId: string; voyageId: number; port: string; justification: string }) {
  await callReportIdAwareRpc('reopen_agency_departure_report_by_report_id', {
    p_report_id: input.reportId,
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_justification: input.justification,
  })
}

export type MatrixCategory =
  | 'carga_geral'
  | 'veiculos'
  | 'transbordo'
  | 'oog'
  | 'imo'
  // 'vazio': container vazio do Baplie sem B/L correspondente, na própria
  // listagem de carga descarregada (Task 3). 'vazio_cama'/'vazio_cover_plate':
  // classificação de vazios_importacao_containers, seção própria — não
  // confundir os três.
  | 'vazio'
  | 'vazio_cama'
  | 'vazio_cover_plate'

export type AgencyReportDischargeContainer = {
  container_number: string
  size_type: string | null
  is_imo: boolean
  is_oog: boolean
  is_transshipment: boolean
  category: MatrixCategory
}

/**
 * Destino do container descarregado. Natureza (IMO/OOG/carga geral) e destino
 * são eixos independentes desde que `is_transshipment` virou flag própria; a
 * categoria `'transbordo'` só aparece em snapshots fechados antes disso e
 * continua sendo lida aqui para não perder o número no histórico.
 */
export function isTransshipmentContainer(
  container: { is_transshipment?: boolean | null; category?: MatrixCategory | string | null },
) {
  return Boolean(container.is_transshipment) || container.category === 'transbordo'
}

// Rótulo de categoria na Listagem do operado (Task 3/4/5): 'vazio' (Baplie
// sem B/L) e 'vazio_cama'/'vazio_cover_plate' (módulo de Vazios de
// Importação) aparecem lado a lado no mesmo documento — sem rótulo, a
// diferença entre os três se perde no `replaceAll('_', ' ')` genérico.
export const MATRIX_CATEGORY_LABELS: Record<string, string> = {
  carga_geral: 'carga geral',
  veiculos: 'veículos',
  transbordo: 'transbordo',
  oog: 'OOG',
  imo: 'IMO',
  vazio: 'vazio',
  vazio_cama: 'vazio — cama',
  vazio_cover_plate: 'vazio — cover plate',
}

function normalizeContainerNumber(containerNumber: string | null | undefined) {
  return String(containerNumber ?? '').replace(/\s+/g, '').toUpperCase()
}

export function buildContainerTypeMatrix(
  items: Array<{ type: string; category: MatrixCategory | string }>,
) {
  const rows: Record<string, Record<string, number>> = {}
  const totals: Record<string, number> = {}

  for (const item of items) {
    const type = item.type || '—'
    rows[type] = rows[type] ?? {}
    rows[type][item.category] = (rows[type][item.category] ?? 0) + 1
    totals[item.category] = (totals[item.category] ?? 0) + 1
  }

  return { rows, totals }
}

// Rótulo de condição dos vazios de exportação, mesma convenção do Depot
// Cadastro/Embarque de Vazios (EMPTY / EMPTY W/ MATERIAL) — Task 4 do ADR
// 2026-07-31: a listagem de Vazios embarcados precisa da condição, não só do
// tipo, então reaproveita o rótulo em vez de inventar um novo.
const VAZIOS_CONDITION_LABELS: Record<string, string> = {
  vazio: 'EMPTY',
  material: 'EMPTY W/ MATERIAL',
}

export type EmptyEmbarkRow = {
  type: string
  condition: string
  localLabel: string
  quantity: number
}

// Substitui a antiga matriz (type × 'carga_geral' fixo) por uma listagem em
// (tipo, condição, local de origem) — Task 4 do ADR 2026-07-31, bullet 4: a
// condição e o depot/terminal de origem eram descartados antes. Uma linha por
// combinação existente, ordenada como groupVehiclesByBrand (alfabética).
export function groupEmptyEmbarkBookings(
  items: Array<{ type: string; condition: string | null; localLabel: string | null }>,
): EmptyEmbarkRow[] {
  const rows = new Map<string, EmptyEmbarkRow>()

  for (const item of items) {
    const type = item.type || '—'
    const condition = (item.condition && VAZIOS_CONDITION_LABELS[item.condition]) || item.condition || '—'
    const localLabel = item.localLabel || '—'
    const key = `${type}::${condition}::${localLabel}`
    const existing = rows.get(key)
    if (existing) existing.quantity += 1
    else rows.set(key, { type, condition, localLabel, quantity: 1 })
  }

  return [...rows.values()].sort((a, b) =>
    a.type.localeCompare(b.type) || a.condition.localeCompare(b.condition) || a.localLabel.localeCompare(b.localLabel),
  )
}

export function groupVehiclesByBrand(
  vehicles: Array<{ brand: string; bl_id: string; chassis: string; isTransshipment?: boolean }>,
) {
  const byBrand = new Map<string, { bls: Set<string>; vins: Set<string>; transshipmentVins: Set<string> }>()

  for (const vehicle of vehicles) {
    const entry = byBrand.get(vehicle.brand) ?? { bls: new Set<string>(), vins: new Set<string>(), transshipmentVins: new Set<string>() }
    entry.bls.add(vehicle.bl_id)
    entry.vins.add(vehicle.chassis)
    if (vehicle.isTransshipment) entry.transshipmentVins.add(vehicle.chassis)
    byBrand.set(vehicle.brand, entry)
  }

  return [...byBrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, entry]) => ({
      brand,
      blCount: entry.bls.size,
      vinCount: entry.vins.size,
      // Task 1 (ADR 2026-07-31): quantos desses VINs chegaram em transbordo,
      // separado do total (que já inclui os próprios e os em transbordo).
      transshipmentVinCount: entry.transshipmentVins.size,
    }))
}

export function summarizeVehiclesByContainerTypeAndModel(
  vehicles: Array<{ chassis: string; model: string | null; containerNumber: string | null; containerType: string | null }>,
) {
  const containersByType = new Map<string, Set<string>>()
  const vehiclesByModel = new Map<string, Set<string>>()
  for (const vehicle of vehicles) {
    const type = vehicle.containerType?.trim() || 'Não informado'
    const container = vehicle.containerNumber?.trim().toUpperCase()
    const containers = containersByType.get(type) ?? new Set<string>()
    if (container) containers.add(container)
    containersByType.set(type, containers)
    const model = vehicle.model?.trim() || 'Não informado'
    const models = vehiclesByModel.get(model) ?? new Set<string>()
    models.add(vehicle.chassis)
    vehiclesByModel.set(model, models)
  }
  return {
    containersByType: [...containersByType].map(([label, values]) => ({ label, count: values.size })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    vehiclesByModel: [...vehiclesByModel].map(([label, values]) => ({ label, count: values.size })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  }
}

type BreakbulkAgencyReportBl = {
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_weight_ton: number | null
  total_weight_kg: number | null
  bb_cbm: number | null
}

// ADR 0022/0025: bls.pod nunca é reescrito para disposição 'transshipment'
// (só COD reescreve). A carga de um B/L em transbordo continua com pod no
// porto omitido, então a escala do porto de descarga real precisa buscá-la
// à parte via voyage_omissions → bl_transshipments, sem tocar em bls.pod.
async function listTransshipmentBlIds(voyageId: number, port: string): Promise<string[]> {
  const omissionsRes = await supabase
    .from('voyage_omissions')
    .select('id')
    .eq('voyage_id', voyageId)
    .in('discharge_pod', portCodeVariants(port))
  if (omissionsRes.error) throw omissionsRes.error
  const omissionIds = (omissionsRes.data ?? []).map((row) => row.id)
  if (!omissionIds.length) return []

  const blTransshipmentsRes = await supabase
    .from('bl_transshipments')
    .select('bl_id')
    .in('omission_id', omissionIds)
    .eq('disposition', 'transshipment')
  if (blTransshipmentsRes.error) throw blTransshipmentsRes.error
  return [...new Set((blTransshipmentsRes.data ?? []).map((row) => row.bl_id))]
}

const BL_CONTAINERS_SELECT = 'id, container_number, type, is_imo, is_oog, bl:bls!inner(voyage_id, pod, transshipments:bl_transshipments(disposition))'
const BREAKBULK_SELECT = 'cargo_mode, bb_machine_qty, bb_packages_qty, bb_weight_ton, total_weight_kg, bb_cbm'
const VEHICLES_SELECT = 'brand, model, bl_id, chassis, container_id, container:bl_containers(container_number, type, unpacking_location)'

const SUPABASE_PAGE_SIZE = 1000

// Task 6/10 (ADR 2026-07-31) trocaram consultas filtradas por porto por
// consultas da viagem inteira (para casar por porto normalizado em JS —
// ver normalizePortCode acima). O PostgREST limita o retorno por página
// (mesmo teto que reconcileBaplieWithManifest já pagina em
// baplieReconciliation.ts); sem paginar aqui, uma viagem com mais granito/
// B/Ls do que a página perderia linhas silenciosamente do ADR.
async function fetchAllRows<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[] | null; error: unknown }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await queryFactory(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  return { data: rows, error: null }
}

// ponytail: mesma união de bls.pod/bls.pol normalizada e filtrada a portos BR
// que fetchVoyageEscalaPorts (src/pages/EmbarqueVazios.tsx) já faz — duplicada
// aqui porque este é o serviço do ADR, não a página de Embarque de Vazios, e o
// plano deste ADR (2026-07-31-adr-cobertura-fontes-forma) é deliberadamente
// independente do plano de projeção unificada de escalas. Teto: não enxerga
// escala planejada sem B/L ainda lançado. Upgrade: as duas cópias somem quando
// docs/plans/2026-07-31-escala-unificada-pol-pod.md entregar a projeção comum.
async function listVoyageEscalaPorts(voyageId: number): Promise<Set<string>> {
  const ports = new Set<string>()
  for (const raw of await listVoyageRoutePorts(voyageId)) {
    const code = normalizePortCode(raw)
    if (code && code.startsWith('BR')) ports.add(code)
  }
  return ports
}

export type AgencyReportOrphanEntry = { port: string; count: number }
export type AgencyReportOrphanData = {
  granito: AgencyReportOrphanEntry[]
  vaziosEmbarcados: AgencyReportOrphanEntry[]
}

function toSortedOrphanEntries(byPort: Map<string, number>): AgencyReportOrphanEntry[] {
  return [...byPort.entries()]
    .map(([port, count]) => ({ port, count }))
    .sort((a, b) => a.port.localeCompare(b.port))
}

export async function getAgencyReportDerivedData(voyageId: number, port: string) {
  const entityId = buildVoyagePodEntityId(voyageId, port)
  // Granito (Task 6) e o aviso de órfão (Task 10) casam pelo porto normalizado
  // — `port` chega como veio de bls.pod (ex.: 'BRVIT', legado antes do LOCODE
  // canônico 'BRVIX'), então comparar contra o `port` cru perderia granito de
  // uma escala válida sem marcá-lo como órfão (as duas checagens usam a mesma
  // normalização de escalaPorts, então ficariam inconsistentes entre si).
  const portCode = normalizePortCode(port) ?? port
  const transshipmentBlIds = await listTransshipmentBlIds(voyageId, port)
  const emptyResult = { data: [], error: null }

  const [
    schedules,
    escalaSchedules,
    escalaPorts,
    vehiclesRes,
    vaziosImpRes,
    graniteRes,
    baplieContainersRes,
    blContainersRes,
    operationRes,
    allVaziosOpsRes,
    breakbulkRes,
    transshipmentBlContainersRes,
    transshipmentBreakbulkRes,
    transshipmentVehiclesRes,
  ] = await Promise.all([
    listVoyagePodSchedules([entityId]),
    // A escala é a fonte operacional de ETA/ATA e da lista de Atracações. O
    // ATD do ADR será selecionado pela aba conforme o terminal do relatório.
    listVoyageEscalaSchedulesByVoyageIds([voyageId]),
    // Task 10 (ADR 2026-07-31): conjunto de escalas BR válidas da viagem, para
    // distinguir "dado órfão" (porto que não é escala nenhuma) de "dado da
    // escala vizinha" (porto válido, só que não é este).
    listVoyageEscalaPorts(voyageId),
    // Veiculos/containers ficaram fora da paginação de fetchAllRows quando o
    // Task 6 a introduziu para granito/escalaPorts; um navio RoRo grande ou
    // uma escala com >1000 containers batia o teto padrão do PostgREST (1000
    // linhas) e perdia o resto silenciosamente — mesmo bug do granito antes do
    // Task 6, só que aqui.
    fetchAllRows((from, to) =>
      supabase
        .from('vehicles')
        .select(`${VEHICLES_SELECT}, bl:bls!inner(voyage_id, pod)`)
        .eq('bl.voyage_id', voyageId)
        // P0-3: igualdade crua contra `port` perdia veiculos de B/Ls gravados
        // com a forma legada do porto (ex. 'BRVIT' antes de 'BRVIX' virar
        // canonico) — mesmo problema que baplie/vazios/granito ja tratam com
        // portCodeVariants abaixo.
        .in('bl.pod', portCodeVariants(port))
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('vazios_importacao_containers')
        .select('container_type, natureza, pod, manifest:vazios_importacao_manifests!inner(voyage_id)')
        .eq('manifest.voyage_id', voyageId)
        .in('pod', portCodeVariants(port))
        .range(from, to),
    ),
    // Task 6 (ADR 2026-07-31): não filtra loading_port no banco — B/Ls
    // importados antes da normalização (Task 6 em graniteImport.ts) guardam
    // texto livre ("Vitoria, Brazil") que nunca bateria num .eq() exato contra
    // o LOCODE da escala. Traz todos os B/Ls da viagem, com o loading_port do
    // manifesto como fallback, e casa em JS via normalizePortCode (abaixo).
    fetchAllRows((from, to) =>
      supabase
        .from('granite_bls')
        .select('real_weight_kg, blocks_qty, loading_port, manifest:granite_manifests!inner(voyage_id, loading_port)')
        .eq('manifest.voyage_id', voyageId)
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('baplie_containers')
        .select('container_number, size_type, status, is_imo, is_oog, pod')
        .eq('voyage_id', voyageId)
        .in('pod', portCodeVariants(port))
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('bl_containers')
        .select(BL_CONTAINERS_SELECT)
        .eq('bl.voyage_id', voyageId)
        // P0-3: mesma correcao acima — esta e a consulta que alimenta a
        // contagem de Carga descarregada (ADR 0025/0035); igualdade crua
        // subcontava containers de B/Ls com pod na forma legada e inflava
        // a divergencia de existencia com o Baplie.
        .in('bl.pod', portCodeVariants(port))
        .range(from, to),
    ),
    supabase
      .from('vazios_export_operations')
      .select('*')
      .eq('voyage_id', voyageId)
      .in('embark_port', portCodeVariants(port))
      .maybeSingle(),
    // Task 10 (ADR 2026-07-31): todas as operações de Embarque de Vazios da
    // viagem, sem filtrar embark_port — igual em espírito ao Task 6 do
    // granito, para achar operações lançadas num porto que não é escala.
    supabase
      .from('vazios_export_operations')
      .select('id, embark_port')
      .eq('voyage_id', voyageId),
    supabase
      .from('bls')
      .select(BREAKBULK_SELECT)
      .eq('voyage_id', voyageId)
      .in('pod', portCodeVariants(port))
      .in('cargo_mode', ['carga_solta', 'misto']),
    // Carga em transbordo (Task 1 do ADR 2026-07-31): mesmas três consultas,
    // agora restritas aos B/Ls de transshipmentBlIds, sem filtrar por bls.pod
    // (que continua apontando para o porto omitido). Só disparam quando há
    // B/Ls em transbordo para esta escala.
    transshipmentBlIds.length
      ? fetchAllRows((from, to) =>
          supabase.from('bl_containers').select(BL_CONTAINERS_SELECT).in('bl_id', transshipmentBlIds).range(from, to),
        )
      : Promise.resolve(emptyResult),
    transshipmentBlIds.length
      ? supabase.from('bls').select(BREAKBULK_SELECT).in('id', transshipmentBlIds).in('cargo_mode', ['carga_solta', 'misto'])
      : Promise.resolve(emptyResult),
    transshipmentBlIds.length
      ? fetchAllRows((from, to) =>
          supabase.from('vehicles').select(VEHICLES_SELECT).in('bl_id', transshipmentBlIds).range(from, to),
        )
      : Promise.resolve(emptyResult),
  ])

  for (const result of [
    vehiclesRes,
    vaziosImpRes,
    graniteRes,
    baplieContainersRes,
    blContainersRes,
    operationRes,
    allVaziosOpsRes,
    breakbulkRes,
    transshipmentBlContainersRes,
    transshipmentBreakbulkRes,
    transshipmentVehiclesRes,
  ]) {
    if (result.error) throw result.error
  }

  type AgencyReportVehicle = Pick<Vehicle, 'brand' | 'model' | 'bl_id' | 'chassis' | 'container_id'> & {
    container: { container_number: string | null; type: string | null; unpacking_location: string | null } | null
    isTransshipment: boolean
  }
  const ownVehicles = (vehiclesRes.data ?? []) as unknown as Array<Omit<AgencyReportVehicle, 'isTransshipment'>>
  const transshipmentVehicles = (transshipmentVehiclesRes.data ?? []) as unknown as Array<Omit<AgencyReportVehicle, 'isTransshipment'>>
  // bls.pod nunca é o mesmo entre o porto da escala e o porto omitido de uma
  // mesma viagem, então as duas listas nunca se sobrepõem — concatena sem
  // deduplicar (ver listTransshipmentBlIds).
  const vehicles: AgencyReportVehicle[] = [
    ...ownVehicles.map((vehicle) => ({ ...vehicle, isTransshipment: false })),
    ...transshipmentVehicles.map((vehicle) => ({ ...vehicle, isTransshipment: true })),
  ]
  const operation = operationRes.data as VaziosExportOperation | null
  const allDepots = operation ? await listDepots() : []
  const emptyOperationResult = { data: [], error: null }
  // Mesmo teto de 1000 linhas do PostgREST que já mordeu vehicles/containers
  // acima: uma operação de Embarque de Vazios grande também passa disso.
  const vaziosExpRes = operation
    ? await fetchAllRows<VaziosBooking>((from, to) =>
        supabase.from('vazios_bookings').select('*').eq('operation_id', operation.id).range(from, to),
      )
    : emptyOperationResult
  const serviceLinesRes = operation
    ? await supabase.from('vazios_export_service_lines').select('*').eq('operation_id', operation.id)
    : emptyOperationResult

  for (const result of [vaziosExpRes, serviceLinesRes]) {
    if (result.error) throw result.error
  }

  // Task 10 (ADR 2026-07-31): Embarque de Vazios lançado num porto que não é
  // escala nenhuma da viagem — mesma lógica do granito, mas a "quantidade" é o
  // total de vazios_bookings sob a operação órfã (raro e de baixa
  // cardinalidade — uma consulta extra, só quando há órfão, é proporcional).
  const allVaziosOps = (allVaziosOpsRes.data ?? []) as Array<Pick<VaziosExportOperation, 'id' | 'embark_port'>>
  const orphanVaziosOps = allVaziosOps.filter((op) => {
    const normalized = normalizePortCode(op.embark_port)
    return normalized !== null && normalized !== portCode && !escalaPorts.has(normalized)
  })
  const orphanVaziosBookingsRes = orphanVaziosOps.length
    ? await supabase.from('vazios_bookings').select('operation_id').in('operation_id', orphanVaziosOps.map((op) => op.id))
    : emptyOperationResult
  if (orphanVaziosBookingsRes.error) throw orphanVaziosBookingsRes.error
  const orphanBookingCountByOpId = new Map<string, number>()
  for (const row of (orphanVaziosBookingsRes.data ?? []) as Array<{ operation_id: string }>) {
    orphanBookingCountByOpId.set(row.operation_id, (orphanBookingCountByOpId.get(row.operation_id) ?? 0) + 1)
  }
  const orphanVaziosByPort = new Map<string, number>()
  for (const op of orphanVaziosOps) {
    const normalized = normalizePortCode(op.embark_port)!
    const count = orphanBookingCountByOpId.get(op.id) ?? 0
    orphanVaziosByPort.set(normalized, (orphanVaziosByPort.get(normalized) ?? 0) + count)
  }

  const rawServiceLines = serviceLinesRes.data as VaziosExportServiceLineWithObservation[]
  const serviceIds = [...new Set(rawServiceLines.map((line) => line.service_id))]
  const servicesRes = serviceIds.length
    ? await supabase.from('depot_services').select('id, name, natureza').in('id', serviceIds)
    : emptyOperationResult
  if (servicesRes.error) throw servicesRes.error
  const servicesById = new Map((servicesRes.data ?? []).map((service) => [service.id, service]))
  const depotsById = new Map(allDepots.map((depot) => [depot.id, depot]))

  const vaziosExp = (vaziosExpRes.data ?? []).map((booking) => ({
    ...booking,
    local: depotsById.get(booking.local_id) ?? null,
  })) as Array<VaziosBooking & {
    local: Pick<Depot, 'id' | 'code' | 'name' | 'tipo'> | null
  }>
  const vaziosImp = (vaziosImpRes.data ?? []) as Pick<VaziosImportacaoContainer, 'container_type' | 'natureza' | 'pod'>[]
  type AgencyReportGraniteBl = Pick<GraniteBl, 'real_weight_kg' | 'blocks_qty' | 'loading_port'> & {
    manifest: Pick<GraniteManifest, 'loading_port'> | null
  }
  const graniteRows = (graniteRes.data ?? []) as unknown as AgencyReportGraniteBl[]
  // Task 6 (ADR 2026-07-31): casa pelo porto normalizado, usando o
  // loading_port do manifesto quando o B/L não trouxer o seu (fallback).
  const granite: Pick<GraniteBl, 'real_weight_kg' | 'blocks_qty' | 'loading_port'>[] = graniteRows
    .filter((bl) => normalizePortCode(bl.loading_port ?? bl.manifest?.loading_port ?? null) === portCode)
    .map((bl) => ({ real_weight_kg: bl.real_weight_kg, blocks_qty: bl.blocks_qty, loading_port: bl.loading_port }))
  // Task 10 (ADR 2026-07-31): granito num porto que não é escala nenhuma da
  // viagem (nem esta, nem outra) — dado órfão, provável porto digitado/
  // importado errado. Granito de uma escala vizinha VÁLIDA (em escalaPorts)
  // não entra aqui — aparece normalmente no ADR daquela escala.
  const orphanGraniteByPort = new Map<string, number>()
  for (const bl of graniteRows) {
    const normalized = normalizePortCode(bl.loading_port ?? bl.manifest?.loading_port ?? null)
    if (!normalized || normalized === portCode || escalaPorts.has(normalized)) continue
    orphanGraniteByPort.set(normalized, (orphanGraniteByPort.get(normalized) ?? 0) + 1)
  }
  const baplieContainers = (baplieContainersRes.data ?? []) as Pick<BaplieContainer, 'container_number' | 'size_type' | 'status' | 'is_imo' | 'is_oog' | 'pod'>[]
  type AgencyReportBlContainer = {
    id: number
    container_number: string
    type: string | null
    is_imo: boolean | null
    is_oog: boolean | null
    bl: { transshipments: Array<{ disposition: string }> | null } | null
  }
  // Idem: containers do porto da escala e containers em transbordo (bls.pod
  // apontando para o porto omitido) nunca se sobrepõem.
  const blContainers = [
    ...(blContainersRes.data ?? []),
    ...(transshipmentBlContainersRes.data ?? []),
  ] as AgencyReportBlContainer[]
  const baplieByContainerNumber = new Map(baplieContainers.map((container) => [normalizeContainerNumber(container.container_number), container]))
  const blContainerNumbers = new Set(blContainers.map((container) => normalizeContainerNumber(container.container_number)))
  // Um container compartilhado (ADR 0025/blFreightImport.ts) gera uma linha em
  // bl_containers por B/L que o referencia, mas é a mesma unidade física
  // descarregada uma vez só — sem deduplicar por número, a Carga Descarregada
  // conta e soma o mesmo container 2x/3x. Agrega por container_number antes de
  // classificar; entre duplicatas, IMO e OOG vencem carga_geral, pra não esconder uma natureza
  // real só porque outro B/L do mesmo container não a declarou. OOG vence IMO
  // quando os dois flags coexistem.
  const dischargeByContainerNumber = new Map<string, AgencyReportDischargeContainer>()
  for (const container of blContainers) {
    const baplie = baplieByContainerNumber.get(normalizeContainerNumber(container.container_number))
    const isTransshipment = container.bl?.transshipments?.some((transshipment) => transshipment.disposition === 'transshipment') ?? false
    const isImo = baplie ? Boolean(baplie.is_imo) : Boolean(container.is_imo)
    const isOog = baplie ? Boolean(baplie.is_oog) : Boolean(container.is_oog)
    const category: MatrixCategory = isOog ? 'oog' : isImo ? 'imo' : 'carga_geral'

    const key = normalizeContainerNumber(container.container_number)
    const existing = dischargeByContainerNumber.get(key)
    if (!existing) {
      dischargeByContainerNumber.set(key, {
        container_number: container.container_number,
        size_type: container.type ?? baplie?.size_type ?? null,
        is_imo: isImo,
        is_oog: isOog,
        is_transshipment: isTransshipment,
        category,
      })
      continue
    }
    existing.is_imo = existing.is_imo || isImo
    existing.is_oog = existing.is_oog || isOog
    existing.is_transshipment = existing.is_transshipment || isTransshipment
    existing.size_type = existing.size_type ?? container.type ?? baplie?.size_type ?? null
    existing.category = existing.is_oog ? 'oog' : existing.is_imo ? 'imo' : 'carga_geral'
  }
  const containers: AgencyReportDischargeContainer[] = [...dischargeByContainerNumber.values()]

  // ADR 0035 + Block 5.5: o B/L é a única fonte documental dos cheios (ADR
  // 0025). O Baplie só alimenta a contagem de vazios descarregados e sua
  // divergência com o módulo de Vazios de Importação; vazio sem B/L não é uma
  // linha de Carga descarregada, para não contar a mesma unidade duas vezes.
  // Um container 'full' do Baplie sem B/L correspondente vira divergência de
  // existência (mesmo conceito de reconcileBaplieWithManifest /
  // computeExistenceDivergences, kind 'missing_in_manifest'), não um item da
  // matriz — evita inflar carga_geral/imo sem lastro documental.
  let orphanFullContainers = 0
  for (const container of baplieContainers) {
    if (blContainerNumbers.has(normalizeContainerNumber(container.container_number))) continue
    if (container.status === 'full') {
      orphanFullContainers += 1
      continue
    }
    // Vazios do Baplie ficam somente em baplieEmptyCount abaixo. O módulo de
    // Vazios de Importação é a fonte da listagem por natureza.
    // status fora de 'full'/'empty' (não deveria ocorrer — ver baplieParser.ts):
    // fica de fora da matriz e da divergência, sem lastro para decidir.
  }
  // Vazios descarregados: o Baplie conta quantos vazios chegaram no porto;
  // vazios_importacao_containers é o módulo que os classifica em cama/cover
  // plate (src/services/vaziosNatureza.ts). Quando as contagens divergem, a UI
  // (Task 4) precisa mostrar os dois números e quantas unidades do módulo
  // ainda estão sem natureza classificada.
  const baplieEmptyCount = baplieContainers.filter((container) => container.status === 'empty').length
  const vaziosModuleCount = vaziosImp.length
  const vaziosUnclassifiedCount = vaziosImp.filter((container) => container.natureza === null).length
  const vaziosDivergence = {
    baplieCount: baplieEmptyCount,
    moduleCount: vaziosModuleCount,
    unclassifiedCount: vaziosUnclassifiedCount,
    diverges: baplieEmptyCount !== vaziosModuleCount,
  }

  const breakbulk = (breakbulkRes.data ?? []) as BreakbulkAgencyReportBl[]
  const transshipmentBreakbulk = (transshipmentBreakbulkRes.data ?? []) as BreakbulkAgencyReportBl[]
  const units = vaziosExp.map((booking) => ({ ...booking, container_number: booking.container_number, local_id: booking.local_id, condition: booking.condition }))
  const serviceLines = rawServiceLines.map((row) => {
    const service = servicesById.get(row.service_id) ?? null
    const line = {
      ...row,
      service,
      local: depotsById.get(row.local_id) ?? null,
      destino: row.destino_id ? depotsById.get(row.destino_id) ?? null : null,
      natureza: service?.natureza ?? 'geral',
      local_id: row.local_id,
      quantidade: Number(row.quantidade),
      valor_unitario: Number(row.valor_unitario),
    }
    // totalLinha já recalcula a quantidade efetiva por dentro (armazenagem por
    // depot/condição); calculamos aqui uma única vez e devolvemos junto da
    // linha, para a aba e o impresso pararem de reimplementar a fórmula com
    // divergência em linhas legadas de armazenagem com percentual não nulo
    // (Task 8 do ADR 2026-07-31).
    return { ...line, quantidade: quantidadeEfetiva(line, units, allDepots), total: totalLinha(line, units, allDepots) }
  })
  const costs = { total: totalEmbarque({ unidades: units, linhas: serviceLines, depots: allDepots }), serviceLines }

  const escala = (escalaSchedules.get(voyageId) ?? []).find((entry) => normalizePortCode(entry.port) === portCode) ?? null

  return {
    schedule: schedules.get(entityId) ?? null,
    escala,
    terminalSchedules: escala?.atracacoes ?? [],
    vehicles,
    vaziosExp,
    vaziosImp,
    granite,
    containers,
    // Aviso de divergência (Task 3): quantidade de cheios do Baplie sem B/L
    // correspondente nesta escala. O link para a Conciliação Baplie × B/L é
    // responsabilidade da UI (Task 4/5) — aqui só a contagem.
    dischargeDivergence: { orphanFullContainers },
    vaziosDivergence,
    // Task 10 (ADR 2026-07-31): granito/vazios embarcados lançados num porto
    // que não é escala nenhuma da viagem — aviso informativo, não bloqueante
    // (ver OrphanDataWarning em VoyageAgencyReportTab.tsx).
    orphanData: {
      granito: toSortedOrphanEntries(orphanGraniteByPort),
      vaziosEmbarcados: toSortedOrphanEntries(orphanVaziosByPort),
    } satisfies AgencyReportOrphanData,
    operation,
    costs,
    storage: computeStorageTotals(vaziosExp, allDepots),
    cargaSolta: {
      ...summarizeBreakbulk(breakbulk),
      // Contagem em transbordo separada da de destino final (Task 1); exibida
      // à parte na aba e no impresso (VoyageAgencyReportTab/AgencyReportDocument).
      transshipment: summarizeBreakbulk(transshipmentBreakbulk),
    },
  }
}

function summarizeBreakbulk(breakbulk: BreakbulkAgencyReportBl[]) {
  return {
    bls: breakbulk.length,
    machines: breakbulk.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0),
    packages: breakbulk.reduce((sum, bl) => sum + Number(bl.bb_packages_qty ?? 0), 0),
    weightTon: breakbulk.reduce((sum, bl) => sum + breakbulkWeightTon(bl), 0),
    cbm: breakbulk.reduce((sum, bl) => sum + Number(bl.bb_cbm ?? 0), 0),
  }
}
