import { describe, expect, it, vi } from 'vitest'
import { invalidateBaplieDependentQueries } from '../baplieInvalidation'

describe('invalidateBaplieDependentQueries', () => {
  it('refreshes reconciliation and every view that consumes changed manifest container data', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined)

    await invalidateBaplieDependentQueries({ invalidateQueries }, '24')

    expect(invalidateQueries.mock.calls.map(([input]) => input.queryKey)).toEqual([
      ['alerts'], ['financial-alerts'], ['invoice-corrections'],
      ['baplie-reconciliation', '24'],
      ['bls'],
      ['bl-detail'],
      ['voyages'],
      ['voyage-timeline', '24'],
      ['agency-report'],
    ])
  })
})
