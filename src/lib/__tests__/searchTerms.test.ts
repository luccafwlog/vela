import { describe, expect, it } from 'vitest'
import { matchesAnyToken, searchTokens, tokenIlikeClauses } from '../searchTerms'

// Ponto 9 de 2026-10-23: colar vários B/Ls ou contêineres na busca.
describe('searchTerms', () => {
  it('quebra em espaço, vírgula, ponto e vírgula e quebra de linha; um número só não vira lista', () => {
    expect(searchTokens('MEDU1234567, medu2345678;\nMEDU3456789  MEDU1234567')).toEqual(['medu1234567', 'medu2345678', 'medu3456789'])
    expect(searchTokens('MEDU1234567')).toEqual([])
    // Espaço não separável (colado de planilha ou e-mail) também separa.
    expect(searchTokens('MEDU1234567 MEDU2345678')).toEqual(['medu1234567', 'medu2345678'])
    expect(searchTokens('  ')).toEqual([])
    // Os demais espaços Unicode separam como no banco (migration 461), inclusive o não separável estreito.
    expect(searchTokens('MEDU1234567\u202fMEDU2345678\u2007MEDU3456789')).toEqual(['medu1234567', 'medu2345678', 'medu3456789'])
  })

  it('coluna colada com o mesmo número em toda linha continua sendo lista', () => {
    // A contagem é feita antes de tirar os repetidos (correção b3d6e64).
    expect(searchTokens('MEDU1234567\nMEDU1234567')).toEqual(['medu1234567'])
  })

  it('nome de várias palavras não vira lista', () => {
    // Antes, o termo "e" casava todo B/L com a letra E e o "2" todo B/L com o algarismo 2.
    expect(searchTokens('IMPORTACAO E EXPORTACAO')).toEqual([])
    expect(searchTokens('ACME 2')).toEqual([])
    expect(searchTokens('ACME IMPORTADORA LTDA')).toEqual([])
    expect(matchesAnyToken('IMPORTACAO E EXPORTACAO', ['MEDU1234567'])).toBe(false)
    expect(matchesAnyToken('ACME 2', ['MSCU2000001'])).toBe(false)
  })

  it('só conta como termo o que tem 4 ou mais caracteres e algum dígito', () => {
    // Palavras e números curtos no meio da lista ficam de fora; os números formam a lista.
    expect(searchTokens('MEDU1234567 e MSCU7654321')).toEqual(['medu1234567', 'mscu7654321'])
    expect(searchTokens('MEDU1234567 123')).toEqual([])
    expect(searchTokens('BL01 BL02')).toEqual(['bl01', 'bl02'])
    expect(searchTokens('ABCD EFGH')).toEqual([])
  })

  it('casa quando algum termo aparece em algum número', () => {
    expect(matchesAnyToken('medu1234 tcnu9000', ['MEDU1234567', null])).toBe(true)
    expect(matchesAnyToken('medu1234 tcnu9000', [undefined, 'TCNU9000123'])).toBe(true)
    expect(matchesAnyToken('medu1234 tcnu9000', ['MSCU5000000'])).toBe(false)
    expect(matchesAnyToken('medu1234', ['MEDU1234567'])).toBe(false)
  })

  it('monta as cláusulas do PostgREST só para lista, com cada termo escapado', () => {
    expect(tokenIlikeClauses('MEDU1234, MEDU(2345)', ['bl_id'])).toEqual(['bl_id.ilike.%medu1234%', 'bl_id.ilike.%medu 2345%'])
    expect(tokenIlikeClauses('MEDU1234', ['bl_id'])).toEqual([])
    expect(tokenIlikeClauses('ACME 2', ['bl_id'])).toEqual([])
  })
})
