// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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

afterEach(cleanup)

describe('PortalLayout', () => {
  it('mostra navegacao para Painel, Faturas, BLs e Containers e Perfil', () => {
    render(
      <MemoryRouter initialEntries={['/portal/operacao']}>
        <PortalLayout />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('href')).toBe('/portal')
    expect(screen.getByRole('link', { name: 'Faturas' }).getAttribute('href')).toBe('/portal/billing')
    expect(screen.getByRole('link', { name: 'BLs e Containers' }).getAttribute('href')).toBe('/portal/operacao')
    // "Perfil" aparece no header (icone) e na navegacao; ambos apontam para /portal/perfil
    expect(screen.getAllByRole('link', { name: 'Perfil' }).every((l) => l.getAttribute('href') === '/portal/perfil')).toBe(true)
    expect(screen.getByRole('link', { name: 'BLs e Containers' }).className).toContain('active')
    expect(screen.getByRole('link', { name: 'Ir para o conteúdo principal' }).getAttribute('href')).toBe('#portal-main-content')
    expect(document.querySelector('main')?.id).toBe('portal-main-content')
  })

  it('exibe a logo branca da Fwlog no header sobre o fundo escuro/azul', () => {
    render(
      <MemoryRouter initialEntries={['/portal']}>
        <PortalLayout />
      </MemoryRouter>,
    )

    const brandLogo = screen.getByRole('img', { name: 'Portal Fwlog' })
    expect(brandLogo.getAttribute('src')).toBe('/branding/fwlog-logo-white.png')
  })

  it('desabilita o botão de sair e exibe indicador durante o logout', () => {
    portalAuth.isSigningOut = true
    render(
      <MemoryRouter initialEntries={['/portal']}>
        <PortalLayout />
      </MemoryRouter>,
    )

    const logoutButton = screen.getByRole('button', { name: 'Saindo...' })
    expect(logoutButton).toBeTruthy()
    expect(logoutButton.hasAttribute('disabled')).toBe(true)
    portalAuth.isSigningOut = false
  })
})
