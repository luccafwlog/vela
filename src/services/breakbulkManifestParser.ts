// Parsing-only module for breakbulk manifests (summary, legacy and carrier
// layouts). Por contrato do playbook de imports, este módulo não faz escrita
// no Supabase nem importa React: transforma a planilha em um modelo tipado
// (ParsedBreakbulkManifest) com erros por linha. A persistência vive em
// breakbulkImport.ts.
import { assertUploadFile } from '../lib/fileGuard'
import { canonicalizeDocument, extractCnpjFromText } from '../lib/cnpj'
import {
  groupingSeparator,
  inferSeparatorFormat,
  isThousandsGroupShape,
  normalizeNumericText,
  parseImportNumber,
  type ImportNumberFormat,
} from '../lib/importNumber'
import { asString, normalizeHeader, onlyDigits } from '../lib/utils'
import { normalizePortCode } from './portCode'
import {
  extractCarrierMachineQty,
  firstMeaningfulPartyLine,
  isLikelyCompanyLine,
  normalizeCarrierBreakbulkDescription,
} from './breakbulkCargoText'
import { matchHeaders, readSheet, type HeaderSpec, type SheetRow } from './importCore'

const headerMap = {
  bl_id: ['bl', 'b/l', 'bill of lading'],
  ce_mercante: ['ce', 'ce mercante', 'ce_mercante'],
  machine_qty: ['maquinas', 'máquinas', 'machines'],
  packages_qty: ['packages'],
  packages_total: ['packages total', 'total packages'],
  gross_weight_ton: ['weight (ton)', 'weight(ton)', 'weight ton', 'weight'],
  cbm: ['cbm (m3)', 'cbm(m3)', 'cbm', 'm3'],
  shipper: ['shipper', 'embarcador'],
  consignee: ['consignee', 'consignatario', 'cnee'],
  notify_party: ['notify', 'notify party'],
  cnpj_cpf: ['cnpj', 'cnpj/cpf', 'documento'],
  pol: ['pol', 'porto origem'],
  pod: ['pod', 'porto destino'],
  item_description: ['descricao', 'descricao da carga', 'mercadoria'],
  package_qty: ['volumes', 'quantidade', 'qty'],
  package_unit: ['unidade', 'unidade volumes'],
  marks: ['marcas', 'marks'],
  gross_weight_kg: ['peso_kg', 'peso', 'peso bruto', 'weight (kg)'],
} as const

const bbRequiredHeaders = ['BL', 'CE', 'MAQUINAS', 'PACKAGES', 'PACKAGES TOTAL', 'WEIGHT (TON)', 'CBM (M3)', 'SHIPPER', 'CONSIGNEE', 'NOTIFY'] as const
const legacyRequiredHeaders = ['BL', 'CONSIGNATARIO', 'CNPJ', 'POL', 'POD', 'DESCRICAO', 'VOLUMES', 'PESO_KG', 'CBM'] as const

type DestinationField = keyof typeof headerMap
// 'bl_document' entra pelo importador de B/L avulso (blDocumentParser.ts),
// que reaproveita este modelo para persistir pelo mesmo caminho.
export type BreakbulkLayout = 'summary' | 'legacy' | 'carrier' | 'bl_document'
const SUMMARY_SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  required: ['bl_id', 'ce_mercante', 'machine_qty', 'packages_qty', 'packages_total', 'gross_weight_ton', 'cbm', 'shipper', 'consignee', 'notify_party'],
}
const LEGACY_SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  required: ['bl_id', 'consignee', 'cnpj_cpf', 'pol', 'pod', 'item_description', 'package_qty', 'gross_weight_kg', 'cbm'],
}

export type BreakbulkImportRow = {
  rowNumber: number
  bl_id: string
  ce_mercante: string | null
  shipper: string | null
  consignee: string
  notify_party: string | null
  cnpj_cpf: string | null
  pol: string | null
  pod: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_packages_total: number | null
  bb_weight_ton: number | null
  /** Cubagem da carga solta. Vai para bls.bb_cbm; bls.total_cbm e do conteiner. */
  bb_cbm: number
  items: Array<{
    item_description: string
    package_qty: number
    package_unit: string | null
    gross_weight_kg: number
    cbm: number
    marks: string | null
  }>
}

export type ParsedBreakbulkManifest = {
  layout: BreakbulkLayout
  bls: BreakbulkImportRow[]
  /**
   * Divergências por linha. `severity` ausente significa `'error'`: o legado
   * inteiro é bloqueante e continua sendo. `'warning'` é a linha que importa,
   * mas pede conferência — hoje só a ambiguidade de separador decimal.
   */
  rowErrors: { row: number; message: string; raw: unknown; severity?: 'error' | 'warning' }[]
}

export function hasBlockingRowErrors(rowErrors: ParsedBreakbulkManifest['rowErrors']) {
  return rowErrors.some((rowError) => (rowError.severity ?? 'error') === 'error')
}

/**
 * `numberFormat` e o separador decimal que o operador declarou no modal. Sem
 * ele o parser usa a evidencia do arquivo e BLOQUEIA o que a evidencia nao
 * resolve; com ele nao ha palpite nenhum. Ver `readNumericColumns`.
 */
export type ParseBreakbulkOptions = { numberFormat?: BreakbulkNumberFormat }

export async function parseBreakbulkManifestFile(
  file: File,
  options: ParseBreakbulkOptions = {},
): Promise<ParsedBreakbulkManifest> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseBreakbulkManifestBuffer(buffer, options)
}

export async function parseBreakbulkManifestBuffer(
  buffer: ArrayBuffer,
  options: ParseBreakbulkOptions = {},
): Promise<ParsedBreakbulkManifest> {
  const { headers: rawHeaders, matrix, rows } = await readSheet(buffer)

  if (looksLikeCarrierBreakbulk(matrix as (string | number | null)[][])) {
    return parseCarrierBreakbulkRows(matrix as (string | number | null)[][], options)
  }

  const layout = detectLayout(rawHeaders)
  validateRequiredHeaders(rawHeaders, layout)
  return parseBreakbulkRows(rows, layout, options)
}

