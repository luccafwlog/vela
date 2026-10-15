import { expect, it, vi } from 'vitest'
import { invalidateAgencyReportForVoyage } from '../agencyReportInvalidation'
import { queryKeys } from '../queryKeys'

it('invalida somente o ADR da viagem alterada', async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined)
  await invalidateAgencyReportForVoyage({ invalidateQueries }, 179)
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agency-report', 179] })
})

it('B8: a invalidação do ADR da viagem cobre o registro do ATD', () => {
  const prefix = ['agency-report', 179]
  const key = queryKeys.agencyReports.atdRegisteredAt(179, 'BRSSZ', 't1', '2026-05-01T10:00:00Z')
  expect(key.slice(0, prefix.length)).toEqual(prefix)
})
