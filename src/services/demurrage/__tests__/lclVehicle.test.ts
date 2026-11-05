import { describe, expect, it } from 'vitest'
import { isLclVehicleBl } from '../lclVehicle'

// Cópia da prévia de `_bl_is_lcl_vehicle` (migration 593): container, com
// veículo e Movement To com LCL ou CFS, como a isenção das Taxas Locais.
describe('veículo LCL', () => {
  it('exige prova positiva: modalidade container, veículo e LCL ou CFS no Movement To', () => {
    expect(isLclVehicleBl({ cargo_mode: 'container', movement_to: 'CFS/LCL' }, 1)).toBe(true)
    expect(isLclVehicleBl({ cargo_mode: 'container', movement_to: ' fcl/lcl ' }, 2)).toBe(true)
    expect(isLclVehicleBl({ cargo_mode: 'container', movement_to: 'CY/FCL' }, 1)).toBe(false)
    expect(isLclVehicleBl({ cargo_mode: 'container', movement_to: null }, 1)).toBe(false)
    expect(isLclVehicleBl({ cargo_mode: 'container', movement_to: 'CFS/LCL' }, 0)).toBe(false)
    expect(isLclVehicleBl({ cargo_mode: 'misto', movement_to: 'CFS/LCL' }, 1)).toBe(false)
  })
})
