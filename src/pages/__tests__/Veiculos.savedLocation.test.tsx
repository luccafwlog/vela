// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn<(containerId: number, value: string | null) => Promise<void>>(() => Promise.resolve()) }))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' }, isAdmin: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div /> }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => vi.fn() }))
vi.mock('../../services/vaziosNatureza', () => ({ setContainerUnpackingLocation: mocks.save }))
vi.mock('../../hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useVehicles')>()
  const { useQuery } = await import('@tanstack/react-query')
  return {
    ...actual,
    useVehicleOptions: () => ({ data: { voyages: [] } }),
    useVoyageVehicleStats: () => ({ data: { byVoyageId: {} } }),
    // Mesmo formato do hook real: o cache guarda as linhas cruas da viagem e a
    // tela recebe o recorte do `select`.
    useVehicles: () => useQuery({
      queryKey: ['vehicles', 7],
      initialData: [
        { id: 11, chassis: 'CHASSI-1', container: { id: 33, container_number: 'CXRU1234567', unpacking_location: 'Terminal A' }, bl: { id: 'BL-1' } },
        { id: 12, chassis: 'CHASSI-2', container: { id: 44, container_number: 'CXRU7654321', unpacking_location: null }, bl: { id: 'BL-1' } },
        { id: 13, chassis: 'CHASSI-3', container: { id: 33, container_number: 'CXRU1234567', unpacking_location: 'Terminal A' }, bl: { id: 'BL-2' } },
      ],
      select: (rows) => ({
        rows, filteredRows: rows, count: rows.length, filteredIds: rows.map((row) => row.id),
        containerIdByVehicleId: Object.fromEntries(rows.map((row) => [row.id, row.container.id])),
        distinctContainerCount: 1, distinctBlCount: 1, totalWeightKg: 0, totalCbm: 0,
        vehiclesByBrand: [], vehiclesByContainerType: [], containersByContainerType: [],
      }),
      queryFn: async () => { throw new Error('Falha na consulta') },
    }),
  }
})
import { Veiculos } from '../Veiculos'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Veiculos /></MemoryRouter></QueryClientProvider>)
  return client
}

function openDialog() {
  fireEvent.click(screen.getAllByRole('button', { name: /Definir local de desova/ })[0])
  return screen.getByRole('dialog')
}

it('uma linha por veículo, ordenada por container, com o local em texto e "Sem local" em âmbar', () => {
  const client = renderPage()
  try {
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('CXRU1234567')).toBeTruthy()
    expect(screen.getAllByRole('cell', { name: 'Terminal A' })).toHaveLength(2)
    expect(screen.getByRole('cell', { name: 'Sem local' })).toBeTruthy()
    // Cada veículo diz o seu B/L, também quando o container tem dois B/Ls.
    expect(screen.getByRole('link', { name: 'BL-2' })).toBeTruthy()
  } finally { client.clear() }
})

it('com veículos marcados, a janela começa nos marcados e grava só os containers deles', async () => {
  const client = renderPage()
  try {
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar veículo CHASSI-2' }))
    const dialog = openDialog()
    expect((within(dialog).getByRole('radio', { name: /1 veículo marcado/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Local de desova/), { target: { value: 'Pátio 3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar a 1 container' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith(44, 'Pátio 3')
  } finally { client.clear(); mocks.save.mockClear() }
})

it('"Só os sem local" não muda o container que já tem local', async () => {
  const client = renderPage()
  try {
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: /Só os 1 veículo sem local/ }))
    fireEvent.change(within(dialog).getByLabelText(/Local de desova/), { target: { value: 'Pátio 3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar a 1 container' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith(44, 'Pátio 3')
  } finally { client.clear(); mocks.save.mockClear() }
})

it('a falha da gravação fica na janela, com o que fazer', async () => {
  mocks.save.mockRejectedValueOnce(new Error('sem permissão'))
  const client = renderPage()
  try {
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: /Todos os 3 veículos do recorte/ }))
    fireEvent.change(within(dialog).getByLabelText(/Local de desova/), { target: { value: 'Pátio 3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar a 2 containers' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('sem permissão')
  } finally { client.clear(); mocks.save.mockClear() }
})
