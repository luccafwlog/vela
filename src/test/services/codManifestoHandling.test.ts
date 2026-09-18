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

  it('preserva o ce_mercante e limpa o manifesto_mercante_id ao alterar o destino', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'BL-001',
        pod: 'BRVIX',
        ce_mercante: '123456789012345',
        manifesto_mercante_id: 'man-old-vix',
      },
      error: null,
    })
    const eqSelectMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqSelectMock })

    const eqUpdateMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: eqUpdateMock })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return {
          select: selectMock,
          update: updateMock,
        }
      }
      return {}
    })

    const result = await applyChangeOfDestination({
      blId: 'BL-001',
      newPod: 'BRSSZ',
      reason: 'Omissão de porto / alteração de rota',
      changedBy: 'user-1',
    })

    // 1. Atualizou bls com o novo POD e manifesto_mercante_id = null
    expect(mockFrom).toHaveBeenCalledWith('bls')
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pod: 'BRSSZ',
        manifesto_mercante_id: null,
      }),
    )
    expect(eqUpdateMock).toHaveBeenCalledWith('id', 'BL-001')

    // 2. CE Mercante foi preservado (não foi limpo ou alterado)
    expect(updateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        ce_mercante: null,
      }),
    )

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
