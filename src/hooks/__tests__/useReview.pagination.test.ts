import { describe, expect, it, vi } from 'vitest'
import { fetchAllReviewPages } from '../useReview'

describe('fetchAllReviewPages', () => {
  it('continua depois de 500 linhas e preserva a ordem', async () => {
    const first = Array.from({ length: 500 }, (_, id) => id)
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValueOnce({ data: [500, 501], error: null })

    const rows = await fetchAllReviewPages(loadPage)

    expect(rows).toHaveLength(502)
    expect(rows.at(-1)).toBe(501)
    expect(loadPage).toHaveBeenNthCalledWith(2, 500, 999)
  })
})
