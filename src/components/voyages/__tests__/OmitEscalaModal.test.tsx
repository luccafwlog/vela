// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mutateAsync, useAuthMock } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('../../../hooks/useTransshipments', () => ({
  useOmitEscala: () => ({ mutateAsync, reset: () => {}, isError: false, isPending: false }),
}))

import { OmitEscalaModal } from '../OmitEscalaModal'

afterEach(cleanup)

describe('OmitEscalaModal', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: 'user-1' } })
    mutateAsync.mockResolvedValue(undefined)
  })

  it('exibe o resumo e só executa a omissão após confirmação explícita', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <OmitEscalaModal
        open
        onClose={onClose}
        voyageId={7}
        omittedPod="Salvador"
        candidateDischargePods={["Vitória"]}
        affectedBlNumbers={['BL-001', 'BL-002', 'BL-003']}
      />,
    )

    await user.type(screen.getByLabelText('Motivo (opcional)'), 'Armador alterou a rota')
    await user.click(screen.getByRole('button', { name: 'Omitir escala' }))

    expect(mutateAsync).not.toHaveBeenCalled()
    const confirmButton = screen.getByRole('button', { name: 'Confirmar omissão' })
    expect(screen.getByText('Escala omitida: Salvador')).toBeTruthy()
    expect(screen.getByText('Porto de descarga: Vitória')).toBeTruthy()
    expect(document.activeElement).toBe(confirmButton)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    await user.click(screen.getByText('Ver B/Ls afetados (3)'))
    expect(screen.getByText('BL-001')).toBeTruthy()
    expect(screen.getByText(/clientes vinculados recebem uma notificação no Portal/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    const omitButton = screen.getByRole('button', { name: 'Omitir escala' })
    expect(document.activeElement).toBe(omitButton)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    await user.click(omitButton)
    await user.click(screen.getByRole('button', { name: 'Confirmar omissão' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      voyageId: 7,
      omittedPod: 'Salvador',
      dischargePod: 'Vitória',
      reason: 'Armador alterou a rota',
      onwardVesselName: null,
      onwardCarrier: null,
      onwardVoyageNumber: null,
      onwardEtd: null,
      onwardEta: null,
      changedBy: 'user-1',
    }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('OmitEscalaModal — decisões do dono (lote 9)', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: 'user-1' } })
  })

  it('02-viagens-adr:15: não oferece o porto omitido como Porto de Transbordo', () => {
    render(<OmitEscalaModal open onClose={vi.fn()} voyageId={7} omittedPod="BRVIX" candidateDischargePods={['BRVIX']} affectedBlNumbers={[]} />)
    expect(screen.queryByRole('option', { name: 'BRVIX' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/Cadastre antes a escala onde a carga será descarregada/)
  })

  it('02-viagens-adr:3: a confirmação diz que qualquer setor reverte e que o histórico fica', async () => {
    const user = userEvent.setup()
    render(<OmitEscalaModal open onClose={vi.fn()} voyageId={7} omittedPod="BRSSA" candidateDischargePods={['BRVIX']} affectedBlNumbers={['BL-1']} />)
    await user.type(screen.getByLabelText(/Motivo/i), 'Armador omitiu')
    await user.click(screen.getByRole('button', { name: /Omitir|Continuar|Revisar/ }))
    expect(screen.getByText(/Qualquer setor pode reverter a omissão/)).toBeTruthy()
    expect(screen.queryByText(/pelo Administrativo/)).toBeNull()
  })
})
