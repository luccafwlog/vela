// Helpers compartilhados pelos parsers de importação de planilhas.
// Extraído de vaziosImport/graniteImport (audit T11) — apenas a interseção
// visível entre os parsers, sem framework genérico.

import { excelSerialToCivil } from '../lib/importDate'
import { normalizeHeader } from '../lib/utils'

/** Erro de linha acumulado durante o parse, no formato comum aos parsers. */
export type RowError = { row: number; message: string; raw: unknown }

/** Coletor de erros de linha no padrão `{ row, message, raw }` dos parsers. */
export function createRowErrorCollector() {
  const errors: RowError[] = []
  return {
    errors,
    add(row: number, message: string, raw: unknown) {
      errors.push({ row, message, raw })
    },
  }
}

/**
 * Constrói um mapeador de linha a partir do HEADER_MAP do parser:
 * normaliza cada cabeçalho da planilha (trim + lowercase) e associa à
 * chave canônica da coluna. Cabeçalhos não reconhecidos são ignorados.
 */
export function createHeaderMapper(
  sampleRow: Record<string, unknown>,
  headerMap: Record<string, string>,
): (row: Record<string, unknown>) => Record<string, unknown> {
  const colMapping: Record<string, string> = {}
  const columnByField = new Map<string, string>()
  for (const originalKey of Object.keys(sampleRow)) {
    const normalized = normalizeHeader(originalKey)
    const mapped = headerMap[normalized]
    if (!mapped) continue
    const previous = columnByField.get(mapped)
    if (previous !== undefined) {
      throw new Error(`As colunas "${previous}" e "${originalKey}" são o mesmo campo. Deixe só uma e importe de novo.`)
    }
    columnByField.set(mapped, originalKey)
    colMapping[originalKey] = mapped
  }

  return (row) => {
    const mapped: Record<string, unknown> = {}
    for (const [originalKey, fieldName] of Object.entries(colMapping)) {
      mapped[fieldName] = row[originalKey]
    }
    return mapped
  }
}

/**
 * Lê uma aba como linhas-objeto, com a célula TIPADA (ADR 0078, item 22):
 *
 * - texto é texto; CSV é sempre texto (o SheetJS nunca reinterpreta `12,5`
 *   nem `05/03/2026`);
 * - célula numérica é `number`, exceto quando o formato é uma máscara de zeros
 *   (`00000000000000`, `00000-000`), que entrega o texto exibido (CNPJ e CEP
 *   não perdem os zeros à esquerda);
 * - célula de data do Excel é a data civil `AAAA-MM-DD` (ou
 *   `AAAA-MM-DD HH:MM`), calculada do serial, sem fuso do navegador
 *   (`src/lib/importDate.ts`).
 *
 * Regras comuns: linhas e abas ocultas são ignoradas e contadas em
 * `warnings`; o mesmo cabeçalho duas vezes bloqueia; CSV Windows-1252 é aceito
 * com aviso.
 */
export type SheetReadOptions = {
  skipBlankRows?: boolean
  /** Índice entre as abas VISÍVEIS (aba oculta é ignorada com aviso). */
  sheetIndex?: number
  /** Aliases used to locate a header row after an optional title/preamble. */
  expectedHeaders?: readonly string[]
  headerWindow?: number
  /** `false` recusa CSV fora de UTF-8; o padrão aceita Windows-1252 com aviso. */
  allowWindows1252Fallback?: boolean
}

/** Valor de célula entregue pelo leitor comum. */
export type SheetCellValue = string | number | boolean

export type SheetContent = {
  headers: string[]
  matrix: SheetCellValue[][]
  rows: SheetRow[]
  headerRowIndex: number
  /** Avisos de leitura para a prévia (linhas/abas ocultas, Windows-1252). */
  warnings: string[]
}

/** Linha de planilha com a linha física 1-based preservada da origem. */
export type SheetRow = Record<string, unknown> & { readonly rowNumber: number }

type XlsxModule = typeof import('@e965/xlsx')
type XlsxCell = { t?: string; v?: unknown; w?: string; z?: string | number }

