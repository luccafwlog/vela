import { describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

function isValidCnpj(value: string): boolean {
  const digits = [...value].map(Number)
  const first = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const second = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const digit = (weights: readonly number[]) => {
    const remainder = weights.reduce((sum, weight, index) => sum + digits[index] * weight, 0) % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  return digits.length === 14 && digit(first) === digits[12] && digit(second) === digits[13]
}

describe('syntheticCnpj', () => {
  it('produces deterministic, valid, distinct synthetic CNPJs', () => {
    const values = [syntheticCnpj(40401), syntheticCnpj(52001), syntheticCnpj(52002)]
    expect(values).toEqual([syntheticCnpj(40401), syntheticCnpj(52001), syntheticCnpj(52002)])
    expect(new Set(values).size).toBe(values.length)
    expect(values.every((value) => /^99\d{12}$/.test(value) && isValidCnpj(value))).toBe(true)
  })
})
