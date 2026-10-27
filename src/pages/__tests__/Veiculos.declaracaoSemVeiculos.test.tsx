// @vitest-environment jsdom
// Migration 468 (reunião de testes de 2026-10-26): na viagem sem veículo
// importado, a tela Veículos oferece "Esta viagem não terá veículos"; depois de
// declarado, mostra quem declarou e "Desfazer declaração", com motivo.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

type Declaration = { voyageId: number; declaredAt: string; declaredByName: string | null } | null

const mocks = vi.hoisted(() => ({
  declaration: null as Declaration,
  declare: vi.fn<(voyageId: number) => Promise<Declaration>>(),
  undo: vi.fn<(voyageId: number, reason: string) => Promise<void>>(),
  confirm: vi.fn(async () => true),
  confirmWithReason: vi.fn(async () => 'Armador avisou que vêm veículos'),
}))

vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' }, isAdmin: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div /> }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm, useConfirmWithReason: () => mocks.confirmWithReason }))
vi.mock('../../services/vehicles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/vehicles')>()),
  fetchVoyageVehicleDeclaration: async () => mocks.declaration,
  declareVoyageWithoutVehicles: mocks.declare,
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
  mocks.declare.mockImplementation(async (voyageId) => {
    mocks.declaration = { voyageId, declaredAt: '2026-10-27T17:32:00Z', declaredByName: 'Equipamentos 468' }
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

it('sem veículo nem declaração, oferece importar e declarar; declarar mostra quem declarou', async () => {
  renderPage()
  expect(screen.getByText('Nenhum veículo nesta viagem')).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: 'Esta viagem não terá veículos' }))

  await waitFor(() => expect(mocks.declare).toHaveBeenCalledWith(7))
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Declarar sem veículos' }))
  expect(await screen.findByText('Viagem sem veículos')).toBeTruthy()
  expect(screen.getByText(/Declarado por Equipamentos 468 em 27\/10\/2026 às 14:32/)).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Importar veículos' }).length).toBeGreaterThan(0)
})

it('viagem declarada: desfazer pede motivo e volta a oferecer a declaração', async () => {
  mocks.declaration = { voyageId: 7, declaredAt: '2026-10-27T17:32:00Z', declaredByName: 'Equipamentos 468' }
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
