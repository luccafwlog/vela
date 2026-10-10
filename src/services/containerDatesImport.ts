import { importDateOrNull } from '../lib/importDate'
import { assertUploadFile } from '../lib/fileGuard'
import { extractErrorText } from '../lib/errors'
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

export type ContainerDatesImportRow = {
  bl_id: string
  container_number: string
  discharge_date: string
  return_date: string | null
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
  if (missing.length) throw new Error(`Colunas obrigatorias ausentes: ${missing.join(', ')}.`)
  return parseRows(rows)
}

export type ContainerDatesImportError = { bl_id: string; container_number: string; message: string }

export type ContainerDatesImportResult = {
  updated: number
  unchanged: number
  missing: number
  errors: ContainerDatesImportError[]
}

export async function importContainerDates(rows: ContainerDatesImportRow[]): Promise<ContainerDatesImportResult> {
  if (!rows.length) return { updated: 0, unchanged: 0, missing: 0, errors: [] }

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

  let updated = 0
  let unchanged = 0
  let missing = 0
  const errors: ContainerDatesImportError[] = []

  const uniqueRows = Array.from(new Map(rows.map((r) => [makeKey(r.bl_id, r.container_number), r])).values())

  // O RPC aplica cada B/L inteiro como unidade; um erro não deixa linhas
  // parcialmente gravadas e o lote continua com os demais B/Ls.
  const blsWithFailedUpdates = new Set<string>()
  const rowsByBl = new Map<string, ContainerDatesImportRow[]>()
  for (const row of uniqueRows) {
    if (!containersByKey.has(makeKey(row.bl_id, row.container_number))) {
      missing += 1
      blsWithFailedUpdates.add(row.bl_id)
      errors.push({
        bl_id: row.bl_id,
        container_number: row.container_number,
        message: `Container nao encontrado; o B/L foi ignorado para preservar a atomicidade.`,
      })
      continue
    }
    const rowsForBl = rowsByBl.get(row.bl_id) ?? []
    rowsForBl.push(row)
    rowsByBl.set(row.bl_id, rowsForBl)
  }

  let actorId: string | null = null
  if (rowsByBl.size > 0) {
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    actorId = authData.user?.id ?? null
    if (!actorId) throw new Error('Sessao expirada. Entre novamente antes de importar datas.')
  }

  for (const [blId, rowsForBl] of rowsByBl) {
    if (blsWithFailedUpdates.has(blId)) continue

    const payload = rowsForBl.map((row) => {
      const current = containersByKey.get(makeKey(row.bl_id, row.container_number))!
      return {
        container_number: row.container_number,
        discharge_date: row.discharge_date,
        return_date: row.return_date,
        expected_discharge_date: current.discharge_date,
        expected_return_date: current.return_date,
      }
    })

    const { data: applied, error: applyError } = await supabase.rpc('apply_container_dates_atomic', {
      p_request_id: crypto.randomUUID(),
      p_bl_id: blId,
      p_rows: payload,
      p_changed_by: actorId!,
    })

    if (applyError) {
      const message = extractErrorText(applyError)
      rowsForBl.forEach((row) => errors.push({ bl_id: row.bl_id, container_number: row.container_number, message }))
      blsWithFailedUpdates.add(blId)
      continue
    }

    const result = (applied ?? {}) as { updated_ids?: unknown[]; unchanged_ids?: unknown[]; billing_state?: string }
    updated += Array.isArray(result.updated_ids) ? result.updated_ids.length : 0
    unchanged += Array.isArray(result.unchanged_ids) ? result.unchanged_ids.length : 0
  }

  return { updated, unchanged, missing, errors }
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
    if (!blId) { rowErrors.push({ row: rowNumber, message: 'Linha sem BL.', raw: row }); return }
    if (!containerNumber) { rowErrors.push({ row: rowNumber, message: 'Linha sem Container.', raw: row }); return }

    const discharge = parseDate(rawDischarge)
    if (!discharge) { rowErrors.push({ row: rowNumber, message: 'Data de descarga invalida ou ausente.', raw: row }); return }

    const returnDate = rawReturn != null && asString(rawReturn) ? parseDate(rawReturn) : null
    if (rawReturn != null && asString(rawReturn) && !returnDate) {
      rowErrors.push({ row: rowNumber, message: 'Data de devolucao invalida.', raw: row }); return
    }
    if (returnDate && returnDate < discharge) {
      rowErrors.push({ row: rowNumber, message: 'Data de devolucao anterior a descarga.', raw: row }); return
    }

    const parsedRow = { bl_id: blId, container_number: containerNumber, discharge_date: discharge, return_date: returnDate }
    const key = makeKey(blId, containerNumber)
    const previous = rowsByKey.get(key)
    if (conflictingKeys.has(key)) return
    if (previous) {
      if (previous.discharge_date !== parsedRow.discharge_date || previous.return_date !== parsedRow.return_date) {
        conflictingKeys.add(key)
        rowsByKey.delete(key)
        rowErrors.push({ row: rowNumber, message: 'Duplicata conflitante para o mesmo BL e container.', raw: row })
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
