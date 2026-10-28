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

// O ETA com hora vem como `YYYY-MM-DDTHH:MM:00` (combineIsoDateTime); montar
// `${eta}T23:59:59` sobre ele dava data inválida e nunca marcava vencido.
it('ETA com hora no passado está vencido', () => {
  expect(isEtaOverdue('2026-07-01T14:00:00', new Date('2026-07-16T12:00:00'))).toBe(true)
})

it('ETA com hora vence só no fim do dia do ETA', () => {
  expect(isEtaOverdue('2026-07-16T08:00:00', new Date('2026-07-16T12:00:00'))).toBe(false)
  expect(isEtaOverdue('2026-07-15T08:00:00', new Date('2026-07-16T00:30:00'))).toBe(true)
})
