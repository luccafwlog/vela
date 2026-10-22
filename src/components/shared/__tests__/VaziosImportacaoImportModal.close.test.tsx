// @vitest-environment jsdom
// Gravação em andamento: X, Escape e Voltar não fecham (como no CE Mercante).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  importManifest: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
}))

// Vazios já gravados na Viagem (ADR 0095, decisão 21): nenhum.
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }), useQuery: () => ({ data: [], isError: false }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect }: { onSelect: (id: number | null) => void }) => (
    <button type="button" onClick={() => onSelect(7)}>Escolher viagem 7</button>
  ),
}))
vi.mock('../../../services/vaziosImportacaoImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/vaziosImportacaoImport')>()),
  parseVaziosImportacaoFile: mocks.parse,
  importVaziosImportacaoManifest: mocks.importManifest,
}))

import { VaziosImportacaoImportModal } from '../VaziosImportacaoImportModal'

const container = (container_number: string) => ({ rowNumber: 2, container_number, container_type: '40HC', tare_kg: 3800, pol: 'CNTAC', pod: 'BRVIX' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.importManifest.mockResolvedValue({ manifestId: 'm1', mercanteManifestIds: ['mm1'] })
})
afterEach(cleanup)

function chooseFile(view: ReturnType<typeof render>) {
  fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'vazios.xlsx')] },
  })
}

it('não fecha durante a gravação; fecha ao gravar', async () => {
  mocks.parse.mockResolvedValue({ containers: [container('TGHU7654325')], rowErrors: [], warnings: [], hidden: { rows: 0, sheets: [] } })
  let finish: ((value: unknown) => void) | undefined
  mocks.importManifest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const onClose = vi.fn()
  const view = render(<VaziosImportacaoImportModal voyage={{ id: 7, label: 'GREEN SANTOS / 14N' }} onClose={onClose} />)
  chooseFile(view)
  fireEvent.change(await screen.findByPlaceholderText('Ex.: 1226501801342'), { target: { value: '99' } })
  const confirm = screen.getByRole('button', { name: 'Importar 1 container' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
  await waitFor(() => expect(mocks.importManifest).toHaveBeenCalledTimes(1))

  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }))
  expect(onClose).not.toHaveBeenCalled()
  expect(mocks.showToast).toHaveBeenCalledWith('Aguarde: a gravação ainda está em andamento.', 'info')

  finish?.({ manifestId: 'm1', mercanteManifestIds: ['mm1'] })
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})
