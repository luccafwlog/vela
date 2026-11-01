import { beforeEach, expect, it, vi } from 'vitest'
import { fetchActionHistory, fetchSystemMetrics, routingFailureReasonLabel } from '../adminObservability'

const { fromMock, rpcMock, supabaseMock } = vi.hoisted(() => {
  const supabaseMock = { from: vi.fn(), rpc: vi.fn() }
  return { fromMock: supabaseMock.from, rpcMock: supabaseMock.rpc, supabaseMock }
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
  rpcMock.mockReset()
})

it('motivo da falha de entrega de alerta nunca mostra o texto técnico gravado', () => {
  expect(routingFailureReasonLabel('Nenhum destinatário ativo no fallback Administrativo.'))
    .toBe('Ninguém ativo no setor do alerta nem no Administrativo.')
  expect(routingFailureReasonLabel('Nenhum destinatário ativo na audiência do item.'))
    .toBe('Ninguém ativo no setor do alerta.')
  for (const raw of ['Nenhum usuário ativo com papel documentacao encontrado', 'no_active_recipient', 'ERROR: 42501']) {
    expect(routingFailureReasonLabel(raw)).toBe('Ninguém ativo no setor do alerta.')
  }
})

it('propaga falha de qualquer leitura das metricas', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyages') return builder({ data: [], error: null })
    if (table === 'invoices') return builder({ data: null, error: new Error('invoices unavailable') })
    throw new Error(`Tabela inesperada: ${table}`)
  })

  await expect(fetchSystemMetrics()).rejects.toThrow('invoices unavailable')
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

it('Histórico de ações com nomes: filtros vão para a RPC e o total vem da busca (558)', async () => {
  rpcMock.mockResolvedValue({
    data: [{
      id: 9,
      changed_at: '2026-10-30T13:00:00Z',
      entity_type: 'voyages',
      field_name: 'vessel_id',
      old_value: '7',
      new_value: '8',
      justification: null,
      action: 'alterou',
      actor_kind: 'equipe',
      actor_name: 'Ana',
      actor_email: 'ana@example.test',
      actor_department: 'operacoes',
      entity_label: 'Santos / V12',
      old_label: 'Rio de Janeiro',
      new_label: 'Santos',
      value_labels: null,
      total_count: '120',
    }],
    error: null,
  })

  const { rows, count } = await fetchActionHistory({ entityTypes: ['voyages'], changedBy: 'sistema', action: 'alterou', dateFrom: '2026-10-12', dateTo: '', page: 2 })

  expect(rpcMock).toHaveBeenCalledWith('admin_action_history', {
    p_entity_types: ['voyages'],
    p_actor: 'sistema',
    p_action: 'alterou',
    p_date_from: '2026-10-12',
    p_date_to: null,
    p_limit: 50,
    p_offset: 100,
  })
  expect(count).toBe(120)
  rpcMock.mockResolvedValueOnce({ data: [{ id: 1, total_count: 10001 }], error: null })
  await expect(fetchActionHistory({ entityTypes: [], changedBy: '', action: '', dateFrom: '', dateTo: '', page: 0 }))
    .resolves.toMatchObject({ count: 10_000, capped: true })
  expect(rows[0]).not.toHaveProperty('total_count')
  expect(rows[0]).toMatchObject({ entity_label: 'Santos / V12', old_label: 'Rio de Janeiro', new_label: 'Santos' })
})

it('Histórico de ações com nomes: sem filtro manda nulo e propaga a recusa do banco', async () => {
  rpcMock.mockResolvedValue({ data: null, error: new Error('Somente o Administrativo consulta o Histórico de ações.') })

  await expect(fetchActionHistory({ entityTypes: [], changedBy: '', action: '', dateFrom: '', dateTo: '', page: 0 }))
    .rejects.toThrow('Somente o Administrativo')
  expect(rpcMock).toHaveBeenCalledWith('admin_action_history', expect.objectContaining({
    p_entity_types: null, p_actor: null, p_action: null, p_date_from: null, p_offset: 0,
  }))
})
