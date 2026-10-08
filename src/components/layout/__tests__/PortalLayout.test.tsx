// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'
import { ToastProvider } from '../../ui/Toast'

// `usePortalScope` le `PortalAuthContext` direto (sem Provider, o default do
// contexto e o valor entregue), entao o mock parcial precisa exportar os dois.
const portalAuth = vi.hoisted(() => ({
  overview: { customer_name: 'Cliente Portal', customer_cnpj_cpf: '12345678000195' },
  signOut: vi.fn(),
  isSigningOut: false,
  signOutError: null,
}))
vi.mock('../../../hooks/usePortalAuth', async () => ({
  usePortalAuth: () => portalAuth,
  PortalAuthContext: (await vi.importActual<typeof import('react')>('react')).createContext(portalAuth),
}))

vi.mock('../../../hooks/usePortalNotifications', () => ({
  usePortalUnreadCount: () => ({ data: 0 }),
  usePortalNotifications: () => ({ data: [], isLoading: false }),
  usePortalMarkRead: () => ({ mutate: vi.fn() }),
  usePortalMarkAllRead: () => ({ mutate: vi.fn() }),
}))

import { PortalLayout } from '../PortalLayout'

// O menu móvel acompanha a largura da tela; o teste guarda o ouvinte para
// simular a passagem para a largura de desktop.
let viewportListeners: Array<(event: { matches: boolean }) => void> = []

beforeEach(() => {
  viewportListeners = []
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => viewportListeners.push(listener),
    removeEventListener: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PortalLayout', () => {
  it('mostra navegacao para Painel, Faturas, BLs e Containers e Perfil', () => {
    render(
      <ToastProvider>
        <ConfirmDialogProvider>
          <MemoryRouter initialEntries={['/portal/operacao']}>
            <PortalLayout />
          </MemoryRouter>
        </ConfirmDialogProvider>
      </ToastProvider>,
    )

    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('href')).toBe('/portal')
    expect(screen.getByRole('link', { name: 'Faturas' }).getAttribute('href')).toBe('/portal/billing')
    expect(screen.getByRole('link', { name: 'BLs e Containers' }).getAttribute('href')).toBe('/portal/operacao')
    // O atalho de perfil por ícone saiu do cabeçalho: só a navegação leva ao Perfil.
    expect(screen.getAllByRole('link', { name: 'Perfil' }).map((l) => l.getAttribute('href'))).toEqual(['/portal/perfil'])
    expect(screen.getByRole('link', { name: 'BLs e Containers' }).className).toContain('active')
    expect(screen.getByRole('link', { name: 'Ir para o conteúdo principal' }).getAttribute('href')).toBe('#portal-main-content')
    expect(document.querySelector('main')?.id).toBe('portal-main-content')
  })

  it('exibe a logo branca da Fwlog no header sobre o fundo escuro/azul', () => {
    render(
      <ToastProvider>
        <ConfirmDialogProvider>
          <MemoryRouter initialEntries={['/portal']}>
            <PortalLayout />
          </MemoryRouter>
        </ConfirmDialogProvider>
      </ToastProvider>,
    )

    const brandLogo = screen.getByRole('img', { name: 'Portal Fwlog' })
    expect(brandLogo.getAttribute('src')).toBe('/branding/fwlog-logo-white.png')
  })

  it('desabilita o botão de sair e exibe indicador durante o logout', () => {
    portalAuth.isSigningOut = true
    render(
      <ToastProvider>
        <ConfirmDialogProvider>
          <MemoryRouter initialEntries={['/portal']}>
            <PortalLayout />
          </MemoryRouter>
        </ConfirmDialogProvider>
      </ToastProvider>,
    )

    const logoutButton = screen.getByRole('button', { name: 'Saindo...' })
    expect(logoutButton).toBeTruthy()
    expect(logoutButton.hasAttribute('disabled')).toBe(true)
    portalAuth.isSigningOut = false
  })

  it('fecha o menu e destrava a rolagem quando a tela passa para a largura de desktop', () => {
    render(
      <ToastProvider>
        <ConfirmDialogProvider>
          <MemoryRouter initialEntries={['/portal']}>
            <PortalLayout />
          </MemoryRouter>
        </ConfirmDialogProvider>
      </ToastProvider>,
    )

    const menu = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(menu)
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')

    act(() => viewportListeners.forEach((listener) => listener({ matches: false })))

    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.style.overflow).toBe('')
  })
})
