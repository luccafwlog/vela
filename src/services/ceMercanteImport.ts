import { toError } from '../lib/errors'
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
  ignored?: number
  needs_confirmation?: boolean
  warnings?: Array<{ row?: number; bl_id?: string; message: string }>
  errors?: Array<{ row?: number; bl_id?: string; message: string }>
  billing_pending_bl_ids?: string[]
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
  /** `row` 0 é erro do lote, sem linha (a tela não mostra "Linha 0"). */
  errors: Array<{
    row: number
    message: string
    bl_id?: string
  }>
  ignored?: number
  warnings?: Array<{ row: number; message: string; bl_id?: string }>
  /** A troca de CE ou de Manifesto precisa de confirmação com motivo. */
  needsConfirmation?: boolean
  /** B/Ls gravados que a tela emite em lotes (`emitCeMercanteBilling`). */
  billingPendingBlIds?: string[]
}

export type CePreviewRow = {
  row: number
  bl_id: string
  status: 'new' | 'same' | 'change' | 'cancelled'
  current_ce?: string | null
  new_ce?: string
  current_manifesto?: string | null
  target_manifesto?: string | null
  manifesto_change?: boolean
  live_invoices?: string[]
  portal_visible?: boolean
  comunicado_sent?: boolean
  unlock_confirmed?: boolean
}

export type CeServerPreview = {
  rows: CePreviewRow[]
  errors: Array<{ row?: number; bl_id?: string; message: string }>
  warnings: Array<{ row?: number; bl_id?: string; message: string }>
  changes: number
  moves: number
  needs_confirmation: boolean
  manifesto: { numero: string | null; exists: boolean }
}

/**
 * Prévia no servidor (migration 180): estado de cada B/L antes → depois,
 * faturas, Portal, Comunicado, Desbloqueio e Manifesto. Não grava nada.
 */
export async function previewCeMercanteRows(
  rows: CeMercanteRow[],
  options: { manifestoNumero: string; voyageId?: number },
): Promise<CeServerPreview> {
  const { data, error } = await supabase.rpc('preview_ce_mercante_rows' as never, {
    p_rows: rows.map((row) => ({ row: row.rowNumber, bl_id: row.bl_id, ce: row.ce_mercante })),
    p_manifesto_numero: options.manifestoNumero,
    p_voyage_id: options.voyageId ?? null,
  } as never)
  if (error) throw error
  return data as unknown as CeServerPreview
}

export type CeBillingResult = {
  bl_id: string
  status: 'invoiced' | 'held' | 'blocked' | 'skipped'
  reason?: string | null
  message?: string | null
  invoice_number?: string | null
}

export const CE_BILLING_BATCH_SIZE = 25

/**
 * Emissão logo depois da gravação do CE, em lotes conduzidos pela tela (ADR
 * 0078, item 9). Cada lote é uma transação; o que falhar pode ser retomado
 * com os B/Ls que faltam. O efeito `local_billing` é a rede.
 */
export async function emitCeMercanteBilling(
  blIds: string[],
  onProgress?: (done: number, total: number, results: CeBillingResult[]) => void,
): Promise<CeBillingResult[]> {
  const results: CeBillingResult[] = []
  const chunks = chunkArray(blIds, CE_BILLING_BATCH_SIZE)
  for (const chunk of chunks) {
    const { data, error } = await supabase.rpc('emit_ce_mercante_billing' as never, { p_bl_ids: chunk } as never)
    if (error) throw Object.assign(toError(error), { done: results })
    results.push(...(((data as unknown as { results?: CeBillingResult[] } | null)?.results) ?? []))
    onProgress?.(results.length, blIds.length, results)
  }
  return results
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
  const { headers, rows } = await readSheet(buffer, { singleDataSheet: true })
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
    /** Confirma a troca de CE já gravado e a mudança de Manifesto (com motivo). */
    confirmChanges?: boolean
    reason?: string
    /** Grava CE e cálculo e devolve os B/Ls para `emitCeMercanteBilling`. */
    deferBilling?: boolean
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

  const payload = {
    p_rows: validRows.map((row) => ({
      row: row.rowNumber,
      bl_id: target === 'granite' ? resolvedIds.get(row.bl_id) ?? row.bl_id : row.bl_id,
      ce: row.ce_mercante,
    })),
    p_changed_by: options.changedBy,
    p_target: target,
    // Migration 164/180: viagem, rota e manifesto são validados e vinculados
    // na mesma transação dos CEs; troca de CE ou de Manifesto pede confirmação.
    ...(target === 'bls'
      ? {
          p_manifesto_numero: manifestoNumero,
          p_voyage_id: options.voyageId ?? null,
          p_confirm_changes: options.confirmChanges ?? false,
          p_reason: options.reason?.trim() || null,
          p_defer_billing: options.deferBilling ?? false,
        }
      : {}),
  }
  let response = await supabase.rpc('apply_ce_mercante_rows_atomic', payload as never)
  // Deadlock com outra gravação: uma nova tentativa (ADR 0078, item 9).
  if (response.error && (response.error as { code?: string }).code === '40P01') {
    response = await supabase.rpc('apply_ce_mercante_rows_atomic', payload as never)
  }
  const { data: rawResult, error } = response
  if (error) throw error
  const data = rawResult as unknown as CeRowsAtomicResult | null
  const warnings = (data?.warnings ?? []).map((item) => ({ row: Number(item.row ?? 0), bl_id: item.bl_id ?? '', message: item.message }))
  if (!data?.ok) {
    const rowErrors = (data?.errors ?? []).map((item) => ({
      row: Number(item.row ?? 0),
      bl_id: item.bl_id ?? '',
      message: item.message || 'Falha ao aplicar CE Mercante.',
    }))
    return {
      processed: rows.length, updated: 0, overwritten: 0, unchanged: 0, errorCount: rowErrors.length, errors: rowErrors,
      warnings, needsConfirmation: Boolean(data?.needs_confirmation),
    }
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
    ignored: data.ignored ?? 0,
    warnings,
    billingPendingBlIds: data.billing_pending_bl_ids ?? [],
  }
}

function parseRows(rows: SheetRow[]): ParsedCeMercanteFile {
  const rowErrors: ParsedCeMercanteFile['rowErrors'] = []
  const validRows: CeMercanteRow[] = []
  const seenBls = new Set<string>()
  // Um CE só pode estar em um B/L não cancelado (ADR 0078, item 3): repetido
  // no arquivo é erro de linha e bloqueia a confirmação.
  const seenCes = new Map<string, { row: number; blId: string }>()

  rows.forEach((row) => {
    const mapped = mapRow(row)
    const rowNumber = row.rowNumber
    const bl_id = normalizeBlId(mapped.bl_id)
    const ce_mercante = normalizeCeMercante(mapped.ce_mercante)

    if (!bl_id) {
      rowErrors.push({ row: rowNumber, message: 'Linha sem B/L.', raw: row })
      return
    }
    // Linha sem CE é erro e bloqueia a importação (ADR 0078, item 9).
    if (!ce_mercante) {
      rowErrors.push({ row: rowNumber, message: `Linha sem CE Mercante para o BL ${bl_id}.`, raw: row })
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

    const firstCe = seenCes.get(ce_mercante)
    if (firstCe) {
      rowErrors.push({
        row: rowNumber,
        message: `CE Mercante ${ce_mercante} repetido na planilha: já está na linha ${firstCe.row} (BL ${firstCe.blId}). Um CE só pode estar em um B/L.`,
        raw: row,
      })
      return
    }

    seenBls.add(bl_id)
    seenCes.set(ce_mercante, { row: rowNumber, blId: bl_id })
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
