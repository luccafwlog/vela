import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  buildPix: vi.fn(() => 'pix-payload'),
}))

// Testes de caracterização: travam o comportamento ATUAL de billing.ts na
// fronteira do Supabase (mesmo padrão de mock de billingHelpers.test.ts).
vi.mock('../supabase', () => ({ supabase: { from: supabaseMocks.from, rpc: supabaseMocks.rpc } }))
vi.mock('../../lib/pix', () => ({ buildTransshippingPixPayload: supabaseMocks.buildPix }))

import {
  addManualInvoiceCharge,
  cancelInvoice,
  createInvoiceFromBls,
  deleteManualInvoiceCharge,
  getInvoiceBls,
  getInvoicePaymentDate,
  isConsolidatedInvoice,
  listInvoiceLinksByBls,
  listInvoices,
  registerInvoicePayment,
} from '../billing'
import { buildInvoiceFileBaseName } from '../../components/shared/invoiceFormat'
import type { InvoiceDetail, InvoiceFilters } from '../billing'

beforeEach(() => {
  supabaseMocks.from.mockReset()
  supabaseMocks.rpc.mockReset()
  supabaseMocks.buildPix.mockReset()
  supabaseMocks.buildPix.mockReturnValue('pix-payload')
})

type QueryResult = { data?: unknown; error?: unknown; count?: number | null }

