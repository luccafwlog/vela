import { describe, expect, it } from 'vitest'
import {
  blTotalCbm,
  cargoModeLabel,
  isBreakbulkCargoMode,
  isContainerCargoMode,
  matchesBlCargoModeFilter,
} from '../cargoMode'

describe('cargo_mode de B/L', () => {
  it('trata misto como participante das duas lentes operacionais', () => {
    expect(isContainerCargoMode('misto')).toBe(true)
    expect(isBreakbulkCargoMode('misto')).toBe(true)
    expect(matchesBlCargoModeFilter('misto', 'container')).toBe(true)
    expect(matchesBlCargoModeFilter('misto', 'carga_solta')).toBe(true)
    expect(matchesBlCargoModeFilter('container', 'carga_solta')).toBe(false)
    expect(matchesBlCargoModeFilter('carga_solta', 'container')).toBe(false)
  })

  it('mantém a seleção exata para a lente de misto e rótulo próprio', () => {
    expect(matchesBlCargoModeFilter('misto', 'misto')).toBe(true)
    expect(matchesBlCargoModeFilter('container', 'misto')).toBe(false)
    expect(cargoModeLabel('misto')).toBe('Misto')
  })
})

describe('cubagem total do B/L', () => {
  it('soma os dois componentes disjuntos', () => {
    // Desde a 064: total_cbm é só contêiner, bb_cbm é só carga solta.
    expect(blTotalCbm({ total_cbm: 67, bb_cbm: 45 })).toBe(112)
  })

  it('trata carga solta pura e contêiner puro sem inventar cubagem', () => {
    expect(blTotalCbm({ total_cbm: null, bb_cbm: 45 })).toBe(45)
    expect(blTotalCbm({ total_cbm: 67, bb_cbm: null })).toBe(67)
    expect(blTotalCbm({})).toBe(0)
  })
})
