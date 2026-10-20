import { parseImportDate } from '../lib/importDate'
import { assertUploadFile } from '../lib/fileGuard'
import { createHeaderMapper, createRowErrorCollector, matchHeaders, readSheet, type HeaderSpec, type RowError } from './importCore'
import { IsoContainerSchema } from './importValidation'
import { supabase } from './supabase'
import { escapeFilterTerm } from '../lib/utils'

const HEADER_MAP: Record<string, string> = {
  container: 'container_number', conteiner: 'container_number', 'container number': 'container_number',
  tipo: 'container_type', type: 'container_type',
  local: 'local_code', origem: 'local_code', depot: 'local_code', 'local de origem': 'local_code', 'origin location': 'local_code',
  condicao: 'condition', condition: 'condition', status: 'condition',
  'hand-in': 'hand_in_date', 'hand in': 'hand_in_date', entrada: 'hand_in_date', 'gate in': 'hand_in_date',
  'hand-out': 'hand_out_date', 'hand out': 'hand_out_date', saida: 'hand_out_date', 'gate out': 'hand_out_date',
  embarque: 'movement_date', 'data embarque': 'movement_date', 'load date': 'movement_date', data: 'movement_date',
}

type VaziosHeaderField = 'container_number' | 'local_code' | 'condition'
const VAZIOS_HEADER_SPEC: HeaderSpec<VaziosHeaderField> = {
  aliases: {
    container_number: ['container', 'conteiner', 'container number'],
    local_code: ['local', 'origem', 'depot', 'local de origem', 'origin location'],
    condition: ['condicao', 'condition', 'status'],
  },
  required: ['container_number', 'local_code', 'condition'],
}
const VAZIOS_HEADER_LABELS: Record<VaziosHeaderField, string> = {
  container_number: 'Container',
  local_code: 'Local',
  condition: 'Condition',
}

export type ParsedVaziosBooking = {
  rowNumber: number
  booking_number?: string | null
  origin_terminal?: string | null
  destination?: string | null
  notes?: string | null
  depot?: string | null
  material?: boolean
  overtime_pct?: number
  os_number?: string | null
  embark_port?: string | null
  container_number: string
  container_type: string | null
  local_code?: string | null
  condition: 'vazio' | 'material' | 'empty' | null
  hand_in_date: string | null
  hand_out_date: string | null
  movement_date: string | null
}

export type ParsedVaziosManifest = {
  bookings: ParsedVaziosBooking[]
  rowErrors: RowError[]
  /** Avisos do leitor (linhas e abas ocultas, CSV Windows-1252), para o operador ver antes de gravar. */
  warnings: string[]
  /**
   * O que o leitor ignorou por estar oculto (planilha filtrada por depot): a
   * reimportação substitui a lista da escala, e as unidades dessas linhas saem
   * do Embarque. A tela pede confirmação explícita.
   */
  hidden: { rows: number; sheets: string[] }
}

// Subconjunto do Cadastro de Terminais usado para apontar, ainda no cliente, a
// mesma divergência que a RPC rejeitaria em bloco (ADR 0033: "qualquer
// divergência é apontada"). Duplica a regra da RPC deliberadamente — o mesmo
// padrão do veto() client-side para Linhas de Serviço — para dar mensagem por
// linha em vez do "corrija todas as linhas" genérico do banco.
export type DepotLookup = { code: string; tipo: string; active: boolean }

export async function parseVaziosManifestFile(file: File, depots?: readonly DepotLookup[]): Promise<ParsedVaziosManifest> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  return parseVaziosManifestBuffer(await file.arrayBuffer(), depots)
}

