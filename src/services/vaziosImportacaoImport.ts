import { assertUploadFile } from '../lib/fileGuard'
import { createHeaderMapper, createRowErrorCollector, matchHeaders, readSheet, type HeaderSpec, type RowError } from './importCore'
import { supabase } from './supabase'
import { escapeFilterTerm } from '../lib/utils'
import { parseImportNumber } from '../lib/importNumber'
import { IsoContainerSchema, LocodeSchema } from './importValidation'
import { resolvePortCode } from './portCode'
import type { VaziosImportacaoContainerListItem, VaziosImportacaoManifest } from '../types/database'

const HEADER_MAP: Record<string, string> = {
  'container': 'container_number',
  'conteiner': 'container_number',
  'numeracao': 'container_number',
  'num. container': 'container_number',
  'num container': 'container_number',
  'tipo': 'container_type',
  'type': 'container_type',
  'tara': 'tare_kg',
  'tare': 'tare_kg',
  'tara (kg)': 'tare_kg',
  'tara kg': 'tare_kg',
  'tare (kg)': 'tare_kg',
  'tare kg': 'tare_kg',
  'pol': 'pol',
  'origem': 'pol',
  'porto_origem': 'pol',
  'porto origem': 'pol',
  'port of loading': 'pol',
  'pod': 'pod',
  'destino': 'pod',
  'porto_destino': 'pod',
  'porto destino': 'pod',
  'port of discharge': 'pod',
}

const VAZIOS_IMPORTACAO_HEADER_SPEC: HeaderSpec<'container_number'> = {
  aliases: {
    container_number: ['container', 'conteiner', 'numeracao', 'num. container', 'num container'],
  },
  required: ['container_number'],
}
const VAZIOS_IMPORTACAO_HEADER_LABELS = { container_number: 'Container' } as const
const VAZIOS_IMPORTACAO_HEADER_MARKERS = Object.keys(HEADER_MAP)

type ParsedVaziosImportacaoContainer = {
  rowNumber: number
  container_number: string
  container_type: string | null
  tare_kg: number | null
  pol?: string | null
  pod?: string | null
}

export type ParsedVaziosImportacaoManifest = {
  containers: ParsedVaziosImportacaoContainer[]
  rowErrors: RowError[]
}

export async function parseVaziosImportacaoFile(file: File): Promise<ParsedVaziosImportacaoManifest> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseVaziosImportacaoBuffer(buffer)
}

