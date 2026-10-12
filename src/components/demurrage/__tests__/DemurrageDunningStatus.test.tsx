// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DemurrageDunningStatus } from '../DemurrageDunningStatus'

describe('DemurrageDunningStatus', () => {
  it('mostra ponto da régua e próxima data', () => {
    render(<DemurrageDunningStatus display={{
      invoiceId: 1,
      attemptCount: 3,
      nextAttemptNumber: 4,
      nextDate: '2026-09-08T00:00:00.000Z',
      statusLabel: '4ª cobrança, próxima em 08/09/2026',
      pauseReason: null,
      lastAttemptAt: '2026-09-01T10:00:00Z',
    }} />)

    expect(screen.getByTestId('demurrage-dunning-status').textContent).toContain('4ª cobrança')
    expect(screen.getByTestId('demurrage-dunning-status').textContent).toContain('08/09')
  })

  it('mostra os motivos de pausa', () => {
    const { rerender } = render(<DemurrageDunningStatus display={{
      invoiceId: 1, attemptCount: 1, nextAttemptNumber: 2, nextDate: null,
      statusLabel: 'Pausada: disputa aberta', pauseReason: 'disputa aberta', lastAttemptAt: null,
    }} />)
    expect(screen.getByText('Pausada: disputa aberta')).toBeTruthy()
    rerender(<DemurrageDunningStatus display={{
      invoiceId: 1, attemptCount: 1, nextAttemptNumber: 2, nextDate: null,
      statusLabel: 'Pausada: cliente sem contatos válidos', pauseReason: 'cliente sem contatos válidos', lastAttemptAt: null,
    }} />)
    expect(screen.getByText('Pausada: cliente sem contatos válidos')).toBeTruthy()
  })

  it('expõe carregamento e falha sem fabricar um status da régua', () => {
    const { rerender } = render(<DemurrageDunningStatus loading />)
    expect(screen.getByText('Verificando a Régua…')).toBeTruthy()

    rerender(<DemurrageDunningStatus error />)
    expect(screen.getByText('Régua indisponível')).toBeTruthy()
  })
})
