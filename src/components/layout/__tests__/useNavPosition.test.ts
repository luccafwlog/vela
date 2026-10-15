import { describe, expect, it } from 'vitest'
import { NAV_POSITION_OPTIONS, parseNavPosition } from '../useNavPosition'

describe('parseNavPosition', () => {
  it('aceita as quatro posições do menu da conta', () => {
    for (const option of NAV_POSITION_OPTIONS) expect(parseNavPosition(option.value)).toBe(option.value)
    expect(NAV_POSITION_OPTIONS.map((option) => option.value)).toEqual(['top', 'fixed', 'collapsed', 'expandable'])
  })

  it('volta ao topo sem escolha salva ou com valor desconhecido', () => {
    expect(parseNavPosition(null)).toBe('top')
    expect(parseNavPosition('side')).toBe('top')
  })
})
