import { assertUploadFile } from '../lib/fileGuard'
import { asString, chunkArray, onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
import { matchHeaders, readSheet, type HeaderSpec, type SheetRow } from './importCore'

// Resposta de apply_ce_mercante_rows_atomic (migration 082); o tipo gerado é Json.
type CeRowsAtomicResult = {
  ok: boolean
  inserted?: number
  overwritten?: number
  unchanged?: number
  errors?: Array<{ row?: number; bl_id?: string; message: string }>
}

const headerMap = {
  bl_id: ['bl', 'b/l', 'bill of lading', 'numero bl', 'n bl', 'no bl', 'no. bl'],
  ce_mercante: ['ce mercante', 'ce_mercante', 'ce', 'numero ce mercante', 'ce merc'],
} as const

const requiredHeaders = {
  bl_id: 'BL',
  ce_mercante: 'CE MERCANTE',
} as const

type DestinationField = keyof typeof headerMap
const SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  required: ['bl_id', 'ce_mercante'],
}

export type CeMercanteRow = {
  rowNumber: number
  bl_id: string
  ce_mercante: string
}

export type ParsedCeMercanteFile = {
  rows: CeMercanteRow[]
  rowErrors: Array<{
    row: number
    message: string
    raw: unknown
  }>
}

export type CeMercanteImportResult = {
  processed: number
  updated: number
  overwritten: number
  unchanged: number
  errorCount: number
  errors: Array<{
    row: number
    message: string
    bl_id?: string
  }>
}

export type CeMercanteImportTarget = 'bls' | 'granite'

type GraniteResolution = { id: string; bl_number: string; voyage_id: number | null }

async function resolveGraniteBlNumbers(numbers: string[], voyageId?: number): Promise<Map<string, GraniteResolution[]>> {
  const matches = new Map<string, GraniteResolution[]>()
  for (const chunk of chunkArray(Array.from(new Set(numbers.map(normalizeBlId))), 400)) {
    const query = supabase
      .from('granite_bls')
      .select('id, bl_number, manifest:granite_manifests!inner(voyage_id)')
      .in('bl_number', chunk)
    const { data, error } = await query
    if (error) throw error
    for (const row of data ?? []) {
      const item = row as { id: string; bl_number: string; manifest?: { voyage_id?: number | null } | null }
      const itemVoyageId = item.manifest?.voyage_id ?? null
      if (voyageId != null && itemVoyageId !== voyageId) continue
      const key = normalizeBlId(item.bl_number)
      const current = matches.get(key) ?? []
      current.push({ id: item.id, bl_number: item.bl_number, voyage_id: itemVoyageId })
      matches.set(key, current)
    }
  }
  return matches
}

export async function partitionRowsByVoyage<T extends { bl_id: string; rowNumber: number }>(
  rows: T[],
  voyageId: number,
  target: CeMercanteImportTarget = 'bls',
): Promise<{ rows: T[]; blocked: Array<{ row: number; bl_id: string; message: string }> }> {
  const voyageByBl = new Map<string, number | null>()
  for (const chunk of chunkArray(Array.from(new Set(rows.map((row) => row.bl_id))), 400)) {
    const query = target === 'granite'
      ? supabase.from('granite_bls').select('id, bl_number, manifest:granite_manifests!inner(voyage_id)').in('bl_number', chunk)
      : supabase.from('bls').select('id, voyage_id').in('id', chunk)
    const { data, error } = await query
    if (error) throw error
    for (const bl of data ?? []) {
      const voyage = target === 'granite'
        ? (bl as { manifest?: { voyage_id?: number | null } | null }).manifest?.voyage_id ?? null
        : (bl as { voyage_id?: number | null }).voyage_id ?? null
      voyageByBl.set(target === 'granite' ? normalizeBlId((bl as { bl_number: string }).bl_number) : String(bl.id), voyage)
    }
  }

  const blocked: Array<{ row: number; bl_id: string; message: string }> = []
  const validRows = rows.filter((row) => {
    const rowVoyageId = voyageByBl.get(target === 'granite' ? normalizeBlId(row.bl_id) : row.bl_id)
    if (rowVoyageId === undefined || rowVoyageId === voyageId) return true
    blocked.push({
      row: row.rowNumber,
      bl_id: row.bl_id,
      message: `B/L ${row.bl_id} pertence a outra viagem`,
    })
    return false
  })
  return { rows: validRows, blocked }
}

