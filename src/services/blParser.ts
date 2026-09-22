import { assertUploadFile } from '../lib/fileGuard'
import { canonicalizeValidCnpj } from '../lib/cnpj'
import { parseImportNumber } from '../lib/importNumber'
import { asString } from '../lib/utils'
import { normalizeIsoContainerNumber } from '../lib/containerNumber'
import { detectImportFormat } from './importText'

export type BLFreightCharge = {
  description: string
  rateCurrency: string | null
  rateAmount: number | null
  per: string | null
  currency: string | null
  amount: number | null
  payment: 'PREPAID' | 'COLLECT' | null
}

export type ParsedBLContainer = {
  containerNumber: string
  sealNumber: string | null
  tareKg: number | null
  ownership: string | null
  packages: string | null
  type: string | null
  grossWeightKg: number | null
  cbm: number | null
}

export type ParsedBLVehicle = {
  chassis: string
  containerNumber: string | null
  blNumber: string | null
  brand: string | null
  model: string | null
  weightKg: number | null
  cbm: number | null
}

export type ParsedBLDocument = {
  blNumber: string
  parties: {
    shipperBlock: string
    consigneeBlock: string
    consigneeTaxId: string | null
    consigneeEmail?: string | null
    notifyBlock: string
    alsoNotifyBlock: string
  }
  route: {
    receipt: string
    pol: string
    pod: string
    delivery: string
    vessel: string
    voyage: string
    movementFrom: string
    movementTo: string
  }
  dates: {
    ladenOnBoard: string
    issueDate: string
    issuePlace: string
  }
  cargo: {
    description: string
    totalPackages: number | null
    packagesUnit: string | null
    dgClass: string | null
    unNumber: string | null
  }
  containers: ParsedBLContainer[]
  vehicles: ParsedBLVehicle[]
  freightCharges: BLFreightCharge[]
}

type RawSheetRow = unknown[]

export async function parseBLFile(file: File): Promise<ParsedBLDocument> {
  assertUploadFile(file, ['xlsx', 'xls'])
  const buffer = await file.arrayBuffer()
  return parseBLBuffer(buffer)
}

export async function parseBLBuffer(buffer: ArrayBuffer): Promise<ParsedBLDocument> {
  const format = detectImportFormat(buffer)
  if (format !== 'xlsx' && format !== 'xls') throw new Error('Arquivo B/L não reconhecido como XLS/XLSX.')
  const XLSX = await import('@e965/xlsx')
  // cellDates: cells formatted as dates in the source workbook (e.g. Laden On
  // Board) come back as JS Date objects instead of Excel serial numbers, so
  // dateCell() below can format them reliably regardless of carrier template.
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  // ponytail: acoplado ao layout COSCO Page 1; upgrade = detectar layout por armador/template.
  const page1 = workbook.Sheets['Page 1'] ?? workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<RawSheetRow>(page1, { header: 1, defval: '' })
  const vesselVoyage = parseVesselVoyage(cell(rows, 18, 'A'))
  const cargoDescription = parseCargoDescription(rows)
  const packages = parseTotalPackages(rows)

  return {
    blNumber: cell(rows, 6, 'AC'),
    parties: {
      shipperBlock: cell(rows, 6, 'A'),
      consigneeBlock: cell(rows, 10, 'A'),
      consigneeTaxId: extractTaxId(cell(rows, 10, 'A')),
      consigneeEmail: extractEmail(cell(rows, 10, 'A')),
      notifyBlock: cell(rows, 14, 'A'),
      alsoNotifyBlock: cell(rows, 14, 'T'),
    },
    route: {
      receipt: cell(rows, 16, 'G'),
      pol: cell(rows, 18, 'G'),
      pod: cell(rows, 20, 'A'),
      delivery: cell(rows, 20, 'G'),
      vessel: vesselVoyage.vessel,
      voyage: vesselVoyage.voyage,
      movementFrom: cell(rows, 20, 'T'),
      movementTo: cell(rows, 20, 'AC'),
    },
    dates: {
      ladenOnBoard: dateCell(rows, 35, 'AB'),
      // Real COSCO templates write the label and value in the same cell
      // ("Date of Issue 22 05 2026", "Place of Issue VITORIA") instead of the
      // clean value alone; strip the label so normalizeDate/consumers see just
      // the date or place text.
      issueDate: stripLabelPrefix(dateCell(rows, 38, 'A'), /^date\s+of\s+issue\s*/i),
      issuePlace: stripLabelPrefix(cell(rows, 38, 'E'), /^place\s+of\s+issue\s*/i),
    },
    cargo: {
      description: cargoDescription,
      totalPackages: packages.totalPackages,
      packagesUnit: packages.packagesUnit,
      dgClass: extractDgClass(cargoDescription),
      unNumber: extractUnNumber(cargoDescription),
    },
    containers: parseContainers(rows),
    vehicles: parseVehicles(workbook, XLSX.utils),
    freightCharges: parseFreightCharges(rows),
  }
}

