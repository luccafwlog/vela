import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateProvisionalLocalCharges } from '../charges/chargeOperationsService'

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}))

type Table = 'bls' | 'bl_containers'

// bls: id/cargo_mode/financial_status lookup for the target ids, then the
// per-bl maybeSingle lookup calculateBlLocalCharges itself does.
// bl_containers: container numbers of the targets, then sibling bl_ids that
// share those container numbers within the voyage.
function mockTables(fixtures: {
  targetBls: Array<{ id: string; cargo_mode: string; financial_status: string }>
  targetContainers: Array<{ container_number: string }>
  siblingContainers: Array<{
    bl_id: string
    container_number?: string
    bl: { voyage_id: number; cargo_mode: string; financial_status: string; charge_status?: string | null }
  }>
  perBlFinancialStatus: Record<string, string>
}) {
  mockFrom.mockImplementation((table: Table) => {
    if (table === 'bls') {
      return {
        select: vi.fn((cols: string) => {
          if (cols === 'id, cargo_mode, financial_status') {
            return { in: vi.fn(() => Promise.resolve({ data: fixtures.targetBls, error: null })) }
          }
          // per-bl lookup inside calculateBlLocalCharges
          return {
            eq: vi.fn((_col: string, id: string) => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({ data: { financial_status: fixtures.perBlFinancialStatus[id] ?? 'pending' }, error: null }),
              ),
            })),
          }
        }),
      }
    }
    if (table === 'bl_containers') {
      return {
        select: vi.fn((cols: string) => {
          if (cols === 'container_number') {
            return { in: vi.fn(() => Promise.resolve({ data: fixtures.targetContainers, error: null })) }
          }
          // Achado 2 da review da PR 501: busca todos os containers da
          // viagem (sem filtro .in(container_number) no banco) e filtra
          // no cliente pelo Set normalizado -- ver chargeOperationsService.ts.
          return {
            eq: vi.fn(() => Promise.resolve({ data: fixtures.siblingContainers, error: null })),
          }
        }),
      }
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

describe('calculateProvisionalLocalCharges', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockFrom.mockReset()
  })

  it('calcula o B/L importado e o irmao de container compartilhado, pulando o ja faturado', async () => {
    mockTables({
      targetBls: [{ id: 'BL1', cargo_mode: 'container', financial_status: 'pending' }],
      targetContainers: [{ container_number: 'CSCU1234567' }],
      siblingContainers: [
        { bl_id: 'BL1', container_number: 'CSCU1234567', bl: { voyage_id: 10, cargo_mode: 'container', financial_status: 'pending' } },
        { bl_id: 'BL2', container_number: 'CSCU1234567', bl: { voyage_id: 10, cargo_mode: 'container', financial_status: 'pending' } },
        { bl_id: 'BL3', container_number: 'CSCU1234567', bl: { voyage_id: 10, cargo_mode: 'container', financial_status: 'invoiced' } },
      ],
      perBlFinancialStatus: { BL1: 'pending', BL2: 'pending' },
    })
    mockRpc.mockResolvedValue({ data: { bl_id: 'BL1', status: 'calculated' }, error: null })

    const result = await calculateProvisionalLocalCharges(10, ['BL1'], 'user-1')

    expect(result.calculated).toBe(2)
    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenCalledWith('calculate_bl_local_charges', expect.objectContaining({ p_bl_id: 'BL1' }))
    expect(mockRpc).toHaveBeenCalledWith('calculate_bl_local_charges', expect.objectContaining({ p_bl_id: 'BL2' }))
  })

  it('nao calcula nada para carga solta', async () => {
    mockTables({
      targetBls: [{ id: 'BL9', cargo_mode: 'carga_solta', financial_status: 'pending' }],
      targetContainers: [],
      siblingContainers: [],
      perBlFinancialStatus: {},
    })

    const result = await calculateProvisionalLocalCharges(10, ['BL9'], 'user-1')

    expect(result.calculated).toBe(0)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('calcula B/L misto e inclui seus irmaos de container', async () => {
    mockTables({
      targetBls: [{ id: 'BL-MIX', cargo_mode: 'misto', financial_status: 'pending' }],
      targetContainers: [{ container_number: 'MSCU1234567' }],
      siblingContainers: [
        { bl_id: 'BL-MIX', container_number: 'MSCU1234567', bl: { voyage_id: 10, cargo_mode: 'misto', financial_status: 'pending' } },
        { bl_id: 'BL-CNTR', container_number: 'MSCU1234567', bl: { voyage_id: 10, cargo_mode: 'container', financial_status: 'pending' } },
      ],
      perBlFinancialStatus: { 'BL-MIX': 'pending', 'BL-CNTR': 'pending' },
    })
    mockRpc.mockResolvedValue({ data: { status: 'calculated' }, error: null })

    const result = await calculateProvisionalLocalCharges(10, ['BL-MIX'], 'user-1')

    expect(result.calculated).toBe(2)
    expect(mockRpc).toHaveBeenCalledWith('calculate_bl_local_charges', expect.objectContaining({ p_bl_id: 'BL-MIX' }))
    expect(mockRpc).toHaveBeenCalledWith('calculate_bl_local_charges', expect.objectContaining({ p_bl_id: 'BL-CNTR' }))
  })
})
