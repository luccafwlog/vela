// Leitura de B/L avulso (o documento do armador, não o manifesto da viagem).
// Por contrato do playbook de imports, este módulo não escreve no Supabase nem
// importa React: transforma o arquivo (.pdf ou .docx) em um modelo tipado
// (ParsedBlDocument) com avisos por campo. A persistência reaproveita o
// caminho do manifesto BB e vive em blDocumentImport.ts.
import { extractCnpjFromText } from '../lib/cnpj'
import { assertUploadFile } from '../lib/fileGuard'
import { parseImportNumber, type ImportNumberFormat } from '../lib/importNumber'
import { extractNcmCodes } from '../lib/ncm'
import {
  extractCarrierMachineQty,
  firstMeaningfulPartyLine,
  normalizeCarrierBreakbulkDescription,
} from './breakbulkCargoText'
import type { BreakbulkImportRow, ParsedBreakbulkManifest } from './breakbulkManifestParser'
import { extractDocxTextBlocks } from './blDocumentDocx'
import {
  collectFieldsFromBlocks,
  collectFieldsFromPdfLabels,
  groupRunsIntoBlocks,
  NUMBER_WORDS,
  SAY_TOTAL_PATTERN,
  VESSEL_VOYAGE_PATTERN,
  type BlDocumentFields,
} from './blDocumentFields'
import { extractPdfPages } from './blDocumentPdf'
import type { BlDocumentFormat } from './blDocumentSource'
import { normalizePortCode } from './portCode'

/** Como o documento foi lido: pelos rótulos impressos ou pelo conteúdo dos campos. */
export type BlDocumentLayout = 'labeled' | 'form'

export type ParsedBlDocument = {
  format: BlDocumentFormat
  layout: BlDocumentLayout
  bl_id: string
  shipper: string | null
  consignee: string | null
  notify_party: string | null
  cnpj_cpf: string | null
  vessel_name: string | null
  voyage_number: string | null
  pol: string | null
  pod: string | null
  pol_raw: string | null
  pod_raw: string | null
  originals: number | null
  packages_qty: number | null
  package_unit: string | null
  machine_qty: number | null
  cargo_description: string | null
  ncm_codes: string[]
  marks: string | null
  gross_weight_kg: number | null
  total_cbm: number | null
  freight_terms: string | null
  place_and_date_of_issue: string | null
  remarks: string | null
  /** Impedem a importação (o documento não identifica o B/L). */
  errors: string[]
  /** Não impedem a importação, mas pedem conferência do operador. */
  warnings: string[]
}

const CONSIGNEE_FALLBACK = 'CONSIGNATARIO NAO IDENTIFICADO'
const PACKAGE_LINE_PATTERN =
  /^(\d+)\s+(PACKAGES?|PKGS?|CASES?|CARTONS?|CRATES?|BOXES|BUNDLES?|PALLETS?|PIECES?|PCS|UNITS?|BAGS?|DRUMS?|ROLLS?|COILS?|SKIDS?|CTNS?)\b/i
const FREIGHT_TERMS_PATTERN = /\bFREIGHT\s+(PREPAID|COLLECT)\b/i
const TON_PATTERN = /\b(?:TONS?|TONNES?|MTS?|M\/?T)\b/i

/** Lê um B/L avulso enviado pelo operador (.pdf ou .docx). */
export async function parseBlDocumentFile(file: File): Promise<ParsedBlDocument> {
  assertUploadFile(file, ['pdf', 'docx'])
  const format: BlDocumentFormat = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx'
  return parseBlDocumentBuffer(await file.arrayBuffer(), format)
}

export async function parseBlDocumentBuffer(
  buffer: ArrayBuffer,
  format: BlDocumentFormat,
): Promise<ParsedBlDocument> {
  if (format === 'docx') {
    const blocks = await extractDocxTextBlocks(buffer)
    return normalizeBlDocumentFields(collectFieldsFromBlocks(blocks), format, 'form')
  }

  const pages = await extractPdfPages(buffer)
  const labeled = collectFieldsFromPdfLabels(pages)
  if (labeled) return normalizeBlDocumentFields(labeled, format, 'labeled')
  // PDF sem rótulo em texto (formulário escaneado impresso em PDF): cai na
  // mesma leitura por conteúdo usada no .docx.
  return normalizeBlDocumentFields(collectFieldsFromBlocks(groupRunsIntoBlocks(pages)), format, 'form')
}