const DG_CLASS_PATTERN = /DG\s*CLASS\s*[:.]?\s*([0-9](?:\.[0-9])?)/i
const UN_NUMBER_PATTERN = /UN\s*(?:NCM|NO\.?|NUMBER)?\s*[:.]?\s*(\d{4})\b/i

function parseCargoDescription(rows: RawSheetRow[]) {
  for (let rowNumber = 40; rowNumber <= 50; rowNumber += 1) {
    if (/Description of Goods/i.test(cell(rows, rowNumber, 'J'))) {
      return cell(rows, rowNumber + 1, 'J')
    }
  }
  return cell(rows, 44, 'J')
}

function parseTotalPackages(rows: RawSheetRow[]) {
  for (let rowNumber = 44; rowNumber <= 60; rowNumber += 1) {
    if (cell(rows, rowNumber, 'A').trim() !== 'TOTAL:') continue
    // ponytail: reconhece apenas unidade de palavra unica (UNITS, PACKAGES) e
    // milhar no formato que toNumber entende. Unidade composta ("BIG BAGS") cai
    // para null. Campo comercial/exibicao, sem impacto em faturamento; estender
    // a classe para [A-Z ]+ e normalizar milhar se surgir B/L multi-palavra.
    const match = cell(rows, rowNumber, 'C').match(/^\s*(\d[\d.,]*)\s+([A-Z]+)\s*$/i)
    return {
      totalPackages: match ? parseNumber(match[1]) : null,
      packagesUnit: match ? match[2].toUpperCase() : null,
    }
  }
  return { totalPackages: null, packagesUnit: null }
}

function extractDgClass(value: string) {
  return value.match(DG_CLASS_PATTERN)?.[1] ?? null
}

function extractUnNumber(value: string) {
  return value.match(UN_NUMBER_PATTERN)?.[1] ?? null
}


const FREIGHT_HEADER_VALUES = new Set(['RATE', 'PER', 'PREPAID', 'COLLECT'])

export function isInvalidFreightDescription(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase()
  if (!normalized) return true

  // Só os rótulos isolados são cabeçalhos. Prefixos como "RATE ADJUSTMENT"
  // e "PREPAID HANDLING" são descrições comerciais válidas.
  if (/^(?:11[.\s]*)?FREIGHT\s*(?:&|AND)\s*CHARGES$/.test(normalized)) return true
  if (/^(?:REVENUE\s*TONS?|RATE|PER|PREPAID|COLLECT)$/.test(normalized)) return true

  // Cláusulas contratuais são reconhecidas pela frase jurídica ancorada, não
  // por qualquer ocorrência de "ORDER", "GOODS" ou "CONTAINER".
  return [
    /^(?:4\.\s*)?RECEIVED\s+(?:IN|BY)\b.*APPARENT\s+GOOD\s+ORDER\b/,
    /^APPARENT\s+GOOD\s+ORDER\b/,
    /^SHIPPER'?S\s+LOAD\b/,
    /^NOTWITHSTANDING\s+ANY\s+PROVISION\b/,
    /^TERMS\s+AND\s+CONDITIONS\b/,
    /^PARTICULARS\s+FURNISHED\b/,
  ].some((pattern) => pattern.test(normalized))
}

