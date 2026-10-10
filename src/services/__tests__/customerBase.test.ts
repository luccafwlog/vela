import { beforeEach, describe, expect, it, vi } from 'vitest'
import { customerNameChanges, importCustomerBaseRows, parseCustomerBaseRows, sameName, type CustomerBaseRow } from '../customerBase'

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
