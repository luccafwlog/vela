import { beforeEach, expect, it, vi } from 'vitest'
import { fetchAuditLogs, fetchSystemMetrics } from '../adminObservability'

const { fromMock, supabaseMock } = vi.hoisted(() => {
  const supabaseMock = { from: vi.fn() }
  return { fromMock: supabaseMock.from, supabaseMock }
})
vi.mock('../supabase', () => ({ supabase: supabaseMock }))

function builder(result: { data: unknown; error: unknown; count?: number | null }) {
  const value = {
    select: vi.fn(() => value),
    order: vi.fn(() => value),
    limit: vi.fn(() => value),
    range: vi.fn(() => value),
    eq: vi.fn(() => value),
    gte: vi.fn(() => value),
    lte: vi.fn(() => value),
    in: vi.fn(() => value),
    is: vi.fn(() => value),
    not: vi.fn(() => value),
    then: (resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return value
}

beforeEach(() => {
  fromMock.mockReset()
})

it('propaga falha de qualquer leitura das metricas', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyages') return builder({ data: [], error: null })
    if (table === 'invoices') return builder({ data: null, error: new Error('invoices unavailable') })
    throw new Error(`Tabela inesperada: ${table}`)
  })

  await expect(fetchSystemMetrics()).rejects.toThrow('invoices unavailable')
})

it('propaga falha ao resolver nomes dos autores do log', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'audit_logs') {
      return builder({
        data: [{
          id: 1,
          entity_type: 'bl',
          entity_id: 'BL-1',
          field_name: 'pod',
          old_value: 'A',
          new_value: 'B',
          changed_by: 'user-1',
          changed_at: '2026-06-23',
          justification: null,
        }],
        error: null,
        count: 1,
      })
    }
    if (table === 'user_profiles') return builder({ data: null, error: new Error('profiles unavailable') })
    throw new Error(`Tabela inesperada: ${table}`)
  })

  await expect(fetchAuditLogs({
    entityTypes: [],
    changedBy: '',
    dateFrom: '',
    dateTo: '',
    page: 0,
  })).rejects.toThrow('profiles unavailable')
})

it('mantém o cliente Supabase ligado ao builder de falhas de roteamento', async () => {
  const result = builder({
    data: [{
      id: 7,
      alert_id: 11,
      alert_item_id: 12,
      event_id: 13,
      item_type: 'invoice_overdue',
      department: 'documentacao',
      reason: 'sem destinatário',
      created_at: '2026-08-22T10:00:00Z',
      alert: { entity_type: 'invoice', entity_id: 'INV-7' },
    }],
    error: null,
    count: 1,
  })

  fromMock.mockImplementation(function (this: unknown, table: string) {
    expect(this).toBe(supabaseMock)
    expect(table).toBe('alert_notification_failures')
    return result
  })

  const response = await (await import('../adminObservability')).fetchRoutingFailures()

  expect(response).toEqual({
    count: 1,
    rows: [expect.objectContaining({ id: 7, entity_type: 'invoice', entity_id: 'INV-7' })],
  })
})

it('Última fatura emitida lê a data de emissão, não a criação (achado A4)', async () => {
  const invoices = builder({ data: [{ issued_at: '2026-10-19T21:03:00Z' }], error: null })
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyages') return builder({ data: [{ created_at: '2026-10-18T10:00:00Z' }], error: null })
    if (table === 'invoices') return invoices
    throw new Error(`Tabela inesperada: ${table}`)
  })

  await expect(fetchSystemMetrics()).resolves.toEqual({
    lastVoyageCreatedAt: '2026-10-18T10:00:00Z',
    lastInvoiceIssuedAt: '2026-10-19T21:03:00Z',
  })
  expect(invoices.select).toHaveBeenCalledWith('issued_at')
  expect(invoices.order).toHaveBeenCalledWith('issued_at', { ascending: false })
})

it('filtra o histórico pelo assunto, por "Sistema" e pelo dia de Brasília', async () => {
  const logs = builder({ data: [], error: null, count: 0 })
  fromMock.mockImplementation(() => logs)

  await fetchAuditLogs({ entityTypes: ['granite_rates'], changedBy: 'sistema', dateFrom: '2026-10-12', dateTo: '2026-10-19', page: 1 })

  expect(logs.in).toHaveBeenCalledWith('entity_type', ['granite_rates'])
  expect(logs.is).toHaveBeenCalledWith('changed_by', null)
  expect(logs.eq).not.toHaveBeenCalled()
  expect(logs.gte).toHaveBeenCalledWith('changed_at', '2026-10-12T00:00:00-03:00')
  expect(logs.lte).toHaveBeenCalledWith('changed_at', '2026-10-19T23:59:59.999-03:00')
  expect(logs.range).toHaveBeenCalledWith(50, 99)
})

it('autor sem perfil aparece por extenso, nunca pelo número interno', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'audit_logs') {
      return builder({
        data: [
          { id: 1, entity_type: 'bl', entity_id: 'BL-1', field_name: 'pod', old_value: 'A', new_value: 'B', changed_by: 'uuid-sumido', changed_at: '2026-06-23T10:00:00Z', justification: null },
          { id: 2, entity_type: 'bl', entity_id: 'BL-1', field_name: 'pod', old_value: 'B', new_value: 'C', changed_by: null, changed_at: '2026-06-23T11:00:00Z', justification: null },
        ],
        error: null,
        count: 2,
      })
    }
    if (table === 'user_profiles') return builder({ data: [], error: null })
    throw new Error(`Tabela inesperada: ${table}`)
  })

  const { rows } = await fetchAuditLogs({ entityTypes: [], changedBy: '', dateFrom: '', dateTo: '', page: 0 })
  expect(rows.map((row) => row.changer_name)).toEqual(['Pessoa sem cadastro', null])
})
