// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, auth, depot, destination, inactiveDepot, service, inactiveService } = vi.hoisted(() => ({
  mocks: {
    upsertDepotService: vi.fn(async () => {}),
    upsertDepot: vi.fn(async (input: { id?: string }) => ({ id: input.id ?? 'd2' })),
    deleteDepot: vi.fn(async () => {}),
    deleteDepotService: vi.fn(async () => {}),
    listBrazilianPorts: vi.fn(async () => [{ id: 10, locode: 'BRVIX', name: 'Vitória' }]),
    confirm: vi.fn(async () => true),
    showToast: vi.fn(),
    reactivate: vi.fn(async () => {}),
  },
  auth: { isAdmin: true },
  depot: { id: 'd1', code: 'VBR', name: 'Vila Velha', tipo: 'depot', free_time_vazio_days: 3, free_time_material_days: 2, active: true },
  destination: { id: 'd2', code: 'TVV', name: 'Terminal Vila Velha', tipo: 'terminal_portuario', free_time_vazio_days: 0, free_time_material_days: 0, active: true, port_id: 10 },
  inactiveDepot: { id: 'd3', code: 'ANTIGO', name: 'Depot antigo', tipo: 'depot', free_time_vazio_days: 0, free_time_material_days: 0, active: false },
  service: { id: 's1', depot_id: 'd1', name: 'Transporte', natureza: 'transporte', container_type: null, route_destino_id: 'd2', condition: null, rate_brl: 100, active: true, created_at: '2026-01-01' },
  inactiveService: { id: 's2', depot_id: 'd1', name: 'Armazenagem antiga', natureza: 'armazenagem', container_type: null, route_destino_id: null, condition: 'material', rate_brl: 5, active: false, created_at: '2026-01-01' },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ can: () => true, isAdmin: auth.isAdmin, profile: { id: 'user-1' } }) }))
vi.mock('../../services/deleteRecords', () => ({ reactivateCatalogRow: mocks.reactivate }))
vi.mock('../../hooks/useDepots', () => ({ useDepots: () => ({ data: [depot, destination, inactiveDepot], error: null, isLoading: false, refetch: vi.fn(async () => {}) }) }))
vi.mock('../../services/depots', () => ({ listDepotServices: vi.fn(async () => [{ ...service }, { ...inactiveService }]), listBrazilianPorts: mocks.listBrazilianPorts, preflightDepotsTerminalPortMapping: vi.fn(async () => ({ pending_count: 0, codes: [] })), upsertDepot: mocks.upsertDepot, upsertDepotService: mocks.upsertDepotService, deleteDepot: mocks.deleteDepot, deleteDepotService: mocks.deleteDepotService }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm, useConfirmWithReason: () => async () => ((await mocks.confirm()) ? 'motivo' : null) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
import { DepotCadastro } from '../DepotCadastro'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderPage(entry = '/embarquevazios/depots') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[entry]}><DepotCadastro /><LocationProbe /></MemoryRouter></QueryClientProvider>)
}

async function serviceRow(name: string) {
  return (await screen.findByTitle(name)).closest('tr') as HTMLElement
}

