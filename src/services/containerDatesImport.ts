import { importDateOrNull } from '../lib/importDate'
import { assertUploadFile } from '../lib/fileGuard'
import { classifyDbError } from '../lib/errors'
import { asString } from '../lib/utils'
import { matchHeaders, readSheet, type HeaderSpec, type SheetRow } from './importCore'
import { supabase } from './supabase'

const headerMap = {
  bl_id: ['bl', 'b/l', 'bill of lading'],
  container_number: ['container', 'container number', 'numero do container'],
  discharge_date: ['discharge', 'descarga', 'data descarga', 'data de descarga'],
  return_date: ['return', 'devolucao', 'retorno', 'data devolucao', 'data de devolucao'],
} as const

type DestinationField = keyof typeof headerMap
const SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  required: ['bl_id', 'container_number', 'discharge_date'],
}

/**
 * Teto de B/Ls por planilha de datas: a tela recusa o arquivo na leitura, e a
 * RPC (`apply_container_dates_batch_atomic`, migration 333) recusa acima disso
 * com 22023.
 * ponytail: a RPC grava a planilha inteira numa transação com
 * `statement_timeout = 60s`, e o custo de cada B/L cresce com o tamanho da
 * Viagem (a RPC por B/L trabalha sobre a Viagem a cada chamada). Medido em
 * 20/10/2026 no PG local: uns 25–30 µs por B/L do arquivo × container da
 * Viagem — 300 B/Ls numa Viagem de 900 containers 6,8 s, de 3.000 containers
 * 19 s; 700 B/Ls / 2.100 containers 39 s. Com 300 B/Ls cabe em 60 s até
 * Viagens de uns 6.000 containers; acima disso a chamada é cancelada (57014) e
 * nada é gravado. Upgrade: fazer o trabalho por Viagem uma vez no fim do
 * arquivo em vez de a cada B/L, ou preparo em etapas numa tabela de staging com
 * publicação numa RPC final.
 */
export const MAX_CONTAINER_DATES_BLS = 300

const TOO_LARGE_MESSAGE = 'a planilha é grande demais para gravar de uma vez. Divida os B/Ls em planilhas menores e importe cada uma.'

function assertWithinBlCap(rows: Array<{ bl_id: string }>) {
  const bls = new Set(rows.map((row) => row.bl_id)).size
  if (bls > MAX_CONTAINER_DATES_BLS) {
    throw new Error(`A planilha tem ${bls} B/Ls; o limite é ${MAX_CONTAINER_DATES_BLS} por arquivo. Divida em planilhas menores e importe cada uma.`)
  }
}

export type ContainerDatesImportRow = {
  bl_id: string
  container_number: string
  discharge_date: string
  return_date: string | null
  /** Linha da planilha; a prévia usa para apontar a recusa. */
  row_number?: number
  before_discharge?: string | null
  before_return?: string | null
  after_return?: string | null
}

