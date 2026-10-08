// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reimport: vi.fn((): Promise<{ status: string; staged: number; vaziosReplaced: boolean; flagsError: string | null }> =>
    Promise.resolve({ status: 'imported', staged: 1, vaziosReplaced: false, flagsError: null })),
  parse: vi.fn(() => Promise.resolve({ containers: [{ container_number: 'CXRU1234567', status: 'full', pod: 'BRSSZ' }], pods: [], issues: [] })),
}))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1' } }) }))
vi.mock('../../hooks/useBls', () => ({ useVoyages: () => ({ data: [], isLoading: false }) }))
vi.mock('../../components/shared/VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect }: { onSelect: (id: number) => void }) => <button onClick={() => onSelect(24)}>Escolher viagem 24</button>,
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../services/baplieParser', () => ({ parseBaplieFile: mocks.parse }))
vi.mock('../../services/baplieImport', () => ({
  reimportBaplie: mocks.reimport, baplieImportToast: () => 'Importado', baplieReplacementConfirmOptions: vi.fn(),
}))
vi.mock('../../services/baplieReconciliation', () => ({ reconcileBaplieWithManifest: vi.fn() }))
vi.mock('../../services/baplieReadModel', () => ({ hasBlsForVoyage: vi.fn(() => Promise.resolve(false)), listBaplieStaging: vi.fn(() => Promise.resolve([])) }))
vi.mock('../../services/vaziosImportacaoImport', () => ({ getBaplieManifestForVoyage: vi.fn(() => Promise.resolve(null)), importVaziosFromBaplie: vi.fn(), replaceVaziosFromBaplie: vi.fn() }))

import { Baplie } from '../Baplie'

describe('upload na página Baplie', () => {
  it('atualiza a viagem escolhida no modal, mesmo sem mudar flags e com outra viagem aberta', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    client.setQueryData(['baplie-staging', '24'], ['anterior'])
    client.setQueryData(['voyages'], ['anterior'])
    try {
      render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=7']}><Baplie /></MemoryRouter></QueryClientProvider>)
      fireEvent.click(await screen.findByRole('button', { name: /Importar Baplie/ }))
      fireEvent.click(screen.getAllByRole('button', { name: 'Escolher viagem 24' })[1])
      const file = new File(['edi'], 'novo.edi', { type: 'text/plain' })
      fireEvent.change(screen.getByLabelText(/^Arquivo/), { target: { files: [file] } })
      await waitFor(() => expect((screen.getByRole('button', { name: /Importar Baplie \(1 container\)/ }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: /Importar Baplie \(1 container\)/ }))
      await waitFor(() => expect(client.getQueryState(['baplie-staging', '24'])?.isInvalidated).toBe(true))
      expect(client.getQueryState(['voyages'])?.isInvalidated).toBe(true)
      expect(mocks.reimport).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 24, actorId: 'user-1' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally { client.clear() }
  })

  it('Baplie gravado com falha ao aplicar IMO/OOG fica no modal com o que falta, sem fechar', async () => {
    mocks.reimport.mockResolvedValueOnce({ status: 'imported', staged: 1, vaziosReplaced: false, flagsError: 'timeout na aplicação' })
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    try {
      render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?voyage=24']}><Baplie /></MemoryRouter></QueryClientProvider>)
      fireEvent.click(await screen.findByRole('button', { name: /Importar Baplie/ }))
      fireEvent.change(screen.getByLabelText(/^Arquivo/), { target: { files: [new File(['edi'], 'novo.edi', { type: 'text/plain' })] } })
      await waitFor(() => expect((screen.getByRole('button', { name: /Importar Baplie \(1 container\)/ }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: /Importar Baplie \(1 container\)/ }))
      expect(await screen.findByText('Baplie importado, mas IMO/OOG não foram aplicados aos B/Ls')).toBeTruthy()
      expect(screen.getByText('timeout na aplicação')).toBeTruthy()
      expect(screen.getByRole('dialog')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally { client.clear() }
  })
})
