import { describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../../supabase', () => ({ supabase: { rpc: (name: string, args: unknown) => rpc(name, args) } }))

import { listChargeTablesInUse } from '../chargeTableService'

describe('listChargeTablesInUse', () => {
  it('com mais de 500 tabelas, consulta em lotes que a RPC aceita e junta o resultado', async () => {
    rpc.mockImplementation(async (_name: string, args: { p_table_ids: number[] }) => {
      if (args.p_table_ids.length > 500) return { data: null, error: { code: '22023', message: 'Tabelas demais numa consulta: peça até 500.' } }
      return { data: args.p_table_ids.filter((id) => id % 400 === 0), error: null }
    })
    const ids = Array.from({ length: 1201 }, (_, index) => index + 1)
    expect([...(await listChargeTablesInUse(ids))].sort((a, b) => a - b)).toEqual([400, 800, 1200])
    expect(rpc.mock.calls.map(([, args]) => (args as { p_table_ids: number[] }).p_table_ids.length)).toEqual([500, 500, 201])
  })
})
