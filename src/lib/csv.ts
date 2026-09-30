import { sanitizeCellValue } from './spreadsheetSafe'

export function formatCsv(headers: string[], rows: string[][]): string {
  const bom = '\uFEFF'
  const escape = (v: string) => {
    let s = String(v ?? '')
    s = String(sanitizeCellValue(s))
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }
  return bom + [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n')
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
