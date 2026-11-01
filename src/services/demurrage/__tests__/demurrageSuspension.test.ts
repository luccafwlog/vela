import { describe, expect, it } from 'vitest'
import { staleSuspensionCause } from '../demurrageSuspension'
import { demurrageInvoiceNotices } from '../demurragePresentation'
import { demurrageDunningPauseReason } from '../../demurrageDunning'

// Migration 524 (decisão do dono de 2026-10-30): o motivo de a Invoice estar
// fora da Régua diz a causa — datas, SOC ou divisão da caixa.
describe('motivo da suspensão pela causa', () => {
  const soc = 'Container passou a SOC depois do pagamento; conferir a diferença.'
  const split = 'Divisão da caixa entre Clientes alterada em Invoice com desconto ou disputa; reemitir à mão.'

  it('reconhece a causa e se a Invoice está paga', () => {
    expect(staleSuspensionCause(soc)).toEqual({ cause: 'Container passou a SOC', paid: true })
    expect(staleSuspensionCause(split)).toEqual({ cause: 'Divisão da caixa entre Clientes alterada', paid: false })
    expect(staleSuspensionCause('Datas de container alteradas depois do pagamento; conferir a diferença.')?.cause).toBe('Datas de container alteradas')
    expect(staleSuspensionCause('Cobrança recusada pelo provedor de e-mail.')).toBeNull()
  })

  it('o aviso e a coluna da Régua dizem a causa', () => {
    const [notice] = demurrageInvoiceNotices({ status: 'paid', dunning_suspended_reason: soc, dispute_open: false, roe_source: null, paid_at: '2026-10-01' } as never)
    expect(notice.title).toBe('Fora da Régua: container passou a SOC depois do pagamento')
    expect(demurrageDunningPauseReason({ paid_at: null, dunning_suspended_reason: split, dispute_open: false } as never, true)).toBe('divisão do container alterada, aguarda tratamento')
  })
})
