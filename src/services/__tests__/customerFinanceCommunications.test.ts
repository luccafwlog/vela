import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom, mockRpc, mockDispatch } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockDispatch: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }))
vi.mock('../customerCommunicationDispatches', () => ({ dispatchCustomerCommunication: mockDispatch }))

import { dispatchCeMercanteTaxasCommunication } from '../customerFinanceCommunications'
import { communicationBoxKindsFromMigrations } from './communicationBoxKindsSql'

function queryResult(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.overrideTypes = vi.fn(async () => ({ data, error }))
  chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data, error }).then(resolve)
  return chain
}

const ready = {
  voyage_id: 7,
  customer_id: 99,
  ready: true,
  reason_code: 'ready',
  bl_count: 2,
  blocked_bl_count: 0,
  reasons: [],
  bls: [
    { bl_id: 'BL-1', ce_mercante: '123456789012345', financial_status: 'invoiced', cargo_mode: 'container', review_pendencies: [], blocked_reasons: [] },
    { bl_id: 'BL-2', ce_mercante: '987654321098765', financial_status: 'paid', cargo_mode: 'container', review_pendencies: [], blocked_reasons: [] },
  ],
}

function configureQueries(
  history: unknown[] = [],
  options: { directInvoiceRows?: unknown[]; ledgerInvoiceRows?: unknown[]; secondPod?: string; contacts?: unknown[]; boxLinks?: unknown[] } = {},
) {
  mockRpc.mockResolvedValue({ data: ready, error: null })
  mockFrom.mockImplementation((table: string) => {
    if (table === 'customer_communications') return queryResult(history)
    if (table === 'bls') return queryResult([
      {
        id: 'BL-1', voyage_id: 7, customer_id: 99, ce_mercante: '123456789012345', financial_status: 'invoiced', pod: 'BRSSZ',
        customer: { id: 99, name: 'Cliente 99', cnpj_cpf: '123' },
        voyage: { id: 7, voyage_number: 'V7', eta: '2026-09-01T12:00:00Z', vessel: { name: 'Navio 7' } },
      },
      {
        id: 'BL-2', voyage_id: 7, customer_id: 99, ce_mercante: '987654321098765', financial_status: 'paid', pod: options.secondPod ?? 'BRSSZ',
        customer: { id: 99, name: 'Cliente 99', cnpj_cpf: '123' },
        voyage: { id: 7, voyage_number: 'V7', eta: '2026-09-01T12:00:00Z', vessel: { name: 'Navio 7' } },
      },
    ])
    if (table === 'invoice_bls') return queryResult(options.directInvoiceRows ?? [
      { bl_id: 'BL-1', subtotal_brl: 100, invoice: { id: 10, status: 'issued' } },
      { bl_id: 'BL-2', subtotal_brl: 50, invoice: { id: 11, status: 'paid' } },
    ])
    if (table === 'invoice_receivable_links') return queryResult(options.ledgerInvoiceRows ?? [])
    if (table === 'customer_contacts') return queryResult(options.contacts ?? [{
      id: 1, customer_id: 99, name: 'Contato', email: 'financeiro@example.com', phone: null, purpose: 'faturamento', is_primary: true, created_at: null,
    }])
    if (table === 'customer_contact_box_links') return queryResult(options.boxLinks ?? [{ contact_id: 1, box_code: 'documentacao_operacao' }])
    if (table === 'customer_communication_suppressions' || table === 'portal_suppressed_emails') return queryResult([])
    if (table === 'customer_communication_box_kinds') return queryResult(
      communicationBoxKindsFromMigrations().filter((row) => row.kind === 'ce_mercante_taxas'),
    )
    throw new Error(`tabela inesperada: ${table}`)
  })
}

