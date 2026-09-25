// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

const { mocks, depot, destination, service } = vi.hoisted(() => ({
  mocks: { upsertDepotService: vi.fn(async () => {}), upsertDepot: vi.fn(async () => {}), deleteDepot: vi.fn(async () => {}), deleteDepotService: vi.fn(async () => {}), listBrazilianPorts: vi.fn(async () => [{ id: 10, locode: 'BRVIX', name: 'Vitória' }]), confirm: vi.fn(async () => true), showToast: vi.fn() },
  depot: { id: 'd1', code: 'VBR', name: 'Vila Velha', tipo: 'depot', free_time_vazio_days: 3, free_time_material_days: 2, active: true },
  destination: { id: 'd2', code: 'TVV', name: 'Terminal Vila Velha', tipo: 'terminal_portuario', free_time_vazio_days: 0, free_time_material_days: 0, active: true },
  service: { id: 's1', depot_id: 'd1', name: 'Transporte', natureza: 'transporte', container_type: null, route_destino_id: 'd2', condition: null, rate_brl: 100, active: true, created_at: '2026-01-01' },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ can: () => true, isAdmin: true, profile: { id: 'user-1' } }) }))
vi.mock('../../hooks/useDepots', () => ({ useDepots: () => ({ data: [depot, destination], error: null, refetch: vi.fn(async () => {}) }) }))
vi.mock('../../services/depots', () => ({ listDepotServices: vi.fn(async () => [service]), listBrazilianPorts: mocks.listBrazilianPorts, preflightDepotsTerminalPortMapping: vi.fn(async () => ({ pending_count: 0, codes: [] })), upsertDepot: mocks.upsertDepot, upsertDepotService: mocks.upsertDepotService, deleteDepot: mocks.deleteDepot, deleteDepotService: mocks.deleteDepotService }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
import { DepotCadastro } from '../DepotCadastro'
function renderPage() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><DepotCadastro /></MemoryRouter></QueryClientProvider>) }
describe('Cadastro de Depot', () => {
  it('exibe o destino da rota na linha do serviço', async () => { renderPage(); await waitFor(() => expect(screen.getByText(/destino: TVV/i)).toBeTruthy()) })
  it('exibe apenas os campos aplicáveis à natureza do serviço', () => {
    renderPage()
    expect(screen.queryByLabelText('Tipo de container')).toBeNull()
    expect(screen.queryByLabelText('Condição')).toBeNull()
    expect(screen.queryByLabelText('Destino da rota')).toBeNull()

    fireEvent.change(screen.getByLabelText('Natureza'), { target: { value: 'armazenagem' } })
    expect(screen.queryByLabelText('Tipo de container')).toBeNull()
    expect(screen.getByLabelText('Condição')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'EMPTY' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'EMPTY W/ MATERIAL' })).toBeTruthy()
    expect(screen.queryByLabelText('Destino da rota')).toBeNull()

    fireEvent.change(screen.getByLabelText('Natureza'), { target: { value: 'transporte' } })
    expect(screen.queryByLabelText('Tipo de container')).toBeNull()
    expect(screen.queryByLabelText('Condição')).toBeNull()
    expect(screen.getByLabelText('Destino da rota')).toBeTruthy()
  })
  it('não envia campos específicos ao salvar um serviço geral', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Serviço'), { target: { value: 'Handling in' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar serviço/i }))
    await waitFor(() => expect(mocks.upsertDepotService).toHaveBeenCalled())
    expect(mocks.upsertDepotService).toHaveBeenCalledWith(expect.objectContaining({ natureza: 'geral', container_type: null, route_destino_id: null, condition: null }))
  })
  beforeEach(() => { cleanup(); for (const fn of Object.values(mocks)) (fn as { mockClear: () => void }).mockClear() })
  it('apresenta o novo modelo de Terminais e catálogo sugerido', () => { renderPage(); expect(screen.getByRole('heading', { name: 'Cadastro de Terminais' })).toBeTruthy(); expect(screen.getByText(/valores sugeridos/i)).toBeTruthy() })
  it('editar um serviço e salvar atualiza (não duplica)', async () => { renderPage(); fireEvent.click(await screen.findByRole('button', { name: /editar/i })); fireEvent.click(screen.getByRole('button', { name: /salvar serviço/i })); await waitFor(() => expect(mocks.upsertDepotService).toHaveBeenCalled()); expect((mocks.upsertDepotService.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).toMatchObject({ id: 's1', depot_id: 'd1' }) })
  it('carrega o formulário do local selecionado por padrão', async () => { renderPage(); await waitFor(() => expect((screen.getAllByLabelText('Código')[0] as HTMLInputElement).value).toBe('VBR')); expect((screen.getByLabelText('Free time vazio') as HTMLInputElement).value).toBe('3'); expect((screen.getByLabelText('Free time material') as HTMLInputElement).value).toBe('2') })
  it('pede confirmação antes de excluir um local', async () => { renderPage(); fireEvent.click(await screen.findByRole('button', { name: /excluir/i })); await waitFor(() => expect(mocks.confirm).toHaveBeenCalled()); expect(mocks.deleteDepot).toHaveBeenCalledWith('d1') })
  it('não exclui quando a confirmação é negada', async () => { mocks.confirm.mockResolvedValueOnce(false); renderPage(); fireEvent.click(await screen.findByRole('button', { name: /excluir/i })); await waitFor(() => expect(mocks.confirm).toHaveBeenCalled()); expect(mocks.deleteDepot).not.toHaveBeenCalled() })
  it('mostra toast de erro quando o salvamento falha', async () => { mocks.upsertDepot.mockRejectedValueOnce(new Error('sem permissão')); renderPage(); fireEvent.click(await screen.findByRole('button', { name: /salvar local/i })); await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('sem permissão', 'error')) })
  it('exige porto brasileiro para salvar terminal portuário', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /novo local/i }))
    fireEvent.change(screen.getByLabelText('Código'), { target: { value: 'TVV' } })
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'terminal_portuario' } })
    expect(screen.getByLabelText('Porto brasileiro')).toBeTruthy()
    expect((screen.getByRole('button', { name: /salvar local/i }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(screen.getByRole('option', { name: /BRVIX/ })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Porto brasileiro'), { target: { value: '10' } })
    expect((screen.getByRole('button', { name: /salvar local/i }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /salvar local/i }))
    await waitFor(() => expect(mocks.upsertDepot).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'terminal_portuario', port_id: 10 })))
  })
})