// listInvoices encadeia filtros condicionalmente; em vez de um mega-mock por
// etapa (frágil), usamos um builder genérico em que todo método retorna o
// próprio builder e o await resolve o resultado. Os asserts focam em QUAIS
// filtros foram montados, não na ordem exata do encadeamento.
function chainQuery(result: QueryResult) {
  const builder = {
    select: vi.fn(),
    order: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    not: vi.fn(),
    ilike: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    overrideTypes: vi.fn(),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  for (const method of [
    builder.select,
    builder.order,
    builder.or,
    builder.eq,
    builder.in,
    builder.gte,
    builder.lte,
    builder.not,
    builder.ilike,
    builder.limit,
    builder.range,
    builder.overrideTypes,
  ]) {
    method.mockReturnValue(builder)
  }
  return builder
}

const baseFilters: InvoiceFilters = {
  search: '',
  customerId: '',
  status: '',
  invoiceType: '',
  blSearch: '',
  voyageSearch: '',
  pod: '',
  dateFrom: '',
  dateTo: '',
  paidFrom: '',
  paidTo: '',
  page: 1,
  pageSize: 20,
}

function makeDetail(invoice: Record<string, unknown> | null, blIds: Array<string | null> = []): InvoiceDetail {
  return {
    invoice,
    bls: blIds.map((bl_id) => ({ bl_id })),
    items: [],
    payments: [],
  } as unknown as InvoiceDetail
}

describe('buildInvoiceFileBaseName', () => {
  it('monta o nome padrão com número, primeiro nome do cliente e BL', () => {
    const detail = makeDetail(
      { invoice_number: 'INV-2026-0127', customer_name: 'Golden Trade Ltda' },
      ['CSC45630201C00'],
    )
    expect(buildInvoiceFileBaseName(detail)).toBe('INV-2026-0127 - FATURA TAXAS LOCAIS - Golden - CSC45630201C00')
  })

  it('remove caracteres inválidos de nome de arquivo e normaliza espaços', () => {
    const detail = makeDetail(
      { invoice_number: 'INV/2026:0001', customer_name: '  A*B?   Comercio ' },
      ['CSC<1>|2'],
    )
    expect(buildInvoiceFileBaseName(detail)).toBe('INV20260001 - FATURA TAXAS LOCAIS - AB - CSC12')
  })

  it('lista todos os BLs separados por vírgula em fatura consolidada', () => {
    const detail = makeDetail({ invoice_number: 'INV-9', customer_name: 'Cliente' }, ['BL1', 'BL2', null])
    expect(buildInvoiceFileBaseName(detail)).toBe('INV-9 - FATURA TAXAS LOCAIS - Cliente - BL1, BL2')
  })

  it('usa INV-{id} quando a fatura não tem invoice_number', () => {
    const detail = makeDetail({ id: 42, customer_name: 'Cliente' }, ['BL1'])
    expect(buildInvoiceFileBaseName(detail)).toBe('INV-42 - FATURA TAXAS LOCAIS - Cliente - BL1')
  })

  it('cai para "Fatura" quando não há invoice e omite partes vazias', () => {
    expect(buildInvoiceFileBaseName(makeDetail(null))).toBe('Fatura - FATURA TAXAS LOCAIS')
  })
})

describe('getInvoiceBls', () => {
  it('retorna vazio quando as duas fontes são null/ausentes', () => {
    expect(getInvoiceBls({ invoice_bls: null, invoice_receivable_links: null } as never)).toEqual([])
    expect(getInvoiceBls({} as never)).toEqual([])
  })

  it('mapeia invoice_bls (fatura individual) com snapshot completo', () => {
    const row = {
      invoice_bls: [
        { bl_id: 'CSC1', bl: { pod: 'SSZ', voyage: { voyage_number: 'V1', vessel: { name: 'NAVIO' } } } },
      ],
      invoice_receivable_links: null,
    }
    expect(getInvoiceBls(row as never)).toEqual([
      { bl_id: 'CSC1', pod: 'SSZ', voyage_number: 'V1', vessel_name: 'NAVIO' },
    ])
  })

  it('mapeia invoice_receivable_links (consolidada) quando não há invoice_bls', () => {
    const row = {
      invoice_bls: [],
      invoice_receivable_links: [{ bl_id: 'CSC9', bl: { pod: 'RIO', voyage: null } }],
    }
    expect(getInvoiceBls(row as never)).toEqual([
      { bl_id: 'CSC9', pod: 'RIO', voyage_number: null, vessel_name: null },
    ])
  })

  it('descarta entradas com bl_id null ou apenas espaços', () => {
    const row = {
      invoice_bls: [
        { bl_id: null, bl: null },
        { bl_id: '   ', bl: null },
        { bl_id: 'OK', bl: undefined },
      ],
      invoice_receivable_links: null,
    }
    expect(getInvoiceBls(row as never)).toEqual([{ bl_id: 'OK', pod: null, voyage_number: null, vessel_name: null }])
  })
})

describe('isConsolidatedInvoice', () => {
  it('só reconhece invoice_type === "consolidated"', () => {
    expect(isConsolidatedInvoice({ invoice_type: 'consolidated' })).toBe(true)
    expect(isConsolidatedInvoice({ invoice_type: 'individual' })).toBe(false)
    expect(isConsolidatedInvoice({ invoice_type: 'granite' })).toBe(false)
    expect(isConsolidatedInvoice({ invoice_type: null })).toBe(false)
    expect(isConsolidatedInvoice({})).toBe(false)
  })
})

describe('getInvoicePaymentDate', () => {
  it('retorna a data mais recente comparando strings', () => {
    const row = { payments: [{ paid_at: '2026-01-10' }, { paid_at: '2026-03-02' }, { paid_at: '2026-02-01' }] }
    expect(getInvoicePaymentDate(row as never)).toBe('2026-03-02')
  })

  it('ignora pagamentos sem paid_at e retorna null quando nada sobra', () => {
    expect(getInvoicePaymentDate({ payments: undefined } as never)).toBeNull()
    expect(getInvoicePaymentDate({ payments: [] } as never)).toBeNull()
    expect(getInvoicePaymentDate({ payments: [{ paid_at: null }] } as never)).toBeNull()
    expect(getInvoicePaymentDate({ payments: [{ paid_at: null }, { paid_at: '2026-05-01' }] } as never)).toBe('2026-05-01')
  })
})

describe('createInvoiceFromBls', () => {
  it('chama o RPC create_invoice_from_bls_with_ledger omitindo defaults opcionais', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null })

    const result = await createInvoiceFromBls({ blIds: ['BL001', 'BL002'] })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('create_invoice_from_bls_with_ledger', {
      p_bl_ids: ['BL001', 'BL002'],
      p_issue_now: true,
    })
    // data null vira objeto vazio e, sem invoice_id, nada mais é executado.
    expect(result).toEqual({})
    expect(supabaseMocks.from).not.toHaveBeenCalled()
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('com invoice_id: nao grava payload PIX no navegador apos emissao atomica com ledger', async () => {
    supabaseMocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'create_invoice_from_bls_with_ledger') return { data: { invoice_id: 55, ok: true }, error: null }
      return { data: null, error: null }
    })
    const result = await createInvoiceFromBls({
      blIds: ['BL001'],
      customerId: 7,
      notes: 'obs',
      issueNow: false,
      actorId: 'user-1',
    })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('create_invoice_from_bls_with_ledger', {
      p_bl_ids: ['BL001'],
      p_customer_id: 7,
      p_notes: 'obs',
      p_issue_now: false,
      p_actor: 'user-1',
    })
    expect(supabaseMocks.buildPix).not.toHaveBeenCalled()
    expect(supabaseMocks.from).not.toHaveBeenCalled()
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ invoice_id: 55, ok: true })
  })

  it('propaga erro do RPC de criação', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('rpc falhou') })
    await expect(createInvoiceFromBls({ blIds: ['BL001'] })).rejects.toThrow('rpc falhou')
  })
})

