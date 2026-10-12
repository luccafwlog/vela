import { describe, expect, it } from 'vitest'
import {
  decodeImportBytes,
  detectImportFormat,
  inspectImportFile,
  inspectImportUpload,
  isBinarySpreadsheetBuffer,
} from '../importText'

describe('decodeImportBytes', () => {
  it('round-trip UTF-8 sem BOM preserva Vitória/São/ç', () => {
    const original = 'VITÓRIA;SÃO PAULO;ç\nBRVIX;BRSSZ;teste'
    const bytes = new TextEncoder().encode(original).buffer as ArrayBuffer
    const decoded = decodeImportBytes(bytes)
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.hadBom).toBe(false)
    expect(decoded.text).toBe(original)
  })

  it('remove BOM UTF-8 e sinaliza encoding', () => {
    const original = 'VITÓRIA'
    const withoutBom = new TextEncoder().encode(original)
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...withoutBom])
    const decoded = decodeImportBytes(withBom.buffer as ArrayBuffer)
    expect(decoded.encoding).toBe('utf-8-sig')
    expect(decoded.hadBom).toBe(true)
    expect(decoded.text).toBe(original)
  })

  it('rejeita bytes inválidos sem fallback autorizado', () => {
    const latin1 = new Uint8Array([0x53, 0xe3, 0x6f]) // 'S' + 0xE3 + 'o' (ã em latin1, inválido em UTF-8)
    expect(() => decodeImportBytes(latin1.buffer as ArrayBuffer)).toThrow(/sem fallback autorizado/)
  })

  it('usa Windows-1252 somente com origem autorizada', () => {
    const latin1 = new Uint8Array([0x53, 0xe3, 0x6f])
    const decoded = decodeImportBytes(latin1.buffer as ArrayBuffer, { allowWindows1252Fallback: true })
    expect(decoded.encoding).toBe('windows-1252')
    expect(decoded.text).toBe('São')
  })

  it('nunca aceita XLS/XLSX binário pelo decoder textual', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]).buffer as ArrayBuffer
    expect(isBinarySpreadsheetBuffer(zip)).toBe(true)
    expect(() => decodeImportBytes(zip)).toThrow(/binário/)
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00]).buffer as ArrayBuffer
    expect(isBinarySpreadsheetBuffer(ole)).toBe(true)
  })

})

describe('detectImportFormat', () => {
  it('detecta XLSX e XLS pelo conteúdo binário', () => {
    expect(detectImportFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer)).toBe('xlsx')
    expect(detectImportFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]).buffer)).toBe('xls')
  })

  it('detecta CSV delimitado por ponto e vírgula', () => {
    const bytes = new TextEncoder().encode('BL;Container\nBL-1;MSCU1234567').buffer as ArrayBuffer
    expect(detectImportFormat(bytes)).toBe('csv')
  })

  it('desambigua CSV pt-BR com ponto e vírgula e vírgula decimal', () => {
    const bytes = new TextEncoder().encode('Item;Preco;Taxa\n1;1,50;2,30\n2;3,40;4,50').buffer as ArrayBuffer
    expect(detectImportFormat(bytes)).toBe('csv')
  })

  it('detecta CSV de coluna única estruturado', () => {
    const bytes = new TextEncoder().encode('Container\nMSCU1234567\nTEMU7654321').buffer as ArrayBuffer
    expect(detectImportFormat(bytes)).toBe('csv')
  })

  it('preserva campos entre aspas com quebra de linha na detecção de CSV', () => {
    const bytes = new TextEncoder().encode('BL;Obs\nBL-1;"linha 1\nlinha 2"\nBL-2;"obs normal"').buffer as ArrayBuffer
    expect(detectImportFormat(bytes)).toBe('csv')
  })

	it('detecta EDI EDIFACT e arquivo posicional do Mercante', () => {
    const edifact = new TextEncoder().encode("UNB+UNOA:2+X+Y'UNH+1+BAPLIE:D:95B:UN:SMDG22'").buffer as ArrayBuffer
    expect(detectImportFormat(edifact)).toBe('edi')

    const mercante = new TextEncoder().encode('M50001226501030729                       CNTAGBRVIXCN001321\nC50001226501030729  122605179628557                              CSC45360805C00').buffer as ArrayBuffer
    expect(detectImportFormat(mercante)).toBe('edi')

    const mercanteSingleSpace = new TextEncoder().encode('M50001226501030729 CNTAGBRVIX\nC50001226501030729 122605179628557 CSC45360805C00').buffer as ArrayBuffer
		expect(detectImportFormat(mercanteSingleSpace)).toBe('edi')
	})

	it('não confunde uma planilha com códigos M1/M2 com EDI Mercante', () => {
		const bytes = new TextEncoder().encode([
			'CODIGO\tDESCRICAO',
			'M1\tCARGA GERAL',
			'M2\tGRANEL',
		].join('\n')).buffer as ArrayBuffer

		expect(detectImportFormat(bytes)).toBe('csv')
	})

	it('aceita CSV de coluna única somente com cabeçalho operacional plausível', () => {
		const structured = new TextEncoder().encode('Container\nMSCU1234567\nTEMU7654321').buffer as ArrayBuffer
		const prose = new TextEncoder().encode('Relatorio operacional\nSegue em anexo para conferencia.').buffer as ArrayBuffer

		expect(detectImportFormat(structured)).toBe('csv')
		expect(() => detectImportFormat(prose)).toThrow(/não reconhecido/i)
	})

	it('recusa texto sem formato reconhecível e delimitadores ambíguos', () => {
    const unknown = new TextEncoder().encode('apenas uma observação').buffer as ArrayBuffer
    expect(() => detectImportFormat(unknown)).toThrow(/não reconhecido/i)

    const ambiguous = new TextEncoder().encode('A,B;C\nD,E;F').buffer as ArrayBuffer
    expect(() => detectImportFormat(ambiguous)).toThrow(/ambíguo/i)
  })
})

describe('inspectImportFile', () => {
  it('expõe formato, encoding e prévia textual sem alterar o conteúdo exibido', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('BL;Cidade\n1;Vitória')])
    expect(inspectImportFile(bytes.buffer as ArrayBuffer)).toEqual({
      format: 'csv',
      encoding: 'utf-8-sig',
      hadBom: true,
      preview: 'BL;Cidade\n1;Vitória',
      byteLength: bytes.byteLength,
    })
  })

  // ADR 0078, item 22: o diagnóstico do modal roda antes do parser e não pode
  // recusar o CSV Windows-1252 que o leitor de planilhas aceita com aviso.
  it('aceita CSV Windows-1252 e o sinaliza no encoding; false recusa', async () => {
    // "BL;Cidade\n1;São" em Windows-1252.
    const bytes = Uint8Array.from([0x42, 0x4c, 0x3b, 0x43, 0x69, 0x64, 0x61, 0x64, 0x65, 0x0a, 0x31, 0x3b, 0x53, 0xe3, 0x6f])
    const buffer = bytes.buffer as ArrayBuffer
    expect(inspectImportFile(buffer)).toMatchObject({ format: 'csv', encoding: 'windows-1252', preview: 'BL;Cidade\n1;São' })
    await expect(inspectImportUpload({ arrayBuffer: async () => buffer })).resolves.toMatchObject({ encoding: 'windows-1252' })
    expect(() => inspectImportFile(buffer, { allowWindows1252Fallback: false })).toThrow(/sem fallback autorizado/)
  })
})
