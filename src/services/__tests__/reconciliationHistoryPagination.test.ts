import { beforeEach, expect, it, vi } from 'vitest'
import { listReconciliationHistory } from '../reconciliacao'

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { rpc: mockRpc },
}))

// Linha como `list_payment_history` (migration 553) devolve: uma por baixa e B/L.
function rpcRow(patch: Record<string, unknown>) {
  return {
    source: 'local', invoice_id: 1, doc_number: 'INV-1', invoice_type: 'individual', invoice_status: 'paid',
    invoice_total_brl: 100, invoice_balance_brl: 0, customer_name: 'Cliente', customer_cnpj: '123',
    payment_id: 1, paid_at: '2026-01-01T10:00:00+00:00', payment_amount_brl: 100, method: 'manual', bank_reference: null,
    bl_id: 'BL-1', bl_count: 1, bl_amount_brl: 100, amount_brl: 100, pod: 'BRVIT', voyage_number: 'V1', vessel_name: 'Navio',
    ...patch,
  }
}

beforeEach(() => {
  mockRpc.mockReset()
})

it('lê as baixas pela RPC, com o Cliente no servidor e os demais filtros sobre a lista inteira', async () => {
  const many = Array.from({ length: 1200 }, (_, index) => rpcRow({ payment_id: index + 1, bl_id: `OTHER-${index}` }))
  mockRpc.mockResolvedValue({ data: [...many, rpcRow({ payment_id: 5000, bl_id: 'TARGET-BL' })], error: null })

  const result = await listReconciliationHistory({ blSearch: 'TARGET', customerId: '7', page: 1, pageSize: 50 })

  expect(mockRpc).toHaveBeenCalledWith('list_payment_history', { p_customer_id: 7 })
  expect(result.rows.map((r) => r.blId)).toEqual(['TARGET-BL'])
  expect(result.totalCount).toBe(1)
})

it('lista a avulsa sem B/L com o navio e a viagem dela e a forma da baixa', async () => {
  mockRpc.mockResolvedValue({
    data: [rpcRow({ invoice_id: 42, doc_number: 'INV-AV-42', invoice_type: 'manual', bl_id: null, bl_count: 0,
      voyage_number: '42N', vessel_name: 'Navio Manual', method: 'itau', bank_reference: 'E42' })],
    error: null,
  })

  const result = await listReconciliationHistory({ invoiceTypeFilter: 'manual' })

  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]).toMatchObject({ invoiceType: 'manual', blId: '-', blCount: 0, vesselName: 'Navio Manual', voyageNumber: '42N',
    method: 'itau', bankReference: 'E42' })
})

it('filtra pela forma da baixa e mantém juntas as linhas de B/L da mesma baixa', async () => {
  mockRpc.mockResolvedValue({
    data: [
      rpcRow({ payment_id: 11, invoice_id: 20, bl_id: 'B', amount_brl: 0.5, payment_amount_brl: 1.5, method: 'itau', paid_at: '2026-10-30T18:18:15+00:00' }),
      rpcRow({ payment_id: 9, invoice_id: 17, bl_id: 'A', amount_brl: 2469, method: 'manual', paid_at: '2026-10-30T15:00:00+00:00' }),
      rpcRow({ payment_id: 11, invoice_id: 20, bl_id: 'A', amount_brl: 1, payment_amount_brl: 1.5, method: 'itau', paid_at: '2026-10-30T18:18:15+00:00' }),
    ],
    error: null,
  })

  const all = await listReconciliationHistory({})
  expect(all.rows.map((r) => `${r.paymentId}-${r.blId}`)).toEqual(['11-A', '11-B', '9-A'])
  expect(all.summary).toMatchObject({ payments: 2, received: 2470.5 })

  const itau = await listReconciliationHistory({ method: 'itau' })
  expect(itau.rows.map((r) => r.amount)).toEqual([1, 0.5])
  expect(itau.summary).toMatchObject({ payments: 1, received: 1.5, itau: { payments: 1, received: 1.5 } })
})

it('erro da RPC falha a leitura em vez de devolver lista vazia', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'Sem permissão para consultar o histórico de baixas.' } })
  await expect(listReconciliationHistory({})).rejects.toMatchObject({ message: 'Sem permissão para consultar o histórico de baixas.' })
})

it('o filtro de data usa o dia de Brasília que a coluna Pago em mostra', async () => {
  mockRpc.mockResolvedValue({
    data: [
      // 22:30 de 30/10 em Brasília: no UTC já é 31/10.
      rpcRow({ payment_id: 21, invoice_id: 30, bl_id: 'NOITE', method: 'itau', paid_at: '2026-10-31T01:30:12.5+00:00' }),
      // Extrato: o dia 31/10 gravado como meia-noite UTC continua 31/10.
      rpcRow({ payment_id: 22, invoice_id: 31, bl_id: 'EXTRATO', method: 'extract', paid_at: '2026-10-31T00:00:00+00:00' }),
    ],
    error: null,
  })

  const day30 = await listReconciliationHistory({ paidFrom: '2026-10-30', paidTo: '2026-10-30' })
  expect(day30.rows.map((r) => r.blId)).toEqual(['NOITE'])
  const day31 = await listReconciliationHistory({ paidFrom: '2026-10-31', paidTo: '2026-10-31' })
  expect(day31.rows.map((r) => r.blId)).toEqual(['EXTRATO'])
})
