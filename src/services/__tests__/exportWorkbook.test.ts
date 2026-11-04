import { describe, expect, it } from 'vitest'
import * as ExcelJS from 'exceljs'
import { buildWorkbook, inferColumnType, toExcelDate, type WorkbookSpec } from '../exportWorkbook'

// Contra o exceljs real: o que o Excel vai abrir, não um espelho da implementação.
const exportedAt = new Date(2026, 10, 3, 14, 32)
const faturas: WorkbookSpec = {
  product: 'vela',
  title: 'Faturas · Taxas Locais',
  filters: ['Situação = Em aberto'],
  exportedAt,
  fileName: 'faturas.xlsx',
  sheets: [{
    name: 'Faturas',
    unit: 'faturas',
    groups: [{ label: 'Fatura', from: 'Fatura', to: 'Situação' }, { label: 'Financeiro', from: 'Total (R$)', to: 'Saldo (R$)' }],
    rows: [
      { Fatura: 'FAT-1', Cliente: 'Importadora Atlântico Comércio Exterior e Logística Ltda', Situação: 'Paga', Emissão: '2026-10-14', Pagamento: '2026-10-21T12:00:00Z', 'Total (R$)': 18420.5, 'Saldo (R$)': 0 },
      { Fatura: 'FAT-2', Cliente: 'Rio Verde', Situação: 'Em aberto', Emissão: '2026-10-15', Pagamento: '', 'Total (R$)': 7310, 'Saldo (R$)': 7310 },
      { Fatura: 'FAT-3', Cliente: 'Sul Peças', Situação: 'Cancelada', Emissão: '2026-10-22', Pagamento: null, 'Total (R$)': 5890.2, 'Saldo (R$)': 0 },
    ],
  }],
}

const argb = (fill: ExcelJS.Fill | undefined) => (fill && fill.type === 'pattern' ? fill.fgColor?.argb : undefined)

