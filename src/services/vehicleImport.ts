import { assertUploadFile } from '../lib/fileGuard'
import { asString, chunkArray, normalizeHeader } from '../lib/utils'
import { inferSeparatorFormat, parseImportNumber, type ImportNumberFormat } from '../lib/importNumber'
import { IsoContainerSchema, VinSchema } from './importValidation'
import { supabase } from './supabase'
import { matchHeaders, readSheet, type HeaderSpec, type SheetRow } from './importCore'

// Aliases por campo. Cobrem tres formatos de origem:
// 1) Planilha modelo do sistema (cabecalhos em portugues: CHASSI, MARCA, ...).
// 2) "Daily Report" do armador COSCO (cabecalhos em ingles: VIN NO., GW(kg), ...),
//    cujos dados de veiculo ficam na segunda aba do arquivo.
// 3) Lista de VINs dos terminais chineses da COSCO (TAICANG/NANSHA), com
//    cabecalhos em chines: 品牌 (marca), 型号 (modelo), 提单号 (BL), 箱号 (container)...
const headerMap = {
  chassis: ['chassi', 'chassis', 'vin', 'vin no', 'vin no.', 'vin number'],
  brand: ['marca', 'brand', '品牌'],
  model: ['modelo', 'model', '型号'],
  weight_kg: ['peso', 'weight', 'gw', 'gw(kg)', 'gross weight', '毛重'],
  cbm: ['cubagem', 'cbm', 'm3', 'volume', '体积'],
  container_number: ['container', 'container number', 'numero do container', 'cntr no', 'cntr no.', 'cntr number', '箱号'],
  container_type: ['tipo_container', 'tipo do container', 'container type', 'tipo', 'cntr type', '箱型'],
  seal_number: ['lacre', 'seal', 'seal number', '封号'],
  bl_id: ['bl', 'b/l', 'bill of lading', 'bl number', 'bl no', 'bl no.', '提单号'],
  unpacking_location: ['local de desova', 'local desova', 'desova', 'unpacking location', 'unpacking_location'],
} as const

const requiredHeaders = {
  chassis: 'CHASSI',
  brand: 'MARCA',
  model: 'MODELO',
  weight_kg: 'PESO',
  cbm: 'CUBAGEM',
  container_number: 'CONTAINER',
  container_type: 'TIPO_CONTAINER',
  seal_number: 'LACRE',
  bl_id: 'BL',
} as const

// Marcas em chines → nome latino usado no sistema. Os arquivos dos terminais
// da COSCO (TAICANG/NANSHA) trazem a marca em chines (ex: 比亚迪 = BYD), o que
// duplica a marca nos relatorios. Quando nao houver correspondencia, mantemos
// o valor original.
const brandTranslations: Record<string, string> = {
  比亚迪: 'BYD',
  奇瑞: 'CHERY',
  吉利: 'GEELY',
  长城: 'GREAT WALL',
  长安: 'CHANGAN',
  广汽: 'GAC',
  广汽埃安: 'AION',
  埃安: 'AION',
  上汽: 'SAIC',
  上汽大通: 'MAXUS',
  名爵: 'MG',
  五菱: 'WULING',
  江淮: 'JAC',
  蔚来: 'NIO',
  小鹏: 'XPENG',
  理想: 'LI AUTO',
  零跑: 'LEAPMOTOR',
  哪吒: 'NETA',
  红旗: 'HONGQI',
}

function translateBrand(brand: string): string {
  return brandTranslations[brand.trim()] ?? brand
}

type DestinationField = keyof typeof headerMap
const SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  required: Object.keys(headerMap).filter((field) => field !== 'unpacking_location') as DestinationField[],
}

export type VehicleImportRow = {
  rowNumber: number
  chassis: string
  brand: string
  model: string
  weight_kg: number
  cbm: number
  container_number: string
  container_type: string
  seal_number: string
  bl_id: string
  unpacking_location?: string | null
}

