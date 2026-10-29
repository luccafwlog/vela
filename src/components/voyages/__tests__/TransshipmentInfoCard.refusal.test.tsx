// @vitest-environment jsdom
// Decisão do dono de 2026-10-28 (P4 da situação S4.21, regra VIA-070): quando
// o banco recusa Complementar ou Reverter omissão, o card mostra o motivo; a
// frase de B/L em COD só complementa a recusa que é de fato por COD.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { updateVoyageOmission, revertVoyageOmission } = vi.hoisted(() => ({
  updateVoyageOmission: vi.fn(),
  revertVoyageOmission: vi.fn(),
}))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, isAdmin: false }) }))
vi.mock('../../../services/transshipments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/transshipments')>()),
  listVoyageOmissions: async () => [{
    id: 9,
    voyageId: 2,
    omittedPod: 'BRVIX',
    dischargePod: 'BRSSZ',
    reason: null,
    onwardVesselName: null,
    onwardCarrier: null,
    onwardVoyageNumber: null,
    onwardEtd: null,
    onwardEta: null,
  }],
  listBlTransshipments: async () => [
    { id: 1, blId: 'BL-1', omissionId: 9, disposition: 'cod' },
    { id: 2, blId: 'BL-2', omissionId: 9, disposition: 'transshipment' },
  ],
  updateVoyageOmission: (input: unknown) => updateVoyageOmission(input),
  revertVoyageOmission: (input: unknown) => revertVoyageOmission(input),
}))

import { TransshipmentInfoCard } from '../TransshipmentInfoCard'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

async function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ConfirmDialogProvider><TransshipmentInfoCard voyageId={2} /></ConfirmDialogProvider>
    </QueryClientProvider>,
  )
  await screen.findByText('Informações de Transbordo')
}

async function revertWith(error: unknown) {
  revertVoyageOmission.mockRejectedValue(error)
  await renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Reverter omissão' }))
  const dialog = screen.getByRole('dialog', { name: 'Reverter omissão de escala' })
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'POD informado incorretamente' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reverter omissão' }))
  return { dialog, alert: await within(dialog).findByRole('alert') }
}

describe('TransshipmentInfoCard - recusa do banco', () => {
  afterEach(cleanup)
  beforeEach(() => {
    updateVoyageOmission.mockReset()
    revertVoyageOmission.mockReset()
  })

  it('Complementar recusado mostra o motivo e mantém o formulário aberto', async () => {
    updateVoyageOmission.mockRejectedValue({ code: '42501', message: 'Usuário sem permissão ativa.', details: null, hint: null })
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Complementar' }))
    fireEvent.change(screen.getByLabelText('Armador de Transbordo'), { target: { value: 'COSCO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar informações' }))
    const confirmDialog = await screen.findByRole('dialog', { name: 'Confirmar informações de transbordo' })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Salvar informações' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Usuário sem permissão ativa.')
    expect(screen.getByLabelText('Armador de Transbordo')).toBeTruthy()
  })

  it('Reverter omissão recusado por B/L em COD mostra o motivo e a frase de COD', async () => {
    const { alert } = await revertWith({ code: '22023', message: 'Nao e possivel reverter a omissao: 1 B/L(s) afetado(s) estao em COD.', details: null, hint: null })

    expect(alert.textContent).toBe('Nao e possivel reverter a omissao: 1 B/L(s) afetado(s) estao em COD. Verifique se algum B/L está em COD.')
  })

  it('Reverter omissão recusado por outro motivo mostra só esse motivo, e reabrir não repete a recusa', async () => {
    const { dialog, alert } = await revertWith({ code: '22023', message: 'Omissao 9 ja foi revertida.', details: null, hint: null })

    expect(alert.textContent).toBe('Omissao 9 ja foi revertida.')
    expect(alert.textContent).not.toContain('COD')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reverter omissão de escala' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Reverter omissão' }))
    expect(within(screen.getByRole('dialog', { name: 'Reverter omissão de escala' })).queryByRole('alert')).toBeNull()
  })
})
