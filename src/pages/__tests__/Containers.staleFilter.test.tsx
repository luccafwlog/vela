// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

type Page = { rows: unknown[]; count: number; distinctCount: number; blCount: number; oogDistinctCount: number; imoDistinctCount: number; typeSummary: [] }
const page = (containerNumber: string, id: number): Page => ({
  rows: [{ id, container_number: containerNumber, type: '40HC', bl: { id: `BL-${id}`, voyage_id: 24 } }],
  count: 1, distinctCount: 1, blCount: 1, oogDistinctCount: 0, imoDistinctCount: 0, typeSummary: [],
})
const mocks = vi.hoisted(() => ({ releaseBrssz: null as ((value: Page) => void) | null }))
vi.mock('../../services/operationalLists', () => ({
  listOperationalContainers: (filters: { pod?: string }) => filters.pod === 'BRSSZ'
    ? new Promise<Page>((resolve) => { mocks.releaseBrssz = resolve })
    : Promise.resolve(page('CXRU1234567', 33)),
  getOperationalBlSummary: async () => ({ totalDistinctContainers: 1 }),
  listOperationalVoyageSummaries: async () => ({ rows: [], count: 0 }),
  fetchOperationalFilterOptions: async () => ({ pols: [], pods: ['BRSSZ'], containerTypes: [] }),
}))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => async () => 'teste local' }))

import { Containers } from '../Containers'
import { STALE_PAGE_CLASS } from '../../lib/pagination'

it('trocar o POD deixa as linhas do recorte anterior esmaecidas, sem seleção e sem totais até a resposta', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['voyage-options'], [])
  try {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/containers']}><Containers /></MemoryRouter></QueryClientProvider>)
    const oldRow = await screen.findByRole('checkbox', { name: 'Selecionar container CXRU1234567' })
    const table = screen.getByRole('table').closest('.app-table-scroll') as HTMLElement
    expect(table.getAttribute('aria-busy')).toBeNull()
    expect(within(screen.getByRole('group', { name: 'Totais do recorte' })).getByText('Containers').parentElement?.textContent).toContain('1')

    // POD fica sempre aberto (lote 2, como na lista de BLs): não há painel a abrir.
    await waitFor(() => expect((screen.getByLabelText('POD') as HTMLSelectElement).innerHTML).toContain('BRSSZ'))
    fireEvent.change(screen.getByLabelText('POD'), { target: { value: 'BRSSZ' } })

    // Resposta do novo recorte ainda a caminho: a linha antiga fica, mas marcada.
    await waitFor(() => expect(table.getAttribute('aria-busy')).toBe('true'))
    expect(table.className).toContain(STALE_PAGE_CLASS)
    expect((oldRow as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Selecionar todos os containers da página' }) as HTMLInputElement).disabled).toBe(true)
    expect(within(screen.getByRole('group', { name: 'Totais do recorte' })).getByText('Containers').parentElement?.textContent).toContain('—')

    mocks.releaseBrssz?.(page('MSCU7654321', 44))
    const newRow = await screen.findByRole('checkbox', { name: 'Selecionar container MSCU7654321' })
    expect(screen.queryByText('CXRU1234567')).toBeNull()
    expect((newRow as HTMLInputElement).disabled).toBe(false)
    const freshTable = screen.getByRole('table').closest('.app-table-scroll') as HTMLElement
    expect(freshTable.getAttribute('aria-busy')).toBeNull()
    expect(freshTable.className).not.toContain(STALE_PAGE_CLASS)
  } finally { client.clear() }
})
