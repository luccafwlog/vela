import { describe, expect, it, vi } from 'vitest'
import type { FichaInvoiceRow } from '../customerFicha'

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }))

const { buildConsolidatedBalance, buildCustomerTimeline, differingConsignee, fetchCustomerPendingReconciliation, fetchCustomerReceivables, buildCustomerInvoiceLines, filterCustomerInvoiceLines } = await import('../customerFicha')

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

  it('dá assunto a cada evento e o autor por nome ou "Sistema", nunca o id', () => {
    const events = buildCustomerTimeline({
      auditLogs: [
        { id: 1, field_name: 'name', old_value: 'A', new_value: 'B', changed_at: '2026-07-02T10:00:00Z', justification: null, changed_by: 'user-1' },
        { id: 2, field_name: 'zip', old_value: null, new_value: '1', changed_at: '2026-07-01T10:00:00Z', justification: null, changed_by: 'user-sem-nome' },
      ],
      portalEvents: [{ id: 3, new_decision: 'authorized', new_situation: null, reason: 'Reparo automático da fila do Portal durante a leitura.', created_at: '2026-07-03T10:00:00Z', actor_id: null, actor_type: 'system' }],
      contacts: [],
      localInvoices: [],
      payments: [{ id: 9, amount_brl: 100, paid_at: '2026-07-06T10:00:00Z', registered_by_name: 'Bruno', invoice: { id: 4, invoice_number: 'INV-1' } }],
      demurrageInvoices: [],
      bls: [{ id: 'BL1', created_at: '2026-06-30T10:00:00Z' }],
      actorNames: new Map([['user-1', 'Ana Ribeiro']]),
    })
    expect(events.map((event) => [event.subject, event.actor])).toEqual([
      ['Pagamentos', 'Bruno'],
      ['Portal', 'Sistema'],
      ['Cadastro', 'Ana Ribeiro'],
      ['Cadastro', 'Usuário interno'],
      ['B/Ls', null],
    ])
    // Motivo técnico do sistema não aparece no Histórico.
    expect(events.find((event) => event.subject === 'Portal')?.detail).toBeNull()
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
    // B16: a sugestão por nome tem customer_id nulo; a ficha procura pelo Cliente sugerido.
    expect(builder.eq).toHaveBeenCalledWith('suggested_customer_id', 101)
    expect(builder.eq).toHaveBeenCalledWith('customer_reconciliation_status', 'matched_name')
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

describe('Faturas e Recebíveis num bloco só (aba Financeiro)', () => {
  const invoice = (id: number, status: string, blIds: string[], extra: Partial<FichaInvoiceRow> = {}): FichaInvoiceRow => ({
    id, invoice_number: `FAT-${id}`, issued_at: '2026-10-01T10:00:00Z', total_brl: 100, balance_brl: 100, status, invoice_type: blIds.length > 1 ? 'consolidated' : 'single', bl_ids: blIds, ...extra,
  })
  const receivable = (id: number, blId: string, balance: number) => ({ id, bl_id: blId, original_amount_brl: 100, settled_amount_brl: 100 - balance, balance_brl: balance, status: balance > 0 ? 'open' : 'settled' })

  it('uma linha por fatura com o saldo por B/L; saldo sem fatura viva vira "Sem fatura ativa"', () => {
    const lines = buildCustomerInvoiceLines(
      [invoice(1, 'issued', ['BL-A', 'BL-B']), invoice(2, 'cancelled', ['BL-C'])],
      [receivable(10, 'BL-A', 60), receivable(11, 'BL-B', 40), receivable(12, 'BL-C', 80), receivable(13, 'BL-D', 0)],
    )
    expect(lines.map((line) => (line.kind === 'invoice' ? `FAT-${line.invoice.id}:${line.receivables.map((row) => row.bl_id).join('+')}` : `sem:${line.blId}`))).toEqual([
      'FAT-1:BL-A+BL-B',
      // A fatura cancelada não leva o recebível vivo: o saldo aparece uma vez só,
      'FAT-2:',
      // em "Sem fatura ativa", porque a fatura de BL-C foi cancelada e o saldo continua.
      'sem:BL-C',
    ])
  })

  it('saldo novo de B/L com fatura paga aparece em "Sem fatura ativa"', () => {
    const lines = buildCustomerInvoiceLines([invoice(1, 'paid', ['BL-A'], { balance_brl: 0 })], [receivable(10, 'BL-A', 30)])
    expect(lines.map((line) => (line.kind === 'invoice' ? `FAT-${line.invoice.id}` : `sem:${line.blId}`))).toEqual(['FAT-1', 'sem:BL-A'])
    // A fatura paga não repete o saldo vivo na expansão.
    expect(lines[0].kind === 'invoice' && lines[0].receivables).toEqual([])
  })

  it('a busca por B/L traz a consolidada inteira e filtra situação e período', () => {
    const lines = buildCustomerInvoiceLines(
      [invoice(1, 'issued', ['BL-A', 'BL-B']), invoice(2, 'paid', ['BL-C'], { issued_at: '2026-08-01T10:00:00Z' })],
      [],
    )
    const byBl = filterCustomerInvoiceLines(lines, { search: 'bl-b', situation: '', from: '', to: '' })
    expect(byBl).toHaveLength(1)
    expect(byBl[0].kind === 'invoice' && byBl[0].invoice.bl_ids).toEqual(['BL-A', 'BL-B'])
    expect(filterCustomerInvoiceLines(lines, { search: '', situation: 'paid', from: '', to: '' }).map((line) => line.kind === 'invoice' && line.invoice.id)).toEqual([2])
    expect(filterCustomerInvoiceLines(lines, { search: '', situation: '', from: '2026-09-01', to: '' }).map((line) => line.kind === 'invoice' && line.invoice.id)).toEqual([1])
  })
})

describe('differingConsignee', () => {
  it('mostra o nome do manifesto só quando difere do nome do Cliente', () => {
    expect(differingConsignee('Comércio Alfa Ltda.', 'COMERCIO ALFA LTDA')).toBeNull()
    expect(differingConsignee('ALFA IMPORTS', 'Comércio Alfa Ltda')).toBe('ALFA IMPORTS')
    expect(differingConsignee(null, 'Comércio Alfa Ltda')).toBeNull()
  })
})

describe('Histórico do Cliente: Base de Clientes (migration 403, F-24)', () => {
  it('mostra a mudança da Base de Clientes com "Origem: Base de Clientes", quem e quando; e-mail incluído vai para Contatos', () => {
    const events = buildCustomerTimeline({
      auditLogs: [
        { id: 7, field_name: 'address', old_value: 'Rua A', new_value: 'Rua Nova, 100', changed_at: '2026-10-22T10:00:00Z', justification: 'Importação de Base de Clientes', changed_by: 'user-1' },
        { id: 8, field_name: 'contact_added', old_value: null, new_value: 'operacao@cliente.test', changed_at: '2026-10-22T10:00:00Z', justification: 'Importação de Base de Clientes', changed_by: 'user-1' },
      ],
      portalEvents: [],
      contacts: [],
      localInvoices: [],
      payments: [],
      demurrageInvoices: [],
      bls: [],
      actorNames: new Map([['user-1', 'Ana Ribeiro']]),
    })
    const address = events.find((event) => event.label === 'Cadastro alterado: Endereço')
    expect(address).toMatchObject({ subject: 'Cadastro', actor: 'Ana Ribeiro', at: '2026-10-22T10:00:00Z', detail: 'Rua A → Rua Nova, 100 · Origem: Base de Clientes' })
    const email = events.find((event) => event.label === 'E-mail incluído')
    expect(email).toMatchObject({ subject: 'Contatos', actor: 'Ana Ribeiro', detail: 'operacao@cliente.test · Origem: Base de Clientes' })
  })
})
