import { describe, expect, it } from 'vitest'
import {
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
