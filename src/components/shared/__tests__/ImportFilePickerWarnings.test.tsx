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

  it('sem nada oculto, não mostra aviso', async () => {
    const file = new File([new TextEncoder().encode('Container\nVISI1234567\n')], 'limpo.csv')
    render(<ImportFilePicker accept=".xlsx,.csv" files={[file]} onFiles={() => undefined} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('Avisos de leitura do arquivo')).toBeNull()
  })
})
