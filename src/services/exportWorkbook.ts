/**
 * Dono único da aparência das planilhas exportadas pelo Vela e pelo Portal
 * (ADR 0120; regras em docs/identidade-visual.md, "Planilhas exportadas").
 *
 * Quem exporta monta as linhas (rótulo em português → valor) e declara o que
 * o rótulo não diz sozinho; este módulo decide cabeçalho, faixa de identidade,
 * grupos, formato de número e data, cor de situação, largura, total e
 * impressão. Nenhuma tela estiliza a própria planilha.
 *
 * A escrita usa `exceljs`, carregado sob demanda no clique de Exportar; a
 * leitura das importações continua com `@e965/xlsx`.
 */
import { downloadBlob } from '../lib/download'
import { sanitizeSheetRows } from '../lib/spreadsheetSafe'

type ExcelJSModule = typeof import('exceljs')
type Workbook = import('exceljs').Workbook
type Worksheet = import('exceljs').Worksheet
type Cell = import('exceljs').Cell
type FontSpec = Partial<import('exceljs').Font>

export type ExportProduct = 'vela' | 'portal'

/**
 * Tipo da coluna: decide formato, alinhamento e largura.
 * - `text`: texto curto, centralizado; `long`: texto longo, à esquerda, largura até 42.
 * - `code`: identificador que confunde O com 0 (container, B/L, CE, lacre), em letra monoespaçada.
 * - `int`: contagem ou dias, centralizado; `decimal`: número com duas casas, à direita.
 * - `brl` e `usd`: dinheiro com a moeda, à direita, negativo em vermelho; somados na linha de total.
 * - `kg` e `cbm`: peso e volume, à direita; o peso é somado.
 * - `date` e `datetime`: data de verdade (ordena e filtra), centralizada.
 * - `status`: situação em texto; a cor segue a regra 5 (ver `STATUS_TONES`).
 * - `bool`: SIM/NÃO, centralizado.
 */
export type ColumnType = 'text' | 'long' | 'code' | 'int' | 'decimal' | 'brl' | 'usd' | 'kg' | 'cbm' | 'date' | 'datetime' | 'status' | 'bool'

export type StatusTone = 'paid' | 'warning' | 'danger' | 'muted'

export type SheetSpec = {
  /** Nome da aba (o Excel aceita até 31 caracteres). */
  name: string
  rows: Record<string, unknown>[]
  /** Substantivo da faixa de identidade e da linha de total: "7 faturas". */
  unit?: string
  /** Tipo por rótulo; o que não está aqui é inferido pelo rótulo e pelos valores. */
  types?: Record<string, ColumnType>
  /** Faixa de grupos acima do cabeçalho: cada grupo cobre do rótulo `from` ao `to`, inclusive. */
  groups?: Array<{ label: string; from: string; to: string }>
  /** Colunas somadas na linha de total além das de dinheiro e peso; `false` tira a linha. */
  totals?: string[] | false
  /** Planilha que serve de molde para reimportar: só cabeçalho, larguras e filtro; sem faixa, grupos nem total. */
  plain?: boolean
  /** Tom de situação por valor, além dos de `STATUS_TONES`. */
  tones?: Record<string, StatusTone>
}

export type WorkbookSpec = {
  product: ExportProduct
  /** Nome da tela ou do recorte, ao lado do produto na faixa de identidade. */
  title: string
  /** Filtros aplicados, um por item ("Situação = Em aberto"); vão para a faixa. */
  filters?: string[]
  sheets: SheetSpec[]
  fileName: string
  /** Momento da exportação; por padrão, agora. */
  exportedAt?: Date
}

// Cores da identidade (docs/identidade-visual.md, tabela "Cores"); espelham
// os tokens de src/index.css, que o Excel não lê.
const BRAND = {
  vela: { name: 'Vela', navy: 'FF152238', strip: 'FFEEF2F7', accent: 'FFD4882E', zebra: 'FFF1F4F8' },
  portal: { name: 'Portal Fwlog', navy: 'FF0D2B5E', strip: 'FFEDF3FA', accent: 'FFFFFFFF', zebra: 'FFF1F4F8' },
} as const
const INK = {
  text: 'FF121822', muted: 'FF4F5868', absent: 'FF9AA4B2', borderSoft: 'FFE2E6EC', white: 'FFFFFFFF',
  success: 'FF157A45', warning: 'FF8F4D08', warningBg: 'FFFDF0DC', danger: 'FFB0343A',
} as const
// Calibri e Consolas vêm com todo Excel; DM Sans e IBM Plex Mono (telas) não.
const FONT = 'Calibri'
const MONO = 'Consolas'
const FONT_SIZE = 10