function parseBreakbulkRows(
  rows: SheetRow[],
  layout: BreakbulkLayout,
  options: ParseBreakbulkOptions,
): ParsedBreakbulkManifest {
  return layout === 'summary' ? parseSummaryRows(rows, options) : parseLegacyRows(rows, options)
}

function parseCarrierBreakbulkRows(
  rawRows: (string | number | null)[][],
  options: ParseBreakbulkOptions = {},
): ParsedBreakbulkManifest {
  const rowErrors: ParsedBreakbulkManifest['rowErrors'] = []
  const bls: BreakbulkImportRow[] = []

  const headerRowIndex = rawRows.findIndex((row) => isCarrierHeaderRow(row))
  const headerRow = headerRowIndex >= 0 ? rawRows[headerRowIndex] : []
  const colBl = findCarrierColumnIndex(headerRow, ['bl no.', 'b/l no.', 'b/l nr.', 'b/l nr'])
  const colPod = findCarrierColumnIndex(headerRow, ['pod', 'port of discharge', 'disch port'])
  const colDescription = findCarrierColumnIndex(headerRow, ['description of goods', 'description', 'decription'])
  const colQty = findCarrierColumnIndex(headerRow, ['number of pieces', 'quantity', 'pkg', 'packages'])
  const colWeight = findCarrierColumnIndex(headerRow, ['gross weight', 'g.w(kgs)', 'gross weight(kgs)', 'weight (kgs)'])
  const colCbm = findCarrierColumnIndex(headerRow, ['measurement', 'cbm', 'cube (cbm)'])
  const colMarks = findCarrierColumnIndex(headerRow, ['marks', 'marks and numbers'])
  const colShipper = findCarrierColumnIndex(headerRow, ['shipper'])
  const colConsignee = findCarrierColumnIndex(headerRow, ['consignee'])
  const colNotify = findCarrierColumnIndex(headerRow, ['notify', 'notify party'])

  // O layout carrier lia peso com 'unknown' e cubagem com 'en-US' FIXO: o
  // proprio codigo contradizia a premissa de que uma planilha usa um locale so,
  // e a coluna de cubagem nunca era conferida contra o arquivo. Agora as duas
  // colunas passam pela mesma resolucao dos outros layouts.
  const carrierFormat = resolveSheetFormat(
    inferSeparatorFormat(
      rawRows.flatMap((row) => [colWeight >= 0 ? row[colWeight] : null, colCbm >= 0 ? row[colCbm] : null]),
    ),
    options.numberFormat,
    // Sem evidência e sem declaração, este layout lê en-US: é um documento de
    // armador em inglês, não uma planilha do operador. Era o que o código já
    // fazia para a cubagem, só que fixo — agora é um default que a evidência do
    // arquivo e a declaração do operador podem sobrepor.
    'en-US',
  )
  pushFormatConflict(rowErrors, carrierFormat, headerRowIndex + 1)

  const previewText = rawRows.slice(0, 20).map((row) => row.map((cell) => asString(cell)).join(' ')).join(' ')
  let currentPol = inferPortFromText(previewText, 'pol') ?? ''
  let currentPod = inferPortFromText(previewText, 'pod') ?? ''

  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index] ?? []
    const col0 = asString(row[0])
    const col2 = asString(row[2])
    const col4 = asString(row[4])
    const candidateBl = asString(colBl >= 0 ? row[colBl] : row[0])

    if (/^POL\b/i.test(col2)) currentPol = normalizePortCode(col2.replace(/^POL\s+/i, '').trim()) || currentPol
    if (/^POD\b/i.test(col4)) currentPod = normalizePortCode(col4.replace(/^POD\s+/i, '').trim()) || currentPod
    if (/^LOADING PORT[:\s]/i.test(col0)) currentPol = normalizePortCode(col0.split(':').slice(1).join(':').trim()) || currentPol
    if (/^PORT OF LOADING[:\s]/i.test(col0)) currentPol = normalizePortCode(col0.split(':').slice(1).join(':').trim()) || currentPol
    if (/^DISCH PORT[:\s]/i.test(col0)) currentPod = normalizePortCode(col0.split(':').slice(1).join(':').trim()) || currentPod
    if (/^PORT OF DISCHARGE[:\s]/i.test(col0)) currentPod = normalizePortCode(col0.split(':').slice(1).join(':').trim()) || currentPod
    const joinedRow = row.map((cell) => asString(cell)).join(' ')
    if (/LOADG\/DISCHARG PORT/i.test(joinedRow)) {
      const normalized = normalizeHeader(joinedRow)
      if (normalized.includes('taicang')) currentPol = 'CNTAC'
      if (normalized.includes('zhangjiagang')) currentPol = 'CNZJG'
      if (normalized.includes('vitoria')) currentPod = 'BRVIX'
      if (normalized.includes('salvador')) currentPod = 'BRSSA'
    }
    if (index <= headerRowIndex) continue

    if (!looksLikeCarrierBreakbulkBl(candidateBl)) continue

    const groupRows = collectCarrierBlRows(rawRows, index, colBl)
    index += groupRows.length - 1

    const descriptionBlock = joinedStringsFromColumn(groupRows, colDescription >= 0 ? colDescription : 3)
    const rawWeight = firstRawFromColumn(groupRows, colWeight) ?? firstRawBeforeUnit(groupRows, /^KGS?$/i)
    const rawCbm = firstRawFromColumn(groupRows, colCbm) ?? firstRawBeforeUnit(groupRows, /^CBMS?$/i)
    const readWeightKg =
      firstNumberFromColumn(groupRows, colWeight, carrierFormat.format)
      ?? findNumberBeforeUnit(groupRows, /^KGS?$/i, carrierFormat.format)
    const readCbm =
      firstNumberFromColumn(groupRows, colCbm, carrierFormat.format)
      ?? findNumberBeforeUnit(groupRows, /^CBMS?$/i, carrierFormat.format)
    const weightIssue = describeCarrierNumber('gross_weight_kg', candidateBl, rawWeight, readWeightKg, carrierFormat)
    const cbmIssue = describeCarrierNumber('cbm', candidateBl, rawCbm, readCbm, carrierFormat)
    const isWeightError = Boolean(weightIssue && (weightIssue.severity ?? 'error') === 'error')
    const isCbmError = Boolean(cbmIssue && (cbmIssue.severity ?? 'error') === 'error')
    const grossWeightKg = isWeightError ? 0 : readWeightKg ?? 0
    const cbm = isCbmError ? 0 : readCbm ?? 0

    // Os layouts resumido e legado rejeitam a linha sem peso; o carrier aceitava
    // em silêncio e o B/L entrava sem peso nenhum, indistinguível de uma carga
    // que realmente não tem peso declarado. O peso alimenta a taxa por tonelada,
    // então a ausência tem de aparecer como issue, não como zero.
    if (weightIssue) rowErrors.push({ row: index + 1, ...weightIssue, raw: row })
    if (cbmIssue) rowErrors.push({ row: index + 1, ...cbmIssue, raw: row })
    const packageInfo = parseCarrierPackageInfo(descriptionBlock, firstValueFromColumn(groupRows, colQty))
    const itemDescription = normalizeCarrierBreakbulkDescription(descriptionBlock)
    const splitParties = parseCarrierSplitPartyRows(groupRows)
    const combinedParties = parseCarrierCombinedParties(asString(row[0]))
    const partiesFromBlock = parseCarrierBreakbulkParties([asString(row[0]), asString(row[6])].join('\n'))
    const shipper =
      asString(colShipper >= 0 ? row[colShipper] : '') ||
      splitParties.shipper ||
      combinedParties.shipper ||
      partiesFromBlock.shipper
    const consignee =
      asString(colConsignee >= 0 ? row[colConsignee] : '') ||
      splitParties.consignee ||
      combinedParties.consignee ||
      partiesFromBlock.consignee
    const notifyParty =
      asString(colNotify >= 0 ? row[colNotify] : '') ||
      splitParties.notifyParty ||
      combinedParties.notifyParty ||
      partiesFromBlock.notifyParty
    const cnpj = extractTaxId(consignee) || splitParties.cnpj || combinedParties.cnpj || partiesFromBlock.cnpj

    if (!consignee) {
      rowErrors.push({
        row: index + 1,
        message: `Consignatario nao identificado para o BL ${candidateBl}.`,
        raw: row,
      })
    }

    bls.push({
      rowNumber: index + 1,
      bl_id: candidateBl,
      ce_mercante: null,
      shipper: shipper || null,
      consignee: consignee || 'CONSIGNATARIO NAO IDENTIFICADO',
      notify_party: notifyParty || null,
      cnpj_cpf: cnpj || null,
      pol: currentPol || null,
      pod: normalizePortCode(asString(colPod >= 0 ? row[colPod] : '')) || currentPod || null,
      bb_machine_qty: extractCarrierMachineQty(descriptionBlock),
      bb_packages_qty: packageInfo.quantity,
      bb_packages_total: packageInfo.quantity,
      bb_weight_ton: grossWeightKg > 0 ? grossWeightKg / 1000 : null,
      bb_cbm: cbm,
      items: [
        {
          item_description: itemDescription,
          package_qty: packageInfo.quantity ?? 0,
          package_unit: packageInfo.unit,
          gross_weight_kg: grossWeightKg,
          cbm,
          marks: asNullableString(colMarks >= 0 ? row[colMarks] : row[1]),
        },
      ],
    })
  }

  return {
    layout: 'carrier',
    bls,
    rowErrors,
  }
}

