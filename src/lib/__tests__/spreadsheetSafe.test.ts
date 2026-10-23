import { describe, expect, it } from 'vitest'
import { sanitizeCellValue, sanitizeSheetRows } from '../spreadsheetSafe'

describe('sanitizeCellValue', () => {
  it('prefixa aspa simples em valores que começam com metacaractere de fórmula', () => {
    expect(sanitizeCellValue('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(sanitizeCellValue('+1')).toBe("'+1")
    expect(sanitizeCellValue('-1')).toBe("'-1")
    expect(sanitizeCellValue('@x')).toBe("'@x")
  })
  it('preserva strings normais e não-strings', () => {
    expect(sanitizeCellValue('NAVIO A')).toBe('NAVIO A')
    expect(sanitizeCellValue(42)).toBe(42)
    expect(sanitizeCellValue(null)).toBe(null)
  })
})

describe('sanitizeSheetRows', () => {
  it('sanitiza cada célula de string de cada linha', () => {
    expect(sanitizeSheetRows([{ a: '=1+1', b: 2, c: 'ok' }])).toEqual([{ a: "'=1+1", b: 2, c: 'ok' }])
  })

  it('sanitiza também a chave, que vira o cabeçalho da coluna', () => {
    const [row] = sanitizeSheetRows([{ '=HYPERLINK("http://x") (US$)': 10, '+taxa': 'ok', 'B/L': 'BL1' }])
    expect(Object.keys(row)).toEqual([`'=HYPERLINK("http://x") (US$)`, "'+taxa", 'B/L'])
    expect(row).toEqual({ [`'=HYPERLINK("http://x") (US$)`]: 10, "'+taxa": 'ok', 'B/L': 'BL1' })
  })

  it('chaves que viram o mesmo cabeçalho não se sobrescrevem', () => {
    const rows = sanitizeSheetRows([{ '+THC': 10, "'+THC": 20 }, { '+THC': 30, "'+THC": 40 }])
    expect(rows).toEqual([{ "'+THC": 10, "'+THC (2)": 20 }, { "'+THC": 30, "'+THC (2)": 40 }])
  })
})
