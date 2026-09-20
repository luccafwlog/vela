import { assertUploadFile } from '../lib/fileGuard'
import { createHeaderMapper, createRowErrorCollector, matchHeaders, readSheet, type HeaderSpec, type RowError } from './importCore'
import { IsoContainerSchema, IsoDateSchema } from './importValidation'
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

export type ParsedVaziosManifest = { bookings: ParsedVaziosBooking[]; rowErrors: RowError[] }

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
  const { headers, rows } = await readSheet(buffer, {
    dates: 'texto',
    expectedHeaders: Object.keys(HEADER_MAP),
  })
  const { missing } = matchHeaders(headers, VAZIOS_HEADER_SPEC)
  if (missing.length) {
    const labels = missing.map((field) => VAZIOS_HEADER_LABELS[field])
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${labels.join(', ')}.`)
  }
  const mapRow = createHeaderMapper(rows[0], HEADER_MAP)
  const mappedRows = rows.map(mapRow)
  // Uma planilha inteira segue uma única convenção de data (DD/MM ou MM/DD).
  // A evidência que desambigua pode aparecer em qualquer uma das três colunas
  // (ex.: SAÍDA nunca passa de dia 12, mas ENTRADA ou EMBARQUE sim) — inferir
  // por coluna isolada arrisca cada uma cair num padrão diferente.
  const dateOrder = inferDateOrder(mappedRows.flatMap((mapped) => [
    String(mapped.hand_in_date ?? ''), String(mapped.hand_out_date ?? ''), String(mapped.movement_date ?? ''),
  ]))
  const bookings: ParsedVaziosBooking[] = []
  const rowErrors = createRowErrorCollector()
  mappedRows.forEach((mapped, idx) => {
    const row = rows[idx]!
    const rowNumber = row.rowNumber
    const containerNumber = String(mapped.container_number ?? '').trim().toUpperCase()
    if (!containerNumber) { rowErrors.add(rowNumber, 'Container ausente.', row); return }
    if (!IsoContainerSchema.safeParse(containerNumber).success) rowErrors.add(rowNumber, `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`, row)
    const condition = parseCondition(mapped.condition)
    if (!condition) rowErrors.add(rowNumber, `Container ${containerNumber}: condição deve ser vazio ou material.`, row)
    const localCode = text(mapped.local_code)
    const handInRaw = String(mapped.hand_in_date ?? '').trim()
    const handOutRaw = String(mapped.hand_out_date ?? '').trim()
    const movementRaw = String(mapped.movement_date ?? '').trim()
    const handInDate = parseDate(handInRaw, dateOrder)
    const handOutDate = parseDate(handOutRaw, dateOrder)
    const movementDate = parseDate(movementRaw, dateOrder)
    if (handInRaw && !handInDate) rowErrors.add(rowNumber, `Container ${containerNumber}: data de entrada inválida.`, row)
    if (handOutRaw && !handOutDate) rowErrors.add(rowNumber, `Container ${containerNumber}: data de saída inválida.`, row)
    if (movementRaw && !movementDate) rowErrors.add(rowNumber, `Container ${containerNumber}: data de embarque inválida.`, row)
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
  return { bookings, rowErrors: rowErrors.errors }
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
    rowErrors.add(rowNumber, `Container ${containerNumber}: local "${localCode}" não encontrado no Cadastro de Terminais.`, row)
    return
  }
  if (!depot.active) {
    rowErrors.add(rowNumber, `Container ${containerNumber}: local "${localCode}" está inativo no Cadastro de Terminais.`, row)
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

// Faixa de seriais Excel que corresponde a datas plausíveis (~1970 a ~2070);
// fora dela um número pequeno (ex.: "2026" digitado por engano no lugar de
// uma data) não vira silenciosamente uma data de 1905.
const MIN_PLAUSIBLE_SERIAL = 25_570
const MAX_PLAUSIBLE_SERIAL = 62_136

type DateOrder = 'dmy' | 'mdy'

const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/

/**
 * Uma planilha usa uma única convenção de data. Decide DD/MM vs MM/DD para
 * toda a coluna a partir da primeira linha que desambigua (algum campo >12),
 * em vez de inferir linha a linha — o que faria uma mesma coluna misturar
 * convenções conforme cada linha for ou não ambígua.
 *
 * P2-17: sem nenhuma linha com campo >12, a evidência do arquivo não decide
 * nada — mesmo caso que `inferSeparatorFormat` (src/lib/importNumber.ts)
 * resolve devolvendo `'unknown'`. Aqui a assimetria é deliberada: bloquear
 * quando ambíguo (testado e revertido nesta mesma revisão) rejeitava a
 * maioria das planilhas reais, porque qualquer dia 1–12 do mês — o caso
 * comum de operação brasileira — já é "ambíguo" nesta definição. Sem um
 * declarar-formato na tela (como o Manifesto BB tem para decimais), o
 * bloqueio não tem via de escape para o operador. `'ambiguous'` fica
 * exposto no tipo de retorno para o upgrade descrito abaixo; o *fallback*
 * de leitura continua sendo DD/MM.
 *
 * ponytail: teto — planilha genuinamente MM/DD sem nenhum dia >12 é lida
 * como DD/MM sem aviso. Upgrade: alternador "Detectar pelo arquivo / DD/MM
 * / MM/DD" na UI do modal, no mesmo padrão do Importar Manifesto BB.
 */
function inferDateOrder(rawValues: string[]): DateOrder | 'ambiguous' {
  for (const raw of rawValues) {
    const match = raw.trim().match(SLASH_DATE)
    if (!match) continue
    const first = Number(match[1])
    const second = Number(match[2])
    if (first > 12 && second <= 12) return 'dmy'
    if (second > 12 && first <= 12) return 'mdy'
  }
  return 'ambiguous'
}

function parseDate(value: string, order: DateOrder | 'ambiguous'): string | null {
  const normalized = value.trim()
  if (!normalized) return null
  const serial = Number(normalized)
  if (Number.isFinite(serial) && serial >= MIN_PLAUSIBLE_SERIAL && serial <= MAX_PLAUSIBLE_SERIAL) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000)
    return dateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }

  const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return dateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const match = normalized.match(SLASH_DATE)
  if (!match) return null
  const first = Number(match[1])
  const second = Number(match[2])
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3])
  const monthFirst = order === 'mdy' && first <= 12
  const month = first > 12 && second <= 12 ? second : second > 12 && first <= 12 ? first : monthFirst ? first : second
  const day = first > 12 && second <= 12 ? first : second > 12 && first <= 12 ? second : monthFirst ? second : first
  return dateFromParts(year, month, day)
}

function dateFromParts(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    month < 1 || month > 12 || day < 1 ||
    date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day
  ) return null
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return IsoDateSchema.safeParse(isoDate).success ? isoDate : null
}

function formatRowErrors(rowErrors: readonly RowError[]): string {
  const lines = rowErrors.slice(0, MAX_ROW_ERRORS_SHOWN).map((error) => `Linha ${error.row}: ${error.message}`)
  const hidden = rowErrors.length - lines.length
  if (hidden > 0) lines.push(`... e mais ${hidden} linha${hidden === 1 ? '' : 's'} com divergências.`)
  return lines.join('\n')
}

export type ImportVaziosArgs = { filename: string; voyageId: number; port: string; manifest: ParsedVaziosManifest; uploadedBy: string; description?: string }

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