const CE_MERCANTE_LENGTH = 15

export async function parseCeMercanteFile(file: File): Promise<ParsedCeMercanteFile> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseCeMercanteBuffer(buffer)
}

export async function parseCeMercanteBuffer(buffer: ArrayBuffer): Promise<ParsedCeMercanteFile> {
  const { headers, rows } = await readSheet(buffer)
  validateRequiredHeaders(headers)
  return parseRows(rows)
}

export async function importCeMercanteRows(
  rows: CeMercanteRow[],
  options: {
    changedBy: string | null
    target?: CeMercanteImportTarget
    voyageId?: number
    manifestoNumero?: string
  } = { changedBy: null },
): Promise<CeMercanteImportResult> {
  const target = options.target ?? 'bls'
  const errors: CeMercanteImportResult['errors'] = []
  const manifestoNumero = options.manifestoNumero?.trim() ?? ''
  // Cada importação de B/L é um manifesto: sem o número, nada é gravado.
  if (target === 'bls' && !manifestoNumero) {
    return {
      processed: rows.length, updated: 0, overwritten: 0, unchanged: 0, errorCount: 1,
      errors: [{ row: rows[0]?.rowNumber ?? 0, message: 'Informe o número do Manifesto Mercante deste lote antes de importar.' }],
    }
  }
  const resolvedIds = new Map<string, string>()
  const existingBlIds = new Set<string>()
  const uniqueBlIds = Array.from(new Set(rows.map((row) => row.bl_id)))
  if (target === 'granite') {
    const matches = await resolveGraniteBlNumbers(uniqueBlIds, options.voyageId)
    for (const row of rows) {
      const found = matches.get(normalizeBlId(row.bl_id)) ?? []
      if (found.length === 1) {
        resolvedIds.set(row.bl_id, found[0].id)
        existingBlIds.add(row.bl_id)
      } else if (found.length === 0) {
        errors.push({ row: row.rowNumber, bl_id: row.bl_id, message: `B/L ${row.bl_id} nao encontrado no manifesto de granito.` })
      } else {
        errors.push({ row: row.rowNumber, bl_id: row.bl_id, message: `B/L ${row.bl_id} ambiguo: mais de um B/L no manifesto de granito.` })
      }
    }
  } else {
    for (const chunk of chunkArray(uniqueBlIds, 400)) {
      const { data, error } = await supabase.from('bls').select('id').in('id', chunk)
      if (error) throw error
      for (const row of data ?? []) existingBlIds.add(String(row.id))
    }
  }

  const validRows = rows.filter((row) => {
    if (!existingBlIds.has(row.bl_id)) {
      if (target === 'granite' && errors.some((error) => error.row === row.rowNumber && error.bl_id === row.bl_id)) return false
      errors.push({
        row: row.rowNumber,
        bl_id: row.bl_id,
        message: `BL ${row.bl_id} nao encontrado no sistema.`,
      })
      return false
    }

    return true
  })

  // "Tudo ou nada" (migration 082, decisão de 2026-09-23): qualquer erro de
  // pré-validação impede a gravação do lote inteiro, e a RPC desfaz tudo se
  // alguma linha falhar no banco.
  if (errors.length > 0) {
    return { processed: rows.length, updated: 0, overwritten: 0, unchanged: 0, errorCount: errors.length, errors }
  }

  const { data: rawResult, error } = await supabase.rpc('apply_ce_mercante_rows_atomic', {
    p_rows: validRows.map((row) => ({
      row: row.rowNumber,
      bl_id: target === 'granite' ? resolvedIds.get(row.bl_id) ?? row.bl_id : row.bl_id,
      ce: row.ce_mercante,
    })),
    p_changed_by: options.changedBy,
    p_target: target,
    // Migration 164: viagem, rota e manifesto são validados e vinculados na
    // mesma transação dos CEs.
    ...(target === 'bls' ? { p_manifesto_numero: manifestoNumero, p_voyage_id: options.voyageId ?? null } : {}),
  })
  if (error) throw error
  const data = rawResult as unknown as CeRowsAtomicResult | null
  if (!data?.ok) {
    const rowErrors = (data?.errors ?? []).map((item) => ({
      row: Number(item.row ?? 0),
      bl_id: item.bl_id ?? '',
      message: item.message || 'Falha ao aplicar CE Mercante.',
    }))
    return { processed: rows.length, updated: 0, overwritten: 0, unchanged: 0, errorCount: rowErrors.length, errors: rowErrors }
  }
  const inserted = data.inserted ?? 0
  const overwritten = data.overwritten ?? 0
  const unchanged = data.unchanged ?? 0
  return {
    processed: rows.length,
    updated: inserted + overwritten,
    overwritten,
    unchanged,
    errorCount: errors.length,
    errors,
  }
}