export async function parseVaziosManifestBuffer(buffer: ArrayBuffer, depots?: readonly DepotLookup[]): Promise<ParsedVaziosManifest> {
  const { headers, rows, warnings, hidden } = await readSheet(buffer, {
    expectedHeaders: Object.keys(HEADER_MAP),
  })
  const { missing } = matchHeaders(headers, VAZIOS_HEADER_SPEC)
  if (missing.length) {
    const labels = missing.map((field) => VAZIOS_HEADER_LABELS[field])
    throw new Error(`Planilha inválida. Colunas obrigatórias: ${labels.join(', ')}.`)
  }
  const mapRow = createHeaderMapper(rows[0], HEADER_MAP)
  const mappedRows = rows.map(mapRow)
  const bookings: ParsedVaziosBooking[] = []
  const rowErrors = createRowErrorCollector()
  mappedRows.forEach((mapped, idx) => {
    const row = rows[idx]!
    const rowNumber = row.rowNumber
    const containerNumber = String(mapped.container_number ?? '').trim().toUpperCase()
    if (!containerNumber) { rowErrors.add(rowNumber, 'Container ausente.', row); return }
    if (!IsoContainerSchema.safeParse(containerNumber).success) rowErrors.add(rowNumber, `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`, row)
    const condition = parseCondition(mapped.condition)
    if (!condition) rowErrors.add(rowNumber, `Container ${containerNumber}: condição deve ser Vazio ou Com material.`, row)
    const localCode = text(mapped.local_code)
    const handIn = readDate(mapped.hand_in_date)
    const handOut = readDate(mapped.hand_out_date)
    const movement = readDate(mapped.movement_date)
    const handInDate = handIn.date
    const handOutDate = handOut.date
    const movementDate = movement.date
    if (handIn.problem) rowErrors.add(rowNumber, `Container ${containerNumber}: data de entrada inválida (${handIn.problem}).`, row)
    if (handOut.problem) rowErrors.add(rowNumber, `Container ${containerNumber}: data de saída inválida (${handOut.problem}).`, row)
    if (movement.problem) rowErrors.add(rowNumber, `Container ${containerNumber}: data de embarque inválida (${movement.problem}).`, row)
    // P2-20: um container nao pode embarcar antes de sair do depot que o
    // liberou — sem essa checagem, um erro de digitação no embarque nunca era
    // confrontado com o gate in/out que ja tinhamos.
    if (movementDate && handOutDate && movementDate < handOutDate) {
      rowErrors.add(rowNumber, `Container ${containerNumber}: data de embarque anterior à saída do depot.`, row)
    }
    if (!localCode) rowErrors.add(rowNumber, `Container ${containerNumber}: local de origem obrigatório.`, row)
    else if (depots) validateLocalAgainstDepots(rowNumber, containerNumber, localCode, handInDate, handOutDate, depots, rowErrors, row)
    bookings.push({
      rowNumber, container_number: containerNumber, container_type: text(mapped.container_type)?.toUpperCase() ?? null, local_code: localCode,
      condition, hand_in_date: handInDate,
      hand_out_date: handOutDate, movement_date: movementDate,
    })
  })
  const firstRowByContainer = new Map<string, number>()
  for (const booking of bookings) {
    const firstRow = firstRowByContainer.get(booking.container_number)
    if (firstRow) {
      rowErrors.add(booking.rowNumber, `Container ${booking.container_number}: duplicado da linha ${firstRow}.`, booking)
      continue
    }
    firstRowByContainer.set(booking.container_number, booking.rowNumber)
  }
  return { bookings, rowErrors: rowErrors.errors, warnings, hidden }
}

export function parseCondition(value: unknown): ParsedVaziosBooking['condition'] {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'material' || normalized === 'com material' || normalized === 'loaded') return 'material'
  if (normalized === 'vazio' || normalized === 'empty') return 'vazio'
  return null
}

function text(value: unknown): string | null { const valueText = String(value ?? '').trim(); return valueText || null }

