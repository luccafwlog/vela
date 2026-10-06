// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { PortalInformation } from '../PortalInformation'

const catalog = vi.hoisted(() => ({ hook: vi.fn(), refetch: vi.fn(), operation: vi.fn() }))
vi.mock('../../hooks/usePortalInformation', () => ({ usePortalInformation: catalog.hook }))
vi.mock('../../hooks/usePortalOperation', () => ({ usePortalOperationBls: catalog.operation }))
const empty = { depots: [], agents: [], contacts: [], carriers: [], local_tables: [], demurrage_rates: [], demurrage_notes: '', ports: [] }
beforeEach(() => { catalog.hook.mockReturnValue({ data: empty, isLoading: false, error: null, refetch: catalog.refetch }); catalog.operation.mockReturnValue({ data: [], isLoading: false, error: null }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
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
    expect(screen.getByText('Depósitos para devolução')).toBeTruthy()
  })
  it('distingue tarifa ausente de free time zero', () => {
    show('/portal/informacoes/demurrage')
    expect(screen.getByText('Sem tarifa de Demurrage')).toBeTruthy()
    expect(screen.queryByText('0 dias')).toBeNull()
  })
})
