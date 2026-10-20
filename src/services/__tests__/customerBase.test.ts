import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compareCustomerBaseWithExisting, customerNameChanges, importCustomerBaseRows, MAX_CUSTOMER_BASE_ROWS, parseCustomerBaseRows, sameName, type CustomerBaseRow } from '../customerBase'
import { userFacingErrorMessage } from '../../lib/errors'

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

  it('grava a base inteira numa chamada só (migration 334)', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, imported: 1, updated: 1, contacts_created: 3, bls_linked: 2 }, error: null })
    const base = { trade_name: null, address: null, city: null, state: 'SP', zip: null }

    const result = await importCustomerBaseRows([
      { ...base, cnpj_cpf: '12345678000195', name: 'Empresa Teste', emails: ['contato1@empresa.com', 'contato2@empresa.com'] },
      { ...base, cnpj_cpf: '11222333000181', name: 'Outra', emails: ['outra@empresa.com'], existingCustomerId: 9 },
    ], { changedBy: 'actor-1' })

    expect(result).toEqual({ ok: true, imported: 1, updated: 1, contactsCreated: 3, blsLinked: 2, errors: [] })
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('apply_customer_base_batch_atomic', {
      p_rows: [
        expect.objectContaining({ cnpj: '12345678000195', name: 'Empresa Teste', emails: ['contato1@empresa.com', 'contato2@empresa.com'], state: 'SP', confirm_name_change: false }),
        expect.objectContaining({ cnpj: '11222333000181', confirm_name_change: false, expected_current_name: null }),
      ],
      p_changed_by: 'actor-1',
    })
  })

  it('recusa do banco em um Cliente: nada gravado, recusa listada', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, errors: [{ cnpj: '11222333000181', code: '22023', message: 'E-mail invalido para o cliente 11222333000181: x' }] },
      error: null,
    })
    const base = { trade_name: null, address: null, city: null, state: null, zip: null }

    const result = await importCustomerBaseRows([
      { ...base, cnpj_cpf: '12345678000195', name: 'Empresa Teste', emails: ['a@b.com'] },
      { ...base, cnpj_cpf: '11222333000181', name: 'Outra', emails: ['x'] },
    ], { changedBy: 'actor-1' })

    expect(result.ok).toBe(false)
    expect(result.imported).toBe(0)
    expect(result.errors).toEqual([{ cnpj_cpf: '11222333000181', message: 'E-mail invalido para o cliente 11222333000181: x' }])
  })
})

describe('aceite da troca de razão social (revisão da PR 929)', () => {
  beforeEach(() => mockRpc.mockReset())

  it('vale só para o Cliente cuja troca apareceu na prévia, com o nome de antes que ela mostrou', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, updated: 2 }, error: null })
    const base = { name: 'Nova', trade_name: null, emails: ['a@b.com'], address: null, city: null, state: null, zip: null }

    await importCustomerBaseRows([
      { ...base, cnpj_cpf: '11111111000111', existingCustomerId: 1, currentName: 'Antiga' },
      { ...base, cnpj_cpf: '22222222000122', existingCustomerId: 2, currentName: null },
      { ...base, cnpj_cpf: '33333333000133' },
    ], { changedBy: 'actor-1', confirmNameChange: true })

    // O banco confere `expected_current_name` com o Cliente travado: se outra
    // sessão o renomeou depois da prévia, a base inteira é recusada.
    const rows = (mockRpc.mock.calls[0][1] as { p_rows: Array<{ cnpj: string; confirm_name_change: boolean; expected_current_name: string | null }> }).p_rows
    expect(rows.map((row) => [row.cnpj, row.confirm_name_change, row.expected_current_name])).toEqual([
      ['11111111000111', true, 'Antiga'],
      ['22222222000122', false, null],
      ['33333333000133', false, null],
    ])
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

  // Mesma regra do banco (migration 192, `[^[:alnum:]]+` em glibc UTF-8),
  // conferida contra o PG local em 20/10/2026: se a prévia não pede o aceite
  // e o banco pede, a base inteira é recusada sem oferecer o aceite.
  it('compara a razão social como o banco: º/ª são letras, ¹/NBSP/tab são separadores', () => {
    expect(sameName('ACME 1º LTDA', 'ACME 1 LTDA')).toBe(false)
    expect(sameName('ACME 1ª LTDA', 'ACME 1 LTDA')).toBe(false)
    expect(sameName('Ação Comércio Ltda.', 'AÇÃO  COMÉRCIO LTDA')).toBe(true)
    expect(sameName('ÿ ltda', 'LTDA')).toBe(false)
    expect(sameName('Œuvre SA', 'UVRE SA')).toBe(false)
    expect(sameName('FOO\u00a0BAR', 'foo bar')).toBe(true)
    expect(sameName('FOO\tBAR', 'FOO-BAR')).toBe(true)
    expect(sameName('X¹ ltda', 'X LTDA')).toBe(true)
    // `upper` do banco é letra a letra: ß não vira SS.
    expect(sameName('ß gmbh', 'SS GMBH')).toBe(false)
  })
})

