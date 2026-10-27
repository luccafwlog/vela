import { beforeEach, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc } }))

import { fetchUserDisplayNames } from '../userNames'

beforeEach(() => {
  rpc.mockReset()
})

// ACE-D16 de 2026-10-27 (ADR 0106): o nome do autor vem da função do banco, que
// todo usuário ativo chama, e não da leitura do cadastro de usuários.
it('busca os nomes uma vez por autor, em lotes de 200, e ignora vazio', async () => {
  rpc.mockImplementation((_name: string, args: { p_user_ids: string[] }) => Promise.resolve({
    data: args.p_user_ids.map((id) => ({ user_id: id, full_name: id === 'u-1' ? '  Rafael  ' : id === 'u-2' ? '' : `Nome ${id}` })),
    error: null,
  }))
  const ids = ['u-1', 'u-1', null, 'u-2', ...Array.from({ length: 250 }, (_, i) => `x-${i}`)]
  const names = await fetchUserDisplayNames(ids)
  expect(rpc).toHaveBeenCalledTimes(2)
  expect(rpc.mock.calls[0][0]).toBe('get_user_display_names')
  expect(rpc.mock.calls[0][1].p_user_ids).toHaveLength(200)
  expect(names.get('u-1')).toBe('Rafael')
  expect(names.has('u-2')).toBe(false)
  expect(names.size).toBe(251)
})

it('sem autor não chama o banco', async () => {
  expect((await fetchUserDisplayNames([null, undefined])).size).toBe(0)
  expect(rpc).not.toHaveBeenCalled()
})