/** Mesma regra da RPC import_vazios_bookings_transactional (migration 243), linha a linha. */
function validateLocalAgainstDepots(
  rowNumber: number,
  containerNumber: string,
  localCode: string,
  handInDate: string | null,
  handOutDate: string | null,
  depots: readonly DepotLookup[],
  rowErrors: ReturnType<typeof createRowErrorCollector>,
  row: unknown,
): void {
  const depot = depots.find((item) => item.code.trim().toLowerCase() === localCode.trim().toLowerCase())
  if (!depot) {
    rowErrors.add(rowNumber, `Container ${containerNumber}: local "${localCode}" não encontrado em Locais (depots e terminais).`, row)
    return
  }
  if (!depot.active) {
    rowErrors.add(rowNumber, `Container ${containerNumber}: local "${localCode}" está inativo em Locais (depots e terminais).`, row)
    return
  }
  if (depot.tipo === 'depot') {
    if (!handInDate || !handOutDate) {
      rowErrors.add(rowNumber, `Container ${containerNumber}: depot "${localCode}" exige entrada e saída preenchidas.`, row)
    } else if (handOutDate < handInDate) {
      rowErrors.add(rowNumber, `Container ${containerNumber}: saída anterior à entrada no depot "${localCode}".`, row)
    }
  } else if (depot.tipo === 'terminal_portuario' && (handInDate || handOutDate)) {
    rowErrors.add(rowNumber, `Container ${containerNumber}: terminal portuário "${localCode}" não aceita entrada ou saída de depot.`, row)
  }
}

/**
 * Data da planilha pelo contrato único das importações (src/lib/importDate.ts):
 * célula de data do Excel (`AAAA-MM-DD`, com ou sem hora) ou texto
 * `DD/MM/AAAA`. Não há inferência DD/MM × MM/DD pelo arquivo: `05/03/2026` é
 * sempre 5 de março, e `03/15/2026` é recusado com o motivo.
 */
function readDate(value: unknown): { date: string | null; problem: string | null } {
  const parsed = parseImportDate(value)
  if (parsed.kind === 'value') return { date: parsed.date, problem: null }
  if (parsed.kind === 'empty') return { date: null, problem: null }
  return { date: null, problem: parsed.reason }
}

function formatRowErrors(rowErrors: readonly RowError[]): string {
  const lines = rowErrors.slice(0, MAX_ROW_ERRORS_SHOWN).map((error) => `Linha ${error.row}: ${error.message}`)
  const hidden = rowErrors.length - lines.length
  if (hidden > 0) lines.push(`... e mais ${hidden} linha${hidden === 1 ? '' : 's'} com divergências.`)
  return lines.join('\n')
}

export type ImportVaziosArgs = { filename: string; voyageId: number; port: string; manifest: Pick<ParsedVaziosManifest, 'bookings' | 'rowErrors'>; uploadedBy: string; description?: string }

// Limite de linhas detalhadas na mensagem de erro; acima disso um resumo com a
// contagem restante evita paredes de texto em planilhas com muitas divergências.
const MAX_ROW_ERRORS_SHOWN = 20

export async function importVaziosManifest({ voyageId, port, manifest, uploadedBy }: ImportVaziosArgs): Promise<{ manifestId: string }> {
  // Importação de unidades diverge do importCore: uma divergência aborta o lote inteiro.
  if (manifest.rowErrors.length) throw new Error(formatRowErrors(manifest.rowErrors))
  const p_bookings = manifest.bookings.map((booking) => Object.fromEntries(Object.entries(booking).filter(([key]) => key !== 'rowNumber')))
  const { data, error } = await supabase.rpc('import_vazios_bookings_transactional', { p_voyage_id: voyageId, p_port: port, p_uploaded_by: uploadedBy, p_bookings })
  if (error) throw error
  return { manifestId: (data as { manifest_id: string }).manifest_id }
}

export async function listVaziosBookings(filters: { voyageId?: string; search?: string; page?: number; pageSize?: number }) {
  const page = filters.page ?? 1; const pageSize = filters.pageSize ?? 20; const from = (page - 1) * pageSize; const to = from + pageSize - 1
  let query = supabase.from('vazios_bookings').select('*, manifest:vazios_manifests(id, voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(id, name)))', { count: 'exact' }).range(from, to).order('created_at', { ascending: false })
  if (filters.search) { const search = escapeFilterTerm(filters.search); if (search) query = query.or(`container_number.ilike.%${search}%`) }
  if (filters.voyageId) query = query.eq('voyage_id', Number(filters.voyageId))
  const { data, error, count } = await query; if (error) throw error
  return { rows: data ?? [], count: count ?? 0 }
}
