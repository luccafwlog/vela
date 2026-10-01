import { describe, expect, it } from 'vitest'
import { normalizeContainerOwnership, ownershipFromEquipmentSupplier } from '../containerOwnership'

describe('containerOwnership', () => {
  it('lê SOC/COC do texto do B/L em variações comuns', () => {
    expect(normalizeContainerOwnership('SOC')).toBe('SOC')
    expect(normalizeContainerOwnership(' s.o.c. ')).toBe('SOC')
    expect(normalizeContainerOwnership('SHIPPER OWNED')).toBe('SOC')
    expect(normalizeContainerOwnership('COC')).toBe('COC')
    expect(normalizeContainerOwnership('Carrier owned container')).toBe('COC')
  })

  it('não inventa propriedade para texto vazio ou desconhecido', () => {
    expect(normalizeContainerOwnership(null)).toBeNull()
    expect(normalizeContainerOwnership('')).toBeNull()
    expect(normalizeContainerOwnership('1 PKG')).toBeNull()
  })

  it('mapeia EQD 8077 do Baplie: 1 = SOC, 2 = COC', () => {
    expect(ownershipFromEquipmentSupplier('1')).toBe('SOC')
    expect(ownershipFromEquipmentSupplier('2')).toBe('COC')
    expect(ownershipFromEquipmentSupplier('')).toBeNull()
    expect(ownershipFromEquipmentSupplier(undefined)).toBeNull()
  })
})
