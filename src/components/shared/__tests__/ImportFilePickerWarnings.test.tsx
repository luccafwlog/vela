// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ImportFilePicker } from '../ImportParts'

// ADR 0078, item 22: linhas ocultas são ignoradas com aviso na prévia, no
// seletor comum a todos os modais de planilha.
afterEach(cleanup)

describe('ImportFilePicker — avisos de leitura', () => {
  it('avisa as linhas ocultas ignoradas da planilha escolhida', async () => {
    const XLSX = await import('@e965/xlsx')
    const sheet = XLSX.utils.aoa_to_sheet([['Container'], ['VISI1234567'], ['OCUL1234567']])
    sheet['!rows'] = [{}, {}, { hidden: true }]
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Plan1')
    const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const file = new File([bytes], 'ocultas.xlsx')

    render(<ImportFilePicker accept=".xlsx,.csv" files={[file]} onFiles={() => undefined} />)

    expect(await screen.findByText('1 linha oculta ignorada: o filtro da planilha indica importar só o visível.')).toBeTruthy()
  })

  // Revisão da PR 929 (E3-08): o aviso valia só para a primeira aba visível
  // e sumia quando a leitura falhava (dado só em linhas ocultas).
  it('avisa as linhas ocultas de outra aba visível, com o nome da aba', async () => {
    const XLSX = await import('@e965/xlsx')
    const veiculos = XLSX.utils.aoa_to_sheet([['Chassi'], ['VISI'], ['OCUL']])
    veiculos['!rows'] = [{}, {}, { hidden: true }]
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Modelo do armador']]), 'Capa')
    XLSX.utils.book_append_sheet(book, veiculos, 'Veiculos')
    const file = new File([XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer], 'veiculos.xlsx')

    render(<ImportFilePicker accept=".xlsx,.csv" files={[file]} onFiles={() => undefined} />)

    expect(await screen.findByText('1 linha oculta ignorada na aba "Veiculos": o filtro da planilha indica importar só o visível.')).toBeTruthy()
  })

  it('avisa mesmo quando todo o dado está em linhas ocultas', async () => {
    const XLSX = await import('@e965/xlsx')
    const sheet = XLSX.utils.aoa_to_sheet([['Container'], ['OCUL1234567']])
    sheet['!rows'] = [{}, { hidden: true }]
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Plan1')
    const file = new File([XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer], 'filtrada.xlsx')

    render(<ImportFilePicker accept=".xlsx,.csv" files={[file]} onFiles={() => undefined} />)

    expect(await screen.findByText('1 linha oculta ignorada: o filtro da planilha indica importar só o visível.')).toBeTruthy()
  })

  // Revisão da PR 929 (achado da revisão automática): o B/L COSCO é lido pela
  // posição das células, inclusive linhas e abas ocultas; o aviso não pode
  // dizer que elas foram ignoradas.
  it('arquivo posicional (B/L): avisa que as linhas e abas ocultas são lidas', async () => {
    const XLSX = await import('@e965/xlsx')
    const page = XLSX.utils.aoa_to_sheet([['B/L'], ['VISI1234567'], ['OCUL1234567']])
    page['!rows'] = [{}, {}, { hidden: true }]
    const vin = XLSX.utils.aoa_to_sheet([['VIN'], ['LGXC74C44V0000001']])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, page, 'Page 1')
    XLSX.utils.book_append_sheet(book, vin, 'VIN')
    book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }
    const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const file = new File([bytes], 'bl.xlsx')

    render(<ImportFilePicker accept=".xlsx,.xls" positional files={[file]} onFiles={() => undefined} />)

    expect(await screen.findByText('1 linha oculta na aba "Page 1": este arquivo é lido inteiro, inclusive as linhas ocultas; apague as que não devem entrar.')).toBeTruthy()
    expect(screen.getByText('Aba oculta "VIN": este arquivo é lido mesmo com abas ocultas; confira se ela não deve entrar.')).toBeTruthy()
    expect(screen.queryByText(/ignorad/)).toBeNull()
  })

  it('sem nada oculto, não mostra aviso', async () => {
    const file = new File([new TextEncoder().encode('Container\nVISI1234567\n')], 'limpo.csv')
    render(<ImportFilePicker accept=".xlsx,.csv" files={[file]} onFiles={() => undefined} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('Avisos de leitura do arquivo')).toBeNull()
  })
})