function parseSummaryRows(rows: SheetRow[], options: ParseBreakbulkOptions = {}): ParsedBreakbulkManifest {
  const rowErrors: ParsedBreakbulkManifest['rowErrors'] = []
  const parsedRows: BreakbulkImportRow[] = []

  const mappedRows = rows.map((row) => ({ row, mapped: mapRow(row, SUMMARY_SPEC) }))
  const format = resolveSheetFormat(
    inferSheetFormat(mappedRows.map((entry) => entry.mapped), SUMMARY_NUMERIC_FIELDS),
    options.numberFormat,
  )
  pushFormatConflict(rowErrors, format, rows[0]?.rowNumber ?? 1)

  mappedRows.forEach(({ row, mapped }) => {
    const rowNumber = row.rowNumber

    const bl_id = normalizeKey(mapped.bl_id)
    const ce_mercante = asNullableDigits(mapped.ce_mercante)
    const numbers = readNumericColumns(mapped, SUMMARY_NUMERIC_FIELDS, format)
    if (numbers.problems.length) {
      rowErrors.push({ row: rowNumber, message: numbers.problems.join(' '), raw: row })
      return
    }
    for (const warning of numbers.warnings) {
      rowErrors.push({ row: rowNumber, message: warning, raw: row, severity: 'warning' })
    }
    const machineQty = numbers.values.machine_qty
    const packagesQty = numbers.values.packages_qty
    const packagesTotal = numbers.values.packages_total
    const weightTon = numbers.values.gross_weight_ton
    const cbm = numbers.values.cbm
    const shipper = asNullableString(mapped.shipper)
    const consignee = asString(mapped.consignee)
    const notifyParty = asNullableString(mapped.notify_party)
    const cnpjCpf = asNullableCnpj(mapped.cnpj_cpf)
    const pol = nullableKey(mapped.pol)
    const pod = nullableKey(mapped.pod)

    if (!bl_id || !shipper || !consignee || !notifyParty) {
      rowErrors.push({ row: rowNumber, message: 'Colunas obrigatorias ausentes ou invalidas para o layout BB.', raw: row })
      return
    }

    if (machineQty < 0 || packagesQty < 0 || packagesTotal < 0 || weightTon <= 0 || cbm < 0) {
      rowErrors.push({ row: rowNumber, message: 'Maquinas, packages, peso e CBM devem ser numericos validos.', raw: row })
      return
    }

    parsedRows.push({
      rowNumber,
      bl_id,
      ce_mercante,
      shipper,
      consignee,
      notify_party: notifyParty,
      cnpj_cpf: cnpjCpf,
      pol,
      pod,
      bb_machine_qty: machineQty,
      bb_packages_qty: packagesQty,
      bb_packages_total: packagesTotal,
      bb_weight_ton: weightTon,
      bb_cbm: cbm,
      items: [],
    })
  })

  return {
    layout: 'summary',
    bls: parsedRows,
    rowErrors,
  }
}