export type ParsedContainerDatesImport = {
  rows: ContainerDatesImportRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseContainerDatesFile(file: File): Promise<ParsedContainerDatesImport> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  // O leitor comum entrega texto do CSV como está e a célula de data do Excel
  // como data civil AAAA-MM-DD (ADR 0078, item 22).
  const { headers, rows } = await readSheet(buffer, {
    expectedHeaders: Object.values(headerMap).flat(),
  })
  const { missing } = matchHeaders(headers, SPEC)
  if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(', ')}.`)
  return parseRows(rows)
}

/**
 * Leitura com prévia: o arquivo, o estado gravado de cada container ("antes →
 * depois"), o container que não está no B/L e a recusa do mesmo container com
 * datas diferentes na Viagem. Qualquer erro recusa o arquivo inteiro (regra de
 * 2026-10-19): a tela não deixa importar com `rowErrors`.
 */
export async function readContainerDatesFile(file: File): Promise<ParsedContainerDatesImport> {
  const parsed = await parseContainerDatesFile(file)
  assertWithinBlCap(parsed.rows)
  const preview = annotateContainerDates(parsed.rows, await fetchContainerDatesCurrent(parsed.rows))
  const notFound = preview.rows.filter((row) => !row.found)
  return {
    rows: preview.rows.filter((row) => row.found),
    rowErrors: [
      ...parsed.rowErrors,
      ...notFound.map((row) => ({ row: row.row_number ?? 0, message: `${row.bl_id} / ${row.container_number}: container não encontrado neste B/L.`, raw: row })),
      ...preview.conflicts.map((conflict) => ({ row: conflict.row_number ?? 0, message: `${conflict.bl_id} / ${conflict.container_number}: ${conflict.message}`, raw: conflict })),
    ].sort((left, right) => left.row - right.row),
  }
}

export type ContainerDatesImportError = { bl_id: string; container_number: string; message: string }

/**
 * Resultado da gravação. `ok: false` quer dizer que o banco recusou algum B/L
 * e NADA foi gravado (regra de 2026-10-19; migration 333): `errors` lista o
 * que foi recusado.
 */
export type ContainerDatesImportResult = {
  ok: boolean
  updated: number
  unchanged: number
  errors: ContainerDatesImportError[]
}

/**
 * Linha da prévia (`annotateContainerDates`): `before_*` é o estado gravado que
 * a pessoa viu e vira o estado esperado da RPC, que recusa a gravação se outra
 * sessão mudou o container depois da prévia. Sem a prévia, vale a leitura
 * feita aqui.
 */
type ImportableContainerDatesRow = ContainerDatesImportRow
  & Partial<Pick<AnnotatedContainerDatesRow, 'found' | 'before_discharge' | 'before_return'>>

/**
 * Grava a planilha inteira numa chamada (`apply_container_dates_batch_atomic`,
 * migration 333): se o banco recusa qualquer B/L, nenhum é gravado.
 */
export async function importContainerDates(rows: ImportableContainerDatesRow[]): Promise<ContainerDatesImportResult> {
  if (!rows.length) return { ok: true, updated: 0, unchanged: 0, errors: [] }
  assertWithinBlCap(rows)

  const blIds = Array.from(new Set(rows.map((r) => r.bl_id)))

  const { data: containers, error: fetchError } = await supabase
    .from('bl_containers')
    .select('id, bl_id, container_number, discharge_date, return_date, demurrage_status')
    .in('bl_id', blIds)

  if (fetchError) throw fetchError

  type ContainerRow = { id: number; bl_id: string | null; container_number: string; discharge_date: string | null; return_date: string | null; demurrage_status: string | null }
  const containersByKey = new Map<string, ContainerRow>()
  for (const c of (containers as unknown as ContainerRow[]) ?? []) {
    containersByKey.set(makeKey(c.bl_id ?? '', c.container_number), c)
  }

  const uniqueRows = Array.from(new Map(rows.map((r) => [makeKey(r.bl_id, r.container_number), r])).values())

  // Container que não está no B/L recusa o arquivo inteiro antes de chamar o
  // banco (a prévia já o mostra como erro).
  const missing = uniqueRows.filter((row) => !containersByKey.has(makeKey(row.bl_id, row.container_number)))
  if (missing.length) {
    return {
      ok: false,
      updated: 0,
      unchanged: 0,
      errors: missing.map((row) => ({
        bl_id: row.bl_id,
        container_number: row.container_number,
        message: 'Container não encontrado neste B/L.',
      })),
    }
  }

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  const actorId = authData.user?.id ?? null
  if (!actorId) throw new Error('Sessão expirada. Entre novamente antes de importar datas.')

  const rowsByBl = new Map<string, ImportableContainerDatesRow[]>()
  for (const row of uniqueRows) rowsByBl.set(row.bl_id, [...(rowsByBl.get(row.bl_id) ?? []), row])

  const batches = Array.from(rowsByBl, ([blId, rowsForBl]) => ({
    bl_id: blId,
    rows: rowsForBl.map((row) => {
      const current = containersByKey.get(makeKey(row.bl_id, row.container_number))!
      const previewed = row.found === true
      return {
        container_number: row.container_number,
        discharge_date: row.discharge_date,
        return_date: row.return_date,
        expected_discharge_date: previewed ? row.before_discharge ?? null : current.discharge_date,
        expected_return_date: previewed ? row.before_return ?? null : current.return_date,
      }
    }),
  }))

  const { data, error } = await supabase.rpc('apply_container_dates_batch_atomic' as never, {
    p_request_id: crypto.randomUUID(),
    p_batches: batches,
    p_changed_by: actorId,
  } as never)
  if (error) {
    // Tempo esgotado (60 s da RPC): a transação foi desfeita inteira.
    if ((error as { code?: string }).code === '57014') throw new Error(TOO_LARGE_MESSAGE, { cause: error })
    throw error
  }

  const result = (data ?? {}) as { ok?: boolean; updated?: number; unchanged?: number; errors?: Array<{ bl_id?: string; code?: string; message?: string }> }
  if (result.ok === false) {
    // A recusa de negócio do banco (ex.: descarga posterior à devolução
    // gravada) aparece como veio, sem o código; CHECK cru vira texto fixo.
    return {
      ok: false,
      updated: 0,
      unchanged: 0,
      errors: (result.errors ?? []).map((item) => ({
        bl_id: String(item.bl_id ?? ''),
        container_number: '',
        message: classifyDbError({ code: item.code, message: item.message ?? '' }).message,
      })),
    }
  }
  return { ok: true, updated: Number(result.updated ?? 0), unchanged: Number(result.unchanged ?? 0), errors: [] }
}

export type ContainerDatesCurrent = {
  bl_id: string
  container_number: string
  voyage_id: number | null
  discharge_date: string | null
  return_date: string | null
}

export type AnnotatedContainerDatesRow = ContainerDatesImportRow & {
  found: boolean
  before_discharge: string | null
  before_return: string | null
  /** Devolução vazia na planilha mantém a gravada (ADR 0078, item 19). */
  after_return: string | null
  changed: boolean
}

export type ContainerDatesPreview = {
  rows: AnnotatedContainerDatesRow[]
  conflicts: Array<ContainerDatesImportError & { row_number?: number }>
}

/** Estado gravado dos containers das linhas, com a Viagem de cada B/L. */
export async function fetchContainerDatesCurrent(rows: ContainerDatesImportRow[]): Promise<ContainerDatesCurrent[]> {
  const blIds = Array.from(new Set(rows.map((row) => row.bl_id)))
  if (!blIds.length) return []
  const { data, error } = await supabase
    .from('bl_containers')
    .select('bl_id, container_number, discharge_date, return_date, bl:bls(voyage_id)')
    .in('bl_id', blIds)
  if (error) throw error
  type Row = { bl_id: string | null; container_number: string; discharge_date: string | null; return_date: string | null; bl: { voyage_id: number | null } | null }
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    bl_id: String(row.bl_id ?? '').toUpperCase(),
    container_number: String(row.container_number).toUpperCase(),
    voyage_id: row.bl?.voyage_id ?? null,
    discharge_date: row.discharge_date,
    return_date: row.return_date,
  }))
}

/**
 * Prévia "antes → depois" e recusa de datas diferentes para o mesmo container
 * na mesma Viagem (a data vale para todos os B/Ls que o dividem; ADR 0078,
 * item 19). Linhas recusadas saem de `rows` e vão para `conflicts`.
 */
export function annotateContainerDates(rows: ContainerDatesImportRow[], current: ContainerDatesCurrent[]): ContainerDatesPreview {
  const byKey = new Map(current.map((item) => [makeKey(item.bl_id, item.container_number), item]))
  const annotated = rows.map((row): AnnotatedContainerDatesRow => {
    const saved = byKey.get(makeKey(row.bl_id, row.container_number))
    const beforeReturn = saved?.return_date ?? null
    const afterReturn = row.return_date ?? beforeReturn
    return {
      ...row,
      found: Boolean(saved),
      before_discharge: saved?.discharge_date ?? null,
      before_return: beforeReturn,
      after_return: afterReturn,
      changed: !saved || saved.discharge_date !== row.discharge_date || beforeReturn !== afterReturn,
    }
  })

  const groups = new Map<string, AnnotatedContainerDatesRow[]>()
  for (const row of annotated) {
    const voyageId = byKey.get(makeKey(row.bl_id, row.container_number))?.voyage_id
    if (voyageId == null) continue
    const key = `${voyageId}::${row.container_number.toUpperCase()}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const conflicting = new Set<AnnotatedContainerDatesRow>()
  for (const group of groups.values()) {
    const discharges = new Set(group.map((row) => row.discharge_date))
    const returns = new Set(group.map((row) => row.return_date).filter((value): value is string => Boolean(value)))
    if (discharges.size > 1 || returns.size > 1) group.forEach((row) => conflicting.add(row))
  }

  return {
    rows: annotated.filter((row) => !conflicting.has(row)),
    conflicts: annotated.filter((row) => conflicting.has(row)).map((row) => ({
      row_number: row.row_number,
      bl_id: row.bl_id,
      container_number: row.container_number,
      message: 'O mesmo container aparece com datas diferentes nesta Viagem; corrija o arquivo.',
    })),
  }
}