function isFreightHeaderRow(row: RawSheetRow | undefined): boolean {
  const valueCells = [7, 11, 22, 23].map((index) => cellValue(row, index).trim().replace(/\s+/g, ' ').toUpperCase())
  const labelCount = valueCells.filter((value) => FREIGHT_HEADER_VALUES.has(value)).length
  return labelCount >= 2
}

function hasNumericFreightValue(values: string[]): boolean {
  return values.some((value) => parseMoney(value).amount !== null)
}

function isInvalidFreightRow(row: RawSheetRow | undefined): boolean {
  const rateText = cellValue(row, 7)
  const amount = cellValue(row, 15)
  const prepaid = cellValue(row, 22)
  const collect = cellValue(row, 23)

  // A numeric value is stronger evidence than a description prefix. This keeps
  // legitimate charges such as "4 X 40HC OCEAN FREIGHT" and "PER DIEM".
  if (hasNumericFreightValue([rateText, amount, prepaid, collect])) return false

  return isFreightHeaderRow(row) || isInvalidFreightDescription(cellValue(row, 0))
}

function parseFreightCharges(rows: RawSheetRow[]): BLFreightCharge[] {
  const charges: BLFreightCharge[] = []

  for (let rowIndex = 25; rowIndex < 46; rowIndex += 1) {
    const row = rows[rowIndex]
    const description = cellValue(row, 0)
    if (!description || isInvalidFreightRow(row)) {
      continue
    }

    const rateText = cellValue(row, 7)
    const per = cellValue(row, 11) || null
    const prepaid = cellValue(row, 22)
    const collect = cellValue(row, 23)
    const amount = cellValue(row, 15)
    if (!rateText && !per && !amount && !prepaid && !collect) continue

    const rate = parseMoney(rateText)
    const amountText = amount || prepaid || collect || rateText
    const money = parseMoney(amountText)

    charges.push({
      description,
      rateCurrency: rate.currency,
      rateAmount: rate.amount,
      per,
      currency: money.currency,
      amount: money.amount,
      payment: prepaid ? 'PREPAID' : collect ? 'COLLECT' : null,
    })
  }

  return charges
}

function parseContainers(rows: RawSheetRow[]): ParsedBLContainer[] {
  const containers: ParsedBLContainer[] = []
  const seen = new Set<string>()

  for (let rowIndex = 46; rowIndex < rows.length; rowIndex += 1) {
    const line = cellValue(rows[rowIndex], 0)
    if (!line) continue

    const parts = line.split('/').map((part) => part.trim())
    const containerNumber = normalizeIsoContainerNumber(parts[0])
    if (!containerNumber || seen.has(containerNumber)) continue
    seen.add(containerNumber)

    containers.push({
      containerNumber,
      sealNumber: parts[1] || null,
      tareKg: parseNumber(parts[2], 'pt-BR'),
      ownership: parts[3] || null,
      packages: parts[4] || null,
      type: parts[5] || null,
      grossWeightKg: parseNumber(parts[6], 'pt-BR'),
      cbm: parseNumber(parts[7], 'en-US'),
    })
  }

  return containers
}