describe('registerInvoicePayment', () => {
  it('chama o RPC register_invoice_payment omitindo defaults opcionais', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { payment_id: 1 }, error: null })

    const result = await registerInvoicePayment({ invoiceId: 9, amountBrl: 150.5, paymentMethod: 'pix' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('register_invoice_payment', {
      p_invoice_id: 9,
      p_amount_brl: 150.5,
      p_payment_method: 'pix',
    })
    expect(result).toEqual({ payment_id: 1 })
  })

  it('repassa paidAt/notes/actor e retorna {} quando data é null', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null })

    const result = await registerInvoicePayment({
      invoiceId: 9,
      amountBrl: 10,
      paymentMethod: 'ted',
      paidAt: '2026-06-01T10:00:00',
      notes: 'parcial',
      actorId: 'user-3',
    })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('register_invoice_payment', {
      p_invoice_id: 9,
      p_amount_brl: 10,
      p_payment_method: 'ted',
      p_paid_at: '2026-06-01T10:00:00',
      p_notes: 'parcial',
      p_actor: 'user-3',
    })
    expect(result).toEqual({})
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('pagamento falhou') })
    await expect(
      registerInvoicePayment({ invoiceId: 9, amountBrl: 10, paymentMethod: 'pix' }),
    ).rejects.toThrow('pagamento falhou')
  })
})


describe('cancelInvoice', () => {
  it('chama o RPC cancel_invoice com payload exato', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { cancelled: true }, error: null })

    const result = await cancelInvoice({ invoiceId: 5, reason: 'duplicada', actorId: 'user-4' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('cancel_invoice', {
      p_invoice_id: 5,
      p_reason: 'duplicada',
      p_actor: 'user-4',
    })
    expect(result).toEqual({ cancelled: true })
  })

  it('recusa justificativa vazia antes de chamar o RPC', async () => {
    await expect(cancelInvoice({ invoiceId: 5, reason: '  ' })).rejects.toThrow('Informe a justificativa')
    expect(supabaseMocks.rpc).not.toHaveBeenCalled()
  })
})

describe('addManualInvoiceCharge', () => {
  it('chama o RPC add_manual_invoice_charge com payload exato', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { item_id: 11 }, error: null })

    const result = await addManualInvoiceCharge({
      invoiceId: 8,
      description: 'Taxa extra',
      quantity: 2,
      unitValueBrl: 75.25,
    })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('add_manual_invoice_charge', {
      p_invoice_id: 8,
      p_description: 'Taxa extra',
      p_quantity: 2,
      p_unit_value_brl: 75.25,
    })
    expect(result).toEqual({ item_id: 11 })
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('charge falhou') })
    await expect(
      addManualInvoiceCharge({ invoiceId: 8, description: 'X', quantity: 1, unitValueBrl: 1 }),
    ).rejects.toThrow('charge falhou')
  })
})

