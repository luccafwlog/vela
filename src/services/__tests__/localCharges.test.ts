import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addManualBlCharge,
  calculateLocalChargesBatch,
  calculateBlLocalCharges,
  listBlLocalChargeLines,
  listManualChargeItemsForBl,
  listLocalChargePendencies,
  listLocalChargeOperationalRows,
  markBlReadyForBilling,
} from '../charges/chargeOperationsService'
import { listLocalChargeTables } from '../charges/chargeTableService'

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

function createBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    overrideTypes: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

describe('localCharges service', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockFrom.mockReset()
    // calculateBlLocalCharges consulta bls.financial_status antes da RPC (etapa 2
    // do plano de faturamento); default nao-faturado para nao quebrar os demais
    // testes que nao exercitam esse caminho especificamente.
    mockFrom.mockImplementation(() => createBuilder({ data: { financial_status: 'pending' }, error: null }))
  })

  it('normaliza retorno do calculate_bl_local_charges', async () => {
    mockRpc.mockResolvedValue({
      data: {
        bl_id: 'CSC001',
        status: 'calculated',
        table_id: 12,
        line_count: 5,
        total_brl: '4512.34',
        total_usd: '0',
        review_required: false,
        exempt: false,
        reason: '',
      },
      error: null,
    })

    const result = await calculateBlLocalCharges('CSC001', { actorId: 'user-id', recalculate: true })

    expect(result).toEqual({
      bl_id: 'CSC001',
      status: 'calculated',
      table_id: 12,
      line_count: 5,
      total_brl: 4512.34,
      total_usd: 0,
      review_required: false,
      exempt: false,
      reason: '',
    })
    expect(mockRpc).toHaveBeenCalledWith('calculate_bl_local_charges', {
      p_bl_id: 'CSC001',
      p_actor: 'user-id',
      p_recalculate: true,
    })
  })

  it('recusa recalcular B/L ja faturado sem sequer chamar a RPC', async () => {
    mockFrom.mockImplementation(() => createBuilder({ data: { financial_status: 'invoiced' }, error: null }))

    await expect(calculateBlLocalCharges('CSC001', { actorId: 'user-id' })).rejects.toThrow('ja foi faturado')
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('recalcula o lote via calculate_bl_local_charges_batch em chamada unica', async () => {
    mockFrom.mockImplementation(() =>
      createBuilder({
        data: [
          { id: 'BL1', financial_status: 'pending' },
          { id: 'BL2', financial_status: 'pending' },
          { id: 'BL3', financial_status: 'pending' },
        ],
        error: null,
      }),
    )
    mockRpc.mockImplementation((name) => {
      if (name === 'calculate_bl_local_charges_batch') {
        return Promise.resolve({
          data: {
            total: 3,
            success_count: 2,
            error_count: 1,
            errors: [{ bl_id: 'BL2', message: 'tabela ausente' }],
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: new Error('unexpected') })
    })

    const result = await calculateLocalChargesBatch([' bl1 ', 'BL2', 'BL3', 'BL1'], {
      actorId: 'user-1',
      recalculate: true,
    })

    expect(result).toEqual({
      total: 3,
      successCount: 2,
      errorCount: 1,
      errors: [{ blId: 'BL2', message: 'tabela ausente' }],
    })
    expect(mockRpc).toHaveBeenCalledWith('calculate_bl_local_charges_batch', {
      p_bl_ids: ['BL1', 'BL2', 'BL3'],
      p_actor: 'user-1',
      p_recalculate: true,
    })
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('faz fallback para runBatch sequencial se calculate_bl_local_charges_batch falhar', async () => {
    mockFrom.mockImplementation(() =>
      createBuilder({
        data: [
          { id: 'BL1', financial_status: 'pending' },
          { id: 'BL2', financial_status: 'pending' },
          { id: 'BL3', financial_status: 'pending' },
        ],
        error: null,
      }),
    )
    mockRpc.mockImplementation((name, args) => {
      if (name === 'calculate_bl_local_charges_batch') {
        return Promise.resolve({ data: null, error: new Error('RPC not found') })
      }
      if (name === 'calculate_bl_local_charges') {
        const id = args && typeof args === 'object' && 'p_bl_id' in args ? args.p_bl_id : ''
        if (id === 'BL2') return Promise.resolve({ data: null, error: new Error('tabela ausente') })
        return Promise.resolve({ data: { bl_id: id, status: 'calculated' }, error: null })
      }
      return Promise.resolve({ data: null, error: new Error('unexpected') })
    })

    const result = await calculateLocalChargesBatch([' bl1 ', 'BL2', 'BL3', 'BL1'], {
      actorId: 'user-1',
      recalculate: true,
    })

    expect(result).toEqual({
      total: 3,
      successCount: 2,
      errorCount: 1,
      errors: [{ blId: 'BL2', message: 'tabela ausente' }],
    })
    expect(mockRpc).toHaveBeenCalledTimes(4)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('retorna linhas de taxa via list_bl_local_charge_lines', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 1,
          bl_id: 'CSC001',
          charge_name: 'THD',
          source: 'auto',
          status: 'calculated',
          quantity: 2,
          currency: 'BRL',
          unit_value_brl: 1420,
          total_value_brl: 2840,
        },
      ],
      error: null,
    })

    const rows = await listBlLocalChargeLines('CSC001')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.charge_name).toBe('THD')
    expect(mockRpc).toHaveBeenCalledWith('list_bl_local_charge_lines', {
      p_bl_id: 'CSC001',
    })
  })

  it('retorna itens manuais elegiveis via list_manual_charge_items_for_bl', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          charge_item_id: 10,
          charge_item_name: 'B/L Reissuing',
          currency: 'BRL',
          effective_unit_value_brl: 600,
        },
      ],
      error: null,
    })

    const rows = await listManualChargeItemsForBl('CSC001')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.charge_item_name).toBe('B/L Reissuing')
    expect(mockRpc).toHaveBeenCalledWith('list_manual_charge_items_for_bl', {
      p_bl_id: 'CSC001',
    })
  })

  it('adiciona linha manual no B/L via add_manual_bl_charge', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 99, bl_id: 'CSC001', status: 'reviewed' },
      error: null,
    })

    const payload = await addManualBlCharge('CSC001', {
      chargeItemId: 12,
      quantity: 2,
      notes: 'Teste',
      actorId: 'user-id',
    })

    expect((payload as { id: number }).id).toBe(99)
    expect(mockRpc).toHaveBeenCalledWith('add_manual_bl_charge', {
      p_bl_id: 'CSC001',
      p_charge_item_id: 12,
      p_quantity: 2,
      p_notes: 'Teste',
      p_actor: 'user-id',
    })
  })

  it('lista tabelas de taxas com itens ordenados', async () => {
    const tableBuilder = createBuilder({
      data: [
        {
          id: 1,
          name: 'Tabela CNTR BRVIT',
          charge_table_items: [
            { id: 20, name: 'ISPS', sort_order: 20 },
            { id: 10, name: 'THD', sort_order: 10 },
          ],
        },
      ],
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'charge_tables') {
        return {
          select: vi.fn(() => tableBuilder),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const rows = await listLocalChargeTables({ cargoMode: 'container', pod: 'BRVIT' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.charge_table_items[0]?.name).toBe('THD')
  })

  it('lista pendencias de taxas locais', async () => {
    const pendencyBuilder = createBuilder({
      data: [{ id: 'BL1', charge_status: 'review_required' }],
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return {
          select: vi.fn(() => pendencyBuilder),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const rows = await listLocalChargePendencies(50)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('BL1')
  })

  it('pagina a fila operacional para nao ocultar B/Ls acima de 1000 registros', async () => {
    const rangeCalls: Array<[number, number]> = []
    const operationalRows = Array.from({ length: 1005 }, (_, index) => ({
      id: `BL${String(index + 1).padStart(4, '0')}`,
      cargo_mode: 'container',
      charge_status: 'ready_for_billing',
      created_at: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      customer_reconciliation_status: 'reconciled',
      customer_reconciliation_notes: null,
      billing_hold_reason: null,
      last_billing_run_id: null,
      charge_exemption_reason: null,
      charges_calculated_at: null,
      charges_reviewed_at: null,
      pol: 'CNTAC',
      pod: 'BRVIX',
      voyage: null,
      customer: null,
    }))

    function pagedBuilder(rows: unknown[]) {
      let selectedRange: [number, number] = [0, rows.length - 1]
      const builder = {
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: vi.fn(() => builder),
        ilike: vi.fn(() => builder),
        or: vi.fn(() => builder),
        overrideTypes: vi.fn(() => builder),
        range: vi.fn((from: number, to: number) => {
          rangeCalls.push([from, to])
          selectedRange = [from, to]
          return builder
        }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows.slice(selectedRange[0], selectedRange[1] + 1), error: null }).then(resolve, reject),
      }
      return builder
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return { select: vi.fn(() => pagedBuilder(operationalRows)) }
      }
      if (table === 'charge_calculations') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        }
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'granite_bls') {
        return {
          select: vi.fn(() => ({
            neq: vi.fn(() => ({
              order: vi.fn(() => ({
                range: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          })),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const rows = await listLocalChargeOperationalRows({ cargoMode: 'container', limit: 1005 })

    expect(rows).toHaveLength(1005)
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1004],
    ])
  })

  it('marca B/L como ready_for_billing via RPC dedicada', async () => {
    mockRpc.mockResolvedValue({
      data: { bl_id: 'CSC001', status: 'ready_for_billing', changed: true },
      error: null,
    })

    const result = (await markBlReadyForBilling('CSC001', 'user-id')) as {
      status: string
      changed: boolean
    }

    expect(result.status).toBe('ready_for_billing')
    expect(result.changed).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('mark_bl_ready_for_billing', {
      p_bl_id: 'CSC001',
      p_actor: 'user-id',
    })
  })
})