export type ParsedVehicleImport = {
  rows: VehicleImportRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export type VehicleImportResult = {
  processed: number
  successCount: number
  errorCount: number
  errors: { row: number; message: string }[]
  /** local de desova da planilha diferente do gravado (ADR 0078, item 23) */
  unpackingDivergences?: VehicleUnpackingDivergence[]
}

export type VehicleUnpackingDivergence = { containerNumber: string; blId: string; current: string; next: string }

/** Texto da confirmação da troca do local de desova gravado. */
export function vehicleUnpackingConfirmOptions(divergences: VehicleUnpackingDivergence[]) {
  return {
    title: 'Local de desova diferente do gravado',
    message: `${divergences.length} container(s) já têm local de desova e a planilha traz outro.`,
    confirmLabel: 'Trocar pelo da planilha',
    cancelLabel: 'Manter o gravado',
    consequence: 'Os veículos entram de qualquer forma; a escolha vale só para o local de desova.',
    affected: {
      summary: `${divergences.length} container(s)`,
      items: divergences.map((item) => `${item.containerNumber} (B/L ${item.blId}): ${item.current} → ${item.next}`),
    },
  }
}

// Tipos ISO equivalentes (ADR 0078, item 23): 40HQ = 40HC etc.
// ponytail: tabela fixa dos aliases vistos nos arquivos; ampliar quando surgir outro.
const ISO_TYPE_GROUPS: string[][] = [
  ['20DC', '20GP', '20DV', '22G1', '20G1', '22G0', '20G0'],
  ['40DC', '40GP', '40DV', '42G1', '40G1', '42G0', '40G0'],
  ['40HC', '40HQ', '45G1', '45G0', '4EG1'],
  ['20RF', '20RE', '22R1', '20R1'],
  ['40RH', '40RF', '40RQ', '45R1', '42R1'],
  ['20FR', '22P1', '22P3', '20PF'],
  ['40FR', '42P1', '42P3', '45P3', '40PF'],
  ['20PL', '22P0', '20PC'],
  ['40PL', '42P0', '45P0', '40PC'],
  ['20OT', '22U1', '22U6'],
  ['40OT', '42U1', '45U1', '42U6'],
]
const ISO_TYPE_CANONICAL = new Map(ISO_TYPE_GROUPS.flatMap((group) => group.map((alias) => [alias, group[0]] as const)))

export function isoTypeKey(value: unknown): string {
  const key = normalizeKey(value)
  return ISO_TYPE_CANONICAL.get(key) ?? key
}

/** Flat rack e plataforma não levam lacre: a coluna é opcional para eles. */
export function isSealOptionalType(value: unknown): boolean {
  const key = isoTypeKey(value)
  return /^(20|40)(FR|PL)$/.test(key)
}

/** Lacre comparado sem zeros à esquerda ("000123" = "123"). */
export function sealKey(value: unknown): string {
  return normalizeKey(value).replace(/^0+(?=.)/, '')
}

export async function parseVehicleImportFile(file: File): Promise<ParsedVehicleImport> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseVehicleImportBuffer(buffer)
}

