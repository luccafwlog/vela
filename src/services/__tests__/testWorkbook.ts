import * as XLSX from '@e965/xlsx'

export function aoaToBuffer(rows: Array<Array<string | number | Date>>) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

export function jsonToBuffer(rows: Array<Record<string, string | number>>) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

/**
 * Reescreve o `<dimension>` da primeira aba de um XLSX: o arquivo declara a
 * faixa que quiser, sem ter as células (planilha "pequena e enorme").
 */
export function withDeclaredDimension(buffer: ArrayBuffer, ref: string): ArrayBuffer {
  const zip = XLSX.CFB.read(new Uint8Array(buffer), { type: 'array' })
  const index = zip.FullPaths.findIndex((path) => path.endsWith('xl/worksheets/sheet1.xml'))
  const entry = zip.FileIndex[index]
  const xml = new TextDecoder().decode(entry.content as Uint8Array)
  entry.content = new TextEncoder().encode(xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${ref}"/>`)) as never
  return XLSX.CFB.write(zip, { fileType: 'zip', type: 'array' }) as ArrayBuffer
}

export function sheetsToBuffer(sheets: Array<{ name: string; rows: Array<Record<string, string | number>> }>) {
  const workbook = XLSX.utils.book_new()
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name)
  }
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}