function parseRows(objectRows: SheetRow[]): ParsedContainerDatesImport {
  const rowsByKey = new Map<string, ContainerDatesImportRow>()
  const conflictingKeys = new Set<string>()
  const rowErrors: ParsedContainerDatesImport['rowErrors'] = []

  objectRows.forEach((row) => {
    const mapped = mapRow(row)
    const blId = asString(mapped.bl_id).toUpperCase()
    const containerNumber = asString(mapped.container_number).toUpperCase()
    const rawDischarge = mapped.discharge_date
    const rawReturn = mapped.return_date

    const rowNumber = row.rowNumber
    if (!blId) { rowErrors.push({ row: rowNumber, message: 'Linha sem B/L.', raw: row }); return }
    if (!containerNumber) { rowErrors.push({ row: rowNumber, message: 'Linha sem container.', raw: row }); return }

    const discharge = parseDate(rawDischarge)
    if (!discharge) { rowErrors.push({ row: rowNumber, message: 'Data de descarga inválida ou ausente.', raw: row }); return }

    const returnDate = rawReturn != null && asString(rawReturn) ? parseDate(rawReturn) : null
    if (rawReturn != null && asString(rawReturn) && !returnDate) {
      rowErrors.push({ row: rowNumber, message: 'Data de devolução inválida.', raw: row }); return
    }
    if (returnDate && returnDate < discharge) {
      rowErrors.push({ row: rowNumber, message: 'Data de devolução anterior à descarga.', raw: row }); return
    }

    const parsedRow: ContainerDatesImportRow = { bl_id: blId, container_number: containerNumber, discharge_date: discharge, return_date: returnDate, row_number: rowNumber }
    const key = makeKey(blId, containerNumber)
    const previous = rowsByKey.get(key)
    if (conflictingKeys.has(key)) return
    if (previous) {
      if (previous.discharge_date !== parsedRow.discharge_date || previous.return_date !== parsedRow.return_date) {
        conflictingKeys.add(key)
        rowsByKey.delete(key)
        rowErrors.push({ row: rowNumber, message: 'Duplicata conflitante: o mesmo B/L e container aparecem com datas diferentes.', raw: row })
      }
      return
    }
    rowsByKey.set(key, parsedRow)
  })

  return {
    rows: Array.from(rowsByKey.values()),
    rowErrors,
  }
}

// Data civil única dos imports: AAAA-MM-DD ou DD/MM/AAAA; ano de quatro dígitos.
function parseDate(value: unknown): string | null {
  return importDateOrNull(value)
}


function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  const { columnByField } = matchHeaders(Object.keys(row), SPEC)
  for (const [field, column] of Object.entries(columnByField) as [DestinationField, string][]) {
    mapped[field] = row[column]
  }
  return mapped
}

function makeKey(blId: string, containerNumber: string) {
  return `${String(blId).toUpperCase()}::${String(containerNumber).toUpperCase()}`
}
