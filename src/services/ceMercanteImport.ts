import { assertUploadFile } from '../lib/fileGuard'
import { asString, chunkArray, onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
import type { CeMercanteEdiRow } from './ceMercanteEdiParser'
import { matchHeaders, readSheet, type HeaderSpec, type SheetRow } from './importCore'

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

type ImportedBlManifestoRow = {
  id: string
  voyage_id: number
  pol: string | null
  pod: string | null
  manifesto_mercante_id: string | null
}

type ManifestoMercanteRow = {
  id: string
  voyage_id: number
  pol: string
  pod: string
  numero: string
  natureza: string
}

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

export async function partitionRowsByVoyage<T extends { bl_id: string; rowNumber?: number; lineNumber?: number }>(
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
      row: row.rowNumber ?? row.lineNumber ?? 0,
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

  let overwritten = 0
  let unchanged = 0
  let inserted = 0
  const successfulBlIds: string[] = []

  for (const row of validRows) {
    const { data, error } = target === 'granite'
      ? await supabase.rpc('apply_granite_ce_mercante_update', {
          p_bl_id: resolvedIds.get(row.bl_id) ?? row.bl_id,
          p_new_ce: row.ce_mercante,
          p_changed_by: options.changedBy,
        })
      : await supabase.rpc('apply_ce_mercante_update', {
        p_bl_id: row.bl_id,
        p_new_ce: row.ce_mercante,
        p_changed_by: options.changedBy,
      })

    if (error) {
      errors.push({
        row: row.rowNumber,
        bl_id: row.bl_id,
        message: error.message || `Falha ao aplicar CE Mercante no BL ${row.bl_id}.`,
      })
      continue
    }

    switch (data) {
      case 'overwritten':
        overwritten += 1
        break
      case 'unchanged':
        unchanged += 1
        break
      default:
        inserted += 1
        break
    }
    if (target === 'bls') successfulBlIds.push(row.bl_id)
  }

  if (target === 'bls' && options.manifestoNumero?.trim() && successfulBlIds.length > 0) {
    try {
      await linkImportedBlsToManifestoMercante(successfulBlIds, options.manifestoNumero, options.voyageId)
    } catch (error) {
      errors.push({
        row: validRows[0]?.rowNumber ?? rows[0]?.rowNumber ?? 0,
        bl_id: successfulBlIds[0],
        message: error instanceof Error ? error.message : 'Falha ao vincular o manifesto Mercante aos B/Ls importados.',
      })
    }
  }

  return {
    processed: rows.length,
    updated: inserted + overwritten,
    overwritten,
    unchanged,
    errorCount: errors.length,
    errors,
  }
}

export type CeMercanteEdiImportResult =
  | {
      ok: true
      batchId: number
      processed: number
      inserted: number
      overwritten: number
      unchanged: number
    }
  | {
      ok: false
      partial?: boolean
      errors: Array<{ bl_id?: string; ce?: string; message: string }>
    }

// Importa o vinculo CE <-> BL a partir do arquivo EDI do manifesto. Toda a
// validacao quantitativa (cobertura do batch) e qualitativa (CE/BL unicos,
// existencia) e feita dentro da RPC transacional: ou grava tudo, ou nada.
export async function importCeMercanteEdi(
  rows: CeMercanteEdiRow[],
  options: { changedBy: string | null; manifestoNumero?: string; voyageId?: number } = { changedBy: null },
): Promise<CeMercanteEdiImportResult> {
  const payload = rows.map((row) => ({ bl_id: row.bl_id, ce: row.ce_mercante }))

  const { data, error } = await supabase.rpc('apply_ce_mercante_manifest', {
    p_rows: payload,
    p_changed_by: options.changedBy,
  })

  if (error) throw error

  const result = data as {
    ok?: boolean
    batch_id?: number
    processed?: number
    inserted?: number
    overwritten?: number
    unchanged?: number
    errors?: Array<{ bl_id?: string; ce?: string; message: string }>
  } | null

  if (result?.ok) {
    if (options.manifestoNumero?.trim()) {
      try {
        await linkImportedBlsToManifestoMercante(
          rows.map((row) => row.bl_id),
          options.manifestoNumero,
          options.voyageId,
        )
      } catch (linkError) {
        return {
          ok: false,
          partial: true,
          errors: [{
            message: linkError instanceof Error
              ? linkError.message
              : 'CE Mercante gravado, mas não foi possível vincular o manifesto aos B/Ls.',
          }],
        }
      }
    }
    return {
      ok: true,
      batchId: Number(result.batch_id ?? 0),
      processed: Number(result.processed ?? 0),
      inserted: Number(result.inserted ?? 0),
      overwritten: Number(result.overwritten ?? 0),
      unchanged: Number(result.unchanged ?? 0),
    }
  }

  return {
    ok: false,
    errors: result?.errors ?? [{ message: 'Falha ao validar o manifesto de CE Mercante.' }],
  }
}

async function linkImportedBlsToManifestoMercante(
  blIds: string[],
  rawNumero: string,
  voyageId?: number,
): Promise<void> {
  const numero = rawNumero.trim()
  const uniqueBlIds = Array.from(new Set(blIds.map(normalizeBlId).filter(Boolean)))
  if (!numero || uniqueBlIds.length === 0) return

  const { data: blRows, error: blError } = await supabase
    .from('bls')
    .select('id, voyage_id, pol, pod, manifesto_mercante_id')
    .in('id', uniqueBlIds)

  if (blError) throw blError

  const importedBls = (blRows ?? []) as ImportedBlManifestoRow[]
  if (importedBls.length !== uniqueBlIds.length) {
    throw new Error('Não foi possível localizar todos os B/Ls importados para vincular o manifesto Mercante.')
  }

  const firstBl = importedBls[0]
  if (!firstBl) return
  const routeVoyageId = firstBl.voyage_id
  const routePol = normalizeRoute(firstBl.pol)
  const routePod = normalizeRoute(firstBl.pod)

  if (!routePol || !routePod) {
    throw new Error(`O B/L ${firstBl.id} não possui POL e POD para cadastrar o manifesto Mercante.`)
  }
  if (voyageId != null && routeVoyageId !== voyageId) {
    throw new Error(`O manifesto Mercante informado não pertence à viagem dos B/Ls importados.`)
  }
  if (importedBls.some((bl) => bl.voyage_id !== routeVoyageId || normalizeRoute(bl.pol) !== routePol || normalizeRoute(bl.pod) !== routePod)) {
    throw new Error('Os B/Ls importados precisam pertencer à mesma viagem e à mesma rota para compartilhar um manifesto Mercante.')
  }

  const { data: existing, error: existingError } = await findManifestoMercanteByNumero(numero)
  if (existingError) throw existingError

  const conflictingBl = importedBls.find(
    (bl) => bl.manifesto_mercante_id != null && bl.manifesto_mercante_id !== existing?.id,
  )
  if (conflictingBl) {
    throw new Error(`O B/L ${conflictingBl.id} já está vinculado a outro manifesto Mercante.`)
  }

  let manifesto = existing
  if (!manifesto) {
    const { data: created, error: createError } = await supabase
      .from('manifestos_mercante')
      .insert({
        voyage_id: routeVoyageId,
        pol: firstBl.pol?.trim() ?? '',
        pod: firstBl.pod?.trim() ?? '',
        numero,
        natureza: 'carga',
      })
      .select('*')
      .single()

    if (createError && createError.code !== '23505') throw createError
    if (createError) {
      const { data: raced, error: racedError } = await findManifestoMercanteByNumero(numero)
      if (racedError) throw racedError
      manifesto = raced
    } else {
      manifesto = created as ManifestoMercanteRow
    }
  }

  if (!manifesto) {
    throw new Error(`Não foi possível localizar ou criar o manifesto Mercante "${numero}".`)
  }
  if (
    manifesto.voyage_id !== routeVoyageId ||
    normalizeRoute(manifesto.pol) !== routePol ||
    normalizeRoute(manifesto.pod) !== routePod ||
    manifesto.natureza !== 'carga'
  ) {
    throw new Error(`O número de manifesto Mercante "${numero}" já está associado a outra viagem, rota ou natureza.`)
  }

  const { error: linkError } = await supabase
    .from('bls')
    .update({ manifesto_mercante_id: manifesto.id })
    .in('id', uniqueBlIds)
  if (linkError) throw linkError
}

async function findManifestoMercanteByNumero(
  numero: string,
): Promise<{ data: ManifestoMercanteRow | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await supabase
    .from('manifestos_mercante')
    .select('*')
    .eq('numero', numero)
    .maybeSingle()

  return {
    data: data as ManifestoMercanteRow | null,
    error: error ? { code: error.code, message: error.message } : null,
  }
}

function normalizeRoute(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? ''
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
        message: `CE Mercante invalido para o BL ${bl_id}: esperado ${CE_MERCANTE_LENGTH} digitos, recebido ${ce_mercante.length}.`,
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
