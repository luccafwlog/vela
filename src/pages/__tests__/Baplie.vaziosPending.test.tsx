// @vitest-environment jsdom
// ADR 0091, item 5: o recadastro dos vazios que falhou na importação continua
// em /baplie depois de fechar o aviso. A tela recalcula a pendência comparando
// os vazios do Baplie com os cadastrados — mesmo com a mesma quantidade.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pending: vi.fn(() => Promise.resolve(true)),
  retry: vi.fn(() => Promise.resolve()),
  manifest: vi.fn(() => Promise.resolve({ id: 'vm-1', total_containers: 1, imported_at: '2026-10-08T10:00:00Z' } as unknown)),
  showToast: vi.fn(),
}))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' } }) }))
vi.mock('../../hooks/useBls', () => ({ useVoyages: () => ({ data: [], isLoading: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({ VoyageCombobox: () => null }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))
vi.mock('../../services/baplieImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/baplieImport')>()),
  hasPendingBaplieVazios: mocks.pending,
  retryBaplieVazios: mocks.retry,
}))
vi.mock('../../services/baplieReconciliation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/baplieReconciliation')>(),
  reconcileBaplieWithManifest: vi.fn(), countPendingBapliePhysicalFlags: vi.fn(() => Promise.resolve(0)),
}))
vi.mock('../../services/baplieReadModel', () => ({
  hasBlsForVoyage: vi.fn(() => Promise.resolve(false)),
  listBaplieStaging: vi.fn(() => Promise.resolve([
    { id: 1, container_number: 'EMPU0000001', status: 'empty', size_type: '40HC', pol: 'CNSHA', pod: 'BRSSZ', slot: null, bl_ref: null, is_imo: false, is_oog: false, imo_class: null, un_number: null, ownership: null, imported_at: '2026-10-09T10:00:00Z' },
  ])),
}))
vi.mock('../../services/vaziosImportacaoImport', () => ({
  getBaplieManifestForVoyage: mocks.manifest, importVaziosFromBaplie: vi.fn(), replaceVaziosFromBaplie: vi.fn(),
}))

import { Baplie } from '../Baplie'

let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => client.clear())

function renderPage() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Baplie /></MemoryRouter></QueryClientProvider>)
}

it('vazios cadastrados com outros containers (mesma quantidade): oferece atualizar e recadastra', async () => {
  renderPage()
  const button = await screen.findByRole('button', { name: 'Atualizar vazios do Baplie' })
  expect(mocks.pending).toHaveBeenCalledWith(7, 'vm-1')
  expect(screen.getByText(/com outros containers ou rotas/)).toBeTruthy()

  mocks.pending.mockResolvedValue(false)
  fireEvent.click(button)
  await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith({ voyageId: 7, actorId: 'user-1' }))
  // A pendência é relida: sem diferença, a ação some.
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Atualizar vazios do Baplie' })).toBeNull())
})

it('vazios iguais aos do Baplie: sem ação de atualizar', async () => {
  mocks.pending.mockResolvedValue(false)
  renderPage()
  await waitFor(() => expect(mocks.pending).toHaveBeenCalled())
  expect(await screen.findByText(/cadastrados em/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Atualizar vazios do Baplie' })).toBeNull()
})
