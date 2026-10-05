import { expect, it, vi } from 'vitest'
import { ceUnlockCommand, portalCeUnlockCommand } from '../ceUnlockService'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), portal: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc }, supabasePortal: {} }))
vi.mock('../portalScope', () => ({ callPortalRpc: mocks.portal, isPortalReadOnly: () => false }))
it('preserva motivo do banco como Error para o Vela', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Entrega alterada; atualize a página', code: '40001' } })
  const error = await ceUnlockCommand('delivery', {}).catch(e => e)
  expect(error instanceof Error).toBe(true)
  expect((error as Error).message).toBe('Entrega alterada; atualize a página')
})
it('Portal recebe o BL e o motivo de inelegibilidade após falha de envio', async () => {
  mocks.portal.mockRejectedValue({ message: 'B/L TEST-A perdeu elegibilidade', code: 'P0001' })
  const error = await portalCeUnlockCommand({ mode: 'client', basePath: '/portal', customerId: null, overview: null }, 'submit', {}).catch(e => e)
  expect(error instanceof Error).toBe(true)
  expect((error as Error).message).toBe('B/L TEST-A perdeu elegibilidade')
})
