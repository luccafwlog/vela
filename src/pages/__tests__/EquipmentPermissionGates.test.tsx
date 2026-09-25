// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  can: vi.fn<(permission: string) => boolean>(),
  effectiveRole: vi.fn(() => 'documentacao'),
  isAdmin: vi.fn(() => false),
  profile: { id: 'user-1' } as { id: string } | null,
  invalidateQueries: vi.fn(() => Promise.resolve()),
  updateVaziosBooking: vi.fn(() => Promise.resolve()),
  upsertVaziosExportOperation: vi.fn(() => Promise.resolve({ id: 'operation-1' })),
  upsertOperationServiceQty: vi.fn(() => Promise.resolve()),
  vaziosRows: [] as Array<Record<string, unknown>>,
  vaziosOperation: null as Record<string, unknown> | null,
  vaziosOperationError: null as Error | null,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'vazios-importacao-manifests') {
      return { data: [], isLoading: false, error: null }
    }
    if (queryKey[0] === 'vazios-bookings') {
      return {
        data: { rows: mocks.vaziosRows, count: mocks.vaziosRows.length },
        isLoading: false,
        error: null,
      }
    }
    if (queryKey[0] === 'vazios-export-operation') {
      return { data: mocks.vaziosOperation, isLoading: false, error: mocks.vaziosOperationError }
    }
    if (queryKey[0] === 'vazios-bookings' && queryKey[1] === 'operation-options') {
      return { data: { rows: mocks.vaziosRows }, isLoading: false, error: null }
    }
    if (queryKey[0] === 'vehicles-voyage-card-schedules') {
      return { data: new Map(), isLoading: false, error: null }
    }
    if (queryKey[0] === 'vazios-cost-catalog') {
      return { data: { depots: new Map([['d1', { id: 'd1', free_time_days: 2 }]]), services: [{ id: 's1', depot_id: 'd1', name: 'Bundle Composition', calc_type: 'quantidade', rate_brl: 30, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null }] }, isLoading: false, error: null }
    }
    return { data: { rows: [], count: 0 }, isLoading: false, error: null }
  },
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    isAdmin: mocks.isAdmin(),
    effectiveRole: mocks.effectiveRole(),
    user: mocks.profile ? { id: 'user-1' } : null,
    can: mocks.can,
    profile: mocks.profile,
  }),
}))
vi.mock('../../hooks/useVehicles', () => ({
  useVehicleOptions: () => ({ data: { voyages: [{ id: 7, voyage_number: '14N', vessel: { name: 'GREEN SANTOS' } }] } }),
  useVoyageVehicleStats: () => ({ data: { byVoyageId: {} } }),
  useVehicles: () => ({
    data: {
      rows: [{
        id: 11,
        chassis: 'CHASSI-1',
        brand: 'Marca',
        model: 'Modelo',
        weight_kg: 1200,
        cbm: 10,
        container: { container_number: 'CXRU1234567', type: '40HC', seal_number: 'L1' },
        bl: { id: 'BL-1' },
      }],
      count: 1,
      distinctContainerCount: 1,
      distinctBlCount: 1,
      totalWeightKg: 1200,
      vehiclesByBrand: [],
      vehiclesByContainerType: [],
      containersByContainerType: [],
    },
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div /> }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))
vi.mock('../../services/vehicles', () => ({ deleteVehicles: vi.fn() }))
vi.mock('../../services/vehicleImport', () => ({
  importVehicleRows: vi.fn(),
  parseVehicleImportFile: vi.fn(),
}))
vi.mock('../../services/vaziosImport', () => ({
  importVaziosManifest: vi.fn(),
  listVaziosBookings: vi.fn(),
  parseVaziosManifestFile: vi.fn(),
}))
vi.mock('../../services/vaziosExportOperations', () => ({
  getVaziosExportOperation: vi.fn(),
  listVaziosBookingsForOperation: vi.fn(),
  updateVaziosBooking: mocks.updateVaziosBooking,
  upsertOperationServiceQty: mocks.upsertOperationServiceQty,
  upsertVaziosExportOperation: mocks.upsertVaziosExportOperation,
}))

import { EmbarqueVazios } from '../EmbarqueVazios'
import { Granite } from '../Granite'
import { Veiculos } from '../Veiculos'
import { VaziosImportacao } from '../VaziosImportacao'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.effectiveRole.mockReturnValue('documentacao')
  mocks.isAdmin.mockReturnValue(false)
  mocks.profile = { id: 'user-1' }
  mocks.vaziosRows = []
  mocks.vaziosOperation = null
  mocks.vaziosOperationError = null
})

afterEach(cleanup)

function renderPage(page: React.ReactNode, initialEntry = '/') {
  render(<MemoryRouter initialEntries={[initialEntry]}>{page}</MemoryRouter>)
}

describe('controles de Veiculos', () => {
  it('Equipamentos importa, mas nao recebe exclusao reservada ao admin', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    mocks.can.mockImplementation((permission) => permission === 'veiculos_edit')

    renderPage(<Veiculos />, '/?voyage=7')

    expect(screen.getByRole('button', { name: 'Importar Veículos' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Excluir veiculo CHASSI-1' })).toBeNull()
  })

  it('Documentacao importa, mas nao recebe exclusao reservada ao admin', () => {
    mocks.effectiveRole.mockReturnValue('documentacao')
    mocks.can.mockImplementation((permission) => permission === 'veiculos_edit')

    renderPage(<Veiculos />, '/?voyage=7')

    expect(screen.getByRole('button', { name: 'Importar Veículos' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Excluir veiculo CHASSI-1' })).toBeNull()
  })

  it('admin recebe importacao e exclusao', () => {
    mocks.isAdmin.mockReturnValue(true)
    mocks.can.mockImplementation((permission) => permission === 'veiculos_edit')

    renderPage(<Veiculos />, '/?voyage=7')

    expect(screen.getByRole('button', { name: 'Importar Veículos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Excluir veiculo CHASSI-1' })).toBeTruthy()
  })

  it('oculta importacao e exclusao sem veiculos_edit', () => {
    mocks.profile = null

    renderPage(<Veiculos />, '/?voyage=7')

    expect(screen.queryByRole('button', { name: 'Importar Veículos' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Excluir veiculo CHASSI-1' })).toBeNull()
  })
})

describe('imports fora do escopo de Equipamentos', () => {
  it('permite importacao de Granito para Equipamentos', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')

    renderPage(<Granite />)

    expect(screen.getByRole('button', { name: 'Importar Planilha COSCO' })).toBeTruthy()
  })

  it('permite importacao de Vazios IMP e preserva exportacao', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')

    renderPage(<VaziosImportacao />)

    expect(screen.getByRole('button', { name: 'Exportar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Importar Planilha' })).toBeTruthy()
  })
})

describe('controles de Vazios EXP', () => {
  it('exibe o formulário de criação para quem possui vazios_edit', () => {
    mocks.can.mockImplementation((permission) => permission === 'vazios_edit')
    renderPage(<EmbarqueVazios />)
    expect(screen.getByRole('button', { name: /criar/i })).toBeTruthy()
  })

  it('mantém a criação bloqueada sem vazios_edit', () => {
    mocks.can.mockReturnValue(false)
    renderPage(<EmbarqueVazios />)
    expect((screen.getByRole('button', { name: /criar/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('apresenta a regra de substituição total da lista', () => {
    mocks.can.mockImplementation((permission) => permission === 'vazios_edit')
    renderPage(<EmbarqueVazios />)
    expect(screen.getByText(/um embarque por escala/i)).toBeTruthy()
  })
})
