import { expect, it, vi } from 'vitest'
import { ceUnlockCommand, fetchAllCeUnlockBls, portalCeUnlockCommand } from '../ceUnlockService'
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
it('planilha comum lê todas as páginas do recorte e não repete B/L que mudou de página', async () => {
  // 6 páginas de 25: a página 3 repete o último B/L da 2 (a lista mudou entre as leituras).
  const bl = (n: number) => ({ bl_id: `BL-${String(n).padStart(3, '0')}` })
  mocks.rpc.mockReset()
  mocks.rpc.mockImplementation(async (_name: string, args: { p_payload: { page: number } }) => {
    const page = args.p_payload.page
    const start = (page - 1) * 25 + (page === 3 ? -1 : 0)
    const items = Array.from({ length: page === 6 ? 10 : 25 }, (_, i) => bl(start + i))
    return { data: { items, total: 135, page, page_size: 25 }, error: null }
  })
  const items = await fetchAllCeUnlockBls({})
  expect(mocks.rpc).toHaveBeenCalledTimes(6)
  expect(new Set(items.map((i) => i.bl_id)).size).toBe(items.length)
  expect(items[0].bl_id).toBe('BL-000')
  expect(items.at(-1)?.bl_id).toBe('BL-134')
})
