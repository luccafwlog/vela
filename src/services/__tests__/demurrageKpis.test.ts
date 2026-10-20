import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { normalizePixAmountText, readPixExtract } from '../demurrage/demurrageKpis'

function pixWorkbook(rows: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'PIX')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

/** Transações de um extrato sem erro (o teste falha se houver erro). */
async function parsePixExtract(buffer: ArrayBuffer) {
  const read = await readPixExtract(buffer)
  expect(read.errors).toEqual([])
  return read.transactions
}

describe('readPixExtract', () => {
  it('normaliza data PIX valida no formato dd/mm/aaaa', async () => {
    const rows = [
      ['Relatorio'],
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-001', '12.345.678/0001-95', '05/06/2026', '1.234,56'],
    ]

    await expect(parsePixExtract(pixWorkbook(rows))).resolves.toEqual([
      {
        txid: 'INV-001',
        cnpj: '12.345.678/0001-95',
        date: '2026-06-05',
        amount: 1234.56,
        lineNumber: 3,
      },
    ])
  })

  it('recusa extrato com a mesma coluna duas vezes (ADR 0078, item 22)', async () => {
    const rows = [
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago', 'valor pago'],
      ['INV-003', '12.345.678/0001-95', '05/06/2026', '100,00', '1.000,00'],
    ]

    await expect(readPixExtract(pixWorkbook(rows))).rejects.toThrow(/"valor pago" aparece mais de uma vez/)
  })

  // ADR 0092: data preenchida e ilegível é erro que recusa o extrato; vazia fica vazia.
  it('data impossível ou ilegível em "pago em" é erro; data vazia fica vazia', async () => {
    const read = await readPixExtract(pixWorkbook([
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-002', '12.345.678/0001-95', '31/02/2026', '100,00'],
      ['INV-003', '12.345.678/0001-95', 'ontem', '100,00'],
      ['INV-004', '12.345.678/0001-95', '', '100,00'],
    ]))
    expect(read.errors).toEqual([
      { row: 2, field: 'date', message: 'Pago em "31/02/2026" ilegível (identificador INV-002): use DD/MM/AAAA.' },
      { row: 3, field: 'date', message: 'Pago em "ontem" ilegível (identificador INV-003): use DD/MM/AAAA.' },
    ])
    expect(read.transactions).toEqual([
      { txid: 'INV-004', cnpj: '12.345.678/0001-95', date: '', amount: 100, lineNumber: 4 },
    ])
  })

  it('normaliza data PIX com componente de horario', async () => {
    const rows = [
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-003', '12.345.678/0001-95', '05/06/2026 15:30:45', '100,00'],
    ]

    const parsed = await parsePixExtract(pixWorkbook(rows))

    expect(parsed).toEqual([
      {
        txid: 'INV-003',
        cnpj: '12.345.678/0001-95',
        date: '2026-06-05',
        amount: 100,
        lineNumber: 2,
      },
    ])
  })

  it('preserva linha paga sem TXID para persistencia da pendencia', async () => {
    const rows = [
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['', '12.345.678/0001-95', '05/06/2026', '100,00'],
    ]

    await expect(parsePixExtract(pixWorkbook(rows))).resolves.toEqual([
      {
        txid: '',
        cnpj: '12.345.678/0001-95',
        date: '2026-06-05',
        amount: 100,
        lineNumber: 2,
      },
    ])
  })

  // Revisão da PR 929 (E3-11): com linhas ocultas fora da matriz, o índice
  // da matriz não é a linha da planilha que a Reconciliação mostra.
  it('numera a transação pela linha física da planilha, mesmo com linha oculta antes', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-OCULTA', '12.345.678/0001-95', '05/06/2026', '10,00'],
      ['INV-002', '12.345.678/0001-95', '05/06/2026', '20,00'],
    ])
    sheet['!rows'] = [{}, { hidden: true }, {}]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'PIX')
    const parsed = await parsePixExtract(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer)
    expect(parsed.map((transaction) => [transaction.txid, transaction.lineNumber])).toEqual([['INV-002', 3]])
  })

  // Regra de 2026-10-19 (D3): zerado/negativo é ignorado com contagem; valor
  // ilegível é erro que recusa o extrato inteiro.
  it('ignora lançamento zerado ou negativo com contagem e aceita o símbolo da moeda', async () => {
    const read = await readPixExtract(pixWorkbook([
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-001', '', '05/06/2026', 'R$ 1.500,50'],
      ['TARIFA', '', '05/06/2026', '-2,50'],
      ['INV-ZERO', '', '05/06/2026', '0,00'],
      ['', '', '', ''],
    ]))
    expect(read.errors).toEqual([])
    expect(read.ignored).toBe(2)
    expect(read.transactions.map((transaction) => [transaction.txid, transaction.amount])).toEqual([['INV-001', 1500.5]])
  })

  it('valor ilegível vira erro que recusa o extrato', async () => {
    const read = await readPixExtract(pixWorkbook([
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-001', '', '05/06/2026', '100,00'],
      ['INV-002', '', '05/06/2026', 'cem reais'],
    ]))
    expect(read.errors).toEqual([{ row: 3, field: 'value', message: 'Valor pago "cem reais" ilegível (identificador INV-002).' }])
  })

  it('lê as formas contábeis de débito como negativas: ignoradas e contadas, não ilegíveis', async () => {
    const read = await readPixExtract(pixWorkbook([
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['T1', '', '05/06/2026', '(10,00)'],
      ['T2', '', '05/06/2026', 'R$ (10,00)'],
      ['T3', '', '05/06/2026', '10,00-'],
      ['T4', '', '05/06/2026', 'R$ 10,00-'],
      ['T5', '', '05/06/2026', '10,00 D'],
      ['INV-C', '', '05/06/2026', '10,00 C'],
    ]))
    expect(read.errors).toEqual([])
    expect(read.ignored).toBe(5)
    expect(read.transactions.map((transaction) => [transaction.txid, transaction.amount])).toEqual([['INV-C', 10]])
  })

  it('linha sem valor (rodapé "Total", "R$" sozinho) fica de fora sem entrar na contagem de ignorados', async () => {
    const read = await readPixExtract(pixWorkbook([
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-001', '', '05/06/2026', '100,00'],
      ['TARIFA', '', '05/06/2026', '-1,99'],
      ['Total', '', '', ''],
      ['', '', '', 'R$'],
    ]))
    expect(read.errors).toEqual([])
    expect(read.ignored).toBe(1)
    expect(read.transactions).toHaveLength(1)
  })

  it('identificador com o valor vazio é erro, não lançamento ignorado', async () => {
    const read = await readPixExtract(pixWorkbook([
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-001', '', '05/06/2026', '100,00'],
      ['INV-002', '', '05/06/2026', ''],
    ]))
    expect(read.errors).toEqual([expect.objectContaining({ field: 'value', message: 'Valor pago vazio (identificador INV-002).' })])
    expect(read.ignored).toBe(0)
  })

  it('normaliza o texto do valor', () => {
    expect(normalizePixAmountText(' R$ 1.500,50 ')).toBe('1.500,50')
    expect(normalizePixAmountText('-R$ 2,50')).toBe('-2,50')
    expect(normalizePixAmountText('R$ (10,00)')).toBe('-10,00')
    expect(normalizePixAmountText('10,00 d')).toBe('-10,00')
    expect(normalizePixAmountText('10,00 C')).toBe('10,00')
    expect(normalizePixAmountText('R$')).toBe('')
    expect(normalizePixAmountText('cem reais')).toBe('cem reais')
  })

  it('o arquivo de exemplo de public/templates é lido sem erro, com a tarifa ignorada', async () => {
    const raw = readFileSync('public/templates/extrato-pix-exemplo.xlsx')
    const read = await readPixExtract(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
    expect(read.errors).toEqual([])
    expect(read.ignored).toBe(1)
    expect(read.transactions).toEqual([
      { txid: 'FWLOGTXIDEXEMPLO0001', cnpj: '11.222.333/0001-81', date: '2026-10-06', amount: 1500.5, lineNumber: 4 },
      { txid: 'FWLOGTXIDEXEMPLO0002', cnpj: '11.222.333/0001-81', date: '2026-10-06', amount: 320, lineNumber: 5 },
      { txid: 'FWLOGTXIDEXEMPLO0003', cnpj: '44.555.666/0001-99', date: '2026-10-07', amount: 2875.9, lineNumber: 6 },
    ])
  })
})