// Máscara de zeros: o formato existe para mostrar zeros à esquerda (CNPJ, CEP,
// CPF). `0`, `0.00` e `#,##0` são formatos numéricos e entregam o número.
function isZeroMask(format: string): boolean {
  const mask = format.replace(/"/g, '')
  if (!/^[0\-./ ()]+$/.test(mask)) return false
  if (/^0+(\.0+)?$/.test(mask)) return mask.replace(/\..*$/, '').length >= 4
  return (mask.match(/0/g) ?? []).length >= 4
}

/** Valor tipado de uma célula de planilha binária (XLSX/XLS). */
export function typedCellValue(cell: XlsxCell | undefined, XLSX: XlsxModule): SheetCellValue {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  switch (cell.t) {
    case 'n': {
      const value = Number(cell.v)
      const format = typeof cell.z === 'string' ? cell.z : typeof cell.z === 'number' ? String(XLSX.SSF.get_table()[cell.z] ?? '') : ''
      if (format && XLSX.SSF.is_date(format)) {
        const civil = excelSerialToCivil(value)
        if (!civil) return ''
        return civil.time ? `${civil.date} ${civil.time}` : civil.date
      }
      if (format && isZeroMask(format)) return cell.w ?? String(value)
      return value
    }
    case 'b':
      return Boolean(cell.v)
    case 'e':
    case 'z':
      return ''
    default:
      return String(cell.v)
  }
}

/** Matriz tipada da aba, sem as linhas ocultas; `rowNumbers` guarda a linha física. */
export function typedSheetMatrix(
  sheet: Record<string, unknown>,
  XLSX: XlsxModule,
  /** `keepHidden` mantém a posição física das linhas (layouts posicionais, como o B/L). */
  options: { textOnly?: boolean; keepHidden?: boolean } = {},
) {
  const ref = typeof sheet['!ref'] === 'string' ? sheet['!ref'] : null
  const matrix: SheetCellValue[][] = []
  const rowNumbers: number[] = []
  let hiddenRows = 0
  if (!ref) return { matrix, rowNumbers, hiddenRows }
  const range = XLSX.utils.decode_range(ref)
  const rowInfo = (sheet['!rows'] ?? []) as Array<{ hidden?: boolean } | undefined>
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    if (rowInfo[r]?.hidden && !options.keepHidden) {
      const hasContent = Array.from({ length: range.e.c - range.s.c + 1 }, (_, i) => sheet[XLSX.utils.encode_cell({ r, c: range.s.c + i })])
        .some((cell) => cell !== undefined)
      if (hasContent) hiddenRows += 1
      continue
    }
    const row: SheetCellValue[] = []
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XlsxCell | undefined
      row.push(options.textOnly ? (cell?.v === undefined || cell?.v === null ? '' : String(cell.v)) : typedCellValue(cell, XLSX))
    }
    matrix.push(row)
    rowNumbers.push(r + 1)
  }
  return { matrix, rowNumbers, hiddenRows }
}

export async function readSheet(buffer: ArrayBuffer, options: SheetReadOptions = {}): Promise<SheetContent> {
  const XLSX = await import('@e965/xlsx')
  const { decodeImportBytes, detectImportFormat } = await import('./importText')
  const allowWindows1252Fallback = options.allowWindows1252Fallback ?? true
  const warnings: string[] = []
  // XLS/XLSX binário nunca passa pelo decoder textual. CSV é texto com BOM e
  // UTF-8; Windows-1252 (CSV salvo pelo Excel em "CSV (separado por vírgulas)")
  // é aceito com aviso. EDI não é aceito pelo leitor de planilhas.
  const format = detectImportFormat(buffer, { allowWindows1252Fallback })
  if (format === 'edi') throw new Error('Arquivo EDI recebido no leitor de planilhas. Use o parser EDI correspondente.')
  const isText = format !== 'xlsx' && format !== 'xls'
  let workbook: import('@e965/xlsx').WorkBook
  if (isText) {
    const decoded = decodeImportBytes(buffer, { allowWindows1252Fallback })
    if (decoded.encoding === 'windows-1252') {
      warnings.push('Arquivo CSV em Windows-1252 (ANSI): os acentos foram convertidos; confira nomes e descrições na prévia.')
    }
    // raw: o CSV chega ao parser como o texto do arquivo, sem conversão.
    workbook = XLSX.read(decoded.text, { type: 'string', raw: true, dense: false })
  } else {
    workbook = XLSX.read(buffer, { type: 'array', cellNF: true, cellStyles: true, dense: false })
  }

  const sheetMeta = workbook.Workbook?.Sheets ?? []
  const visibleNames = workbook.SheetNames.filter((name, index) => {
    const hidden = Number(sheetMeta[index]?.Hidden ?? 0) !== 0
    if (hidden) warnings.push(`Aba oculta "${name}" ignorada.`)
    return !hidden
  })
  const sheetName = visibleNames[options.sheetIndex ?? 0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) throw new Error('Arquivo sem abas validas.')

  const { matrix, rowNumbers, hiddenRows } = typedSheetMatrix(sheet as unknown as Record<string, unknown>, XLSX, { textOnly: isText })
  if (hiddenRows > 0) {
    warnings.push(`${hiddenRows} ${hiddenRows === 1 ? 'linha oculta ignorada' : 'linhas ocultas ignoradas'}: o filtro da planilha indica importar só o visível.`)
  }
  if (!matrix.length) throw new Error('Planilha vazia.')
  const headerRowIndex = options.expectedHeaders
    ? locateHeaderRowIndex(matrix, options.expectedHeaders, options.headerWindow ?? 5)
    : 0
  if (headerRowIndex < 0) throw new Error('Cabeçalho não encontrado na janela inicial da planilha.')

  const headers = (matrix[headerRowIndex] ?? []).map((cell) => String(cell ?? '').trim())
  assertUniqueHeaders(headers)

  const skipBlank = options.skipBlankRows ?? true
  const rows: SheetRow[] = []
  for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
    const cells = matrix[index] ?? []
    const data: Record<string, unknown> = {}
    headers.forEach((header, column) => {
      if (!header) return
      data[header] = cells[column] ?? ''
    })
    const hasValue = Object.values(data).some((value) => (typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined))
    if (skipBlank && !hasValue) continue
    Object.defineProperty(data, 'rowNumber', {
      value: rowNumbers[index],
      enumerable: false,
      configurable: false,
      writable: false,
    })
    rows.push(data as SheetRow)
  }
  if (!rows.length) throw new Error('Planilha vazia.')
  return { headers, matrix, rows, headerRowIndex, warnings }
}

