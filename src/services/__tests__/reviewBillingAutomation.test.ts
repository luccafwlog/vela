import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../charges/chargeOperationsService', () => ({
  calculateBlLocalCharges: vi.fn(),
}))

vi.mock('../billing', () => ({
  markBlReadyAndCreateInvoice: vi.fn(),
}))

const { mockLogOperationalEvent } = vi.hoisted(() => ({
  mockLogOperationalEvent: vi.fn(),
}))

const { mockDispatchCeMercanteTaxasCommunication } = vi.hoisted(() => ({
  mockDispatchCeMercanteTaxasCommunication: vi.fn(),
}))

vi.mock('../customerFinanceCommunications', () => ({
  dispatchCeMercanteTaxasCommunication: mockDispatchCeMercanteTaxasCommunication,
}))

vi.mock('../operationalEvents', () => ({
  logOperationalEvent: mockLogOperationalEvent,
}))

const { mockCreateAlert, mockResolveAlertItem } = vi.hoisted(() => ({
  mockCreateAlert: vi.fn(),
  mockResolveAlertItem: vi.fn(),
}))
vi.mock('../alerts', () => ({ createAlert: mockCreateAlert, resolveAlertItem: mockResolveAlertItem }))

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

import { markBlReadyAndCreateInvoice } from '../billing'
import { calculateBlLocalCharges } from '../charges/chargeOperationsService'
import { maybeAutoBillAfterCeMercante, tryAutoIssueInvoice } from '../reviewBillingAutomation'

const mockedCalculate = vi.mocked(calculateBlLocalCharges)
const mockedCreateInvoice = vi.mocked(markBlReadyAndCreateInvoice)

beforeEach(() => {
  vi.clearAllMocks()
  mockDispatchCeMercanteTaxasCommunication.mockResolvedValue({ status: 'simulado' })
  mockFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: {
            ce_mercante: '122605051526081',
            cargo_mode: 'container',
            customer_id: 99,
            customer_reconciliation_status: 'matched_document',
            review_status: 'reviewed',
            billing_hold_reason: null,
          },
          error: null,
        }),
      }),
    }),
  }))
  mockedCalculate.mockResolvedValue({
    bl_id: 'BL1',
    status: 'calculated',
    table_id: 1,
    line_count: 1,
    total_brl: 100,
    total_usd: 0,
    review_required: false,
    exempt: false,
    reason: '',
  })
  mockedCreateInvoice.mockResolvedValue({ invoice_id: 55 })
})

