// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn<(containerId: number, value: string | null) => Promise<void>>(() => Promise.resolve()) }))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' }, isAdmin: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div /> }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => vi.fn() }))
vi.mock('../../services/vaziosNatureza', () => ({ setContainerUnpackingLocation: mocks.save }))
vi.mock('../../hooks/useVehicles', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    UNPACKING_LOCATION_NONE: '__none__',
    useVehicleOptions: () => ({ data: { voyages: [] } }),
    useVoyageVehicleStats: () => ({ data: { byVoyageId: {} } }),
    useVehicles: () => useQuery({
      queryKey: ['vehicles', 7],
      initialData: {
        rows: [
          { id: 11, chassis: 'CHASSI-1', container: { id: 33, container_number: 'CXRU1234567', unpacking_location: 'Terminal A' }, bl: { id: 'BL-1' } },
          { id: 12, chassis: 'CHASSI-2', container: { id: 44, container_number: 'CXRU7654321', unpacking_location: null }, bl: { id: 'BL-1' } },
          { id: 13, chassis: 'CHASSI-3', container: { id: 33, container_number: 'CXRU1234567', unpacking_location: 'Terminal A' }, bl: { id: 'BL-2' } },
        ],
        count: 3, distinctContainerCount: 1, distinctBlCount: 1, totalWeightKg: 0, totalCbm: 0,
        vehiclesByBrand: [], vehiclesByContainerType: [], containersByContainerType: [],
      },
      queryFn: async () => { throw new Error('Falha na consulta') },
    }),
  }
})
import { Veiculos } from '../Veiculos'

it('mantém a desova salva quando a releitura falha e acompanha uma atualização posterior', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  try {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Veiculos /></MemoryRouter></QueryClientProvider>)
    const input = screen.getByRole('textbox', { name: 'Local de desova do container CXRU1234567' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Terminal B' } })
    fireEvent.blur(input)
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(33, 'Terminal B'))
    await waitFor(() => expect(client.getQueryState(['vehicles', 7])?.status).toBe('error'))
    expect(input.value).toBe('Terminal B')
    client.setQueriesData<{ rows: Array<{ container: { unpacking_location: string } }> }>({ queryKey: ['vehicles'] }, (cached) => cached && ({
      ...cached, rows: cached.rows.map((row) => ({ ...row, container: { ...row.container, unpacking_location: 'Terminal C' } })),
    }))
    await waitFor(() => expect(input.value).toBe('Terminal C'))
  } finally { client.clear() }
})

it('Escape desfaz o rascunho do local sem gravar e a falha de gravação aparece junto do campo', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  try {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Veiculos /></MemoryRouter></QueryClientProvider>)
    const input = screen.getByRole('textbox', { name: 'Local de desova do container CXRU1234567' }) as HTMLInputElement
    const saved = input.value
    mocks.save.mockClear()
    fireEvent.change(input, { target: { value: 'Rascunho' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe(saved)
    expect(mocks.save).not.toHaveBeenCalled()

    mocks.save.mockRejectedValueOnce(new Error('sem permissão'))
    fireEvent.change(input, { target: { value: 'Pátio 9' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Não salvo: sem permissão')
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(input.value).toBe(saved)
  } finally { client.clear() }
})

it('dois containers gravando ao mesmo tempo: o primeiro a terminar não reabre o campo do outro', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const pending = new Map<number, () => void>()
  mocks.save.mockImplementation((containerId: number) => new Promise<void>((resolve) => { pending.set(containerId, resolve) }))
  try {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Veiculos /></MemoryRouter></QueryClientProvider>)
    const first = screen.getByRole('textbox', { name: 'Local de desova do container CXRU1234567' }) as HTMLInputElement
    const second = screen.getByRole('textbox', { name: 'Local de desova do container CXRU7654321' }) as HTMLInputElement
    fireEvent.change(first, { target: { value: 'Pátio 1' } })
    fireEvent.blur(first)
    fireEvent.change(second, { target: { value: 'Pátio 2' } })
    fireEvent.blur(second)
    await waitFor(() => expect(pending.size).toBe(2))
    expect(first.disabled && second.disabled).toBe(true)
    pending.get(33)?.()
    await waitFor(() => expect(first.disabled).toBe(false))
    expect(second.disabled).toBe(true)
    pending.get(44)?.()
    await waitFor(() => expect(second.disabled).toBe(false))
  } finally {
    mocks.save.mockImplementation(() => Promise.resolve())
    client.clear()
  }
})

it('container com veículos de dois B/Ls diz o B/L de cada veículo', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  try {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Veiculos /></MemoryRouter></QueryClientProvider>)
    const chassis3 = screen.getByText('CHASSI-3').closest('td') as HTMLElement
    expect(chassis3.textContent).toContain('BL-2')
    const chassis1 = screen.getByText('CHASSI-1').closest('td') as HTMLElement
    expect(chassis1.textContent).toContain('BL-1')
    // Container de um só B/L: o B/L fica só no cabeçalho do grupo.
    const chassis2 = screen.getByText('CHASSI-2').closest('td') as HTMLElement
    expect(chassis2.textContent).not.toContain('BL-1')
  } finally { client.clear() }
})
