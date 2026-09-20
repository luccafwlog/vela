import { describe, expect, it } from 'vitest'
import { calculateTeu, teuForContainerType } from '../containerTeu'

describe('containerTeu', () => {
  it('calcula 20, 40 e 45 pés sem transformar tipo desconhecido em TEU', () => {
    expect(teuForContainerType('20GP')).toBe(1)
    expect(teuForContainerType('22G1')).toBe(1)
    expect(teuForContainerType('40 HC')).toBe(2)
    expect(teuForContainerType('42G1')).toBe(2)
    expect(teuForContainerType('45G1')).toBe(2.25)
    expect(teuForContainerType('L5G1')).toBeNull()
  })

  it('separa a divergência de tipo do total TEU', () => {
    expect(calculateTeu(['20GP', '40HC', 'L5G1', null])).toEqual({ teu: 3, unknownTypeCount: 2 })
  })
})