function openMenu(label: string, item: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

describe('Locais (depots e terminais)', () => {
  beforeEach(() => { cleanup(); auth.isAdmin = true; for (const fn of Object.values(mocks)) (fn as { mockClear: () => void }).mockClear() })

  it('título por extenso, lista com o escolhido marcado e inativos atrás da chave', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Locais (depots e terminais)' })).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Locais cadastrados' })
    expect(within(list).getByRole('button', { name: /VBR/ }).getAttribute('aria-current')).toBe('true')
    expect(within(list).queryByRole('button', { name: /ANTIGO/ })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: /Mostrar os inativos \(1\)/ }))
    expect(within(list).getByRole('button', { name: /ANTIGO/ })).toBeTruthy()
  })

  it('cadastro em leitura: nome como dado principal e free times em dias', async () => {
    renderPage()
    expect(screen.getByText('Vila Velha', { selector: 'p' })).toBeTruthy()
    expect(screen.getByText('3 dias')).toBeTruthy()
    expect(screen.getByText('2 dias')).toBeTruthy()
    expect(screen.queryByLabelText('Código')).toBeNull()
    await waitFor(() => expect(screen.getByText('1', { selector: 'dd' })).toBeTruthy())
  })

  it('catálogo em tabela com o destino pelo nome e inativos atrás da mesma chave', async () => {
    renderPage()
    const row = await serviceRow('Transporte')
    expect(within(row).getByText('Terminal Vila Velha')).toBeTruthy()
    expect(screen.queryByText(/Armazenagem antiga/)).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: /Mostrar os inativos/ }))
    const inactiveRow = await serviceRow('Armazenagem antiga')
    expect(within(inactiveRow).getByText('Com material')).toBeTruthy()
    expect(inactiveRow.className).toContain('app-table__row--muted')
  })

  it('a janela do serviço mostra só os campos da natureza, com Vazio e Com material', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Adicionar serviço/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByLabelText(/Condição/)).toBeNull()
    expect(within(dialog).queryByLabelText(/Destino da rota/)).toBeNull()

    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: 'armazenagem' } })
    expect(within(dialog).getByRole('option', { name: 'Vazio' })).toBeTruthy()
    expect(within(dialog).getByRole('option', { name: 'Com material' })).toBeTruthy()
    expect(within(dialog).queryByRole('option', { name: /EMPTY/ })).toBeNull()

    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: 'transporte' } })
    expect(within(dialog).queryByLabelText(/Condição/)).toBeNull()
    expect(within(dialog).getByLabelText(/Destino da rota/)).toBeTruthy()
  })

  it('não envia campos específicos ao salvar um serviço geral', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Adicionar serviço/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Serviço/), { target: { value: 'Handling in' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar serviço' }))
    await waitFor(() => expect(mocks.upsertDepotService).toHaveBeenCalledWith(expect.objectContaining({ natureza: 'geral', container_type: null, route_destino_id: null, condition: null, depot_id: 'd1' })))
  })

  it('editar um serviço e salvar atualiza (não duplica)', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar serviço Transporte' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Serviço/), { target: { value: 'Transporte TVV' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(mocks.upsertDepotService).toHaveBeenCalled())
    expect((mocks.upsertDepotService.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).toMatchObject({ id: 's1', depot_id: 'd1', name: 'Transporte TVV' })
  })

  it('pede confirmação antes de excluir um local, pelo menu ⋮', async () => {
    renderPage()
    openMenu('Mais ações do local VBR', 'Excluir local')
    await waitFor(() => expect(mocks.deleteDepot).toHaveBeenCalledWith('d1', 'motivo'))
  })

  it('não exclui quando a confirmação é negada', async () => {
    mocks.confirm.mockResolvedValueOnce(false)
    renderPage()
    openMenu('Mais ações do local VBR', 'Excluir local')
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.deleteDepot).not.toHaveBeenCalled()
  })

  it('fora do Administrativo não há Desativar, Reativar nem Excluir', async () => {
    auth.isAdmin = false
    renderPage()
    await serviceRow('Transporte')
    expect(screen.queryByRole('button', { name: /Mais ações/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Editar serviço Transporte' })).toBeTruthy()
  })

  it('mostra toast de erro quando o salvamento falha', async () => {
    mocks.upsertDepot.mockRejectedValueOnce(new Error('sem permissão'))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^Editar$/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Nome/), { target: { value: 'Vila Velha 2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar local' }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('sem permissão', 'error'))
  })

  it('exige porto brasileiro para cadastrar terminal portuário e, depois de criar, abre o local criado (L7)', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Novo local/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Código/), { target: { value: 'TVV' } })
    fireEvent.change(within(dialog).getByLabelText(/Tipo/), { target: { value: 'terminal_portuario' } })
    expect((within(dialog).getByRole('button', { name: 'Cadastrar local' }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /BRVIX/ })).toBeTruthy())
    fireEvent.change(within(dialog).getByLabelText(/Porto brasileiro/), { target: { value: '10' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cadastrar local' }))
    await waitFor(() => expect(mocks.upsertDepot).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'terminal_portuario', port_id: 10, active: true })))
    await waitFor(() => expect(screen.getByText('Terminal Vila Velha', { selector: 'p' })).toBeTruthy())
    const list = screen.getByRole('list', { name: 'Locais cadastrados' })
    expect(within(list).getByRole('button', { name: /TVV/ }).getAttribute('aria-current')).toBe('true')
  })

  it('abre o local pedido no endereço (vindo da armazenagem a lançar do Embarque)', async () => {
    renderPage('/embarquevazios/depots?local=d2')
    expect(screen.getByText('Terminal Vila Velha', { selector: 'p' })).toBeTruthy()
    expect(await screen.findByText('BRVIX · Vitória')).toBeTruthy()
  })

  it('?local= desconhecido avisa em vez de abrir outro local como se fosse o pedido', () => {
    renderPage('/embarquevazios/depots?local=nao-existe')
    expect(screen.getByRole('alert').textContent).toContain('O local deste endereço não existe mais')
    expect(screen.getByRole('alert').textContent).toContain('Mostrando VBR')

    fireEvent.click(within(screen.getByRole('list', { name: 'Locais cadastrados' })).getByRole('button', { name: /TVV/ }))
    expect(screen.queryByText(/O local deste endereço não existe mais/)).toBeNull()
  })

  it('escolher outro local mantém ?local= no endereço', () => {
    renderPage('/embarquevazios/depots?local=d2&x=1')
    fireEvent.click(within(screen.getByRole('list', { name: 'Locais cadastrados' })).getByRole('button', { name: /VBR/ }))
    expect(screen.getByTestId('location').textContent).toBe('?local=d1&x=1')
  })

  it('B15: desativar o serviço confirma e diz desativado', async () => {
    renderPage()
    await serviceRow('Transporte')
    openMenu('Mais ações do serviço Transporte', 'Desativar serviço')
    await waitFor(() => expect(mocks.upsertDepotService).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', active: false })))
    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('Serviço desativado.', 'success')
  })

  it('B31: Salvar do local mostra antes e depois; sem mudança, não grava', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^Editar$/ }))
    let dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar local' }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Nenhuma alteração para salvar.', 'info'))
    expect(mocks.upsertDepot).not.toHaveBeenCalled()

    dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Free time vazio/), { target: { value: '5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar local' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Salvar local',
      changes: [{ field: 'Free time vazio (dias)', before: '3', after: '5' }],
    })))
    await waitFor(() => expect(mocks.upsertDepot).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', free_time_vazio_days: 5, active: true })))
  })

  it('B31: Salvar do serviço mostra antes e depois', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar serviço Transporte' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Valor sugerido/), { target: { value: '120' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Salvar serviço',
      changes: [{ field: 'Valor sugerido (R$)', before: '100', after: '120' }],
    })))
  })

  it('B15: Desativar local grava o registro salvo', async () => {
    renderPage()
    openMenu('Mais ações do local VBR', 'Desativar local')
    await waitFor(() => expect(mocks.upsertDepot).toHaveBeenCalled())
    expect((mocks.upsertDepot.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).toMatchObject({ id: 'd1', name: 'Vila Velha', free_time_vazio_days: 3, active: false })
  })

  it('B15: reativar o serviço pede motivo e usa a RPC de reativação', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('switch', { name: /Mostrar os inativos/ }))
    await serviceRow('Armazenagem antiga')
    openMenu('Mais ações do serviço Armazenagem antiga', 'Reativar serviço')
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith('depot_services', 's2', 'motivo'))
  })

  it('B31: salvar serviço inativo não reverte o estado', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('switch', { name: /Mostrar os inativos/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Editar serviço Armazenagem antiga' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Valor sugerido/), { target: { value: '7' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(mocks.upsertDepotService).toHaveBeenCalled())
    expect((mocks.upsertDepotService.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).toMatchObject({ id: 's2', rate_brl: 7, active: false })
  })
})