export function normalizeBlDocumentFields(
  fields: BlDocumentFields,
  format: BlDocumentFormat,
  layout: BlDocumentLayout,
): ParsedBlDocument {
  const errors: string[] = []
  const warnings: string[] = []

  const blId = normalizeBlNumber(fields.blNumber)
  if (!blId) errors.push('Número do B/L não encontrado no documento.')

  const consignee = partyName(fields.consignee)
  if (!consignee) warnings.push('Consignatário não identificado no documento.')

  const cnpj = extractCnpjFromText(fields.consignee)
  if (!cnpj) warnings.push('CNPJ do consignatário não encontrado — o B/L entra pendente de reconciliação.')

  const { vessel, voyage } = splitVesselAndVoyage(fields.vessel)
  if (fields.vessel && !voyage) {
    warnings.push(`Número da viagem não identificado em "${fields.vessel}".`)
  }

  const pol = resolvePort(fields.pol, 'POL', warnings)
  const pod = resolvePort(fields.pod, 'POD', warnings)

  const description = fields.description ?? ''
  const packages = readPackages(description, fields.sayTotal, warnings)
  const weight = readWeight(fields.grossWeight, warnings)
  const cbm = readMeasurement(fields.measurement)
  if (weight === null) warnings.push('Peso bruto não encontrado no documento.')
  if (cbm === null) warnings.push('Cubagem (CBM) não encontrada no documento.')

  return {
    format,
    layout,
    bl_id: blId,
    shipper: partyName(fields.shipper),
    consignee,
    notify_party: partyName(fields.notifyParty),
    cnpj_cpf: cnpj,
    vessel_name: vessel,
    voyage_number: voyage,
    pol,
    pod,
    pol_raw: fields.pol,
    pod_raw: fields.pod,
    originals: readCount(fields.originals),
    packages_qty: packages.quantity,
    package_unit: packages.unit,
    machine_qty: description ? extractCarrierMachineQty(description) : null,
    cargo_description: description ? normalizeCarrierBreakbulkDescription(description) || null : null,
    ncm_codes: [...new Set(extractNcmCodes(description))],
    marks: fields.marks,
    gross_weight_kg: weight,
    total_cbm: cbm,
    freight_terms: readFreightTerms(fields.freight, description),
    place_and_date_of_issue: fields.placeAndDateOfIssue,
    remarks: fields.remarks,
    errors,
    warnings,
  }
}

/**
 * Converte o B/L lido no mesmo modelo do manifesto BB, para que a importação
 * siga pelo caminho já em uso (reconciliação de cliente, RPC transacional,
 * taxas locais). Os avisos viajam como erros de linha para ficarem registrados
 * no lote — a conferência do operador é o que fecha a importação.
 */
export function blDocumentToManifest(document: ParsedBlDocument): ParsedBreakbulkManifest {
  const weightKg = document.gross_weight_kg ?? 0
  const cbm = document.total_cbm ?? 0
  const row: BreakbulkImportRow = {
    rowNumber: 1,
    bl_id: document.bl_id,
    ce_mercante: null,
    shipper: document.shipper,
    consignee: document.consignee ?? CONSIGNEE_FALLBACK,
    notify_party: document.notify_party,
    cnpj_cpf: document.cnpj_cpf,
    pol: document.pol,
    pod: document.pod,
    bb_machine_qty: document.machine_qty,
    bb_packages_qty: document.packages_qty,
    bb_packages_total: document.packages_qty,
    bb_weight_ton: weightKg > 0 ? weightKg / 1000 : null,
    total_cbm: cbm,
    items: [
      {
        item_description: document.cargo_description ?? '',
        package_qty: document.packages_qty ?? 0,
        package_unit: document.package_unit,
        gross_weight_kg: weightKg,
        cbm,
        marks: document.marks,
      },
    ],
  }

  return {
    layout: 'bl_document',
    bls: [row],
    rowErrors: document.warnings.map((message) => ({
      row: 1,
      message: `Aviso: ${message}`,
      raw: { bl_id: document.bl_id },
    })),
  }
}

function normalizeBlNumber(value: string | null) {
  const text = (value ?? '')
    .replace(/^\s*B\/?L\s*(?:NO|N[oº]|NUMBER)?\.?:?\s*/i, '')
    .replace(/\s+/g, '')
    .toUpperCase()
  return /^[A-Z0-9][A-Z0-9-]{4,29}$/.test(text) ? text : ''
}

function partyName(block: string | null) {
  if (!block) return null
  const line = firstMeaningfulPartyLine(block)
    // O nome costuma vir com o documento colado ("TIMBRO TRADING S.A - CNPJ: ...").
    .replace(/\s*[-–—]?\s*(?:CNPJ|CPF|TAX\s*ID)\b.*$/i, '')
    .replace(/[\s,;-]+$/, '')
    .trim()
  return line || null
}

function splitVesselAndVoyage(value: string | null) {
  if (!value) return { vessel: null, voyage: null }
  const match = value.match(VESSEL_VOYAGE_PATTERN)
  if (!match) return { vessel: value.trim() || null, voyage: null }
  return { vessel: match[1].trim() || null, voyage: match[2].toUpperCase() }
}

