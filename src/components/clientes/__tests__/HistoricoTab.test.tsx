// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  timeline: { data: undefined as unknown, isLoading: false, isError: false },
}))

vi.mock('../../../hooks/useCustomerFicha', () => ({
  useCustomerTimeline: () => mocks.timeline,
}))

import { HistoricoTab } from '../HistoricoTab'

const baseData = { id: 101, customer_contacts: [], bls: [] } as never

afterEach(() => {
  cleanup()
  mocks.timeline = { data: undefined, isLoading: false, isError: false }
})

describe('HistoricoTab', () => {
  it('mostra erro explicito, nao "sem eventos registrados", quando a timeline falha', () => {
    mocks.timeline = { data: undefined, isLoading: false, isError: true }
    render(<MemoryRouter><HistoricoTab data={baseData} /></MemoryRouter>)
    expect(screen.getByText('Não foi possível carregar o histórico.')).toBeTruthy()
    expect(screen.queryByText('Sem eventos registrados.')).toBeNull()
  })

  it('renderiza evento de contact_configuration_changed com label e detalhe sem link', () => {
    mocks.timeline = {
      data: [
        {
          kind: 'contact_configuration_changed',
          sourceId: 'action-123',
          at: '2026-08-10T14:30:00Z',
          label: 'Contatos: alteração via Portal',
          detail: 'Autoatendimento portal · 2 contato(s), 3 caixa(s)',
          link: null,
        },
      ],
      isLoading: false,
      isError: false,
    }
    render(<MemoryRouter><HistoricoTab data={baseData} /></MemoryRouter>)

    expect(screen.getByText('Contatos: alteração via Portal')).toBeTruthy()
    expect(screen.getByText('Autoatendimento portal · 2 contato(s), 3 caixa(s)')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Contatos: alteração/i })).toBeNull()
  })
})
