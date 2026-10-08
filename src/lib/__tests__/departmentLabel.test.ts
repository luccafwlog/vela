import { describe, expect, it } from 'vitest'
import { MANAGED_PROFILES, PROFILE_LABELS } from '../../services/adminUsers'
import { departmentLabel } from '../departmentLabel'

describe('departmentLabel', () => {
  it('usa o mesmo nome da Administração para todo departamento gerido', () => {
    for (const role of MANAGED_PROFILES) expect(departmentLabel(role)).toBe(PROFILE_LABELS[role])
  })

  it('lê o papel legado operator como Documentação, fora da Administração', () => {
    expect(departmentLabel('operator')).toBe('Documentação')
    expect(PROFILE_LABELS.operator).toBe('Operador (legado)')
    expect(departmentLabel(null)).toBe('—')
  })
})
