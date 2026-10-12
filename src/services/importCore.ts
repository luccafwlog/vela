// Helpers compartilhados pelos parsers de importação de planilhas.
// Extraído de vaziosImport/graniteImport (audit T11) — apenas a interseção
// visível entre os parsers, sem framework genérico.

import { excelSerialTimeOfDay, excelSerialToCivil } from '../lib/importDate'
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
  const keys = Object.keys(sampleRow)
  for (const originalKey of keys) {
    const normalized = normalizeHeader(fileHeader(originalKey, keys))
    const mapped = headerMap[normalized]
    if (!mapped) continue
    const previous = columnByField.get(mapped)
    if (previous !== undefined) throw sameFieldError([previous, originalKey], keys)
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
 *   (`00000000000000`, `00000\-000`, `00"."000"."000"/"0000"-"00`), que
 *   entrega o texto com os zeros à esquerda (CNPJ e CEP não perdem os zeros);
 * - célula de data do Excel é a data civil `AAAA-MM-DD` (ou
 *   `AAAA-MM-DD HH:MM`), calculada do serial, sem fuso do navegador, no
 *   sistema de datas da pasta (1900 ou 1904; `src/lib/importDate.ts`).
 *
 * Regras comuns: linhas e abas ocultas são ignoradas e contadas em
 * `warnings`; CSV Windows-1252 é aceito com aviso. O mesmo cabeçalho duas vezes
 * não bloqueia a leitura — a repetição ganha sufixo (`Unit`, `Unit_1`) — e
 * quem bloqueia "duas colunas para o mesmo campo" é o casamento com os campos
 * do parser (`matchHeaders`, `createHeaderMapper`).
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
  /** Recusa arquivo com mais de uma aba visível com dados (ADR 0078, item 9). */
  singleDataSheet?: boolean
}

/** Valor de célula entregue pelo leitor comum. */
export type SheetCellValue = string | number | boolean

export type SheetContent = {
  headers: string[]
  matrix: SheetCellValue[][]
  /** Linha física (1-based) de cada linha de `matrix`: as ocultas não estão na matriz. */
  rowNumbers: number[]
  rows: SheetRow[]
  headerRowIndex: number
  /** Avisos de leitura para a prévia (linhas/abas ocultas, Windows-1252). */
  warnings: string[]
  /** O que ficou de fora por estar oculto: linhas com dado da aba lida e abas ocultas. */
  hidden: { rows: number; sheets: string[] }
}

/** Linha de planilha com a linha física 1-based preservada da origem. */
export type SheetRow = Record<string, unknown> & { readonly rowNumber: number }

type XlsxModule = typeof import('@e965/xlsx')
type XlsxWorkbook = import('@e965/xlsx').WorkBook
type XlsxCell = { t?: string; v?: unknown; w?: string; z?: string | number }

/** Pasta gravada no sistema de datas 1904 (Excel antigo de Mac). */
export function isDate1904Workbook(workbook: XlsxWorkbook): boolean {
  return Boolean(workbook.Workbook?.WBProps?.date1904)
}

/**
 * Texto de uma célula numérica com máscara de zeros (CNPJ, CEP, CPF), ou
 * `null` quando o formato não é máscara de zeros: `0`, `0.00` e `#,##0` são
 * formatos numéricos e entregam o número.
 *
 * O literal da máscara pode vir escapado (`00000\-000`) ou entre aspas
 * (`00"."000"."000"/"0000"-"00`). O texto desenhado pelo SheetJS (`cell.w`) só
 * vale quando traz os mesmos dígitos: a máscara de CNPJ com "/" sai desenhada
 * como fração (`205000.000.128/1`), e aí vale o número com os zeros à esquerda
 * que a máscara mostra.
 */
