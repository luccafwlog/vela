import { describe, expect, it } from 'vitest'
import { adjustedIssueNotice, adjustedRecalcNotice } from '../validacaoPipeline'

const item = { charge_name: 'THD', excluded: false } as never

describe('avisos da taxa alterada à mão na Validação (ADR 0111)', () => {
  it('Recalcular conta só os B/Ls com taxa alterada', () => {
    expect(adjustedRecalcNotice([{ adjustments: null }, { adjustments: { items: [] } as never }])).toBe('')
    expect(adjustedRecalcNotice([{ adjustments: { items: [item] } as never }])).toBe('1 B/L tem taxas alteradas à mão: as alterações se mantêm no recálculo.')
    expect(adjustedRecalcNotice([{ adjustments: { items: [item] } as never }, { adjustments: { items: [item, item] } as never }]))
      .toBe('2 B/Ls têm taxas alteradas à mão: as alterações se mantêm no recálculo.')
  })

  it('Emitir diz quantas taxas do B/L estão alteradas', () => {
    expect(adjustedIssueNotice(null)).toBe('')
    expect(adjustedIssueNotice({ items: [item] })).toBe('Este B/L tem 1 taxa alterada à mão; a fatura sai com os valores alterados.')
    expect(adjustedIssueNotice({ items: [item, item] })).toBe('Este B/L tem 2 taxas alteradas à mão; a fatura sai com os valores alterados.')
  })
})
