import { describe, expect, it } from 'vitest'

import {
  inferSeparatorFormat,
  isThousandsGroupShape,
  normalizeNumericText,
  parseImportNumber,
} from '../importNumber'
import { toNumber } from '../utils'

// S03 P0-1, tabela de vetores do plano: fronteira numérica explícita por
// formato; formato não declarado nunca adivinha.
describe('parseImportNumber', () => {
  it('reproduz o bug atual: toNumber("1e3") remove letras e vira 13', () => {
    expect(toNumber('1e3')).toBe(13)
  })

  it.each([
    // [entrada, formato, decimal canônico esperado]
    ['1.234', 'pt-BR', '1234'],
    ['1.234', 'en-US', '1.234'],
    ['1.234,56', 'pt-BR', '1234.56'],
    ['1,234.56', 'en-US', '1234.56'],
    ['1.234,56', 'unknown', '1234.56'],
    ['1,234.56', 'unknown', '1234.56'],
    ['1,5', 'unknown', '1.5'],
    ['1.5', 'unknown', '1.5'],
    ['1234', 'unknown', '1234'],
    ['0', 'unknown', '0'],
    ['1.234.567', 'pt-BR', '1234567'],
    ['1,234,567', 'en-US', '1234567'],
  ] as const)('parseia %p (%p) como %p', (input, format, decimal) => {
    expect(parseImportNumber(input, format)).toEqual({ kind: 'value', decimal })
  })

  it('recusa 1.234 com formato desconhecido como ambíguo', () => {
    expect(parseImportNumber('1.234')).toEqual({ kind: 'invalid', reason: 'ambiguous' })
    expect(parseImportNumber('1,234', 'unknown')).toEqual({ kind: 'invalid', reason: 'ambiguous' })
  })

  it.each(['1e3', '12abc', '10 KGS', 'R$ 1,00'])(
    'invalida %p sem substituir letras por número (syntax)',
    (input) => {
      expect(parseImportNumber(input, 'pt-BR')).toEqual({ kind: 'invalid', reason: 'syntax' })
    },
  )

  it.each(['NaN', 'Infinity', '-Infinity'])('marca %p como não-finito', (input) => {
    expect(parseImportNumber(input, 'pt-BR')).toEqual({ kind: 'invalid', reason: 'non_finite' })
  })

  it('recusa expoente por padrão e admite com resultado exato quando permitido', () => {
    expect(parseImportNumber('1e3', 'pt-BR')).toEqual({ kind: 'invalid', reason: 'syntax' })
    expect(parseImportNumber('1e3', { allowExponent: true })).toEqual({ kind: 'value', decimal: '1000' })
  })

  it.each([[''], ['   '], [null], [undefined]])('trata %p como vazio, distinto de zero', (input) => {
    expect(parseImportNumber(input, 'pt-BR')).toEqual({ kind: 'empty' })
  })

  it('trata 0 numérico e textual como valor', () => {
    expect(parseImportNumber(0, 'pt-BR')).toEqual({ kind: 'value', decimal: '0' })
    expect(parseImportNumber('0', 'pt-BR')).toEqual({ kind: 'value', decimal: '0' })
    expect(parseImportNumber('0,00', 'pt-BR')).toEqual({ kind: 'value', decimal: '0.00' })
  })

  it('expõe negativo para peso/tara rejeitar como erro de domínio', () => {
    // O parser não zera nem abs(): a guarda de domínio vive no caller de
    // import (fiação pendente — ver graniteImport/vaziosImportacaoImport).
    const parsed = parseImportNumber('-2.500,00', 'pt-BR')
    expect(parsed).toEqual({ kind: 'value', decimal: '-2500.00' })
    expect(parsed.kind === 'value' && Number(parsed.decimal) < 0).toBe(true)
  })

  it('rejeita agrupamento fora do padrão como sintaxe', () => {
    expect(parseImportNumber('12.34', 'pt-BR')).toEqual({ kind: 'invalid', reason: 'syntax' })
    expect(parseImportNumber('1,234.5.6', 'en-US')).toEqual({ kind: 'invalid', reason: 'syntax' })
  })
})

describe('inferSeparatorFormat', () => {
  it('usa uma casa decimal como prova de que o ponto é decimal', () => {
    expect(inferSeparatorFormat(['12.5', '259.312'])).toBe('en-US')
  })

  it('usa uma casa decimal como prova de que a vírgula é decimal', () => {
    expect(inferSeparatorFormat(['1217,10', '259,312'])).toBe('pt-BR')
  })

  it('decide pelo separador da direita quando os dois aparecem', () => {
    expect(inferSeparatorFormat(['1.234,56'])).toBe('pt-BR')
    expect(inferSeparatorFormat(['1,234.56'])).toBe('en-US')
  })

  it('não inventa formato quando toda célula é ambígua ou inteira', () => {
    // `259.312` sozinho tanto pode ser 259 mil quanto 259 e pouco: sem outra
    // célula que desempate, adivinhar é o que produziu o peso mil vezes maior.
    expect(inferSeparatorFormat(['259.312', '135.263', '8', '24'])).toBe('unknown')
    expect(inferSeparatorFormat([])).toBe('unknown')
  })

  it('devolve unknown quando a evidência se contradiz', () => {
    expect(inferSeparatorFormat(['12.5', '1217,10'])).toBe('unknown')
  })

  it('ignora células que não são texto numérico', () => {
    expect(inferSeparatorFormat([null, undefined, 42, 'N/A', 'R$ 1.234,56', '12,5'])).toBe('pt-BR')
  })

  it('não lê agrupamento repetido como prova de decimal', () => {
    expect(inferSeparatorFormat(['1.234.567'])).toBe('unknown')
  })
})

describe('normalizeNumericText e isThousandsGroupShape', () => {
  it('tira a unidade colada antes de qualquer julgamento sobre a celula', () => {
    // Era a fresta do P0: a forma ambigua era testada no valor cru (com a
    // unidade, nao casava) e o numero era parseado no valor sem ela.
    expect(normalizeNumericText('259.312 TON')).toBe('259.312')
    expect(normalizeNumericText('1.217,11 CBM')).toBe('1.217,11')
    expect(normalizeNumericText('  42  ')).toBe('42')
    expect(normalizeNumericText('')).toBeNull()
    expect(normalizeNumericText(null)).toBeNull()
    expect(normalizeNumericText(12.5)).toBe('12.5')
  })

  it('a celula com unidade colada continua entrando na evidencia do arquivo', () => {
    expect(inferSeparatorFormat(['259.312 TON', '12,5 TON'])).toBe('pt-BR')
    expect(inferSeparatorFormat(['259,312 TON', '12.5 TON'])).toBe('en-US')
  })

  it('reconhece a forma milhar mesmo com unidade colada', () => {
    expect(isThousandsGroupShape('259.312 TON', 'pt-BR')).toBe(true)
    expect(isThousandsGroupShape('259.312', 'en-US')).toBe(false)
    expect(isThousandsGroupShape('259,312', 'en-US')).toBe(true)
    expect(isThousandsGroupShape('259,312', 'pt-BR')).toBe(false)
    // Dois separadores ja se explicam; quatro casas tambem.
    expect(isThousandsGroupShape('1.234,56', 'pt-BR')).toBe(false)
    expect(isThousandsGroupShape('12.3456', 'pt-BR')).toBe(false)
  })
})
