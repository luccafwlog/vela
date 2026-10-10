import { describe, expect, it } from 'vitest'
import { createHeaderMapper, createRowErrorCollector, locateHeaderRowIndex, matchHeaders, readFirstSheetRows, readSheet, type HeaderSpec } from '../importCore'
import { aoaToBuffer, jsonToBuffer } from './testWorkbook'

describe('createHeaderMapper', () => {
  it('normaliza cabeçalhos (trim + lowercase) e mapeia para a chave canônica', () => {
    const sampleRow = { '  Booking ': 'X', 'CONTAINER': 'Y', 'Coluna Desconhecida': 'Z' }
    const mapRow = createHeaderMapper(sampleRow, {
      'booking': 'booking_number',
      'container': 'container_number',
    })

    expect(mapRow({ '  Booking ': 'BK1', 'CONTAINER': 'MSCU1234567', 'Coluna Desconhecida': 'ignorar' })).toEqual({
      booking_number: 'BK1',
      container_number: 'MSCU1234567',
    })
  })

  it('ignora cabeçalhos sem correspondência no mapa', () => {
    const mapRow = createHeaderMapper({ 'Outra': 1 }, { 'booking': 'booking_number' })
    expect(mapRow({ 'Outra': 1 })).toEqual({})
  })
})

describe('createRowErrorCollector', () => {
  it('acumula erros no formato { row, message, raw }', () => {
    const collector = createRowErrorCollector()
    expect(collector.errors).toEqual([])

    const raw = { bl: '' }
    collector.add(2, 'BL ausente — linha ignorada.', raw)
    collector.add(5, 'BL ABC123 duplicado na planilha.', raw)

    expect(collector.errors).toEqual([
      { row: 2, message: 'BL ausente — linha ignorada.', raw },
      { row: 5, message: 'BL ABC123 duplicado na planilha.', raw },
    ])
  })
})

describe('readFirstSheetRows', () => {
  it('lê a primeira aba como linhas-objeto com defval vazio', async () => {
    const buffer = jsonToBuffer([
      { Booking: 'BK1', Container: 'MSCU1234567' },
      { Booking: 'BK2', Container: '' },
    ])

    const rows = await readFirstSheetRows(buffer)
    expect(rows).toEqual([
      { Booking: 'BK1', Container: 'MSCU1234567' },
      { Booking: 'BK2', Container: '' },
    ])
  })

  it('lança "Planilha vazia." quando só há cabeçalho', async () => {
    const buffer = aoaToBuffer([['Booking', 'Container']])
    await expect(readFirstSheetRows(buffer)).rejects.toThrow('Planilha vazia.')
  })
})