describe('troca de razão social conferida com o nome gravado (migration 334)', () => {
  beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset() })

  it('manda o nome exatamente como o banco o devolveu, sem trim', async () => {
    const cnpj = '12345678000195'
    mockFrom.mockImplementation((table: string) => fakeQuery(table === 'customers'
      ? [{ id: 5, cnpj_cpf: cnpj, name: 'Antiga Ltda\u00a0', trade_name: null, address: null, city: null, state: null, zip: null }]
      : []))
    const row: CustomerBaseRow = { cnpj_cpf: cnpj, name: 'Nova Ltda', trade_name: null, emails: ['a@b.co'], address: null, city: null, state: null, zip: null }
    const { rows } = await compareCustomerBaseWithExisting({ rows: [row], rowErrors: [] })
    expect(rows[0]).toMatchObject({ currentName: 'Antiga Ltda', storedName: 'Antiga Ltda\u00a0' })

    mockRpc.mockResolvedValue({ data: { ok: true, updated: 1 }, error: null })
    await importCustomerBaseRows(rows, { changedBy: 'actor-1', confirmNameChange: true })
    const sent = (mockRpc.mock.calls[0][1] as { p_rows: Array<{ expected_current_name: string | null }> }).p_rows
    expect(sent[0].expected_current_name).toBe('Antiga Ltda\u00a0')
  })
})

describe('tamanho da base (migration 334: 60 s, teto de Clientes)', () => {
  const base = { trade_name: null, address: null, city: null, state: null, zip: null, emails: ['a@b.co'], name: 'Cliente' }
  beforeEach(() => mockRpc.mockReset())

  it('tempo esgotado no banco (57014): nada gravado e a pessoa divide o arquivo', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
    const failure = await importCustomerBaseRows([{ ...base, cnpj_cpf: '12345678000195' }], { changedBy: 'actor-1' }).catch((error: unknown) => error)
    // A tela mostra "Nada foi gravado: <mensagem>" com userFacingErrorMessage.
    expect(userFacingErrorMessage(failure, 'genérico')).toBe(
      'o arquivo é grande demais para gravar de uma vez. Divida os Clientes em arquivos menores e importe cada um.',
    )
  })

  it('base acima do teto é recusada antes de chamar o banco', async () => {
    const rows = Array.from({ length: MAX_CUSTOMER_BASE_ROWS + 1 }, (_, index) => ({ ...base, cnpj_cpf: String(index).padStart(14, '0') }))
    const failure = await importCustomerBaseRows(rows, { changedBy: 'actor-1' }).catch((error: unknown) => error)
    expect(userFacingErrorMessage(failure, 'genérico')).toMatch(/limite é 3000 por arquivo/)
    expect(mockRpc).not.toHaveBeenCalled()
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
