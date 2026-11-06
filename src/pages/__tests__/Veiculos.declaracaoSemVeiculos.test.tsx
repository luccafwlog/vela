// @vitest-environment jsdom
// Migrations 468 e 597: na viagem sem veículo importado, a tela Veículos pede a
// resposta de Equipamentos, "Esta viagem terá veículos" ou "não terá"; depois
// de respondido, mostra quem declarou, a trava do CE Mercante quando a viagem
// terá veículos, "Trocar para..." e "Desfazer declaração", com motivo.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

type Declaration = { voyageId: number; hasVehicles: boolean; declaredAt: string; declaredByName: string | null } | null

const mocks = vi.hoisted(() => ({
  declaration: null as Declaration,
  voyageStatus: 'active',
  canAnswer: true,
  declare: vi.fn<(voyageId: number, hasVehicles: boolean, reason?: string) => Promise<Declaration>>(),
  undo: vi.fn<(voyageId: number, reason: string) => Promise<void>>(),
  confirm: vi.fn(async () => true),
  confirmWithReason: vi.fn(async () => 'Armador avisou que vêm veículos'),
}))

vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' }, isAdmin: false, can: (permission: string) => permission !== 'declare_voyage_vehicles' || mocks.canAnswer }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div /> }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm, useConfirmWithReason: () => mocks.confirmWithReason }))
vi.mock('../../hooks/useBls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useBls')>()),
  useVoyages: () => ({ data: [{ id: 7, voyage_number: '012S', status: mocks.voyageStatus, vessel: { name: 'MSC TESTE' } }] }),
}))
vi.mock('../../services/vehicles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/vehicles')>()),
  fetchVoyageVehicleDeclaration: async () => mocks.declaration,
  declareVoyageVehicles: mocks.declare,
  undoVoyageVehicleDeclaration: mocks.undo,
}))
vi.mock('../../hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useVehicles')>()
  const { useQuery } = await import('@tanstack/react-query')
  return {
    ...actual,
    useVehicleOptions: () => ({ data: { voyages: [] } }),
    useVoyageVehicleStats: () => ({ data: { byVoyageId: {} } }),
    useVehicles: () => useQuery({
      queryKey: ['vehicles', 7],
      initialData: [],
      select: () => ({
        rows: [], filteredRows: [], count: 0, filteredIds: [], containerIdByVehicleId: {}, vehicleCountByContainerId: {},
        distinctContainerCount: 0, distinctBlCount: 0, totalWeightKg: 0, totalCbm: 0,
        vehiclesByBrand: [], vehiclesByContainerType: [], containersByContainerType: [], unpackingLocations: [],
      }),
      queryFn: async () => [],
    }),
  }
})
import { Veiculos } from '../Veiculos'

beforeEach(() => {
  mocks.declaration = null
  mocks.voyageStatus = 'active'
  mocks.canAnswer = true
  mocks.declare.mockImplementation(async (voyageId, hasVehicles) => {
    mocks.declaration = { voyageId, hasVehicles, declaredAt: '2026-10-27T17:32:00Z', declaredByName: 'Equipamentos 468' }
    return mocks.declaration
  })
  mocks.undo.mockImplementation(async () => { mocks.declaration = null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Veiculos /></MemoryRouter></QueryClientProvider>)
}

it('sem veículo nem declaração, oferece importar e as duas respostas; "não terá" mostra quem declarou', async () => {
  renderPage()
  expect(screen.getByText('Nenhum veículo nesta viagem')).toBeTruthy()
  expect(screen.getByText(/sem a resposta, o CE Mercante dos B\/Ls de container fica travado/)).toBeTruthy()
  expect(await screen.findByRole('button', { name: 'Esta viagem terá veículos' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Esta viagem não terá veículos' }))

  await waitFor(() => expect(mocks.declare).toHaveBeenCalledWith(7, false, undefined))
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Declarar sem veículos' }))
  expect(await screen.findByText('Viagem sem veículos')).toBeTruthy()
  expect(screen.getByText(/Declarado por Equipamentos 468 em 27\/10\/2026 às 14:32/)).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Importar veículos' }).length).toBeGreaterThan(0)
})

it('"terá veículos" avisa que o CE Mercante de container fica travado até a planilha', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Esta viagem terá veículos' }))

  await waitFor(() => expect(mocks.declare).toHaveBeenCalledWith(7, true, undefined))
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Declarar com veículos' }))
  expect(await screen.findByText('Viagem com veículos a importar')).toBeTruthy()
  expect(screen.getByText(/O CE Mercante dos B\/Ls de container fica travado até a planilha de Veículos ser importada\./)).toBeTruthy()
})

it('trocar a resposta pede motivo e o envia ao banco', async () => {
  mocks.declaration = { voyageId: 7, hasVehicles: true, declaredAt: '2026-10-27T17:32:00Z', declaredByName: 'Equipamentos 468' }
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Trocar para sem veículos' }))

  await waitFor(() => expect(mocks.declare).toHaveBeenCalledWith(7, false, 'Armador avisou que vêm veículos'))
  expect(mocks.confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Trocar resposta' }))
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(await screen.findByText('Viagem sem veículos')).toBeTruthy()
})

it('viagem declarada: desfazer pede motivo e volta a oferecer a declaração', async () => {
  mocks.declaration = { voyageId: 7, hasVehicles: false, declaredAt: '2026-10-27T17:32:00Z', declaredByName: 'Equipamentos 468' }
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Desfazer declaração' }))

  await waitFor(() => expect(mocks.undo).toHaveBeenCalledWith(7, 'Armador avisou que vêm veículos'))
  expect(await screen.findByRole('button', { name: 'Esta viagem não terá veículos' })).toBeTruthy()
  expect(screen.getByText('Nenhum veículo nesta viagem')).toBeTruthy()
})

it('voltar no diálogo não declara', async () => {
  mocks.confirm.mockResolvedValueOnce(false)
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Esta viagem não terá veículos' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.declare).not.toHaveBeenCalled()
})

it('viagem cancelada não oferece a declaração, que o banco recusaria', async () => {
  mocks.voyageStatus = 'cancelled'
  renderPage()
  expect(await screen.findByText('Nenhum veículo nesta viagem')).toBeTruthy()
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Importar veículos' }).length).toBeGreaterThan(0))
  expect(screen.queryByRole('button', { name: 'Esta viagem não terá veículos' })).toBeNull()
})

it('quem não é de Equipamentos nem do Administrativo não vê as respostas nem o desfazer', async () => {
  mocks.canAnswer = false
  renderPage()
  expect(await screen.findByText('Nenhum veículo nesta viagem')).toBeTruthy()
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Importar veículos' }).length).toBeGreaterThan(0))
  expect(screen.queryByRole('button', { name: 'Esta viagem terá veículos' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Esta viagem não terá veículos' })).toBeNull()

  cleanup()
  mocks.declaration = { voyageId: 7, hasVehicles: true, declaredAt: '2026-10-27T17:32:00Z', declaredByName: 'Equipamentos 468' }
  renderPage()
  expect(await screen.findByText('Viagem com veículos a importar')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Desfazer declaração' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Trocar para sem veículos' })).toBeNull()
})
