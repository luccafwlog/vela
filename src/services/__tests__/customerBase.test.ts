import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compareCustomerBaseWithExisting, customerNameChanges, importCustomerBaseRows, parseCustomerBaseRows, sameName, type CustomerBaseRow } from '../customerBase'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

describe('customerBase import', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('reports row error when a row has no valid email', () => {
    const result = parseCustomerBaseRows([
      {
        CNPJ: '12.345.678/0001-95',
        'Razao Social': 'Empresa Sem Email',
        email: '',
      },
      {
        CNPJ: '12.345.678/0001-95',
        'Razao Social': 'Empresa Com Email',
        email: 'contato@empresa.com',
      },
    ])

    expect(result.rowErrors).toEqual([
      expect.objectContaining({
        row: 2,
        message: 'Linha sem e-mail válido.',
      }),
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].cnpj_cpf).toBe('12345678000195')
  })

  it('imports customer base and ensures contact email via RPC for each email', async () => {
    mockRpc.mockResolvedValue({ data: { created: true, contacts_created: 2, bls_linked: 0 }, error: null })

    const result = await importCustomerBaseRows([
      {
        cnpj_cpf: '12345678000195',
        name: 'Empresa Teste',
        trade_name: null,
        emails: ['contato1@empresa.com', 'contato2@empresa.com'],
        address: null,
        city: null,
        state: 'SP',
        zip: null,
      },
    ], { changedBy: 'actor-1' })

    expect(result.imported).toBe(1)
    expect(result.contactsCreated).toBe(2)
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('apply_customer_base_row_atomic', {
      p_cnpj: '12345678000195',
      p_name: 'Empresa Teste',
      p_trade_name: null,
      p_address: null,
      p_city: null,
      p_state: 'SP',
      p_zip: null,
      p_emails: ['contato1@empresa.com', 'contato2@empresa.com'],
      p_changed_by: 'actor-1',
      p_confirm_name_change: false,
    })
  })
})

describe('razão social na Base de Clientes (ADR 0078, item 24)', () => {
  it('compara sem caixa e pontuação e lista só os Clientes que trocam de razão social', () => {
    expect(sameName('Importadora Ltda.', 'IMPORTADORA  LTDA')).toBe(true)
    expect(sameName('Importadora Ltda', 'Outra SA')).toBe(false)
    const base = { cnpj_cpf: '1', name: 'Nova', trade_name: null, emails: [], address: null, city: null, state: null, zip: null }
    const rows: CustomerBaseRow[] = [
      { ...base, existingCustomerId: 1, currentName: 'Antiga' },
      { ...base, existingCustomerId: 2, currentName: null },
      { ...base },
    ]
    expect(customerNameChanges(rows).map((row) => row.existingCustomerId)).toEqual([1])
  })
})

// Consulta falsa do PostgREST: aplica os filtros pedidos (inclusive o do
// recurso embutido, `voyage.status`) sobre as linhas da fixture.
function fakeQuery(rows: Array<Record<string, unknown>>) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = []
  const read = (row: Record<string, unknown>, path: string) =>
    path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | null)?.[key], row)
  const builder = {
    select: () => builder,
    in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(read(row, column))); return builder },
    is: (column: string, value: unknown) => { filters.push((row) => read(row, column) === value); return builder },
    neq: (column: string, value: unknown) => { filters.push((row) => read(row, column) !== value); return builder },
    then: (resolve: (result: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows.filter((row) => filters.every((filter) => filter(row))), error: null }),
  }
  return builder
}

describe('prévia do vínculo da Base de Clientes (migration 192)', () => {
  it('não oferece B/L de Viagem cancelada para vínculo', async () => {
    const cnpj = '12345678000195'
    const bls = [
      { id: 'BL-ATIVA', manifest_customer_cnpj_cpf: cnpj, customer_reconciliation_status: 'missing_customer', customer_id: null, cancelled_at: null, voyage: { status: 'active' } },
      { id: 'BL-VIAGEM-CANCELADA', manifest_customer_cnpj_cpf: cnpj, customer_reconciliation_status: 'missing_customer', customer_id: null, cancelled_at: null, voyage: { status: 'cancelled' } },
      { id: 'BL-REJEITADO', manifest_customer_cnpj_cpf: cnpj, customer_reconciliation_status: 'rejected', customer_id: null, cancelled_at: null, voyage: { status: 'active' } },
    ]
    mockFrom.mockImplementation((table: string) => fakeQuery(table === 'bls' ? bls : []))
    const row: CustomerBaseRow = { cnpj_cpf: cnpj, name: 'Empresa', trade_name: null, emails: ['a@b.co'], address: null, city: null, state: null, zip: null }

    const { rows } = await compareCustomerBaseWithExisting({ rows: [row], rowErrors: [] })

    expect(rows[0]).toMatchObject({ pendingBlIds: ['BL-ATIVA'], rejectedBlIds: ['BL-REJEITADO'] })
  })
})
