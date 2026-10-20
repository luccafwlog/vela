import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parseCeUnlockZptFile, parseZptDateTime, ZPT_MAX_ROWS } from '../ceUnlockZptReconcile'

// Layout do "Exportar Tela" da ZPT (conferido em 2026-10-07 contra dois arquivos reais, .xls BIFF8).
// Linhas abaixo são fictícias; o CPF abaixo é de teste e nunca pode aparecer no resultado.
const HEADER = ['Manifesto','BL','CE','Consignatário','Status','Descrição','Nome Usuario','Data da Ação','Data Atualização','Financeiro','Term. Devolucao','Procuracao','BL Entrega']
const OPERATOR = '000.000.000-00  -   OPERADOR DE TESTE'
const xls = (rows: unknown[][]) => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), 'Worksheet')
  return XLSX.write(book, { type: 'array', bookType: 'biff8' }) as ArrayBuffer
}

describe('arquivo "Exportar Tela" da ZPT', () => {
  it('lê CE de 15 dígitos exato, status, descrição, data e só as colunas em "Não"', async () => {
    const parsed = await parseCeUnlockZptFile(xls([
      [1226501816960, 'CSS4563040220', 122605325622422, 'CLIENTE A', 'Desbloqueado', 'Cancelamento de Pendência', OPERATOR, '06/10/2026', '06/10/2026 16:29:08', '06/10/2026 16:29:08', '02/10/2026 11:37:25', '02/10/2026 11:37:25', '02/10/2026 10:42:37'],
      [1226501848799, 'CSC45320B04500', 122605331512625, 'CLIENTE B', 'Bloqueado', 'Registro de Pendência', OPERATOR, '07/10/2026', '07/10/2026', 'Não', 'Sim - S/Log de Horario', 'Sim - S/Log de Horario', 'Não'],
      [null, null, null, null, null, null, null, null, null, null, null, null, null],
    ]))
    expect(parsed.rows).toEqual([
      { ce: '122605325622422', status: 'Desbloqueado', description: 'Cancelamento de Pendência', updated_at: '2026-10-06T16:29:08-03:00', pending: [] },
      { ce: '122605331512625', status: 'Bloqueado', description: 'Registro de Pendência', updated_at: '2026-10-07T00:00:00-03:00', pending: ['Financeiro', 'BL Entrega'] },
    ])
    expect(JSON.stringify(parsed)).not.toContain('000.000.000-00')
    expect(JSON.stringify(parsed)).not.toContain('OPERADOR')
  })
  it('recusa arquivo que não é da ZPT e conta a linha sem CE como ignorada (D3)', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Nome', 'Valor'], ['x', 1]]), 'Plan1')
    await expect(parseCeUnlockZptFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)).rejects.toThrow(/exportação da ZPT/)
    const parsed = await parseCeUnlockZptFile(xls([[1, 'BL1', '', 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não'], [2, 'BL2', 123456789012345, 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não']]))
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.skippedRows).toEqual([2])
  })
  it('linha sem situação é ignorada; CE ilegível é erro que recusa o arquivo', async () => {
    const parsed = await parseCeUnlockZptFile(xls([
      [1, 'BL1', 122605325622422, 'X', '', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não'],
      [2, 'BL2', 'ABC123', 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não'],
      [3, 'BL3', 122605331512625, 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não'],
    ]))
    expect(parsed.skippedRows).toEqual([2])
    expect(parsed.rowErrors).toEqual([{ row: 3, field: 'CE', message: 'CE "ABC123" ilegível: o CE Mercante tem 15 dígitos.' }])
    expect(parsed.fileError).toBeNull()
    expect(parsed.rows.map((row) => row.ce)).toEqual(['122605331512625'])
  })
  it('o arquivo de exemplo de public/templates é lido sem erro', async () => {
    const raw = readFileSync('public/templates/zpt-exportar-tela-exemplo.xlsx')
    const parsed = await parseCeUnlockZptFile(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.skippedRows).toEqual([])
    expect(parsed.rows).toEqual([
      { ce: '122605051526081', status: 'Desbloqueado', description: 'Carga liberada', updated_at: '2026-10-06T16:29:08-03:00', pending: [] },
      { ce: '122605051526082', status: 'Bloqueado', description: 'Aguardando documentos', updated_at: '2026-10-06T16:30:00-03:00', pending: ['Financeiro', 'Term. Devolução', 'BL Entrega'] },
    ])
  })
  // Revisão da PR 929 (E3-08): o "Exportar Tela" filtrado na planilha perdia
  // as linhas ocultas sem aviso; o resultado da leitura devolve o aviso.
  it('devolve o aviso das linhas ocultas ignoradas', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      HEADER,
      [1, 'BL1', 122605325622422, 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não'],
      [2, 'BL2', 122605331512625, 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não'],
    ])
    sheet['!rows'] = [{}, {}, { hidden: true }]
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Worksheet')
    const parsed = await parseCeUnlockZptFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(parsed.rows.map((row) => row.ce)).toEqual(['122605325622422'])
    expect(parsed.warnings).toEqual(['1 linha oculta ignorada: o filtro da planilha indica importar só o visível.'])
  })
  it('Data Atualização preenchida e ilegível é erro; vazia continua vazia (ADR 0092)', async () => {
    const parsed = await parseCeUnlockZptFile(xls([
      [1, 'BL1', 122605325622422, 'X', 'Bloqueado', '', OPERATOR, '', 'ontem', 'Não', 'Não', 'Não', 'Não'],
      [2, 'BL2', 122605331512625, 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não'],
    ]))
    expect(parsed.rowErrors).toEqual([{ row: 2, field: 'Data Atualização', message: 'Data Atualização "ontem" ilegível: use DD/MM/AAAA HH:MM:SS.' }])
    expect(parsed.rows).toEqual([{ ce: '122605331512625', status: 'Bloqueado', description: null, updated_at: null, pending: ['Financeiro', 'Term. Devolução', 'Procuração', 'BL Entrega'] }])
  })
  it('mais CEs que o limite é erro do arquivo, não de uma linha', async () => {
    const lines = ['CE;Status']
    for (let i = 0; i <= ZPT_MAX_ROWS; i += 1) lines.push(`${122605300000000 + i};Bloqueado`)
    const parsed = await parseCeUnlockZptFile(new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer)
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.fileError).toMatch(/20\.001 CEs; o limite é 20\.000 por conciliação/)
  })
  it('interpreta data e hora de Brasília e rejeita formato desconhecido', () => {
    expect(parseZptDateTime('06/10/2026 16:29:08')).toBe('2026-10-06T16:29:08-03:00')
    expect(parseZptDateTime('06/10/2026')).toBe('2026-10-06T00:00:00-03:00')
    // Célula de data/hora do Excel, como o leitor comum entrega (ADR 0078, item 22).
    expect(parseZptDateTime('2026-10-06 16:29')).toBe('2026-10-06T16:29:00-03:00')
    expect(parseZptDateTime('06-10-2026')).toBeNull()
  })
})
