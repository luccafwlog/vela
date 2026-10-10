import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table !== 'bl_containers') return {}
      return {
        select: () => ({
          eq: () => ({
            single: () => ({
              overrideTypes: () => Promise.resolve({ data: { discharge_date: '2026-01-01' }, error: null }),
            }),
          }),
        }),
      }
    },
  },
}))

vi.mock('../demurrageRates', () => ({ ensureDemurrageRatesLoaded: vi.fn().mockResolvedValue(undefined) }))

import { updateContainerDates, updateContainerReturnDate } from '../demurrageContainers'

// Datas do container vão pela RPC set_container_dates (migration 178): o banco
// propaga ao B/L irmão, reconcilia a Invoice de Demurrage e grava o Histórico.
describe('datas do container pela RPC set_container_dates', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.rpc.mockResolvedValue({ data: {}, error: null })
  })

  it('a devolução mantém a descarga gravada', async () => {
    await updateContainerReturnDate(7, '2026-02-20')
    expect(mocks.rpc).toHaveBeenCalledWith('set_container_dates', {
      p_container_id: 7, p_discharge_date: '2026-01-01', p_return_date: '2026-02-20', p_reason: null,
    })
  })

  it('remover a devolução leva o motivo', async () => {
    await updateContainerReturnDate(7, null, '  Devolução lançada no container errado  ')
    expect(mocks.rpc).toHaveBeenCalledWith('set_container_dates', {
      p_container_id: 7, p_discharge_date: '2026-01-01', p_return_date: null, p_reason: 'Devolução lançada no container errado',
    })
  })

  it('a recusa do banco chega a quem chamou', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Informe o motivo para remover a data.' } })
    await expect(updateContainerDates(7, '2026-01-01', null)).rejects.toMatchObject({ message: 'Informe o motivo para remover a data.' })
  })
})
