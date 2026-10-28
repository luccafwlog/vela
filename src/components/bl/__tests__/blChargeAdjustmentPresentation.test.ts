import { describe, expect, it } from 'vitest'
import {
  chargeLineActions,
  historyChangePhrase,
  newTotalPreview,
  readChargeValueDraft,
} from '../blChargeAdjustmentPresentation'
import type { LocalChargeLine } from '../../../services/charges/chargeOperationsService'

const thd = {
  id: 1, bl_id: 'B1', charge_table_id: 1, charge_item_id: 1, charge_name: 'THD', charge_table_name: 'T', charge_table_pod: 'BRSSZ',
  application_basis: 'container_distinct_voyage', source: 'auto', status: 'calculated', quantity: 2, currency: 'BRL',
  unit_value_brl: 1420, unit_value_usd: null, total_value_brl: 2840, total_value_usd: null, override_applied: false,
  calculation_key: 'auto:item:1', notes: null, review_reason: null, calculated_at: null,
  table_unit_value_brl: 1420, table_total_value_brl: 2840,
} satisfies LocalChargeLine

describe('ações da linha de Taxa Local', () => {
  it('segue a tabela da spec por tipo de linha', () => {
    expect(chargeLineActions(thd, false)).toEqual(['alter', 'exclude'])
    expect(chargeLineActions({ ...thd, adjustment_id: 9, adjustment_kind: 'unit' }, false)).toEqual(['alter', 'restore', 'exclude'])
    expect(chargeLineActions({ ...thd, status: 'excluded', adjustment_id: 9, adjustment_kind: 'excluded' }, false)).toEqual(['reinclude'])
    expect(chargeLineActions({ ...thd, source: 'manual', status: 'reviewed' }, false)).toEqual(['editManual', 'alter', 'deleteManual'])
    expect(chargeLineActions({ ...thd, status: 'review_required' }, false)).toEqual([])
    expect(chargeLineActions(thd, true)).toEqual([])
    // B/L faturado (D8): a cobrança manual muda pelo valor, não pela quantidade.
    expect(chargeLineActions({ ...thd, source: 'manual', status: 'reviewed' }, false, { billed: true })).toEqual(['alter', 'deleteManual'])
    expect(chargeLineActions(thd, false, { billed: true })).toEqual(['alter', 'exclude'])
  })
})

describe('modal Alterar valor', () => {
  it('recusa com as mensagens da spec e lê "1.200,00"', () => {
    const just = 'Acordo comercial com o Cliente'
    expect(readChargeValueDraft({ kind: 'unit', value: 'abc', justification: just }, thd)).toMatchObject({ message: 'Informe um valor válido, como 1.420,50.' })
    expect(readChargeValueDraft({ kind: 'unit', value: '0', justification: just }, thd)).toMatchObject({ message: /use Excluir taxa/ })
    expect(readChargeValueDraft({ kind: 'unit', value: '1.420,00', justification: just }, thd)).toMatchObject({ message: 'O valor é igual ao atual: nada a alterar.' })
    expect(readChargeValueDraft({ kind: 'unit', value: '1.200,00', justification: 'curta' }, thd)).toMatchObject({ field: 'justification' })
    expect(readChargeValueDraft({ kind: 'unit', value: '1.200,00', justification: just }, thd)).toEqual({ ok: true, value: 1200 })
  })

  it('mostra o novo total e a diferença sobre a tabela', () => {
    expect(newTotalPreview('unit', '1.200', thd)).toBe('Novo total: R$ 2.400,00 · −15,5% sobre a tabela')
    expect(newTotalPreview('total', '3000', thd)).toBe('Novo total: R$ 3.000,00 · +5,6% sobre a tabela')
    expect(newTotalPreview('unit', '', thd)).toBeNull()
  })
})

describe('Histórico das taxas', () => {
  it('escreve O que mudou para cada evento', () => {
    expect(historyChangePhrase({ event: 'altered', before: { kind: 'table', unit: 1420, currency: 'BRL' }, after: { kind: 'unit', unit: 1200, currency: 'BRL' } }))
      .toBe('Valor por unidade: R$ 1.420,00 → R$ 1.200,00')
    expect(historyChangePhrase({ event: 'excluded', before: { total: 2840, currency: 'BRL' }, after: null }))
      .toBe('Excluída da cobrança (era R$ 2.840,00)')
    expect(historyChangePhrase({ event: 'discarded', before: null, after: { reason: 'pod', table_name: 'Tabela B', pod: 'BRRIO' } }))
      .toBe('Alteração descartada pelo sistema: o B/L passou para a tabela Tabela B (POD BRRIO)')
    expect(historyChangePhrase({ event: 'quantity_changed', before: { quantity: 2 }, after: { quantity: 3, total: 2000, currency: 'BRL' } }))
      .toBe('Quantidade mudou de 2 para 3; valor total alterado mantido em R$ 2.000,00')
    // 498: a quantidade foi a zero e a taxa saiu da cobrança.
    expect(historyChangePhrase({ event: 'quantity_changed', before: { quantity: 1 }, after: { quantity: 0, total: 800, currency: 'BRL', removed: true } } as never))
      .toMatch(/^Saiu da cobrança: a quantidade passou de 1 para 0; o valor total alterado de R\$\s800,00 ficou guardado$/)
  })
})