function parseLegacyRows(rows: SheetRow[], options: ParseBreakbulkOptions = {}): ParsedBreakbulkManifest {
  const rowErrors: ParsedBreakbulkManifest['rowErrors'] = []
  const mappedRows: Array<{
    rowNumber: number
    bl_id: string
    consignee: string
    cnpj_cpf: string
    pol: string
    pod: string
    item_description: string
    package_qty: number
    gross_weight_kg: number
    cbm: number
    package_unit: string | null
    marks: string | null
    shipper: string | null
  }> = []

  const sheetRows = rows.map((row) => ({ row, mapped: mapRow(row, LEGACY_SPEC) }))
  const format = resolveSheetFormat(
    inferSheetFormat(sheetRows.map((entry) => entry.mapped), LEGACY_NUMERIC_FIELDS),
    options.numberFormat,
  )
  pushFormatConflict(rowErrors, format, rows[0]?.rowNumber ?? 1)

  sheetRows.forEach(({ row, mapped }) => {
    const rowNumber = row.rowNumber

    const bl_id = normalizeKey(mapped.bl_id)
    const consignee = asString(mapped.consignee)
    const cnpj_cpf = canonicalizeDocument(asString(mapped.cnpj_cpf))
    const pol = normalizeKey(mapped.pol)
    const pod = normalizeKey(mapped.pod)
    const item_description = asString(mapped.item_description)
    const numbers = readNumericColumns(mapped, LEGACY_NUMERIC_FIELDS, format)
    if (numbers.problems.length) {
      rowErrors.push({ row: rowNumber, message: numbers.problems.join(' '), raw: row })
      return
    }
    for (const warning of numbers.warnings) {
      rowErrors.push({ row: rowNumber, message: warning, raw: row, severity: 'warning' })
    }
    const package_qty = numbers.values.package_qty
    const gross_weight_kg = numbers.values.gross_weight_kg
    const cbm = numbers.values.cbm
    const package_unit = asNullableString(mapped.package_unit)
    const marks = asNullableString(mapped.marks)
    const shipper = asNullableString(mapped.shipper)

    if (!bl_id || !consignee || !cnpj_cpf || !pol || !pod || !item_description) {
      rowErrors.push({ row: rowNumber, message: 'Colunas obrigatorias ausentes ou invalidas.', raw: row })
      return
    }

    if (package_qty <= 0 || gross_weight_kg <= 0 || cbm < 0) {
      rowErrors.push({ row: rowNumber, message: 'Volumes, peso e CBM devem ser numericos validos.', raw: row })
      return
    }

    mappedRows.push({
      rowNumber,
      bl_id,
      consignee,
      cnpj_cpf,
      pol,
      pod,
      item_description,
      package_qty,
      gross_weight_kg,
      cbm,
      package_unit,
      marks,
      shipper,
    })
  })

  const byBl = new Map<string, BreakbulkImportRow>()

  for (const row of mappedRows) {
    const current = byBl.get(row.bl_id)
    if (!current) {
      byBl.set(row.bl_id, {
        rowNumber: row.rowNumber,
        bl_id: row.bl_id,
        ce_mercante: null,
        shipper: row.shipper,
        consignee: row.consignee,
        notify_party: null,
        cnpj_cpf: row.cnpj_cpf,
        pol: row.pol,
        pod: row.pod,
        bb_machine_qty: null,
        bb_packages_qty: row.package_qty,
        bb_packages_total: row.package_qty,
        bb_weight_ton: row.gross_weight_kg / 1000,
        bb_cbm: row.cbm,
        items: [
          {
            item_description: row.item_description,
            package_qty: row.package_qty,
            package_unit: row.package_unit,
            gross_weight_kg: row.gross_weight_kg,
            cbm: row.cbm,
            marks: row.marks,
          },
        ],
      })
      continue
    }

    if (
      current.consignee !== row.consignee ||
      current.cnpj_cpf !== row.cnpj_cpf ||
      current.pol !== row.pol ||
      current.pod !== row.pod
    ) {
      rowErrors.push({
        row: row.rowNumber,
        message: `BL ${row.bl_id} possui cabecalho inconsistente entre linhas.`,
        raw: row,
      })
      continue
    }

    current.bb_cbm += row.cbm
    current.bb_packages_total = Number(current.bb_packages_total ?? 0) + row.package_qty
    current.bb_packages_qty = Number(current.bb_packages_qty ?? 0) + row.package_qty
    current.bb_weight_ton = Number(current.bb_weight_ton ?? 0) + row.gross_weight_kg / 1000
    current.items.push({
      item_description: row.item_description,
      package_qty: row.package_qty,
      package_unit: row.package_unit,
      gross_weight_kg: row.gross_weight_kg,
      cbm: row.cbm,
      marks: row.marks,
    })
  }

  return {
    layout: 'legacy',
    bls: Array.from(byBl.values()),
    rowErrors,
  }
}

function detectLayout(rawHeaders: string[]): BreakbulkLayout {
  const normalizedHeaders = rawHeaders.map((header) => normalizeHeader(header))
  const hasSummarySignals =
    normalizedHeaders.includes(normalizeHeader('maquinas')) ||
    normalizedHeaders.includes(normalizeHeader('packages total')) ||
    normalizedHeaders.includes(normalizeHeader('weight (ton)'))

  return hasSummarySignals ? 'summary' : 'legacy'
}

function looksLikeCarrierBreakbulk(rows: (string | number | null)[][]) {
  const joined = rows.slice(0, 40).map((row) => row.map((cell) => asString(cell)).join(' '))
  const headerRow = rows.slice(0, 50).find((row) => isCarrierHeaderRow(row))
  if (!headerRow) return false

  const normalizedHeader = headerRow.map((cell) => normalizeHeader(asString(cell)))
  const hasCarrierColumns =
    normalizedHeader.some((cell) => ['pod', 'port of discharge', 'disch port'].includes(cell)) ||
    normalizedHeader.some((cell) => ['description of goods', 'description', 'decription'].includes(cell)) ||
    normalizedHeader.some((cell) => ['g.w(kgs)', 'gross weight', 'gross weight(kgs)'].includes(cell))

  return hasCarrierColumns || joined.some((row) => /\b((EXPORT|CARGO)\s+)?MANIFEST\b/i.test(row))
}