describe('tryAutoIssueInvoice', () => {
  it('reconhece a invoice emitida pelo gatilho server-side sem duplicar o cálculo', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              ce_mercante: '122605051526081',
              cargo_mode: 'container',
              customer_id: 99,
              customer_reconciliation_status: 'reconciled',
              financial_status: 'invoiced',
            },
            error: null,
          }),
        }),
      }),
    }))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({
      status: 'invoiced',
      invoiceResult: { idempotent: true, financial_status: 'invoiced' },
    })
    expect(mockedCalculate).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('reconhece a emissão que terminou durante o recálculo antes de tentar a segunda invoice', async () => {
    const pendingBl = {
      ce_mercante: '122605051526081',
      cargo_mode: 'container',
      customer_id: 99,
      customer_reconciliation_status: 'matched_document',
      review_status: 'reviewed',
      billing_hold_reason: null,
      charge_status: 'not_calculated',
      financial_status: 'pending',
    }
    const invoicedBl = { ...pendingBl, charge_status: 'ready_for_billing', financial_status: 'invoiced' }
    const query = (data: typeof pendingBl) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data, error: null }),
        }),
      }),
    })
    mockFrom
      .mockImplementationOnce(() => query(pendingBl))
      .mockImplementationOnce(() => query(invoicedBl))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({
      status: 'invoiced',
      invoiceResult: { idempotent: true, financial_status: 'invoiced' },
    })
    expect(mockedCalculate).toHaveBeenCalledWith('BL1', { actorId: 'user-1', recalculate: true })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('calcula taxas mesmo sem CE Mercante, mas bloqueia a emissao', async () => {
    mockFrom
      .mockImplementationOnce(() => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { ce_mercante: null, cargo_mode: 'container', customer_id: 99, customer_reconciliation_status: 'matched_document' },
              error: null,
            }),
          }),
        }),
      }))
      .mockImplementationOnce(() => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { ce_mercante: null, cargo_mode: 'container', customer_id: 99, customer_reconciliation_status: 'matched_document' },
              error: null,
            }),
          }),
        }),
      }))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({
      status: 'blocked',
      reason: 'awaiting_flow',
      message: 'Aguardando cadastro do CE Mercante para emitir a fatura (ADR 0020).',
      calculation: expect.objectContaining({ bl_id: 'BL1' }),
    })
    expect(mockedCalculate).toHaveBeenCalledWith('BL1', { actorId: 'user-1', recalculate: true })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('recalcula, marca pronto e emite a fatura para BL com taxas validas', async () => {
    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({ status: 'invoiced', invoiceResult: { invoice_id: 55 } })
    expect(mockedCalculate).toHaveBeenCalledWith('BL1', { actorId: 'user-1', recalculate: true })
    expect(mockedCreateInvoice).toHaveBeenCalledWith({
      blId: 'BL1',
      customerId: 99,
      actorId: 'user-1',
    })
    expect(mockResolveAlertItem).toHaveBeenCalledWith({
      type: 'billing_calculation_blocked',
      entityType: 'bl',
      entityId: 'BL1',
      source: 'billing_calculation',
      metadata: expect.objectContaining({ resolution: 'calculation_valid' }),
    })
    expect(mockResolveAlertItem).toHaveBeenCalledWith({
      type: 'billing_auto_issue_failed',
      entityType: 'bl',
      entityId: 'BL1',
      source: 'ce_auto_billing',
    })
  })

  it('bloqueia faturamento quando o recalculo ainda retorna pendencia de revisao', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1',
      status: 'review_required',
      table_id: 1,
      line_count: 1,
      total_brl: 0,
      total_usd: 0,
      review_required: true,
      exempt: false,
      reason: 'Peso BB ausente.',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({
      status: 'blocked',
      reason: 'awaiting_flow',
      message: 'Peso BB ausente.',
      calculation: {
        bl_id: 'BL1',
        status: 'review_required',
        table_id: 1,
        line_count: 1,
        total_brl: 0,
        total_usd: 0,
        review_required: true,
        exempt: false,
        reason: 'Peso BB ausente.',
      },
    })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('bloqueia faturamento quando nao ha valor faturavel', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1',
      status: 'calculated',
      table_id: 1,
      line_count: 1,
      total_brl: 0,
      total_usd: 0,
      review_required: false,
      exempt: false,
      reason: '',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({
      status: 'blocked',
      reason: 'calculation_blocked',
      message: 'B/L sem valor faturavel apos recalculo.',
      calculation: {
        bl_id: 'BL1',
        status: 'calculated',
        table_id: 1,
        line_count: 1,
        total_brl: 0,
        total_usd: 0,
        review_required: false,
        exempt: false,
        reason: '',
      },
    })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'billing_calculation_blocked',
      entityType: 'bl',
      entityId: 'BL1',
      metadata: expect.objectContaining({ reason: 'no_billable_value', correction_route: '/taxas-locais' }),
    }))
    expect(mockCreateAlert).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'billing_auto_issue_failed' }))
  })

  it('abre A2 para tabela ausente e leva metadados da tentativa autoritativa', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1',
      status: 'review_required',
      table_id: null,
      line_count: 0,
      total_brl: 0,
      total_usd: 0,
      review_required: true,
      exempt: false,
      reason: 'review:no_table',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'calculation_blocked' })
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'billing_calculation_blocked',
      entityType: 'bl',
      entityId: 'BL1',
      message: 'review:no_table',
      metadata: expect.objectContaining({ reason: 'review:no_table', table_id: null, correction_route: '/taxas-locais/tabelas' }),
    }))
  })

  it('abre A2 para peso invalido quando o RPC persiste o hold durante o calculo', async () => {
    const initialBl = {
      ...baseBl(),
      billing_hold_reason: null,
      charge_status: 'calculated',
    }
    const persistedBl = {
      ...initialBl,
      charge_status: 'review_required',
      billing_hold_reason: 'Pendencia de revisao nas taxas locais.',
    }
    const blQuery = (data: unknown) => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data, error: null }) }),
      }),
    })
    mockFrom
      .mockImplementationOnce(() => blQuery(initialBl))
      .mockImplementationOnce(() => blQuery(persistedBl))
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1',
      status: 'review_required',
      table_id: 1,
      line_count: 1,
      total_brl: 0,
      total_usd: 0,
      review_required: true,
      exempt: false,
      reason: 'review:weight_missing:42',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'calculation_blocked' })
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'billing_calculation_blocked',
      metadata: expect.objectContaining({
        reason: 'invalid_lines',
        calculation_status: 'review_required',
        persisted_charge_status: 'review_required',
        persisted_billing_hold_reason: 'Pendencia de revisao nas taxas locais.',
      }),
    }))
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('não abre A2 para retorno esperado de revisão operacional', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1',
      status: 'review_required',
      table_id: 1,
      line_count: 1,
      total_brl: 0,
      total_usd: 0,
      review_required: true,
      exempt: false,
      reason: 'Peso BB ausente.',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'awaiting_flow' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
  })

  it('abre A2 quando o estado autoritativo mantém revisão ou hold de cálculo', async () => {
    const pendingReviewBl = {
      ce_mercante: '122605051526081',
      cargo_mode: 'container',
      customer_id: 99,
      customer_reconciliation_status: 'matched_document',
      review_status: 'pending_review',
      billing_hold_reason: 'Tabela precisa de revisão',
    }
    const pendingReviewQuery = () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: pendingReviewBl, error: null }),
        }),
      }),
    })
    mockFrom
      .mockImplementationOnce(pendingReviewQuery)
      .mockImplementationOnce(pendingReviewQuery)
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1', status: 'calculated', table_id: 1, line_count: 1, total_brl: 100, total_usd: 0,
      review_required: false, exempt: false, reason: '',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'calculation_blocked', message: 'Tabela precisa de revisão' })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'billing_calculation_blocked',
      metadata: expect.objectContaining({ review_status: 'pending_review', billing_hold_reason: 'Tabela precisa de revisão' }),
    }))
  })

  it('retorna bloqueio com a mensagem da falha da invoice sem propagar excecao', async () => {
    mockedCreateInvoice.mockRejectedValueOnce(new Error('ledger failed'))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({ status: 'blocked', reason: 'rpc_error', message: 'ledger failed', unexpected: true, stage: 'emission' })
  })

  it('diferencia falha transitória de cálculo e não abre alerta de emissão', async () => {
    mockedCalculate.mockRejectedValueOnce(new Error('timeout no cálculo'))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({ status: 'blocked', reason: 'rpc_error', message: 'timeout no cálculo', unexpected: true, stage: 'calculation' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('não abre A2 quando o cálculo retorna um estado desconhecido', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1', status: 'not_calculated', table_id: null, line_count: 0, total_brl: 0, total_usd: 0,
      review_required: false, exempt: false, reason: '',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'rpc_error', stage: 'calculation' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('não transforma ausência de cliente em alerta ou tentativa de emissão', async () => {
    mockFrom.mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { ...baseBl(), customer_id: null, customer_reconciliation_status: 'pending' },
            error: null,
          }),
        }),
      }),
    }))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'awaiting_flow' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('não abre alerta para isenção ou qualquer awaiting_flow', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1', status: 'exempt', table_id: 1, line_count: 0, total_brl: 0, total_usd: 0,
      review_required: false, exempt: true, reason: 'Isento por contrato.',
    })

    const exemptResult = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })
    expect(exemptResult).toMatchObject({ status: 'blocked', reason: 'awaiting_flow' })

    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1', status: 'review_required', table_id: 1, line_count: 1, total_brl: 0, total_usd: 0,
      review_required: true, exempt: false, reason: 'Peso BB ausente.',
    })
    const awaitingResult = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(awaitingResult).toMatchObject({ status: 'blocked', reason: 'awaiting_flow' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('resolve A2 após cálculo válido e reabre quando a causa de cálculo volta', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1', status: 'calculated', table_id: 1, line_count: 1, total_brl: 0, total_usd: 0,
      review_required: false, exempt: false, reason: '',
    })
    await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'billing_calculation_blocked' }))

    mockedCalculate.mockResolvedValueOnce({ ...validCalculation() })
    await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })
    expect(mockResolveAlertItem).toHaveBeenCalledWith(expect.objectContaining({
      type: 'billing_calculation_blocked',
      metadata: expect.objectContaining({ resolution: 'calculation_valid' }),
    }))

    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1', status: 'calculated', table_id: 1, line_count: 1, total_brl: 0, total_usd: 0,
      review_required: false, exempt: false, reason: '',
    })
    await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })
    expect(mockCreateAlert).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'billing_calculation_blocked',
      metadata: expect.objectContaining({ reason: 'no_billable_value' }),
    }))
  })

  it('exige CE Mercante para carga solta', async () => {
    mockFrom
      .mockImplementationOnce(() => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { ce_mercante: null, cargo_mode: 'carga_solta', customer_id: 99, customer_reconciliation_status: 'matched_document' },
              error: null,
            }),
          }),
        }),
      }))
      .mockImplementationOnce(() => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { ce_mercante: null, cargo_mode: 'carga_solta', customer_id: 99, customer_reconciliation_status: 'matched_document' },
              error: null,
            }),
          }),
        }),
      }))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'awaiting_flow',
      message: 'Aguardando cadastro do CE Mercante para emitir a fatura (ADR 0020).',
    })
    expect(mockedCalculate).toHaveBeenCalledWith('BL1', { actorId: 'user-1', recalculate: true })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('não cria A2 quando o cliente ainda pertence ao fluxo de reconciliação', async () => {
    mockFrom.mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { ce_mercante: '122605051526081', cargo_mode: 'container', customer_id: null, customer_reconciliation_status: 'missing_customer' },
            error: null,
          }),
        }),
      }),
    }))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'awaiting_flow' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('não cria A2 para revisão de cliente do #520 mesmo com hold de reconciliação', async () => {
    const customerReviewBl = {
      ...baseBl(),
      review_status: 'pending_review',
      billing_hold_reason: 'Cliente exige reconciliacao manual antes do faturamento.',
    }
    const customerReviewQuery = () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: customerReviewBl, error: null }),
        }),
      }),
    })
    mockFrom
      .mockImplementationOnce(customerReviewQuery)
      .mockImplementationOnce(customerReviewQuery)

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'awaiting_flow' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('não cria A2 para isenção válida', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1', status: 'exempt', table_id: 1, line_count: 0, total_brl: 0, total_usd: 0,
      review_required: false, exempt: true, reason: 'Isento por contrato.',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toMatchObject({ status: 'blocked', reason: 'awaiting_flow' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })
})