export async function parseVehicleImportBuffer(buffer: ArrayBuffer): Promise<ParsedVehicleImport> {
  // O modelo do armador pode manter os veiculos na segunda aba; percorremos as
  // abas pelo leitor compartilhado ate encontrar o cabecalho completo.
  let chosenRows: SheetRow[] | undefined
  let chosenNumberFormat: ImportNumberFormat = 'pt-BR'
  let lastMissing: string[] = Object.values(requiredHeaders)

  for (let sheetIndex = 0; ; sheetIndex += 1) {
    let content
    try {
      content = await readSheet(buffer, { sheetIndex })
    } catch (error) {
      if (error instanceof Error && error.message === 'Arquivo sem abas validas.') break
      if (error instanceof Error && error.message === 'Planilha vazia.') continue
      throw error
    }
    const { missing } = matchHeaders(content.headers, SPEC)
    if (!missing.length) {
      chosenRows = content.rows
      chosenNumberFormat = inferVehicleNumberFormat(content.headers)
      break
    }
    lastMissing = missing.map((field) => requiredHeaders[field as keyof typeof requiredHeaders] ?? field)
  }

  if (!chosenRows) {
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${lastMissing.join(', ')}.`)
  }
  return parseVehicleImportRows(chosenRows, chosenNumberFormat)
}

export async function importVehicleRows({
  voyageId,
  rows,
  confirmUnpacking,
}: {
  voyageId: number
  rows: VehicleImportRow[]
  /** divergência do local de desova gravado: true troca, false mantém o gravado */
  confirmUnpacking?: (divergences: VehicleUnpackingDivergence[]) => Promise<boolean>
}): Promise<VehicleImportResult> {
  const errors: VehicleImportResult['errors'] = []
  const seenChassis = new Set<string>()

  for (const row of rows) {
    if (seenChassis.has(row.chassis)) {
      errors.push({ row: row.rowNumber, message: 'Chassi duplicado no arquivo para a viagem selecionada.' })
    } else {
      seenChassis.add(row.chassis)
    }
  }

  const validRows = rows.filter((row) => !errors.some((error) => error.row === row.rowNumber))
  if (!validRows.length) {
    return {
      processed: rows.length,
      successCount: 0,
      errorCount: errors.length,
      errors,
    }
  }

  const uniqueChassis = Array.from(new Set(validRows.map((row) => row.chassis)))
  const uniqueBls = Array.from(new Set(validRows.map((row) => row.bl_id)))

  // Sem busca do B/L "parecido" (ADR 0078, item 23): B/L inexistente na
  // Viagem recusa a linha.
  const blsToLoad = uniqueBls

  const existingVehicles = await fetchInChunks(uniqueChassis, 250, async (chunk) => {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, chassis')
      .eq('voyage_id', voyageId)
      .in('chassis', chunk)
    if (error) throw error
    return (data ?? []) as Array<{ id: number; chassis: string }>
  })

  const existingVehicleChassis = new Set((existingVehicles ?? []).map((vehicle) => normalizeKey(vehicle.chassis)))

  // Mesmo chassi em outra Viagem é erro, salvo registro em B/L ou Viagem cancelados.
  const otherVoyageVehicles = await fetchInChunks(uniqueChassis, 250, async (chunk) => {
    const { data, error } = await supabase
      .from('vehicles')
      .select('chassis, voyage_id, bl:bls(cancelled_at), voyage:voyages(status, voyage_number)')
      .neq('voyage_id', voyageId)
      .in('chassis', chunk)
    if (error) throw error
    return (data ?? []) as unknown as Array<{ chassis: string; voyage_id: number; bl: { cancelled_at: string | null } | null; voyage: { status: string | null; voyage_number: string | null } | null }>
  })
  const chassisInOtherVoyage = new Map<string, string>()
  for (const vehicle of otherVoyageVehicles ?? []) {
    if (vehicle.bl?.cancelled_at || vehicle.voyage?.status === 'cancelled') continue
    chassisInOtherVoyage.set(normalizeKey(vehicle.chassis), vehicle.voyage?.voyage_number ?? `#${vehicle.voyage_id}`)
  }

  const matchedBls = await fetchInChunks(blsToLoad, 250, async (chunk) => {
    const { data, error } = await supabase
      .from('bls')
      .select('id, voyage_id')
      .eq('voyage_id', voyageId)
      .in('id', chunk)
    if (error) throw error
    return (data ?? []) as Array<{ id: string; voyage_id: number | null }>
  })

  const blMap = new Map((matchedBls ?? []).map((bl) => [normalizeKey(bl.id), bl]))

  type ContainerCandidate = {
    id: number
    bl_id: string | null
    container_number: string
    type: string | null
    seal_number: string | null
    unpacking_location: string | null
    bl?: { voyage_id: number | null } | null
  }

  const queryPageSize = 1000
  const containersByBlAndNumber = new Map<string, ContainerCandidate[]>()
  const containerNumbersInVoyage = new Set<string>()

  for (const blChunk of chunkArray(blsToLoad, 200)) {
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('bl_containers')
        .select('id, bl_id, container_number, type, seal_number, unpacking_location, bl:bls!inner(voyage_id)')
        .in('bl_id', blChunk)
        .eq('bl.voyage_id', voyageId)
        .order('id', { ascending: true })
        .range(offset, offset + queryPageSize - 1)

      if (error) throw error

      const batch = (data ?? []) as unknown as ContainerCandidate[]
      if (!batch.length) break

      for (const container of batch) {
        if (!container.bl_id || !container.container_number) continue
        const key = `${normalizeKey(container.bl_id)}|${normalizeKey(container.container_number)}`
        const current = containersByBlAndNumber.get(key) ?? []
        current.push(container)
        containersByBlAndNumber.set(key, current)
        containerNumbersInVoyage.add(normalizeKey(container.container_number))
      }

      if (batch.length < queryPageSize) break
      offset += queryPageSize
    }
  }

  const rowsToInsert: Array<{
    rowNumber: number
    container_number: string
    current_unpacking: string | null
    voyage_id: number
    container_id: number
    bl_id: string
    unpacking_location: string | null
    unpacking_confirmed?: boolean
    chassis: string
    brand: string
    model: string
    weight_kg: number
    cbm: number
  }> = []

  for (const row of validRows) {
    if (existingVehicleChassis.has(row.chassis)) {
      errors.push({ row: row.rowNumber, message: 'Chassi ja cadastrado nesta viagem.' })
      continue
    }
    const otherVoyage = chassisInOtherVoyage.get(row.chassis)
    if (otherVoyage) {
      errors.push({ row: row.rowNumber, message: `Chassi ja cadastrado na Viagem ${otherVoyage}.` })
      continue
    }

    const matchedBl = blMap.get(normalizeKey(row.bl_id))
    if (!matchedBl) {
      errors.push({ row: row.rowNumber, message: 'BL nao encontrado na viagem selecionada.' })
      continue
    }

    const containerCandidates = containersByBlAndNumber.get(`${normalizeKey(row.bl_id)}|${row.container_number}`) ?? []
    if (!containerCandidates.length) {
      if (!containerNumbersInVoyage.has(row.container_number)) {
        errors.push({ row: row.rowNumber, message: 'Container nao encontrado no sistema.' })
      } else {
        errors.push({ row: row.rowNumber, message: 'BL nao pertence ao container informado.' })
      }
      continue
    }

    const typeMismatch = containerCandidates.every(
      (container) => Boolean(container.type) && isoTypeKey(container.type) !== isoTypeKey(row.container_type),
    )
    if (typeMismatch) {
      errors.push({ row: row.rowNumber, message: 'Tipo do container nao confere com o sistema.' })
      continue
    }

    const sealSkipped = !row.seal_number && isSealOptionalType(row.container_type)
    const sealMismatch = !sealSkipped && containerCandidates.every(
      (container) => Boolean(container.seal_number) && sealKey(container.seal_number) !== sealKey(row.seal_number),
    )
    if (sealMismatch) {
      errors.push({ row: row.rowNumber, message: 'Lacre nao confere com o sistema.' })
      continue
    }

    // F-03: Exigir match exato (tipo + lacre) quando ambos estao preenchidos
    // no banco. Se nao houver match exato, nao cair em fallback silencioso
    // para containerCandidates[0]: recusa com erro explicito.
    const exactMatches = containerCandidates.filter(
      (container) =>
        (!container.type || isoTypeKey(container.type) === isoTypeKey(row.container_type)) &&
        (sealSkipped || !container.seal_number || sealKey(container.seal_number) === sealKey(row.seal_number)),
    )

    if (exactMatches.length !== 1) {
      errors.push({
        row: row.rowNumber,
        message:
          exactMatches.length === 0
            ? 'Nao foi possivel identificar com seguranca qual container desta BL corresponde ao veiculo (tipo ou lacre divergem).'
            : 'Mais de um container desta BL atende ao tipo/lacre informado; revise a planilha para evitar ambiguidade.',
      })
      continue
    }

    const [exactContainer] = exactMatches

    rowsToInsert.push({
      rowNumber: row.rowNumber,
      voyage_id: voyageId,
      container_id: exactContainer.id,
      bl_id: matchedBl.id,
      container_number: exactContainer.container_number,
      current_unpacking: exactContainer.unpacking_location,
      chassis: row.chassis,
      brand: row.brand,
      model: row.model,
      weight_kg: row.weight_kg,
      cbm: row.cbm,
      unpacking_location: row.unpacking_location ?? null,
    })
    existingVehicleChassis.add(row.chassis)
  }

  // Local de desova: a planilha só preenche vazio; conflito no próprio arquivo
  // recusa as linhas daquele container; divergência do gravado pede confirmação.
  const unpackingByContainer = new Map<number, Set<string>>()
  for (const row of rowsToInsert) {
    const next = row.unpacking_location?.trim()
    if (!next) continue
    const values = unpackingByContainer.get(row.container_id) ?? new Set<string>()
    values.add(next.toUpperCase())
    unpackingByContainer.set(row.container_id, values)
  }
  const conflicted = new Set([...unpackingByContainer].filter(([, values]) => values.size > 1).map(([id]) => id))
  const accepted = rowsToInsert.filter((row) => {
    if (!conflicted.has(row.container_id)) return true
    errors.push({ row: row.rowNumber, message: `Local de desova diferente para o container ${row.container_number} no mesmo arquivo.` })
    return false
  })
  const divergences: VehicleUnpackingDivergence[] = []
  const seenDivergent = new Set<number>()
  for (const row of accepted) {
    const next = row.unpacking_location?.trim()
    const current = row.current_unpacking?.trim()
    if (!next || !current || next.toUpperCase() === current.toUpperCase() || seenDivergent.has(row.container_id)) continue
    seenDivergent.add(row.container_id)
    divergences.push({ containerNumber: row.container_number, blId: row.bl_id, current, next })
  }
  const confirmed = divergences.length ? Boolean(await confirmUnpacking?.(divergences)) : false

  if (accepted.length) {
    const { error: insertError } = await supabase.rpc('import_vehicle_rows_transactional', {
      p_rows: accepted.map((row) => ({
        voyage_id: row.voyage_id,
        container_id: row.container_id,
        bl_id: row.bl_id,
        chassis: row.chassis,
        brand: row.brand,
        model: row.model,
        weight_kg: row.weight_kg,
        cbm: row.cbm,
        unpacking_location: row.unpacking_location,
        unpacking_confirmed: confirmed,
      })),
    })
    if (insertError) throw insertError
  }

  return {
    processed: rows.length,
    successCount: accepted.length,
    errorCount: errors.length,
    errors: errors.sort((left, right) => left.row - right.row),
    unpackingDivergences: divergences,
  }
}

