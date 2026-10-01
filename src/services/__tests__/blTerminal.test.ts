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

import { setBlTerminalOverride } from '../blTerminal'

describe('blTerminal service', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('chama supabase.rpc diretamente preservando o contexto this (evita VELA-15)', async () => {
    mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null })

    const result = await setBlTerminalOverride({
      blId: 'bl-123',
      terminalId: 'term-456',
      podPortId: 10,
      justification: 'Troca solicitada pelo cliente',
      changedBy: 'user-op',
    })

    expect(mockRpc).toHaveBeenCalledWith('set_bl_terminal_override', {
      p_bl_id: 'bl-123',
      p_terminal_id: 'term-456',
      p_pod_port_id: 10,
      p_justification: 'Troca solicitada pelo cliente',
      p_changed_by: 'user-op',
    })
    expect(result).toEqual({ success: true })
  })

  it('lança erro quando a RPC retorna erro', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Terminal incompatível com porto' } })

    await expect(
      setBlTerminalOverride({
        blId: 'bl-123',
        terminalId: 'term-456',
        podPortId: 10,
        justification: 'Troca',
      }),
    ).rejects.toThrow('Terminal incompatível com porto')
  })
})
