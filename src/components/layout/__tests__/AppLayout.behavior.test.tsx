// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from '../AppLayout'

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    profile: { full_name: 'Operador de teste' },
    isAdmin: true,
    signOut: vi.fn(),
  }),
}))

vi.mock('../../../hooks/useOperationalCounts', () => ({
  useOperationalCounts: () => ({
    pendingReview: 0,
    chargeReviewRequired: 0,
    readyForBilling: 0,
    openAlerts: 0,
    blsWithoutCustomer: 0,
  }),
}))

vi.mock('../HeaderInfoBar', () => ({ HeaderInfoBar: () => null }))
vi.mock('../InternalNotificationBell', () => ({ InternalNotificationBell: () => null }))
vi.mock('../../ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/painel']}>
      <Routes>
        <Route path="*" element={<AppLayout />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppLayout (navegação visível)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  it('renderiza Admin como link direto para a tela completa, sem dropdown', () => {
    renderLayout()

    expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('/admin')
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull()
  })

  it('fecha o dropdown de Importação com Escape e restaura o foco no gatilho', () => {
    renderLayout()

    const trigger = screen.getByRole('button', { name: /Importação/ })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(trigger, { key: 'Escape' })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('restaura o foco no botão da conta ao fechar o menu com Escape', () => {
    renderLayout()

    const account = screen.getByRole('button', { name: 'Operador de teste' })
    fireEvent.click(account)
    expect(screen.getByRole('button', { name: 'Meu perfil' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(account.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(account)
  })
})
