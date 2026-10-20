import { assertUploadFile } from '../lib/fileGuard'
import { createHeaderMapper, createRowErrorCollector, matchHeaders, readSheet, type HeaderSpec, type RowError } from './importCore'
import { supabase } from './supabase'
import { escapeFilterTerm } from '../lib/utils'
import { parseImportNumber } from '../lib/importNumber'
import { IsoContainerSchema, LocodeSchema } from './importValidation'
import { normalizeStoredPortCode, resolvePortCode, storedPortAliases } from './portCode'
import type { VaziosImportacaoContainerListItem } from '../types/database'

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
  /** Avisos de leitura (linhas/abas ocultas, Windows-1252), como no Embarque de Vazios. */
  warnings: string[]
  /** Linhas e abas ocultas que o leitor ignorou (`readSheet`). */
  hidden: { rows: number; sheets: string[] }
}

export async function parseVaziosImportacaoFile(file: File): Promise<ParsedVaziosImportacaoManifest> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseVaziosImportacaoBuffer(buffer)
}

export async function parseVaziosImportacaoBuffer(buffer: ArrayBuffer): Promise<ParsedVaziosImportacaoManifest> {
  const { headers, rows, warnings, hidden } = await readSheet(buffer, {
    expectedHeaders: VAZIOS_IMPORTACAO_HEADER_MARKERS,
  })
  const { missing } = matchHeaders(headers, VAZIOS_IMPORTACAO_HEADER_SPEC)
  if (missing.length) {
    const labels = missing.map((field) => VAZIOS_IMPORTACAO_HEADER_LABELS[field])
    throw new Error(`Planilha inválida. Colunas obrigatórias: ${labels.join(', ')}.`)
  }
  const mapRow = createHeaderMapper(rows[0], HEADER_MAP)

  const containers: ParsedVaziosImportacaoContainer[] = []
  const rowErrors = createRowErrorCollector()

  rows.forEach((row) => {
    const rowNumber = row.rowNumber
    const mapped = mapRow(row)

    const containerNumber = String(mapped['container_number'] ?? '').trim().toUpperCase()
    if (!containerNumber) {
      rowErrors.add(rowNumber, 'Container ausente.', row)
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

  return { containers, rowErrors: rowErrors.errors, warnings, hidden }
}

/**
 * Confirmação antes de gravar uma planilha com linhas ou abas ocultas: o leitor
 * as ignora (ADR 0078, item 22) e a gravação substitui os containers de cada
 * rota (POL/POD) presente no arquivo, então os containers ocultos da mesma
 * rota saem do manifesto da Viagem. Mesmo padrão da pergunta do Embarque de
 * Vazios (`EmbarqueVazios.tsx`). `null` quando nada ficou oculto.
 */
export function vaziosImportacaoHiddenConfirmOptions(hidden: ParsedVaziosImportacaoManifest['hidden'] | undefined) {
  if (!hidden) return null
  const parts: string[] = []
  if (hidden.rows > 0) {
    parts.push(hidden.rows === 1
      ? '1 linha oculta foi ignorada e as unidades dela sairão do manifesto.'
      : `${hidden.rows} linhas ocultas foram ignoradas e as unidades delas sairão do manifesto.`)
  }
  if (hidden.sheets.length) {
    const names = hidden.sheets.map((name) => `"${name}"`).join(', ')
    parts.push(hidden.sheets.length === 1
      ? `A aba oculta ${names} foi ignorada; se ela tiver unidades, elas sairão do manifesto.`
      : `As abas ocultas ${names} foram ignoradas; se elas tiverem unidades, elas sairão do manifesto.`)
  }
  if (!parts.length) return null
  return {
    title: 'Planilha com dados ocultos',
    message: `${parts.join(' ')} Continuar?`,
    consequence:
      'A importação substitui os containers de cada rota (POL/POD) da planilha na Viagem: só as linhas visíveis ficam no manifesto. Para importar as ocultas, reexiba-as na planilha e escolha o arquivo de novo.',
    reversibility: 'Importar de novo a planilha com as linhas reexibidas devolve as unidades ao manifesto.',
    confirmLabel: 'Importar sem as ocultas',
    tone: 'danger' as const,
  }
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

/** Colunas que a planilha de Vazios de Importação precisa ter (modelo e modal usam esta lista). */
export const VAZIOS_IMPORTACAO_REQUIRED_COLUMNS = ['Container', 'POL', 'POD'] as const
export const VAZIOS_IMPORTACAO_OPTIONAL_COLUMNS = ['Tipo', 'Tara (kg)'] as const

export type VaziosImportacaoRoute = { pol: string; pod: string }

/** Chave de rota usada no mapa de números do modal. */
export const vaziosRouteKey = (route: VaziosImportacaoRoute) => `${route.pol}__${route.pod}`

/**
 * Um Nº de manifesto Mercante para cada rota (POL → POD) dos vazios (decisão
 * de 2026-10-01; achado V3 do lote 5b: o mesmo POL com dois POD pede dois
 * números). A planilha precisa de POL e POD em todas as linhas; cada rota
 * encontrada pede o seu número.
 */
export function resolveVaziosManifestRoutes(
  manifest: Pick<ParsedVaziosImportacaoManifest, 'containers'>,
): { routes: VaziosImportacaoRoute[]; error: null } | { routes: null; error: string } {
  if (!manifest.containers.length) return { routes: null, error: 'Nenhum container na planilha.' }
  if (manifest.containers.some((container) => !container.pol || !container.pod)) {
    return {
      routes: null,
      error: 'POL e POD são obrigatórios em todas as linhas: o Nº de manifesto Mercante pertence à rota (POL → POD).',
    }
  }
  const routes = new Map<string, VaziosImportacaoRoute>()
  for (const container of manifest.containers) {
    const route = { pol: container.pol as string, pod: container.pod as string }
    routes.set(vaziosRouteKey(route), route)
  }
  return { routes: [...routes.values()].sort((a, b) => vaziosRouteKey(a).localeCompare(vaziosRouteKey(b))), error: null }
}

/**
 * Confere os números digitados contra as rotas da planilha. Só bloqueia número
 * ausente ou o mesmo número em duas rotas; número já cadastrado em outra rota ou Viagem é recusado pela RPC; o da mesma rota de vazios é reaproveitado (migration 187).
 */
export function resolveVaziosManifestNumbers(
  manifest: Pick<ParsedVaziosImportacaoManifest, 'containers'>,
  numbers: Readonly<Record<string, string>>,
): { manifestos: Array<VaziosImportacaoRoute & { numero: string }>; error: null } | { manifestos: null; error: string } {
  const { routes, error } = resolveVaziosManifestRoutes(manifest)
  if (!routes) return { manifestos: null, error }
  const manifestos = routes.map((route) => ({ ...route, numero: (numbers[vaziosRouteKey(route)] ?? '').trim() }))
  const missing = manifestos.filter((m) => !m.numero)
  if (missing.length) {
    return {
      manifestos: null,
      error: `Informe o Nº do manifesto Mercante de ${missing.map((m) => `${m.pol} → ${m.pod}`).join(', ')}.`,
    }
  }
  const repeated = manifestos.find((m, index) => manifestos.findIndex((other) => other.numero === m.numero) !== index)
  if (repeated) {
    return { manifestos: null, error: `O número ${repeated.numero} foi informado para mais de uma rota.` }
  }
  return { manifestos, error: null }
}

export type ImportVaziosImportacaoArgs = {
  /** A gravação usa só os containers e os erros de linha; a pergunta das ocultas é de quem chama. */
  manifest: Pick<ParsedVaziosImportacaoManifest, 'containers' | 'rowErrors'>
  uploadedBy: string
  voyageId: number
  /** Nº do manifesto Mercante por rota da planilha (chave `vaziosRouteKey`), obrigatório em todas. */
  manifestNumbers: Readonly<Record<string, string>>
  description?: string
}

export async function importVaziosImportacaoManifest({
  manifest,
  uploadedBy,
  voyageId,
  manifestNumbers,
  description,
}: ImportVaziosImportacaoArgs): Promise<{ manifestId: string; mercanteManifestIds: string[] }> {
  // Regra de 2026-10-19 (ADR 0091): qualquer linha com erro recusa o arquivo inteiro.
  if (manifest.rowErrors.length) throw new Error(formatImportacaoRowErrors(manifest.rowErrors))
  const { manifestos, error: numbersError } = resolveVaziosManifestNumbers(manifest, manifestNumbers)
  if (!manifestos) throw new Error(numbersError)

  const containers = manifest.containers.map((container) => ({
    container_number: container.container_number,
    container_type: container.container_type,
    tare_kg: container.tare_kg,
    pol: container.pol ?? null,
    pod: container.pod ?? null,
  }))
  // Manifestos Mercante (natureza 'vazio') e containers na mesma transação (migration 117).
  const { data, error } = await supabase.rpc('import_vazios_importacao_transactional', {
    p_voyage_id: voyageId,
    p_description: description ?? null,
    p_uploaded_by: uploadedBy,
    p_containers: containers,
    p_manifestos: manifestos,
  })
  if (error) throw error
  const result = data as { manifest_id: string; mercante_manifest_ids: string[] | null }
  return { manifestId: result.manifest_id, mercanteManifestIds: result.mercante_manifest_ids ?? [] }
}

function formatImportacaoRowErrors(rowErrors: readonly RowError[]): string {
  const shown = rowErrors.slice(0, 20).map((error) => `Linha ${error.row}: ${error.message}`)
  const hidden = rowErrors.length - shown.length
  if (hidden > 0) shown.push(`... e mais ${hidden} linha${hidden === 1 ? '' : 's'} com erro.`)
  return [`Nada foi gravado: ${rowErrors.length === 1 ? 'uma linha tem erro' : `${rowErrors.length} linhas têm erro`}.`, ...shown].join('\n')
}

export async function importVaziosFromBaplie({
  voyageId,
  uploadedBy,
  description,
}: {
  voyageId: number
  uploadedBy: string
  description?: string
}): Promise<{ manifestId: string | null; total: number }> {
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
}): Promise<{ manifestId: string | null; total: number }> {
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
}): Promise<{ manifestId: string | null; total: number }> {
  const { data, error } = await supabase.rpc('replace_vazios_from_baplie_transactional', {
    p_voyage_id: voyageId,
    p_description: description ?? null,
    p_uploaded_by: uploadedBy,
    p_replace_existing: replaceExisting,
  })
  if (error) throw error
  // Recadastro com o Baplie sem vazios (migration 336): os vazios do Baplie
  // anterior saem e não há manifesto novo (`manifest_id` nulo, total 0).
  const result = data as { manifest_id: string | null; total: number }
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

export type VaziosImportacaoContainerFilters = {
  manifestId?: string
  voyageId?: string
  /** Rota do manifesto Mercante escolhido no filtro (com o `pod`). */
  pol?: string
  pod?: string
  search?: string
}

type VaziosImportacaoFilterableQuery<Q> = {
  or(filters: string): Q
  eq(column: string, value: string): Q
  in(column: string, values: readonly string[]): Q
}

/** Aplica o recorte a uma consulta de `vazios_importacao_containers`. */
export type VaziosImportacaoContainerFilterApplier = <Q extends VaziosImportacaoFilterableQuery<Q>>(query: Q) => Q

/**
 * Recorte da tela de Vazios de Importação, comum à página da lista e ao
 * "Selecionar os N do filtro" (`fetchVaziosImportacaoContainerIds`): os dois
 * precisam devolver o mesmo conjunto. Resolve antes a parte que consulta o
 * banco (manifestos da Viagem) e devolve um aplicador síncrono: o builder do
 * PostgREST é "thenable", então não pode sair de uma função `async` sem ser
 * executado. `null` quando a Viagem não tem manifesto de vazios (recorte
 * vazio sem consultar os containers).
 */
export async function resolveVaziosImportacaoContainerFilters(
  filters: VaziosImportacaoContainerFilters,
): Promise<VaziosImportacaoContainerFilterApplier | null> {
  let manifestIds: string[] | null = null
  if (filters.voyageId) {
    const { data, error } = await supabase
      .from('vazios_importacao_manifests')
      .select('id')
      .eq('voyage_id', Number(filters.voyageId))
    // Falha da consulta não pode virar "Nenhum container neste recorte".
    if (error) throw error
    manifestIds = (data ?? []).map((m: { id: string }) => m.id)
    if (!manifestIds.length) return null
  }
  // Neutraliza sintaxe do parser PostgREST e curingas do LIKE (% e _)
  const safeSearch = filters.search ? escapeFilterTerm(filters.search) : ''
  // A coluna guarda a grafia gravada; o filtro casa todas as que
  // `public.normalize_port_code` leva ao mesmo porto (como `reports.ts`).
  const polAliases = storedPortAliases(filters.pol)
  const podAliases = storedPortAliases(filters.pod)

  return (query) => {
    let filtered = query
    if (safeSearch) filtered = filtered.or(`container_number.ilike.%${safeSearch}%,container_type.ilike.%${safeSearch}%`)
    if (filters.manifestId) filtered = filtered.eq('manifest_id', filters.manifestId)
    if (manifestIds) filtered = filtered.in('manifest_id', manifestIds)
    if (polAliases.length) filtered = filtered.in('pol', polAliases)
    if (podAliases.length) filtered = filtered.in('pod', podAliases)
    return filtered
  }
}

export async function listVaziosImportacaoContainers(filters: VaziosImportacaoContainerFilters & {
  page?: number
  pageSize?: number
}) {
  // Limita os parâmetros de paginação para evitar DoS por alocação excessiva
  // (ex.: pageSize=999999) ou offsets negativos vindos do cliente.
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 20), 1), 200)
  const page = Math.max(Math.trunc(filters.page ?? 1), 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const applyFilters = await resolveVaziosImportacaoContainerFilters(filters)
  if (!applyFilters) return { rows: [], count: 0 }

  const { data, error, count } = await applyFilters(
    supabase
      .from('vazios_importacao_containers')
      .select(
        `*, manifest:vazios_importacao_manifests(id, voyage_id, description, imported_at, voyage:voyages(voyage_number, vessel:vessels(name)))`,
        { count: 'exact' },
      ),
  )
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to)
  if (error) throw error
  return { rows: (data ?? []) as unknown as VaziosImportacaoContainerListItem[], count: count ?? 0 }
}

