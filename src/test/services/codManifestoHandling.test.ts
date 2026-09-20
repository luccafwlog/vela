import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('../../services/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))

import { applyChangeOfDestination } from '../../services/blChangeOfDestinationService'

describe('Change of Destination (COD) - Manifesto Mercante Handling', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('recusa alteração de destino sem omissão vinculada', async () => {
    await expect(applyChangeOfDestination({
      blId: 'BL-001',
      newPod: 'BRSSZ',
      reason: 'Omissão de porto / alteração de rota',
      changedBy: 'user-1',
      omissionId: null as unknown as number,
    })).rejects.toThrow(/omissão vinculada/)
  })

  it('preserva o ce_mercante e limpa o manifesto_mercante_id pelo RPC COD', async () => {
    const singleMock = vi.fn()
      .mockResolvedValueOnce({
        data: { id: 'BL-001', pod: 'BRVIX', ce_mercante: '123456789012345', manifesto_mercante_id: 'man-old-vix' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { pod: 'BRSSZ', ce_mercante: '123456789012345', manifesto_mercante_id: null },
        error: null,
      })
    const eqSelectMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqSelectMock })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return {
          select: selectMock,
        }
      }
      return {}
    })
    mockRpc.mockResolvedValue({ data: null, error: null })

    const result = await applyChangeOfDestination({
      blId: 'BL-001',
      newPod: 'BRSSZ',
      reason: 'Omissão de porto / alteração de rota',
      changedBy: 'user-1',
      omissionId: 42,
    })

    expect(mockRpc).toHaveBeenCalledWith('set_bl_cod', expect.objectContaining({ p_omission_id: 42 }))

    expect(result.manifestoMercanteId).toBeNull()
    expect(result.ceMercante).toBe('123456789012345')
  })

  it('usa set_bl_cod como caminho único quando há omissão e preserva o POD anterior', async () => {
    const singleMock = vi.fn()
      .mockResolvedValueOnce({
        data: {
          id: 'BL-001',
          pod: 'BRVIX',
          ce_mercante: '123456789012345',
          manifesto_mercante_id: 'man-old-vix',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          pod: 'BRSSZ',
          ce_mercante: '123456789012345',
          manifesto_mercante_id: null,
        },
        error: null,
      })
    const eqSelectMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqSelectMock })
    const updateMock = vi.fn()

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'bls') return {}
      return { select: selectMock, update: updateMock }
    })
    mockRpc.mockResolvedValue({ data: null, error: null })

    const result = await applyChangeOfDestination({
      blId: 'BL-001',
      newPod: 'BRSSZ',
      reason: 'Omissão de porto',
      changedBy: 'user-1',
      omissionId: 42,
    })

    expect(mockRpc).toHaveBeenCalledWith('set_bl_cod', expect.objectContaining({
      p_bl_id: 'BL-001',
      p_omission_id: 42,
    }))
    expect(updateMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      oldPod: 'BRVIX',
      newPod: 'BRSSZ',
      ceMercante: '123456789012345',
      manifestoMercanteId: null,
    })
  })
})