describe('buildWorkbook', () => {
  const sheet = buildWorkbook(ExcelJS, faturas).getWorksheet('Faturas')!
  // Linhas: 1 título, 2 contexto, 3 respiro, 4 grupos, 5 cabeçalho, 6-8 dados, 9 total.
  const header = sheet.getRow(5)
  const data = (n: number) => sheet.getRow(5 + n)

  it('faixa de identidade com o produto, a tela, o momento, a contagem e os filtros', () => {
    const title = sheet.getCell('A1').value as ExcelJS.CellRichTextValue
    expect(title.richText.map((part) => part.text)).toEqual(['Vela  ', 'Faturas · Taxas Locais'])
    expect(title.richText[0].font?.color?.argb).toBe('FFD4882E')
    expect(argb(sheet.getCell('A1').fill)).toBe('FF152238')
    expect(sheet.getCell('A2').value).toBe('Exportado em 03/11/2026 14:32 · 3 faturas · Filtros: Situação = Em aberto')
    expect(sheet.getCell('A2').isMerged).toBe(true)
  })

  it('faixa de grupos e cabeçalho azul-marinho, congelado e com filtro', () => {
    expect(sheet.getCell('A4').value).toBe('Fatura')
    expect(sheet.getCell('C4').isMerged).toBe(true)
    expect(sheet.getCell('F4').value).toBe('Financeiro')
    expect(header.getCell(1).value).toBe('Fatura')
    expect(argb(header.getCell(1).fill)).toBe('FF152238')
    expect(header.getCell(1).font.bold).toBe(true)
    expect(header.getCell(1).font.color?.argb).toBe('FFFFFFFF')
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 5, showGridLines: false })
    expect(sheet.autoFilter).toEqual({ from: { row: 5, column: 1 }, to: { row: 8, column: 7 } })
  })

  it('dinheiro com a moeda, à direita, e data de verdade sem deslocar o dia', () => {
    const total = data(1).getCell(6)
    expect(total.value).toBe(18420.5)
    expect(total.numFmt).toBe('"R$" #,##0.00;[Red]-"R$" #,##0.00')
    expect(total.alignment.horizontal).toBe('right')
    const emissao = data(1).getCell(4).value as Date
    expect(emissao).toBeInstanceOf(Date)
    expect([emissao.getUTCFullYear(), emissao.getUTCMonth(), emissao.getUTCDate()]).toEqual([2026, 9, 14])
    expect(data(1).getCell(4).numFmt).toBe('dd/mm/yyyy')
    const pagamento = data(1).getCell(5).value as Date
    expect(pagamento.getUTCDate()).toBe(21)
    expect(data(2).getCell(5).value).toBe('—')
    expect(data(3).getCell(5).value).toBe('—')
  })

  it('situação com a cor da regra 5: ✓ verde na paga, âmbar na em aberto, cinza na cancelada (a linha inteira)', () => {
    expect(data(1).getCell(3).value).toBe('✓ Paga')
    expect(data(1).getCell(3).font.color?.argb).toBe('FF157A45')
    expect(data(2).getCell(3).value).toBe('Em aberto')
    expect(data(2).getCell(3).font.color?.argb).toBe('FF8F4D08')
    expect(argb(data(2).getCell(3).fill)).toBe('FFFDF0DC')
    expect(data(3).getCell(3).font.italic).toBe(true)
    expect(data(3).getCell(2).font.color?.argb).toBe('FF4F5868')
    expect(data(1).getCell(2).font.color?.argb).toBe('FF121822')
  })

  it('linha de total com a contagem e SOMA() viva nas colunas de dinheiro', () => {
    const total = sheet.getRow(9)
    expect(total.getCell(1).value).toBe('Total · 3 faturas')
    expect(total.getCell(6).value).toEqual({ formula: 'SUM(F6:F8)' })
    expect(total.getCell(7).value).toEqual({ formula: 'SUM(G6:G8)' })
    expect(total.getCell(6).numFmt).toBe('"R$" #,##0.00;[Red]-"R$" #,##0.00')
    expect(total.getCell(2).value).toBeNull()
  })

  it('largura pelo conteúdo: Cliente longo até 42, dinheiro 15, data 12', () => {
    expect(sheet.getColumn(2).width).toBe(42)
    expect(sheet.getColumn(6).width).toBe(15)
    expect(sheet.getColumn(4).width).toBe(12)
  })

  it('impressão em paisagem na largura da página, com o cabeçalho repetido e o rodapé do produto', () => {
    expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, printTitlesRow: '5:5' })
    expect(sheet.headerFooter.oddFooter).toBe('&LVela · Faturas · Taxas Locais&RPágina &P de &N')
  })

  it('o Portal usa o azul da FWLOG e o nome em branco', () => {
    const portal = buildWorkbook(ExcelJS, { ...faturas, product: 'portal' }).getWorksheet('Faturas')!
    expect(argb(portal.getCell('A1').fill)).toBe('FF0D2B5E')
    expect((portal.getCell('A1').value as ExcelJS.CellRichTextValue).richText[0]).toMatchObject({ text: 'Portal Fwlog  ', font: { color: { argb: 'FFFFFFFF' } } })
    expect(argb(portal.getRow(5).getCell(1).fill)).toBe('FF0D2B5E')
  })

  it('planilha-molde (plain): cabeçalho na primeira linha, sem faixa, grupos nem total; grade visível', () => {
    const plain = buildWorkbook(ExcelJS, {
      product: 'vela', title: 'Base de Clientes', fileName: 'base.xlsx', exportedAt,
      sheets: [{ name: 'BaseClientes', plain: true, rows: [{ CNPJ: '12345678000195', 'Razao Social': 'ACME', 'Valor (R$)': 10 }] }],
    }).getWorksheet('BaseClientes')!
    expect(plain.getRow(1).values).toEqual([undefined, 'CNPJ', 'Razao Social', 'Valor (R$)'])
    expect(argb(plain.getRow(1).getCell(1).fill)).toBe('FF152238')
    expect(plain.getRow(2).getCell(2).value).toBe('ACME')
    expect(plain.getRow(3).getCell(1).value).toBeNull()
    expect(plain.views[0]).toMatchObject({ ySplit: 1, showGridLines: true })
  })

  it('neutraliza fórmula no valor e no cabeçalho, e o código sai em letra monoespaçada', () => {
    const ws = buildWorkbook(ExcelJS, {
      product: 'vela', title: 'Containers', fileName: 'c.xlsx', exportedAt,
      sheets: [{ name: 'Containers', rows: [{ Container: 'MSCU1234567', '=Taxa': '=HYPERLINK("x")', Devolução: 'Fora' }] }],
    }).getWorksheet('Containers')!
    expect(ws.getRow(4).getCell(2).value).toBe("'=Taxa")
    expect(ws.getRow(5).getCell(2).value).toBe("'=HYPERLINK(\"x\")")
    expect(ws.getRow(5).getCell(2).type).toBe(ExcelJS.ValueType.String)
    expect(ws.getRow(5).getCell(1).font.name).toBe('Consolas')
    expect(ws.getRow(5).getCell(3).value).toBe('Fora')
    expect(ws.getRow(5).getCell(3).font.color?.argb).toBe('FFB0343A')
  })

  it('aba sem linha: cabeçalho e faixa com zero, sem linha de total', () => {
    const ws = buildWorkbook(ExcelJS, {
      product: 'vela', title: 'Containers', fileName: 'c.xlsx', exportedAt,
      sheets: [{ name: 'Vazia', unit: 'containers', rows: [], types: { Container: 'code', 'Total (R$)': 'brl' } }],
    }).getWorksheet('Vazia')!
    expect(ws.getCell('A2').value).toBe('Exportado em 03/11/2026 14:32 · 0 containers')
    expect(ws.getRow(4).values).toEqual([undefined, 'Container', 'Total (R$)'])
    expect(ws.getRow(5).getCell(1).value).toBeNull()
  })
})

