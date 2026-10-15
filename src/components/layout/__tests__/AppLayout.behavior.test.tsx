// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from '../AppLayout'

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    profile: { full_name: 'Operador de teste', role: 'administrativo' },
    isAdmin: true,
    signOut: vi.fn(),
  }),
}))

vi.mock('../../../hooks/useOperationalCounts', () => ({
  useOperationalCounts: () => ({
    pendingReview: 0,
    chargeReviewRequired: 0,
    readyForBilling: 0,
    openAlerts: 4,
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
    window.localStorage.clear()
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

    const account = screen.getByRole('button', { name: /Operador de teste/ })
    fireEvent.click(account)
    expect(screen.getByRole('button', { name: 'Meu perfil' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(account.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(account)
  })

  it('no celular, Menu no cabeçalho trava a rolagem e Escape fecha primeiro o grupo, depois o menu', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    renderLayout()

    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(menu.closest('header')).toBeTruthy()
    fireEvent.click(menu)
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    // A lista vem antes do botão no documento: o foco entra nela ao abrir.
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Painel' }))

    const importacao = screen.getByRole('button', { name: /Importação/ })
    fireEvent.click(importacao)
    fireEvent.keyDown(importacao, { key: 'Escape' })
    expect(importacao.getAttribute('aria-expanded')).toBe('false')
    expect(menu.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(menu)
    expect(document.body.style.overflow).toBe('')
  })

  it('reúne marca, navegação e conta numa barra só, com a versão no menu da conta', () => {
    renderLayout()

    const header = screen.getByRole('banner')
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(header.contains(nav)).toBe(true)
    expect(screen.getByRole('button', { name: 'Vela — ir para o Painel' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Operador de teste/ }))
    expect(screen.getByText('Administrativo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
  })

  it('troca a posição do menu só pelo menu da conta e guarda a escolha', () => {
    const { unmount } = renderLayout()

    // Sem escolha salva, o menu fica no topo e não há outro botão de troca.
    expect(screen.getByRole('banner').contains(screen.getByRole('navigation', { name: 'Navegação principal' }))).toBe(true)
    expect(screen.queryByRole('button', { name: /lateral/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Operador de teste/ }))
    const group = screen.getByRole('group', { name: 'Posição do menu' })
    expect(within(group).getByRole('button', { name: /No topo/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(group).getByRole('button', { name: /Lateral fixa/ }))

    // A barra do topo sai; a navegação e a conta passam para a lateral.
    expect(screen.queryByRole('banner')).toBeNull()
    const sidebar = screen.getByRole('complementary', { name: 'Menu do Vela' })
    expect(sidebar.contains(screen.getByRole('navigation', { name: 'Navegação principal' }))).toBe(true)
    const account = screen.getByRole('button', { name: /Operador de teste/ })
    expect(sidebar.contains(account)).toBe(true)
    expect(document.activeElement).toBe(account)
    expect(window.localStorage.getItem('vela_nav_position')).toBe('fixed')

    // A escolha volta ao abrir de novo.
    unmount()
    renderLayout()
    expect(screen.getByRole('complementary', { name: 'Menu do Vela' })).toBeTruthy()
  })

  it('na lateral fixa, o grupo da tela atual vem aberto como lista', () => {
    window.localStorage.setItem('vela_nav_position', 'fixed')
    render(
      <MemoryRouter initialEntries={['/revisao']}>
        <Routes>
          <Route path="*" element={<AppLayout />} />
        </Routes>
      </MemoryRouter>,
    )

    const importacao = screen.getByRole('button', { name: /Importação/ })
    expect(importacao.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('link', { name: 'Revisão' }).getAttribute('aria-current')).toBe('page')

    // Navegar dentro da lateral não fecha o grupo.
    fireEvent.click(screen.getByRole('link', { name: 'BLs' }))
    expect(importacao.getAttribute('aria-expanded')).toBe('true')
  })

  it('abaixo de 1100 px toda posição usa o botão Menu do cabeçalho', () => {
    window.localStorage.setItem('vela_nav_position', 'collapsed')
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    renderLayout()

    expect(screen.queryByRole('complementary', { name: 'Menu do Vela' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Menu' }).closest('header')).toBeTruthy()
  })

  it('anuncia a contagem do menu por extenso', () => {
    renderLayout()
    expect(screen.getByRole('link', { name: 'Alertas, 4 pendentes' })).toBeTruthy()
  })
})
