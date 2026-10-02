// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyFlags: vi.fn(() => Promise.resolve(0)),
  reimport: vi.fn(() => Promise.resolve({ status: 'imported', staged: 1, vaziosReplaced: false })),
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
vi.mock('../../services/baplieReconciliation', () => ({ applyBapliePhysicalFlags: mocks.applyFlags, reconcileBaplieWithManifest: vi.fn() }))
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
      fireEvent.change(screen.getByLabelText('Arquivo .edi ou .txt'), { target: { files: [file] } })
      await waitFor(() => expect((screen.getByRole('button', { name: /Confirmar importação/ }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: /Confirmar importação/ }))
      await waitFor(() => expect(client.getQueryState(['baplie-staging', '24'])?.isInvalidated).toBe(true))
      expect(client.getQueryState(['voyages'])?.isInvalidated).toBe(true)
      expect(mocks.applyFlags).toHaveBeenCalledWith(24, 'user-1')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally { client.clear() }
  })
})