function parseVehicles(workbook: { Sheets: Record<string, unknown> }, utils: typeof import('@e965/xlsx').utils) {
  const vinSheetName = Object.keys(workbook.Sheets).find((name) => name.trim().toUpperCase() === 'VIN')
  const vinSheet = vinSheetName ? workbook.Sheets[vinSheetName] : null
  if (!vinSheet) return []

  const rows = utils.sheet_to_json<Record<string, unknown>>(vinSheet, { defval: '' })
  return rows.flatMap((row) => {
    const chassis = findHeaderValue(row, ['CHASSIS', 'CHASSI', 'VIN'])
    if (!chassis) return []

    return [{
      chassis,
      containerNumber: findHeaderValue(row, ['CONTAINERNO']) || null,
      blNumber: findHeaderValue(row, ['BLNO', 'BL']) || null,
      brand: findHeaderValue(row, ['BRAND', 'MARCA']) || null,
      model: findHeaderValue(row, ['MODEL', 'MODELO']) || null,
      weightKg: parseNumber(findHeaderValue(row, ['WEIGHTKG', 'WEIGHT', 'PESO']), 'unknown'),
      cbm: parseNumber(findHeaderValue(row, ['CBM', 'M3', 'CUBICMETERS', 'CUBAGEM']), 'unknown'),
    }]
  })
}

function findHeaderValue(row: Record<string, unknown>, names: string[]) {
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (names.includes(normalizedKey)) return asString(value)
  }
  return ''
}

function parseVesselVoyage(value: string) {
  const match = value.match(/^(.+)\s+([A-Z0-9-]+)$/i)
  return {
    vessel: match ? match[1].trim() : value,
    voyage: match ? match[2].trim() : '',
  }
}

function parseMoney(value: string) {
  const currency = value.match(/\b[A-Z]{3}\b/i)?.[0]?.toUpperCase() ?? null
  const numericToken = value.match(/[+-]?\d[\d.,]*/)?.[0] ?? ''
  return { currency, amount: parseNumber(numericToken, 'unknown') }
}

function parseNumber(value: unknown, format: 'pt-BR' | 'en-US' | 'unknown' = 'unknown') {
  const text = typeof value === 'string'
    ? value.trim().match(/^[+-]?\d[\d.,]*/)?.[0] ?? value.trim()
    : value
  const parsed = parseImportNumber(text, format)
  return parsed.kind === 'value' ? Number(parsed.decimal) : null
}

export function extractTaxId(value: string) {
  const pattern = /([0-9A-Z]{2}[./][0-9A-Z]{3}[./][0-9A-Z]{3}\/[0-9A-Z]{4}-[0-9]{2}|[0-9A-Z]{14})/i
  const labeled = value.match(/\bCNPJ\b\s*[:-]?\s*/i)
  const searchValue = labeled ? value.slice(labeled.index! + labeled[0].length) : value
  for (const match of searchValue.matchAll(new RegExp(pattern.source, 'gi'))) {
    const cnpj = canonicalizeValidCnpj(match[1] ?? '')
    if (cnpj) return cnpj
  }
  return null
}

export function extractEmail(value: string) {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null
}

function cell(rows: RawSheetRow[], rowNumber: number, column: string) {
  return cellValue(rows[rowNumber - 1], columnIndex(column))
}

// Some carrier templates format the Laden On Board / Issue Date cells as real
// Excel dates rather than text; sheet_to_json then yields a JS Date (with
// cellDates: true) instead of the DD/MM/YYYY string normalizeDate() expects.
// Format those as ISO here so the value survives the same as a text cell.
function stripLabelPrefix(value: string, label: RegExp) {
  return value.replace(label, '').trim()
}

function dateCell(rows: RawSheetRow[], rowNumber: number, column: string) {
  const raw = rows[rowNumber - 1]?.[columnIndex(column)]
  if (raw instanceof Date) {
    const year = raw.getUTCFullYear()
    const month = String(raw.getUTCMonth() + 1).padStart(2, '0')
    const day = String(raw.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return asString(raw)
}

function cellValue(row: RawSheetRow | undefined, index: number) {
  return asString(row?.[index])
}

function columnIndex(column: string) {
  return column.split('').reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1
}