function inferPortFromText(value: string, kind: 'pol' | 'pod') {
  const text = normalizeHeader(value)
  if (kind === 'pol') {
    if (text.includes('taicang')) return normalizePortCode('taicang')
    if (text.includes('zhangjiagang')) return normalizePortCode('zhangjiagang')
    return null
  }
  if (text.includes('vitoria')) return normalizePortCode('vitoria')
  if (text.includes('salvador')) return normalizePortCode('salvador')
  return null
}

function isCarrierHeaderRow(row: (string | number | null)[]) {
  const normalized = row.map((cell) => normalizeHeader(asString(cell)))
  return normalized.some((cell) => ['bl no.', 'b/l no.', 'b/l nr.', 'b/l nr'].includes(cell))
}

function findCarrierColumnIndex(row: (string | number | null)[], candidates: string[]) {
  const normalizedCandidates = candidates.map((candidate) => normalizeHeader(candidate))
  return row.findIndex((cell) => normalizedCandidates.includes(normalizeHeader(asString(cell))))
}

function collectCarrierBlRows(rawRows: (string | number | null)[][], startIndex: number, colBl: number) {
  const rows = [rawRows[startIndex] ?? []]

  for (let index = startIndex + 1; index < rawRows.length; index += 1) {
    const row = rawRows[index] ?? []
    const candidateBl = asString(colBl >= 0 ? row[colBl] : row[0])
    const joined = row.map((cell) => asString(cell)).join(' ')

    if (looksLikeCarrierBreakbulkBl(candidateBl) || /^\s*(TOTAL|MASTER OF MV)\b/i.test(joined)) break
    rows.push(row)
  }

  return rows
}

function firstValueFromColumn(rows: (string | number | null)[][], columnIndex: number) {
  if (columnIndex < 0) return null
  for (const row of rows) {
    const value = row[columnIndex]
    if (asString(value)) return value
  }
  return null
}

function joinedStringsFromColumn(rows: (string | number | null)[][], columnIndex: number) {
  if (columnIndex < 0) return ''
  return rows.map((row) => asString(row[columnIndex])).filter(Boolean).join('\n')
}

function firstNumberFromColumn(rows: (string | number | null)[][], columnIndex: number, format: ImportNumberFormat) {
  if (columnIndex < 0) return null
  for (const row of rows) {
    const number = parseNumber(row[columnIndex], format) ?? parseLeadingNumber(row[columnIndex], format)
    if (number !== null) return number
  }
  return null
}

function findNumberBeforeUnit(rows: (string | number | null)[][], unitPattern: RegExp, format: ImportNumberFormat) {
  for (const row of rows) {
    for (let index = 1; index < row.length; index += 1) {
      if (!unitPattern.test(asString(row[index]))) continue
      const number = parseNumber(row[index - 1], format)
      if (number !== null) return number
    }
  }
  return null
}

function firstRawFromColumn(rows: (string | number | null)[][], columnIndex: number) {
  if (columnIndex < 0) return null
  for (const row of rows) {
    if (asString(row[columnIndex])) return row[columnIndex]
  }
  return null
}

function firstRawBeforeUnit(rows: (string | number | null)[][], unitPattern: RegExp) {
  for (const row of rows) {
    for (let index = 1; index < row.length; index += 1) {
      if (unitPattern.test(asString(row[index])) && asString(row[index - 1])) return row[index - 1]
    }
  }
  return null
}

/**
 * Divergência de um número do layout carrier, com a mesma régua dos outros
 * layouts: ausente, ilegível, absurdo ou ambíguo.
 *
 * A mensagem anterior dizia sempre "nao identificado ... confira a coluna de
 * peso", inclusive quando o valor estava lá e era o SEPARADOR que não dava para
 * decidir — o operador conferia a coluna, via o número no lugar, e não tinha o
 * que fazer.
 */
function describeCarrierNumber(
  field: DestinationField,
  blId: string,
  raw: unknown,
  parsed: number | null,
  resolved: ResolvedSheetFormat,
): { message: string; severity?: 'error' | 'warning' } | null {
  const label = NUMERIC_COLUMN_LABELS[field] ?? field
  const isWeight = field === 'gross_weight_kg'
  const shown = normalizeNumericText(raw)
  // `N/A`, `-` e afins não são número ilegível: são a ausência do dado escrita
  // à mão. A mensagem tem de dizer "ausente", não "não é um número válido".
  const hasNumber = Boolean(shown) && /^[+-]?\d/.test(shown as string)

  if (!hasNumber) {
    return isWeight
      ? { message: `Coluna ${label}: peso bruto ausente para o BL ${blId}; a taxa por tonelada depende dele.`, severity: 'error' }
      : { message: `Coluna ${label}: cubagem ausente para o BL ${blId}.`, severity: 'warning' }
  }
  if (parsed === null) {
    return { message: `Coluna ${label}: "${shown}" nao e um numero valido no formato lido (BL ${blId}).`, severity: 'error' }
  }
  if (isWeight && parsed <= 0) {
    return { message: `Coluna ${label}: peso bruto zerado para o BL ${blId}; a taxa por tonelada depende dele.`, severity: 'error' }
  }

  if (isThousandsGroupShape(raw, resolved.format)) {
    const message = `${describeAmbiguity(field, raw, parsed, resolved.format)} (BL ${blId})`
    return resolved.declared ? { message, severity: 'warning' } : { message, severity: 'error' }
  }
  const ceiling = NUMERIC_CEILINGS[field]
  if (ceiling && parsed > ceiling.max) {
    return { message: `${describeCeiling(field, raw, parsed, ceiling)} (BL ${blId})`, severity: 'error' }
  }
  return null
}

