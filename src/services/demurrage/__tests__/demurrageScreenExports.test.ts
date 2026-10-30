import { describe, expect, it } from 'vitest'
import { containerTabSheetRows, customerTabSheetRows, invoiceTabSheetRows } from '../demurrageScreenExports'

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
    expect(invoiceTabSheetRows('canceladas', [invoice], details)[0]).toMatchObject({ Motivo: 'Erro de datas', 'Cancelada por': 'Ana', 'Destino das caixas': 'MSCU1: aguardando nova Invoice' })
  })

  it('Por Cliente traz as colunas da tela', () => {
    expect(Object.keys(customerTabSheetRows([{ customer_id: 1, customer_name: 'C', cnpj_cpf: null, correndo_usd: 1, a_emitir_usd: 2, esperando_usd: 6, travado_usd: 3, invoice_count: 1, open_usd: 4, open_brl: 5 }])[0]))
      .toEqual(['Cliente', 'CNPJ', 'Correndo (US$)', 'A emitir (US$)', 'Esperando (US$)', 'Travado (US$)', 'Invoices em aberto', 'Faturado em aberto (USD)', 'Faturado em aberto (BRL hoje)'])
  })
})