async function buildWorkbook(rows: Record<string, unknown>[]): Promise<ArrayBuffer> {
  const XLSX = await import('@e965/xlsx')
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Plan1')
  return XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

describe('readSheet', () => {
  it('devolve cabecalhos e linhas-objeto da primeira aba', async () => {
    const buffer = await buildWorkbook([{ Container: 'ABCD1234567', Tipo: '40HC' }])
    const { headers, rows } = await readSheet(buffer)
    expect(headers).toEqual(['Container', 'Tipo'])
    expect(rows).toEqual([{ Container: 'ABCD1234567', Tipo: '40HC' }])
  })

  it('entrega a célula de data do Excel como data civil AAAA-MM-DD, sem fuso', async () => {
    const buffer = await buildWorkbook([{ Data: new Date(Date.UTC(2026, 6, 27)) }])
    const { rows } = await readSheet(buffer)
    expect(rows[0].Data).toBe('2026-07-27')
  })

  it('preenche celula ausente com string vazia', async () => {
    const buffer = await buildWorkbook([{ A: 'x', B: 'y' }, { A: 'z' }])
    const { rows } = await readSheet(buffer)
    expect(rows[1].B).toBe('')
  })

  it('lanca a mensagem historica quando a planilha nao tem linhas', async () => {
    await expect(readSheet(aoaToBuffer([['A']]))).rejects.toThrow('Planilha vazia.')
  })

  it('localiza cabecalho depois de um preambulo e preserva o numero da linha', async () => {
    const { headers, rows, headerRowIndex } = await readSheet(
      aoaToBuffer([
        ['Relatorio de containers'],
        ['Gerado em 2026-09-09'],
        ['BL', 'Container'],
        ['BL-1', 'MSCU1234567'],
      ]),
      { expectedHeaders: ['bl', 'container'] },
    )

		expect(headerRowIndex).toBe(2)
		expect(headers).toEqual(['BL', 'Container'])
		expect(rows).toEqual([{ BL: 'BL-1', Container: 'MSCU1234567' }])
		expect(rows[0]?.rowNumber).toBe(4)
	})

	it('mantém o número físico depois de uma linha vazia entre registros', async () => {
		const { rows } = await readSheet(
			aoaToBuffer([
				['Relatorio de containers'],
				[''],
				['BL', 'Container'],
				['BL-1', 'MSCU1234567'],
				[''],
				['BL-2', 'TEMU7654321'],
			]),
			{ expectedHeaders: ['bl', 'container'] },
		)

		expect(rows.map((row) => row.rowNumber)).toEqual([4, 6])
	})

  it('lê CSV Windows-1252 por padrão (com aviso) e recusa quando a origem o proíbe', async () => {
    const bytes = Uint8Array.from([0x42, 0x4c, 0x3b, 0x43, 0x69, 0x64, 0x61, 0x64, 0x65, 0x0a, 0x31, 0x3b, 0x53, 0xe3, 0x6f])
    const buffer = bytes.buffer as ArrayBuffer

    // ADR 0078, item 22: CSV Windows-1252 é aceito com aviso.
    const { rows } = await readSheet(buffer)
    expect(rows).toEqual([{ BL: '1', Cidade: 'São' }])
    await expect(readSheet(buffer, { allowWindows1252Fallback: false })).rejects.toThrow(/sem fallback autorizado/)
  })

  it('não envia EDI para o leitor de planilhas', async () => {
    const buffer = new TextEncoder().encode("UNB+UNOA:2+X+Y'UNH+1+BAPLIE:D:95B:UN:SMDG22'").buffer as ArrayBuffer
    await expect(readSheet(buffer)).rejects.toThrow(/Arquivo EDI recebido no leitor de planilhas/)
  })
})

describe('locateHeaderRowIndex', () => {
  it('recusa mais de uma linha candidata na janela', () => {
    expect(() => locateHeaderRowIndex([
      ['BL', 'Container'],
      ['Nota'],
      ['Container', 'Data'],
    ], ['bl', 'container'])).toThrow('Cabeçalho ambíguo')
  })
})

const spec: HeaderSpec<'container' | 'tipo' | 'observacao'> = {
  aliases: {
    container: ['container', 'conteiner', 'n container'],
    tipo: ['tipo', 'type', 'tipo container'],
    observacao: ['observacao', 'obs'],
  },
  required: ['container', 'tipo'],
}

describe('matchHeaders', () => {
  it('casa cabecalhos ignorando caixa, acento e espaco extra', () => {
    const result = matchHeaders(['  CONTÊINER ', 'Tipo Container', 'OBS'], spec)
    expect(result.columnByField).toEqual({ container: '  CONTÊINER ', tipo: 'Tipo Container', observacao: 'OBS' })
    expect(result.missing).toEqual([])
  })

  it('relata apenas colunas obrigatorias ausentes', () => {
    const result = matchHeaders(['Tipo'], spec)
    expect(result.missing).toEqual(['container'])
    expect(result.columnByField.tipo).toBe('Tipo')
  })

  it('nao reclama de coluna opcional ausente', () => {
    const result = matchHeaders(['Container', 'Tipo'], spec)
    expect(result.missing).toEqual([])
    expect(result.columnByField.observacao).toBeUndefined()
  })

  it('recusa duas colunas para o mesmo campo (ADR 0078, item 22)', () => {
    expect(() => matchHeaders(['Container', 'Conteiner'], spec)).toThrow('As colunas "Container" e "Conteiner" são o mesmo campo')
  })
})

describe('readSheet — regras comuns (ADR 0078, item 22)', () => {
  async function workbookWith(build: (XLSX: typeof import('@e965/xlsx')) => import('@e965/xlsx').WorkBook) {
    const XLSX = await import('@e965/xlsx')
    return XLSX.write(build(XLSX), { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  }

  it('o mesmo cabeçalho duas vezes bloqueia a leitura', async () => {
    const buffer = aoaToBuffer([['Container', 'Tipo', 'container'], ['ABCD1234567', '40HC', 'EFGH7654321']])
    await expect(readSheet(buffer)).rejects.toThrow('A coluna "container" aparece duas vezes no cabeçalho')
  })

  it('duas colunas para o mesmo campo bloqueiam a importação', () => {
    const spec: HeaderSpec<'container'> = { aliases: { container: ['container', 'cntr'] }, required: ['container'] }
    expect(() => matchHeaders(['Container', 'CNTR'], spec)).toThrow('As colunas "Container" e "CNTR" são o mesmo campo')
    expect(() => createHeaderMapper({ Container: 'x', CNTR: 'y' }, { container: 'container_number', cntr: 'container_number' }))
      .toThrow('As colunas "Container" e "CNTR" são o mesmo campo')
  })

  it('linhas ocultas são ignoradas e contadas no aviso', async () => {
    const buffer = await workbookWith((XLSX) => {
      const sheet = XLSX.utils.aoa_to_sheet([['Container'], ['VISI1234567'], ['OCUL1234567'], ['VISI7654321']])
      sheet['!rows'] = [{}, {}, { hidden: true }, {}]
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Plan1')
      return book
    })
    const { rows, warnings } = await readSheet(buffer)
    expect(rows.map((row) => [row.Container, row.rowNumber])).toEqual([['VISI1234567', 2], ['VISI7654321', 4]])
    expect(warnings).toEqual(['1 linha oculta ignorada: o filtro da planilha indica importar só o visível.'])
  })

  it('aba oculta é ignorada com aviso e a primeira aba visível é lida', async () => {
    const buffer = await workbookWith((XLSX) => {
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Container'], ['OCUL1234567']]), 'Rascunho')
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Container'], ['VISI1234567']]), 'Dados')
      book.Workbook = { Sheets: [{ name: 'Rascunho', Hidden: 1 }, { name: 'Dados', Hidden: 0 }] }
      return book
    })
    const { rows, warnings } = await readSheet(buffer)
    expect(rows.map((row) => row.Container)).toEqual(['VISI1234567'])
    expect(warnings).toEqual(['Aba oculta "Rascunho" ignorada.'])
  })

  it('CSV Windows-1252 é aceito com aviso e mantém os acentos', async () => {
    // "Descrição;Peso\nMáquina;12,5" codificado em Windows-1252.
    const bytes = new Uint8Array([
      0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f, 0x3b, 0x50, 0x65, 0x73, 0x6f, 0x0a,
      0x4d, 0xe1, 0x71, 0x75, 0x69, 0x6e, 0x61, 0x3b, 0x31, 0x32, 0x2c, 0x35, 0x0a,
    ])
    const { rows, warnings } = await readSheet(bytes.buffer)
    expect(rows).toEqual([{ 'Descrição': 'Máquina', Peso: '12,5' }])
    expect(warnings).toEqual([expect.stringContaining('Windows-1252')])
  })

  it('CSV chega como texto, sem o SheetJS converter número nem data', async () => {
    const csv = new TextEncoder().encode('Data;Valor\n05/03/2026;12,5\n').buffer as ArrayBuffer
    const { rows } = await readSheet(csv)
    expect(rows).toEqual([{ Data: '05/03/2026', Valor: '12,5' }])
  })

  it('número tipado e máscara de zeros: CNPJ e CEP mantêm os zeros', async () => {
    const buffer = await workbookWith((XLSX) => {
      const sheet = XLSX.utils.aoa_to_sheet([['CNPJ', 'Peso']])
      sheet.A2 = { t: 'n', v: 205000000128, z: '00000000000000' }
      sheet.B2 = { t: 'n', v: 2200, z: '#,##0' }
      sheet['!ref'] = 'A1:B2'
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Plan1')
      return book
    })
    const { rows } = await readSheet(buffer)
    expect(rows).toEqual([{ CNPJ: '00205000000128', Peso: 2200 }])
  })
})
