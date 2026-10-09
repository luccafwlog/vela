// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

const source = vi.hoisted(() => ({ exists: true }))
vi.mock('../../services/operationalLists', () => ({
  listOperationalContainers: async () => ({
    rows: source.exists ? [{ id: 33, container_number: 'CXRU1234567', type: '40HC', bl: { id: 'BL1', voyage_id: 24 } }] : [],
    count: Number(source.exists), distinctCount: Number(source.exists), blCount: Number(source.exists),
    oogDistinctCount: 0, imoDistinctCount: 0, typeSummary: [],
  }),
  getOperationalBlSummary: async () => ({ totalDistinctContainers: Number(source.exists) }),
  listOperationalVoyageSummaries: async () => ({ rows: [{ id: 24, containerCount: Number(source.exists) }], count: 1 }),
}))
vi.mock('../../services/containers', () => ({
  checkContainerDependencies: async () => ({ deletableIds: [33], blockedIds: [] }),
  deleteContainers: async () => { source.exists = false; return { deletableIds: [33], blockedIds: [] } },
}))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => async () => 'teste local' }))

import { Containers } from '../Containers'
import { useBlSummary, useVoyages, type BlFilters } from '../../hooks/useBls'
const filters: BlFilters = { search: '', voyageId: '', pol: '', pod: '', reviewStatus: '', financialStatus: '', chargeStatus: '', cargoProfile: '', page: 1, pageSize: 20 }
function ConsumerCards() {
  const summary = useBlSummary(filters)
  const voyages = useVoyages()
  return <><output aria-label="Containers no resumo de B/Ls">{summary.data?.totalDistinctContainers}</output><output aria-label="Containers no card da Viagem">{voyages.data?.[0]?.containerCount}</output></>
}

it('excluir Container remove a linha e atualiza os cards abertos de Containers, B/Ls e Viagens sem reload', async () => {
  source.exists = true
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['port-options'], { pols: [], pods: [] })
  client.setQueryData(['container-type-options'], [])
  client.setQueryData(['voyage-options'], [])
  try {
    render(<QueryClientProvider client={client}><MemoryRouter><Containers /><ConsumerCards /></MemoryRouter></QueryClientProvider>)
    await screen.findByText('CXRU1234567')
    await waitFor(() => expect(screen.getByLabelText('Containers no resumo de B/Ls').textContent).toBe('1'))
    expect(screen.getByLabelText('Containers no card da Viagem').textContent).toBe('1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar todos os containers da página' }))
    fireEvent.click(screen.getByRole('button', { name: /Excluir/ }))
    await waitFor(() => expect(screen.queryByText('CXRU1234567')).toBeNull())
    await waitFor(() => expect(screen.getByLabelText('Containers no resumo de B/Ls').textContent).toBe('0'))
    expect(screen.getByLabelText('Containers no card da Viagem').textContent).toBe('0')
    expect(screen.getByText('containers distintos').parentElement?.textContent).toContain('0')
  } finally { client.clear() }
})

function CurrentSearch() {
  return <output aria-label="Endereço">{useLocation().search}</output>
}

it('link para /containers com a página aberta troca o recorte em vez de ser sobrescrito pelos filtros antigos', async () => {
  source.exists = true
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['port-options'], { pols: [], pods: ['BRSSZ', 'BRVIX'] })
  client.setQueryData(['container-type-options'], [])
  client.setQueryData(['voyage-options'], [])
  try {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/containers?pod=BRSSZ']}>
          <Link to="/containers">Menu Containers</Link>
          <Link to="/containers?pod=BRVIX">Line-Up BRVIX</Link>
          <Containers />
          <CurrentSearch />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const pod = screen.getByLabelText('POD') as HTMLSelectElement
    expect(pod.value).toBe('BRSSZ')
    fireEvent.click(screen.getByRole('link', { name: 'Line-Up BRVIX' }))
    await waitFor(() => expect(pod.value).toBe('BRVIX'))
    expect(screen.getByLabelText('Endereço').textContent).toBe('?pod=BRVIX')
    fireEvent.click(screen.getByRole('link', { name: 'Menu Containers' }))
    await waitFor(() => expect(pod.value).toBe(''))
    expect(screen.getByLabelText('Endereço').textContent).toBe('')
    // Mudar o filtro na tela continua gravando na URL.
    fireEvent.change(pod, { target: { value: 'BRSSZ' } })
    await waitFor(() => expect(screen.getByLabelText('Endereço').textContent).toBe('?pod=BRSSZ'))
  } finally { client.clear() }
})

it('página além do resultado, vinda da URL, volta para a última página com linhas', async () => {
  source.exists = true
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['port-options'], { pols: [], pods: [] })
  client.setQueryData(['container-type-options'], [])
  client.setQueryData(['voyage-options'], [])
  try {
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/containers?page=999']}><Containers /><CurrentSearch /></MemoryRouter></QueryClientProvider>)
    await waitFor(() => expect(screen.getByLabelText('Endereço').textContent).toBe(''))
    expect(await screen.findByText('CXRU1234567')).toBeTruthy()
  } finally { client.clear() }
})
