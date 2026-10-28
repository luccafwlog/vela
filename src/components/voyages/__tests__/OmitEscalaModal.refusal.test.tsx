// @vitest-environment jsdom
// Decisão do dono de 2026-10-28 (P4 da situação S4.21, regra VIA-070): quando
// o banco recusa a omissão, a janela mostra o motivo em vez de "Falha ao omitir
// a escala.", sem expor diagnóstico técnico.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { omitVoyageEscala } = vi.hoisted(() => ({ omitVoyageEscala: vi.fn() }))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../services/transshipments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/transshipments')>()),
  omitVoyageEscala: (input: unknown) => omitVoyageEscala(input),
}))

import { OmitEscalaModal } from '../OmitEscalaModal'

async function omitWith(error: unknown) {
  omitVoyageEscala.mockRejectedValue(error)
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OmitEscalaModal open onClose={onClose} voyageId={7} omittedPod="BRSSA" candidateDischargePods={['BRVIX']} affectedBlNumbers={['BL-1']} />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'Omitir escala' }))
  await user.click(screen.getByRole('button', { name: 'Confirmar omissão' }))
  return { onClose, alert: await screen.findByRole('alert') }
}

describe('OmitEscalaModal - recusa do banco', () => {
  afterEach(cleanup)
  beforeEach(() => {
    omitVoyageEscala.mockReset()
  })

  it('mostra o motivo da recusa e não fecha a janela', async () => {
    const { onClose, alert } = await omitWith({ code: '23505', message: 'A escala da viagem 7 ja foi omitida para o POD BRSSA.', details: null, hint: null })

    expect(alert.textContent).toBe('A escala da viagem 7 ja foi omitida para o POD BRSSA.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('falha técnica não expõe o diagnóstico', async () => {
    const { alert } = await omitWith({ code: '42883', message: 'function public.omit_voyage_escala(bigint) does not exist', details: null, hint: null })

    expect(alert.textContent).toBe('Falha ao omitir a escala. Tente novamente.')
  })
})
