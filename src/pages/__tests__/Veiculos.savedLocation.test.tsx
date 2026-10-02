// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn(() => Promise.resolve()) }))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' }, isAdmin: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div /> }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => vi.fn() }))
vi.mock('../../services/vaziosNatureza', () => ({ setContainerUnpackingLocation: mocks.save }))
vi.mock('../../hooks/useVehicles', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    useVehicleOptions: () => ({ data: { voyages: [] } }),
    useVoyageVehicleStats: () => ({ data: { byVoyageId: {} } }),
    useVehicles: () => useQuery({
      queryKey: ['vehicles', 7],
      initialData: {
        rows: [{ id: 11, chassis: 'CHASSI-1', container: { id: 33, container_number: 'CXRU1234567', unpacking_location: 'Terminal A' }, bl: { id: 'BL-1' } }],
        count: 1, distinctContainerCount: 1, distinctBlCount: 1, totalWeightKg: 0, totalCbm: 0,
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