function validateRequiredHeaders(rawHeaders: string[], layout: BreakbulkLayout) {
  if (layout === 'carrier') return
  const requiredHeaders = layout === 'summary' ? bbRequiredHeaders : legacyRequiredHeaders
  const spec = layout === 'summary' ? SUMMARY_SPEC : LEGACY_SPEC
  const { missing: missingFields } = matchHeaders(rawHeaders, spec)
  const missing = missingFields.map((field) => {
    const index = (spec.required as readonly DestinationField[]).indexOf(field)
    return requiredHeaders[index] ?? field
  })

  if (missing.length) {
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${missing.join(', ')}.`)
  }
}

function mapRow(row: Record<string, unknown>, spec: HeaderSpec<DestinationField>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  const { columnByField } = matchHeaders(Object.keys(row), spec)
  for (const [field, column] of Object.entries(columnByField) as [DestinationField, string][]) mapped[field] = row[column]
  return mapped
}

export function buildBreakbulkSummaryDescription(bl: BreakbulkImportRow) {
  const parts = [
    bl.bb_machine_qty !== null ? `Maquinas: ${formatNullableNumber(bl.bb_machine_qty)}` : null,
    bl.bb_packages_qty !== null ? `Packages: ${formatNullableNumber(bl.bb_packages_qty)}` : null,
    bl.bb_packages_total !== null ? `Packages Total: ${formatNullableNumber(bl.bb_packages_total)}` : null,
  ].filter(Boolean)

  return parts.length ? parts.join(' | ') : null
}

function looksLikeCarrierBreakbulkBl(value: string) {
  const text = asString(value).toUpperCase()
  return /^(?=.*[A-Z])[A-Z0-9]{8,30}$/.test(text)
}

function parseCarrierSplitPartyRows(rows: (string | number | null)[][]) {
  const parties = {
    shipper: '',
    consignee: '',
    notifyParty: '',
    cnpj: '',
  }

  for (const row of rows) {
    const marker = normalizeHeader(asString(row[1])).replace(/:$/, '')
    const value = asString(row[2])
    if (!value) continue

    if (marker === 'sh') parties.shipper = value
    if (marker === 'cn' || marker === 'co') parties.consignee = value
    if (marker === 'np' || marker === 'nf') parties.notifyParty = value
  }

  parties.cnpj = extractTaxId(parties.consignee)
  return parties
}

function parseCarrierCombinedParties(value: string) {
  const sections = {
    shipper: extractCarrierPartySection(value, /Shipper\s*\(SH\)/i, /Consignee\s*\(CO\)/i),
    consignee: extractCarrierPartySection(value, /Consignee\s*\(CO\)/i, /Notify Address\s*\(NF\)/i),
    notifyParty: extractCarrierPartySection(value, /Notify Address\s*\(NF\)/i),
  }

  return {
    ...sections,
    cnpj: extractTaxId(sections.consignee),
  }
}

function extractCarrierPartySection(value: string, startPattern: RegExp, endPattern?: RegExp) {
  const startMatch = startPattern.exec(value)
  if (!startMatch) return ''

  const startIndex = startMatch.index + startMatch[0].length
  const rest = value.slice(startIndex)
  const endMatch = endPattern?.exec(rest)
  const section = (endMatch ? rest.slice(0, endMatch.index) : rest).trim()
  return firstMeaningfulPartyLine(section) || section
}


function parseCarrierBreakbulkParties(value: string) {
  const lines = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)

  const companyIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isLikelyCompanyLine(line))

  const documents = lines
    .map((line, index) => ({ line, index, document: extractTaxId(line) }))
    .filter((entry): entry is { line: string; index: number; document: string } => Boolean(entry.document))

  const shipperIndex = companyIndexes[0]?.index ?? -1
  const shipper = companyIndexes[0]?.line ?? lines[0] ?? ''
  const consignee =
    findNearestCompanyBeforeIndex(lines, documents[0]?.index ?? -1, shipperIndex + 1) ??
    companyIndexes.find((entry) => entry.index > shipperIndex)?.line ??
    ''
  const notifyParty =
    findNearestCompanyBeforeIndex(lines, documents[1]?.index ?? -1, (documents[0]?.index ?? -1) + 1) ??
    companyIndexes.find((entry) => entry.index > (documents[0]?.index ?? shipperIndex))?.line ??
    ''

  return {
    shipper,
    consignee,
    notifyParty,
    cnpj: documents[0]?.document ?? '',
  }
}

function parseCarrierPackageInfo(value: string, explicitQty: unknown) {
  const explicit = parseNumber(explicitQty, 'unknown') ?? parseLeadingNumber(explicitQty, 'unknown')
  if (explicit !== null && explicit >= 0) {
    return {
      quantity: explicit,
      unit: 'PACKAGES',
    }
  }

  const firstLine = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find(Boolean)

  const match = firstLine?.match(/^(\d+)\s+(.+)$/)
  return {
    quantity: match ? Number(match[1]) : null,
    unit: match ? match[2].trim().toUpperCase() : null,
  }
}

function parseLeadingNumber(value: unknown, format: ImportNumberFormat) {
  const text = asString(value)
  const match = text.match(/^(\d+(?:[.,]\d+)?)/)
  if (!match) return null
  return parseNumber(match[1], format)
}



function findNearestCompanyBeforeIndex(lines: string[], endIndex: number, minIndex = 0) {
  if (endIndex < 0) return null

  for (let index = endIndex - 1; index >= minIndex; index -= 1) {
    if (isLikelyCompanyLine(lines[index] ?? '')) {
      return lines[index] ?? null
    }
  }

  return null
}

function extractTaxId(value: string) {
  return extractCnpjFromText(value) ?? ''
}

function asNullableString(value: unknown) {
  const normalized = asString(value)
  return normalized ? normalized : null
}

function asNullableDigits(value: unknown) {
  const digits = onlyDigits(asString(value))
  return digits || null
}

function asNullableCnpj(value: unknown) {
  const cnpj = canonicalizeDocument(asString(value))
  return cnpj || null
}

function normalizeKey(value: unknown) {
  return asString(value).toUpperCase()
}

function nullableKey(value: unknown) {
  const normalized = normalizeKey(value)
  return normalized || null
}

const SUMMARY_NUMERIC_FIELDS = ['machine_qty', 'packages_qty', 'packages_total', 'gross_weight_ton', 'cbm'] as const
const LEGACY_NUMERIC_FIELDS = ['package_qty', 'gross_weight_kg', 'cbm'] as const

/** Nome da coluna como o operador a vê na planilha, para a mensagem de erro. */
const NUMERIC_COLUMN_LABELS: Record<string, string> = {
  machine_qty: 'MAQUINAS',
  packages_qty: 'PACKAGES',
  packages_total: 'PACKAGES TOTAL',
  gross_weight_ton: 'WEIGHT (TON)',
  package_qty: 'VOLUMES',
  gross_weight_kg: 'PESO_KG',
  cbm: 'CBM',
}

/**
 * Teto de absurdo por coluna: acima disso o número não descreve um B/L, seja
 * qual for o separador. É a rede que não depende de heurística nenhuma — pega o
 * ×1000 mesmo num arquivo cujo formato o operador declarou errado.
 *
 * ponytail: é um teto de sanidade, não uma regra de negócio. Não substitui o
 * bloqueio por ambiguidade (`259.312` -> 259.312 t passa por aqui de folga);
 * serve para o caso em que tudo o mais falhou. O caminho definitivo é validar
 * contra a capacidade declarada da viagem, que o sistema ainda não guarda.
 */
const NUMERIC_CEILINGS: Partial<Record<DestinationField, { max: number; unit: string }>> = {
  // Um navio de carga geral inteiro não passa de ~200 mil toneladas.
  gross_weight_ton: { max: 200_000, unit: 't' },
  gross_weight_kg: { max: 200_000_000, unit: 'kg' },
  // Capacidade volumétrica de um navio inteiro, com folga.
  cbm: { max: 400_000, unit: 'm3' },
  machine_qty: { max: 100_000, unit: 'un' },
  packages_qty: { max: 1_000_000, unit: 'vol' },
  packages_total: { max: 1_000_000, unit: 'vol' },
  package_qty: { max: 1_000_000, unit: 'vol' },
}

/**
 * Formato numérico do arquivo, como o parser passou a resolvê-lo.
 *
 * `declared` é o formato que o operador escolheu no modal de importação. Ele
 * existe porque nenhuma heurística fecha o caso sozinha: `259.312` só tem um
 * significado quando alguém diz qual é o separador decimal daquele arquivo.
 * Quando não há declaração, a evidência do próprio arquivo decide, e o que a
 * evidência não resolve vira erro bloqueante — nunca um palpite silencioso.
 */
export type BreakbulkNumberFormat = 'pt-BR' | 'en-US'

export type ResolvedSheetFormat = {
  /** Formato efetivamente usado na leitura. */
  format: BreakbulkNumberFormat
  /** `true` quando veio do operador, `false` quando veio da evidência ou do padrão. */
  declared: boolean
  /** Evidência encontrada no arquivo; `'unknown'` quando ele não desempata. */
  inferred: ImportNumberFormat
}

/**
 * Evidência de separador do arquivo inteiro, olhando todas as colunas
 * numéricas. Ler célula a célula não resolveria: `259.312` sozinho é ambíguo,
 * mas a planilha que em qualquer outra célula traz `12,5` já disse qual é o
 * separador decimal dela.
 */
function inferSheetFormat<TField extends DestinationField>(
  rows: Partial<Record<DestinationField, unknown>>[],
  fields: readonly TField[],
): ImportNumberFormat {
  return inferSeparatorFormat(rows.flatMap((row) => fields.map((field) => row[field])))
}

/**
 * Junta a declaração do operador com a evidência do arquivo.
 *
 * Sem declaração, a evidência manda. Se ela também não desempata, vale o
 * `fallback` do LAYOUT — e não um palpite global: o resumido e o legado são
 * planilhas que a própria tela documenta e distribui em pt-BR, enquanto o
 * layout do armador é um documento em inglês (`B/L NO.`, `KGS`, `CBMS`,
 * `DESCRIPTION OF GOODS`), cuja notação é en-US por construção. O que o
 * fallback não resolve continua virando erro bloqueante em
 * `readNumericColumns`.
 */
function resolveSheetFormat(
  inferred: ImportNumberFormat,
  declared: BreakbulkNumberFormat | undefined,
  fallback: BreakbulkNumberFormat = 'pt-BR',
): ResolvedSheetFormat {
  if (declared) return { format: declared, declared: true, inferred }
  if (inferred === 'unknown') return { format: fallback, declared: false, inferred }
  return { format: inferred, declared: false, inferred }
}

/**
 * O arquivo contradiz o que o operador declarou. Não é uma sutileza: se ele
 * escolheu `en-US` e alguma célula traz `12,5`, ler o arquivo inteiro em en-US
 * quebra essa célula e provavelmente todas as outras. Bloqueia e diz onde está
 * a contradição.
 */
function describeFormatConflict(resolved: ResolvedSheetFormat) {
  if (!resolved.declared || resolved.inferred === 'unknown' || resolved.inferred === resolved.format) return null
  return `Formato declarado (${formatLabel(resolved.format)}) contradiz o arquivo, que usa ${formatLabel(resolved.inferred)} `
    + 'em pelo menos uma celula. Troque o formato no modal ou corrija a planilha.'
}

function pushFormatConflict(
  rowErrors: ParsedBreakbulkManifest['rowErrors'],
  resolved: ResolvedSheetFormat,
  rowNumber: number,
) {
  const message = describeFormatConflict(resolved)
  if (message) rowErrors.push({ row: rowNumber, message, raw: null })
}

function formatLabel(format: ImportNumberFormat) {
  if (format === 'pt-BR') return 'virgula decimal (pt-BR)'
  if (format === 'en-US') return 'ponto decimal (en-US)'
  return 'formato indefinido'
}

type NumericCell = { ok: true; value: number } | { ok: false; reason: 'empty' | 'syntax' }

function readNumericCell(value: unknown, format: BreakbulkNumberFormat): NumericCell {
  const parsed = parseImportNumber(normalizeNumericText(value), format)
  if (parsed.kind === 'value') {
    const numeric = Number(parsed.decimal)
    return Number.isFinite(numeric) ? { ok: true, value: numeric } : { ok: false, reason: 'syntax' }
  }
  return { ok: false, reason: parsed.kind === 'empty' ? 'empty' : 'syntax' }
}

/**
 * Lê as colunas numéricas de uma linha, separando o que impede a importação do
 * que só pede conferência.
 *
 * O caso que importa é a célula da forma `259.312` lida como grupo de milhar:
 * ela pode ser 259 mil ou 259 e trezentos e doze milésimos, e a diferença vira
 * uma taxa por tonelada mil vezes maior.
 *
 * A checagem é ASSIMÉTRICA de propósito, e só olha a direção do grupo de
 * milhar. `259,312` lido em pt-BR já está resolvido — a vírgula é o decimal
 * naquele formato, e é a notação que a tela documenta e que os modelos
 * distribuem. Tratar as duas direções como ambíguas rejeitaria o próprio modelo
 * da tela, que não tem nenhuma célula desempatadora. O erro que esta função
 * existe para impedir é o que INFLA o número por mil e vai para a fatura.
 *
 * A regra é:
 *
 * - formato DECLARADO pelo operador -> aviso, com as duas leituras na mensagem.
 *   Ele afirmou o separador daquele arquivo; o parser registra o que entrou.
 * - formato inferido ou default -> ERRO bloqueante. Ninguem declarou nada, e um
 *   palpite nosso nao pode virar faturamento. A saida do operador e um clique
 *   no seletor de formato do modal.
 *
 * A checagem vale mesmo quando a evidencia do arquivo apontou um formato: era
 * exatamente essa a fresta — um arquivo com `1.217,11` numa coluna e
 * `259.312` na outra "provava" pt-BR e entregava o peso multiplicado por mil.
 */
function readNumericColumns<TField extends DestinationField>(
  mapped: Partial<Record<DestinationField, unknown>>,
  fields: readonly TField[],
  resolved: ResolvedSheetFormat,
) {
  const values = {} as Record<TField, number>
  const problems: string[] = []
  const warnings: string[] = []

  for (const field of fields) {
    const raw = mapped[field]
    const cell = readNumericCell(raw, resolved.format)
    if (!cell.ok) {
      problems.push(describeNumericProblem(field, raw, cell.reason))
      continue
    }

    // A ambiguidade vem antes do teto de propósito: quando as duas disparam, é
    // a ambiguidade que EXPLICA o número absurdo, e a mensagem dela diz o que
    // fazer. Avisar "acima do máximo" sobre um número que só está mil vezes
    // maior por causa do separador manda o operador conferir a coisa errada.
    if (isThousandsGroupShape(raw, resolved.format)) {
      const message = describeAmbiguity(field, raw, cell.value, resolved.format)
      if (!resolved.declared) {
        problems.push(message)
        continue
      }
      warnings.push(message)
    }

    const ceiling = NUMERIC_CEILINGS[field]
    if (ceiling && cell.value > ceiling.max) {
      problems.push(describeCeiling(field, raw, cell.value, ceiling))
      continue
    }

    values[field] = cell.value
  }

  return { values, problems, warnings }
}

/**
 * Mostra as DUAS leituras possíveis, lado a lado e com unidade.
 *
 * A versão anterior escrevia `"177.120" foi lido como 177.120`: o
 * `toLocaleString('pt-BR')` de 177120 é a mesma string do valor cru, então o
 * operador lia o mesmo número duas vezes e concluía que estava certo. Um aviso
 * que não mostra diferença nenhuma não é um aviso.
 */
function describeAmbiguity(
  field: string,
  raw: unknown,
  readValue: number,
  format: BreakbulkNumberFormat,
) {
  const label = NUMERIC_COLUMN_LABELS[field] ?? field
  const shown = normalizeNumericText(raw) ?? String(raw ?? '').trim()
  const separator = groupingSeparator(format)
  const asDecimal = Number(shown.replace(separator, '.'))
  return `Coluna ${label}: "${shown}" pode ser ${describeMagnitude(readValue)} (separador de milhar) `
    + `ou ${describeMagnitude(asDecimal)} (separador decimal), e a planilha nao desempata. `
    + `Declare o formato do arquivo no modal de importacao: a leitura atual e ${describeMagnitude(readValue)}.`
}

/** `259312` e `259,312` por extenso curto, para as duas leituras nao se confundirem. */
function describeMagnitude(value: number) {
  const exact = value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  if (Number.isInteger(value) && Math.abs(value) >= 1000) {
    return `${exact} (${Math.round(value / 1000).toLocaleString('pt-BR')} mil)`
  }
  return exact
}

function describeCeiling(field: string, raw: unknown, value: number, ceiling: { max: number; unit: string }) {
  const label = NUMERIC_COLUMN_LABELS[field] ?? field
  const shown = normalizeNumericText(raw) ?? String(raw ?? '').trim()
  return `Coluna ${label}: "${shown}" foi lido como ${value.toLocaleString('pt-BR')} ${ceiling.unit}, `
    + `acima do maximo plausivel para um B/L (${ceiling.max.toLocaleString('pt-BR')} ${ceiling.unit}). `
    + 'Confira a unidade e o separador decimal do arquivo.'
}

function describeNumericProblem(field: string, raw: unknown, reason: 'empty' | 'syntax') {
  const label = NUMERIC_COLUMN_LABELS[field] ?? field
  const shown = String(raw ?? '').trim()
  if (reason === 'empty') return `Coluna ${label}: valor obrigatorio ausente.`
  return `Coluna ${label}: "${shown}" nao e um numero valido no formato lido.`
}

function parseNumber(value: unknown, format: ImportNumberFormat = 'unknown') {
  const text = normalizeNumericText(value)
  const parsed = parseImportNumber(text, format)
  return parsed.kind === 'value' ? Number(parsed.decimal) : null
}

function formatNullableNumber(value: number | null) {
  return value === null ? '-' : Number(value).toLocaleString('pt-BR')
}