export async function parseVaziosImportacaoBuffer(buffer: ArrayBuffer): Promise<ParsedVaziosImportacaoManifest> {
  const { headers, rows } = await readSheet(buffer, {
    expectedHeaders: VAZIOS_IMPORTACAO_HEADER_MARKERS,
  })
  const { missing } = matchHeaders(headers, VAZIOS_IMPORTACAO_HEADER_SPEC)
  if (missing.length) {
    const labels = missing.map((field) => VAZIOS_IMPORTACAO_HEADER_LABELS[field])
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${labels.join(', ')}.`)
  }
  const mapRow = createHeaderMapper(rows[0], HEADER_MAP)

  const containers: ParsedVaziosImportacaoContainer[] = []
  const rowErrors = createRowErrorCollector()

  rows.forEach((row) => {
    const rowNumber = row.rowNumber
    const mapped = mapRow(row)

    const containerNumber = String(mapped['container_number'] ?? '').trim().toUpperCase()
    if (!containerNumber) {
      rowErrors.add(rowNumber, 'Container ausente — linha ignorada.', row)
      return
    }
    if (!IsoContainerSchema.safeParse(containerNumber).success) {
      rowErrors.add(rowNumber, `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`, row)
      return
    }

    const parsedTare = parseImportNumber(mapped['tare_kg'], 'pt-BR')
    const tare_kg = parsedTare.kind === 'value' ? Number(parsedTare.decimal) : null
    if (parsedTare.kind !== 'empty' && (parsedTare.kind !== 'value' || !Number.isFinite(tare_kg))) {
      rowErrors.add(rowNumber, `Container ${containerNumber}: tara inválida (${parsedTare.kind === 'invalid' ? parsedTare.reason : 'não finita'}).`, row)
    } else if (tare_kg !== null && tare_kg < 0) {
      rowErrors.add(rowNumber, `Container ${containerNumber}: tara não pode ser negativa.`, row)
    }
    const pol = resolveVaziosPort(
      String(mapped['pol'] ?? '').trim() || null,
      'POL',
      containerNumber,
      rowNumber,
      rowErrors,
      row,
    )
    const pod = resolveVaziosPort(
      String(mapped['pod'] ?? '').trim() || null,
      'POD',
      containerNumber,
      rowNumber,
      rowErrors,
      row,
    )

    containers.push({
      rowNumber,
      container_number: containerNumber,
      container_type: String(mapped['container_type'] ?? '').trim().toUpperCase() || null,
      tare_kg,
      pol,
      pod,
    })
  })

  return { containers, rowErrors: rowErrors.errors }
}

function resolveVaziosPort(
  value: string | null,
  field: 'POL' | 'POD',
  containerNumber: string,
  rowNumber: number,
  rowErrors: ReturnType<typeof createRowErrorCollector>,
  raw: unknown,
): string | null {
  if (!value) return null
  const resolved = resolvePortCode(value)
  if (!resolved.code || !resolved.recognized || !LocodeSchema.safeParse(resolved.code).success) {
    rowErrors.add(
      rowNumber,
      `Container ${containerNumber}: ${field} ${resolved.code ?? value} não reconhecido como LOCODE.`,
      raw,
    )
  }
  return resolved.code
}

export type ImportVaziosImportacaoArgs = {
  manifest: ParsedVaziosImportacaoManifest
  uploadedBy: string
  voyageId: number
  description?: string
  /** Permite persistir as linhas válidas quando o preview tem erros de linha. */
  allowRowErrors?: boolean
}

export async function importVaziosImportacaoManifest({
  manifest,
  uploadedBy,
  voyageId,
  description,
  allowRowErrors = false,
}: ImportVaziosImportacaoArgs): Promise<{ manifestId: string }> {
  if (manifest.rowErrors.length && !allowRowErrors) throw new Error(formatImportacaoRowErrors(manifest.rowErrors))

  const containers = manifest.containers.map((container) => ({
    container_number: container.container_number,
    container_type: container.container_type,
    tare_kg: container.tare_kg,
    pol: container.pol ?? null,
    pod: container.pod ?? null,
  }))
  const { data, error } = await supabase.rpc('import_vazios_importacao_transactional', {
    p_voyage_id: voyageId,
    p_description: description ?? null,
    p_uploaded_by: uploadedBy,
    p_containers: containers,
  })
  if (error) throw error
  const result = data as { manifest_id: string }
  return { manifestId: result.manifest_id }
}

function formatImportacaoRowErrors(rowErrors: readonly RowError[]): string {
  const shown = rowErrors.slice(0, 20).map((error) => `Linha ${error.row}: ${error.message}`)
  const hidden = rowErrors.length - shown.length
  if (hidden > 0) shown.push(`... e mais ${hidden} linha${hidden === 1 ? '' : 's'} com divergências.`)
  return shown.join('\n')
}

export async function importVaziosFromBaplie({
  voyageId,
  uploadedBy,
  description,
}: {
  voyageId: number
  uploadedBy: string
  description?: string
}): Promise<{ manifestId: string; total: number }> {
  return persistVaziosFromBaplie({ voyageId, uploadedBy, description, replaceExisting: false })
}

export async function replaceVaziosFromBaplie({
  voyageId,
  uploadedBy,
  description,
}: {
  voyageId: number
  uploadedBy: string
  description?: string
}): Promise<{ manifestId: string; total: number }> {
  return persistVaziosFromBaplie({ voyageId, uploadedBy, description, replaceExisting: true })
}

async function persistVaziosFromBaplie({
  voyageId,
  uploadedBy,
  description,
  replaceExisting,
}: {
  voyageId: number
  uploadedBy: string
  description?: string
  replaceExisting: boolean
}): Promise<{ manifestId: string; total: number }> {
  const { data, error } = await supabase.rpc('replace_vazios_from_baplie_transactional', {
    p_voyage_id: voyageId,
    p_description: description ?? null,
    p_uploaded_by: uploadedBy,
    p_replace_existing: replaceExisting,
  })
  if (error) throw error
  const result = data as { manifest_id: string; total: number }
  return { manifestId: result.manifest_id, total: result.total }
}

export async function getBaplieManifestForVoyage(voyageId: number): Promise<{
  id: string
  total_containers: number
  imported_at: string
} | null> {
  const { data, error } = await supabase
    .from('vazios_importacao_manifests')
    .select('id, total_containers, imported_at')
    .eq('voyage_id', voyageId)
    .eq('source', 'baplie')
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; total_containers: number; imported_at: string } | null
}

export async function listVaziosImportacaoContainers(filters: {
  manifestId?: string
  voyageId?: string
  pod?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  // Limita os parâmetros de paginação para evitar DoS por alocação excessiva
  // (ex.: pageSize=999999) ou offsets negativos vindos do cliente.
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 20), 1), 200)
  const page = Math.max(Math.trunc(filters.page ?? 1), 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('vazios_importacao_containers')
    .select(
      `*, manifest:vazios_importacao_manifests(id, voyage_id, description, imported_at, voyage:voyages(voyage_number, vessel:vessels(name)))`,
      { count: 'exact' },
    )
    .range(from, to)
    .order('created_at', { ascending: false })

  if (filters.search) {
    // Neutraliza sintaxe do parser PostgREST e curingas do LIKE (% e _)
    const safe = escapeFilterTerm(filters.search)
    if (safe) {
      query = query.or(
        `container_number.ilike.%${safe}%,container_type.ilike.%${safe}%`,
      )
    }
  }

  if (filters.manifestId) {
    query = query.eq('manifest_id', filters.manifestId)
  }

  if (filters.voyageId) {
    const { data: manifestIds } = await supabase
      .from('vazios_importacao_manifests')
      .select('id')
      .eq('voyage_id', Number(filters.voyageId))
    const ids = (manifestIds ?? []).map((m: { id: string }) => m.id)
    if (!ids.length) return { rows: [], count: 0 }
    query = query.in('manifest_id', ids)
  }

  if (filters.pod) {
    const safe = escapeFilterTerm(filters.pod)
    if (safe) {
      query = query.ilike('pod', safe)
    }
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as unknown as VaziosImportacaoContainerListItem[], count: count ?? 0 }
}

export async function listVaziosImportacaoManifests() {
  const { data, error } = await supabase
    .from('vazios_importacao_manifests')
    .select('id, description, total_containers, imported_at')
    .order('imported_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as unknown as VaziosImportacaoManifest[]
}
