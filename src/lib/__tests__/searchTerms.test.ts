import { describe, expect, it } from 'vitest'
import { matchesAnyToken, searchTokens } from '../searchTerms'

// Ponto 9 de 2026-10-23: colar vários B/Ls ou contêineres na busca.
describe('searchTerms', () => {
  it('quebra em espaço, vírgula, ponto e vírgula e quebra de linha; um termo só não vira lista', () => {
    expect(searchTokens('MEDU1, medu2;\nMEDU3  MEDU1')).toEqual(['medu1', 'medu2', 'medu3'])
    expect(searchTokens('MEDU1')).toEqual([])
    // Coluna colada com o mesmo número em toda linha continua sendo lista.
    expect(searchTokens('MEDU1\nMEDU1')).toEqual(['medu1'])
    expect(searchTokens('  ')).toEqual([])
  })

  it('casa quando algum termo aparece em algum número', () => {
    expect(matchesAnyToken('medu1 tcnu9', ['MEDU1234', null])).toBe(true)
    expect(matchesAnyToken('medu1 tcnu9', [undefined, 'TCNU9000'])).toBe(true)
    expect(matchesAnyToken('medu1 tcnu9', ['MSCU5'])).toBe(false)
    expect(matchesAnyToken('medu1', ['MEDU1'])).toBe(false)
  })
})
