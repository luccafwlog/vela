import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parseCeUnlockZptFile, parseZptDateTime } from '../ceUnlockZptReconcile'

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
  it('recusa arquivo que não é da ZPT e aponta linha sem CE', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Nome', 'Valor'], ['x', 1]]), 'Plan1')
    await expect(parseCeUnlockZptFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)).rejects.toThrow(/exportação da ZPT/)
    const parsed = await parseCeUnlockZptFile(xls([[1, 'BL1', '', 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não'], [2, 'BL2', 123456789012345, 'X', 'Bloqueado', '', OPERATOR, '', '', 'Não', 'Não', 'Não', 'Não']]))
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rowErrors).toHaveLength(1)
  })
  it('interpreta data e hora de Brasília e rejeita formato desconhecido', () => {
    expect(parseZptDateTime('06/10/2026 16:29:08')).toBe('2026-10-06T16:29:08-03:00')
    expect(parseZptDateTime('06/10/2026')).toBe('2026-10-06T00:00:00-03:00')
    // Célula de data/hora do Excel, como o leitor comum entrega (ADR 0078, item 22).
    expect(parseZptDateTime('2026-10-06 16:29')).toBe('2026-10-06T16:29:00-03:00')
    expect(parseZptDateTime('06-10-2026')).toBeNull()
  })
})
