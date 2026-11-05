import { beforeEach, expect, it, vi } from 'vitest'
import { summarizeItauPixReceipts } from '../reconciliacao'

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { rpc: mockRpc },
}))

const scope = { from: '2026-11-01', to: '', situation: '' as const, origin: 'vela' as const, amount: null, search: '' }

beforeEach(() => {
  mockRpc.mockReset()
  // `list_itau_pix_receipts` devolve o total do recorte mesmo lendo uma linha só.
  const totals: Record<string, { total: number; total_amount_brl: number | string }> = {
    settled: { total: 3, total_amount_brl: '450.10' },
    received: { total: 1, total_amount_brl: 5 },
    review: { total: 0, total_amount_brl: 0 },
    handled: { total: 2, total_amount_brl: 80 },
  }
  mockRpc.mockImplementation((_name: string, args: { p_situation: string }) =>
    Promise.resolve({ data: { ...totals[args.p_situation], rows: [] }, error: null }))
})

it('soma cada situação com os demais filtros da tela, lendo só o total', async () => {
  const summary = await summarizeItauPixReceipts(scope)

  expect(summary).toEqual({
    settled: { count: 3, amount: 450.1 },
    received: { count: 1, amount: 5 },
    review: { count: 0, amount: 0 },
    handled: { count: 2, amount: 80 },
  })
  expect(mockRpc).toHaveBeenCalledTimes(4)
  expect(mockRpc).toHaveBeenCalledWith('list_itau_pix_receipts', expect.objectContaining({ p_from: '2026-11-01', p_origin: 'vela', p_situation: 'review', p_limit: 1, p_offset: 0 }))
})

it('com a situação filtrada, as outras ficam zeradas sem consultar', async () => {
  const summary = await summarizeItauPixReceipts({ ...scope, situation: 'settled' })

  expect(summary.settled).toEqual({ count: 3, amount: 450.1 })
  expect(summary.received).toEqual({ count: 0, amount: 0 })
  expect(mockRpc).toHaveBeenCalledTimes(1)
})
