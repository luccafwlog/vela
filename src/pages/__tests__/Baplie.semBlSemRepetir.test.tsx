// @vitest-environment jsdom
// Obs. 1 da sessão de testes de 2026-10-20 ("tabelas duplicadas"): na GREEN
// ITAJAI / 11 o grupo "No Baplie, sem B/L" listava os 482 cheios, que a lista
// "Containers do Baplie" mostra de novo, cada um com "Sem B/L". O grupo não
// repete a tabela: o botão filtra a lista. O "BM" que o armador manda no lugar
// do B/L citado não aparece como B/L.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
}))

const full = (id: number, container: string) => ({
  id, container_number: container, status: 'full', size_type: '45G0', pol: 'CNNGB', pod: 'BRVIX', final_dest: 'BRVIX',
  slot: `04010${id}4`, bl_ref: null, is_imo: false, is_oog: false, imo_class: null, un_number: null, ownership: null,
  imported_at: '2026-10-20T18:24:50Z',
})

vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' } }) }))
vi.mock('../../hooks/useBls', () => ({ useVoyages: () => ({ data: [], isLoading: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => null }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))
vi.mock('../../services/baplieImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/baplieImport')>()),
  hasPendingBaplieVazios: vi.fn(() => Promise.resolve(false)),
}))
vi.mock('../../services/baplieReconciliation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/baplieReconciliation')>(),
  reconcileBaplieWithManifest: mocks.reconcile,
  countPendingBapliePhysicalFlags: vi.fn(() => Promise.resolve(0)),
}))
vi.mock('../../services/baplieReadModel', () => ({
  hasBlsForVoyage: vi.fn(() => Promise.resolve(true)),
  listBaplieStaging: vi.fn(() => Promise.resolve([full(1, 'BEAU4381520'), full(2, 'BEAU4406130'), full(3, 'CSGU6733222')])),
}))
vi.mock('../../services/vaziosImportacaoImport', () => ({
  getBaplieManifestForVoyage: vi.fn(() => Promise.resolve(null)), importVaziosFromBaplie: vi.fn(), replaceVaziosFromBaplie: vi.fn(),
}))

import { Baplie } from '../Baplie'

const missing = [
  { kind: 'missing_in_manifest', container_number: 'BEAU4381520', baplie_bl_ref: null, slot: '0401084' },
  { kind: 'missing_in_manifest', container_number: 'BEAU4406130', baplie_bl_ref: null, slot: '0400584' },
]

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.reconcile.mockResolvedValue({ source: 'reconciled', pendingRoutes: [], items: missing })
})
afterEach(() => client.clear())

it('"No Baplie, sem B/L" não repete a tabela: o botão filtra a lista de containers', async () => {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Baplie /></MemoryRouter></QueryClientProvider>)

  const button = await screen.findByRole('button', { name: 'Ver os 2 containers na lista' })
  expect(screen.getByRole('heading', { name: 'No Baplie, sem B/L (2)' })).toBeTruthy()
  // Só uma tabela de containers na página: a lista.
  expect(screen.queryByRole('table', { name: 'Containers no Baplie sem B/L' })).toBeNull()
  const list = screen.getByRole('table', { name: 'Containers do Baplie da viagem' })
  expect(within(list).getAllByRole('row')).toHaveLength(4)

  fireEvent.click(button)
  const filtered = screen.getByRole('table', { name: 'Containers do Baplie da viagem' })
  const rows = within(filtered).getAllByRole('row').slice(1)
  expect(rows.map((row) => within(row).getByText(/^[A-Z]{4}\d{7}$/).textContent)).toEqual(['BEAU4381520', 'BEAU4406130'])
  expect(screen.getByText('2 de 3 containers')).toBeTruthy()
})

// Sessão de testes de 2026-10-21: os grupos de divergência paginam como a
// lista de containers (20 por página), em vez de listar tudo de uma vez.
it('grupo de divergência longo pagina de 20 em 20', async () => {
  const outside = Array.from({ length: 25 }, (_, index) => ({
    kind: 'missing_in_baplie', container_number: `ZZZU${String(index).padStart(7, '0')}`, bl_container_id: index + 1, bl_id: `BL-${index}`,
  }))
  mocks.reconcile.mockResolvedValue({ source: 'reconciled', pendingRoutes: [], items: outside })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Baplie /></MemoryRouter></QueryClientProvider>)

  const table = await screen.findByRole('table', { name: 'Containers em B/L ausentes do Baplie' })
  expect(within(table).getAllByRole('row')).toHaveLength(21)
  const group = table.closest('[id="baplie-fora"]') as HTMLElement
  expect(within(group).getByText('Página 1 de 2')).toBeTruthy()
  fireEvent.click(within(group).getByRole('button', { name: /Próxima/ }))
  expect(within(screen.getByRole('table', { name: 'Containers em B/L ausentes do Baplie' })).getAllByRole('row')).toHaveLength(6)
})