export const NUMBER_FORMATS: Partial<Record<ColumnType, string>> = {
  brl: '"R$" #,##0.00;[Red]-"R$" #,##0.00',
  usd: '"US$" #,##0.00;[Red]-"US$" #,##0.00',
  int: '#,##0',
  decimal: '#,##0.00',
  kg: '#,##0 "kg"',
  cbm: '#,##0.000',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
}

const ALIGN: Record<ColumnType, 'left' | 'center' | 'right'> = {
  text: 'center', long: 'left', code: 'center', int: 'center', decimal: 'right', brl: 'right', usd: 'right',
  kg: 'right', cbm: 'right', date: 'center', datetime: 'center', status: 'center', bool: 'center',
}

const FIXED_WIDTH: Partial<Record<ColumnType, number>> = { brl: 15, usd: 14, kg: 13, cbm: 10, date: 12, datetime: 17, bool: 8 }
const SUMMED_TYPES: ReadonlySet<ColumnType> = new Set(['brl', 'usd', 'kg'])
const ABSENT = '—'

/**
 * Regra 5 na planilha: cor só para o que pede ação. Verde com ✓ no que
 * encerrou pago ou atendido; âmbar no que está em curso ou aguarda; vermelho
 * no que venceu, diverge ou bloqueia; cinza no que encerrou sem efeito (a
 * linha inteira fica cinza na cancelada e na obsoleta). O resto em tinta normal.
 */
export const STATUS_TONES: Record<string, StatusTone> = {
  paga: 'paid', pago: 'paid', atendido: 'paid', atendida: 'paid', concluida: 'paid', coberta: 'paid',
  'coberta pela consolidada': 'paid', 'em ordem': 'paid', devolvido: 'paid', 'pronto para emitir': 'paid',
  'em aberto': 'warning', pendente: 'warning', 'parcialmente paga': 'warning', 'parcialmente pago': 'warning',
  correndo: 'warning', 'a emitir': 'warning', emitida: 'warning', faturado: 'warning', 'em demurrage': 'warning',
  'aguardando fatura': 'warning', 'aguardando analise': 'warning', 'aguardando ce mercante': 'warning', aberta: 'warning',
  vencido: 'danger', vencida: 'danger', divergente: 'danger', bloqueado: 'danger', bloqueada: 'danger', fora: 'danger',
  'fora do prazo': 'danger',
  cancelada: 'muted', cancelado: 'muted', obsoleta: 'muted', isenta: 'muted', isento: 'muted', 'nao se aplica': 'muted',
}
const MUTED_ROW_LABELS: ReadonlySet<string> = new Set(['cancelada', 'cancelado', 'obsoleta'])

function normalize(label: string) {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

/**
 * Data para a célula: o Excel guarda o dia e a hora "como escritos", sem fuso.
 * `YYYY-MM-DD` e `dd/mm/yyyy` são o próprio dia; um instante (ISO com hora ou
 * `Date`) vira o dia e a hora locais de quem exporta, como a tela mostra.
 * Texto que não é data (ex.: "Fora") volta `null` e fica como texto.
 */
export function toExcelDate(value: unknown): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds()))
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  const only = text.match(DATE_ONLY)
  if (only) return new Date(Date.UTC(Number(only[1]), Number(only[2]) - 1, Number(only[3])))
  const br = text.match(DATE_BR)
  if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])))
  if (ISO_DATETIME.test(text)) return toExcelDate(new Date(text))
  return null
}

const isBlank = (value: unknown) => value == null || value === ''
const isNumeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value)

const MONEY_BRL = /\(r\$\)|\br\$\b|\bbrl\b|^subtotal$|^valor|^saldo$/
const MONEY_USD = /us\$|\busd\b/
const WEIGHT = /\(kg\)|^peso|^tara/
const VOLUME = /\bcbm\b|\(m3\)/
const DATE_LABEL = /^(emiss|pagamento|paga em|pago em|descarga|devolu|vencimento|importado em|criacao|ultimo calculo|ultima atividade|data\b|eta$|etb$|etd$|ata$|atd$)/
const STATUS_LABEL = /^(status|situacao|revisao|financeiro|decisao|conciliacao|motivo|divisao|ces|disputa|demurrage|taxas locais|revisao do b\/l|financeiro do b\/l|saude|alerta|perfil|natureza|termo|procuracao|b\/l original|na zpt)/
const CODE_LABEL = /^(container|b\/l|bl|b\/ls|b\/l ref|lacre|seal|ce mercante|ce|txid)$/
const BOOL_VALUES: ReadonlySet<string> = new Set(['sim', 'nao'])

