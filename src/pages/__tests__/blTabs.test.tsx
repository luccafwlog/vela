import { describe, expect, it } from 'vitest'
import { BL_TABS, isBlTab } from '../BlDetalhe'

describe('BL tabs', () => {
  it('exposes the cockpit and the three supporting tabs', () => {
    expect(BL_TABS.map((t) => t.key)).toEqual(['visao-geral', 'carga', 'detalhes', 'faturamento', 'historico'])
  })
  it('guards tab keys', () => {
    expect(isBlTab('detalhes')).toBe(true)
    expect(isBlTab('visao-geral')).toBe(true)
    expect(isBlTab('operacional')).toBe(false)
  })
})