describe('deleteManualInvoiceCharge', () => {
  it('chama o RPC delete_manual_invoice_charge com payload exato', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { deleted: true }, error: null })

    const result = await deleteManualInvoiceCharge({ itemId: 31, actorId: 'user-5' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('delete_manual_invoice_charge', {
      p_item_id: 31,
      p_actor: 'user-5',
    })
    expect(result).toEqual({ deleted: true })
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('delete falhou') })
    await expect(deleteManualInvoiceCharge({ itemId: 31 })).rejects.toThrow('delete falhou')
  })
})

describe('listInvoiceLinksByBls', () => {
  it('combina links individuais e consolidados, preservando tipo e origem', async () => {
    const individual = chainQuery({
      data: [
        {
          bl_id: ' bl-1 ',
          invoice: {
            id: 12,
            invoice_number: 'INV-12',
            status: 'issued',
            total_brl: 100,
            balance_brl: 100,
            invoice_type: 'individual',
          },
        },
      ],
      error: null,
    })
    const consolidated = chainQuery({
      data: [
        {
          bl_id: 'BL-1',
          invoice: {
            id: 20,
            invoice_number: 'INV-20',
            status: 'paid',
            total_brl: 300,
            balance_brl: 0,
            invoice_type: 'consolidated',
          },
        },
      ],
      error: null,
    })
    supabaseMocks.from.mockReturnValueOnce(individual).mockReturnValueOnce(consolidated)

    const result = await listInvoiceLinksByBls([' bl-1 '])

    expect(supabaseMocks.from).toHaveBeenNthCalledWith(1, 'invoice_bls')
    expect(supabaseMocks.from).toHaveBeenNthCalledWith(2, 'invoice_receivable_links')
    expect(individual.select).toHaveBeenCalledWith(
      'bl_id, invoice:invoices(id, invoice_number, status, total_brl, balance_brl, invoice_type)',
    )
    expect(consolidated.eq).toHaveBeenCalledWith('status', 'active')
    expect(result).toEqual({
      'BL-1': [
        {
          id: 20,
          invoice_number: 'INV-20',
          status: 'paid',
          total_brl: 300,
          balance_brl: 0,
          invoice_type: 'consolidated',
          source: 'invoice_receivable_links',
        },
        {
          id: 12,
          invoice_number: 'INV-12',
          status: 'issued',
          total_brl: 100,
          balance_brl: 100,
          invoice_type: 'individual',
          source: 'invoice_bls',
        },
      ],
    })
  })

  it('desduplica invoices quando há múltiplos links para a mesma fatura', async () => {
    const individual = chainQuery({ data: [], error: null })
    const consolidated = chainQuery({
      data: [
        {
          bl_id: 'BL-1',
          invoice: { id: 30, invoice_number: 'INV-30', status: 'issued', total_brl: 500, balance_brl: 500, invoice_type: 'consolidated' },
        },
        {
          bl_id: 'BL-1',
          invoice: { id: 30, invoice_number: 'INV-30', status: 'issued', total_brl: 500, balance_brl: 500, invoice_type: 'consolidated' },
        },
      ],
      error: null,
    })
    supabaseMocks.from.mockReturnValueOnce(individual).mockReturnValueOnce(consolidated)

    const result = await listInvoiceLinksByBls(['BL-1'])
    expect(result['BL-1']).toHaveLength(1)
    expect(result['BL-1'][0].id).toBe(30)
  })
})