/** O mesmo cabeçalho duas vezes: a importação não escolhe uma das colunas pelo arquivo. */
export function assertUniqueHeaders(headers: readonly string[]) {
  const seen = new Map<string, string>()
  for (const header of headers) {
    const key = normalizeHeader(header)
    if (!key) continue
    const previous = seen.get(key)
    if (previous !== undefined) {
      throw new Error(`A coluna "${header}" aparece duas vezes no cabeçalho. Deixe só uma e importe de novo.`)
    }
    seen.set(key, header)
  }
}

/**
 * Avisos de leitura de uma planilha escolhida, para a prévia: linhas e abas
 * ocultas ignoradas e CSV Windows-1252. Falha de leitura devolve lista vazia
 * (o erro aparece pelo parser do importador).
 */
export async function readSpreadsheetWarnings(file: { arrayBuffer: () => Promise<ArrayBuffer> }): Promise<string[]> {
  try {
    const { warnings } = await readSheet(await file.arrayBuffer(), { skipBlankRows: true })
    return warnings
  } catch {
    return []
  }
}

export async function readFirstSheetRows(buffer: ArrayBuffer): Promise<SheetRow[]> {
  const { rows } = await readSheet(buffer)
  return rows
}

/** Localiza a linha de cabeçalho em janela pequena do template; recusa múltiplos candidatos. */
export function locateHeaderRowIndex(
  matrix: unknown[][],
  expectedNormalized: readonly string[],
  window = 5,
): number {
  const expected = new Set(expectedNormalized.map(normalizeHeader))
  const candidates: number[] = []
  const limit = Math.min(matrix.length, window)
  for (let i = 0; i < limit; i += 1) {
    const cells = (matrix[i] ?? []).map((cell) => normalizeHeader(String(cell ?? ''))).filter(Boolean)
    if (cells.some((cell) => expected.has(cell))) candidates.push(i)
  }
  if (candidates.length > 1) {
    throw new Error(`Cabeçalho ambíguo: múltiplas linhas candidatas (${candidates.map((i) => i + 1).join(', ')}).`)
  }
  return candidates[0] ?? -1
}

export type HeaderSpec<F extends string> = {
  readonly aliases: Readonly<Record<F, readonly string[]>>
  readonly required: readonly F[]
}

export function matchHeaders<F extends string>(
  headers: readonly string[],
  spec: HeaderSpec<F>,
): { columnByField: Partial<Record<F, string>>; missing: F[] } {
  const columnByField: Partial<Record<F, string>> = {}
  for (const field of Object.keys(spec.aliases) as F[]) {
    const accepted = new Set(spec.aliases[field].map(normalizeHeader))
    const found = headers.filter((header) => accepted.has(normalizeHeader(header)))
    // Duas colunas para o mesmo campo bloqueiam (ADR 0078, item 22): escolher
    // uma delas pela ordem do arquivo gravaria o valor errado sem aviso.
    if (found.length > 1) {
      throw new Error(`As colunas ${found.map((header) => `"${header}"`).join(' e ')} são o mesmo campo. Deixe só uma e importe de novo.`)
    }
    if (found[0] !== undefined) columnByField[field] = found[0]
  }
  const missing = spec.required.filter((field) => columnByField[field] === undefined)
  return { columnByField, missing }
}
