// ADR 0091 item 7: o B/L avulso vem do armador em .docx ou .pdf, então o modelo
// é um B/L de exemplo no formato aceito, com dados fictícios, que o leitor
// real lê sem erro nem aviso.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseBlDocumentBuffer } from '../blDocumentParser'

describe('modelo do B/L avulso', () => {
  it('docx: lido pelo leitor real, sem erro nem aviso e sem dado de cliente real', async () => {
    const raw = await readFile('public/templates/bl-avulso-exemplo.docx')
    const document = await parseBlDocumentBuffer(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, 'docx')

    expect(document.errors).toEqual([])
    expect(document.warnings).toEqual([])
    expect(document.bl_id).toBe('CSXW99TCVT01')
    expect(document.shipper).toBe('EXEMPLO EXPORTER PTE LTD')
    expect(document.consignee).toBe('CLIENTE EXEMPLO S.A')
    expect(document.cnpj_cpf).toBe('11222333000181')
    expect(document.pol).toBe('CNTAC')
    expect(document.pod).toBe('BRVIX')
    expect(document.packages_qty).toBe(6)
    expect(document.gross_weight_kg).toBe(16975)
  })
})
