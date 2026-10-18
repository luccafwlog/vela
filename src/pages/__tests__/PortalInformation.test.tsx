// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { PortalInformation } from '../PortalInformation'

const catalog = vi.hoisted(() => ({ hook: vi.fn(), refetch: vi.fn(), operation: vi.fn() }))
vi.mock('../../hooks/usePortalInformation', () => ({ usePortalInformation: catalog.hook }))
vi.mock('../../hooks/usePortalOperation', () => ({ usePortalOperationBls: catalog.operation }))
const empty = { depots: [], agents: [], contacts: [], carriers: [], local_tables: [], demurrage_rates: [], demurrage_notes: '', ports: [] }
beforeEach(() => { catalog.hook.mockReturnValue({ data: empty, isLoading: false, error: null, refetch: catalog.refetch }); catalog.operation.mockReturnValue({ data: [], isLoading: false, error: null }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
function Location() { const location = useLocation(); return <p data-testid="location">{location.pathname + location.search}</p> }
function show(path = '/portal/informacoes') { render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/portal/informacoes/:section?" element={<PortalInformation />} /></Routes></MemoryRouter>) }
describe('Página Central de Informações', () => {
  it('mostra seis seções com as rotas do Portal e preserva contexto', () => {
    show('/portal/informacoes?pod=BRSSZ')
    expect(screen.getAllByRole('link')).toHaveLength(6)
    expect(screen.getByRole('link', { name: /Taxas Locais/ }).getAttribute('href')).toBe('/portal/informacoes/taxas?pod=BRSSZ')
  })
  it.each(['taxas', 'devolucao'])('limita os portos de %s aos atendidos, mesmo com POD externo na URL', (section) => {
    catalog.hook.mockReturnValue({ data: { ...empty, ports: [{ code: 'BRSSZ', name: 'Santos' }, { code: 'BRVIX', name: 'Vitória' }, { code: 'BRSSA', name: 'Salvador' }, { code: 'BRSUA', name: 'Suape' }] }, isLoading: false, error: null })
    show(`/portal/informacoes/${section}?pod=BRSSZ`)
    const options = Array.from(screen.getByLabelText('Porto de destino (POD)').querySelectorAll('option')).map(option => option.value)
    expect(options).toEqual(['', 'BRVIX', 'BRSSA', 'BRSUA'])
  })
  it('mantém os demais portos na aba Agentes por porto', () => {
    catalog.hook.mockReturnValue({ data: { ...empty, ports: [{ code: 'BRSSZ', name: 'Santos' }] }, isLoading: false, error: null })
    show('/portal/informacoes/agentes')
    expect(screen.getByRole('option', { name: 'BRSSZ · Santos' })).toBeTruthy()
  })
  it('mostra carregamento sem confundir ausência de cadastro', () => {
    catalog.hook.mockReturnValue({ isLoading: true })
    show('/portal/informacoes/taxas')
    expect(screen.getByText('Carregando informações...')).toBeTruthy()
    expect(screen.queryByText('Sem tabela de Taxas Locais')).toBeNull()
  })
  it('explicita falha e permite repetir consulta', async () => {
    catalog.hook.mockReturnValue({ isLoading: false, error: new Error('network'), refetch: catalog.refetch })
    show('/portal/informacoes/atendimento')
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(catalog.refetch).toHaveBeenCalledOnce()
  })
  it('exibe depósitos do porto ao selecionar POD em devolução', async () => {
    const portDepots = [
      { id: '1', code: 'DEP1', name: 'Depot Vitória', ports: ['BRVIX'], address: 'Rua 1', opening_hours: '8-18', emails: [], phones: [], scheduling_url: null, instructions: '', restrictions: '', published: true, active: true, updated_at: null },
    ]
    catalog.hook.mockReturnValue({ data: { ...empty, depots: portDepots, ports: [{ code: 'BRSSZ', name: 'Santos' }, { code: 'BRVIX', name: 'Vitória' }, { code: 'BRSSA', name: 'Salvador' }, { code: 'BRSUA', name: 'Suape' }] }, isLoading: false, error: null })
    show('/portal/informacoes/devolucao?pod=BRVIX')
    expect(screen.getByText('Depot Vitória')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'BRVIX · Vitória' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'BRSSA · Salvador' })).toBeNull()
  })
  it('mostra as seções como abas, sem o botão "Todas as informações", e troca de seção mantendo o POD', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/portal/informacoes/taxas?pod=BRVIX']}><Routes><Route path="/portal/informacoes/:section?" element={<><PortalInformation /><Location /></>} /></Routes></MemoryRouter>)
    const tabs = screen.getByRole('tablist', { name: 'Seções de informações' })
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Taxas Locais', 'Devolução', 'Demurrage', 'Agentes por porto', 'Contato', 'Tracking'])
    expect(within(tabs).getByRole('tab', { name: 'Taxas Locais' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Central de Informações' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Todas as informações' })).toBeNull()
    await user.click(within(tabs).getByRole('tab', { name: 'Devolução' }))
    expect(screen.getByTestId('location').textContent).toBe('/portal/informacoes/devolucao?pod=BRVIX')
  })
  it('distingue tarifa ausente de free time zero', () => {
    show('/portal/informacoes/demurrage')
    expect(screen.getByText('Sem tarifa de Demurrage')).toBeTruthy()
    expect(screen.queryByText('0 dias')).toBeNull()
  })
})
