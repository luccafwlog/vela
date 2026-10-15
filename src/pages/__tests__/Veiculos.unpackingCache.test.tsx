// @vitest-environment jsdom
// Usa o useVehicles real: o cache da lista guarda as linhas cruas da viagem, e a
// gravação do local de desova precisa atualizar esse formato, não o da tela.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const rows: Array<{ id: number; chassis: string; voyage_id: number; container_id: number; container: { id: number; container_number: string; type: string; seal_number: null; unpacking_location: string | null }; bl: { id: string } }> = [
    { id: 11, chassis: 'CHASSI-1', voyage_id: 7, container_id: 33, container: { id: 33, container_number: 'CXRU1234567', type: '40HC', seal_number: null, unpacking_location: 'Terminal A' }, bl: { id: 'BL-1' } },
  ]
  // A gravação muda o "banco"; a releitura depois dela devolve o valor novo.
  const save = vi.fn(async (containerId: number, value: string | null) => {
    for (const row of rows) if (row.container.id === containerId) row.container.unpacking_location = value
  })
  return { rows, save }
})
// Busca por chassi fica pendente até o teste liberar, para ver o recorte anterior na tela.
const pending = vi.hoisted(() => ({ release: null as (() => void) | null }))
vi.mock('../../services/supabase', () => ({
  supabase: {
    from: () => {
      let searching = false
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'order', 'in', 'or']) chain[method] = () => chain
      chain.ilike = (column: string) => { if (column === 'chassis') searching = true; return chain }
      chain.range = () => searching
        ? new Promise((resolve) => { pending.release = () => resolve({ data: [], error: null }) })
        : Promise.resolve({ data: structuredClone(mocks.rows), error: null })
      return chain
    },
  },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' }, isAdmin: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => <div /> }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => vi.fn() }))
vi.mock('../../services/vaziosNatureza', () => ({ setContainerUnpackingLocation: mocks.save }))
vi.mock('../../hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useVehicles')>()
  return {
    ...actual,
    useVehicleOptions: () => ({ data: { voyages: [] } }),
    useVoyageVehicleStats: () => ({ data: { byVoyageId: {} } }),
  }
})
import { Veiculos } from '../Veiculos'
import { STALE_PAGE_CLASS } from '../../lib/pagination'

it('local de desova gravado fica no campo e no cache, sem aviso de falha', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  try {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Veiculos /></MemoryRouter></QueryClientProvider>)
    const input = await screen.findByRole('textbox', { name: 'Local de desova do container CXRU1234567' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Terminal B' } })
    fireEvent.blur(input)

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(33, 'Terminal B'))
    expect(await screen.findByText('Salvo')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input.value).toBe('Terminal B')
    const cached = client.getQueriesData<Array<{ container: { unpacking_location: string | null } }>>({ queryKey: ['vehicles'] })
    expect(cached.flatMap(([, rows]) => rows ?? []).map((row) => row.container.unpacking_location)).toEqual(['Terminal B'])
  } finally { client.clear() }
})

it('busca por chassi deixa os veículos anteriores esmaecidos e sem seleção até a resposta', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  try {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Veiculos /></MemoryRouter></QueryClientProvider>)
    const row = await screen.findByRole('checkbox', { name: 'Selecionar veículo CHASSI-1' }) as HTMLInputElement
    const table = screen.getByRole('table').closest('.app-table-scroll') as HTMLElement
    expect(table.getAttribute('aria-busy')).toBeNull()

    const toggle = screen.queryByRole('button', { name: /Filtros/, expanded: false })
    if (toggle) fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('Chassi'), { target: { value: 'XYZ' } })
    await waitFor(() => expect(table.getAttribute('aria-busy')).toBe('true'), { timeout: 2000 })
    expect(table.className).toContain(STALE_PAGE_CLASS)
    expect(row.disabled).toBe(true)

    pending.release?.()
    expect(await screen.findByText('Nenhum veículo neste recorte')).not.toBeNull()
  } finally { client.clear() }
})
