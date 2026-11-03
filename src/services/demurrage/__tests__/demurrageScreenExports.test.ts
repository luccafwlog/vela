import { describe, expect, it } from 'vitest'
import { containerTabSheetRows, customerTabSheetRows, disputeTabSheetRows, invoiceTabSheetRows } from '../demurrageScreenExports'

// ADR 0112, D14: o Exportar de cada aba traz o que a tela mostra.
describe('Exportar das abas da central de Demurrage', () => {
  it('Containers: uma linha por grupo, com contagem, US$ e próximo passo', () => {
    const group = {
      anchor_bl_id: 'BL-1', bl_ids: ['BL-1', 'BL-2'], voyage_id: 1, voyage_label: 'NAVIO / 1', customer_id: 1, customer_name: 'Cliente', customer_cnpj: null,
      division: 'a_emitir', reason_code: null, reason: null, warning: null, no_rate_types: null, usd: 940,
      boxes: [{ return_date: '2026-10-01', state: 'returned_overstay' }, { return_date: '2026-10-02', state: 'covered' }],
    } as never
    expect(containerTabSheetRows([group], 'a_emitir')).toEqual([{
      Divisão: 'A emitir', 'B/L': 'BL-1', 'B/Ls do grupo': 'BL-1, BL-2', Cliente: 'Cliente', 'Navio / Viagem': 'NAVIO / 1',
      'Containers fora': 0, 'Containers devolvidos': 2, 'Containers do grupo': 2, 'US$ previsto hoje': 940, 'Próximo passo / motivo': 'Gerar Invoice complementar',
    }])
  })

  it('Pagas e Canceladas trazem as colunas próprias da aba', () => {
    const invoice = { id: 7, doc_number: 'DEM-7', bl_id: 'BL-1', billed_at: '2026-10-01T12:00:00Z', paid_at: '2026-10-05', total_usd: 100, current_total_brl: 550, payment_method: 'extrato', customer: { name: 'Cliente' } } as never
    const details = new Map([[7, { paymentRoe: 5.5, cancelReason: 'Erro de datas', cancelledBy: 'Ana', cancelledAt: '2026-10-06T12:00:00Z', destinations: [{ kind: 'aguardando' as const, invoice_id: null, doc_number: null, containers: ['MSCU1'] }] }]])
    expect(invoiceTabSheetRows('pagas', [invoice], details)[0]).toMatchObject({ 'Dias até pagar': 4, 'USD pago': 100, 'ROE do pagamento': 5.5, 'Meio de pagamento': 'Extrato' })
    expect(invoiceTabSheetRows('canceladas', [invoice], details)[0]).toMatchObject({ Motivo: 'Erro de datas', 'Cancelada por': 'Ana', 'Destino dos containers': 'MSCU1: aguardando nova Invoice' })
  })

  it('Por Cliente traz as colunas da tela', () => {
    expect(Object.keys(customerTabSheetRows([{ customer_id: 1, customer_name: 'C', cnpj_cpf: null, correndo_usd: 1, a_emitir_usd: 2, esperando_usd: 6, travado_usd: 3, travado_sem_valor: 0, invoice_count: 1, open_usd: 4, open_brl: 5 }])[0]))
      .toEqual(['Cliente', 'CNPJ', 'Correndo (US$)', 'A emitir (US$)', 'Esperando (US$)', 'Travado (US$)', 'Travado sem valor (grupos)', 'Invoices em aberto', 'Faturado em aberto (USD)', 'Faturado em aberto (BRL hoje)'])
  })

  it('Disputas trazem a Invoice, o valor líquido, a vez e o prazo de resposta', () => {
    const [row] = disputeTabSheetRows([{
      id: 1, demurrage_invoice_id: 2, doc_number: 'DEM-2026-0001', customer_id: 3, customer_name: 'ACME', state: 'aberta',
      next_responder: 'equipamentos', subject: null, created_at: '2026-10-28T12:00:00Z', updated_at: '2026-10-28T12:00:00Z', messages: [],
      invoice_status: 'issued', invoice_total_usd: 1000, invoice_discount_mode: 'amount', invoice_discount_value: 100,
      invoice_current_total_brl: 4950, due_at: '2026-10-29T12:00:00Z', overdue: true,
    }])
    expect(row).toMatchObject({ Invoice: 'DEM-2026-0001', Cliente: 'ACME', 'USD em disputa': 900, 'BRL hoje': 4950,
      Disputa: 'Aberta', Vez: 'Aguarda a nossa resposta', 'Fora do prazo': 'Sim' })
  })
})
