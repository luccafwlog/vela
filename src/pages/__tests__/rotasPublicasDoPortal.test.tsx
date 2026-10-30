// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppPortal from '../../AppPortal'

// As rotas reais do Portal, com cada tela trocada pelo próprio nome (menos a
// "Página não encontrada" pública, que é o que se confere aqui) e sem sessão:
// a rota protegida manda ao login, como no Portal de verdade.
vi.mock('../../lib/lazyPage', async () => {
  const { PublicNaoEncontrada } = await vi.importActual<typeof import('../PublicNaoEncontrada')>('../PublicNaoEncontrada')
  return {
    lazyPage: (_load: unknown, name: string) => Object.assign(
      name === 'PublicNaoEncontrada' ? () => <PublicNaoEncontrada /> : () => <p>Tela {name}</p>,
      { preload: () => Promise.resolve() },
    ),
  }
})
vi.mock('../../components/layout/PortalProtectedRoute', () => ({ PortalProtectedRoute: () => <Navigate to="/portal/login" replace /> }))
vi.mock('../../components/layout/PortalLayout', () => ({ PortalLayout: () => <Outlet /> }))
vi.mock('../../hooks/usePortalScope', () => ({ PortalScopeProvider: () => <Outlet /> }))
vi.mock('../../lib/telemetry', () => ({ markStartupStage: () => {} }))

afterEach(cleanup)

function CurrentPath() {
  return <output aria-label="Endereço atual">{useLocation().pathname}</output>
}

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppPortal />
      <CurrentPath />
    </MemoryRouter>,
  )
}

// ADR 0114 e revisão da PR #1119: dentro do iframe do fwlog.com.br, o `*` do
// Portal levava qualquer caminho público desconhecido ao login do Portal.
describe('caminhos públicos do Portal (/portal/publico/*)', () => {
  it.each(['/portal/publico/xyz', '/portal/publico/chegadas-e-saidas', '/portal/publico/chegadas-saidas/outra', '/portal/publico'])(
    '%s mostra "Página não encontrada" na moldura pública, sem ir ao login',
    async (path) => {
      open(path)
      expect(await screen.findByText('Página não encontrada')).toBeTruthy()
      expect(screen.getByText(/Informações publicadas pela Fwlog/)).toBeTruthy()
      expect(screen.queryByText('Tela PortalLogin')).toBeNull()
      expect(screen.getByLabelText('Endereço atual').textContent).toBe(path)
    },
  )

  it('as duas páginas públicas continuam abrindo', async () => {
    open('/portal/publico/chegadas-saidas')
    expect(await screen.findByText('Tela PublicChegadasSaidas')).toBeTruthy()
    cleanup()
    open('/portal/publico/consulta-container')
    expect(await screen.findByText('Tela PublicConsultaContainer')).toBeTruthy()
  })

  it('fora de /portal/publico/, o caminho desconhecido segue para o Portal (login sem sessão)', async () => {
    open('/portal/xyz')
    expect(await screen.findByText('Tela PortalLogin')).toBeTruthy()
    expect(screen.getByLabelText('Endereço atual').textContent).toBe('/portal/login')
  })
})