describe('listInvoices', () => {
  it('monta os filtros diretos na query de invoices (status, tipo, busca, cliente, datas, paginação)', async () => {
    const invoices = chainQuery({ data: [{ id: 1 }], error: null, count: 42 })
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === 'invoices') return invoices
      throw new Error(`tabela inesperada: ${table}`)
    })

    const result = await listInvoices({
      ...baseFilters,
      search: 'INV-2026',
      customerId: '7',
      status: 'issued',
      invoiceType: 'single',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      page: 2,
      pageSize: 25,
    })

    expect(result).toEqual({ rows: [{ id: 1 }], count: 42 })
    expect(invoices.select).toHaveBeenCalledWith(expect.stringContaining('invoice_receivable_links('), {
      count: 'exact',
    })
    expect(invoices.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(invoices.or).toHaveBeenCalledWith('invoice_number.ilike.%INV-2026%')
    expect(invoices.eq).toHaveBeenCalledWith('customer_id', 7)
    // "issued" agrupa os status documentais ativos, incluindo draft.
    expect(invoices.in).toHaveBeenCalledWith('status', ['issued', 'partially_paid', 'draft'])
    // "single" agrupa individual e granite.
    expect(invoices.in).toHaveBeenCalledWith('invoice_type', ['individual', 'granite'])
    expect(invoices.gte).toHaveBeenCalledWith('issued_at', '2026-01-01T00:00:00')
    expect(invoices.lte).toHaveBeenCalledWith('issued_at', '2026-01-31T23:59:59')
    expect(invoices.range).toHaveBeenCalledWith(25, 49)
  })

  it('aplica grupos de status paid/consolidated e default de count null', async () => {
    const invoices = chainQuery({ data: null, error: null, count: null })
    supabaseMocks.from.mockReturnValue(invoices)

    const result = await listInvoices({ ...baseFilters, status: 'paid', invoiceType: 'consolidated' })

    expect(result).toEqual({ rows: [], count: 0 })
    expect(invoices.in).toHaveBeenCalledWith('status', ['paid', 'covered'])
    expect(invoices.eq).toHaveBeenCalledWith('invoice_type', 'consolidated')
    expect(invoices.or).not.toHaveBeenCalled()
    expect(invoices.range).toHaveBeenCalledWith(0, 19)
  })

  it('blSearch sem correspondência retorna vazio sem consultar invoices', async () => {
    const blLinks = chainQuery({ data: [], error: null })
    const recvLinks = chainQuery({ data: [], error: null })
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === 'invoice_bls') return blLinks
      if (table === 'invoice_receivable_links') return recvLinks
      throw new Error(`tabela inesperada: ${table}`)
    })

    const result = await listInvoices({ ...baseFilters, blSearch: ' csc 1% ' })

    expect(result).toEqual({ rows: [], count: 0 })
    // Termo é normalizado: trim, uppercase e remoção dos curingas do LIKE.
    expect(blLinks.ilike).toHaveBeenCalledWith('bl_id', '%CSC 1%')
    expect(recvLinks.ilike).toHaveBeenCalledWith('bl_id', '%CSC 1%')
    expect(supabaseMocks.from).not.toHaveBeenCalledWith('invoices')
  })

  it('blSearch com correspondência restringe a query de invoices por id', async () => {
    const blLinks = chainQuery({ data: [{ invoice_id: 1 }], error: null })
    const recvLinks = chainQuery({ data: [{ invoice_id: 2 }], error: null })
    const invoices = chainQuery({ data: [{ id: 1 }], error: null, count: 1 })
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === 'invoice_bls') return blLinks
      if (table === 'invoice_receivable_links') return recvLinks
      if (table === 'invoices') return invoices
      throw new Error(`tabela inesperada: ${table}`)
    })

    const result = await listInvoices({ ...baseFilters, blSearch: 'CSC1' })

    expect(result).toEqual({ rows: [{ id: 1 }], count: 1 })
    expect(invoices.in).toHaveBeenCalledWith('id', [1, 2])
  })

  it('propaga erro da query principal de invoices', async () => {
    const invoices = chainQuery({ data: null, error: new Error('lista falhou'), count: null })
    supabaseMocks.from.mockReturnValue(invoices)

    await expect(listInvoices(baseFilters)).rejects.toThrow('lista falhou')
  })
})
