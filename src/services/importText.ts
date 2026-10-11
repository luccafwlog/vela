// Fronteira de bytes dos imports (S03 P0-3/§2.1): decode explícito de
// CSV/EDI a partir de ArrayBuffer. XLS/XLSX é binário e nunca passa por aqui.
export type ImportTextEncoding = 'utf-8' | 'utf-8-sig' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export type DecodedImportText = {
  text: string
  encoding: ImportTextEncoding
  hadBom: boolean
}

export type ImportFileFormat = 'xlsx' | 'xls' | 'csv' | 'edi'

export type ImportFileInspection = {
  format: ImportFileFormat
  encoding: ImportTextEncoding | null
  hadBom: boolean
  preview: string | null
  byteLength: number
}

export type InspectImportFileOptions = DecodeImportBytesOptions & { previewChars?: number }

export type DecodeImportBytesOptions = {
  /** Fallback Windows-1252 somente para origem autorizada (ex.: Baplie legado). Default estrito. */
  allowWindows1252Fallback?: boolean
}

// Magic de planilha binária: ZIP (xlsx) e OLE (xls). Texto nunca começa assim.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

export function isBinarySpreadsheetBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 4) return false
  const isZip = ZIP_MAGIC.every((b, i) => bytes[i] === b)
  const isOle = OLE_MAGIC.every((b, i) => bytes[i] === b)
  return isZip || isOle
}

export function decodeImportBytes(buffer: ArrayBuffer, options: DecodeImportBytesOptions = {}): DecodedImportText {
  if (isBinarySpreadsheetBuffer(buffer)) {
    throw new Error('Arquivo binário (XLS/XLSX) não deve passar pelo decoder textual. Use leitura binária.')
  }
  const bytes = new Uint8Array(buffer)
  // BOM UTF-8
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return makeDecodedText(new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(3)), 'utf-8-sig', true)
  }
  // BOM UTF-16
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return makeDecodedText(new TextDecoder('utf-16le', { fatal: true }).decode(bytes.slice(2)), 'utf-16le', true)
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return makeDecodedText(new TextDecoder('utf-16be', { fatal: true }).decode(bytes.slice(2)), 'utf-16be', true)
  }
  try {
    return makeDecodedText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'utf-8', false)
  } catch {
    if (!options.allowWindows1252Fallback) {
      throw new Error('Bytes inválidos em UTF-8 sem fallback autorizado. Converta a origem para UTF-8 ou autorize Windows-1252.')
    }
    return makeDecodedText(new TextDecoder('windows-1252').decode(bytes), 'windows-1252', false)
  }
}

/**
 * Detecta o formato pelo conteúdo, antes de delegar a leitura ao parser
 * correspondente. Extensão não é prova de que um arquivo é uma planilha ou
 * EDI; texto ambíguo é rejeitado para não escolher um parser arbitrariamente.
 */
export function detectImportFormatFromDecoded(decoded: DecodedImportText): ImportFileFormat {
  if (looksLikeEdifact(decoded.text)) return 'edi'

  const sample = splitCsvSampleLines(decoded.text, 20)
  const csvCandidates = findCsvDelimiters(decoded.text, sample)
  if (csvCandidates.length > 1) {
    throw new Error(`Formato textual ambíguo: múltiplos delimitadores CSV (${csvCandidates.join(', ')}).`)
  }
  if (csvCandidates.length === 1) return 'csv'

  if (sample.length >= 2 && hasPlausibleSingleColumnHeader(sample[0] ?? '')) return 'csv'

  throw new Error('Formato de importação não reconhecido pelo conteúdo do arquivo.')
}

export function detectImportFormat(buffer: ArrayBuffer, options: DecodeImportBytesOptions = {}): ImportFileFormat {
  if (hasMagic(buffer, ZIP_MAGIC)) return 'xlsx'
  if (hasMagic(buffer, OLE_MAGIC)) return 'xls'

  const decoded = decodeImportBytes(buffer, options)
  return detectImportFormatFromDecoded(decoded)
}

/**
 * Retorna o formato e uma prévia segura do texto já decodificado para o preview.
 *
 * Mesmo padrão do leitor de planilhas (`readSheet`): CSV Windows-1252 é aceito
 * e sinalizado no `encoding` (ADR 0078, item 22). Recusar aqui barrava o
 * arquivo antes do parser, que o aceitaria com aviso. `false` recusa.
 */
