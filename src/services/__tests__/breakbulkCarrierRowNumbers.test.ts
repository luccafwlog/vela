// Revisão da PR 929 (E3-11): o layout do armador numerava o B/L pelo índice da
// matriz do leitor comum. Com linhas ocultas fora da matriz (ou o B/L em mais
// de uma linha), a linha mostrada na prévia não era a da planilha.
import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'
import { parseBreakbulkManifestBuffer } from '../breakbulkManifestParser'

const HEADER = ['B/L NO.', 'POD', 'DECRIPTION', 'Pkg', 'G.W(KGS)', 'CBM', 'SHIPPER', 'CONSIGNEE', 'NOTIFY']

function carrierManifest(rows: Array<Array<string | number>>, hidden: number[] = []): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!rows'] = rows.map((_, index) => (hidden.includes(index) ? { hidden: true } : {}))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Manifest')
  return XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

describe('manifesto BB no layout do armador — número da linha', () => {
  it('usa a linha física do B/L, mesmo com linha oculta antes dele', async () => {
    const parsed = await parseBreakbulkManifestBuffer(carrierManifest([
      ['CARGO MANIFEST'],
      HEADER,
      ['A205OCULTO01', 'VITORIA,BRAZIL', '1 UNIT EXCAVATOR', 1, 20000, 50, 'SHIPPER LTDA', 'CONSIGNEE LTDA', 'SAME AS CONSIGNEE'],
      ['A205VISIVEL1', 'VITORIA,BRAZIL', '1 UNIT EXCAVATOR', 1, 20000, 50, 'SHIPPER LTDA', '', 'SAME AS CONSIGNEE'],
    ], [2]))

    expect(parsed.layout).toBe('carrier')
    expect(parsed.bls.map((bl) => [bl.bl_id, bl.rowNumber])).toEqual([['A205VISIVEL1', 4]])
    expect(parsed.rowErrors).toEqual([
      expect.objectContaining({ row: 4, message: 'Consignatario nao identificado para o BL A205VISIVEL1.' }),
    ])
  })

  it('B/L em mais de uma linha é numerado pela linha do número do B/L', async () => {
    const parsed = await parseBreakbulkManifestBuffer(carrierManifest([
      ['CARGO MANIFEST'],
      HEADER,
      ['A205GRUPO001', 'VITORIA,BRAZIL', '2 UNITS EXCAVATOR', 2, 40000, 100, 'SHIPPER LTDA', 'CONSIGNEE LTDA', 'SAME AS CONSIGNEE'],
      ['', '', 'CHASSIS 001/002'],
      ['A205GRUPO002', 'VITORIA,BRAZIL', '1 UNIT EXCAVATOR', 1, 20000, 50, 'SHIPPER LTDA', 'CONSIGNEE LTDA', 'SAME AS CONSIGNEE'],
    ]))

    expect(parsed.bls.map((bl) => [bl.bl_id, bl.rowNumber])).toEqual([['A205GRUPO001', 3], ['A205GRUPO002', 5]])
  })
})
