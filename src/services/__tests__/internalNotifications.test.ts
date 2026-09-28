import { beforeEach, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { listAllUnreadInternalNotifications, listInternalNotifications } from '../alerts'

beforeEach(() => rpcMock.mockReset())

it('consulta notificações com cursor composto por data e id', async () => {
  rpcMock.mockResolvedValue({ data: [], error: null })

  await listInternalNotifications({
    includeRead: false,
    limit: 20,
    before: { createdAt: '2026-08-22T10:00:00Z', id: 41 },
  })

  expect(rpcMock).toHaveBeenCalledWith('list_internal_notifications', {
    p_include_read: false,
    p_limit: 20,
    p_before_created_at: '2026-08-22T10:00:00Z',
    p_before_id: 41,
  })
})

it('carrega todas as notificações não lidas em páginas com cursor composto', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: 100 - index,
    created_at: `2026-08-22T10:${String(index).padStart(2, '0')}:00Z`,
  }))
  const secondPage = [{ id: 1, created_at: '2026-08-21T10:00:00Z' }]
  rpcMock
    .mockResolvedValueOnce({ data: firstPage, error: null })
    .mockResolvedValueOnce({ data: secondPage, error: null })

  const result = await listAllUnreadInternalNotifications()

  expect(result).toHaveLength(101)
  expect(rpcMock).toHaveBeenNthCalledWith(1, 'list_internal_notifications', {
    p_include_read: false,
    p_limit: 100,
  })
  expect(rpcMock).toHaveBeenNthCalledWith(2, 'list_internal_notifications', {
    p_include_read: false,
    p_limit: 100,
    p_before_created_at: firstPage[99]?.created_at,
    p_before_id: firstPage[99]?.id,
  })
})
