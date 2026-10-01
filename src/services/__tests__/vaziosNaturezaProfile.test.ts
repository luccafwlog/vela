import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRpc, supabaseMock } = vi.hoisted(() => {
  const mockRpc = vi.fn()
  const supabaseMock = {
    rest: { id: 'client-rest' },
    rpc(name: string, args: Record<string, unknown>) {
      if (!this || !('rest' in this)) {
        throw new TypeError("Cannot read properties of undefined (reading 'rest')")
      }
      return mockRpc(name, args)
    },
  }
  return { mockRpc, supabaseMock }
})

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}))

import { setContainerProfile } from '../vaziosNatureza'

describe('vaziosNatureza setContainerProfile', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('chama supabase.rpc diretamente preservando o contexto this (evita VELA-15)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    await setContainerProfile({
      containerId: 99,
      profile: 'oog',
      justification: 'Carga com excesso de altura',
      changedBy: 'user-op',
    })

    expect(mockRpc).toHaveBeenCalledWith('set_bl_container_profile', {
      p_container_id: 99,
      p_profile: 'oog',
      p_justification: 'Carga com excesso de altura',
      p_changed_by: 'user-op',
    })
  })

  it('lança erro legível quando a RPC falha', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Container não encontrado' } })

    await expect(
      setContainerProfile({
        containerId: 99,
        profile: 'imo',
        justification: 'Carga perigosa',
      }),
    ).rejects.toThrow('Container não encontrado')
  })
})
