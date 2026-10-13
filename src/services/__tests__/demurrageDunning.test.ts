import { describe, expect, it } from 'vitest'
import { getDemurrageDunningDisplay, nextDemurrageDunningAttemptNumber } from '../demurrageDunning'

const invoice = {
  id: 21,
  first_billed_at: '2026-09-01',
  paid_at: null,
  dispute_open: false,
  status: 'issued',
}

describe('estado da régua de Demurrage', () => {
  it('avança semanalmente além do sexto envio', () => {
    const attempts = Array.from({ length: 7 }, (_, index) => ({
      attemptDiscriminator: index + 1,
      status: 'enviado',
      createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
    }))
    const display = getDemurrageDunningDisplay(invoice, { attempts, intervalDays: 7 })

    expect(display.attemptCount).toBe(7)
    expect(display.nextAttemptNumber).toBe(8)
    expect(display.statusLabel).toContain('8ª cobrança')
    expect(nextDemurrageDunningAttemptNumber(attempts)).toBe(8)
  })

  it('pausa por disputa, contato inválido e encerra após pagamento', () => {
    expect(getDemurrageDunningDisplay(invoice, { hasValidContact: true }).statusLabel).toContain('1ª cobrança')
    expect(getDemurrageDunningDisplay({ ...invoice, dispute_open: true }).statusLabel).toBe('Pausada: disputa aberta')
    expect(getDemurrageDunningDisplay(invoice, { hasValidContact: false }).statusLabel).toBe('Pausada: cliente sem contatos válidos')
    expect(getDemurrageDunningDisplay({ ...invoice, paid_at: '2026-09-03' }).statusLabel).toBe('Régua encerrada: liquidada')
    expect(getDemurrageDunningDisplay({ ...invoice, status: 'cancelled' }).statusLabel).toBe('Régua encerrada: cancelada')
  })

  it('preserva o dia de uma data DATE ao formatar a próxima cobrança', () => {
    const display = getDemurrageDunningDisplay(invoice, { attemptCount: 1, intervalDays: 7 })

    expect(display.nextDate).toBe('2026-09-08T12:00:00.000Z')
    expect(display.statusLabel).toContain('08/09/2026')
  })
})

describe('Invoice tirada da Régua por datas alteradas', () => {
  it('não promete a próxima cobrança: a Régua não cobra Invoice suspensa (migrations 179, 203 e 214)', () => {
    const display = getDemurrageDunningDisplay(
      { ...invoice, dunning_suspended_reason: 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.' },
      { attempts: [], intervalDays: 7, hasValidContact: true },
    )
    expect(display.pauseReason).toBe('datas alteradas, aguarda tratamento')
    expect(display.nextDate).toBeNull()
    expect(display.statusLabel).toBe('Pausada: datas alteradas, aguarda tratamento')
  })
})
