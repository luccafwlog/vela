import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmUnifiedPixReconciliation,
  createPixImportKey,
  listPixReconciliationExceptions,
  matchUnifiedPixTransactions,
  persistUnresolvedPixMatches,
  resolvePixReconciliationException,
} from '../reconciliacao'
import type { UnifiedPixMatch } from '../reconciliacao'

const { mockFrom, mockRpc, mockInvoiceUpdate, mockDemurrageUpdate } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
  mockDemurrageUpdate: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

function createSelectBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    overrideTypes: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function installFromMock(input: { localInvoices?: unknown[]; demurrageInvoices?: unknown[]; demurrageHistory?: unknown[] }) {
  const localInvoices = input.localInvoices ?? []
  const demurrageInvoices = input.demurrageInvoices ?? []
  const demurrageHistory = input.demurrageHistory ?? []
  const invoiceUpdateBuilder = {
    eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
  }

  mockInvoiceUpdate.mockReturnValue(invoiceUpdateBuilder)
  mockDemurrageUpdate.mockReturnValue({ eq: vi.fn() })
  mockFrom.mockImplementation((table: string) => {
    if (table === 'invoices') {
      return {
        select: vi.fn(() => createSelectBuilder({ data: localInvoices, error: null })),
        update: mockInvoiceUpdate,
      }
    }
    if (table === 'demurrage_invoices') {
      return {
        select: vi.fn(() => createSelectBuilder({ data: demurrageInvoices, error: null })),
        update: mockDemurrageUpdate,
      }
    }
    if (table === 'demurrage_invoice_history') {
      return {
        select: vi.fn(() => createSelectBuilder({ data: demurrageHistory, error: null })),
      }
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

const demurrageOkItems = [
  { source: 'demurrage', invoice_id: 20, doc_number: 'DEM-001', status: 'ok' },
  { source: 'demurrage', invoice_id: 21, doc_number: 'DEM-002', status: 'ok' },
]

describe('reconciliacao PIX unificada', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset().mockResolvedValue({ data: [], error: null })
    mockInvoiceUpdate.mockReset()
    mockDemurrageUpdate.mockReset()
  })

  it('mantem visivel como unmatched quando o TXID nao corresponde a nenhum documento', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          status: 'issued',
          pix_txid: 'PIX-LOCAL-001',
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      {
        txid: 'OUTRO-TXID',
        cnpj: '12.345.678/0001-95',
        date: '2026-05-28',
        amount: 100,
      },
    ])

    expect(matches).toEqual([
      expect.objectContaining({
        source: 'unmatched',
        docNumber: 'OUTRO-TXID',
        ambiguous: true,
        ambiguityReason: 'Nenhum documento aberto usa este TXID.',
        candidateCount: 0,
        matchType: 'unmatched',
      }),
    ])
  })

  it('usa o TXID PIX da invoice como chave, não o número do documento', async () => {
    installFromMock({
      localInvoices: [{
        id: 10,
        invoice_number: 'INV-001',
        total_brl: 100,
        balance_brl: 100,
        status: 'issued',
        pix_txid: 'txid-real-001',
        customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
      }],
    })

    const matches = await matchUnifiedPixTransactions([{
      txid: 'TXID-REAL-001',
      cnpj: '12.345.678/0001-95',
      date: '2026-05-28',
      amount: 100,
    }])

    expect(matches[0]).toMatchObject({ source: 'local', docNumber: 'INV-001', ambiguous: false })
  })

  it('persiste apenas linhas nao conciliadas com import e linha estaveis', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({
      data: { items: [{ id: 42, line_number: 8, status: 'active' }] },
      error: null,
    })
    const match: UnifiedPixMatch = {
      transaction: { txid: '', cnpj: '123', date: '2026-06-05', amount: 100, lineNumber: 8 },
      source: 'unmatched',
      invoiceId: 0,
      docNumber: '',
      customerName: '',
      customerCnpj: '123',
      amount: 100,
      ambiguous: true,
      ambiguityReason: 'Nenhum documento aberto usa este TXID.',
      candidateCount: 0,
      matchType: 'unmatched',
    }

    const result = await persistUnresolvedPixMatches('sha256:import-1', [match])

    expect(mockRpc).toHaveBeenCalledWith('upsert_pix_reconciliation_exceptions', {
      p_import_key: 'sha256:import-1',
      p_rows: [expect.objectContaining({ line_number: 8, txid: '', amount_brl: 100 })],
    })
    expect(result).toEqual([{ id: 42, lineNumber: 8, status: 'active' }])
  })

  it('lista pendencias apos reload e resolve somente por RPCs server-side', async () => {
    installFromMock({})
    mockRpc
      .mockResolvedValueOnce({ data: [{ id: 42, import_key: 'sha256:import-1', line_number: 8, txid: '', cnpj: '123', paid_at: '2026-06-05', amount_brl: 100, reason: 'unmatched', candidate_count: 0, metadata: {}, status: 'active', created_at: '2026-06-05T10:00:00Z', updated_at: '2026-06-05T10:00:00Z', resolved_at: null }], error: null })
      .mockResolvedValueOnce({ data: { id: 42, status: 'resolved' }, error: null })

    const rows = await listPixReconciliationExceptions()
    const resolved = await resolvePixReconciliationException(42, { source: 'local', invoiceId: 10, txid: 'INV-010' })

    expect(rows[0]).toMatchObject({ id: 42, lineNumber: 8, txid: '', amount: 100, status: 'active' })
    expect(resolved).toEqual({ id: 42, status: 'resolved' })
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'list_pix_reconciliation_exceptions', { p_status: 'active' })
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'resolve_pix_reconciliation_exception', {
      p_exception_id: 42,
      p_resolution_source: 'local',
      p_invoice_id: 10,
      p_demurrage_invoice_id: null,
      p_txid: 'INV-010',
    })
  })

  it('gera chave de importacao deterministica pelo conteudo do arquivo', async () => {
    const file = new File(['pix-content'], 'pix.xlsx', { type: 'application/vnd.ms-excel', lastModified: 123 })
    await expect(createPixImportKey(file)).resolves.toMatch(/^sha256:/)
  })

  it('marca como ambiguo quando o mesmo TXID existe em fatura local e demurrage', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          balance_brl: 100,
          pix_txid: 'INV-001',
          customer: { name: 'Cliente Local', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
      demurrageInvoices: [
        {
          id: 20,
          doc_number: 'INV-001',
          current_total_brl: 100,
          pix_txid: 'INV-001',
          customer: { name: 'Cliente Demurrage', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'INV-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ docNumber: 'INV-001', ambiguous: true })
  })

  it('marca demurrage com valor divergente como ambiguo antes da confirmacao', async () => {
    installFromMock({
      demurrageInvoices: [
        {
          id: 20,
          doc_number: 'DEM-001',
          current_total_brl: 100,
          pix_txid: 'DEM-001',
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 90 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ source: 'demurrage', ambiguous: true })
  })

  it('aceita demurrage paga com o valor de uma PTAX anterior (janela das duas PTAX)', async () => {
    installFromMock({
      demurrageInvoices: [
        {
          id: 20,
          doc_number: 'DEM-001',
          current_total_brl: 110, // valor de hoje (PTAX nova)
          pix_txid: 'DEM-001',
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
      demurrageHistory: [
        { invoice_id: 20, event_date: '2026-05-28', total_brl: 110, id: 2 },
        { invoice_id: 20, event_date: '2026-05-27', total_brl: 100, id: 1 },
      ],
    })

    // Cliente pagou em 28/05 com o QR de 27/05 (valor 100); deve casar pela janela.
    const matches = await matchUnifiedPixTransactions([
      { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ source: 'demurrage', ambiguous: false })
  })

  it('marca fatura local com valor a menor como ambiguo (PIX nao admite parcial)', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          balance_brl: 100,
          pix_txid: 'INV-001',
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'INV-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 40 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ source: 'local', ambiguous: true })
  })

  it('ignora (marca ambiguo) o mesmo TXID repetido no mesmo extrato', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          balance_brl: 100,
          pix_txid: 'DUPLICATE-PIX',
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'DUPLICATE-PIX', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
      { txid: 'DUPLICATE-PIX', cnpj: '12.345.678/0001-95', date: '2026-05-29', amount: 100 },
    ])

    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ ambiguous: false })
    expect(matches[1]).toMatchObject({ ambiguous: true })
  })

  it('marca fatura local com valor acima do saldo como ambiguo antes da confirmacao', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          balance_brl: 100,
          pix_txid: 'INV-001',
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'INV-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 120 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ source: 'local', ambiguous: true })
  })

  it('confirma fatura local pela RPC unificada', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({
      data: { local: 1, demurrage: 0, items: [{ source: 'local', invoice_id: 10, doc_number: 'INV-001', status: 'ok' }] },
      error: null,
    })
    const matches: UnifiedPixMatch[] = [
      {
        transaction: {
          txid: 'INV-001',
          cnpj: '12.345.678/0001-95',
          date: '2026-05-28',
          amount: 100,
        },
        source: 'local',
        invoiceId: 10,
        docNumber: 'INV-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    const result = await confirmUnifiedPixReconciliation(matches)

    expect(mockRpc).toHaveBeenCalledWith('confirm_unified_pix_matches', {
      p_matches: [
        {
          source: 'local',
          invoice_id: 10,
          doc_number: 'INV-001',
          txid: 'INV-001',
          amount: 100,
          expected_amount: 100,
          paid_at: '2026-05-28',
        },
      ],
    })
    expect(mockInvoiceUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({
      local: 1,
      demurrage: 0,
      items: [{ source: 'local', invoice_id: 10, doc_number: 'INV-001', status: 'ok' }],
    })
  })

  it('propaga erro do banco quando valor de demurrage diverge', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({ data: null, error: new Error('Valor divergente para demurrage DEM-001.') })
    const matches: UnifiedPixMatch[] = [
      {
        transaction: {
          txid: 'DEM-001',
          cnpj: '12.345.678/0001-95',
          date: '2026-05-28',
          amount: 90,
        },
        source: 'demurrage',
        invoiceId: 20,
        docNumber: 'DEM-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow(/valor|diverg/i)
    expect(mockDemurrageUpdate).not.toHaveBeenCalled()
  })

  it('propaga erro do banco ao confirmar conciliacao de demurrage', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({ data: null, error: new Error('db down') })
    const matches: UnifiedPixMatch[] = [
      {
        transaction: {
          txid: 'DEM-001',
          cnpj: '12.345.678/0001-95',
          date: '2026-05-28',
          amount: 100,
        },
        source: 'demurrage',
        invoiceId: 20,
        docNumber: 'DEM-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow('db down')
  })

  it('concilia demurrage em lote com uma unica chamada RPC', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({ data: { local: 0, demurrage: 2, items: demurrageOkItems }, error: null })
    const base = {
      source: 'demurrage' as const,
      customerName: 'Cliente Alfa',
      customerCnpj: '12345678000195',
      ambiguous: false,
      matchType: 'txid' as const,
    }
    const matches: UnifiedPixMatch[] = [
      {
        ...base,
        transaction: { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
        invoiceId: 20,
        docNumber: 'DEM-001',
        amount: 100,
      },
      {
        ...base,
        transaction: { txid: 'DEM-002', cnpj: '12.345.678/0001-95', date: '2026-05-29', amount: 50 },
        invoiceId: 21,
        docNumber: 'DEM-002',
        amount: 50,
      },
    ]

    const result = await confirmUnifiedPixReconciliation(matches)

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('confirm_unified_pix_matches', {
      p_matches: [
        {
          source: 'demurrage',
          invoice_id: 20,
          doc_number: 'DEM-001',
          txid: 'DEM-001',
          amount: 100,
          expected_amount: 100,
          paid_at: '2026-05-28',
        },
        {
          source: 'demurrage',
          invoice_id: 21,
          doc_number: 'DEM-002',
          txid: 'DEM-002',
          amount: 50,
          expected_amount: 50,
          paid_at: '2026-05-29',
        },
      ],
    })
    expect(mockDemurrageUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({ local: 0, demurrage: 2, items: demurrageOkItems })
  })

  it('rejeita conciliacao quando a data do extrato nao foi parseada', async () => {
    installFromMock({})
    const matches: UnifiedPixMatch[] = [
      {
        transaction: { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '', amount: 100 },
        source: 'demurrage',
        invoiceId: 20,
        docNumber: 'DEM-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow(/data/i)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('propaga divergencia quando a RPC unificada rejeita o lote', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({ data: null, error: new Error('Conciliacao de demurrage atualizou 1 de 2 faturas.') })
    const matches: UnifiedPixMatch[] = [
      {
        transaction: { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
        source: 'demurrage',
        invoiceId: 20,
        docNumber: 'DEM-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
      {
        transaction: { txid: 'DEM-002', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 50 },
        source: 'demurrage',
        invoiceId: 21,
        docNumber: 'DEM-002',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 50,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow(/atualizou 1 de 2/)
  })
})


describe('versões de cobranças Pix locais', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
    installFromMock({})
  })
  it('usa o valor do QR histórico e a sucessora retornada pelo banco', async () => {
    mockRpc.mockResolvedValue({ data: [{ txid: 'OLDQR', id: 42, invoice_number: 'NEW42', amount_brl: 600,
      customer: { name: 'Cliente', cnpj_cpf: '12345678000199' } }], error: null })
    const matches = await matchUnifiedPixTransactions([{ txid: 'OLDQR', date: '2026-10-02', amount: 600, cnpj: '12345678000199' }])
    expect(matches[0]).toMatchObject({ source: 'local', invoiceId: 42, amount: 600, ambiguous: false })
    expect(mockRpc).toHaveBeenCalledWith('list_local_pix_candidates', { p_txids: ['OLDQR'] })
  })
  it('não oculta falhas da consulta autoritativa', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('Consulta indisponível') })
    await expect(matchUnifiedPixTransactions([{ txid: 'OLDQR', date: '2026-10-02', amount: 600, cnpj: '' }]))
      .rejects.toThrow('Consulta indisponível')
  })
})
