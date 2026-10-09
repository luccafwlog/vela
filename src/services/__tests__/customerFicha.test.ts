import { describe, expect, it, vi } from 'vitest'

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }))

const { buildConsolidatedBalance, buildCustomerTimeline, fetchCustomerPendingReconciliation, fetchCustomerReceivables } = await import('../customerFicha')

describe('buildConsolidatedBalance', () => {
  it('soma local emitido não pago (emitida e parcial) + demurrage não pago', () => {
    expect(buildConsolidatedBalance(
      // 'overdue' saiu do domínio das taxas locais na 348 (#605): mesmo que uma
      // linha histórica chegue com esse status, ela não entra no saldo.
      [
        { status: 'issued', balance_brl: 100 },
        { status: 'overdue', balance_brl: 300 },
        { status: 'partially_paid', balance_brl: 40 },
        { status: 'paid', balance_brl: 999 },
        { status: 'cancelled', balance_brl: 999 },
      ],
      [{ status: 'issued', current_total_brl: 50 }, { status: 'overdue', current_total_brl: 25 }, { status: 'paid', current_total_brl: 999 }, { status: 'cancelled', current_total_brl: 999 }],
    )).toEqual({ localBrl: 140, demurrageBrl: 75, totalBrl: 215 })
  })
})

describe('buildCustomerTimeline', () => {
  it('mescla fontes e ordena do mais recente para o mais antigo', () => {
    const events = buildCustomerTimeline({
      auditLogs: [{ id: 1, field_name: 'name', old_value: 'A', new_value: 'B', changed_at: '2026-07-02T10:00:00Z', justification: 'ajuste', changed_by: null }],
      portalEvents: [{ id: 2, new_decision: 'authorized', new_situation: null, reason: null, created_at: '2026-07-03T10:00:00Z' }],
      contacts: [{ id: 3, name: 'Contato', created_at: '2026-07-01T10:00:00Z' }],
      customerId: 101,
      localInvoices: [{ id: 4, invoice_number: 'INV-1', issued_at: '2026-07-04T10:00:00Z', status: 'issued' }],
      payments: [{ id: 9, amount_brl: 100, paid_at: '2026-07-06T10:00:00Z', invoice: { id: 4, invoice_number: 'INV-1' } }],
      demurrageInvoices: [{ id: 5, doc_number: 'DEM-1', billed_at: '2026-07-05T10:00:00Z', paid_at: null, status: 'issued' }],
      bls: [{ id: 'BL1', created_at: '2026-06-30T10:00:00Z' }],
    })
    expect(events.map((event) => event.kind)).toEqual(['local_payment', 'demurrage_invoice_issued', 'local_invoice_issued', 'portal_event', 'cadastro_audit', 'contact_created', 'bl_created'])
    expect(events[0].at).toBe('2026-07-06T10:00:00Z')
    expect(events.find((event) => event.kind === 'local_invoice_issued')?.link).toBe('/taxas-locais?customer=101&invoice=4')
    expect(events.find((event) => event.kind === 'local_payment')?.link).toBe('/taxas-locais?customer=101&invoice=4')
  })

  it('ordena pela data real mesmo com formatos diferentes e traduz o campo auditado', () => {
    const events = buildCustomerTimeline({
      auditLogs: [{ id: 1, field_name: 'zip', old_value: null, new_value: '11010-000', changed_at: '2026-10-09T03:34:43+00:00', justification: null, changed_by: null }],
      portalEvents: [],
      contacts: [{ id: 3, name: 'Contato', created_at: '2026-10-09 03:12:10+00' }],
      customerId: 101,
      localInvoices: [{ id: 4, invoice_number: 'FAT-1', issued_at: '2026-10-01T10:00:00Z', status: 'issued' }],
      payments: [],
      demurrageInvoices: [],
      bls: [],
    })
    expect(events.map((event) => event.label)).toEqual(['Cadastro alterado: CEP', 'Contato criado: Contato', 'Fatura emitida: FAT-1'])
  })

  it('data sem hora de Demurrage conta como o dia local, não 21h do dia anterior', () => {
    const previousTz = process.env.TZ
    process.env.TZ = 'America/Sao_Paulo'
    try {
      const events = buildCustomerTimeline({
        auditLogs: [],
        portalEvents: [],
        contacts: [{ id: 3, name: 'Contato', created_at: '2026-10-09T01:00:00Z' }], // 08/10 22:00 em Brasília
        customerId: 101,
        localInvoices: [],
        payments: [],
        demurrageInvoices: [{ id: 5, doc_number: 'DEM-1', billed_at: '2026-10-09', paid_at: null, status: 'issued' }],
        bls: [],
      })
      expect(events.map((event) => event.kind)).toEqual(['demurrage_invoice_issued', 'contact_created'])
    } finally {
      process.env.TZ = previousTz
    }
  })

  it('desativar e reativar aparecem com o nome da ação e o motivo', () => {
    const events = buildCustomerTimeline({
      auditLogs: [
        { id: 1, field_name: 'deactivated', old_value: 'false', new_value: 'true', changed_at: '2026-10-01T10:00:00Z', justification: 'Encerrou operação', changed_by: null },
        { id: 2, field_name: 'deactivated', old_value: 'true', new_value: 'false', changed_at: '2026-10-02T10:00:00Z', justification: 'Voltou a operar', changed_by: null },
      ],
      portalEvents: [], contacts: [], customerId: 101, localInvoices: [], payments: [], demurrageInvoices: [], bls: [],
    })
    expect(events.map((event) => [event.label, event.detail])).toEqual([
      ['Cliente reativado', 'Voltou a operar'],
      ['Cliente desativado', 'Encerrou operação'],
    ])
  })

  it('agrupa eventos de configuração de contatos por action_id e formata origem e contagem de caixas', () => {
    const actionId1 = 'a0000000-0000-0000-0000-000000000001'
    const actionId2 = 'a0000000-0000-0000-0000-000000000002'

    const events = buildCustomerTimeline({
      auditLogs: [],
      portalEvents: [],
      contacts: [],
      customerId: 101,
      localInvoices: [],
      payments: [],
      demurrageInvoices: [],
      bls: [],
      contactChangeEvents: [
        {
          id: 1,
          action_id: actionId1,
          source: 'portal',
          actor_id: 'user-1',
          portal_account_id: 5,
          related_bl_id: null,
          before_snapshot: [],
          after_snapshot: [
            { id: 10, name: 'Operação', email: 'ops@acme.com', box_codes: ['documentacao_operacao', 'financeiro'] },
            { id: 11, name: 'Cobrança', email: 'cob@acme.com', box_codes: ['demurrage'] },
          ],
          change_summary: { action: 'save_contact_configuration', justification: 'Autoatendimento portal' },
          created_at: '2026-07-10T10:00:00Z',
        },
        // Outro evento com o mesmo actionId1 (deve ser agrupado e aparecer uma única vez)
        {
          id: 2,
          action_id: actionId1,
          source: 'portal',
          actor_id: 'user-1',
          portal_account_id: 5,
          related_bl_id: null,
          before_snapshot: [],
          after_snapshot: [
            { id: 10, name: 'Operação', email: 'ops@acme.com', box_codes: ['documentacao_operacao', 'financeiro'] },
            { id: 11, name: 'Cobrança', email: 'cob@acme.com', box_codes: ['demurrage'] },
          ],
          change_summary: { action: 'save_contact_configuration', justification: 'Autoatendimento portal' },
          created_at: '2026-07-10T10:00:00Z',
        },
        // Evento gerado automaticamente pelo B/L
        {
          id: 3,
          action_id: actionId2,
          source: 'bl_automatico',
          actor_id: null,
          portal_account_id: null,
          related_bl_id: 'BL-999',
          before_snapshot: [],
          after_snapshot: [
            { id: 12, name: 'Capturado', email: 'bl@acme.com', box_codes: ['documentacao_operacao'] },
          ],
          change_summary: null,
          created_at: '2026-07-09T10:00:00Z',
        },
      ],
    })

    const contactEvents = events.filter((e) => e.kind === 'contact_configuration_changed')
    expect(contactEvents).toHaveLength(2)

    const portalEvent = contactEvents.find((e) => e.sourceId === actionId1)!
    expect(portalEvent.label).toBe('Contatos: alteração via Portal')
    expect(portalEvent.detail).toContain('Autoatendimento portal')
    expect(portalEvent.detail).toContain('2 contato(s), 3 caixa(s)')
    expect(portalEvent.link).toBeNull()

    const blEvent = contactEvents.find((e) => e.sourceId === actionId2)!
    expect(blEvent.label).toBe('Contatos: alteração via B/L')
    expect(blEvent.detail).toContain('B/L BL-999')
    expect(blEvent.detail).toContain('1 contato(s), 1 caixa(s)')
    expect(blEvent.link).toBeNull()
  })
})

