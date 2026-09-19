import { describe, expect, it } from 'vitest'
import { breakbulkWeightTon } from '../breakbulkWeight'

// P1-8: um B/L de carga solta importado por B/L Avulso (PDF/DOCX) pode
// preencher só `total_weight_kg`, sem `bb_weight_ton`. Sem o fallback, o
// ADR e o card da Viagem imprimiam "0 ton" ao lado de um peso real conhecido.
describe('breakbulkWeightTon', () => {
  it('usa bb_weight_ton quando presente', () => {
    expect(breakbulkWeightTon({ bb_weight_ton: 3.5, total_weight_kg: 9999 })).toBe(3.5)
  })

  it('cai para total_weight_kg / 1000 quando bb_weight_ton e nulo', () => {
    expect(breakbulkWeightTon({ bb_weight_ton: null, total_weight_kg: 26800 })).toBe(26.8)
  })

  it('devolve 0 quando as duas colunas sao nulas (ausencia de dado, nao erro)', () => {
    expect(breakbulkWeightTon({ bb_weight_ton: null, total_weight_kg: null })).toBe(0)
  })

  it('bb_weight_ton = 0 e um valor explicito e prevalece sobre o fallback', () => {
    expect(breakbulkWeightTon({ bb_weight_ton: 0, total_weight_kg: 26800 })).toBe(0)
  })
})