function parseVehicleImportRows(rows: SheetRow[], headerFormat: ImportNumberFormat): ParsedVehicleImport {
  const parsedRows: VehicleImportRow[] = []
  const rowErrors: ParsedVehicleImport['rowErrors'] = []
  // O formato vem da evidência do próprio arquivo (peso e cubagem); só sem
  // evidência vale o palpite pelos cabeçalhos (ADR 0078, item 22).
  const evidence = inferSeparatorFormat(rows.flatMap((row) => {
    const mapped = mapRow(row)
    return [mapped.weight_kg, mapped.cbm]
  }))
  const numberFormat = evidence === 'unknown' ? headerFormat : evidence

  rows.forEach((row) => {
    const mapped = mapRow(row)
    const rowNumber = row.rowNumber

    const chassis = normalizeKey(mapped.chassis)
    const brand = translateBrand(asString(mapped.brand))
    const model = asString(mapped.model)
    const weight = parseSpreadsheetNumber(mapped.weight_kg, numberFormat)
    const cbm = parseSpreadsheetNumber(mapped.cbm, numberFormat)
    const containerNumber = normalizeKey(mapped.container_number)
    const containerType = normalizeKey(mapped.container_type)
    const sealNumber = normalizeKey(mapped.seal_number)
    const blId = normalizeKey(mapped.bl_id)
    const unpackingLocation = asString(mapped.unpacking_location) || null

    if (
      !chassis ||
      !brand ||
      !model ||
      weight === null ||
      cbm === null ||
      !containerNumber ||
      !containerType ||
      (!sealNumber && !isSealOptionalType(containerType)) ||
      !blId
    ) {
      rowErrors.push({ row: rowNumber, message: 'Todos os campos obrigatorios devem ser preenchidos.', raw: row })
      return
    }

    if (weight <= 0 || cbm <= 0) {
      rowErrors.push({ row: rowNumber, message: 'Peso e cubagem devem ser numericos e maiores que zero.', raw: row })
      return
    }

    // P1-9: teto de absurdo, no mesmo espírito do Manifesto BB
    // (breakbulkManifestParser.ts) — um numero que nao descreve um veiculo
    // e recusado seja qual for o separador decimal lido. Faixa generosa
    // (carro pequeno a maquina pesada em container); nao calibrada contra
    // amostra real de producao.
    // ponytail: upgrade — se a faixa se mostrar apertada para algum layout
    // real, ajustar aqui em vez de remover a checagem.
    if (weight < 300 || weight > 60_000) {
      rowErrors.push({ row: rowNumber, message: `Peso ${weight}kg fora da faixa plausível para um veículo (300–60.000kg).`, raw: row })
      return
    }
    if (cbm < 1 || cbm > 300) {
      rowErrors.push({ row: rowNumber, message: `Cubagem ${cbm}m³ fora da faixa plausível para um veículo (1–300m³).`, raw: row })
      return
    }

    if (!IsoContainerSchema.safeParse(containerNumber).success) {
      rowErrors.push({ row: rowNumber, message: `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`, raw: row })
      return
    }

    // P1-9: a unica checagem de chassi antes desta correção era "não vazio".
    // VinSchema exige os 17 caracteres do ISO 3779 sem I/O/Q — mesmo nível de
    // rigor que o container já tinha, agora simétrico para o veículo.
    if (!VinSchema.safeParse(chassis).success) {
      rowErrors.push({ row: rowNumber, message: `Chassi ${chassis}: formato VIN esperado (17 caracteres, sem I/O/Q).`, raw: row })
      return
    }

    parsedRows.push({
      rowNumber,
      chassis,
      brand,
      model,
      weight_kg: weight,
      cbm,
      container_number: containerNumber,
      container_type: containerType,
      seal_number: sealNumber,
      bl_id: blId,
      unpacking_location: unpackingLocation,
    })
  })

  return { rows: parsedRows, rowErrors }
}

