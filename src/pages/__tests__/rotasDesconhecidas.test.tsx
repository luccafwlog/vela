// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NaoEncontrado } from '../NaoEncontrado'
import { ADMIN_TABS, DEFAULT_ADMIN_TAB, LEGACY_ADMIN_TABS, isAdminTab, legacyAdminTab } from '../adminTabs'
import { routeTitle } from '../../lib/pageTitle'
import AppInterno from '../../AppInterno'

// As rotas reais do Vela, com cada tela trocada pelo próprio nome: o teste
// confere o roteamento, não as telas nem a sessão.
vi.mock('../../lib/lazyPage', () => ({
  lazyPage: (_load: unknown, name: string) => Object.assign(() => <p>Tela {name}</p>, { preload: () => Promise.resolve() }),
}))
vi.mock('../../components/layout/ProtectedRoute', () => ({ ProtectedRoute: () => <Outlet /> }))
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: () => <Outlet /> }))
vi.mock('../../lib/telemetry', () => ({ markStartupStage: () => {} }))

afterEach(cleanup)

function CurrentPath() {
  return <output aria-label="Endereço atual">{useLocation().pathname}</output>
}

describe('endereços antigos do Granito', () => {
  it('/granito/taxas leva ao Granito, sem tela de Tarifas (lote 5b)', async () => {
    render(
      <MemoryRouter initialEntries={['/granito/taxas']}>
        <AppInterno />
        <CurrentPath />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Tela Granite')).toBeTruthy()
    expect(screen.getByLabelText('Endereço atual').textContent).toBe('/granito')
  })
})

// Antes, o catch-all do App mandava qualquer rota desconhecida para /painel com
// `replace`: o usuário era realocado sem aviso e nem o Back devolvia a URL.
describe('rota desconhecida', () => {
  it('identifica o endereço acessado em vez de realocar em silêncio', () => {
    render(
      <MemoryRouter initialEntries={['/rota-que-nao-existe']}>
        <Routes>
          <Route path="*" element={<NaoEncontrado />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Página não encontrada')).toBeTruthy()
    expect(screen.getByText('/rota-que-nao-existe')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Voltar para o Painel' }).getAttribute('href')).toBe('/painel')
  })
})

describe('abas de Administração em sub-rota', () => {
  it('reconhece todos os slugs publicados e recusa os demais', () => {
    for (const { slug } of ADMIN_TABS) expect(isAdminTab(slug)).toBe(true)
    expect(isAdminTab('usuários')).toBe(false) // acentuado: era a chave antiga
    expect(isAdminTab('inexistente')).toBe(false)
    expect(isAdminTab(undefined)).toBe(false)
    expect(isAdminTab(DEFAULT_ADMIN_TAB)).toBe(true)
  })

  it('os endereços antigos (lote 5b) levam à aba nova certa', () => {
    expect(legacyAdminTab('falhas')).toBe('falhas-de-alertas')
    expect(legacyAdminTab('logs')).toBe('historico')
    expect(legacyAdminTab('metricas')).toBe('sistema')
    expect(legacyAdminTab('prazo-adr')).toBe('prazo-do-adr')
    expect(legacyAdminTab('usuarios')).toBeNull()
    expect(legacyAdminTab('toString')).toBeNull()
    for (const target of Object.values(LEGACY_ADMIN_TABS)) expect(isAdminTab(target)).toBe(true)
  })

  it('usa slugs seguros para URL', () => {
    for (const { slug } of ADMIN_TABS) {
      expect(slug).toBe(encodeURIComponent(slug))
    }
  })

  it('dá título próprio a cada aba e à tela sem sufixo', () => {
    expect(routeTitle('/admin')).toBe('Administração · Vela')
    for (const { slug, label } of ADMIN_TABS) {
      expect(routeTitle(`/admin/${slug}`)).toBe(`Administração · ${label} · Vela`)
    }
  })
})
