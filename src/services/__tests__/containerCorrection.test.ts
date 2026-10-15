import { describe, expect, it } from 'vitest'
import { containerCorrectionValues, planContainerCorrection } from '../containerCorrection'

const gravado = containerCorrectionValues({
  is_imo: false, is_oog: false, ownership: null, seal_number: 'SL88109', gross_weight_kg: 47900, cbm: 24,
  discharge_date: '2026-10-13', return_date: null,
})

describe('janela Corrigir do container', () => {
  it('sem mudança, nada vai ao banco', () => {
    const plan = planContainerCorrection(gravado, gravado)
    expect(plan.changes).toEqual([])
    expect([plan.profile, plan.ownership, plan.data, plan.dates]).toEqual([null, null, null, null])
  })

  it('lacre, peso e CBM vão juntos pela correção de dados, com o antes e depois de cada campo', () => {
    const plan = planContainerCorrection(gravado, { ...gravado, seal: 'SL99999', cbm: '25' })
    expect(plan.data).toEqual({ seal: 'SL99999', grossWeightKg: 47900, cbm: 25 })
    expect(plan.changes).toEqual([
      { field: 'Lacre', before: 'SL88109', after: 'SL99999' },
      { field: 'CBM (m³)', before: '24', after: '25' },
    ])
    expect(plan.dates).toBeNull()
  })

  it('perfil, COC/SOC e datas seguem cada um o seu caminho', () => {
    const plan = planContainerCorrection(gravado, { ...gravado, profile: 'imo', ownership: 'SOC', returnDate: '2026-10-20' })
    expect(plan.profile).toBe('imo')
    expect(plan.ownership).toBe('SOC')
    expect(plan.dates).toEqual({ discharge: '2026-10-13', returnDate: '2026-10-20' })
    expect(plan.data).toBeNull()
  })

  it('recusa devolução antes da descarga e número negativo', () => {
    expect(planContainerCorrection(gravado, { ...gravado, returnDate: '2026-10-01' }).error).toMatch(/anterior à descarga/)
    expect(planContainerCorrection(gravado, { ...gravado, grossWeightKg: '-1' }).error).toMatch(/números positivos/)
  })
})
