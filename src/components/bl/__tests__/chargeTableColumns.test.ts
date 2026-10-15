import { describe, expect, it } from 'vitest'
import { chargeTableColumns } from '../chargeTableColumns'

const auto = { source: 'automatic', status: 'calculated', review_reason: null, notes: null }

describe('colunas da tabela de Taxas Locais do B/L', () => {
  it('só Taxa, Qtd., Unitário e Total quando todas as linhas são automáticas e normais', () => {
    expect(chargeTableColumns([auto, auto], false)).toEqual({ showOrigin: false, showSituation: false, showNotes: false, showActions: false })
  })
  it('linha manual traz Origem e Ações; em revisão traz Situação e o motivo traz Observação', () => {
    const cols = chargeTableColumns([auto, { source: 'manual', status: 'calculated', notes: null }, { ...auto, status: 'review_required', review_reason: 'Sem medidas' }], false)
    expect(cols).toEqual({ showOrigin: true, showSituation: true, showNotes: true, showActions: true })
  })
  it('B/L faturado não oferece Ações nem com linha manual', () => {
    expect(chargeTableColumns([{ source: 'manual', status: 'ready_for_billing' }], true).showActions).toBe(false)
  })
})