describe('automação de comunicados financeiros', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureQueries()
    mockDispatch.mockResolvedValue({ communicationId: 12, status: 'simulado' })
  })

  it('não envia enquanto a prontidão do cliente está bloqueada', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ...ready, ready: false, reason_code: 'ce_mercante_ausente', reasons: ['ce_mercante_ausente'], blocked_bl_count: 1 },
      error: null,
    })

    const result = await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(result.status).toBe('bloqueado')
    expect(result.reason).toBe('CE Mercante ausente')
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('dispara uma linha agrupada por viagem e usa a natureza de documentação', async () => {
    const result = await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(result).toMatchObject({ status: 'simulado', simulatedCount: 1, attemptDiscriminator: 0 })
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'ce_mercante_taxas',
      nature: 'documentacao',
      anchorVoyageId: 7,
      blIds: ['BL-1', 'BL-2'],
      attachments: [],
    }))
    expect(mockDispatch.mock.calls[0]?.[0].text).toContain('Total da viagem')
  })

  it('incrementa o discriminador somente no reenvio assistido', async () => {
    configureQueries([{ id: 12, status: 'enviado', attempt_discriminator: 0, created_at: '2026-09-01T10:00:00Z' }])

    await dispatchCeMercanteTaxasCommunication(7, 99)
    expect(mockDispatch).not.toHaveBeenCalled()

    await dispatchCeMercanteTaxasCommunication(7, 99, { forceRetry: true })
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ attemptDiscriminator: 1 }))
  })

  it('não trata uma tentativa automática falha como comunicação concluída', async () => {
    configureQueries([{ id: 12, status: 'falha', attempt_discriminator: 0, created_at: '2026-09-01T10:00:00Z' }])

    await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ attemptDiscriminator: 1 }))
  })

  it('não usa o primeiro POD como identidade de um resumo agrupado por viagem', async () => {
    configureQueries([], { secondPod: 'BRRIO' })

    await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      anchorVoyageId: 7,
      anchorPort: null,
      blIds: ['BL-1', 'BL-2'],
    }))
  })

  it('usa links de recebíveis para invoice consolidada sem duplicar B/Ls do ledger', async () => {
    configureQueries([], {
      directInvoiceRows: [],
      ledgerInvoiceRows: [
        { bl_id: 'BL-1', subtotal_brl: 225, status: 'active', invoice: { id: 20, status: 'issued' } },
        { bl_id: 'BL-2', subtotal_brl: 75, status: 'obsolete', invoice: { id: 20, status: 'issued' } },
      ],
    })

    await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      blIds: ['BL-1', 'BL-2'],
    }))
    expect(mockDispatch.mock.calls[0]?.[0].text.replace(/\u00a0/g, ' ')).toContain('Total da viagem: R$ 225,00')
  })

  it('representa envio parcial quando destinatários do mesmo comunicado têm resultados diferentes', async () => {
    configureQueries([], {
      contacts: [
        { id: 1, customer_id: 99, name: 'Financeiro', email: 'financeiro@example.com', phone: null, purpose: 'faturamento', is_primary: true, created_at: null },
        { id: 2, customer_id: 99, name: 'Operação', email: 'operacao@example.com', phone: null, purpose: 'operacao', is_primary: false, created_at: null },
      ],
      boxLinks: [
        { contact_id: 1, box_code: 'documentacao_operacao' },
        { contact_id: 2, box_code: 'documentacao_operacao' },
      ],
    })
    mockDispatch
      .mockResolvedValueOnce({ communicationId: 12, status: 'enviado' })
      .mockResolvedValueOnce({ communicationId: 12, status: 'falha' })

    const result = await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(result.status).toBe('parcial')
    expect(result.sentCount).toBe(1)
  })

  it('reenvio: a recusa do 1º destinatário não para o 2º, e o resultado é parcial com os Comunicados e os B/Ls', async () => {
    configureQueries([{ id: 12, status: 'enviado', attempt_discriminator: 0, created_at: '2026-09-01T10:00:00Z' }], {
      contacts: [
        { id: 1, customer_id: 99, name: 'Financeiro', email: 'financeiro@example.com', phone: null, purpose: 'faturamento', is_primary: true, created_at: null },
        { id: 2, customer_id: 99, name: 'Operação', email: 'operacao@example.com', phone: null, purpose: 'operacao', is_primary: false, created_at: null },
      ],
      boxLinks: [
        { contact_id: 1, box_code: 'documentacao_operacao' },
        { contact_id: 2, box_code: 'documentacao_operacao' },
      ],
    })
    // A Edge responde 502 e o serviço de envio lança, com o Comunicado já criado.
    mockDispatch
      .mockRejectedValueOnce(Object.assign(new Error('O provedor recusou a mensagem (endereço ou conteúdo inválido).'), { communicationId: 30 }))
      .mockResolvedValueOnce({ communicationId: 30, status: 'parcial' })

    const result = await dispatchCeMercanteTaxasCommunication(7, 99, { forceRetry: true })

    expect(mockDispatch).toHaveBeenCalledTimes(2)
    expect(mockDispatch.mock.calls.map(([input]) => input.recipient)).toEqual(['financeiro@example.com', 'operacao@example.com'])
    expect(result).toMatchObject({
      status: 'parcial',
      failedCount: 1,
      communicationIds: [30],
      attemptDiscriminator: 1,
      reason: 'O provedor recusou a mensagem (endereço ou conteúdo inválido).',
      blIds: ['BL-1', 'BL-2'],
    })
  })

  it('reenvio em que todos os destinatários são recusados devolve falha com o motivo, sem lançar', async () => {
    mockDispatch.mockRejectedValue(new Error('Contato desativado para esta caixa ou modelo.'))

    const result = await dispatchCeMercanteTaxasCommunication(7, 99, { forceRetry: true })

    expect(result).toMatchObject({ status: 'falha', failedCount: 1, reason: 'Contato desativado para esta caixa ou modelo.' })
  })

  it('preserva parcial quando um resultado já parcial acompanha um envio', async () => {
    configureQueries([], {
      contacts: [
        { id: 1, customer_id: 99, name: 'Financeiro', email: 'financeiro@example.com', phone: null, purpose: 'faturamento', is_primary: true, created_at: null },
        { id: 2, customer_id: 99, name: 'Operação', email: 'operacao@example.com', phone: null, purpose: 'operacao', is_primary: false, created_at: null },
      ],
      boxLinks: [
        { contact_id: 1, box_code: 'documentacao_operacao' },
        { contact_id: 2, box_code: 'documentacao_operacao' },
      ],
    })
    mockDispatch
      .mockResolvedValueOnce({ communicationId: 12, status: 'enviado' })
      .mockResolvedValueOnce({ communicationId: 12, status: 'parcial' })

    const result = await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(result.status).toBe('parcial')
  })

  it('retorna parcial quando o backend não tem nenhum destinatário totalmente concluído', async () => {
    configureQueries()
    mockDispatch.mockResolvedValue({ communicationId: 12, status: 'parcial' })

    const result = await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(result.status).toBe('parcial')
  })

  it('retorna falha quando todos os destinatários falham', async () => {
    configureQueries()
    mockDispatch.mockResolvedValue({ communicationId: 12, status: 'falha' })

    const result = await dispatchCeMercanteTaxasCommunication(7, 99)

    expect(result.status).toBe('falha')
    expect(result.reason).toBe('Falha no envio de todos os destinatários.')
  })
})
