import { describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { buildVoyageVehicleStats, fetchVoyageVehicleStats } from '../voyageVehicleStats'

describe('indicadores de veículos por viagem', () => {
  it('soma grupos gravados com grafias diferentes como somava os veículos', () => {
    const stats = buildVoyageVehicleStats(
      [10, 20],
      [
        [10, 'BRVIX', 'Toyota', '40HC', 3],
        [10, 'Vitória', ' Toyota ', '40HC', 2],
        [10, 'BRVIX', 'BYD', null, 1],
        [10, null, null, '20GP', 4],
      ],
      [
        [10, 'BRVIX', 'MSCU0000001'],
        [10, 'vitória', 'mscu0000001 '],
        [10, 'BRVIX', 'MSCU0000002'],
        [10, null, 'TGHU0000003'],
      ],
    )

    expect(stats[10]).toEqual({
      totalVehicles: 10,
      distinctContainerCount: 3,
      containerNumbers: ['MSCU0000001', 'MSCU0000002', 'TGHU0000003'],
      brandSummary: 'Toyota: 5 | Nao informado: 4 | BYD: 1',
      vehicleByContainerTypeSummary: '40HC: 5 | 20GP: 4 | Nao informado: 1',
      byPod: {
        BRVIX: {
          totalVehicles: 6,
          distinctContainerCount: 2,
          brandSummary: 'Toyota: 5 | BYD: 1',
          vehicleByContainerTypeSummary: '40HC: 5 | Nao informado: 1',
        },
      },
      unassigned: {
        totalVehicles: 4,
        distinctContainerCount: 1,
        brandSummary: 'Nao informado: 4',
        vehicleByContainerTypeSummary: '20GP: 4',
      },
    })
    expect(stats[20]).toEqual({
      totalVehicles: 0,
      distinctContainerCount: 0,
      containerNumbers: [],
      brandSummary: '-',
      vehicleByContainerTypeSummary: '-',
      byPod: {},
      unassigned: undefined,
    })
  })

  it('pede todas as viagens numa chamada, com os ids no corpo', async () => {
    rpcMock.mockResolvedValueOnce({ data: { groups: [[7, 'BRSSZ', 'BYD', '40HC', 2]], containers: [] }, error: null })

    const result = await fetchVoyageVehicleStats([7, 8])

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('operational_voyage_vehicle_stats', { p_voyage_ids: [7, 8] })
    expect(result.byVoyageId[7].byPod.BRSSZ.totalVehicles).toBe(2)
    expect(result.byVoyageId[8].totalVehicles).toBe(0)
  })
})