/** Manifesto Mercante de vazios de uma rota da Viagem (aba Rotas e Manifestos). */
export type VaziosMercanteManifesto = {
  id: string
  voyage_id: number
  pol: string
  pod: string
  numero: string
}

/** Manifestos Mercante de natureza `vazio` das Viagens pedidas. */
export async function listVaziosMercanteManifestos(voyageIds: number[]): Promise<VaziosMercanteManifesto[]> {
  const ids = Array.from(new Set(voyageIds.filter((id) => Number.isFinite(id))))
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('manifestos_mercante')
    .select('id, voyage_id, pol, pod, numero')
    .eq('natureza', 'vazio')
    .in('voyage_id', ids)
    .order('numero')
  if (error) throw error
  return (data ?? []) as VaziosMercanteManifesto[]
}

/**
 * Nº do manifesto Mercante da rota do container: o manifesto de vazios da
 * mesma Viagem, POL e POD (comparados por `normalizeStoredPortCode`, a mesma
 * régua de `public.normalize_port_code`). `null`
 * quando a rota ainda não tem número (vazio do Baplie sem manifesto: a mesma
 * pendência do alerta "CE Mercante pendente").
 */
export function vazioManifestoNumero(
  container: { pol?: string | null; pod?: string | null; manifest?: { voyage_id?: number | null } | null },
  manifestos: ReadonlyArray<Pick<VaziosMercanteManifesto, 'voyage_id' | 'pol' | 'pod' | 'numero'>>,
): string | null {
  const voyageId = container.manifest?.voyage_id
  const pol = normalizeStoredPortCode(container.pol)
  const pod = normalizeStoredPortCode(container.pod)
  if (voyageId == null || !pol || !pod) return null
  const found = manifestos.find((item) =>
    item.voyage_id === voyageId && normalizeStoredPortCode(item.pol) === pol && normalizeStoredPortCode(item.pod) === pod)
  return found?.numero ?? null
}