// Retorna os rotulos das colunas obrigatorias ausentes considerando os aliases
// de cada campo (planilha modelo e modelo do armador).
function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  const { columnByField } = matchHeaders(Object.keys(row), SPEC)
  for (const [field, column] of Object.entries(columnByField) as [DestinationField, string][]) mapped[field] = row[column]
  return mapped
}

// P1-9: o fallback para 'unknown' que existia aqui recaía sobre uma segunda
// leitura sempre que a declarada/inferida rejeitasse a célula — o mesmo
// padrão que o Manifesto BB (breakbulkManifestParser.ts) e a doc do módulo
// tratam como recusado, não corrigido em silêncio ("Formato declarado que o
// arquivo contradiz é recusado em vez de corrigido em silêncio",
// docs/modules/manifesto-edi.md). Sem o fallback, uma célula que não
// confirma o formato inferido vira `null`, que a checagem de campos
// obrigatórios já bloqueia — em vez de ser relida sob uma convenção
// diferente da que o cabeçalho do arquivo indicou.
function parseSpreadsheetNumber(value: unknown, format: ImportNumberFormat) {
  // O Daily Report da COSCO às vezes traz a unidade colada ("12.681m³").
  // Só a unidade conhecida sai; qualquer outra letra continua sintaxe inválida.
  const text = typeof value === 'string' ? value.trim().replace(/\s*(m³|m3|cbm|kgs?)$/i, '') : value
  const parsed = parseImportNumber(text, format)
  if (parsed.kind !== 'value') return null
  const number = Number(parsed.decimal)
  return Number.isFinite(number) ? number : null
}