function parseRows(rows: SheetRow[]): ParsedCeMercanteFile {
  const rowErrors: ParsedCeMercanteFile['rowErrors'] = []
  const validRows: CeMercanteRow[] = []
  const seenBls = new Set<string>()

  rows.forEach((row) => {
    const mapped = mapRow(row)
    const rowNumber = row.rowNumber
    const bl_id = normalizeBlId(mapped.bl_id)
    const ce_mercante = normalizeCeMercante(mapped.ce_mercante)

    if (!bl_id || !ce_mercante) {
      rowErrors.push({
        row: rowNumber,
        message: 'Colunas obrigatorias ausentes ou invalidas.',
        raw: row,
      })
      return
    }

    // F-11: o CE Mercante brasileiro tem 15 digitos. Valores menores sao
    // tipicamente erros de digitacao / importacao de celulas truncadas.
    if (ce_mercante.length !== CE_MERCANTE_LENGTH) {
      rowErrors.push({
        row: rowNumber,
        // Célula numérica perde zeros à esquerda e casas além da precisão: a
        // causa vai na mensagem para o operador formatar a coluna como texto.
        message: typeof mapped.ce_mercante === 'number'
          ? `CE Mercante invalido para o BL ${bl_id}: a célula é numérica e ficou com ${ce_mercante.length} digitos. Formate a coluna CE como texto e digite os ${CE_MERCANTE_LENGTH} digitos.`
          : `CE Mercante invalido para o BL ${bl_id}: esperado ${CE_MERCANTE_LENGTH} digitos, recebido ${ce_mercante.length}.`,
        raw: row,
      })
      return
    }

    if (seenBls.has(bl_id)) {
      rowErrors.push({
        row: rowNumber,
        message: `BL ${bl_id} repetido na planilha de CE Mercante.`,
        raw: row,
      })
      return
    }

    seenBls.add(bl_id)
    validRows.push({
      rowNumber,
      bl_id,
      ce_mercante,
    })
  })

  return {
    rows: validRows,
    rowErrors,
  }
}

function validateRequiredHeaders(rawHeaders: string[]) {
  const { missing: missingFields } = matchHeaders(rawHeaders, SPEC)
  const missing = missingFields.map((field) => requiredHeaders[field])

  if (missing.length) {
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${missing.join(', ')}.`)
  }
}

function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  const { columnByField } = matchHeaders(Object.keys(row), SPEC)
  for (const [field, column] of Object.entries(columnByField) as [DestinationField, string][]) mapped[field] = row[column]
  return mapped
}

function normalizeBlId(value: unknown) {
  return asString(value).trim().toUpperCase()
}

function normalizeCeMercante(value: unknown) {
  const digits = onlyDigits(asString(value))
  return digits || ''
}
