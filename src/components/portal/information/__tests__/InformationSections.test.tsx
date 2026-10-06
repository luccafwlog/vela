// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { PortalInformation } from '../../../../services/portalInformation'
import { ReturnSection } from '../ReturnSection'
import { TrackingSection } from '../TrackingSection'
import { LocalFeesSection } from '../ReferenceSections'
import { InformationLinks } from '../InformationLinks'
import { PortalScopeProvider } from '../../../../hooks/usePortalScope'
import type { PortalScope } from '../../../../services/portalScope'

const mocks = vi.hoisted(() => ({ operation: vi.fn(), refetchOperation: vi.fn() }))
vi.mock('../../../../hooks/usePortalOperation', () => ({ usePortalOperationBls: mocks.operation }))
const information: PortalInformation = { depots: [], agents: [], contacts: [], carriers: [{ carrier_id: 1, name: 'Armador inseguro', tracking_url: 'javascript:alert(1)' }, { carrier_id: 2, name: 'Armador seguro', tracking_url: 'https://example.com/tracking' }], local_tables: [
  { id: 1, name: 'Salvador container', pod: 'BRSSA', cargo_mode: 'container', valid_from: '2026-01-01', valid_to: null, items: [{ id: 1, name: 'Adicional IMO', currency: 'USD', unit_value_usd: 12, unit_value_brl: null, application_basis: 'container_distinct_voyage', cargo_profile: 'imo', manual_only: true, applies_to_soc: true }] },
  { id: 2, name: 'Salvador carga solta', pod: 'BRSSA', cargo_mode: 'carga_solta', valid_from: '2026-01-01', valid_to: null, items: [] },
  { id: 3, name: 'Vitória container', pod: 'BRVIX', cargo_mode: 'container', valid_from: '2026-01-01', valid_to: null, items: [] },
], demurrage_rates: [], demurrage_notes: '', ports: [] }
const operationRows = [{ bl_id: 'BL1', pod: 'BRSSA', tracking_url: 'javascript:alert(1)', carrier_id: 1, carrier_name: 'Armador inseguro', containers: [{ id: 10, container_number: 'ABCD1234567' }] }]
beforeEach(() => { mocks.operation.mockReturnValue({ data: operationRows, isLoading: false, error: null }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('Central de Informações', () => {
  it('normaliza alias de porto em atalhos e unidades operacionais', () => {
    mocks.operation.mockReturnValue({ data: [{ ...operationRows[0], pod: 'BRVIT' }], isLoading: false, error: null })
    render(<MemoryRouter initialEntries={['/']}><InformationLinks sections={['devolucao']} pod="VIX" /><ReturnSection information={information} pod="BRVIX" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Depósitos de devolução' }).getAttribute('href')).toBe('/portal/informacoes/devolucao?pod=BRVIX')
  })

  it.each([['BRNVT', 'BRITJ'], ['BRREC', 'BRSUA'], ['SSA', 'BRSSA']])('normaliza o alias %s para %s nos atalhos', (alias, canonical) => {
    render(<MemoryRouter><InformationLinks sections={['devolucao']} pod={alias} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Depósitos de devolução' }).getAttribute('href')).toBe(`/portal/informacoes/devolucao?pod=${canonical}`)
  })
  it('usa somente o tracking vigente do catálogo para o armador do B/L', () => {
    mocks.operation.mockReturnValue({ data: [{ ...operationRows[0], carrier_id: 2, tracking_url: 'https://old.example.com' }], isLoading: false, error: null })
    const { rerender } = render(<MemoryRouter initialEntries={['/?bl=BL1']}><TrackingSection information={information} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Abrir tracking do armador' }).getAttribute('href')).toBe('https://example.com/tracking')
    rerender(<MemoryRouter initialEntries={['/?bl=BL1']}><TrackingSection information={{ ...information, carriers: [] }} /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'Abrir tracking do armador' })).toBeNull()
    expect(screen.getByText('Tracking não cadastrado para este armador.')).toBeTruthy()
  })
  it('explicita quando não existem B/Ls visíveis para tracking', () => {
    mocks.operation.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<MemoryRouter><TrackingSection information={information} /></MemoryRouter>)
    expect(screen.getByText('Nenhum B/L visível na sua operação.')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
  it('oculta cópia e link anteriores quando a atualização dos B/Ls falha', async () => {
    mocks.operation.mockReturnValue({ data: operationRows, isLoading: false, error: new Error('network'), refetch: mocks.refetchOperation })
    render(<MemoryRouter initialEntries={['/?bl=BL1']}><TrackingSection information={information} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Copiar B/L' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Abrir tracking do armador' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(mocks.refetchOperation).toHaveBeenCalledOnce()
  })
  it('exclui tabelas e modalidades de portos não atendidos da consulta geral', () => {
    render(<LocalFeesSection information={{ ...information, local_tables: [...information.local_tables, { ...information.local_tables[0], id: 99, name: 'Santos externo', pod: 'BRSSZ', cargo_mode: 'veiculo' }] }} pod="" />)
    expect(screen.queryByText('Santos externo')).toBeNull()
    expect(screen.queryByRole('option', { name: 'Veículo' })).toBeNull()
    expect(screen.getByText('Salvador container')).toBeTruthy()
  })
  it('não exibe depots externos nem portos externos de um depot compartilhado', () => {
    const depot = { id: 'mixed', code: 'MIX', name: 'Depot compartilhado', ports: ['BRSSZ', 'BRVIT'], address: '', opening_hours: '', emails: [], phones: [], scheduling_url: null, instructions: '', restrictions: '', published: true, active: true, updated_at: null }
    render(<MemoryRouter><ReturnSection information={{ ...information, depots: [depot, { ...depot, id: 'external', name: 'Depot Santos', ports: ['BRSSZ'] }] }} pod="" /></MemoryRouter>)
    expect(screen.getByText('Depot compartilhado')).toBeTruthy()
    expect(screen.queryByText('Depot Santos')).toBeNull()
    expect(screen.getByText('MIX · BRVIX')).toBeTruthy()
    expect(screen.queryByText(/BRSSZ/)).toBeNull()
  })
  it('filtra tabela por porto e modalidade e mostra preço oficial IMO', async () => {
    render(<LocalFeesSection information={information} pod="BRSSA" />)
    expect(screen.queryByText('Vitória container')).toBeNull()
    expect(screen.getByText('USD 12,00')).toBeTruthy()
    expect(screen.getByText('IMO')).toBeTruthy()
    expect(screen.queryByText('Aplicação manual')).toBeNull()
    expect(screen.queryByText('Inclui SOC')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Modalidade da carga'), 'carga_solta')
    expect(screen.queryByText('Salvador container')).toBeNull()
    expect(screen.getByText('Salvador carga solta')).toBeTruthy()
  })
  it('recusa tracking inseguro e confirma cópia só após clipboard resolver', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<MemoryRouter initialEntries={['/?bl=BL1']}><TrackingSection information={information} /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'Abrir tracking do armador' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Abrir tracking de Armador seguro' }).getAttribute('href')).toBe('https://example.com/tracking')
    await user.click(screen.getByRole('button', { name: 'Copiar B/L' }))
    expect(write).toHaveBeenCalledWith('BL1')
    expect(screen.getByRole('status').textContent).toBe('B/L copiado.')
  })
  it('mostra falha de clipboard sem confirmar cópia', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    render(<MemoryRouter initialEntries={['/?bl=BL1']}><TrackingSection information={information} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Copiar B/L' }))
    expect(screen.getByRole('status').textContent).toContain('Não foi possível copiar')
  })
  it('preserva contexto e prefixo do Modo Inspeção nos atalhos', () => {
    const scope: PortalScope = { mode: 'inspect', customerId: 10, basePath: '/clientes/portal/inspecao/10', overview: null }
    render(<MemoryRouter><PortalScopeProvider scope={scope}><InformationLinks sections={['devolucao']} pod="BRSSA" bl="BL1" containerId={10} /></PortalScopeProvider></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Depósitos de devolução' }).getAttribute('href')).toBe('/clientes/portal/inspecao/10/informacoes/devolucao?pod=BRSSA&bl=BL1&containerId=10')
  })
})
