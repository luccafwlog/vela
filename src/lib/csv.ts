import { sanitizeCellValue } from './spreadsheetSafe'

// O separador \u00E9 a v\u00EDrgula, mas o Excel em pt-BR abre CSV separando por ';'
// (e alguns leitores por tab): campo com ';' ou tab sem aspas viraria duas
// c\u00E9lulas, e o peda\u00E7o depois do separador poderia come\u00E7ar com '='. Por isso
// esses campos tamb\u00E9m v\u00E3o entre aspas. Cabe\u00E7alho e valores passam pelo mesmo
// escape, inclusive a neutraliza\u00E7\u00E3o de f\u00F3rmula.
function escapeCsvField(value: string) {
  const text = String(sanitizeCellValue(String(value ?? '')))
  if (/[",;\t\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return text
}

export function formatCsv(headers: string[], rows: string[][]): string {
  const bom = '\uFEFF'
  return bom + [headers.map(escapeCsvField).join(','), ...rows.map((r) => r.map(escapeCsvField).join(','))].join('\n')
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = formatCsv(headers, rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
