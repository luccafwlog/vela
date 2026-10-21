import { beforeEach, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { markBlsReadyAndCreateInvoice } from '../billing'

beforeEach(() => {
  rpcMock.mockReset()
})

it('F-43: deadlock com outra emissão tenta de novo uma vez', async () => {
  rpcMock
    .mockResolvedValueOnce({ data: null, error: { code: '40P01', message: 'deadlock detected' } })
    .mockResolvedValueOnce({ data: { invoice_id: 7 }, error: null })
  await expect(markBlsReadyAndCreateInvoice({ blIds: ['A', 'B'], customerId: 1 })).resolves.toEqual({ invoice_id: 7 })
  expect(rpcMock).toHaveBeenCalledTimes(2)
})

it('F-43: outro erro não é repetido', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { code: '22023', message: 'B/L sem CE' } })
  await expect(markBlsReadyAndCreateInvoice({ blIds: ['A'], customerId: 1 })).rejects.toMatchObject({ code: '22023' })
  expect(rpcMock).toHaveBeenCalledTimes(1)
})
