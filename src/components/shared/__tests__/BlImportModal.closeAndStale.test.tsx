// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  parseBLFile: vi.fn(),
  previewBlFreightImport: vi.fn(),
  confirmBlFreightImport: vi.fn(() => Promise.resolve({
    result: { imported: 1 },
    refusedCustomerRelinks: [] as Array<{ blNumber: string; blockers: string[] }>,
    calculationErrors: [] as Array<{ blNumber: string; message: string }>,
  })),
  afterManifestoImportado: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../services/blParser', () => ({ parseBLFile: mocks.parseBLFile }))
vi.mock('../../../services/blFreightImport', () => ({
  previewBlFreightImport: mocks.previewBlFreightImport,
  confirmBlFreightImport: mocks.confirmBlFreightImport,
  BlFreightImportRefused: class BlFreightImportRefused extends Error {
    readonly refused: string[]
    constructor(message: string, refused: string[] = []) {
      super(message)
      this.refused = refused
    }
  },
}))
vi.mock('../../../services/cacheEffects', () => ({
  afterManifestoImportado: mocks.afterManifestoImportado,
}))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({
    initialValue,
    onSelect,
  }: {
    initialValue?: string
    onSelect: (voyageId: number | null) => void
  }) => (
    <div>
      <span data-testid="voyage-initial">{initialValue ?? ''}</span>
      <button type="button" onClick={() => onSelect(7)}>Escolher viagem</button>
      <button type="button" onClick={() => onSelect(null)}>Limpar viagem</button>
    </div>
  ),
}))

import { BlImportModal } from '../BlImportModal'


// Achados da revisão das importações (ADR 0092): fechar no meio da gravação e
// prévia atrasada de uma viagem anterior.

beforeEach(() => {
  vi.clearAllMocks()
  mocks.afterManifestoImportado.mockResolvedValue(undefined)
})
afterEach(cleanup)

const parsedDoc = (blNumber: string) => ({ blNumber, parties: {}, route: {}, dates: {}, containers: [], vehicles: [], freightCharges: [] })

const previewRow = (blNumber: string) => ({
  blNumber, status: 'new', existing: false, voyageId: 7, voyageNumber: '14N', pol: 'CNSHA', pod: 'BRSSZ',
  ladenOnBoard: '2026-02-19', consigneeDocumentMatches: null, blockedReasons: [], billingImpacts: [],
  requiresBillingOverride: false, diffs: [], payload: { id: blNumber },
})
const previewOf = (blNumber: string) => ({
  rows: [previewRow(blNumber)],
  summary: { total: 1, newCount: 1, updatedCount: 0, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 0 },
})

function chooseFile(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['a'], 'bl.xlsx')] },
  })
}

it('prévia atrasada da viagem anterior não aparece depois de trocar a viagem', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  let resolveOld: ((value: unknown) => void) | undefined
  mocks.previewBlFreightImport.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
  const onClose = vi.fn()
  const { container } = render(<BlImportModal open voyageId={7} voyageLabel="GREEN / 14N" onClose={onClose} />)

  chooseFile(container)
  await waitFor(() => expect(mocks.previewBlFreightImport).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Limpar viagem' }))
  resolveOld?.(previewOf('COSU123'))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(screen.queryByText('COSU123')).toBeNull()
  expect((screen.getByRole('button', { name: /^Importar/ }) as HTMLButtonElement).disabled).toBe(true)
})

it('não fecha durante a gravação', async () => {
  mocks.parseBLFile.mockResolvedValue(parsedDoc('COSU123'))
  mocks.previewBlFreightImport.mockResolvedValue(previewOf('COSU123'))
  let finish: ((value: unknown) => void) | undefined
  mocks.confirmBlFreightImport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }) as never)
  const onClose = vi.fn()
  const { container } = render(<BlImportModal open voyageId={7} voyageLabel="GREEN / 14N" onClose={onClose} />)

  chooseFile(container)
  const confirm = await screen.findByRole('button', { name: /^Importar 1/ })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)
  await waitFor(() => expect(mocks.confirmBlFreightImport).toHaveBeenCalledTimes(1))

  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }))
  expect(onClose).not.toHaveBeenCalled()
  expect(mocks.showToast).toHaveBeenCalledWith('Aguarde: a gravação ainda está em andamento.', 'info')

  finish?.({ result: { imported: 1 }, refusedCustomerRelinks: [], calculationErrors: [] })
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})
