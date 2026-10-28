import { describe, expect, it } from 'vitest'
import { describeImpact, impactNeedingConfirmation } from '../chargeAdjustmentImpact'
import type { BlChargeImpactItem } from '../../services/charges/chargeOperationsService'
import { blImportImpactChanges } from '../../components/shared/blImportPresentation'
import { baplieImpactChanges } from '../../services/baplieImport'
import type { BlFreightImportRow } from '../../services/blFreightImport'

const item = (over: Partial<BlChargeImpactItem>): BlChargeImpactItem => ({
  charge_name: 'THC', kind: 'unit', currency: 'BRL', basis: null, value: 100, quantity: 2, total: 200,
  outcome: 'kept', after_quantity: 2, after_total: 200, reason: null, table_name: null, pod: null, needs_confirmation: false,
  ...over,
} as BlChargeImpactItem)

describe('prévia da taxa alterada à mão', () => {
  it('pede o Gravar mesmo assim só para descarte e total com quantidade nova', () => {
    const entries = [{ bl_id: 'BL1', manual_exempt: false, items: [
      item({}),
      item({ outcome: 'discarded', reason: 'pod', table_name: 'Santos', needs_confirmation: true }),
      item({ charge_name: 'ISPS', kind: 'total', outcome: 'total_kept', after_quantity: 3, currency: 'USD', needs_confirmation: true }),
    ] }]
    const lines = impactNeedingConfirmation(entries)
    expect(lines.map((line) => line.text)).toEqual([
      'BL1 · THC: alteração descartada — o B/L passa para a tabela Santos (POD)',
      'BL1 · ISPS: valor total alterado mantido em US$ 200,00; a quantidade passa de 2 para 3',
    ])
    expect(describeImpact(entries)).toHaveLength(3)
  })

  // 498 (decisão do dono): a taxa com total alterado cuja quantidade vai a zero sai da cobrança.
  it('total alterado que sai da cobrança pede o Gravar mesmo assim', () => {
    const entries = [{ bl_id: 'BL5', manual_exempt: false, items: [
      item({ charge_name: 'THD', kind: 'total', value: 800, quantity: 1, total: 800, outcome: 'removed', after_quantity: 0, after_total: null, needs_confirmation: true }),
    ] }]
    expect(impactNeedingConfirmation(entries).map((line) => line.text)).toEqual([
      'BL5 · THD: sai da cobrança (quantidade 1 → 0); o valor total alterado de R$ 800,00 fica guardado e volta se a taxa voltar ao B/L',
    ])
  })

  it('B/L isento à mão vira uma linha e não pede confirmação', () => {
    const entries = [{ bl_id: 'BL2', manual_exempt: true, items: [item({ outcome: 'discarded', needs_confirmation: true })] }]
    expect(describeImpact(entries)).toEqual(['BL2: isento à mão — continua isento'])
    expect(impactNeedingConfirmation(entries)).toEqual([])
  })

  it('reimportação de B/L leva POD, containers que entram, saem e mudam de perfil e o SOC/COC do arquivo; B/L novo fica fora', () => {
    const row = (over: Partial<BlFreightImportRow>) => ({
      blNumber: 'BL3', status: 'updated', existing: true, existingContainerNumbers: ['AAAU1'], removedContainers: ['CCCU3'], pod: 'BRSSZ',
      payload: { containers: [
        { container_number: 'AAAU1', type: '20DC', is_imo: true, is_oog: false, ownership: 'SOC' },
        { container_number: 'BBBU2', type: '40HC', is_imo: false, is_oog: false, ownership: 'COC' },
      ] },
      ...over,
    }) as unknown as BlFreightImportRow
    expect(blImportImpactChanges([row({}), row({ blNumber: 'NOVO', existing: false })])).toEqual([{
      bl_id: 'BL3',
      bls: { pod: 'BRSSZ' },
      remove_container_numbers: ['CCCU3'],
      add_containers: [{ container_number: 'BBBU2', type: '40HC', is_imo: false, is_oog: false }],
      container_flags: [{ container_number: 'AAAU1', type: '20DC', is_imo: true, is_oog: false }],
      // Migration 497: o SOC/COC do arquivo vale só no container que já existe.
      container_ownership: [{ container_number: 'AAAU1', ownership: 'SOC' }],
    }])
  })

  it('Baplie lê o perfil e o SOC/COC novos do rótulo das marcas', () => {
    expect(baplieImpactChanges({
      apply: [{ container: 'AAAU1', bl_id: 'BL4', after: 'IMO, OOG, SOC' }],
      clear: [{ container: 'BBBU2', bl_id: 'BL4', after: 'sem marca' }],
      divergent_manual: [],
    })).toEqual([{ bl_id: 'BL4', container_flags: [
      { container_number: 'AAAU1', is_imo: true, is_oog: true, ownership: 'SOC' },
      { container_number: 'BBBU2', is_imo: false, is_oog: false },
    ] }])
  })
})
