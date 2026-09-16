import { beforeEach, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { cancelInvoice } from '../billing'

beforeEach(() => {
  rpcMock.mockReset()
})

it('US-092: cancela a invoice chamando o RPC com motivo e ator', async () => {
  rpcMock.mockResolvedValue({ data: { cancelled: true }, error: null })

  await expect(cancelInvoice({ invoiceId: 5, reason: 'erro de emissao', actorId: 'user-1' })).resolves.toEqual({ cancelled: true })
  expect(rpcMock).toHaveBeenCalledWith('cancel_invoice', {
    p_invoice_id: 5,
    p_reason: 'erro de emissao',
    p_actor: 'user-1',
  })
})

it('US-092: valida motivo vazio sem chamar o RPC', async () => {
  await expect(cancelInvoice({ invoiceId: 5, reason: null })).rejects.toThrow('Informe a justificativa')
  expect(rpcMock).not.toHaveBeenCalled()
})
