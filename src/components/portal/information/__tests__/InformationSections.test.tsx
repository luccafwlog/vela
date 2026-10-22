// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { PortalInformation } from '../../../../services/portalInformation'
import { ReturnSection } from '../ReturnSection'
import { TrackingSection } from '../TrackingSection'
import { DemurrageSection, LocalFeesSection } from '../ReferenceSections'
import { AgentsSection, ContactsSection } from '../ContactSections'
import { InformationLinks } from '../InformationLinks'
import { PortalScopeProvider } from '../../../../hooks/usePortalScope'
import type { PortalScope } from '../../../../services/portalScope'

const mocks = vi.hoisted(() => ({ operation: vi.fn(), refetchOperation: vi.fn() }))
vi.mock('../../../../hooks/usePortalOperation', () => ({ usePortalOperationBls: mocks.operation }))
const information: PortalInformation = { depots: [], agents: [], contacts: [], carriers: [{ carrier_id: 1, name: 'Armador inseguro', tracking_url: 'javascript:alert(1)' }, { carrier_id: 2, name: 'Armador seguro', tracking_url: 'https://example.com/tracking' }], local_tables: [
  { id: 1, name: 'Salvador container', pod: 'BRSSA', cargo_mode: 'container', valid_from: '2026-01-01', valid_to: '2026-12-31', items: [
    { id: 1, name: 'Adicional IMO', currency: 'USD', unit_value_usd: 12, unit_value_brl: null, application_basis: 'container_distinct_voyage', cargo_profile: 'imo', manual_only: true, applies_to_soc: true },
    { id: 2, name: 'Drop Off Fee', currency: 'BRL', unit_value_usd: null, unit_value_brl: 150, application_basis: 'container_distinct_voyage', cargo_profile: 'any', manual_only: false, applies_to_soc: false },
  ] },
  { id: 2, name: 'Salvador carga solta', pod: 'BRSSA', cargo_mode: 'carga_solta', valid_from: '2026-01-01', valid_to: null, items: [] },
  { id: 3, name: 'Vitória container', pod: 'BRVIX', cargo_mode: 'container', valid_from: '2026-01-01', valid_to: null, items: [] },
], demurrage_rates: [], demurrage_notes: '', ports: [] }
const markerCarrier = { carrier_id: 3, name: 'COSCO Shipping', tracking_url: 'https://carrier.example/cargoTracking?number={BL}' }
const operationRows = [
  { bl_id: 'BL1', pod: 'BRSSA', vessel_name: 'NORDIC STAR', voyage_number: '021W', tracking_url: 'https://old.example.com/{BL}', carrier_id: 3, carrier_name: 'COSCO Shipping', containers: [{ id: 10, container_number: 'ABCD1234567' }] },
  { bl_id: 'BL2', pod: 'BRSSA', vessel_name: 'XIN PU DONG', voyage_number: '014S', tracking_url: null, carrier_id: 3, carrier_name: 'COSCO Shipping', containers: [] },
  { bl_id: 'BL9', pod: 'BRSSA', vessel_name: 'OUTRO', voyage_number: '1', tracking_url: null, carrier_id: 2, carrier_name: 'Armador seguro', containers: [] },
]
beforeEach(() => { mocks.operation.mockReturnValue({ data: operationRows, isLoading: false, error: null, refetch: mocks.refetchOperation }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('Central de Informações', () => {
  it('normaliza alias de porto em atalhos e unidades operacionais', () => {
    mocks.operation.mockReturnValue({ data: [{ ...operationRows[0], pod: 'BRVIT' }], isLoading: false, error: null })
    render(<MemoryRouter initialEntries={['/']}><InformationLinks sections={['devolucao']} pod="VIX" /><ReturnSection information={information} pod="BRVIX" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Depósitos de devolução' }).getAttribute('href')).toBe('/portal/informacoes/devolucao?pod=BRVIX')
  })

  it.each([['NVT', 'BRNVT'], ['BRNVT', 'BRNVT'], ['BRREC', 'BRREC'], ['SUA', 'BRSUA'], ['SSA', 'BRSSA']])('normaliza o alias %s para %s nos atalhos', (alias, canonical) => {
    render(<MemoryRouter><InformationLinks sections={['devolucao']} pod={alias} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Depósitos de devolução' }).getAttribute('href')).toBe(`/portal/informacoes/devolucao?pod=${canonical}`)
  })

  it('com a marca {BL}, escolhe o B/L e abre o tracking já na consulta dele', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/?bl=BL1']}><TrackingSection information={{ ...information, carriers: [markerCarrier] }} /></MemoryRouter>)
    // Vale o link vigente do catálogo, não o que veio com o B/L.
    expect(screen.getByRole('link', { name: 'Ver tracking deste B/L na COSCO Shipping' }).getAttribute('href')).toBe('https://carrier.example/cargoTracking?number=BL1')
    const select = screen.getByLabelText('B/L')
    // Só entram B/Ls do armador com a marca.
    expect(Array.from(select.querySelectorAll('option')).map((option) => option.textContent)).toEqual(['BL1 · NORDIC STAR / 021W', 'BL2 · XIN PU DONG / 014S'])
    await user.selectOptions(select, 'BL2')
    expect(screen.getByRole('link', { name: 'Ver tracking deste B/L na COSCO Shipping' }).getAttribute('href')).toBe('https://carrier.example/cargoTracking?number=BL2')
    expect(screen.queryByRole('link', { name: /Abrir tracking da/ })).toBeNull()
  })

  it('sem a marca {BL}, mostra só o botão do armador, sem a escolha do B/L', () => {
    render(<MemoryRouter initialEntries={['/?bl=BL9']}><TrackingSection information={information} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Abrir tracking da Armador seguro' }).getAttribute('href')).toBe('https://example.com/tracking')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('link', { name: /Ver tracking deste B\/L/ })).toBeNull()
    // Link que executa código não vira botão.
    expect(screen.queryByRole('link', { name: /Armador inseguro/ })).toBeNull()
  })

  it('separa os armadores sem a marca quando há armador com a marca', () => {
    render(<MemoryRouter><TrackingSection information={{ ...information, carriers: [markerCarrier, ...information.carriers] }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Tracking no site do armador' })).toBeTruthy()
    const others = screen.getByRole('heading', { name: 'Outros armadores' }).closest('section') as HTMLElement
    expect(within(others).getByRole('link', { name: 'Abrir tracking da Armador seguro' })).toBeTruthy()
    // Sem ?bl=, abre no primeiro B/L do armador com a marca.
    expect(screen.getByRole('link', { name: 'Ver tracking deste B/L na COSCO Shipping' }).getAttribute('href')).toBe('https://carrier.example/cargoTracking?number=BL1')
  })

  it('explicita quando não há link de tracking cadastrado', () => {
    render(<MemoryRouter initialEntries={['/?bl=BL1']}><TrackingSection information={{ ...information, carriers: [] }} /></MemoryRouter>)
    expect(screen.getByText('Sem links de tracking cadastrados')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('explicita quando não existem B/Ls visíveis para tracking', () => {
    mocks.operation.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<MemoryRouter><TrackingSection information={{ ...information, carriers: [markerCarrier] }} /></MemoryRouter>)
    expect(screen.getByText('Nenhum B/L visível na sua operação.')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('oculta o link anterior quando a atualização dos B/Ls falha', async () => {
    mocks.operation.mockReturnValue({ data: operationRows, isLoading: false, error: new Error('network'), refetch: mocks.refetchOperation })
    render(<MemoryRouter initialEntries={['/?bl=BL1']}><TrackingSection information={{ ...information, carriers: [markerCarrier] }} /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: /Ver tracking deste B\/L/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(mocks.refetchOperation).toHaveBeenCalledOnce()
  })

  it('exclui tabelas e modalidades de portos não atendidos da consulta geral', () => {
    render(<LocalFeesSection information={{ ...information, local_tables: [...information.local_tables, { ...information.local_tables[0], id: 99, name: 'Santos externo', pod: 'BRSSZ', cargo_mode: 'veiculo' }] }} pod="" />)
    expect(screen.queryByText('Santos externo')).toBeNull()
    expect(screen.queryByRole('option', { name: 'Veículo' })).toBeNull()
    expect(screen.getByText('Salvador container')).toBeTruthy()
  })

  it('mostra um bloco por tabela, com porto, modalidade e vigência na faixa e tabela limpa', async () => {
    render(<LocalFeesSection information={information} pod="BRSSA" />)
    expect(screen.queryByText('Vitória container')).toBeNull()
    const block = screen.getByRole('heading', { name: 'Salvador container' }).closest('section') as HTMLElement
    expect(within(block).getByText('BRSSA · Container · vigência 01/01/2026 a 31/12/2026')).toBeTruthy()
    const table = within(block).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Taxa', 'Incide', 'Perfil da carga', 'Valor'])
    expect(within(table).getByText('US$ 12,00')).toBeTruthy()
    expect(within(table).getByText('IMO')).toBeTruthy()
    // "Não se aplica a SOC" vira o perfil, sem linha embaixo do valor.
    expect(within(table).getByText('Todos, exceto SOC')).toBeTruthy()
    expect(screen.queryByText('Não se aplica a SOC')).toBeNull()
    expect(screen.queryByText('Aplicação manual')).toBeNull()
    expect(screen.getByText('Salvador carga solta').closest('section')?.textContent).toContain('vigente desde 01/01/2026')
    await userEvent.selectOptions(screen.getByLabelText('Modalidade da carga'), 'carga_solta')
    expect(screen.queryByText('Salvador container')).toBeNull()
    expect(screen.getByText('Salvador carga solta')).toBeTruthy()
  })

  it('agrupa depósitos num bloco por porto, com o nome uma vez e o agendamento no site do depósito', () => {
    const depot = { id: 'mixed', code: 'MIX', name: 'Depot compartilhado', ports: ['BRSSZ', 'BRVIT'], address: 'Rua 1', opening_hours: '', emails: ['gate@depot.example'], phones: ['(71) 3594-5733'], scheduling_url: 'https://agenda.depot.example/', instructions: '', restrictions: '', published: true, active: true, updated_at: null }
    render(<MemoryRouter><ReturnSection information={{ ...information, depots: [depot, { ...depot, id: 'external', name: 'Depot Santos', ports: ['BRSSZ'] }] }} pod="" /></MemoryRouter>)
    const port = screen.getByRole('heading', { name: 'BRVIX · Vitória' }).closest('section') as HTMLElement
    expect(within(port).getByText('1 depósito')).toBeTruthy()
    expect(within(port).getByRole('heading', { name: 'Depot compartilhado' })).toBeTruthy()
    expect(within(port).queryByText('MIX · BRVIX')).toBeNull()
    expect(within(port).getByRole('button', { name: 'Copiar e-mail gate@depot.example' })).toBeTruthy()
    const scheduling = within(port).getByRole('link', { name: 'Agendar no site do depósito' })
    expect(scheduling.getAttribute('href')).toBe('https://agenda.depot.example/')
    expect(scheduling.getAttribute('target')).toBe('_blank')
    expect(screen.queryByText('Depot Santos')).toBeNull()
    expect(screen.queryByText(/BRSSZ/)).toBeNull()
  })

  it('separa dias e valor da Demurrage em colunas e põe a contagem num bloco abaixo, sem o acordo próprio', () => {
    const rate = { id: 1, container_type: '20GP', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 30, p2_day_from: 31, p2_usd: 50, valid_from: '2026-08-09', valid_to: null }
    render(<DemurrageSection information={{ ...information, demurrage_rates: [rate], demurrage_notes: 'A contagem começa no dia seguinte à descarga.' }} />)
    const block = screen.getByRole('heading', { name: 'Tarifa geral de Demurrage' }).closest('section') as HTMLElement
    expect(within(block).getByText('em US$ por dia · vigente desde 09/08/2026')).toBeTruthy()
    const row = within(block).getByText('20GP').closest('tr') as HTMLElement
    expect(Array.from(row.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['20GP', '21 dias', 'dias 22 a 30', '30,00', 'a partir do dia 31', '50,00'])
    expect(screen.getByRole('heading', { name: 'Como a contagem funciona' })).toBeTruthy()
    expect(screen.queryByText(/acordo/)).toBeNull()
  })

  it('mostra os agentes numa tabela com copiar em cada e-mail', () => {
    render(<AgentsSection information={{ ...information, agents: [{ id: 'a', name: 'FWLOG', ports: ['BRVIX', 'BRSSA'], emails: ['importacao@fwlog.com.br', 'eqp@fwlog.com.br'], active: true }] }} pod="" />)
    const table = screen.getByRole('table', { name: 'Agentes por porto' })
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Agente', 'Portos', 'E-mails'])
    expect(within(table).getByText('BRVIX · BRSSA')).toBeTruthy()
    expect(within(table).getByRole('button', { name: 'Copiar e-mail importacao@fwlog.com.br' })).toBeTruthy()
    expect(within(table).getByRole('button', { name: 'Copiar e-mail eqp@fwlog.com.br' })).toBeTruthy()
  })

  it('põe Importação primeiro no Contato, com o e-mail como dado principal e WhatsApp como botão', () => {
    const contact = { description: '', phones: [], whatsapp: null, address: '', active: true }
    render(<ContactsSection information={{ ...information, contacts: [
      { ...contact, key: 'containers', title: 'Containers', emails: ['eqp@fwlog.com.br'] },
      { ...contact, key: 'geral', title: 'Assuntos gerais', emails: ['fwlog@fwlog.com.br'], phones: ['+55 (27) 99690-7107'], whatsapp: 'https://wa.me/5527996907107' },
      { ...contact, key: 'importacao', title: 'Importação', emails: ['importacao@fwlog.com.br'] },
    ] }} />)
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Importação', 'Containers', 'Assuntos gerais'])
    const importacao = screen.getByRole('heading', { name: 'Importação' }).closest('section') as HTMLElement
    expect(importacao.querySelector('.app-lead__value')?.textContent).toContain('importacao@fwlog.com.br')
    expect(within(importacao).getByRole('button', { name: 'Copiar e-mail importacao@fwlog.com.br' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Abrir WhatsApp' }).getAttribute('href')).toBe('https://wa.me/5527996907107')
  })

  it('preserva contexto e prefixo do Modo Inspeção nos atalhos', () => {
    const scope: PortalScope = { mode: 'inspect', customerId: 10, basePath: '/clientes/portal/inspecao/10', overview: null }
    render(<MemoryRouter><PortalScopeProvider scope={scope}><InformationLinks sections={['devolucao']} pod="BRSSA" bl="BL1" containerId={10} /></PortalScopeProvider></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Depósitos de devolução' }).getAttribute('href')).toBe('/clientes/portal/inspecao/10/informacoes/devolucao?pod=BRSSA&bl=BL1&containerId=10')
  })
})
