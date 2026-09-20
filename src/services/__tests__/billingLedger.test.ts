import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { from: supabaseMocks.from, rpc: supabaseMocks.rpc } }))

import {
  createConsolidatedInvoice,
  listConsolidatableReceivables,
  reconcileInvoicePaymentByTxid,
  registerLedgerInvoicePayment,
} from '../billingLedger'

beforeEach(() => {
  supabaseMocks.from.mockReset()
  supabaseMocks.rpc.mockReset()
})

function consolidatedPayload(overrides: Record<string, unknown> = {}) {
  return {
    invoice_id: 7,
    invoice_number: 'INV-7',
    status: 'issued',
    invoice_type: 'consolidated',
    receivable_count: 2,
    total_brl: 100,
    ...overrides,
  }
}

function paymentPayload(overrides: Record<string, unknown> = {}) {
  return {
    invoice_id: 1,
    payment_id: 1,
    status: 'paid',
    amount_brl: 50,
    balance_brl: 0,
    refund_due_brl: 0,
    receivables_settled: 1,
    individuals_covered: 0,
    consolidated_obsoleted: 0,
    ...overrides,
  }
}

describe('listConsolidatableReceivables', () => {
  it('retorna vazio sem chamar o RPC quando nao ha customerId (inclusive 0)', async () => {
    expect(await listConsolidatableReceivables({})).toEqual([])
    expect(await listConsolidatableReceivables({ customerId: null })).toEqual([])
    expect(await listConsolidatableReceivables({ customerId: 0 })).toEqual([])
    expect(supabaseMocks.rpc).not.toHaveBeenCalled()
  })

  it('chama o RPC list_consolidatable_receivables omitindo filtros opcionais', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: [], error: null })

    await listConsolidatableReceivables({ customerId: 9, search: '   ' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_consolidatable_receivables', {
      p_customer_id: 9,
    })
  })

  it('repassa voyageId e busca com trim', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: [], error: null })

    await listConsolidatableReceivables({ customerId: 9, voyageId: 4, search: ' CSC1 ' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_consolidatable_receivables', {
      p_customer_id: 9,
      p_voyage_id: 4,
      p_search: 'CSC1',
    })
  })

  it('normaliza numeros nas linhas, preservando nulls e zerando valores ausentes', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: [
        {
          receivable_id: '5',
          customer_id: '9',
          voyage_id: null,
          individual_invoice_id: '3',
          balance_brl: '10.5',
          original_amount_brl: null,
          bl_id: 'CSC1',
          receivable_status: 'open',
          eligibility_status: 'eligible',
        },
        {
          receivable_id: 6,
          customer_id: 9,
          voyage_id: '12',
          individual_invoice_id: null,
          balance_brl: null,
          original_amount_brl: 99,
          bl_id: 'CSC2',
          receivable_status: 'partially_settled',
          eligibility_status: 'open_consolidated',
        },
      ],
      error: null,
    })

    const rows = await listConsolidatableReceivables({ customerId: 9 })

    expect(rows).toEqual([
      {
        receivable_id: 5,
        customer_id: 9,
        voyage_id: null,
        individual_invoice_id: 3,
        balance_brl: 10.5,
        original_amount_brl: 0,
        bl_id: 'CSC1',
        receivable_status: 'open',
        eligibility_status: 'eligible',
      },
      {
        receivable_id: 6,
        customer_id: 9,
        voyage_id: 12,
        individual_invoice_id: null,
        balance_brl: 0,
        original_amount_brl: 99,
        bl_id: 'CSC2',
        receivable_status: 'partially_settled',
        eligibility_status: 'open_consolidated',
      },
    ])
  })

  it('retorna vazio quando data e null e propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await listConsolidatableReceivables({ customerId: 9 })).toEqual([])

    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('rpc falhou') })
    await expect(listConsolidatableReceivables({ customerId: 9 })).rejects.toThrow('rpc falhou')
  })

  it('rejeita status fora do domínio retornado pela RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: [{
        receivable_id: 1,
        customer_id: 9,
        voyage_id: null,
        individual_invoice_id: null,
        balance_brl: 10,
        original_amount_brl: 10,
        receivable_status: 'unexpected',
        eligibility_status: 'eligible',
      }],
      error: null,
    })

    await expect(listConsolidatableReceivables({ customerId: 9 })).rejects.toThrow(
      'Status de recebível inválido: unexpected',
    )
  })
})

describe('createConsolidatedInvoice', () => {
  it('chama o RPC create_local_consolidated_invoice e confia o PIX ao trigger do banco', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: consolidatedPayload(),
      error: null,
    })

    const result = await createConsolidatedInvoice({ customerId: 10, receivableIds: [1, 2] })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('create_local_consolidated_invoice', {
      p_customer_id: 10,
      p_receivable_ids: [1, 2],
    })
    expect(supabaseMocks.from).not.toHaveBeenCalled()
    expect(result).toEqual(consolidatedPayload())
  })

  it('retorna o resultado sem tentar update client-side de PIX', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: consolidatedPayload({ invoice_id: 8, invoice_number: 'INV-8', receivable_count: 1, total_brl: 0 }),
      error: null,
    })
    expect(await createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })).toEqual(
      consolidatedPayload({ invoice_id: 8, invoice_number: 'INV-8', receivable_count: 1, total_brl: 0 }),
    )

    supabaseMocks.rpc.mockResolvedValueOnce({
      data: consolidatedPayload({ invoice_id: 9, invoice_number: null, receivable_count: 1, total_brl: 50 }),
      error: null,
    })
    await createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })

    expect(supabaseMocks.from).not.toHaveBeenCalled()
  })

  it('rejeita retorno nulo sem tentar PIX', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })).rejects.toThrow(
      'Resposta inválida de create_local_consolidated_invoice',
    )
    expect(supabaseMocks.from).not.toHaveBeenCalled()
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('consolidada falhou') })
    await expect(createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })).rejects.toThrow(
      'consolidada falhou',
    )
  })

  it('rejeita retorno JSON inválido da criação consolidada', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { invoice_id: 'invalid' }, error: null })

    await expect(createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })).rejects.toThrow(
      'Resposta inválida de create_local_consolidated_invoice',
    )
  })
})

