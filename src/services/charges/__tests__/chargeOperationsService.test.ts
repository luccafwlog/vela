import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
vi.mock('../../supabase', () => ({ supabase: { from: (table: string) => from(table) } }))

function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'range', 'eq', 'neq', 'or', 'ilike', 'in', 'limit', 'overrideTypes']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

describe('listLocalChargeOperationalRows', () => {
  beforeEach(() => from.mockReset())

  it('nao consulta B/Ls quando o filtro pede so granito', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: [], error: null }))
    await listLocalChargeOperationalRows({ cargoMode: 'granito' })
    expect(from.mock.calls.map(([table]) => table)).not.toContain('bls')
  })

  it('nao consulta granito quando o filtro pede so container', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: [], error: null }))
    await listLocalChargeOperationalRows({ cargoMode: 'container' })
    expect(from.mock.calls.map(([table]) => table)).not.toContain('granite_bls')
  })

  it('consulta B/Ls e nao consulta granito quando o filtro pede misto', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: [], error: null }))
    await listLocalChargeOperationalRows({ cargoMode: 'misto' })
    expect(from.mock.calls.map(([table]) => table)).toContain('bls')
    expect(from.mock.calls.map(([table]) => table)).not.toContain('granite_bls')
  })

  it('propaga o erro do banco em vez de devolver lista vazia', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: null, error: { code: '42501', message: 'permission denied' } }))
    await expect(listLocalChargeOperationalRows({ cargoMode: 'container' })).rejects.toMatchObject({ code: '42501' })
  })

  it('para de paginar quando a pagina volta incompleta', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation((table: string) => builder(table === 'bls' ? { data: [{ id: 'BL1' }], error: null } : { data: [], error: null }))
    await listLocalChargeOperationalRows({ cargoMode: 'container', limit: 5000 })
    expect(from.mock.calls.filter(([table]) => table === 'bls')).toHaveLength(1)
  })

  it('limita o limite recebido a faixa suportada', async () => {
    const { listLocalChargeOperationalRows } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: [], error: null }))
    await expect(listLocalChargeOperationalRows({ cargoMode: 'container', limit: 999999 })).resolves.toEqual([])
    await expect(listLocalChargeOperationalRows({ cargoMode: 'container', limit: -1 })).resolves.toEqual([])
  })
})