/**
 * Tipo da coluna pelo rótulo e pelos valores, quando a exportação não declara.
 * ponytail: heurística por nome de coluna; cobre os rótulos que as exportações
 * usam hoje e cai em texto no resto. O caminho para um caso novo que ela erra
 * é declarar `types` na `SheetSpec`, não ensinar mais um rótulo aqui.
 */
export function inferColumnType(label: string, values: readonly unknown[]): ColumnType {
  const key = normalize(label)
  const present = values.filter((value) => !isBlank(value) && value !== ABSENT)
  const allNumbers = present.length > 0 && present.every(isNumeric)
  const mostlyNumbers = present.length > 0 && present.some(isNumeric) && present.every((value) => isNumeric(value) || typeof value === 'string')
  if (MONEY_USD.test(key) && (present.length === 0 || mostlyNumbers)) return 'usd'
  if (MONEY_BRL.test(key) && (present.length === 0 || mostlyNumbers)) return 'brl'
  if (WEIGHT.test(key) && (present.length === 0 || allNumbers)) return 'kg'
  if (VOLUME.test(key) && (present.length === 0 || allNumbers)) return 'cbm'
  // Coluna de data com só "Fora" (container não devolvido) continua data: o texto ganha a cor da situação.
  const dateLike = present.every((value) => toExcelDate(value) != null || (typeof value === 'string' && STATUS_TONES[normalize(value)] != null))
  if (DATE_LABEL.test(key) && dateLike) return 'date'
  if (present.length > 0 && present.every((value) => typeof value === 'string' && BOOL_VALUES.has(normalize(value)))) return 'bool'
  if (allNumbers) return present.every((value) => Number.isInteger(value)) ? 'int' : 'decimal'
  if (CODE_LABEL.test(key) && !allNumbers) return 'code'
  if (STATUS_LABEL.test(key)) return 'status'
  const longest = Math.max(0, ...present.map((value) => String(value).length))
  return longest > 14 ? 'long' : 'text'
}

function columnWidth(label: string, type: ColumnType, values: readonly unknown[]) {
  if (FIXED_WIDTH[type]) return Math.max(FIXED_WIDTH[type]!, label.length + 2)
  let longest = 0
  for (const value of values) if (!isBlank(value)) longest = Math.max(longest, String(value).length)
  const wanted = Math.max(longest + (type === 'code' ? 3 : 2), label.length + 2, 8)
  return Math.min(wanted, type === 'long' ? 42 : type === 'code' ? 46 : 36)
}

function cellFont(extra: FontSpec = {}): FontSpec {
  return { name: FONT, size: FONT_SIZE, color: { argb: INK.text }, ...extra }
}