describe('maybeAutoBillAfterCeMercante', () => {
  function mockBl(overrides: Record<string, unknown>) {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: 'BL1',
              customer_id: 99,
              customer_reconciliation_status: 'matched_document',
              cargo_mode: 'container',
              financial_status: 'pending',
              ce_mercante: '122605051526081',
              ...overrides,
            },
            error: null,
          }),
        }),
      }),
    }))
  }

  it('registra info e nao refatura quando o B/L ja esta faturado', async () => {
    mockBl({ financial_status: 'invoiced' })

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toBeNull()
    expect(mockedCalculate).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
    expect(mockLogOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ce_reimport_already_invoiced', entityId: 'BL1', changedBy: 'user-1' }),
    )
  })

  it('aceita reconciled no auto billing local', async () => {
    mockBl({ customer_reconciliation_status: 'reconciled' })
    mockedCalculate.mockReset()
    mockedCalculate.mockResolvedValue(validCalculation())

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toEqual({ status: 'invoiced', invoiceResult: { invoice_id: 55 } })
    expect(mockedCalculate).toHaveBeenCalledWith('BL1', { actorId: 'user-1', recalculate: true })
    expect(mockedCreateInvoice).toHaveBeenCalled()
  })

  it('dispara o auto faturamento de carga solta quando o CE foi cadastrado', async () => {
    mockBl({ id: 'BL-BB-1', cargo_mode: 'carga_solta' })
    mockedCalculate.mockReset()
    mockedCalculate.mockResolvedValue(validCalculation())

    const result = await maybeAutoBillAfterCeMercante('BL-BB-1', 'user-1')

    expect(result).toEqual({ status: 'invoiced', invoiceResult: { invoice_id: 55 } })
    expect(mockedCalculate).toHaveBeenCalledWith('BL-BB-1', { actorId: 'user-1', recalculate: true })
    expect(mockedCreateInvoice).toHaveBeenCalledWith({ blId: 'BL-BB-1', customerId: 99, actorId: 'user-1' })
  })

  it('deixa o resumo financeiro para o runner server-side após faturar o B/L', async () => {
    mockBl({ voyage_id: 7 })

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toEqual({ status: 'invoiced', invoiceResult: { invoice_id: 55 } })
    expect(mockDispatchCeMercanteTaxasCommunication).not.toHaveBeenCalled()
  })

  it('não tenta dispatch financeiro best-effort no navegador', async () => {
    mockBl({ voyage_id: 7 })
    await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(mockDispatchCeMercanteTaxasCommunication).not.toHaveBeenCalled()
  })

  it('registra falha inesperada quando a emissao lanca erro', async () => {
    mockBl({})
    mockedCreateInvoice.mockRejectedValueOnce(new Error('ledger failed'))

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toEqual({ status: 'blocked', reason: 'rpc_error', stage: 'emission', message: 'ledger failed', unexpected: true })
    expect(mockLogOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'bl_auto_billing_failed', entityId: 'BL1', changedBy: 'user-1' }),
    )
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'billing_auto_issue_failed', entityType: 'bl', entityId: 'BL1', message: 'ledger failed' }))
  })

  it('classifica falha de cálculo como calculation e não emite A2 de emissão', async () => {
    mockBl({})
    mockedCalculate.mockRejectedValueOnce(new Error('calculation failed'))

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toEqual({ status: 'blocked', reason: 'rpc_error', stage: 'calculation', message: 'calculation failed', unexpected: true })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
    expect(mockCreateAlert).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'billing_auto_issue_failed' }))
    expect(mockLogOperationalEvent).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'bl_auto_billing_failed' }))
  })

  it('fecha a falha de emissão válida e reabre na falha seguinte', async () => {
    mockBl({})
    mockedCreateInvoice.mockRejectedValueOnce(new Error('ledger failed'))
    await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    await maybeAutoBillAfterCeMercante('BL1', 'user-1')
    expect(mockResolveAlertItem).toHaveBeenCalledWith(expect.objectContaining({
      type: 'billing_auto_issue_failed',
      entityId: 'BL1',
    }))

    mockedCreateInvoice.mockRejectedValueOnce(new Error('ledger failed again'))
    await maybeAutoBillAfterCeMercante('BL1', 'user-1')
    expect(mockCreateAlert).toHaveBeenCalledTimes(2)
    expect(mockCreateAlert).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'billing_auto_issue_failed',
      message: 'ledger failed again',
    }))
  })

  it('alerta quando a emissao falha por ausencia de valor faturavel', async () => {
    mockBl({})
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1',
      status: 'calculated',
      table_id: 1,
      line_count: 1,
      total_brl: 0,
      total_usd: 0,
      review_required: false,
      exempt: false,
      reason: '',
    })

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toMatchObject({ status: 'blocked', reason: 'calculation_blocked', message: 'B/L sem valor faturavel apos recalculo.' })
    expect(result).not.toHaveProperty('unexpected')
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'billing_calculation_blocked', entityId: 'BL1' }))
    expect(mockCreateAlert).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'billing_auto_issue_failed' }))
  })

  it('classifica falha de consulta como lookup sem abrir alerta de emissão', async () => {
    mockFrom.mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: new Error('consulta indisponível') }) }),
      }),
    }))

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toMatchObject({ status: 'blocked', reason: 'rpc_error', stage: 'lookup' })
    expect(mockCreateAlert).not.toHaveBeenCalled()
    expect(mockedCalculate).not.toHaveBeenCalled()
  })
})

function baseBl() {
  return {
    ce_mercante: '122605051526081',
    cargo_mode: 'container',
    customer_id: 99,
    customer_reconciliation_status: 'matched_document',
    review_status: 'reviewed',
    billing_hold_reason: null,
  }
}

function validCalculation() {
  return {
    bl_id: 'BL1',
    status: 'calculated' as const,
    table_id: 1,
    line_count: 1,
    total_brl: 100,
    total_usd: 0,
    review_required: false,
    exempt: false,
    reason: '',
  }
}