export function inspectImportFile(
  buffer: ArrayBuffer,
  options: InspectImportFileOptions = {},
): ImportFileInspection {
  if (hasMagic(buffer, ZIP_MAGIC)) {
    return { format: 'xlsx', encoding: null, hadBom: false, preview: null, byteLength: buffer.byteLength }
  }
  if (hasMagic(buffer, OLE_MAGIC)) {
    return { format: 'xls', encoding: null, hadBom: false, preview: null, byteLength: buffer.byteLength }
  }

  const decoded = decodeImportBytes(buffer, { allowWindows1252Fallback: options.allowWindows1252Fallback ?? true })
  const format = detectImportFormatFromDecoded(decoded)
  const previewChars = Math.max(0, Math.trunc(options.previewChars ?? 400))
  return {
    format,
    encoding: decoded.encoding,
    hadBom: decoded.hadBom,
    preview: decoded.text.slice(0, previewChars),
    byteLength: buffer.byteLength,
  }
}

export async function inspectImportUpload(
  file: { arrayBuffer: () => Promise<ArrayBuffer> },
  options: InspectImportFileOptions = {},
): Promise<ImportFileInspection> {
  return inspectImportFile(await file.arrayBuffer(), options)
}

function makeDecodedText(text: string, encoding: ImportTextEncoding, hadBom: boolean): DecodedImportText {
  return { text: normalizeLineEndings(text), encoding, hadBom }
}

function hasMagic(buffer: ArrayBuffer, magic: readonly number[]): boolean {
  const bytes = new Uint8Array(buffer)
  return bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte)
}

function looksLikeEdifact(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  // UNA is the optional EDIFACT service-string advice and is a conclusive
  // signature even when the message uses non-default separators.
  if (/^UNA[\s\S]{6}/.test(normalized)) return true

  // Baplie/EDIFACT messages can start at TDT or another business segment in
  // an exported fragment, so inspect segment boundaries rather than requiring
  // UNB/UNH. The allow-list avoids classifying arbitrary prose as EDI.
  if (/(?:^|['\n])\s*(?:UNB|UNH|UNT|UNZ|TDT|LOC|EQD|MEA|RFF|DGS|DIM)(?=[+;:])/im.test(normalized)) return true

  // CE Mercante is a positional EDI variant with M/C/I records instead of
  // EDIFACT tags. O layout consumido pelo parser usa identificador de
  // manifesto com 17 dígitos e CE com 15; exigir as posições evita capturar
  // planilhas comuns que usam códigos como M1/M2.
  if (/(?:^|\n)\s*M\d{17}\s+\S+/m.test(normalized)) return true
  if (/(?:^|\n)\s*C\d{17}\s+\d{15}\s+\S+/m.test(normalized)) return true

  return false
}

function splitCsvSampleLines(text: string, maxLines = 20): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""'
        i += 1
      } else {
        inQuotes = !inQuotes
        current += '"'
      }
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      if (current.trim()) {
        lines.push(current.replace(/\s+$/g, ''))
        if (lines.length >= maxLines) break
      }
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() && lines.length < maxLines) {
    lines.push(current.replace(/\s+$/g, ''))
  }
  return lines
}

function findCsvDelimiters(text: string, existingSample?: string[]): string[] {
  const sample = existingSample ?? splitCsvSampleLines(text, 20)
  if (!sample.length) return []
  const delimiters = [',', ';', '\t', '|']
  const matched = delimiters.filter((delimiter) => {
    const parsed = sample.map((line) => splitCsvLine(line, delimiter))
    const fieldCount = parsed[0]?.length ?? 0
    return fieldCount > 1 && parsed.some((fields) => fields.length > 1) && parsed.every((fields) => fields.length === fieldCount)
  })

  // Desambiguação de ';' vs ',' quando ',' é separador decimal dentro de colunas separadas por ';'
  if (matched.includes(';') && matched.includes(',')) {
    const parsedSemi = sample.map((line) => splitCsvLine(line, ';'))
    const hasCommaDecimals = parsedSemi.some((row) =>
      row.some((val) => /^\d+,\d+$/.test(val.trim()))
    )
    if (hasCommaDecimals) {
      return matched.filter((d) => d !== ',')
    }
  }

  return matched
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === delimiter && !quoted) {
      fields.push(field)
      field = ''
      continue
    }
    field += char
  }
  fields.push(field)
  return fields
}

const SINGLE_COLUMN_OPERATIONAL_HEADERS = new Set([
  'bl', 'b/l', 'booking', 'booking number', 'container', 'container number', 'conteiner',
  'chassi', 'chassis', 'vin', 'ce', 'ce mercante', 'codigo', 'numero', 'id', 'tipo', 'type',
  'tara', 'tare', 'peso', 'weight', 'cubagem', 'cbm', 'm3', 'volume', 'local', 'origem',
  'destino', 'pol', 'pod', 'data', 'date', 'status', 'condicao', 'condition', 'descricao',
  'description', 'ncm', 'cnpj', 'email',
])

function hasPlausibleSingleColumnHeader(value: string): boolean {
  const normalized = value
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  return SINGLE_COLUMN_OPERATIONAL_HEADERS.has(normalized)
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
