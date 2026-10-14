import { describe, expect, it } from 'vitest'
import { describeReturns } from '../blOverviewPresentation'

describe('describeReturns', () => {
  it('conta só o que volta: SOC fica de fora e Part Lot conta uma vez', () => {
    expect(describeReturns([
      { container_number: 'A', ownership: 'COC', return_date: null },
      { container_number: 'A', ownership: 'COC', return_date: '2026-10-12' },
      { container_number: 'B', ownership: 'COC', return_date: null },
      { container_number: 'C', ownership: 'SOC', return_date: null },
    ])).toEqual({ text: '1 de 2 devolvidos', tone: 'warning' })
  })

  it('tudo devolvido fica em tinta normal; só SOC não tem devolução', () => {
    expect(describeReturns([{ container_number: 'A', ownership: 'COC', return_date: '2026-10-12' }])).toEqual({ text: '1 de 1 devolvido', tone: 'default' })
    expect(describeReturns([{ container_number: 'C', ownership: 'SOC', return_date: null }])).toBeNull()
  })
})