// ponytail: heurística por palavras-chave em cabeçalhos para inferir formato numérico (en-US vs pt-BR).
// Teto: arquivos com termos de peso/volume em outros idiomas ou layouts não mapeados caem em pt-BR.
// Caminho de upgrade: inspecionar amostra dos valores numéricos das primeiras linhas para inferir
// os separadores de milhar e decimal a partir do padrão real dos dados.
function inferVehicleNumberFormat(headers: readonly string[]): ImportNumberFormat {
  const normalized = headers.map(normalizeHeader)
  const carrierMarkers = new Set([
    'vin no.',
    'vin no',
    'gw(kg)',
    'gross weight',
    'volume',
    '品牌',
    '型号',
    '毛重',
    '体积',
  ])
  return normalized.some((header) => carrierMarkers.has(header)) ? 'en-US' : 'pt-BR'
}

function normalizeKey(value: unknown) {
  return asString(value).toUpperCase()
}

async function fetchInChunks<TInput extends string, TResult>(
  values: TInput[],
  chunkSize: number,
  fetcher: (chunk: TInput[]) => Promise<TResult[]>,
) {
  const collected: TResult[] = []
  for (const chunk of chunkArray(values, chunkSize)) {
    const batch = await fetcher(chunk)
    collected.push(...batch)
  }
  return collected
}