describe('registerLedgerInvoicePayment', () => {
  it('chama o RPC register_ledger_invoice_payment com uma chave de idempotência', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: paymentPayload(), error: null })

    const result = await registerLedgerInvoicePayment({ invoiceId: 1, amountBrl: 50, requestId: 'req-1' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('register_ledger_invoice_payment', {
      p_invoice_id: 1,
      p_amount_brl: 50,
      p_method: 'pix',
      p_paid_at: expect.any(String),
      p_pix_txid: null,
      p_source: 'manual',
      p_notes: null,
      p_actor: null,
      p_request_id: 'req-1',
    })
    expect(result).toEqual(paymentPayload())
  })

  it('repassa todos os campos com notes aparado; notes so de espacos vira null', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: paymentPayload(), error: null })

    await registerLedgerInvoicePayment({
      invoiceId: 2,
      amountBrl: 99.9,
      method: 'ted',
      paidAt: '2026-06-01T10:00:00',
      pixTxid: 'TX123',
      source: 'pix_extract',
      notes: '  ok  ',
      actorId: 'usr-123',
    })
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('register_ledger_invoice_payment', {
      p_invoice_id: 2,
      p_amount_brl: 99.9,
      p_method: 'ted',
      p_paid_at: '2026-06-01T10:00:00',
      p_pix_txid: 'TX123',
      p_source: 'pix_extract',
      p_notes: 'ok',
      p_actor: 'usr-123',
      p_request_id: expect.any(String),
    })

    await registerLedgerInvoicePayment({ invoiceId: 2, amountBrl: 1, notes: '   ' })
    expect(supabaseMocks.rpc).toHaveBeenLastCalledWith('register_ledger_invoice_payment', {
      p_invoice_id: 2,
      p_amount_brl: 1,
      p_method: 'pix',
      p_paid_at: expect.any(String),
      p_pix_txid: null,
      p_source: 'manual',
      p_notes: null,
      p_actor: null,
      p_request_id: expect.any(String),
    })
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('pagamento falhou') })
    await expect(registerLedgerInvoicePayment({ invoiceId: 1, amountBrl: 50 })).rejects.toThrow('pagamento falhou')
  })

  it('rejeita retorno JSON inválido do pagamento', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { payment_id: 'invalid' }, error: null })

    await expect(registerLedgerInvoicePayment({ invoiceId: 1, amountBrl: 50 })).rejects.toThrow(
      'Resposta inválida de register_ledger_invoice_payment',
    )
  })
})

describe('reconcileInvoicePaymentByTxid', () => {
  it('chama o RPC reconcile_invoice_payment_by_txid omitindo paid_at por default', async () => {
    const response = {
      matched: true,
      invoice_id: 1,
      settled: true,
      payment: paymentPayload(),
    }
    supabaseMocks.rpc.mockResolvedValueOnce({ data: response, error: null })

    const result = await reconcileInvoicePaymentByTxid({ txid: 'TX1', amountBrl: 99.9 })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('reconcile_invoice_payment_by_txid', {
      p_txid: 'TX1',
      p_amount_brl: 99.9,
    })
    expect(result).toEqual(response)
  })

  it('repassa paidAt quando informado', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { matched: false, reason: 'no_match' }, error: null })

    await reconcileInvoicePaymentByTxid({ txid: 'TX2', amountBrl: 10, paidAt: '2026-06-02T08:00:00' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('reconcile_invoice_payment_by_txid', {
      p_txid: 'TX2',
      p_amount_brl: 10,
      p_paid_at: '2026-06-02T08:00:00',
    })
  })

  it('aceita falha de baixa com invoice e motivo', async () => {
    const response = { matched: true, invoice_id: 2, settled: false, reason: 'saldo divergente' }
    supabaseMocks.rpc.mockResolvedValueOnce({ data: response, error: null })

    await expect(reconcileInvoicePaymentByTxid({ txid: 'TX3', amountBrl: 10 })).resolves.toEqual(response)
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('reconciliacao falhou') })
    await expect(reconcileInvoicePaymentByTxid({ txid: 'TX1', amountBrl: 1 })).rejects.toThrow('reconciliacao falhou')
  })

  it('rejeita retorno JSON inválido da conciliação', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { matched: 'yes' }, error: null })

    await expect(reconcileInvoicePaymentByTxid({ txid: 'TX1', amountBrl: 1 })).rejects.toThrow(
      'Resposta inválida de reconcile_invoice_payment_by_txid',
    )
  })

  it.each([
    { matched: false },
    { matched: true },
    { matched: true, invoice_id: 1, settled: false },
    { matched: true, invoice_id: 1, settled: true },
  ])('rejeita campos dependentes ausentes em %j', async (data) => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data, error: null })

    await expect(reconcileInvoicePaymentByTxid({ txid: 'TX1', amountBrl: 1 })).rejects.toThrow(
      'Resposta inválida de reconcile_invoice_payment_by_txid',
    )
  })
})