describe('fetchCustomerPendingReconciliation', () => {
  it('nao lista vinculo por documento exato (matched_document) como pendente, so matched_name', async () => {
    const rows = [
      { id: 'BL1', consignee: 'ACME', customer_reconciliation_status: 'matched_document' },
      { id: 'BL2', consignee: 'BETA', customer_reconciliation_status: 'matched_name' },
    ]
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn(() => builder),
      overrideTypes: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    }
    mockFrom.mockReturnValue(builder)

    const result = await fetchCustomerPendingReconciliation(101)

    expect(result).toEqual([{ id: 'BL2', consignee: 'BETA', customer_reconciliation_status: 'matched_name' }])
  })
})

describe('fetchCustomerReceivables — le via RPC para distinguir vazio de restrito', () => {
  it('retorna as linhas da RPC get_customer_receivables', async () => {
    const rows = [{ id: 1, bl_id: 'BL1', original_amount_brl: 10, settled_amount_brl: 0, balance_brl: 10, status: 'open' }]
    mockRpc.mockResolvedValue({ data: rows, error: null })

    const result = await fetchCustomerReceivables(101)

    expect(mockRpc).toHaveBeenCalledWith('get_customer_receivables', { p_customer_id: 101 })
    expect(result).toEqual({ rows, denied: false })
  })

  it('marca denied quando a RPC recusa por falta de permissao (42501)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Usuario sem permissao ativa.' } })

    const result = await fetchCustomerReceivables(101)

    expect(result).toEqual({ rows: [], denied: true })
  })
})
