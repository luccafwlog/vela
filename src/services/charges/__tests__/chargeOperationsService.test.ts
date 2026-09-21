import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => from(table),
    rpc: (name: string, args: unknown) => rpc(name, args),
  },
}))

function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'range', 'eq', 'neq', 'or', 'ilike', 'in', 'limit', 'overrideTypes']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

describe('listLocalChargeOperationalRows', () => {
  beforeEach(() => {
    from.mockReset()
    rpc.mockReset()
  })

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

describe('calculateLocalChargesBatch', () => {
  beforeEach(() => {
    from.mockReset()
    rpc.mockReset()
  })

  it('rejeita lote vazio sem chamar rpc', async () => {
    const { calculateLocalChargesBatch } = await import('../chargeOperationsService')
    const result = await calculateLocalChargesBatch([])
    expect(result).toEqual({ total: 0, successCount: 0, errorCount: 0, errors: [] })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('bloqueia B/Ls já faturados antes de chamar a RPC', async () => {
    const { calculateLocalChargesBatch } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({
      data: [{ id: 'BL-PAID', financial_status: 'paid' }],
      error: null,
    }))

    const result = await calculateLocalChargesBatch(['BL-PAID'])
    expect(result.total).toBe(1)
    expect(result.successCount).toBe(0)
    expect(result.errorCount).toBe(1)
    expect(result.errors[0].message).toContain('ja foi faturado')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('chama calculate_bl_local_charges_batch via supabase.rpc com sucesso', async () => {
    const { calculateLocalChargesBatch } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({
      data: [{ id: 'BL-OK', financial_status: 'pending' }],
      error: null,
    }))
    rpc.mockResolvedValue({
      data: {
        total: 1,
        success_count: 1,
        error_count: 0,
        errors: [],
      },
      error: null,
    })

    const result = await calculateLocalChargesBatch(['BL-OK'])
    expect(rpc).toHaveBeenCalledWith('calculate_bl_local_charges_batch', {
      p_bl_ids: ['BL-OK'],
      p_recalculate: true,
    })
    expect(result.successCount).toBe(1)
    expect(result.errorCount).toBe(0)
  })

  it('separa a RPC em chunks para preservar progresso parcial do lote', async () => {
    const { calculateLocalChargesBatch } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({ data: [], error: null }))
    rpc.mockImplementation((_name: string, args: { p_bl_ids: string[] }) => Promise.resolve({
      data: { success_count: args.p_bl_ids.length, error_count: 0, errors: [] },
      error: null,
    }))
    const ids = Array.from({ length: 101 }, (_, index) => `BL-${index + 1}`)

    const result = await calculateLocalChargesBatch(ids)

    expect(rpc.mock.calls.filter(([name]) => name === 'calculate_bl_local_charges_batch')).toHaveLength(2)
    expect(rpc.mock.calls[0]?.[1].p_bl_ids).toHaveLength(100)
    expect(rpc.mock.calls[1]?.[1].p_bl_ids).toEqual(['BL-101'])
    expect(result).toMatchObject({ total: 101, successCount: 101, errorCount: 0 })
  })

  it('executa fallback sequencial caso a RPC batch retorne erro', async () => {
    const { calculateLocalChargesBatch } = await import('../chargeOperationsService')
    from.mockImplementation(() => builder({
      data: [{ id: 'BL-FALLBACK', financial_status: 'pending' }],
      error: null,
    }))
    rpc.mockImplementation((name: string) => {
      if (name === 'calculate_bl_local_charges_batch') {
        return Promise.resolve({ data: null, error: { message: 'function not found' } })
      }
      if (name === 'calculate_bl_local_charges') {
        return Promise.resolve({ data: { status: 'calculated' }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const result = await calculateLocalChargesBatch(['BL-FALLBACK'])
    expect(rpc).toHaveBeenCalledWith('calculate_bl_local_charges_batch', expect.anything())
    expect(rpc).toHaveBeenCalledWith('calculate_bl_local_charges', {
      p_bl_id: 'BL-FALLBACK',
      p_recalculate: true,
    })
    expect(result.successCount).toBe(1)
  })
})
