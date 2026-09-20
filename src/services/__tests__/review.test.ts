import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyInlineBlReviewFix, ConcurrentEditError, saveBlReview } from '../review'

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}))

describe('review service', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('rejeita valor numerico invalido antes de chamar o RPC', async () => {
    await expect(
      saveBlReview({
        blId: 'BL001',
        original: {
          shipper: 'SHIPPER',
          consignee: 'CNEE',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 100,
          total_cbm: 20,
          bb_weight_ton: null,
          bb_cbm: null,
          notes: null,
        },
        values: {
          shipper: 'SHIPPER',
          consignee: 'CNEE',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 'abc' as unknown as number,
          total_cbm: 20,
          bb_weight_ton: null,
          bb_cbm: null,
          notes: null,
        },
        customerId: null,
        previousCustomerId: null,
        changedBy: 'user-1',
        justification: 'Teste',
        expectedUpdatedAt: '2026-04-13T00:00:00.000Z',
      }),
    ).rejects.toThrow('Valor invalido para total_weight_kg')

    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('rejeita revisao sem versao antes de chamar o RPC', async () => {
    await expect(
      applyInlineBlReviewFix({
        blId: 'BL001',
        field: 'bb_weight_ton',
        value: 10,
        previousValue: null,
        changedBy: 'user-1',
        expectedUpdatedAt: null,
      }),
    ).rejects.toThrow('Recarregue o B/L antes de salvar')

    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('mapeia conflito concorrente para ConcurrentEditError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PT409', message: 'conflito concorrente' },
    })

    await expect(
      saveBlReview({
        blId: 'BL001',
        original: {
          shipper: 'SHIPPER',
          consignee: 'CNEE',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 100,
          total_cbm: 20,
          bb_weight_ton: null,
          bb_cbm: null,
          notes: null,
        },
        values: {
          shipper: 'NOVO SHIPPER',
          consignee: 'CNEE',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 100,
          total_cbm: 20,
          bb_weight_ton: null,
          bb_cbm: null,
          notes: null,
        },
        customerId: null,
        previousCustomerId: null,
        changedBy: 'user-1',
        justification: 'Teste',
        expectedUpdatedAt: '2026-04-13T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConcurrentEditError)
  })

  it('deixa o banco decidir e auditar o review_status ao salvar', async () => {
    mockRpc.mockResolvedValue({
      data: {
        updated_at: '2026-06-19T00:00:00.000Z',
        review_status: 'pending_review',
        pendencias: ['Acesso ao portal nao provisionado'],
      },
      error: null,
    })

    await saveBlReview({
      blId: 'BL001',
      original: {
        shipper: 'SHIPPER',
        consignee: 'CNEE',
        pol: 'CNTAC',
        pod: 'BRVIT',
        total_weight_kg: 100,
        total_cbm: 20,
        bb_weight_ton: null,
        bb_cbm: null,
        notes: null,
      },
      values: {
        shipper: 'NOVO SHIPPER',
        consignee: 'CNEE',
        pol: 'CNTAC',
        pod: 'BRVIT',
        total_weight_kg: 100,
        total_cbm: 20,
        bb_weight_ton: null,
        bb_cbm: null,
        notes: null,
      },
      customerId: null,
      previousCustomerId: null,
      changedBy: 'user-1',
      justification: 'Teste',
      expectedUpdatedAt: '2026-04-13T00:00:00.000Z',
    })

    expect(mockRpc).toHaveBeenCalledWith(
      'save_bl_review',
      expect.objectContaining({
        p_update_payload: { shipper: 'NOVO SHIPPER' },
        p_audit_rows: [
          expect.objectContaining({
            field_name: 'shipper',
          }),
        ],
      }),
    )
  })

  it('deixa o banco decidir e auditar o review_status na correcao inline', async () => {
    mockRpc.mockResolvedValue({
      data: {
        updated_at: '2026-06-19T00:00:00.000Z',
        review_status: 'reviewed',
        pendencias: [],
      },
      error: null,
    })

    await applyInlineBlReviewFix({
      blId: 'BL001',
      field: 'bb_weight_ton',
      value: 10,
      previousValue: null,
      changedBy: 'user-1',
      expectedUpdatedAt: '2026-04-13T00:00:00.000Z',
    })

    expect(mockRpc).toHaveBeenCalledWith(
      'save_bl_review',
      expect.objectContaining({
        p_update_payload: { bb_weight_ton: 10 },
        p_audit_rows: [
          expect.objectContaining({
            field_name: 'bb_weight_ton',
          }),
        ],
      }),
    )
  })
})