function zeroMaskText(value: number, format: string, shown: string | undefined): string | null {
  const literal = format.replace(/\\(.)/g, '$1').replace(/"/g, '')
  if (!/^[0\-./ ()]+$/.test(literal)) return null
  // `0000.00`: ponto decimal sem escape — o texto exibido é o próprio número.
  if (/^0+\.0+$/.test(format)) return format.indexOf('.') >= 4 ? shown ?? String(value) : null
  const digits = (literal.match(/0/g) ?? []).length
  if (digits < 4) return null
  if (!Number.isFinite(value) || value < 0) return shown ?? String(value)
  const padded = String(Math.round(value)).padStart(digits, '0')
  return shown !== undefined && shown.replace(/\D/g, '') === padded ? shown : padded
}

/** Valor tipado de uma célula de planilha binária (XLSX/XLS). */
export function typedCellValue(
  cell: XlsxCell | undefined,
  XLSX: XlsxModule,
  /** `date1904`: o serial de data é do sistema 1904 (`isDate1904Workbook`). */
  options: { date1904?: boolean } = {},
): SheetCellValue {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  switch (cell.t) {
    case 'n': {
      const value = Number(cell.v)
      const format = typeof cell.z === 'string' ? cell.z : typeof cell.z === 'number' ? String(XLSX.SSF.get_table()[cell.z] ?? '') : ''
      if (format && XLSX.SSF.is_date(format)) {
        // Célula só de hora (`hh:mm`, serial entre 0 e 1, em qualquer sistema
        // de datas): entrega a hora como texto, para não sumir em silêncio
        // como célula vazia. Coluna de data a recusa com motivo.
        const timeOnly = excelSerialTimeOfDay(value)
        if (timeOnly) return timeOnly
        const civil = excelSerialToCivil(value, { date1904: options.date1904 })
        if (!civil) return ''
        return civil.time ? `${civil.date} ${civil.time}` : civil.date
      }
      const masked = format ? zeroMaskText(value, format, cell.w) : null
      return masked ?? value
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

/**
 * Conta as linhas ocultas que têm alguma célula (as vazias não fazem falta).
 *
 * `belowFirstVisibleRow`: só conta as ocultas abaixo da primeira linha visível
 * com dado. O cabeçalho é sempre uma linha visível, então título e instruções
 * ocultos ACIMA dele não são linhas de dado e não entram na conta.
 *
 * ponytail: sem saber qual é o cabeçalho (o seletor não conhece o parser), uma
 * linha oculta entre um título visível e o cabeçalho ainda conta. Upgrade:
 * o seletor receber os cabeçalhos esperados do parser e usar
 * `locateHeaderRowIndex`, como `readSheet`.
 */
function countHiddenRows(
  sheet: Record<string, unknown>,
  XLSX: XlsxModule,
  options: { belowFirstVisibleRow?: boolean } = {},
): number {
  const ref = typeof sheet['!ref'] === 'string' ? sheet['!ref'] : null
  if (!ref) return 0
  const range = XLSX.utils.decode_range(ref)
  const rowInfo = (sheet['!rows'] ?? []) as Array<{ hidden?: boolean } | undefined>
  let hiddenRows = 0
  let seenVisibleRow = !options.belowFirstVisibleRow
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const hasCell = rowHasCell(sheet, XLSX, r, range.s.c, range.e.c)
    if (!rowInfo[r]?.hidden) {
      if (hasCell) seenVisibleRow = true
      continue
    }
    if (seenVisibleRow && hasCell) hiddenRows += 1
  }
  return hiddenRows
}

function rowHasCell(sheet: Record<string, unknown>, XLSX: XlsxModule, r: number, first: number, last: number) {
  for (let c = first; c <= last; c += 1) {
    if (sheet[XLSX.utils.encode_cell({ r, c })] !== undefined) return true
  }
  return false
}

/** Matriz tipada da aba, sem as linhas ocultas; `rowNumbers` guarda a linha física. */
export function typedSheetMatrix(
  sheet: Record<string, unknown>,
  XLSX: XlsxModule,
  /**
   * `keepHidden` mantém a posição física das linhas (layouts posicionais, como
   * o B/L); `date1904` vem de `isDate1904Workbook` da pasta.
   */
  options: { textOnly?: boolean; keepHidden?: boolean; date1904?: boolean } = {},
) {
  const ref = typeof sheet['!ref'] === 'string' ? sheet['!ref'] : null
  const matrix: SheetCellValue[][] = []
  const rowNumbers: number[] = []
  /** Linha física (1-based) de cada linha oculta com dado, deixada fora da matriz. */
  const hiddenRowNumbers: number[] = []
  if (!ref) return { matrix, rowNumbers, hiddenRows: 0, hiddenRowNumbers }
  const range = XLSX.utils.decode_range(ref)
  const rowInfo = (sheet['!rows'] ?? []) as Array<{ hidden?: boolean } | undefined>
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    if (rowInfo[r]?.hidden && !options.keepHidden) {
      if (rowHasCell(sheet, XLSX, r, range.s.c, range.e.c)) hiddenRowNumbers.push(r + 1)
      continue
    }
    const row: SheetCellValue[] = []
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XlsxCell | undefined
      row.push(options.textOnly
        ? (cell?.v === undefined || cell?.v === null ? '' : String(cell.v))
        : typedCellValue(cell, XLSX, { date1904: options.date1904 }))
    }
    matrix.push(row)
    rowNumbers.push(r + 1)
  }
  return { matrix, rowNumbers, hiddenRows: hiddenRowNumbers.length, hiddenRowNumbers }
}

/**
 * Aviso do CSV em Windows-1252. Não é dado deixado de fora (o arquivo foi lido
 * inteiro): quem lista "o que ficou fora" separa este aviso pelo texto exato.
 */
export const WINDOWS_1252_WARNING = 'Arquivo CSV em Windows-1252 (ANSI): os acentos foram convertidos; confira nomes e descrições na prévia.'

/** Pasta aberta pelo leitor comum, com o aviso de encoding do CSV. */
async function openWorkbook(buffer: ArrayBuffer, allowWindows1252Fallback: boolean) {
  const XLSX = await import('@e965/xlsx')
  const { decodeImportBytes, detectImportFormat } = await import('./importText')
  const warnings: string[] = []
  // XLS/XLSX binário nunca passa pelo decoder textual. CSV é texto com BOM e
  // UTF-8; Windows-1252 (CSV salvo pelo Excel em "CSV (separado por vírgulas)")
  // é aceito com aviso. EDI não é aceito pelo leitor de planilhas.
  const format = detectImportFormat(buffer, { allowWindows1252Fallback })
  if (format === 'edi') throw new Error('Arquivo EDI recebido no leitor de planilhas. Use o parser EDI correspondente.')
  const isText = format !== 'xlsx' && format !== 'xls'
  let workbook: XlsxWorkbook
  if (isText) {
    const decoded = decodeImportBytes(buffer, { allowWindows1252Fallback })
    if (decoded.encoding === 'windows-1252') warnings.push(WINDOWS_1252_WARNING)
    // raw: o CSV chega ao parser como o texto do arquivo, sem conversão.
    workbook = XLSX.read(decoded.text, { type: 'string', raw: true, dense: false })
  } else {
    workbook = XLSX.read(buffer, { type: 'array', cellNF: true, cellStyles: true, dense: false })
  }
  const sheetMeta = workbook.Workbook?.Sheets ?? []
  const visibleNames: string[] = []
  const hiddenNames: string[] = []
  workbook.SheetNames.forEach((name, index) => {
    if (Number(sheetMeta[index]?.Hidden ?? 0) !== 0) hiddenNames.push(name)
    else visibleNames.push(name)
  })
  for (const name of hiddenNames) warnings.push(`Aba oculta "${name}" ignorada.`)
  const sheetOf = (name: string) => workbook.Sheets[name] as unknown as Record<string, unknown> | undefined
  const hasData = (name: string) => {
    const sheet = sheetOf(name)
    return Boolean(sheet) && Object.keys(sheet!).some((key) => !key.startsWith('!')
      && String((sheet![key] as { v?: unknown }).v ?? '').trim() !== '')
  }
  return { XLSX, workbook, isText, date1904: isDate1904Workbook(workbook), warnings, visibleNames, hiddenNames, sheetOf, hasData }
}

function hiddenRowsWarning(hiddenRows: number, sheetName: string | null) {
  const count = `${hiddenRows} ${hiddenRows === 1 ? 'linha oculta ignorada' : 'linhas ocultas ignoradas'}`
  return `${count}${sheetName ? ` na aba "${sheetName}"` : ''}: o filtro da planilha indica importar só o visível.`
}

/** Os dados só existem em linhas ou abas ocultas: dizer onde estão, não "Planilha vazia.". */
export const HIDDEN_DATA_MESSAGE = 'Os dados estão em linhas ou abas ocultas, que são ignoradas; reexiba-as ou copie para uma aba visível.'

export async function readSheet(buffer: ArrayBuffer, options: SheetReadOptions = {}): Promise<SheetContent> {
  const book = await openWorkbook(buffer, options.allowWindows1252Fallback ?? true)
  const { XLSX, visibleNames, hiddenNames, sheetOf, hasData } = book
  const warnings = [...book.warnings]
  if (options.singleDataSheet) {
    const withData = visibleNames.filter(hasData)
    if (withData.length > 1) {
      throw new Error(`O arquivo tem mais de uma aba com dados (${withData.join(', ')}): deixe só a aba do CE Mercante e importe de novo.`)
    }
  }
  const sheetIndex = options.sheetIndex ?? 0
  const sheetName = visibleNames[sheetIndex]
  const sheet = sheetName ? sheetOf(sheetName) : undefined
  const dataInHiddenSheet = hiddenNames.some(hasData)
  if (!sheet) {
    // Só a aba 0 diz que o dado está oculto: quem percorre as abas (Veículos)
    // para na primeira posição sem aba, em vez de receber a mesma mensagem sempre.
    if (sheetIndex === 0 && !visibleNames.length && dataInHiddenSheet) throw new Error(HIDDEN_DATA_MESSAGE)
    throw new Error('Arquivo sem abas validas.')
  }

  const { matrix, rowNumbers, hiddenRowNumbers } = typedSheetMatrix(sheet, XLSX, { textOnly: book.isText, date1904: book.date1904 })
  // Até achar o cabeçalho, toda linha oculta com dado conta; depois, só as
  // abaixo dele (título e instruções ocultos acima não são linhas de dado).
  let hiddenRows = hiddenRowNumbers.length
  // Aba sem nenhuma linha visível com dado: se o dado está escondido (linhas
  // ocultas desta aba, ou aba oculta sem outra visível com dado), o erro diz
  // onde ele está. Com outra aba visível com dado, segue "Planilha vazia." — o
  // leitor de Veículos percorre as abas e pula a vazia.
  const emptyError = () => new Error(
    hiddenRows > 0 || (dataInHiddenSheet && !visibleNames.some((name, index) => index !== sheetIndex && hasData(name)))
      ? HIDDEN_DATA_MESSAGE
      : 'Planilha vazia.',
  )
  if (!matrix.length) throw emptyError()
  const headerRowIndex = options.expectedHeaders
    ? locateHeaderRowIndex(matrix, options.expectedHeaders, options.headerWindow ?? 5)
    : 0
  if (headerRowIndex < 0) throw new Error('Cabeçalho não encontrado na janela inicial da planilha.')
  const headerRowNumber = rowNumbers[headerRowIndex] ?? 0
  hiddenRows = hiddenRowNumbers.filter((rowNumber) => rowNumber > headerRowNumber).length
  if (hiddenRows > 0) warnings.push(hiddenRowsWarning(hiddenRows, visibleNames.length > 1 ? sheetName : null))

  const headers = dedupeHeaders((matrix[headerRowIndex] ?? []).map((cell) => String(cell ?? '').trim()))

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
  if (!rows.length) throw emptyError()
  return { headers, matrix, rowNumbers, rows, headerRowIndex, warnings, hidden: { rows: hiddenRows, sheets: hiddenNames } }
}

/**
 * O mesmo cabeçalho duas vezes não bloqueia a leitura: a repetição ganha
 * sufixo (`Unit`, `Unit_1`), como o `sheet_to_json` do SheetJS fazia, e cada
 * coluna continua com a sua chave na linha. Duas colunas para o MESMO CAMPO
 * bloqueiam no casamento com os campos do parser (`matchHeaders`,
 * `createHeaderMapper`), que reconhece a repetição renomeada (`fileHeader`).
 * Coluna repetida que nenhum campo usa (duas "OBS", um título "Período …
 * Período" na linha 1) não impede a importação.
 */
function dedupeHeaders(headers: readonly string[]): string[] {
  const taken = new Set(headers)
  const seen = new Set<string>()
  return headers.map((header) => {
    if (!header || !seen.has(header)) {
      seen.add(header)
      return header
    }
    let suffix = 1
    while (taken.has(`${header}_${suffix}`)) suffix += 1
    const renamed = `${header}_${suffix}`
    taken.add(renamed)
    return renamed
  })
}

/**
 * Cabeçalho como está no arquivo: `Unit_1` ao lado de `Unit` é a repetição
 * renomeada por `dedupeHeaders`.
 *
 * ponytail: heurística pelo nome — um arquivo que traga de fato "Container" e
 * "Container_1" também conta como repetição (e bloqueia, se for campo do
 * parser). Upgrade: `readSheet` devolver o mapa das colunas renomeadas e o
 * casamento de campos recebê-lo, no lugar do padrão `_N`.
 */
function fileHeader(header: string, headers: readonly string[]): string {
  const repeated = /^(.*)_\d+$/.exec(header)
  return repeated && headers.includes(repeated[1]) ? repeated[1] : header
}

function sameFieldError(columns: readonly string[], headers: readonly string[]): Error {
  const shown = columns.map((column) => fileHeader(column, headers))
  if (new Set(shown).size === 1) {
    return new Error(`A coluna "${shown[0]}" aparece duas vezes no cabeçalho. Deixe só uma e importe de novo.`)
  }
  return new Error(`As colunas ${shown.map((header) => `"${header}"`).join(' e ')} são o mesmo campo. Deixe só uma e importe de novo.`)
}

/**
 * Abas que o leitor posicional do B/L COSCO (`blParser.ts`) lê, visíveis ou
 * ocultas: a "Page 1" (ou a primeira aba da pasta, sem ela) e a aba "VIN".
 * As demais abas o B/L nunca lê. Mora aqui para o aviso do seletor e o parser
 * seguirem a mesma regra.
 */
export function positionalSheetNames(sheetNames: readonly string[]): { page: string | undefined; vin: string | undefined } {
  return {
    page: sheetNames.includes('Page 1') ? 'Page 1' : sheetNames[0],
    vin: sheetNames.find((name) => name.trim().toUpperCase() === 'VIN'),
  }
}

/**
 * Avisos de leitura de uma planilha escolhida, para a prévia, e as linhas
 * ocultas da aba que `readSheet` lê por padrão (a primeira visível).
 *
 * Sem `positional`: abas ocultas, linhas ocultas de CADA aba visível (o parser
 * pode ler outra aba que não a primeira) e CSV Windows-1252. Não depende de a
 * leitura dar certo: com o dado só em linhas ocultas, o aviso aparece junto do
 * erro do parser. Falha ao abrir o arquivo devolve lista vazia (o erro aparece
 * pelo parser do importador).
 *
 * `positional`: o parser lê o arquivo pela posição das células (B/L COSCO,
 * `blParser.ts`), inclusive linhas e abas ocultas — o aviso diz isso em vez de
 * prometer que as ocultas ficaram de fora, e só fala das abas que ele lê
 * (`positionalSheetNames`).
 */
export async function readSpreadsheetNotices(
  file: { arrayBuffer: () => Promise<ArrayBuffer> },
  options: { positional?: boolean } = {},
): Promise<{ warnings: string[]; firstSheetHiddenRows: number }> {
  try {
    const { XLSX, workbook, warnings, visibleNames, hiddenNames, sheetOf } = await openWorkbook(await file.arrayBuffer(), true)
    if (options.positional) {
      const all = workbook.SheetNames
      const { page, vin } = positionalSheetNames(all)
      const read = all.filter((name) => name === page || name === vin)
      const notices = warnings.filter((warning) => !warning.startsWith('Aba oculta '))
      for (const name of hiddenNames.filter((hidden) => read.includes(hidden))) {
        notices.push(`Aba oculta "${name}": este arquivo é lido mesmo com abas ocultas; confira se ela não deve entrar.`)
      }
      for (const name of read) {
        const sheet = sheetOf(name)
        const hiddenRows = sheet ? countHiddenRows(sheet, XLSX) : 0
        if (hiddenRows > 0) {
          notices.push(`${hiddenRows} ${hiddenRows === 1 ? 'linha oculta' : 'linhas ocultas'}${all.length > 1 ? ` na aba "${name}"` : ''}: `
            + 'este arquivo é lido inteiro, inclusive as linhas ocultas; apague as que não devem entrar.')
        }
      }
      return { warnings: notices, firstSheetHiddenRows: 0 }
    }
    let firstSheetHiddenRows = 0
    visibleNames.forEach((name, index) => {
      const sheet = sheetOf(name)
      const hiddenRows = sheet ? countHiddenRows(sheet, XLSX, { belowFirstVisibleRow: true }) : 0
      if (index === 0) firstSheetHiddenRows = hiddenRows
      if (hiddenRows > 0) warnings.push(hiddenRowsWarning(hiddenRows, visibleNames.length > 1 ? name : null))
    })
    return { warnings, firstSheetHiddenRows }
  } catch {
    return { warnings: [], firstSheetHiddenRows: 0 }
  }
}

/** Avisos de leitura do seletor de arquivo (`readSpreadsheetNotices`). */
export async function readSpreadsheetWarnings(
  file: { arrayBuffer: () => Promise<ArrayBuffer> },
  options: { positional?: boolean } = {},
): Promise<string[]> {
  return (await readSpreadsheetNotices(file, options)).warnings
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

function columnsForField<F extends string>(headers: readonly string[], spec: HeaderSpec<F>, field: F): string[] {
  const accepted = new Set(spec.aliases[field].map(normalizeHeader))
  return headers.filter((header) => accepted.has(normalizeHeader(fileHeader(header, headers))))
}

export function matchHeaders<F extends string>(
  headers: readonly string[],
  spec: HeaderSpec<F>,
): { columnByField: Partial<Record<F, string>>; missing: F[] } {
  const columnByField: Partial<Record<F, string>> = {}
  for (const field of Object.keys(spec.aliases) as F[]) {
    const found = columnsForField(headers, spec, field)
    // Duas colunas para o mesmo campo bloqueiam (ADR 0078, item 22): escolher
    // uma delas pela ordem do arquivo gravaria o valor errado sem aviso. Vale
    // também para o mesmo cabeçalho repetido, que o leitor renomeia (`Unit_1`).
    if (found.length > 1) throw sameFieldError(found, headers)
    if (found[0] !== undefined) columnByField[field] = found[0]
  }
  const missing = spec.required.filter((field) => columnByField[field] === undefined)
  return { columnByField, missing }
}

/**
 * Campos obrigatórios sem nenhuma coluna no cabeçalho, sem recusar coluna
 * repetida. Serve a quem procura, entre várias abas, a que tem os campos: a
 * repetição de uma aba que nem é a dos dados não deve abortar a procura.
 */
export function missingHeaderFields<F extends string>(headers: readonly string[], spec: HeaderSpec<F>): F[] {
  return spec.required.filter((field) => columnsForField(headers, spec, field).length === 0)
}
