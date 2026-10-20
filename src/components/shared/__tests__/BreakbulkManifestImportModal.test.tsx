// @vitest-environment jsdom
// Regra de 2026-10-19 (ADR 0091): linha com erro recusa o manifesto BB
// inteiro; B/L cancelado é aviso. Depois de gravar, a viagem e o formato ficam
// travados: trocar um deles relia o arquivo e reabria o Importar.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  check: vi.fn(),
  importManifest: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../VoyageCombobox', () => ({
  VoyageCombobox: ({ onSelect, disabled }: { onSelect: (id: number | null) => void; disabled?: boolean }) => (
    <>
      <button type="button" disabled={disabled} onClick={() => onSelect(7)}>Escolher viagem 7</button>
      <button type="button" disabled={disabled} onClick={() => onSelect(8)}>Escolher viagem 8</button>
    </>
  ),
}))
vi.mock('../../../services/breakbulkImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/breakbulkImport')>()),
  parseBreakbulkManifestFile: mocks.parse,
  withBreakbulkReimportCheck: mocks.check,
  importBreakbulkManifest: mocks.importManifest,
}))

import { BreakbulkManifestImportModal } from '../BreakbulkManifestImportModal'

const bl = (bl_id: string) => ({
  rowNumber: 2, bl_id, bb_machine_qty: 1, bb_packages_qty: 2, bb_packages_total: 2, bb_weight_ton: 10, bb_cbm: 20,
  shipper: 'SHIPPER', consignee: 'CONSIGNEE', notify_party: null,
})
const manifest = (rowErrors: unknown[] = [], bls = [bl('BB001')]) => ({ layout: 'resumido', bls, rowErrors })
const result = {
  batchId: 1, inserted: ['BB001'], updated: [], unchanged: [], ceIgnored: [], cancelledIgnored: [], customerChangesIgnored: [],
  refusedCustomerRelinks: [], billingLocked: [], codPodKept: [], calculationErrors: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.check.mockImplementation(async (parsed: unknown) => parsed)
  mocks.importManifest.mockResolvedValue(result)
})
afterEach(cleanup)

function chooseFile(view: ReturnType<typeof render>) {
  fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'manifesto.xlsx')] },
  })
}

const fixed = { id: 7, label: 'GREEN SANTOS / 14N' }

it('linha com erro: Importar desativado e o rodapé diz que nada é importado', async () => {
  mocks.parse.mockResolvedValue(manifest([{ row: 3, message: 'Peso inválido.', raw: {} }]))
  const view = render(<BreakbulkManifestImportModal voyage={fixed} onClose={vi.fn()} />)
  chooseFile(view)
  expect(await screen.findByText('Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.')).toBeTruthy()
  const confirm = screen.getByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(mocks.importManifest).not.toHaveBeenCalled()
})

it('só B/Ls cancelados: "Nenhum B/L a importar.", não "Com erro no arquivo"', async () => {
  mocks.parse.mockResolvedValue(manifest())
  mocks.check.mockResolvedValue(manifest([{ row: 2, message: 'B/L BB001 cancelado: a linha não é tocada.', raw: { bl_id: 'BB001' }, severity: 'warning' }], []))
  const view = render(<BreakbulkManifestImportModal voyage={fixed} onClose={vi.fn()} />)
  chooseFile(view)
  expect(await screen.findByText('Nenhum B/L a importar.')).toBeTruthy()
  expect(screen.queryByText(/Com erro no arquivo/)).toBeNull()
  expect((screen.getByRole('button', { name: 'Importar B/Ls' }) as HTMLButtonElement).disabled).toBe(true)
})

it('caminho feliz: grava uma vez, mostra o Resultado e trava viagem e formato', async () => {
  mocks.parse.mockResolvedValue(manifest())
  const view = render(<BreakbulkManifestImportModal onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Escolher viagem 7' }))
  chooseFile(view)
  const confirm = await screen.findByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)

  expect(await screen.findByRole('heading', { name: 'Resultado' })).toBeTruthy()
  expect(mocks.importManifest).toHaveBeenCalledTimes(1)
  expect(mocks.importManifest).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, uploadedBy: 'user-1' }))
  expect((screen.getByRole('button', { name: 'Escolher viagem 8' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('combobox', { name: /Formato numérico/ }) as HTMLSelectElement).disabled).toBe(true)
  expect(mocks.parse).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Importar/ })).toBeNull()
})

it('não fecha durante a gravação', async () => {
  mocks.parse.mockResolvedValue(manifest())
  let finish: ((value: unknown) => void) | undefined
  mocks.importManifest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const onClose = vi.fn()
  const view = render(<BreakbulkManifestImportModal voyage={fixed} onClose={onClose} />)
  chooseFile(view)
  const confirm = await screen.findByRole('button', { name: 'Importar 1 B/L' }) as HTMLButtonElement
  await waitFor(() => expect(confirm.disabled).toBe(false))
  fireEvent.click(confirm)
  await waitFor(() => expect(mocks.importManifest).toHaveBeenCalledTimes(1))
  expect((screen.getByRole('combobox', { name: /Formato numérico/ }) as HTMLSelectElement).disabled).toBe(true)

  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }))
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  expect(onClose).not.toHaveBeenCalled()

  finish?.(result)
  expect(await screen.findByRole('heading', { name: 'Resultado' })).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
})
