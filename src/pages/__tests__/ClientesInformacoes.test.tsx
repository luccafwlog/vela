// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientesInformacoes } from '../ClientesInformacoes'
const mocks = vi.hoisted(() => ({ role: 'equipamentos', isAdmin: false, contacts: [] as { key: string; title: string; active: boolean }[] }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ profile: { role: mocks.role, active: true }, isAdmin: mocks.isAdmin }) }))
vi.mock('../../hooks/usePortalInformation', () => ({
  useInternalPortalInformation: () => ({ data: { depots: [{ id: 'existing', name: 'Depot Vela', active: true, published: false, ports: ['BRSSZ'] }], agents: [{ id: 'a', name: 'Agente', active: true }], contacts: mocks.contacts, carriers: [{ carrier_id: 1, name: 'Armador', tracking_url: 'https://example.com/tracking' }], ports: [{ code: 'BRSSZ', name: 'Santos' }], demurrage_notes: '', demurrage_rates: [{ id: 1, container_type: '20DC', free_days: 7, p1_day_from: 8, p1_day_to: 14, p1_usd: 50, p2_day_from: 15, p2_usd: 100, valid_from: '2026-01-01', valid_to: null }] }, isLoading: false }),
  useSavePortalInformation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
afterEach(() => { cleanup(); mocks.role = 'equipamentos'; mocks.isAdmin = false; mocks.contacts = [] })
describe('Administração de informações do Portal', () => {
  it('mostra o tracking apenas como um link e mantém a URL no editor', () => {
    mocks.isAdmin = true
    render(<MemoryRouter><ClientesInformacoes /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Tracking' }))
    expect(screen.getByRole('link', { name: 'Abrir tracking' }).getAttribute('href')).toBe('https://example.com/tracking')
    expect(screen.queryByText(/URL de tracking do armador:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Armador' }))
    expect((screen.getByRole('textbox', { name: 'URL de tracking do armador' }) as HTMLInputElement).value).toBe('https://example.com/tracking')
  })
  it('mostra as tarifas oficiais na aba Demurrage junto das observações', () => {
    render(<MemoryRouter><ClientesInformacoes /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Demurrage' }))
    expect(screen.getByRole('table', { name: 'Tarifas gerais de demurrage' })).toBeTruthy()
    expect(screen.getByText('20DC')).toBeTruthy()
    expect(screen.getByText('7 dias')).toBeTruthy()
  })
  it('mantém identificador existente e oferece somente assuntos ainda ausentes', () => {
    mocks.isAdmin = true; mocks.contacts = [{ key: 'geral', title: 'Atendimento geral', active: true }]
    render(<MemoryRouter><ClientesInformacoes /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Atendimento' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar Atendimento geral' }))
    expect(screen.queryByRole('textbox', { name: /Identificador/ })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar atendimento' }))
    expect(screen.getByRole('combobox', { name: /Assunto/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Geral' })).toBeNull()
  })
  it('não oferece adicionar atendimento quando os quatro assuntos já existem', () => {
    mocks.isAdmin = true; mocks.contacts = ['geral', 'importacao', 'exportacao', 'containers'].map(key => ({ key, title: key, active: true }))
    render(<MemoryRouter><ClientesInformacoes /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Atendimento' }))
    expect(screen.queryByRole('button', { name: 'Adicionar atendimento' })).toBeNull()
  })
  it('Equipamentos edita informações do depot cadastrado, mas somente consulta agentes', () => {
    render(<MemoryRouter><ClientesInformacoes /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Editar Depot Vela' })).toBeTruthy()
    expect(screen.getByText('Não publicado')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Abrir cadastro de depots' })).toBeNull()
    expect(screen.queryByText(/Portos disponíveis:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Agentes' }))
    expect(screen.queryByRole('button', { name: 'Editar Agente' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar agente' })).toBeNull()
  })
  it('Administrativo mantém agentes e atendimento', () => {
    mocks.role = 'administrativo'; mocks.isAdmin = true
    render(<MemoryRouter><ClientesInformacoes /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Agentes' }))
    expect(screen.getByRole('button', { name: 'Adicionar agente' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Atendimento' }))
    expect(screen.getByRole('button', { name: 'Adicionar atendimento' })).toBeTruthy()
    expect(screen.getByText('Nenhuma informação cadastrada nesta seção.')).toBeTruthy()
  })
})