function resolvePort(value: string | null, label: string, warnings: string[]) {
  if (!value) {
    warnings.push(`${label} não encontrado no documento.`)
    return null
  }

  const code = normalizePortCode(value)
  if (!code || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(code)) {
    warnings.push(`${label} "${value}" não corresponde a um porto conhecido — confira antes de importar.`)
    return code
  }
  return code
}

function readCount(value: string | null) {
  if (!value) return null
  const digits = value.match(/\b(\d{1,4})\b/)
  if (digits) return Number(digits[1])
  return parseNumberWords(value)
}

function readPackages(description: string, sayTotal: string | null, warnings: string[]) {
  const line = description.split(/\r?\n/).map((entry) => entry.trim()).find((entry) => PACKAGE_LINE_PATTERN.test(entry))
  const match = line?.match(PACKAGE_LINE_PATTERN) ?? null
  const quantity = match ? Number(match[1]) : null
  const unit = match ? match[2].toUpperCase() : null

  if (quantity === null) {
    warnings.push('Quantidade de volumes não identificada na descrição da carga.')
  }

  const declared = readSayTotal(sayTotal)
  if (quantity !== null && declared !== null && declared !== quantity) {
    warnings.push(`Volumes divergem do total por extenso: ${quantity} na descrição e ${declared} em "${sayTotal}".`)
  }

  return { quantity: quantity ?? declared, unit }
}

/** "SAY TOTAL SIX PACKAGES ONLY" -> 6. É a conferência que o próprio B/L traz. */
function readSayTotal(value: string | null) {
  const match = (value ?? '').match(SAY_TOTAL_PATTERN)
  if (!match) return null
  return parseNumberWords(match[1])
}

function parseNumberWords(value: string) {
  const words = value
    .toUpperCase()
    .split(/[\s-]+/)
    .map((word) => word.trim())
    .filter((word) => word && word !== 'AND')

  let total = 0
  let matched = false
  for (const word of words) {
    if (word === 'HUNDRED') {
      total = (total || 1) * 100
      matched = true
      continue
    }
    if (word === 'THOUSAND') {
      total = (total || 1) * 1000
      matched = true
      continue
    }
    const number = NUMBER_WORDS.get(word)
    if (number === undefined) continue
    total += number
    matched = true
  }

  return matched ? total : null
}

function readWeight(value: string | null, warnings: string[]) {
  if (!value) return null
  const match = value.match(/(\d[\d.,]*)\s*([A-Z/]*)/i)
  if (!match) return null

  const amount = parseAmount(match[1], { thousandsAware: true, format: 'unknown' })
  if (amount === null) return null
  if (amount.usedThousandsSeparator) {
    warnings.push(`Peso "${match[1]}" lido como ${amount.value} kg (ponto tratado como separador de milhar).`)
  }
  return TON_PATTERN.test(value) ? amount.value * 1000 : amount.value
}

function readMeasurement(value: string | null) {
  if (!value) return null
  const match = value.match(/(\d[\d.,]*)/)
  // CBM é escrito com decimais no B/L ("55.244"), então aqui o ponto é sempre
  // separador decimal — o contrário do peso.
  return match ? parseAmount(match[1], { thousandsAware: false, format: 'en-US' })?.value ?? null : null
}

/**
 * ponytail: "11.652" é 11652 kg e "55.244" é 55,244 CBM — o mesmo desenho
 * significa coisas diferentes conforme a grandeza, e o B/L não diz qual usou.
 * A regra aqui é a única desambiguação possível sem adivinhar: grupos de
 * exatamente três dígitos são milhar quando a grandeza é peso, e o operador é
 * avisado sempre que essa leitura for aplicada. Upgrade path = ler a unidade
 * declarada no manifesto da viagem quando ele existir para o mesmo B/L.
 */
function parseAmount(value: string, options: { thousandsAware: boolean; format: ImportNumberFormat }) {
  const text = value.trim()
  if (options.thousandsAware && /^\d{1,3}(\.\d{3})+$/.test(text)) {
    const parsed = parseImportNumber(text.replace(/\./g, ''), 'unknown')
    return parsed.kind === 'value'
      ? { value: Number(parsed.decimal), usedThousandsSeparator: true }
      : null
  }

  const parsed = parseImportNumber(text, options.format)
  return parsed.kind === 'value'
    ? { value: Number(parsed.decimal), usedThousandsSeparator: false }
    : null
}

function readFreightTerms(freight: string | null, description: string) {
  const match = (freight ?? '').match(FREIGHT_TERMS_PATTERN) ?? description.match(FREIGHT_TERMS_PATTERN)
  return match ? match[1].toUpperCase() : null
}