describe('inferColumnType', () => {
  it('lê o rótulo e confere com os valores', () => {
    expect(inferColumnType('Total (R$)', [10, 20])).toBe('brl')
    expect(inferColumnType('US$ previsto', [1140, 'Tipo sem tarifa'])).toBe('usd')
    expect(inferColumnType('Peso (kg)', [1000, ''])).toBe('kg')
    expect(inferColumnType('CBM', [5.5])).toBe('cbm')
    expect(inferColumnType('Emissão', ['2026-05-02', ''])).toBe('date')
    expect(inferColumnType('Devolução', ['Fora', '2026-09-28'])).toBe('date')
    expect(inferColumnType('Taxas locais', ['Emitida', 'Paga'])).toBe('status')
    expect(inferColumnType('Situação', ['Paga'])).toBe('status')
    expect(inferColumnType('Container', ['MSCU1234567'])).toBe('code')
    expect(inferColumnType('B/L', ['HLCUSS2201877'])).toBe('code')
    expect(inferColumnType('B/Ls', [3, 1])).toBe('int')
    expect(inferColumnType('OOG', ['SIM', 'NAO'])).toBe('bool')
    expect(inferColumnType('Dias', [12, 40])).toBe('int')
    expect(inferColumnType('Cubagem', [67.2])).toBe('decimal')
    expect(inferColumnType('POD', ['SSZ'])).toBe('text')
    expect(inferColumnType('Cliente', ['Importadora Atlântico Ltda'])).toBe('long')
    // Rótulo de dinheiro com texto na coluna não vira número.
    expect(inferColumnType('Valor', ['a combinar'])).toBe('text')
  })
})

describe('toExcelDate', () => {
  it('guarda o dia como escrito e o instante na hora local', () => {
    expect(toExcelDate('2026-10-14')!.toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(toExcelDate('14/10/2026')!.toISOString()).toBe('2026-10-14T00:00:00.000Z')
    const local = new Date(2026, 9, 14, 9, 5)
    expect(toExcelDate(local)!.toISOString()).toBe('2026-10-14T09:05:00.000Z')
    expect(toExcelDate('2026-10-14T12:00:00Z')!.getUTCDate()).toBe(14)
    expect(toExcelDate('Fora')).toBeNull()
    expect(toExcelDate('')).toBeNull()
    expect(toExcelDate(42)).toBeNull()
  })
})