function solid(argb: string): import('exceljs').Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function formatExportedAt(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type Column = { key: string; type: ColumnType }

function resolveColumns(sheet: SheetSpec, rows: Record<string, unknown>[]): Column[] {
  const keys = rows.length ? Object.keys(rows[0]) : Object.keys(sheet.types ?? {})
  return keys.map((key) => {
    const declared = sheet.types?.[key] ?? sheet.types?.[key.replace(/^'/, '')]
    return { key, type: declared ?? inferColumnType(key, rows.map((row) => row[key])) }
  })
}

function writeBand(ws: Worksheet, spec: WorkbookSpec, sheet: SheetSpec, ncol: number, rowCount: number) {
  const brand = BRAND[spec.product]
  const width = Math.max(ncol, 1)
  ws.mergeCells(1, 1, 1, width)
  const title = ws.getCell(1, 1)
  title.value = {
    richText: [
      { text: `${brand.name}  `, font: { name: FONT, size: 14, bold: true, color: { argb: brand.accent } } },
      { text: spec.title, font: { name: FONT, size: 14, bold: true, color: { argb: INK.white } } },
    ],
  }
  title.fill = solid(brand.navy)
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(1).height = 30

  ws.mergeCells(2, 1, 2, width)
  const context = ws.getCell(2, 1)
  const parts = [`Exportado em ${formatExportedAt(spec.exportedAt ?? new Date())}`, `${rowCount.toLocaleString('pt-BR')} ${sheet.unit ?? 'linhas'}`]
  if (spec.filters?.length) parts.push(`Filtros: ${spec.filters.join('; ')}`)
  context.value = parts.join(' · ')
  context.font = { name: FONT, size: FONT_SIZE, color: { argb: INK.muted } }
  context.fill = solid(brand.strip)
  context.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(2).height = 20
  ws.getRow(3).height = 6
  return 4
}

function writeGroups(ws: Worksheet, spec: WorkbookSpec, sheet: SheetSpec, columns: Column[], row: number) {
  const brand = BRAND[spec.product]
  for (const group of sheet.groups ?? []) {
    const from = columns.findIndex((column) => column.key === group.from) + 1
    const to = columns.findIndex((column) => column.key === group.to) + 1
    if (from < 1 || to < from) continue
    if (to > from) ws.mergeCells(row, from, row, to)
    const cell = ws.getCell(row, from)
    cell.value = group.label
    cell.font = { name: FONT, size: FONT_SIZE, bold: true, color: { argb: brand.navy } }
    cell.fill = solid(brand.strip)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    for (let c = from; c <= to; c++) {
      ws.getCell(row, c).border = {
        bottom: { style: 'medium', color: { argb: brand.navy } },
        left: c === from ? { style: 'thin', color: { argb: INK.white } } : undefined,
        right: c === to ? { style: 'thin', color: { argb: INK.white } } : undefined,
      }
    }
  }
  ws.getRow(row).height = 18
  return row + 1
}

function writeHeader(ws: Worksheet, spec: WorkbookSpec, columns: Column[], row: number) {
  const brand = BRAND[spec.product]
  columns.forEach((column, index) => {
    const cell = ws.getCell(row, index + 1)
    cell.value = column.key
    cell.font = { name: FONT, size: FONT_SIZE, bold: true, color: { argb: INK.white } }
    cell.fill = solid(brand.navy)
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { right: { style: 'thin', color: { argb: brand.navy } } }
  })
  ws.getRow(row).height = 24
  return row + 1
}

function statusTone(sheet: SheetSpec, value: unknown): StatusTone | undefined {
  if (typeof value !== 'string') return undefined
  const key = normalize(value)
  return sheet.tones?.[value] ?? sheet.tones?.[key] ?? STATUS_TONES[key]
}

function applyTone(cell: Cell, tone: StatusTone | undefined, value: string) {
  if (tone === 'paid') {
    cell.value = value.startsWith('✓') ? value : `✓ ${value}`
    cell.font = cellFont({ bold: true, color: { argb: INK.success } })
  } else if (tone === 'warning') {
    cell.font = cellFont({ bold: true, color: { argb: INK.warning } })
    cell.fill = solid(INK.warningBg)
  } else if (tone === 'danger') {
    cell.font = cellFont({ bold: true, color: { argb: INK.danger } })
  } else if (tone === 'muted') {
    cell.font = cellFont({ italic: true, color: { argb: INK.muted } })
  }
}

function writeCell(cell: Cell, column: Column, value: unknown, sheet: SheetSpec, mutedRow: boolean, zebra: string | null) {
  const { type } = column
  cell.alignment = { horizontal: ALIGN[type], vertical: 'middle' }
  cell.border = { bottom: { style: 'hair', color: { argb: INK.borderSoft } } }
  if (zebra) cell.fill = solid(zebra)
  cell.font = cellFont({ name: type === 'code' ? MONO : FONT, color: { argb: mutedRow ? INK.muted : INK.text } })

  if (isBlank(value) || value === ABSENT) {
    cell.value = ABSENT
    cell.font = cellFont({ color: { argb: INK.absent } })
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    return
  }
  if (type === 'date' || type === 'datetime') {
    const date = toExcelDate(value)
    if (date) {
      cell.value = date
      cell.numFmt = NUMBER_FORMATS[type]!
      return
    }
    cell.value = String(value)
    const tone = statusTone(sheet, value)
    if (tone && !mutedRow) applyTone(cell, tone, String(value))
    return
  }
  if (NUMBER_FORMATS[type] && isNumeric(value)) {
    cell.value = value as number
    cell.numFmt = NUMBER_FORMATS[type]!
    if (type === 'usd' && (value as number) > 0 && !mutedRow && column.key.toLowerCase().includes('previsto')) {
      cell.font = cellFont({ bold: true, color: { argb: INK.warning } })
    }
    return
  }
  if (type === 'bool') {
    cell.value = normalize(String(value)) === 'nao' ? 'NÃO' : String(value).toUpperCase()
    return
  }
  cell.value = typeof value === 'number' ? value : String(value)
  // Vários códigos na mesma célula ("A • B • C") leem-se da esquerda.
  if (type === 'code' && String(value).includes(' • ')) cell.alignment = { horizontal: 'left', vertical: 'middle' }
  if (type !== 'status') return
  const tone = statusTone(sheet, value)
  // Na linha cinza só a própria situação (Cancelada) recebe o tom; o resto fica em cinza.
  if (!mutedRow || tone === 'muted') applyTone(cell, tone, String(value))
}

function writeRows(ws: Worksheet, spec: WorkbookSpec, sheet: SheetSpec, columns: Column[], rows: Record<string, unknown>[], firstRow: number) {
  const brand = BRAND[spec.product]
  const statusKeys = columns.filter((column) => column.type === 'status').map((column) => column.key)
  rows.forEach((row, index) => {
    const excelRow = firstRow + index
    const mutedRow = statusKeys.some((key) => typeof row[key] === 'string' && MUTED_ROW_LABELS.has(normalize(row[key] as string)))
    const zebra = !sheet.plain && index % 2 === 1 ? brand.zebra : null
    columns.forEach((column, c) => writeCell(ws.getCell(excelRow, c + 1), column, row[column.key], sheet, mutedRow, zebra))
    ws.getRow(excelRow).height = 18
  })
  return firstRow + rows.length
}

function writeTotals(ws: Worksheet, spec: WorkbookSpec, sheet: SheetSpec, columns: Column[], firstDataRow: number, row: number, rowCount: number) {
  const brand = BRAND[spec.product]
  const extra = new Set(sheet.totals === false ? [] : sheet.totals ?? [])
  const summed = columns.filter((column) => SUMMED_TYPES.has(column.type) || extra.has(column.key))
  if (!summed.length || rowCount === 0 || sheet.totals === false) return row
  columns.forEach((column, index) => {
    const cell = ws.getCell(row, index + 1)
    cell.fill = solid(brand.strip)
    cell.border = { top: { style: 'medium', color: { argb: brand.navy } } }
    cell.font = { name: FONT, size: FONT_SIZE, bold: true, color: { argb: brand.navy } }
    if (index === 0) {
      cell.value = `Total · ${rowCount.toLocaleString('pt-BR')} ${sheet.unit ?? 'linhas'}`
      cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    }
    if (summed.includes(column)) {
      const letter = ws.getColumn(index + 1).letter
      cell.value = { formula: `SUM(${letter}${firstDataRow}:${letter}${row - 1})` }
      cell.numFmt = NUMBER_FORMATS[column.type] ?? NUMBER_FORMATS.int!
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }
  })
  ws.getRow(row).height = 20
  return row + 1
}

function addSheet(workbook: Workbook, spec: WorkbookSpec, sheet: SheetSpec) {
  const brand = BRAND[spec.product]
  const rows = sanitizeSheetRows(sheet.rows)
  const columns = resolveColumns(sheet, rows)
  const ws = workbook.addWorksheet(sheet.name.slice(0, 31), { properties: { tabColor: { argb: brand.navy } } })

  let row = 1
  if (!sheet.plain) row = writeBand(ws, spec, sheet, columns.length, rows.length)
  if (!sheet.plain && sheet.groups?.length) row = writeGroups(ws, spec, sheet, columns, row)
  const headerRow = row
  row = writeHeader(ws, spec, columns, row)
  const firstDataRow = row
  row = writeRows(ws, spec, sheet, columns, rows, row)
  if (!sheet.plain) writeTotals(ws, spec, sheet, columns, firstDataRow, row, rows.length)

  columns.forEach((column, index) => {
    ws.getColumn(index + 1).width = columnWidth(column.key, column.type, rows.map((r) => r[column.key]))
  })
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRow, showGridLines: Boolean(sheet.plain) }]
  if (columns.length) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, firstDataRow + rows.length - 1), column: columns.length } }
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: `${headerRow}:${headerRow}` }
  ws.headerFooter = { oddFooter: `&L${brand.name} · ${spec.title}&RPágina &P de &N` }
  return ws
}

/** Monta a pasta de trabalho com o padrão; separado de `writeWorkbook` para o teste ler o resultado. */
export function buildWorkbook(ExcelJS: ExcelJSModule, spec: WorkbookSpec): Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = BRAND[spec.product].name
  workbook.created = spec.exportedAt ?? new Date()
  for (const sheet of spec.sheets) addSheet(workbook, spec, sheet)
  return workbook
}

async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = (await import('exceljs')) as ExcelJSModule & { default?: ExcelJSModule }
  return mod.default ?? mod
}

/** Gera a planilha no padrão e baixa o arquivo. */
export async function writeWorkbook(spec: WorkbookSpec): Promise<void> {
  const ExcelJS = await loadExcelJS()
  const workbook = buildWorkbook(ExcelJS, spec)
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(spec.fileName, new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

/** `AAAAMMDDHHMM` do momento, para o nome do arquivo. */
export function exportTimestamp(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
}
