import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parsePixExtract, readPixExtract } from '../demurrage/demurrageKpis'

function pixWorkbook(rows: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'PIX')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

describe('parsePixExtract', () => {
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

    await expect(parsePixExtract(pixWorkbook(rows))).rejects.toThrow(/"valor pago" aparece mais de uma vez/)
  })

  it('mantem data vazia quando a planilha traz uma data impossivel', async () => {
    const rows = [
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-002', '12.345.678/0001-95', '31/02/2026', '100,00'],
    ]

    const parsed = await parsePixExtract(pixWorkbook(rows))

    expect(parsed).toEqual([
      {
        txid: 'INV-002',
        cnpj: '12.345.678/0001-95',
        date: '',
        amount: 100,
        lineNumber: 2,
        },
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

  it('valor ilegível vira erro e parsePixExtract recusa o extrato', async () => {
    const buffer = pixWorkbook([
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-001', '', '05/06/2026', '100,00'],
      ['INV-002', '', '05/06/2026', 'cem reais'],
    ])
    const read = await readPixExtract(buffer)
    expect(read.errors).toEqual([{ row: 3, message: 'Valor pago "cem reais" ilegível (identificador INV-002).' }])
    expect(read.transactions).toHaveLength(1)
    await expect(parsePixExtract(buffer)).rejects.toThrow(/Linha 3: Valor pago "cem reais" ilegível/)
  })
})
