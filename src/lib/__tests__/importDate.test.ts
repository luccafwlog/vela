import { describe, expect, it } from 'vitest'
import { excelSerialToCivil, parseImportDate } from '../importDate'

/** Serial do Excel (sistema 1900) para a data/hora civil informada, em segundos exatos. */
function serial1900(iso: string, hours = 0, minutes = 0, seconds = 0) {
  const [year, month, day] = iso.split('-').map(Number)
  return (Date.UTC(year, month - 1, day, hours, minutes, seconds) - Date.UTC(1899, 11, 30)) / 86_400_000
}

describe('excelSerialToCivil — sistema 1900', () => {
  it('converte o serial em data civil, sem fuso', () => {
    expect(excelSerialToCivil(46235)).toEqual({ date: '2026-08-01', time: null })
    expect(excelSerialToCivil(1)).toEqual({ date: '1900-01-01', time: null })
  })

  it('o serial 60 é o inexistente 29/02/1900 do Excel: 59 é 28/02 e 61 é 01/03', () => {
    expect(excelSerialToCivil(59)?.date).toBe('1900-02-28')
    expect(excelSerialToCivil(60)?.date).toBe('1900-03-01')
    expect(excelSerialToCivil(61)?.date).toBe('1900-03-01')
    expect(excelSerialToCivil(0)).toBeNull()
  })

  it('serial um pouco abaixo da meia-noite é a meia-noite do dia, não 23:59 do anterior', () => {
    expect(excelSerialToCivil(46236 - 1e-9)).toEqual({ date: '2026-08-02', time: null })
  })

  it('a hora sai truncada no minuto, como o Excel mostra em hh:mm (16:29:40 é 16:29)', () => {
    expect(excelSerialToCivil(serial1900('2026-10-06', 16, 29, 40))).toEqual({ date: '2026-10-06', time: '16:29' })
    expect(excelSerialToCivil(serial1900('2026-03-05', 22, 48))).toEqual({ date: '2026-03-05', time: '22:48' })
    expect(excelSerialToCivil(serial1900('2026-03-05', 23, 59, 59))).toEqual({ date: '2026-03-05', time: '23:59' })
  })
})

describe('excelSerialToCivil — sistema 1904 (Excel antigo de Mac)', () => {
  it('o mesmo dia tem serial 1462 menor; com a flag a data não volta 4 anos e 1 dia', () => {
    expect(excelSerialToCivil(46235 - 1462, { date1904: true })).toEqual({ date: '2026-08-01', time: null })
    // Sem a flag, o serial 1904 seria lido como 2022-07-31.
    expect(excelSerialToCivil(46235 - 1462)?.date).toBe('2022-07-31')
  })

  it('o serial 0 do sistema 1904 é 01/01/1904', () => {
    expect(excelSerialToCivil(0, { date1904: true })).toEqual({ date: '1904-01-01', time: null })
  })
})

describe('parseImportDate', () => {
  it('lê a célula de data do leitor comum e o texto DD/MM/AAAA, com ou sem hora', () => {
    expect(parseImportDate('2026-07-01 08:30')).toEqual({ kind: 'value', date: '2026-07-01', time: '08:30' })
    expect(parseImportDate('05/03/2026')).toEqual({ kind: 'value', date: '2026-03-05', time: null })
  })

  it('não troca dia e mês: 03/15/2026 é recusado', () => {
    expect(parseImportDate('03/15/2026').kind).toBe('invalid')
  })
})
