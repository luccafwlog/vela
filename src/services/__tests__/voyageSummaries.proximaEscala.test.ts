import { expect, it } from 'vitest'
import { isEtaOverdue } from '../voyageSummaries'

it('ETA no passado sem ATA está vencido', () => {
  expect(isEtaOverdue('2026-07-01', new Date('2026-07-16'))).toBe(true)
})

it('ETA futuro não está vencido', () => {
  expect(isEtaOverdue('2026-08-01', new Date('2026-07-16'))).toBe(false)
})

it('sem ETA não há vencimento', () => {
  expect(isEtaOverdue(null, new Date('2026-07-16'))).toBe(false)
})
