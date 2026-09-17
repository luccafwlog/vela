// Parsing-only module for breakbulk manifests (summary, legacy and carrier
// layouts). Por contrato do playbook de imports, este módulo não faz escrita
// no Supabase nem importa React: transforma a planilha em um modelo tipado
// (ParsedBreakbulkManifest) com erros por linha. A persistência vive em
// breakbulkImport.ts.
import { assertUploadFile } from '../lib/fileGuard'
import { canonicalizeDocument, extractCnpjFromText } from '../lib/cnpj'
import { parseImportNumber, type ImportNumberFormat } from '../lib/importNumber'
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
  total_cbm: number
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
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseBreakbulkManifestFile(file: File): Promise<ParsedBreakbulkManifest> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseBreakbulkManifestBuffer(buffer)
}

export async function parseBreakbulkManifestBuffer(buffer: ArrayBuffer): Promise<ParsedBreakbulkManifest> {
  const { headers: rawHeaders, matrix, rows } = await readSheet(buffer)

  if (looksLikeCarrierBreakbulk(matrix as (string | number | null)[][])) {
    return parseCarrierBreakbulkRows(matrix as (string | number | null)[][])
  }

  const layout = detectLayout(rawHeaders)
  validateRequiredHeaders(rawHeaders, layout)
  return parseBreakbulkRows(rows, layout)
}

function parseBreakbulkRows(rows: SheetRow[], layout: BreakbulkLayout): ParsedBreakbulkManifest {
  return layout === 'summary' ? parseSummaryRows(rows) : parseLegacyRows(rows)
}

function parseCarrierBreakbulkRows(rawRows: (string | number | null)[][]): ParsedBreakbulkManifest {
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
    const grossWeightKg =
      firstNumberFromColumn(groupRows, colWeight, 'unknown') ?? findNumberBeforeUnit(groupRows, /^KGS?$/i, 'unknown') ?? 0
    const cbm = firstNumberFromColumn(groupRows, colCbm, 'en-US') ?? findNumberBeforeUnit(groupRows, /^CBMS?$/i, 'en-US') ?? 0
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
      total_cbm: cbm,
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

function parseSummaryRows(rows: SheetRow[]): ParsedBreakbulkManifest {
  const rowErrors: ParsedBreakbulkManifest['rowErrors'] = []
  const parsedRows: BreakbulkImportRow[] = []

  rows.forEach((row) => {
    const mapped = mapRow(row, SUMMARY_SPEC)
    const rowNumber = row.rowNumber

    const bl_id = normalizeKey(mapped.bl_id)
    const ce_mercante = asNullableDigits(mapped.ce_mercante)
    const machineQty = parseNumber(mapped.machine_qty)
    const packagesQty = parseNumber(mapped.packages_qty)
    const packagesTotal = parseNumber(mapped.packages_total)
    const weightTon = parseNumber(mapped.gross_weight_ton)
    const cbm = parseNumber(mapped.cbm)
    const shipper = asNullableString(mapped.shipper)
    const consignee = asString(mapped.consignee)
    const notifyParty = asNullableString(mapped.notify_party)
    const cnpjCpf = asNullableCnpj(mapped.cnpj_cpf)
    const pol = nullableKey(mapped.pol)
    const pod = nullableKey(mapped.pod)

    if (!bl_id || machineQty === null || packagesQty === null || packagesTotal === null || weightTon === null || cbm === null || !shipper || !consignee || !notifyParty) {
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
      total_cbm: cbm,
      items: [],
    })
  })

  return {
    layout: 'summary',
    bls: parsedRows,
    rowErrors,
  }
}

function parseLegacyRows(rows: SheetRow[]): ParsedBreakbulkManifest {
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

  rows.forEach((row) => {
    const mapped = mapRow(row, LEGACY_SPEC)
    const rowNumber = row.rowNumber

    const bl_id = normalizeKey(mapped.bl_id)
    const consignee = asString(mapped.consignee)
    const cnpj_cpf = canonicalizeDocument(asString(mapped.cnpj_cpf))
    const pol = normalizeKey(mapped.pol)
    const pod = normalizeKey(mapped.pod)
    const item_description = asString(mapped.item_description)
    const package_qty = parseNumber(mapped.package_qty)
    const gross_weight_kg = parseNumber(mapped.gross_weight_kg)
    const cbm = parseNumber(mapped.cbm)
    const package_unit = asNullableString(mapped.package_unit)
    const marks = asNullableString(mapped.marks)
    const shipper = asNullableString(mapped.shipper)

    if (!bl_id || !consignee || !cnpj_cpf || !pol || !pod || !item_description || package_qty === null || gross_weight_kg === null || cbm === null) {
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
        total_cbm: row.cbm,
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

    current.total_cbm += row.cbm
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

function parseNumber(value: unknown, format: ImportNumberFormat = 'pt-BR') {
  const text = typeof value === 'string'
    ? value.trim().match(/^[+-]?\d[\d.,]*/)?.[0] ?? value.trim()
    : value
  const parsed = parseImportNumber(text, format)
  return parsed.kind === 'value' ? Number(parsed.decimal) : null
}

function formatNullableNumber(value: number | null) {
  return value === null ? '-' : Number(value).toLocaleString('pt-BR')
}
